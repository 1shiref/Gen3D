import path from "path";
import fs from "fs";
import { getOverride } from "./services/model-overrides";
import { getRuntimeApiKey, getRuntimeAgentRouterUseCLI, type ApiKeyProvider } from "./services/runtime-settings";

// Load .env from backend directory
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

export type AIProvider = "anthropic" | "ollama" | "groq" | "openrouter" | "agentrouter";

export const config = {
  // ── AI Provider ──────────────────────────────────────────────
  aiProvider: (process.env.AI_PROVIDER ?? "agentrouter") as AIProvider,

  // Anthropic (paid direct)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",

  // AgentRouter (Anthropic-API gateway → Claude). Default model per AgentRouter docs.
  agentrouterApiKey: process.env.AGENTROUTER_API_KEY ?? "",
  agentrouterModel: process.env.AGENTROUTER_MODEL ?? "claude-sonnet-4-5-20250929",
  agentrouterVisionModel: process.env.AGENTROUTER_VISION_MODEL ?? "claude-sonnet-4-5-20250929",
  // When true, route AgentRouter requests through a `claude` CLI subprocess so
  // they bypass AgentRouter's non-CLI client block. Requires `npm i -g @anthropic-ai/claude-code`.
  agentrouterUseCLI: (process.env.AGENTROUTER_USE_CLI ?? "false").toLowerCase() === "true",

  // OpenRouter — Claude tier (paid models)
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterClaudeModel: process.env.OPENROUTER_CLAUDE_MODEL ?? "anthropic/claude-sonnet-4-5",
  openrouterClaudeVisionModel: process.env.OPENROUTER_CLAUDE_VISION_MODEL ?? "anthropic/claude-sonnet-4-5",

  // OpenRouter — free tier
  openrouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b:free",
  openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL ?? "nvidia/nemotron-nano-12b-v2-vl:free",

  // Groq (FREE tier — fast, generous limits)
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  groqVisionModel: process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",

  // Ollama (FREE — runs locally, no API key needed)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5-coder",
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL ?? "llava",

  // ── Generation quality ───────────────────────────────────────
  // Max output tokens per AI call. 8192 gives the mesh-edit planner ample room.
  maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? "8192", 10),
  // Extended-thinking budget (tokens) for the direct Anthropic provider. 0 disables.
  // Must be < maxTokens. Improves mesh-edit planning reasoning.
  thinkingBudget: parseInt(process.env.AI_THINKING_BUDGET ?? "2048", 10),
  // When false (default), the provider chain stops at Claude-quality models and never
  // silently falls through to weak models (OpenRouter-free / Groq / Ollama) that produce
  // poorer edit plans. Set true to allow them as last-resort fallbacks.
  allowWeakModels: (process.env.ALLOW_WEAK_MODELS ?? "false").toLowerCase() === "true",

  // ── Neural 3D mesh generation (Phase C) ──────────────────────
  // Order to try mesh providers in (first that succeeds wins). fal first = reliable.
  meshProviderOrder: (process.env.MESH_PROVIDER_ORDER ?? "fal,replicate,hf")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Keyless backup: public Hugging Face Spaces (image → GLB), tried in order. Only
  // Spaces with a known recipe in mesh-provider.ts (HF_RECIPES) are supported.
  hfToken: process.env.HF_TOKEN ?? "",
  // Free HF Spaces (image → 3D), each becomes its own candidate engine. Only Spaces with
  // a recipe in mesh-provider.ts HF_RECIPES are used. Hunyuan3D-2 is the sole supported Space.
  meshHfSpaces: (process.env.MESH_HF_SPACES ?? "tencent/Hunyuan3D-2")
    .split(",").map((s) => s.trim()).filter(Boolean),
  // Per-Space timeout (ms). ZeroGPU Spaces can stall on cold-start/queue — when one
  // exceeds this, fall through to the next Space (ultimately the reliable Shap-E).
  meshHfTimeoutMs: parseInt(process.env.MESH_HF_TIMEOUT_MS ?? "120000", 10),
  // Paid-ready tier — only used when a key is present.
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",
  replicateMeshModel: process.env.REPLICATE_MESH_MODEL ?? "ndreca/hunyuan3d-2",
  falKey: process.env.FAL_KEY ?? "",
  falMeshModel: process.env.FAL_MESH_MODEL ?? "fal-ai/hunyuan3d/v2",
  // Text → reference image, used to keep text-only generation working (neural mesh
  // engines all need an image). fal primary; a keyless HF Space is the fallback.
  falTextToImageModel: process.env.FAL_TEXT_TO_IMAGE_MODEL ?? "fal-ai/flux/schnell",
  hfTextToImageSpace: process.env.HF_TEXT_TO_IMAGE_SPACE ?? "black-forest-labs/FLUX.1-schnell",
  // Background removal on the generated reference image (→ transparent cutout, best input for
  // image→3D). fal primary; a keyless HF Space is the fallback. Best-effort — see removeBackground.
  falRembgModel: process.env.FAL_REMBG_MODEL ?? "fal-ai/imageutils/rembg",
  hfRembgSpace: process.env.HF_REMBG_SPACE ?? "briaai/BRIA-RMBG-2.0",
  // Instruction-based image editing — "keep the photo, change only what the prompt says".
  // Used by the uploaded-image "Reimagine" flow. fal FLUX Kontext primary; keyless HF
  // InstructPix2Pix fallback. NOT a from-scratch generator. (Alt fal slug: fal-ai/flux-kontext/dev.)
  falImageEditModel: process.env.FAL_IMAGE_EDIT_MODEL ?? "fal-ai/flux-pro/kontext",
  hfImageEditSpace: process.env.HF_IMAGE_EDIT_SPACE ?? "timbrooks/instruct-pix2pix",
  // Upscale / sharpen for the uploaded-image "Enhance" flow. Best-effort — see upscaleImage.
  falUpscaleModel: process.env.FAL_UPSCALE_MODEL ?? "fal-ai/esrgan",
  hfUpscaleSpace: process.env.HF_UPSCALE_SPACE ?? "",
  // Multi-candidate generation: each fal model below becomes its own engine/candidate.
  // Newer image-to-3D models added here surface as extra candidates; an unknown slug
  // simply fails its own candidate without affecting the others. Env-overridable.
  falMeshModels: (process.env.FAL_MESH_MODELS ?? "fal-ai/hunyuan3d/v2")
    .split(",").map((s) => s.trim()).filter(Boolean),

  // ── Other ────────────────────────────────────────────────────
  port: parseInt(process.env.PORT ?? "3001", 10),
  slicerPath: process.env.SLICER_PATH ?? "",
  uploadMaxAgeMs: parseInt(process.env.UPLOAD_MAX_AGE_MS ?? "600000", 10),
  uploadsDir: path.resolve(__dirname, "../uploads"),
};

