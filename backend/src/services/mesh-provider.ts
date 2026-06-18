/**
 * Neural 3D mesh generation — image → GLB/OBJ mesh via cloud GPU.
 *
 * Mirrors ai-provider.ts: a configurable fallback chain of providers.
 *   - fal       : PRIMARY. Stable REST, free-tier key, reliable for live demos. ~20-40s.
 *   - replicate : paid-ready, stable REST.
 *   - hf        : keyless best-effort — public Hugging Face Spaces (ZeroGPU). Can be busy /
 *                 quota-limited, so it's a backup, not the primary.
 *
 * Order comes from config.meshProviderOrder (env MESH_PROVIDER_ORDER). Providers without
 * credentials are skipped (hf needs none). The first to return a mesh wins.
 */
import fs from "fs";
import { config } from "../config";
import { tempPath, readFileBase64, getMediaType } from "../utils/file-helpers";
import { logger } from "../utils/logger";

export type MeshFormat = "glb" | "obj" | "ply" | "stl";

export interface MeshResult {
  meshPath: string;
  format: MeshFormat;
  providerLabel: string;
}

export interface MeshInput {
  imagePath?: string;
  prompt?: string;
}

const MESH_EXTS: MeshFormat[] = ["glb", "obj", "ply", "stl"];

/** Turn anything thrown (Error, plain object, gradio status, string) into a readable message. */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error === "string" && o.error) return o.error;
    try {
      const j = JSON.stringify(e);
      if (j && j !== "{}") return j.slice(0, 400);
    } catch { /* fall through */ }
  }
  return String(e);
}

function dataUri(imagePath: string): string {
  return `data:${getMediaType(imagePath)};base64,${readFileBase64(imagePath)}`;
}

function extFromUrl(url: string): MeshFormat | null {
  const clean = url.toLowerCase().split("?")[0];
  for (const e of MESH_EXTS) if (clean.endsWith("." + e)) return e;
  return null;
}

/**
 * Extract a downloadable mesh URL from an arbitrary REST/Gradio response. Prefers known
 * mesh-bearing keys and accepts their `.url` even when the URL has no recognizable
 * extension (signed URLs), inferring the format from file_name/content_type.
 */
function pickMesh(value: unknown): { url: string; format: MeshFormat } | null {
  const MESH_KEYS = ["model_mesh", "model_glb", "model_textured", "mesh", "glb", "model", "model_file", "file"];

  const fromFileObj = (o: Record<string, unknown>): { url: string; format: MeshFormat } | null => {
    const url = typeof o.url === "string" ? o.url : typeof o.path === "string" ? o.path : null;
    if (!url) return null;
    const name = `${(o.file_name as string) ?? ""} ${(o.content_type as string) ?? ""} ${url}`.toLowerCase();
    const format: MeshFormat =
      extFromUrl(url) ?? (MESH_EXTS.find((e) => name.includes(e)) as MeshFormat | undefined) ?? "glb";
    return { url, format };
  };

  const walk = (v: unknown): { url: string; format: MeshFormat } | null => {
    if (typeof v === "string") {
      const f = extFromUrl(v);
      return f ? { url: v, format: f } : null;
    }
    if (Array.isArray(v)) {
      for (const item of v) { const r = walk(item); if (r) return r; }
      return null;
    }
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      // 1) Known mesh keys first — accept their file object regardless of extension.
      for (const k of MESH_KEYS) {
        if (k in obj) {
          const val = obj[k];
          if (val && typeof val === "object" && !Array.isArray(val)) {
            const r = fromFileObj(val as Record<string, unknown>);
            if (r) return r;
          }
          const r = walk(val);
          if (r) return r;
        }
      }
      // 2) A file object with a mesh-looking url/path.
      if ("url" in obj || "path" in obj) {
        const r = fromFileObj(obj);
        if (r && (extFromUrl(r.url) || MESH_EXTS.some((e) => r.url.toLowerCase().includes(e)))) return r;
      }
      // 3) Recurse everything else.
      for (const val of Object.values(obj)) { const r = walk(val); if (r) return r; }
    }
    return null;
  };

  return walk(value);
}

