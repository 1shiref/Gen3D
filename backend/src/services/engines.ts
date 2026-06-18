/**
 * Generation engine catalog + parallel candidate orchestration.
 *
 * Each engine independently turns the input image into ONE candidate mesh.
 * The route runs the selected engines concurrently and streams a candidate per engine,
 * so the user gets several models to choose between instead of a single fallback winner.
 */
import { config } from "../config";
import { fileUrl } from "../utils/file-helpers";
import { logger } from "../utils/logger";
import { type BedSize, type DimensionCheck } from "./mesh.service";
import { runFalModel, runReplicate, runHfSpace, knownHfSpaces, type MeshFormat } from "./mesh-provider";

export interface Candidate {
  engineId: string;
  engineLabel: string;
  kind: "neural";
  url: string;
  format: MeshFormat;
  boundingBox?: { x: number; y: number; z: number };
  dimensionCheck?: DimensionCheck | null;
  previewUrl?: string | null;
  materialSuggestion?: string;
  printabilityWarnings?: string[];
  suggestedDimensions?: string;
}

export interface EngineContext {
  imagePaths: string[];
  prompt: string;
  forceProviderId?: string;
  bed: BedSize;
}

export interface EngineDescriptor {
  id: string;
  label: string;
  kind: "neural";
  needsImage: boolean;
  available: boolean;
  run: (ctx: EngineContext, onStatus: (m: string) => void, signal: AbortSignal) => Promise<Candidate>;
}

const shortName = (slug: string) => slug.split("/").slice(-2).join("/");

// ─── Neural engines (one candidate per model/space) ────────────

function neuralCandidate(engineId: string, engineLabel: string, meshPath: string, format: MeshFormat): Candidate {
  return {
    engineId,
    engineLabel,
    kind: "neural",
    url: fileUrl(meshPath),
    format,
    boundingBox: { x: 0, y: 0, z: 0 }, // GLB has no real-world mm; viewer computes client-side
    previewUrl: null,
  };
}

/** Full engine catalog with availability, given the current input. */
export function engineCatalog(): EngineDescriptor[] {
  const engines: EngineDescriptor[] = [];

  if (config.falKey) {
    for (const model of config.falMeshModels) {
      engines.push({
        id: `fal:${model}`,
        label: `fal · ${shortName(model)}`,
        kind: "neural",
        needsImage: true,
        available: true,
        run: async (ctx, onStatus, signal) => {
          const r = await runFalModel(model, { imagePath: ctx.imagePaths[0], prompt: ctx.prompt }, onStatus, signal);
          return neuralCandidate(`fal:${model}`, r.providerLabel, r.meshPath, r.format);
        },
      });
    }
  }

  if (config.replicateApiToken) {
    engines.push({
      id: "replicate",
      label: `Replicate · ${shortName(config.replicateMeshModel)}`,
      kind: "neural",
      needsImage: true,
      available: true,
      run: async (ctx, onStatus, signal) => {
        const r = await runReplicate({ imagePath: ctx.imagePaths[0], prompt: ctx.prompt }, onStatus, signal);
        return neuralCandidate("replicate", r.providerLabel, r.meshPath, r.format);
      },
    });
  }

  for (const space of knownHfSpaces()) {
    engines.push({
      id: `hf:${space}`,
      label: `HF · ${shortName(space)}`,
      kind: "neural",
      needsImage: true,
      available: true, // keyless
      run: async (ctx, onStatus, signal) => {
        const r = await runHfSpace(space, { imagePath: ctx.imagePaths[0], prompt: ctx.prompt }, onStatus, signal);
        return neuralCandidate(`hf:${space}`, r.providerLabel, r.meshPath, r.format);
      },
    });
  }

  return engines;
}

/**
 * Resolve which engines to actually run: the requested ids (or all available),
 * filtered to those that can run with the given input.
 */
export function resolveEngines(requested: string[] | undefined, hasImage: boolean, hasPrompt: boolean): EngineDescriptor[] {
  const catalog = engineCatalog();
  const wanted = requested && requested.length > 0 ? catalog.filter((e) => requested.includes(e.id)) : catalog;
  return wanted.filter((e) => {
    if (e.needsImage && !hasImage) return false;
    return true;
  });
}

/**
 * Run the given engines concurrently, invoking callbacks as each settles.
 * Never rejects — each engine's failure is reported via onFailed.
 */
export async function runEngines(
  engines: EngineDescriptor[],
  ctx: EngineContext,
  signal: AbortSignal,
  cb: {
    onStatus: (engineId: string, msg: string) => void;
    onReady: (c: Candidate) => void;
    onFailed: (engineId: string, error: string) => void;
  },
): Promise<void> {
  await Promise.all(
    engines.map(async (e) => {
      try {
        const c = await e.run(ctx, (m) => cb.onStatus(e.id, m), signal);
        if (!signal.aborted) cb.onReady(c);
      } catch (err) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[engine ${e.id}] failed: ${msg}`);
        cb.onFailed(e.id, msg);
      }
    }),
  );
}
