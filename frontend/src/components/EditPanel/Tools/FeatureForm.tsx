import { useEffect, useMemo, useState } from "react";
import { Loader2, Move3D, Check, X } from "lucide-react";
import { type Feature, type FeatureParams, initialParams } from "@/lib/mesh-edit/features";
import { useViewerStore } from "@/stores/viewerStore";
import ParamFields from "./ParamFields";

interface Props {
  feature: Feature;
  disabled: boolean;
  /** Why the form is disabled (shown as a tooltip), e.g. another draft is active. */
  disabledReason?: string;
  busy: boolean;
  onApply: (params: FeatureParams) => void;
  /** Draggable in-viewport draft (split / hole / transform) support. */
  draftSupported?: boolean;
  isDrafting?: boolean;
  draftParams?: FeatureParams;
  onStartDraft?: (seed: FeatureParams) => void;
  onDraftParamChange?: (key: string, value: FeatureParams[string]) => void;
  onApplyDraft?: () => void;
  onCancelDraft?: () => void;
}

export default function FeatureForm({
  feature, disabled, disabledReason, busy, onApply,
  draftSupported, isDrafting, draftParams,
  onStartDraft, onDraftParamChange, onApplyDraft, onCancelDraft,
}: Props) {
  const bounds = useViewerStore((s) => s.modelBounds);
  // Values fitted to the current model — the seed for the form and the per-field "reset" target.
  const suggested = useMemo(() => initialParams(feature, bounds), [feature, bounds]);

  const [params, setParams] = useState<FeatureParams>(suggested);
  const [open, setOpen] = useState(false);

  // Re-fit this tool to the model whenever the model changes (new model loaded or an
  // edit changed its size). `suggested` only gets a new reference when modelBounds
  // changes — never on field typing — so a user's values are never overwritten while
  // they edit on a stable model.
  useEffect(() => {
    setParams(suggested);
  }, [suggested]);

  // Expand automatically while this feature is being positioned in the 3D view.
  useEffect(() => { if (isDrafting) setOpen(true); }, [isDrafting]);

  const values = isDrafting && draftParams ? draftParams : params;

  const set = (key: string, v: FeatureParams[string]) => {
    if (isDrafting) {
      onDraftParamChange?.(key, v);
    } else {
      setParams((p) => ({ ...p, [key]: v }));
    }
  };

  // Restore one field to its fitted value (clears nothing else; keeps the form "touched").
  const resetField = (key: string) => {
    if (isDrafting) onDraftParamChange?.(key, suggested[key]);
    else setParams((p) => ({ ...p, [key]: suggested[key] }));
  };

  return (
    <div className={`rounded border ${isDrafting ? "border-primary" : "border-border"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
      >
        <span>{feature.label}{isDrafting ? " — editing in 3D" : ""}</span>
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-border">
          {feature.hint && (
            <p className="text-[10px] text-primary/80 leading-snug">{feature.hint}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-snug">{feature.description}</p>
          <ParamFields
            params={feature.params}
            values={values}
            suggested={suggested}
            onChange={set}
            onReset={resetField}
          />

          {isDrafting ? (
            <div className="flex gap-1">
              <button
                onClick={onApplyDraft}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Apply
              </button>
              <button
                onClick={onCancelDraft}
                disabled={busy}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          ) : draftSupported ? (
            // Spatial tools: position visually first (primary), or apply the typed values directly.
            <div className="flex gap-1" title={disabled ? disabledReason : undefined}>
              <button
                onClick={() => onStartDraft?.(params)}
                disabled={disabled}
                title="Position this edit with handles in the 3D view"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Move3D className="w-3.5 h-3.5" /> Edit in 3D
              </button>
              <button
                onClick={() => onApply(params)}
                disabled={disabled}
                title="Apply with the values above, without the 3D handles"
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Apply
              </button>
            </div>
          ) : (
            <div className="flex gap-1" title={disabled ? disabledReason : undefined}>
              <button
                onClick={() => onApply(params)}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Apply {feature.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