// ── FallbackEntry — one slot in the priority chain ────────────

export interface FallbackEntry {
  id: string;
  provider: AIProvider;
  model: string;
  visionModel: string;
  label: string;
  isClaudeModel: boolean;
}

// ── In-session billing failure cache ──────────────────────────

const billingFailedIds = new Set<string>();
export function markBillingFailed(id: string): void { billingFailedIds.add(id); }
export function isBillingFailed(id: string): boolean { return billingFailedIds.has(id); }
export function getBillingFailedIds(): string[] { return [...billingFailedIds]; }
export function clearBillingFailed(id: string): boolean { return billingFailedIds.delete(id); }
export function clearAllBillingFailed(): void { billingFailedIds.clear(); }

// ── Provider readiness check ───────────────────────────────────

function isKeyValid(key: string): boolean {
  return key.length > 10 && !key.includes("your_") && !key.includes("_here");
}

/**
 * Returns the effective API key for a provider: runtime override (from UI/runtime-settings.json)
 * takes priority over the .env-loaded default. Returns "" if neither is set.
 */
export function getEffectiveApiKey(provider: AIProvider): string {
  if (provider === "ollama") return "";
  const map: Record<Exclude<AIProvider, "ollama">, ApiKeyProvider> = {
    anthropic: "anthropic",
    agentrouter: "agentrouter",
    openrouter: "openrouter",
    groq: "groq",
  };
  const runtime = getRuntimeApiKey(map[provider]);
  if (runtime) return runtime;
  switch (provider) {
    case "anthropic":   return config.anthropicApiKey;
    case "agentrouter": return config.agentrouterApiKey;
    case "groq":        return config.groqApiKey;
    case "openrouter":  return config.openrouterApiKey;
  }
}

/**
 * Returns the effective AgentRouter CLI-mode flag: runtime UI toggle takes priority
 * over the AGENTROUTER_USE_CLI .env flag.
 */
export function getEffectiveAgentRouterUseCLI(): boolean {
  const runtime = getRuntimeAgentRouterUseCLI();
  if (runtime !== undefined) return runtime;
  return config.agentrouterUseCLI;
}

export function isProviderReady(provider: AIProvider): boolean {
  if (provider === "ollama") return true;
  return isKeyValid(getEffectiveApiKey(provider));
}

