import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config, getProviderFallbackOrder } from "../config";
import { ensureUploadsDir } from "../utils/file-helpers";
import { initSSE, writeSSE, closeSSE, errorSSE } from "../utils/stream-helpers";
import { getBedSize, type BedSize } from "../services/mesh.service";
import { resolveEngines, runEngines, type EngineContext } from "../services/engines";
import { generateImageFromText } from "../services/mesh-provider";
import { logger } from "../utils/logger";

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024, files: 8 } });

const router = Router();

/**
 * Multi-candidate generation. Runs every selected neural engine concurrently and
 * streams one candidate per engine, so the user can pick and switch between several
 * results. Text-only input is first turned into a reference image.
 *
 * SSE events: `engines` (the plan), `status` ({engineId,message}),
 * `candidate_ready` (a Candidate), `candidate_failed` ({engineId,error}), `done`.
 */
router.post("/generate", upload.array("images", 8), async (req, res) => {
  initSSE(res);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const uploadedImagePaths = files.map((f) => f.path);

    const {
      prompt = "",
      imageRefs,
      forceProviderId: rawForceProviderId,
      printerPreset = "ender3",
      bedSize: rawBedSize,
      engines: rawEngines,
    } = req.body as Record<string, string>;

    // Custom printers can't be resolved from an id alone — the client sends the
    // actual build volume so the dimension check matches the on-screen sim.
    let bedSizeOverride: BedSize | null = null;
    if (rawBedSize) {
      try {
        const b = JSON.parse(rawBedSize);
        if (b && b.w > 0 && b.d > 0 && b.h > 0) bedSizeOverride = { w: Number(b.w), d: Number(b.d), h: Number(b.h) };
      } catch { /* ignore malformed bedSize — fall back to preset */ }
    }

    // Validate optional forceProviderId — must match an active chain entry id.
    let forceProviderId: string | undefined;
    if (rawForceProviderId && rawForceProviderId.trim()) {
      const candidate = rawForceProviderId.trim();
      if (!getProviderFallbackOrder().some((e) => e.id === candidate)) {
        errorSSE(res, `Unknown provider id: ${candidate}`, "BAD_PROVIDER");
        return;
      }
      forceProviderId = candidate;
    }

    // Pre-uploaded imageRefs (e.g. from "generate variants from this model").
    const imageRefPaths: string[] = [];
    if (imageRefs) {
      try {
        const refs: unknown = JSON.parse(imageRefs);
        if (Array.isArray(refs)) {
          for (const ref of refs) {
            if (typeof ref !== "string") continue;
            const p = path.join(config.uploadsDir, path.basename(ref));
            if (fs.existsSync(p)) imageRefPaths.push(p);
            else logger.warn(`imageRef not found, skipping: ${ref}`);
          }
        }
      } catch (e) {
        logger.warn("Invalid imageRefs JSON, ignoring:", e);
      }
    }

    const allImagePaths = [...uploadedImagePaths, ...imageRefPaths];
    if (allImagePaths.length === 0 && !prompt) {
      errorSSE(res, "Provide at least one image or a text prompt", "NO_INPUT");
      return;
    }

    // Text-only input: neural mesh engines all need an image, so synthesize a reference
    // image from the prompt first, then feed it to the engines below.
    if (allImagePaths.length === 0 && prompt.trim()) {
      try {
        writeSSE(res, "status", { message: "Generating reference image · text-to-image" });
        const imgPath = await generateImageFromText(
          prompt.trim(),
          (m) => { if (!abortController.signal.aborted) writeSSE(res, "status", { message: m }); },
          abortController.signal,
        );
        allImagePaths.push(imgPath);
      } catch (err) {
        if (abortController.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Text-to-image failed";
        errorSSE(res, `Text-only generation needs a text-to-image provider. ${msg}`, "NO_ENGINE");
        return;
      }
    }

    // Which engines to run: requested ids (or all), filtered to those the input supports.
    let requestedIds: string[] | undefined;
    if (rawEngines) {
      try {
        const parsed = JSON.parse(rawEngines);
        if (Array.isArray(parsed)) requestedIds = parsed.filter((x) => typeof x === "string");
      } catch { /* ignore — run all available */ }
    }

    const engines = resolveEngines(requestedIds, allImagePaths.length > 0, !!prompt);
    if (engines.length === 0) {
      errorSSE(res, "No generation engine is available. Configure FAL_KEY/REPLICATE_API_TOKEN or the keyless HF Space.", "NO_ENGINE");
      return;
    }

    const ctx: EngineContext = {
      imagePaths: allImagePaths,
      prompt,
      forceProviderId,
      bed: bedSizeOverride ?? getBedSize(printerPreset),
    };

    writeSSE(res, "engines", {
      engines: engines.map((e) => ({ id: e.id, label: e.label, kind: e.kind })),
    });

    await runEngines(engines, ctx, abortController.signal, {
      onStatus: (engineId, message) => {
        if (!abortController.signal.aborted) writeSSE(res, "status", { engineId, message });
      },
      onReady: (candidate) => {
        if (!abortController.signal.aborted) writeSSE(res, "candidate_ready", candidate);
      },
      onFailed: (engineId, error) => {
        if (!abortController.signal.aborted) writeSSE(res, "candidate_failed", { engineId, error });
      },
    });

    if (abortController.signal.aborted) return;
    writeSSE(res, "done", null);
    closeSSE(res);
  } catch (err: unknown) {
    if (!abortController.signal.aborted) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      logger.error("Generate error:", err);
      errorSSE(res, msg, "GENERATION_ERROR");
    }
  }
});

export default router;
