import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Sparkles, Loader2, Trash2, ChevronUp, ChevronDown, ChevronRight,
  Play, Check, X, Settings2, HelpCircle,
} from "lucide-react";
import { smartPlan, type SmartQuestion } from "@/lib/api";
import {
  actionCatalogForAI, coerceActionParams, actionExists, actionLabel, paramsForAction,
} from "@/lib/smart-plan/actions";
import { useGenerationStore } from "@/stores/generationStore";
import { useViewerStore } from "@/stores/viewerStore";
import { useExportStore } from "@/stores/exportStore";
import { useSelectedPrinter, useAllPrinters } from "@/stores/printerStore";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useSmartPlanRunner } from "@/hooks/useSmartPlanRunner";
import { useToast } from "@/hooks/useToast";
import type { FeatureParams } from "@/lib/mesh-edit/features";
import ParamFields from "./Tools/ParamFields";
import Text3DOptions from "@/components/InputPanel/Text3DOptions";

type StepStatus = "idle" | "running" | "done" | "error";

interface StepUI {
  id: string;
  action: string;
  params: FeatureParams;
  label: string;
  reason?: string;
  status: StepStatus;
  open: boolean;
}
interface PartUI {
  id: string;
  name: string;
  open: boolean;
  steps: StepUI[];
}

interface AnswerState { value: string; other: string }
const OTHER = "__other__";

const SUGGESTIONS = [
  "Generate a cat, fit it to my printer, export STL + G-code at 50% infill",
  "Make it 120 mm tall and add a 5 mm mounting hole through the base",
  "It's too big for my printer — split it to fit and add alignment pins",
];

