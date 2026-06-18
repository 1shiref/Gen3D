import { Undo2, RotateCcw, Loader2, Ruler } from "lucide-react";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useViewerStore } from "@/stores/viewerStore";
import { useToast } from "@/hooks/useToast";
import { FEATURE_LIST, type FeatureGroup, type FeatureParams } from "@/lib/mesh-edit/features";
import FeatureForm from "./FeatureForm";
import PartsPanel from "./PartsPanel";

const mm = (v: number) => (Math.round(v * 10) / 10).toString();

const GROUP_ORDER: FeatureGroup[] = ["Transform", "Holes", "Split"];
const GROUP_HINTS: Record<FeatureGroup, string> = {
  Transform: "Rotate, scale, resize, mirror, lay flat — always safe on any model.",
  Holes: "Subtract bores and cutouts.",
  Split: "Cut oversized models into printable parts with connectors.",
};

export default function ToolsPanel() {
  const stlUrl = useGenerationStore((s) => s.stlUrl);
  const busy = useMeshEditStore((s) => s.busy);
  const canUndo = useHistoryStore((s) => {
    if (s.versions.length === 0) return false;
    const idx = s.activeId ? s.versions.findIndex((v) => v.id === s.activeId) : s.versions.length - 1;
    return idx > 0;
  });
  const canReset = useMeshEditStore((s) => !!s.workingGeometry);
  const bounds = useViewerStore((s) => s.modelBounds);
  const applyFeature = useMeshEditStore((s) => s.applyFeature);
  const undo = useMeshEditStore((s) => s.undo);
  const reset = useMeshEditStore((s) => s.reset);
  const draft = useMeshEditStore((s) => s.draft);
  const startDraft = useMeshEditStore((s) => s.startDraft);
  const updateDraftParam = useMeshEditStore((s) => s.updateDraftParam);
  const cancelDraft = useMeshEditStore((s) => s.cancelDraft);
  const applyDraft = useMeshEditStore((s) => s.applyDraft);
  const { toast } = useToast();

  const run = async (featureId: string, params: FeatureParams, label: string) => {
    try {
      await applyFeature(featureId, params);
      toast({ title: `${label} applied` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      toast({ title: `${label} failed`, description: msg, variant: "destructive" });
    }
  };

  const runDraft = async (label: string) => {
    try {
      await applyDraft();
      toast({ title: `${label} applied` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      toast({ title: `${label} failed`, description: msg, variant: "destructive" });
    }
  };

  if (!stlUrl) {
    return (
      <div className="p-3 text-xs text-muted-foreground text-center py-8">
        Generate or upload a model to use edit tools.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: undo / reset */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border">
        <span className="text-[11px] font-medium text-muted-foreground flex-1">Edit Tools</span>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
        <button
          onClick={undo}
          disabled={!canUndo || busy}
          title="Undo last edit"
          className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
        >
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </button>
        <button
          onClick={reset}
          disabled={!canReset || busy}
          title="Revert all edits"
          className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {/* Live model size — context for every tool's fitted defaults. */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b border-border text-[10px] text-muted-foreground">
        <Ruler className="w-3 h-3" />
        {bounds ? (
          <span>
            Model <span className="text-foreground font-medium">{mm(bounds.x)} × {mm(bounds.y)} × {mm(bounds.z)}</span> mm (W×H×D)
          </span>
        ) : (
          <span className="opacity-60">No model loaded</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <PartsPanel />
        {GROUP_ORDER.map((group) => (
          <div key={group} className="space-y-1.5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="text-[10px] text-muted-foreground/70 leading-snug">{GROUP_HINTS[group]}</div>
            </div>
            {FEATURE_LIST.filter((f) => f.group === group).map((f) => {
              const drafting = draft?.feature === f.id;
              return (
                <FeatureForm
                  key={f.id}
                  feature={f}
                  disabled={busy || (!!draft && !drafting)}
                  disabledReason={
                    !!draft && !drafting
                      ? "Finish or cancel the current 3D edit first"
                      : busy
                        ? "An edit is in progress…"
                        : undefined
                  }
                  busy={busy}
                  onApply={(params) => run(f.id, params, f.label)}
                  draftSupported={!!f.draftKind}
                  isDrafting={drafting}
                  draftParams={drafting ? draft?.params : undefined}
                  onStartDraft={(seed) => startDraft(f.id, seed)}
                  onDraftParamChange={updateDraftParam}
                  onApplyDraft={() => runDraft(f.label)}
                  onCancelDraft={cancelDraft}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
