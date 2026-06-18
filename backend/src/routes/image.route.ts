import { Router } from "express";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { initSSE, writeSSE, closeSSE, errorSSE } from "../utils/stream-helpers";
import {
  generateReferenceImage,
  generateImageFromImage,
  removeBackground,
  upscaleImage,
} from "../services/mesh-provider";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Phase A of the text→photo→confirm→3D flow. Synthesizes a 3D-friendly reference photo from a
 * text prompt and removes its background, then streams the result so the user can review it
 * before committing to 3D generation. The returned `ref` is an uploads basename that can be
 * passed straight back to /api/generate as an `imageRefs` entry (Phase B).
 *
 * SSE events: `status` ({message}), `image_ready` ({ref,url}), `done`, `error`.
 */
router.post("/text-to-image", async (req, res) => {
  initSSE(res);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const prompt = String((req.body as Record<string, unknown>)?.prompt ?? "").trim();
    if (!prompt) {
      errorSSE(res, "Provide a text prompt to generate a photo", "NO_INPUT");
      return;
    }

    const imgPath = await generateReferenceImage(
      prompt,
      (m) => { if (!abortController.signal.aborted) writeSSE(res, "status", { message: m }); },
      abortController.signal,
    );

    if (abortController.signal.aborted) return;

    const ref = path.basename(imgPath);
    writeSSE(res, "image_ready", { ref, url: `/api/files/${ref}` });
    closeSSE(res);
  } catch (err: unknown) {
    if (abortController.signal.aborted) return;
    const msg = err instanceof Error ? err.message : "Image generation failed";
    logger.error("text-to-image error:", err);
    errorSSE(res, msg, "IMAGE_ERROR");
  }
});

/**
 * Refine an already-uploaded image before 3D generation, then stream the result for review.
 * Two modes:
 *   - "reimagine": use the image as a reference + a text prompt → a new 3D-friendly photo
 *                  (image-to-image), background-removed like the text→photo path.
 *   - "enhance":   clean the image in place — optional upscale, then optional background removal.
 *
 * Body: { imageRef, mode, prompt?, ops?: { removeBg?, upscale? } }. The returned `ref` is an
 * uploads basename that can be passed straight back to /api/generate as an `imageRefs` entry.
 *
 * SSE events: `status` ({message}), `image_ready` ({ref,url}), `done`, `error` — same shape as
 * /text-to-image so the frontend reuses the parser.
 */
router.post("/refine-image", async (req, res) => {
  initSSE(res);

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  const onStatus = (m: string) => {
    if (!abortController.signal.aborted) writeSSE(res, "status", { message: m });
  };

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const imageRef = String(body.imageRef ?? "").trim();
    const mode = String(body.mode ?? "").trim();
    const prompt = String(body.prompt ?? "").trim();
    const ops = (body.ops ?? {}) as { removeBg?: boolean; upscale?: boolean };

    if (!imageRef) {
      errorSSE(res, "Provide an image to refine", "NO_INPUT");
      return;
    }
    if (mode !== "reimagine" && mode !== "enhance") {
      errorSSE(res, `Unknown refine mode: ${mode}`, "BAD_MODE");
      return;
    }

    // Resolve the source path safely — basename guards against path traversal.
    const srcPath = path.join(config.uploadsDir, path.basename(imageRef));
    if (!fs.existsSync(srcPath)) {
      errorSSE(res, "Source image not found (it may have expired — re-upload it)", "NOT_FOUND");
      return;
    }

    let outPath: string;
    if (mode === "reimagine") {
      if (!prompt) {
        errorSSE(res, "Provide a text prompt to reimagine the image", "NO_INPUT");
        return;
      }
      // Instruction-based edit — preserve the photo, apply only the prompt. No background removal
      // here (that would change the photo); the user can chain Enhance, and 3D engines rembg anyway.
      outPath = await generateImageFromImage(srcPath, prompt, onStatus, abortController.signal);
    } else {
      // enhance
      outPath = srcPath;
      if (ops.upscale) {
        outPath = await upscaleImage(outPath, onStatus, abortController.signal);
        if (abortController.signal.aborted) return;
      }
      // Background removal defaults on for the enhance flow.
      if (ops.removeBg !== false) {
        outPath = await removeBackground(outPath, onStatus, abortController.signal);
      }
    }

    if (abortController.signal.aborted) return;

    const ref = path.basename(outPath);
    writeSSE(res, "image_ready", { ref, url: `/api/files/${ref}` });
    closeSSE(res);
  } catch (err: unknown) {
    if (abortController.signal.aborted) return;
    const msg = err instanceof Error ? err.message : "Image refine failed";
    logger.error("refine-image error:", err);
    errorSSE(res, msg, "IMAGE_ERROR");
  }
});

export default router;
