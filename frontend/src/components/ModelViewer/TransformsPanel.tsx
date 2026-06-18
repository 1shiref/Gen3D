import { useState } from "react";
import { ChevronUp, RotateCcw, Move3D, MousePointer2, Move, Rotate3D, Scale3D, Check, Loader2 } from "lucide-react";
import { useViewerStore, IDENTITY_TRANSFORM, type ModelTransform } from "@/stores/viewerStore";
import { useMeshEditStore } from "@/stores/meshEditStore";

type Axis = 0 | 1 | 2;

const GIZMO_MODES = [
  { mode: "off" as const, label: "Off", icon: MousePointer2 },
  { mode: "translate" as const, label: "Move", icon: Move },
  { mode: "rotate" as const, label: "Rotate", icon: Rotate3D },
  { mode: "scale" as const, label: "Scale", icon: Scale3D },
];
const AXES: { idx: Axis; label: string }[] = [
  { idx: 0, label: "X" },
  { idx: 1, label: "Y" },
  { idx: 2, label: "Z" },
];

/** A controlled X/Y/Z numeric row. `onUpdate` fires live per keystroke; `onCommit`
 *  (optional) fires on blur, used in parts mode to rebuild the merged sliceable mesh. */
function Row<K extends keyof ModelTransform>({
  label,
  field,
  step,
  precision = 2,
  value,
  onUpdate,
  onCommit,
}: {
  label: string;
  field: K;
  step: number;
  precision?: number;
  value: [number, number, number];
  onUpdate: (field: K, idx: Axis, n: number) => void;
  onCommit?: () => void;
}) {
  return (
    <div className="grid grid-cols-[40px_1fr_1fr_1fr] items-center gap-1 text-[10px]">
      <span className="text-white/60">{label}</span>
      {AXES.map(({ idx, label: axisLabel }) => (
        <label key={idx} className="flex items-center gap-0.5">
          <span className="text-white/40 w-2">{axisLabel}</span>
          <input
            type="number"
            step={step}
            value={Number(value[idx].toFixed(precision))}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n)) onUpdate(field, idx, n);
            }}
            onBlur={() => onCommit?.()}
            className="w-full min-w-0 bg-white/10 hover:bg-white/15 focus:bg-white/20 rounded px-1 py-0.5 text-white text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      ))}
    </div>
  );
}

export default function TransformsPanel() {
  const [open, setOpen] = useState(false);
  const resetTransform = useViewerStore((s) => s.resetTransform);
  const transform = useViewerStore((s) => s.modelTransform);
  const setTransform = useViewerStore((s) => s.setTransform);
  const gizmoMode = useViewerStore((s) => s.gizmoMode);
  const setGizmoMode = useViewerStore((s) => s.setGizmoMode);
  const cancelDraft = useMeshEditStore((s) => s.cancelDraft);
  const commitTransform = useMeshEditStore((s) => s.commitTransform);
  const busy = useMeshEditStore((s) => s.busy);

  // Parts mode: the gizmo + this panel operate on the selected split part instead of
  // the whole model.
  const parts = useMeshEditStore((s) => s.parts);
  const selectedPartId = useMeshEditStore((s) => s.selectedPartId);
  const setPartTransform = useMeshEditStore((s) => s.setPartTransform);
  const commitParts = useMeshEditStore((s) => s.commitParts);
  const partsMode = !!parts && parts.length > 0;
  const selectedPart = partsMode ? parts!.find((p) => p.id === selectedPartId) ?? null : null;
  const partIndex = selectedPart ? parts!.findIndex((p) => p.id === selectedPart.id) : -1;

  const active: ModelTransform = partsMode ? selectedPart?.transform ?? IDENTITY_TRANSFORM : transform;

  const isIdentity =
    active.scale.every((v) => v === 1) &&
    active.rotation.every((v) => v === 0) &&
    active.position.every((v) => v === 0);

  const pickGizmo = (m: typeof gizmoMode) => {
    cancelDraft(); // gizmo and CSG drafts are mutually exclusive
    setGizmoMode(m);
  };

  // Live numeric edits: update the model transform (non-parts) or the selected part.
  const onUpdate = <K extends keyof ModelTransform>(field: K, idx: Axis, n: number) => {
    const next = { ...active, [field]: [...active[field]] as [number, number, number] };
    (next[field] as [number, number, number])[idx] = n;
    if (partsMode) {
      if (selectedPart) setPartTransform(selectedPart.id, next);
    } else {
      setTransform({ [field]: next[field] } as Partial<ModelTransform>);
    }
  };

  const onReset = () => {
    if (partsMode) {
      if (selectedPart) {
        setPartTransform(selectedPart.id, {
          scale: [...IDENTITY_TRANSFORM.scale],
          rotation: [...IDENTITY_TRANSFORM.rotation],
          position: [...IDENTITY_TRANSFORM.position],
        });
        void commitParts();
      }
    } else {
      resetTransform();
    }
  };

  const canEdit = !partsMode || !!selectedPart;

  return (
    <div className="absolute top-2 left-2 w-[230px] rounded-lg overflow-hidden border border-border/50 bg-black/60 backdrop-blur-sm shadow-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/10 transition-colors"
      >
        <Move3D className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">{partsMode ? (selectedPart ? `Transform · Part ${partIndex + 1}` : "Transform · Parts") : "Transform"}</span>
        {!isIdentity && (
          <span className="text-[9px] bg-amber-500/30 text-amber-300 px-1 rounded">modified</span>
        )}
        <ChevronUp
          className={`w-3 h-3 transition-transform ${open ? "" : "rotate-180"}`}
        />
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-white/10 pt-2">
          {/* In-view gizmo: drag handles in the 3D scene */}
          <div className="grid grid-cols-4 gap-1">
            {GIZMO_MODES.map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => pickGizmo(mode)}
                title={`${label} gizmo`}
                className={`flex flex-col items-center gap-0.5 py-1 rounded text-[9px] transition-colors ${
                  gizmoMode === mode ? "bg-primary text-primary-foreground" : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {partsMode && !selectedPart && (
            <div className="text-[10px] text-white/50 py-1">Select a part to transform it.</div>
          )}

          {canEdit && (
            <>
              <Row label="Scale"    field="scale"    step={0.05} precision={2} value={active.scale}    onUpdate={onUpdate} onCommit={partsMode ? () => void commitParts() : undefined} />
              <Row label="Rotation" field="rotation" step={5}    precision={0} value={active.rotation} onUpdate={onUpdate} onCommit={partsMode ? () => void commitParts() : undefined} />
              <Row label="Position" field="position" step={1}    precision={1} value={active.position} onUpdate={onUpdate} onCommit={partsMode ? () => void commitParts() : undefined} />

              <div className="flex gap-1 mt-1">
                {/* Apply (bake) only applies to the whole-model transform; parts auto-merge. */}
                {!partsMode && (
                  <button
                    onClick={() => { void commitTransform(); }}
                    disabled={isIdentity || busy}
                    title="Bake transform into the model (sliceable, undoable)"
                    className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] bg-primary/80 text-primary-foreground hover:bg-primary transition-colors disabled:opacity-30"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Apply
                  </button>
                )}
                <button
                  onClick={onReset}
                  disabled={isIdentity || busy}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
