import { callAI } from "./ai-provider";

// ─── Master Smart-plan planner ────────────────────────────────
// Maps a natural-language goal to a full-workflow plan (generate → fit → edit →
// slice → export) grouped into AI-named parts, using ONLY the action catalog the
// client supplies (the frontend registry is the single source of truth). When the
// goal is ambiguous or off-topic it returns clarification questions instead of a
// plan. Plain JSON the user can review, edit, and run part-by-part.

export interface SmartActionSpec {
  id: string;
  phase: string;
  label: string;
  description: string;
  params: { key: string; type: string; default: unknown; options?: string[] }[];
}

export interface SmartPlanContext {
  prompt?: string;
  hasModel?: boolean;
  dims?: { x: number; y: number; z: number };
  bed?: { w: number; d: number; h: number };
  printers?: { id: string; name: string }[];
  slicer?: { infillDensity?: number; layerHeight?: number; material?: string };
  source?: string;
}

export interface SmartAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface SmartStep {
  action: string;
  params: Record<string, unknown>;
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

/** Max clarification rounds before the planner must commit to a best-effort plan. */
const MAX_ROUNDS = 2;

function systemPrompt(actions: SmartActionSpec[]): string {
  const byPhase = new Map<string, SmartActionSpec[]>();
  for (const a of actions) {
    const list = byPhase.get(a.phase) ?? [];
    list.push(a);
    byPhase.set(a.phase, list);
  }
  const order = ["generate", "fit", "edit", "slice", "export"];
  const phases = [...byPhase.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const catalog = phases
    .map((phase) => {
      const lines = (byPhase.get(phase) ?? [])
        .map((a) => {
          const params = a.params
            .map((p) => `${p.key}:${p.type}${p.options ? `(${p.options.join("|")})` : ""}=${JSON.stringify(p.default)}`)
            .join(", ");
          return `  - ${a.id}: ${a.description} [params: ${params || "none"}]`;
        })
        .join("\n");
      return `[${phase}]\n${lines}`;
    })
    .join("\n");

  return [
    "You are the master planner for a 3D-print preparation app. The user describes a goal; you",
    "produce a plan that drives the app from start to finish, using ONLY the actions below.",
    "",
    "Available actions (grouped by workflow phase):",
    catalog,
    "",
    "You ALWAYS return STRICT JSON only — no prose, no code fences. Return ONE of two shapes:",
    "",
    "1) A clarification request, when the goal is ambiguous (e.g. no target size / infill / printer",
    "   given and it matters) OR off-topic (not about preparing a 3D model for printing). For an",
    "   off-topic request, politely state the app only prepares 3D models for printing and offer",
    "   on-topic choices that steer the user back. Shape:",
    '   {"type":"questions","questions":[{"id":"size","question":"...","choices":[{"label":"...","value":"...","recommended":true},{"label":"...","value":"..."}]}]}',
    "   Rules for questions: at most 5 questions; each has 2–3 choices; mark exactly ONE choice",
    "   per question with \"recommended\":true (the best default for the user). Do NOT add an 'Other'",
    "   choice — the app adds a free-text option itself.",
    "",
    "2) A ready plan, grouped into named parts. Shape:",
    '   {"type":"plan","parts":[{"name":"Generate the cat","steps":[{"action":"<id>","params":{...},"label":"short label","reason":"why"}]}]}',
    "",
    "Planning rules:",
    "- Use only the action ids listed above. Never invent actions or params.",
    "- Respect global order: generate → fit → edit → slice → export. Put each step in a sensible part.",
    "- Choose concrete param values from the model dimensions, printer build volume, and slicer",
    "  settings provided. 'Fit to real dimensions' = the resize action; 'too big for the printer' =",
    "  fit_to_bed (or split_parts).",
    "- To generate from a text idea: set_prompt → (optionally) enhance_prompt → generate_model.",
    "- Keep the plan minimal — only the steps needed to satisfy the request.",
    `- After ${MAX_ROUNDS} clarification rounds you MUST return a best-effort plan, not more questions.`,
  ].join("\n");
}

function userPrompt(goal: string, ctx: SmartPlanContext, answers: SmartAnswer[], round: number): string {
  const lines = [`Goal: ${goal}`];
  lines.push(ctx.hasModel ? "A model is currently loaded." : "No model is loaded yet.");
  if (ctx.prompt) lines.push(`Current text prompt: ${ctx.prompt}`);
  if (ctx.dims) lines.push(`Model size: ${ctx.dims.x}×${ctx.dims.y}×${ctx.dims.z} mm (X×Y×Z, Y is up).`);
  if (ctx.bed) lines.push(`Selected printer build volume: ${ctx.bed.w}×${ctx.bed.d}×${ctx.bed.h} mm (W×D×H).`);
  if (ctx.printers?.length) lines.push(`Available printers: ${ctx.printers.map((p) => `${p.name} (id=${p.id})`).join(", ")}.`);
  if (ctx.slicer) {
    const s = ctx.slicer;
    lines.push(`Current slicer settings: infill=${s.infillDensity ?? "?"}%, layerHeight=${s.layerHeight ?? "?"}mm, material=${s.material ?? "?"}.`);
  }
  if (ctx.source) lines.push(`Model source: ${ctx.source}.`);
  if (answers.length) {
    lines.push("", "The user answered your earlier questions:");
    for (const a of answers) lines.push(`- ${a.question} → ${a.answer}`);
  }
  lines.push("", `Clarification round: ${round} (max ${MAX_ROUNDS}).`);
  lines.push("Return the JSON now.");
  return lines.join("\n");
}

function parseResult(raw: string, actions: SmartActionSpec[], round: number): SmartPlanResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Planner did not return JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    type?: string;
    questions?: unknown[];
    parts?: unknown[];
  };

