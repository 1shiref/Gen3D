import type { SlicerSettings } from "@/lib/slicer-profile";

const BASE = "/api";

export interface UploadResult {
  fileRefs: Array<{ ref: string; path: string; url: string; originalName: string }>;
}

/** Machine fields that affect the generated G-code (subset of PrinterProfile). */
export interface MachineSliceProfile {
  name?: string;
  bedWidth?: number;
  bedDepth?: number;
  bedHeight?: number;
  originAtCenter?: boolean;
  gcodeFlavor?: string;
  nozzleSize?: number;
  filamentDiameter?: number;
  coolingFanNumber?: number;
  startGcode?: string;
  endGcode?: string;
  // Printhead clearance (Cura head polygon) + gantry height.
  headXMin?: number;
  headYMin?: number;
  headXMax?: number;
  headYMax?: number;
  gantryHeight?: number;
}

export interface SliceRequest {
  stlPath: string;
  settings: Partial<SlicerSettings>;
  printerPreset: string;
  /** Active printer's machine settings, applied to the emitted G-code. */
  machine?: MachineSliceProfile;
  /** Per-axis scale to bake into the STL before slicing. Omit for [1,1,1]. */
  scale?: [number, number, number];
}

export interface SliceResponse {
  gcodeUrl: string;
  stats: {
    layerCount: number;
    estimatedTimeMinutes: number;
    filamentUsageMm: number;
    filamentUsageGrams: number;
  };
  /** Non-fatal issues (e.g. model larger than the build volume). */
  warnings?: string[];
  preview: string;
}

export interface ProviderChainEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  visionModel: string;
  isClaudeModel: boolean;
  status: "ready" | "billing-failed";
}

export interface HealthResponse {
  status: string;
  slicer: string;
  ai: {
    activeEntry: { id: string; label: string; model: string; isClaudeModel: boolean } | null;
    chain: ProviderChainEntry[];
    billingFailed: string[];
  };
  version: string;
  timestamp: string;
}

export async function uploadImages(files: File[]): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("images", f);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface UploadedModel {
  ref: string;
  url: string;
  originalName: string;
  extension: "stl" | "obj" | "glb" | "gltf";
  sizeBytes: number;
}

export async function uploadModel(file: File): Promise<UploadedModel> {
  const form = new FormData();
  form.append("model", file);
  const res = await fetch(`${BASE}/upload-model`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error ?? body); } catch { throw new Error(body); }
  }
  return res.json();
}

export async function* fetchGenerateStream(params: {
  files?: File[];
  /** Pre-uploaded image basenames (e.g. a confirmed text→photo cutout) to run the engines on. */
  imageRefs?: string[];
  prompt: string;
  /** Engine ids to run (empty/undefined = all available). */
  engines?: string[];
  forceProviderId?: string | null;
  printerPreset?: string;
  /** Actual build volume (mm) — lets the backend dimension-check honor custom printers. */
  bedSize?: { w: number; d: number; h: number };
}): AsyncGenerator<{ event: string; data: string }> {
  const form = new FormData();
  form.append("prompt", params.prompt);
  if (params.imageRefs && params.imageRefs.length) form.append("imageRefs", JSON.stringify(params.imageRefs));
  if (params.engines && params.engines.length) form.append("engines", JSON.stringify(params.engines));
  if (params.forceProviderId) form.append("forceProviderId", params.forceProviderId);
  if (params.printerPreset) form.append("printerPreset", params.printerPreset);
  if (params.bedSize) form.append("bedSize", JSON.stringify(params.bedSize));
  if (params.files) {
    for (const f of params.files) form.append("images", f);
  }

  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  if (!res.ok || !res.body) throw new Error("Generation request failed");

  yield* parseSSEStream(res.body);
}

/**
 * Phase A — text → reviewable photo. Streams `status` then `image_ready` ({ref,url}).
 * The `ref` is an uploads basename to pass back as `fetchGenerateStream({ imageRefs: [ref] })`.
 */
export async function* textToImageStream(params: {
  prompt: string;
}): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(`${BASE}/text-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: params.prompt }),
  });
  if (!res.ok || !res.body) throw new Error("Image request failed");

  yield* parseSSEStream(res.body);
}

/**
 * Refine an already-uploaded image (by ref) before 3D generation. Streams `status` then
 * `image_ready` ({ref,url}) — same shape as textToImageStream, so the result `ref` is an
 * uploads basename to pass back as `fetchGenerateStream({ imageRefs: [ref] })`.
 */
export async function* refineImageStream(params: {
  imageRef: string;
  mode: "enhance" | "reimagine";
  prompt?: string;
  ops?: { removeBg?: boolean; upscale?: boolean };
}): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(`${BASE}/refine-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.body) throw new Error("Image refine request failed");

  yield* parseSSEStream(res.body);
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = "message";
      let data = "";

      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        if (line.startsWith("data: ")) data = line.slice(6);
      }

      yield { event, data };
    }
  }
}

