import { RotateCcw } from "lucide-react";
import type { FeatureParams, ParamSpec } from "@/lib/mesh-edit/features";

/** A small "fitted to model" badge + reset control shown when the value differs from the
 *  model-fitted suggestion. Clicking restores the suggested value. */
function FittedReset({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      title="This was fitted to the model — click to restore the suggested value"
      className="flex items-center gap-0.5 text-[9px] text-primary/70 hover:text-primary"
    >
      <RotateCcw className="w-2.5 h-2.5" /> fitted
    </button>
  );
}

function Field({
  spec, value, suggestedValue, onChange, onReset,
}: {
  spec: ParamSpec;
  value: FeatureParams[string];
  suggestedValue: FeatureParams[string] | undefined;
  onChange: (v: FeatureParams[string]) => void;
  onReset?: () => void;
}) {
  // Offer the "reset to fitted" affordance only when there's a suggestion and it's been changed.
  const showReset = onReset !== undefined && suggestedValue !== undefined && value !== suggestedValue;

  if (spec.type === "boolean") {
    return (
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground col-span-2">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
        {spec.label}
      </label>
    );
  }
  if (spec.type === "text") {
    return (
      <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground col-span-2">
        <span>{spec.label}</span>
        <textarea
          value={String(value ?? "")}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
    );
  }
  if (spec.type === "select") {
    return (
      <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
        <span>{spec.label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
      <span className="flex items-center justify-between gap-1">
        <span>{spec.label}{spec.unit ? ` (${spec.unit})` : ""}</span>
        {showReset && <FittedReset onReset={onReset!} />}
      </span>
      <input
        type="number"
        value={Number(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        className="rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

/** Grid of inputs for a list of param specs — shared by the Tools forms and the Smart-plan editor.
 *  `suggested` + `onReset` are optional (Smart-plan passes neither). */
export default function ParamFields({
  params, values, suggested, onChange, onReset,
}: {
  params: ParamSpec[];
  values: FeatureParams;
  suggested?: FeatureParams;
  onChange: (key: string, v: FeatureParams[string]) => void;
  onReset?: (key: string) => void;
}) {
  // Drop params whose `hidden` predicate matches the current values (e.g. pin
  // settings when split has alignment pins off).
  const visible = params.filter((spec) => !spec.hidden?.(values));
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {visible.map((spec) => (
        <Field
          key={spec.key}
          spec={spec}
          value={values[spec.key]}
          suggestedValue={suggested?.[spec.key]}
          onChange={(v) => onChange(spec.key, v)}
          onReset={onReset ? () => onReset(spec.key) : undefined}
        />
      ))}
    </div>
  );
}