export default function SmartPlan() {
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [parts, setParts] = useState<PartUI[]>([]);
  const [questions, setQuestions] = useState<SmartQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [round, setRound] = useState(0);

  const bounds = useViewerStore((s) => s.modelBounds);
  const printer = useSelectedPrinter();
  const allPrinters = useAllPrinters();
  const busy = useMeshEditStore((s) => s.busy);
  const { runStep } = useSmartPlanRunner();
  const { toast } = useToast();

  const buildContext = () => {
    const gen = useGenerationStore.getState();
    const ex = useExportStore.getState();
    return {
      prompt: gen.prompt || undefined,
      hasModel: Boolean(gen.stlUrl),
      dims: bounds ? { x: round1(bounds.x), y: round1(bounds.y), z: round1(bounds.z) } : undefined,
      bed: { w: printer.bedWidth, d: printer.bedDepth, h: printer.bedHeight },
      printers: allPrinters.map((p) => ({ id: p.id, name: p.name })),
      slicer: {
        infillDensity: ex.slicerSettings.infillDensity,
        layerHeight: ex.slicerSettings.layerHeight,
        material: ex.slicerSettings.material,
      },
      source: gen.modelSource ?? undefined,
    };
  };

  const callPlanner = async (
    answersArr: { id: string; question: string; answer: string }[],
    nextRound: number,
  ) => {
    if (!goal.trim() || planning) return;
    setPlanning(true);
    try {
      const result = await smartPlan({
        goal: goal.trim(),
        context: buildContext(),
        actions: actionCatalogForAI(),
        answers: answersArr,
        round: nextRound,
      });

      if (result.type === "questions") {
        setQuestions(result.questions);
        setParts([]);
        const init: Record<string, AnswerState> = {};
        for (const q of result.questions) {
          const rec = q.choices.find((c) => c.recommended) ?? q.choices[0];
          init[q.id] = { value: rec?.value ?? "", other: "" };
        }
        setAnswers(init);
        setRound(nextRound);
        return;
      }

      setQuestions(null);
      setAnswers({});
      const mapped: PartUI[] = result.parts.map((p) => ({
        id: uuidv4(),
        name: p.name,
        open: true,
        steps: p.steps
          .filter((s) => actionExists(s.action))
          .map((s) => ({
            id: uuidv4(),
            action: s.action,
            params: coerceActionParams(s.action, s.params as FeatureParams),
            label: s.label || actionLabel(s.action),
            reason: s.reason,
            status: "idle" as StepStatus,
            open: false,
          })),
      })).filter((p) => p.steps.length > 0);
      setParts(mapped);
      if (mapped.length === 0) toast({ title: "No steps proposed", description: "Try rephrasing the goal." });
    } catch (err) {
      toast({ title: "Planning failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPlanning(false);
    }
  };

  const start = () => { setRound(0); callPlanner([], 0); };

  const submitAnswers = () => {
    if (!questions) return;
    const arr = questions.map((q) => {
      const a = answers[q.id];
      const answer = a?.value === OTHER
        ? (a.other ?? "").trim()
        : (q.choices.find((c) => c.value === a?.value)?.label ?? a?.value ?? "");
      return { id: q.id, question: q.question, answer };
    });
    callPlanner(arr, round + 1);
  };

  const answersComplete = !questions || questions.every((q) => {
    const a = answers[q.id];
    if (!a || !a.value) return false;
    return a.value !== OTHER || a.other.trim().length > 0;
  });

  // ── plan editing ──
  const patchStep = (partId: string, stepId: string, patch: Partial<StepUI>) =>
    setParts((cur) => cur.map((p) => p.id === partId
      ? { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : p));
  const setParam = (partId: string, stepId: string, key: string, v: FeatureParams[string]) =>
    setParts((cur) => cur.map((p) => p.id === partId
      ? { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, params: { ...s.params, [key]: v } } : s)) } : p));
  const removeStep = (partId: string, stepId: string) =>
    setParts((cur) => cur
      .map((p) => (p.id === partId ? { ...p, steps: p.steps.filter((s) => s.id !== stepId) } : p))
      .filter((p) => p.steps.length > 0));
  const moveStep = (partId: string, i: number, dir: -1 | 1) =>
    setParts((cur) => cur.map((p) => {
      if (p.id !== partId) return p;
      const j = i + dir;
      if (j < 0 || j >= p.steps.length) return p;
      const steps = [...p.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...p, steps };
    }));

  // ── execution ──
  const executePart = async (part: PartUI): Promise<boolean> => {
    for (const step of part.steps) {
      patchStep(part.id, step.id, { status: "running" });
      try {
        await runStep(step.action, step.params);
        patchStep(part.id, step.id, { status: "done" });
      } catch (err) {
        patchStep(part.id, step.id, { status: "error" });
        toast({ title: `Step "${step.label}" failed`, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        return false;
      }
    }
    return true;
  };

  const runPart = async (part: PartUI) => {
    if (running || busy) return;
    setRunning(true);
    setParts((cur) => cur.map((p) => (p.id === part.id
      ? { ...p, steps: p.steps.map((s) => ({ ...s, status: "idle" as StepStatus })) } : p)));
    try {
      const ok = await executePart(part);
      if (ok) toast({ title: `"${part.name}" finished` });
    } finally {
      setRunning(false);
    }
  };

  const runAll = async () => {
    if (running || busy || parts.length === 0) return;
    setRunning(true);
    setParts((cur) => cur.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s, status: "idle" as StepStatus })) })));
    try {
      for (const part of parts) {
        const ok = await executePart(part);
        if (!ok) return;
      }
      toast({ title: "Plan finished" });
    } finally {
      setRunning(false);
    }
  };

  const totalSteps = parts.reduce((n, p) => n + p.steps.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Describe a goal — the AI builds a step-by-step plan (generate · fit · edit · slice · export) from the
          actions this app actually has. Review, tweak, then run each part or all of it.
        </p>

        {!questions && parts.length === 0 && (
          <div className="space-y-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setGoal(s)}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded px-2 py-1.5 transition-colors"
              >
                "{s}"
              </button>
            ))}
          </div>
        )}

        {/* Clarification questions */}
        {questions && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <HelpCircle className="w-3.5 h-3.5 text-primary" /> A few questions first
            </div>
            {questions.map((q) => {
              const a = answers[q.id] ?? { value: "", other: "" };
              return (
                <div key={q.id} className="rounded border border-border p-2 space-y-1.5">
                  <p className="text-xs font-medium">{q.question}</p>
                  <div className="space-y-1">
                    {q.choices.map((c) => (
                      <label key={c.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={q.id}
                          checked={a.value === c.value}
                          onChange={() => setAnswers((cur) => ({ ...cur, [q.id]: { ...a, value: c.value } }))}
                          className="accent-primary"
                        />
                        <span>{c.label}</span>
                        {c.recommended && (
                          <span className="text-[9px] uppercase tracking-wide text-primary border border-primary/40 rounded px-1">Recommended</span>
                        )}
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name={q.id}
                        checked={a.value === OTHER}
                        onChange={() => setAnswers((cur) => ({ ...cur, [q.id]: { ...a, value: OTHER } }))}
                        className="accent-primary"
                      />
                      <span className="text-muted-foreground">Other…</span>
                    </label>
                    {a.value === OTHER && (
                      <input
                        type="text"
                        autoFocus
                        value={a.other}
                        onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: { ...a, value: OTHER, other: e.target.value } }))}
                        placeholder="Type your answer…"
                        className="w-full text-xs rounded border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <button
              onClick={submitAnswers}
              disabled={planning || !answersComplete}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Continue
            </button>
          </div>
        )}

        {/* Plan parts */}
        {!questions && parts.length > 0 && (
          <div className="space-y-2">
            {parts.map((part, pi) => (
              <div key={part.id} className="rounded border border-border">
                <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/40">
                  <button
                    onClick={() => setParts((cur) => cur.map((p) => (p.id === part.id ? { ...p, open: !p.open } : p)))}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  >
                    {part.open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <span className="text-[11px] text-muted-foreground/60 w-4">{pi + 1}.</span>
                  <span className="flex-1 min-w-0 text-xs font-semibold truncate">{part.name}</span>
                  <button
                    onClick={() => runPart(part)}
                    disabled={running || busy}
                    title="Run this part"
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] hover:bg-primary/20 disabled:opacity-40"
                  >
                    <Play className="w-3 h-3" /> Run
                  </button>
                </div>

                {part.open && (
                  <div className="p-1.5 space-y-1.5">
                    {part.steps.map((s, i) => (
                      <div key={s.id} className="rounded border border-border">
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <StatusDot status={s.status} />
                          <span className="flex-1 min-w-0 text-xs font-medium truncate" title={s.reason}>{s.label}</span>
                          <button onClick={() => patchStep(part.id, s.id, { open: !s.open })} title="Edit settings" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent">
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => moveStep(part.id, i, -1)} disabled={i === 0} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30">
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => moveStep(part.id, i, 1)} disabled={i === part.steps.length - 1} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removeStep(part.id, s.id)} className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {s.open && (
                          <div className="px-2.5 pb-2.5 pt-1 border-t border-border space-y-1.5">
                            {s.reason && <p className="text-[10px] text-muted-foreground italic">{s.reason}</p>}
                            <ParamFields
                              params={paramsForAction(s.action)}
                              values={s.params}
                              onChange={(k, v) => setParam(part.id, s.id, k, v)}
                            />
                            {s.action === "generate_model" && <Text3DOptions />}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={runAll}
              disabled={running || busy}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run all ({totalSteps})
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-1">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
            placeholder="Describe what you want… (e.g. generate a cat and export G-code at 50% infill)"
            rows={2}
            className="flex-1 text-xs rounded border border-input bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={start}
            disabled={!goal.trim() || planning}
            title="Build plan"
            className="self-end p-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />;
  if (status === "done") return <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === "error") return <X className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mx-[3px]" />;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