export async function sliceModel(req: SliceRequest): Promise<SliceResponse> {
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

// ─── Generation engines (multi-candidate) ─────────────────────

export interface EngineInfo {
  id: string;
  label: string;
  kind: "neural";
  needsImage: boolean;
  available: boolean;
}

export async function getEngines(): Promise<EngineInfo[]> {
  const res = await fetch(`${BASE}/engines`);
  if (!res.ok) throw new Error(`getEngines failed: ${res.status}`);
  const data = (await res.json()) as { engines: EngineInfo[] };
  return data.engines ?? [];
}

// ─── AI edit planner ──────────────────────────────────────────

export interface PlanStep {
  feature: string;
  params: Record<string, number | string | boolean>;
  label?: string;
  reason?: string;
}

export async function planEdits(params: {
  goal: string;
  context: { dims?: { x: number; y: number; z: number }; bed?: { w: number; d: number; h: number }; source?: string };
  features: unknown[];
}): Promise<PlanStep[]> {
  const res = await fetch(`${BASE}/plan-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error ?? body); } catch { throw new Error(body); }
  }
  const data = (await res.json()) as { steps: PlanStep[] };
  return data.steps ?? [];
}

// ─── Master Smart-plan planner ────────────────────────────────

export interface SmartStep {
  action: string;
  params: Record<string, number | string | boolean>;
  label?: string;
  reason?: string;
}
export interface SmartPart {
  name: string;
  steps: SmartStep[];
}
export interface SmartQuestionChoice {
  label: string;
  value: string;
  recommended?: boolean;
}
export interface SmartQuestion {
  id: string;
  question: string;
  choices: SmartQuestionChoice[];
}
export type SmartPlanResult =
  | { type: "plan"; parts: SmartPart[] }
  | { type: "questions"; questions: SmartQuestion[] };

export interface SmartPlanContext {
  prompt?: string;
  hasModel?: boolean;
  dims?: { x: number; y: number; z: number };
  bed?: { w: number; d: number; h: number };
  printers?: { id: string; name: string }[];
  slicer?: { infillDensity?: number; layerHeight?: number; material?: string };
  source?: string;
}

/** Plan a full workflow from a goal, or get clarification questions when ambiguous/off-topic. */
export async function smartPlan(params: {
  goal: string;
  context: SmartPlanContext;
  actions: unknown[];
  answers?: { id: string; question: string; answer: string }[];
  round?: number;
}): Promise<SmartPlanResult> {
  const res = await fetch(`${BASE}/smart-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error ?? body); } catch { throw new Error(body); }
  }
  return res.json();
}

// ─── Prompt enhancement ───────────────────────────────────────

/** Rewrite a text prompt into a richer single-object description for image→3D generation. */
export async function enhancePrompt(prompt: string): Promise<string> {
  const res = await fetch(`${BASE}/enhance-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).error ?? body); } catch { throw new Error(body); }
  }
  const data = (await res.json()) as { prompt: string };
  return data.prompt;
}

// ─── Model registry / overrides ──────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
}

export interface EntryModels {
  text: ModelOption[];
  vision: ModelOption[];
}

export type ModelRegistry = Record<string, EntryModels>;

export type ModelOverrides = Record<string, { model?: string; visionModel?: string }>;

export interface ModelsResponse {
  registry: ModelRegistry;
  overrides: ModelOverrides;
  chain: ProviderChainEntry[];
}

export async function getModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error(`getModels failed: ${res.status}`);
  return res.json();
}

export interface EntryTestResult {
  id: string;
  label: string;
  model: string;
  isClaudeModel: boolean;
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
  billingFailed: boolean;
}

export async function testEntry(entryId: string): Promise<EntryTestResult> {
  const res = await fetch(`${BASE}/test-entry/${encodeURIComponent(entryId)}`, { method: "POST" });
  // 200 on success, 502 on failure — both return a JSON body we want to surface.
  if (res.status !== 200 && res.status !== 502) {
    throw new Error(`testEntry failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function setEntryModels(
  entryId: string,
  patch: { model?: string | null; visionModel?: string | null }
): Promise<ModelsResponse> {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(entryId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`setEntryModels failed: ${res.status} ${err}`);
  }
  return res.json();
}

export function buildFileUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `${BASE}/files/${url}`;
}

// ─── Runtime settings (API keys + AgentRouter CLI mode) ────────────────────

export type ApiKeyProvider = "anthropic" | "agentrouter" | "openrouter" | "groq";

export interface ApiKeyStatus {
  present: boolean;
  masked: string | null;
  source: "runtime" | "env" | "none";
}

export interface SettingsSnapshot {
  apiKeys: Record<ApiKeyProvider, ApiKeyStatus>;
  agentrouter: {
    useCLI: boolean;
    useCLISource: "runtime" | "env";
  };
}

export interface ClaudeCliStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export async function getSettings(): Promise<SettingsSnapshot> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error(`getSettings failed: ${res.status}`);
  return res.json();
}

export async function setApiKey(
  provider: ApiKeyProvider,
  key: string | null,
): Promise<SettingsSnapshot> {
  const res = await fetch(`${BASE}/settings/api-key/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`setApiKey failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function setAgentRouterCLI(
  enabled: boolean | null,
): Promise<SettingsSnapshot> {
  const res = await fetch(`${BASE}/settings/agentrouter-cli`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    let msg = errBody;
    try {
      msg = JSON.parse(errBody).error ?? errBody;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  const res = await fetch(`${BASE}/settings/claude-cli-status`);
  if (!res.ok) throw new Error(`claude-cli-status failed: ${res.status}`);
  return res.json();
}