/** Download a remote mesh URL into the uploads dir, returning the local path. */
async function downloadMesh(
  url: string,
  format: MeshFormat,
  signal?: AbortSignal,
): Promise<{ meshPath: string; format: MeshFormat }> {
  const res = await fetch(url, { signal: signal as RequestInit["signal"] });
  if (!res.ok) throw new Error(`Failed to download mesh (HTTP ${res.status}) from ${url.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded mesh file is empty");
  const meshPath = tempPath("." + format);
  fs.writeFileSync(meshPath, buf);
  return { meshPath, format };
}

// ─── fal.ai (PRIMARY — stable REST, free-tier key) ─────────────

async function generateFal(
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
  model: string = config.falMeshModel,
): Promise<MeshResult> {
  if (!config.falKey) throw new Error("fal not configured (FAL_KEY unset)");
  if (!input.imagePath) throw new Error("fal mesh generation needs an image");

  onStatus?.(`Generating 3D mesh · fal.ai (${model})`);

  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    // fal accepts a Base64 data URI for *_url image inputs.
    body: JSON.stringify({ input_image_url: dataUri(input.imagePath), textured_mesh: true }),
    signal: signal as RequestInit["signal"],
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    const hint =
      res.status === 401 || res.status === 403 ? " (check FAL_KEY is correct)" :
      res.status === 402 ? " (fal account out of credits)" :
      res.status === 404 ? " (model slug not found — check FAL_MESH_MODELS)" :
      res.status === 422 ? " (request rejected — model input schema may have changed)" : "";
    throw new Error(`fal HTTP ${res.status}${hint}: ${body}`);
  }

  const json = await res.json();
  const picked = pickMesh(json);
  if (!picked) throw new Error(`fal returned no mesh URL. Response: ${JSON.stringify(json).slice(0, 300)}`);
  onStatus?.("Downloading mesh…");
  const { meshPath, format } = await downloadMesh(picked.url, picked.format, signal);
  return { meshPath, format, providerLabel: `fal.ai · ${model}` };
}

/** Run one specific fal model (each is its own candidate in multi-engine mode). */
export function runFalModel(
  model: string,
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<MeshResult> {
  return generateFal(input, onStatus, signal, model);
}

/** Run one specific provider — exported for the multi-candidate orchestrator. */
export { generateReplicate as runReplicate };

// ─── Replicate (paid-ready, REST) ──────────────────────────────

async function generateReplicate(
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<MeshResult> {
  if (!config.replicateApiToken) throw new Error("Replicate not configured (REPLICATE_API_TOKEN unset)");
  if (!input.imagePath) throw new Error("Replicate mesh generation needs an image");

  const [owner, name] = config.replicateMeshModel.split("/");
  if (!owner || !name) throw new Error(`Bad REPLICATE_MESH_MODEL: ${config.replicateMeshModel}`);

  onStatus?.(`Generating 3D mesh · Replicate (${config.replicateMeshModel})`);

  const headers = {
    Authorization: `Bearer ${config.replicateApiToken}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  };
  const body = JSON.stringify({ input: { image: dataUri(input.imagePath) } });

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
    { method: "POST", headers, body, signal: signal as RequestInit["signal"] },
  );
  if (!createRes.ok) {
    throw new Error(`Replicate HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 300)}`);
  }

  let prediction = (await createRes.json()) as {
    status: string; output?: unknown; error?: unknown; urls?: { get?: string };
  };

  const deadline = Date.now() + 5 * 60_000;
  while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() > deadline) throw new Error("Replicate timed out after 5 min");
    if (!prediction.urls?.get) throw new Error("Replicate prediction has no poll URL");
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${config.replicateApiToken}` },
      signal: signal as RequestInit["signal"],
    });
    prediction = (await poll.json()) as typeof prediction;
    onStatus?.(`Generating 3D mesh · Replicate (${prediction.status})`);
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Replicate ${prediction.status}: ${describeError(prediction.error).slice(0, 300)}`);
  }

  const picked = pickMesh(prediction.output);
  if (!picked) throw new Error("Replicate succeeded but returned no mesh URL");
  onStatus?.("Downloading mesh…");
  const { meshPath, format } = await downloadMesh(picked.url, picked.format, signal);
  return { meshPath, format, providerLabel: `Replicate · ${config.replicateMeshModel}` };
}

