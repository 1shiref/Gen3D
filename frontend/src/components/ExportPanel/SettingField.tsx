import type { FieldMeta, SlicerSettings } from "@/lib/slicer-profile";

interface Props {
  field: FieldMeta;
  value: SlicerSettings[keyof SlicerSettings];
  onChange: (key: keyof SlicerSettings, value: number | boolean | string) => void;
}

/** Renders a single slicer setting row (number / int / bool / select) from metadata. */
export default function SettingField({ field, value, onChange }: Props) {
  const { key, label, type, unit, min, max, step, options } = field;

  if (type === "bool") {
    return (
      <label className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
        <span className="text-xs text-muted-foreground">{label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(key, e.target.checked)}
          className="accent-primary"
        />
      </label>
    );
  }

  if (type === "select") {
    return (
      <label className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(key, e.target.value)}
          className="w-32 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    );
  }

  // number / int
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number(value)}
          min={min}
          max={max}
          step={type === "int" ? 1 : step}
          onChange={(e) => {
            const raw = e.target.value === "" ? 0 : parseFloat(e.target.value);
            onChange(key, type === "int" ? Math.round(raw) : raw);
          }}
          className="w-20 rounded border border-input bg-background px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {unit && <span className="w-8 text-[10px] text-muted-foreground">{unit}</span>}
      </span>
    </label>
  );
}
