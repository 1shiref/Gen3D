import { callAI } from "./ai-provider";

// ─── AI edit planner ──────────────────────────────────────────
// Maps a natural-language goal to an ordered list of mesh-edit feature calls,
// using ONLY the feature catalog the client supplies (the frontend registry is
// the single source of truth). Returns strict JSON the user can review and run.

export interface PlanFeatureSpec {
  id: string;
  label: string;
  description: string;
  params: { key: string; type: string; default: unknown; options?: string[] }[];
}

export interface PlanEditContext {
  dims?: { x: number; y: number; z: number };
  bed?: { w: number; d: number; h: number };
  source?: string;
}

export interface PlanStep {
  feature: string;
  params: Record<string, unknown>;
  label?: string;
  reason?: string;
}

function plannerSystemPrompt(features: PlanFeatureSpec[]): string {
  const catalog = features
    .map((f) => {
      const params = f.params
        .map((p) => `${p.key}:${p.type}${p.options ? `(${p.options.join("|")})` : ""}=${JSON.stringify(p.default)}`)
        .join(", ");
      return `- ${f.id}: ${f.description} [params: ${params || "none"}]`;
    })
    .join("\n");

  return [
    "You are a 3D-print preparation planner. The user describes what they want done to a model.",
    "Produce an ORDERED plan of edit steps using ONLY the features below. Choose sensible parameter",
    "values from the model dimensions and printer build volume given by the user.",
    "",
    "Available features:",
    catalog,
    "",
    "Rules:",
    "- Use only the feature ids listed above. Omit a step if no feature fits.",
    "- Order matters: e.g. lay flat / orient BEFORE splitting; resize BEFORE splitting.",
    "- For 'too big for the printer', prefer split_parts along the longest over-bed axis, or resize to fit.",
    "- Keep the plan minimal — only the steps needed to satisfy the request.",
    "- Respond with STRICT JSON only, no prose, no code fences:",
    '{"steps":[{"feature":"<id>","params":{...},"label":"short label","reason":"why"}]}',
  ].join("\n");
}

function plannerUserPrompt(goal: string, ctx: PlanEditContext): string {
  const lines = [`Request: ${goal}`];
  if (ctx.dims) lines.push(`Model size: ${ctx.dims.x}×${ctx.dims.y}×${ctx.dims.z} mm (X×Y×Z, Y is up).`);
  if (ctx.bed) lines.push(`Printer build volume: ${ctx.bed.w}×${ctx.bed.d}×${ctx.bed.h} mm (W×D×H).`);
  if (ctx.source) lines.push(`Model source: ${ctx.source}.`);
  lines.push("Return the JSON plan now.");
  return lines.join("\n");
}

function parsePlan(raw: string, features: PlanFeatureSpec[]): PlanStep[] {
  // Tolerate code fences / stray prose around the JSON object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Planner did not return JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { steps?: PlanStep[] };
  const known = new Set(features.map((f) => f.id));
  const steps = (parsed.steps ?? [])
    .filter((s) => s && typeof s.feature === "string" && known.has(s.feature))
    .map((s) => ({
      feature: s.feature,
      params: (s.params && typeof s.params === "object") ? s.params : {},
      label: typeof s.label === "string" ? s.label : undefined,
      reason: typeof s.reason === "string" ? s.reason : undefined,
    }));
  return steps;
}

export async function planEdits(
  goal: string,
  context: PlanEditContext,
  features: PlanFeatureSpec[],
): Promise<PlanStep[]> {
  const raw = await callAI(plannerSystemPrompt(features), plannerUserPrompt(goal, context));
  return parsePlan(raw, features);
}

// ─── Prompt enhancement ───────────────────────────────────────
// Rewrites a user's short description into a richer single-object prompt that
// produces a better reference image (and therefore a better image→3D mesh).

const ENHANCE_SYSTEM_PROMPT = [
  "You rewrite short user descriptions into vivid, concrete prompts for an image",
  "generator whose output is fed into an image→3D mesh pipeline for 3D printing.",
  "",
  "Rewrite the user's text into a SINGLE, clear description of ONE physical object:",
  "- Describe one isolated object centered on a plain background — no scenes, people, or text.",
  "- Add concrete shape, proportions, material, and surface detail that stay true to the intent.",
  "- Keep it physically plausible and printable (a solid, self-supporting object).",
  "- Be concise: one or two sentences, no lists.",
  "",
  "Return ONLY the rewritten description — no preamble, quotes, or commentary.",
].join("\n");

/** Rewrite a prompt to be richer/clearer for image→3D generation. Falls back to the input. */
export async function enhancePrompt(raw: string): Promise<string> {
  const input = raw.trim();
  if (!input) return input;
  const result = (await callAI(ENHANCE_SYSTEM_PROMPT, input)).trim();
  return result || input;
}