// ─── Hugging Face Spaces via Gradio (free, keyless backup) ─────
//
// @gradio/client is ESM-only; load it with a dynamic import that TypeScript's
// CommonJS output won't downlevel into require().
const importESM = new Function("specifier", "return import(specifier)") as (s: string) => Promise<unknown>;

interface GradioApp {
  predict: (endpoint: string, args: unknown[]) => Promise<{ data?: unknown }>;
}
type HandleFile = (f: unknown) => unknown;

type HfRecipe = (app: GradioApp, handleFile: HandleFile, imagePath: string, prompt: string) => Promise<{ url: string; format: MeshFormat }>;

// Hunyuan3D 2.0 and 2.1 share the same /shape_generation signature (geometry only;
// /generation_all's texture path NameErrors). Verified against both Spaces' gradio_app.py.
const hunyuanShapeGen: HfRecipe = async (app, handleFile, imagePath, prompt) => {
  const r = await app.predict("/shape_generation", [
    prompt || "",            // caption
    handleFile(imagePath),   // image
    null, null, null, null,  // mv_image front/back/left/right
    25,                      // steps
    5.0,                     // guidance_scale
    1234,                    // seed
    256,                     // octree_resolution
    true,                    // check_box_rembg (remove background)
    8000,                    // num_chunks
    true,                    // randomize_seed
  ]);
  const picked = pickMesh((r.data as unknown[]) ?? r.data);
  if (!picked) throw new Error("Hunyuan3D returned no mesh file");
  return picked;
};

/**
 * Per-Space "recipes" with the exact endpoint + argument order each Space expects
 * (discovered via view_api / gradio_app.py). Far more reliable than generic discovery.
 * Each returns the mesh URL + format from the Space's output.
 */
const HF_RECIPES: Record<string, HfRecipe> = {
  // Best quality. ZeroGPU — may be busy; that's why it's a backup behind fal.
  "tencent/Hunyuan3D-2": hunyuanShapeGen,
};

/** Space ids that have a known working recipe (used to build the engine catalog). */
export function knownHfSpaces(): string[] {
  return config.meshHfSpaces.filter((id) => id in HF_RECIPES);
}