// ── 6-tier priority chain ──────────────────────────────────────

// Helper: applies any runtime override from runtime-models.json over the env defaults.
function pushEntry(chain: FallbackEntry[], entry: FallbackEntry): void {
  const override = getOverride(entry.id);
  if (override?.model) entry.model = override.model;
  if (override?.visionModel) entry.visionModel = override.visionModel;
  chain.push(entry);
}

export function getProviderFallbackOrder(): FallbackEntry[] {
  const chain: FallbackEntry[] = [];

  // Tier 1: Anthropic direct
  if (isProviderReady("anthropic")) {
    pushEntry(chain, {
      id: "anthropic",
      provider: "anthropic",
      model: config.anthropicModel,
      visionModel: config.anthropicModel,
      label: "Anthropic (direct)",
      isClaudeModel: true,
    });
  }

  // Tier 2: OpenRouter → Claude (paid)
  if (isProviderReady("openrouter") && config.openrouterClaudeModel) {
    pushEntry(chain, {
      id: "openrouter-claude",
      provider: "openrouter",
      model: config.openrouterClaudeModel,
      visionModel: config.openrouterClaudeVisionModel,
      label: "OpenRouter → Claude",
      isClaudeModel: true,
    });
  }

  // Tier 3: AgentRouter → Claude
  if (isProviderReady("agentrouter")) {
    pushEntry(chain, {
      id: "agentrouter-claude",
      provider: "agentrouter",
      model: config.agentrouterModel,
      visionModel: config.agentrouterVisionModel,
      label: getEffectiveAgentRouterUseCLI() ? "AgentRouter → Claude (CLI)" : "AgentRouter → Claude",
      isClaudeModel: true,
    });
  }

  // Tiers 4–6 are weak (non-Claude) models that produce poorer edit plans. By default
  // they are EXCLUDED so the app never silently degrades quality. Opt in with
  // ALLOW_WEAK_MODELS=true. They are also included as a safety net when NO
  // Claude-quality provider is configured (otherwise the app would have no models).
  const hasClaude = chain.length > 0;
  if (config.allowWeakModels || !hasClaude) {
    // Tier 4: OpenRouter → free models
    if (isProviderReady("openrouter")) {
      pushEntry(chain, {
        id: "openrouter-free",
        provider: "openrouter",
        model: config.openrouterModel,
        visionModel: config.openrouterVisionModel,
        label: "OpenRouter (free)",
        isClaudeModel: false,
      });
    }

    // Tier 5: Groq
    if (isProviderReady("groq")) {
      pushEntry(chain, {
        id: "groq",
        provider: "groq",
        model: config.groqModel,
        visionModel: config.groqVisionModel,
        label: "Groq (free)",
        isClaudeModel: false,
      });
    }

    // Tier 6: Ollama (always last)
    pushEntry(chain, {
      id: "ollama",
      provider: "ollama",
      model: config.ollamaModel,
      visionModel: config.ollamaVisionModel,
      label: "Ollama (local)",
      isClaudeModel: false,
    });
  }

  return chain;
}

// Kept for backwards-compat — returns model for the currently configured provider.
export function getActiveModel(hasImages: boolean): string {
  return getModelForProvider(config.aiProvider, hasImages);
}

export function getModelForProvider(provider: AIProvider, hasImages: boolean): string {
  switch (provider) {
    case "anthropic":   return config.anthropicModel;
    case "agentrouter": return hasImages ? config.agentrouterVisionModel : config.agentrouterModel;
    case "groq":        return hasImages ? config.groqVisionModel : config.groqModel;
    case "openrouter":  return hasImages ? config.openrouterVisionModel : config.openrouterModel;
    case "ollama":      return hasImages ? config.ollamaVisionModel : config.ollamaModel;
  }
}

export function validateConfig(): void {
  const chain = getProviderFallbackOrder();
  if (chain.length === 0) {
    console.error("ERROR: No AI providers configured. Set at least one in backend/.env");
    process.exit(1);
  }
  const claudeEntries = chain.filter((e) => e.isClaudeModel);
  const firstEntry = chain[0];
  console.log(`[AI] Priority chain (${chain.length} entries): ${chain.map((e) => e.label).join(" → ")}`);
  if (claudeEntries.length > 0) {
    console.log(`[AI] Claude-quality models available: ${claudeEntries.map((e) => e.label).join(", ")}`);
  } else {
    console.warn("[AI] WARNING: No Claude-quality providers configured — output quality will be limited");
  }
  console.log(`[AI] Will start with: ${firstEntry.label} (${firstEntry.model})`);
}