  // Clarification questions — only honored before the round cap.
  if (parsed.type === "questions" && Array.isArray(parsed.questions) && round < MAX_ROUNDS) {
    const questions = (parsed.questions as Record<string, unknown>[])
      .slice(0, 5)
      .map((q, i) => {
        const rawChoices = Array.isArray(q.choices) ? (q.choices as Record<string, unknown>[]) : [];
        const choices: SmartQuestionChoice[] = rawChoices
          .slice(0, 3)
          .map((c) => ({
            label: String(c.label ?? c.value ?? ""),
            value: String(c.value ?? c.label ?? ""),
            recommended: c.recommended === true,
          }))
          .filter((c) => c.label || c.value);
        return {
          id: typeof q.id === "string" ? q.id : `q${i}`,
          question: typeof q.question === "string" ? q.question : "",
          choices,
        };
      })
      .filter((q) => q.question && q.choices.length > 0);
    if (questions.length > 0) return { type: "questions", questions };
    // else fall through to a (possibly empty) plan
  }

  const known = new Set(actions.map((a) => a.id));
  const partsRaw = Array.isArray(parsed.parts) ? (parsed.parts as Record<string, unknown>[]) : [];
  const parts: SmartPart[] = partsRaw
    .map((p) => ({
      name: typeof p.name === "string" ? p.name : "Steps",
      steps: (Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [])
        .filter((s) => s && typeof s.action === "string" && known.has(s.action as string))
        .map((s) => ({
          action: s.action as string,
          params: s.params && typeof s.params === "object" ? (s.params as Record<string, unknown>) : {},
          label: typeof s.label === "string" ? s.label : undefined,
          reason: typeof s.reason === "string" ? s.reason : undefined,
        })),
    }))
    .filter((p) => p.steps.length > 0);

  return { type: "plan", parts };
}

export async function planSmart(
  goal: string,
  context: SmartPlanContext,
  actions: SmartActionSpec[],
  answers: SmartAnswer[] = [],
  round = 0,
): Promise<SmartPlanResult> {
  const raw = await callAI(systemPrompt(actions), userPrompt(goal, context, answers, round));
  return parseResult(raw, actions, round);
}