/** Run one specific HF Space recipe — its own candidate in multi-engine mode. */
export async function runHfSpace(
  spaceId: string,
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<MeshResult> {
  if (!input.imagePath) throw new Error("HF Space mesh generation needs an image");
  const recipe = HF_RECIPES[spaceId];
  if (!recipe) throw new Error(`${spaceId}: no recipe (supported: ${Object.keys(HF_RECIPES).join(", ")})`);

  const mod = (await importESM("@gradio/client")) as {
    Client: { connect: (id: string, opts?: Record<string, unknown>) => Promise<GradioApp> };
    handle_file: HandleFile;
  };
  const { Client, handle_file } = mod;

  onStatus?.(`Connecting · ${spaceId} (free GPU)`);
  const app = await Client.connect(spaceId, config.hfToken ? { hf_token: config.hfToken } : {});
  onStatus?.(`Generating 3D mesh · ${spaceId} (free GPU — may queue)`);
  // ZeroGPU Spaces can stall on cold-start/queue — cap the attempt.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${config.meshHfTimeoutMs / 1000}s (Space busy or cold-starting)`)), config.meshHfTimeoutMs);
  });
  let picked: { url: string; format: MeshFormat };
  try {
    picked = await Promise.race([recipe(app, handle_file, input.imagePath, input.prompt ?? ""), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  onStatus?.("Downloading mesh…");
  const { meshPath, format } = await downloadMesh(picked.url, picked.format, signal);
  return { meshPath, format, providerLabel: `HF Space · ${spaceId}` };
}

// ─── Text → reference image (keeps text-only generation alive) ─
//
// Neural mesh engines all need an image. When the user gives only a prompt, synthesize a
// reference image first, then feed it to the mesh engines. fal (FLUX) is primary; a keyless
// HF Space is the fallback so text→3D still works without any API key.

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

/** Extract the first image URL from an arbitrary REST/Gradio response. */
function pickImageUrl(value: unknown): string | null {
  const isImg = (u: string) => {
    const clean = u.toLowerCase().split("?")[0];
    return IMAGE_EXTS.some((e) => clean.endsWith("." + e)) || clean.startsWith("data:image");
  };
  const walk = (v: unknown): string | null => {
    if (typeof v === "string") return isImg(v) ? v : null;
    if (Array.isArray(v)) { for (const i of v) { const r = walk(i); if (r) return r; } return null; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Prefer explicit url/path on a file object even if the URL is signed (no extension).
      if (typeof o.url === "string" && (isImg(o.url) || "width" in o || "content_type" in o)) return o.url;
      if (typeof o.path === "string" && isImg(o.path)) return o.path;
      for (const val of Object.values(o)) { const r = walk(val); if (r) return r; }
    }
    return null;
  };
  return walk(value);
}

/** Download a remote image URL into the uploads dir, returning the local path. */
async function downloadImage(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal: signal as RequestInit["signal"] });
  if (!res.ok) throw new Error(`Failed to download reference image (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded reference image is empty");
  const ext = extFromImageUrl(url) ?? "png";
  const imgPath = tempPath("." + ext);
  fs.writeFileSync(imgPath, buf);
  return imgPath;
}

function extFromImageUrl(url: string): string | null {
  const clean = url.toLowerCase().split("?")[0];
  return IMAGE_EXTS.find((e) => clean.endsWith("." + e)) ?? null;
}

/**
 * Wrap the user's prompt with directives that make the image easy to turn into a 3D model:
 * a single, fully-visible object on a plain white background with flat, even lighting.
 */
function buildImagePrompt(userPrompt: string): string {
  return `${userPrompt}, single object, centered, full object visible, ` +
    `studio product photograph, plain solid white background, soft even lighting, ` +
    `no shadows, no text, no people, high detail`;
}

/** fal text-to-image (FLUX) — primary. Requires FAL_KEY. */
async function textToImageFal(prompt: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  if (!config.falKey) throw new Error("fal not configured (FAL_KEY unset)");
  const model = config.falTextToImageModel;
  onStatus?.(`Generating reference image · fal.ai (${model})`);
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: buildImagePrompt(prompt) }),
    signal: signal as RequestInit["signal"],
  });
  if (!res.ok) {
    throw new Error(`fal text-to-image HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const url = pickImageUrl(json);
  if (!url) throw new Error(`fal returned no image URL. Response: ${JSON.stringify(json).slice(0, 300)}`);
  return downloadImage(url, signal);
}

/** Keyless HF Space text-to-image (FLUX schnell) — fallback. */
async function textToImageHf(prompt: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  const spaceId = config.hfTextToImageSpace;
  const mod = (await importESM("@gradio/client")) as {
    Client: { connect: (id: string, opts?: Record<string, unknown>) => Promise<GradioApp> };
  };
  onStatus?.(`Generating reference image · ${spaceId} (free GPU — may queue)`);
  const app = await mod.Client.connect(spaceId, config.hfToken ? { hf_token: config.hfToken } : {});
  // FLUX.1-schnell: /infer([prompt, seed, randomize_seed, width, height, num_inference_steps]).
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${config.meshHfTimeoutMs / 1000}s`)), config.meshHfTimeoutMs);
  });
  let url: string | null;
  try {
    const r = await Promise.race([app.predict("/infer", [buildImagePrompt(prompt), 0, true, 1024, 1024, 4]), timeout]);
    url = pickImageUrl((r.data as unknown[]) ?? r.data);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!url) throw new Error(`${spaceId} returned no image`);
  return downloadImage(url, signal);
}

/**
 * Synthesize a reference image from a text prompt. Returns the local image path.
 * Tries fal first (if a key is set), then the keyless HF Space.
 */
export async function generateImageFromText(
  prompt: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const errors: string[] = [];
  const providers: Array<() => Promise<string>> = [];
  if (config.falKey) providers.push(() => textToImageFal(prompt, onStatus, signal));
  providers.push(() => textToImageHf(prompt, onStatus, signal));

  for (const run of providers) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await run();
    } catch (err) {
      const msg = describeError(err);
      logger.warn(`[text2img] provider failed: ${msg}`);
      errors.push(msg);
    }
  }
  throw new Error(
    `Could not synthesize a reference image for text-only generation.\n${errors.map((e) => "  • " + e).join("\n")}`,
  );
}

// ─── Instruction-based image editing (keep the photo, apply the prompt) ──
//
// Takes an existing image + an edit INSTRUCTION ("make the lid red", "add a handle") and returns
// the same photo with just that change — NOT a from-scratch render. The user's prompt is sent
// verbatim (no studio-scene wrap). fal FLUX Kontext is primary; a keyless HF InstructPix2Pix Space
// is the best-effort fallback.

/** fal instruction edit (FLUX Kontext) — primary. Requires FAL_KEY. */
async function editImageFal(imagePath: string, instruction: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  if (!config.falKey) throw new Error("fal not configured (FAL_KEY unset)");
  const model = config.falImageEditModel;
  onStatus?.(`Editing image · fal.ai (${model})`);
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    // Kontext is instruction-based: the prompt is the edit, the source image is preserved (no strength).
    body: JSON.stringify({ prompt: instruction, image_url: dataUri(imagePath) }),
    signal: signal as RequestInit["signal"],
  });
  if (!res.ok) {
    throw new Error(`fal image-edit HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const url = pickImageUrl(await res.json());
  if (!url) throw new Error("fal image-edit returned no image URL");
  return downloadImage(url, signal);
}

/** Keyless HF Space instruction edit (InstructPix2Pix) — best-effort fallback. */
async function editImageHf(imagePath: string, instruction: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  const spaceId = config.hfImageEditSpace;
  if (!spaceId) throw new Error("HF image-edit not configured (HF_IMAGE_EDIT_SPACE unset)");
  const mod = (await importESM("@gradio/client")) as {
    Client: { connect: (id: string, opts?: Record<string, unknown>) => Promise<GradioApp> };
    handle_file: HandleFile;
  };
  const { Client, handle_file } = mod;
  onStatus?.(`Editing image · ${spaceId} (free GPU — may queue)`);
  const app = await Client.connect(spaceId, config.hfToken ? { hf_token: config.hfToken } : {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${config.meshHfTimeoutMs / 1000}s`)), config.meshHfTimeoutMs);
  });
  let url: string | null;
  try {
    // Best-effort: instruction-edit Spaces take (image, instruction) on the first fn.
    const r = await Promise.race([app.predict("/predict", [handle_file(imagePath), instruction]), timeout]);
    url = pickImageUrl((r.data as unknown[]) ?? r.data);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!url) throw new Error(`${spaceId} returned no image`);
  return downloadImage(url, signal);
}

/**
 * Edit an existing image with a text instruction, preserving the rest of the photo. Returns the
 * local image path. Tries fal (FLUX Kontext) first if a key is set, then the keyless HF Space.
 * The `prompt` is the edit instruction, sent verbatim.
 */
export async function generateImageFromImage(
  imagePath: string,
  prompt: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const instruction = prompt.trim();
  const errors: string[] = [];
  const providers: Array<() => Promise<string>> = [];
  if (config.falKey) providers.push(() => editImageFal(imagePath, instruction, onStatus, signal));
  if (config.hfImageEditSpace) providers.push(() => editImageHf(imagePath, instruction, onStatus, signal));

  for (const run of providers) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await run();
    } catch (err) {
      const msg = describeError(err);
      logger.warn(`[image-edit] provider failed: ${msg}`);
      errors.push(msg);
    }
  }
  throw new Error(
    errors.length
      ? `Could not edit the image.\n${errors.map((e) => "  • " + e).join("\n")}`
      : "No image-edit provider is configured. Set FAL_KEY (fal Kontext) or HF_IMAGE_EDIT_SPACE (keyless).",
  );
}

// ─── Upscale / sharpen (best-effort) ───────────────────────────
//
// Raises the resolution of an image before image→3D. fal (ESRGAN-style) is primary; a keyless
// HF Space is an opt-in fallback. Best-effort — on total failure the original path is returned.

/** fal upscaler — primary. Requires FAL_KEY. */
async function upscaleFal(imagePath: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  if (!config.falKey) throw new Error("fal not configured (FAL_KEY unset)");
  const model = config.falUpscaleModel;
  onStatus?.(`Upscaling · fal.ai (${model})`);
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: dataUri(imagePath) }),
    signal: signal as RequestInit["signal"],
  });
  if (!res.ok) {
    throw new Error(`fal upscale HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const url = pickImageUrl(await res.json());
  if (!url) throw new Error("fal upscale returned no image URL");
  return downloadImage(url, signal);
}

/** Keyless HF Space upscaler — opt-in fallback (set HF_UPSCALE_SPACE). */
async function upscaleHf(imagePath: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  const spaceId = config.hfUpscaleSpace;
  if (!spaceId) throw new Error("HF upscale not configured (HF_UPSCALE_SPACE unset)");
  const mod = (await importESM("@gradio/client")) as {
    Client: { connect: (id: string, opts?: Record<string, unknown>) => Promise<GradioApp> };
    handle_file: HandleFile;
  };
  const { Client, handle_file } = mod;
  onStatus?.(`Upscaling · ${spaceId} (free GPU — may queue)`);
  const app = await Client.connect(spaceId, config.hfToken ? { hf_token: config.hfToken } : {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${config.meshHfTimeoutMs / 1000}s`)), config.meshHfTimeoutMs);
  });
  let url: string | null;
  try {
    const r = await Promise.race([app.predict("/predict", [handle_file(imagePath)]), timeout]);
    url = pickImageUrl((r.data as unknown[]) ?? r.data);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!url) throw new Error(`${spaceId} returned no image`);
  return downloadImage(url, signal);
}

/**
 * Upscale / sharpen an image, returning the path to the higher-resolution result.
 * Best-effort: tries fal then the keyless HF Space; on total failure returns `imagePath`.
 */
export async function upscaleImage(
  imagePath: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const providers: Array<() => Promise<string>> = [];
  if (config.falKey) providers.push(() => upscaleFal(imagePath, onStatus, signal));
  if (config.hfUpscaleSpace) providers.push(() => upscaleHf(imagePath, onStatus, signal));

  for (const run of providers) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await run();
    } catch (err) {
      logger.warn(`[upscale] provider failed: ${describeError(err)}`);
    }
  }
  logger.warn("[upscale] no provider succeeded — using original image (not upscaled)");
  return imagePath;
}

// ─── Background removal → transparent cutout ───────────────────
//
// A clean, isolated object is the ideal input for image→3D. fal (rembg) is primary; a keyless
// HF Space is the fallback. This step is BEST-EFFORT — if every provider fails the original
// image is returned unchanged, so generation never blocks (the mesh engines still rembg too).

/** fal background removal — primary. Requires FAL_KEY. Returns a transparent PNG path. */
async function removeBackgroundFal(imagePath: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  if (!config.falKey) throw new Error("fal not configured (FAL_KEY unset)");
  const model = config.falRembgModel;
  onStatus?.(`Removing background · fal.ai (${model})`);
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    // fal accepts a Base64 data URI for *_url image inputs.
    body: JSON.stringify({ image_url: dataUri(imagePath) }),
    signal: signal as RequestInit["signal"],
  });
  if (!res.ok) {
    throw new Error(`fal rembg HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const url = pickImageUrl(await res.json());
  if (!url) throw new Error("fal rembg returned no image URL");
  return downloadImage(url, signal);
}

/** Keyless HF Space background removal — fallback. Returns a transparent PNG path. */
async function removeBackgroundHf(imagePath: string, onStatus?: (m: string) => void, signal?: AbortSignal): Promise<string> {
  const spaceId = config.hfRembgSpace;
  const mod = (await importESM("@gradio/client")) as {
    Client: { connect: (id: string, opts?: Record<string, unknown>) => Promise<GradioApp> };
    handle_file: HandleFile;
  };
  const { Client, handle_file } = mod;
  onStatus?.(`Removing background · ${spaceId} (free GPU — may queue)`);
  const app = await Client.connect(spaceId, config.hfToken ? { hf_token: config.hfToken } : {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${config.meshHfTimeoutMs / 1000}s`)), config.meshHfTimeoutMs);
  });
  let url: string | null;
  try {
    // Most rembg Spaces expose a single image→image endpoint as the first fn (default "/predict").
    const r = await Promise.race([app.predict("/predict", [handle_file(imagePath)]), timeout]);
    url = pickImageUrl((r.data as unknown[]) ?? r.data);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!url) throw new Error(`${spaceId} returned no image`);
  return downloadImage(url, signal);
}

/**
 * Remove the background from an image, returning the path to a transparent cutout.
 * Best-effort: tries fal then the keyless HF Space; on total failure returns `imagePath`.
 */
export async function removeBackground(
  imagePath: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const providers: Array<() => Promise<string>> = [];
  if (config.falKey) providers.push(() => removeBackgroundFal(imagePath, onStatus, signal));
  providers.push(() => removeBackgroundHf(imagePath, onStatus, signal));

  for (const run of providers) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await run();
    } catch (err) {
      logger.warn(`[rembg] provider failed: ${describeError(err)}`);
    }
  }
  logger.warn("[rembg] all providers failed — using original image (background not removed)");
  return imagePath;
}

/**
 * Text → 3D-ready reference image: synthesize from the prompt, then remove the background.
 * Returns the local path to the (transparent) cutout. Used by the /api/text-to-image route.
 */
export async function generateReferenceImage(
  prompt: string,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const imagePath = await generateImageFromText(prompt, onStatus, signal);
  if (signal?.aborted) throw new Error("aborted");
  return removeBackground(imagePath, onStatus, signal);
}

async function generateHfSpace(
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<MeshResult> {
  const errors: string[] = [];
  for (const spaceId of config.meshHfSpaces) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await runHfSpace(spaceId, input, onStatus, signal);
    } catch (err) {
      const msg = describeError(err);
      logger.warn(`HF Space ${spaceId} failed: ${msg}`);
      errors.push(`${spaceId}: ${msg}`);
    }
  }
  throw new Error(`all HF Spaces failed:\n${errors.map((e) => "    - " + e).join("\n")}`);
}

// ─── Public entry point with fallback chain ────────────────────

const PROVIDERS: Record<string, (i: MeshInput, s?: (m: string) => void, a?: AbortSignal) => Promise<MeshResult>> = {
  fal: generateFal,
  replicate: generateReplicate,
  hf: generateHfSpace,
};

/** Returns the providers that are actually usable (have credentials where needed). */
export function availableMeshProviders(): string[] {
  return config.meshProviderOrder.filter((id) => {
    if (id === "hf") return true;
    if (id === "replicate") return !!config.replicateApiToken;
    if (id === "fal") return !!config.falKey;
    return false;
  });
}

export async function generateMesh(
  input: MeshInput,
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<MeshResult> {
  const order = availableMeshProviders();
  if (order.length === 0) {
    throw new Error(
      "No reliable mesh provider configured. Add a free FAL_KEY (https://fal.ai) to backend/.env " +
      "for dependable Photo→3D, or set REPLICATE_API_TOKEN. (Keyless HF Spaces alone are often busy.)",
    );
  }

  const errors: string[] = [];
  for (const id of order) {
    const fn = PROVIDERS[id];
    if (!fn) continue;
    try {
      logger.info(`[mesh] trying provider: ${id}`);
      return await fn(input, onStatus, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      const msg = describeError(err);
      logger.warn(`[mesh] provider ${id} failed: ${msg}`);
      errors.push(`${id}: ${msg}`);
    }
  }
  throw new Error(`All mesh providers failed:\n${errors.map((e) => "  • " + e).join("\n")}`);
}
