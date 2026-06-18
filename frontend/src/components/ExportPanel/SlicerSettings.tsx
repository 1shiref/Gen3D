import { useState } from "react";
import { RotateCcw, Save, ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useExportStore, settingsAreDefault } from "@/stores/exportStore";
import { SETTING_GROUPS, MATERIAL_OPTIONS, type SlicerSettings, type FieldMeta } from "@/lib/slicer-profile";
import SettingField from "./SettingField";

export default function SlicerSettings() {
  const slicerSettings = useExportStore((s) => s.slicerSettings);
  const savedDefault = useExportStore((s) => s.savedDefault);
  const updateSettings = useExportStore((s) => s.updateSettings);
  const saveAsDefault = useExportStore((s) => s.saveAsDefault);
  const resetToDefault = useExportStore((s) => s.resetToDefault);
  const resetToFactory = useExportStore((s) => s.resetToFactory);

  const [mode, setMode] = useState<"recommended" | "custom">("recommended");
  const isDirty = !settingsAreDefault(slicerSettings, savedDefault);

  const set = (key: keyof SlicerSettings, value: number | boolean | string) =>
    updateSettings({ [key]: value } as Partial<SlicerSettings>);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Print settings</h3>
        <button
          onClick={() => setMode((m) => (m === "recommended" ? "custom" : "recommended"))}
          className="flex items-center gap-1 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {mode === "recommended" ? "Show Custom" : "Show Recommended"}
        </button>
      </div>

      {/* Dirty banner — "ask to save as default or not". */}
      {isDirty && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs space-y-2">
          <p className="text-amber-700 dark:text-amber-400">
            Custom settings active — you changed some values from your default.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={saveAsDefault}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
            >
              <Save className="h-3 w-3" /> Save as default
            </button>
            <button
              onClick={resetToDefault}
              className="flex items-center gap-1 rounded border border-input px-2 py-1 hover:bg-accent"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
        </div>
      )}

      {mode === "recommended" ? (
        <RecommendedView settings={slicerSettings} set={set} />
      ) : (
        <CustomView settings={slicerSettings} set={set} />
      )}

      <button
        onClick={resetToFactory}
        className="text-[11px] text-muted-foreground underline hover:text-foreground"
      >
        Reset to Gen 3D PETG Normal defaults
      </button>
    </div>
  );
}

/* ----------------------------- Recommended ------------------------------ */

function RecommendedView({
  settings,
  set,
}: {
  settings: SlicerSettings;
  set: (key: keyof SlicerSettings, value: number | boolean | string) => void;
}) {
  const supportOn = settings.generateSupport;
  const adhesionOn = settings.buildPlateAdhesionType !== "none";

  // Wall/top-bottom thickness are Cura-linked: editing them updates the line/
  // layer counts that the slicer actually consumes, so they reach the G-code.
  const setWallThickness = (mm: number) => {
    set("wallThickness", mm);
    set("wallLineCount", Math.max(0, Math.round(mm / settings.lineWidth)));
  };
  const setTopBottomThickness = (mm: number) => {
    set("topBottomThickness", mm);
    const layers = Math.max(0, Math.round(mm / settings.layerHeight));
    set("topLayers", layers);
    set("bottomLayers", layers);
  };

  return (
    <div className="space-y-4">
      {/* Strength */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium">Strength</h4>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Infill Density</label>
            <span className="text-xs">{settings.infillDensity}%</span>
          </div>
          <input
            type="range"
            min={0} max={100} step={5}
            value={settings.infillDensity}
            onChange={(e) => set("infillDensity", parseInt(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Infill Pattern</span>
          <select
            value={settings.infillPattern}
            onChange={(e) => set("infillPattern", e.target.value)}
            className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
          >
            {["lines", "grid", "triangles", "concentric", "zigzag"].map((p) => (
              <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Wall Thickness
            <input
              type="number" min={0.4} max={5} step={0.1}
              value={settings.wallThickness}
              onChange={(e) => setWallThickness(parseFloat(e.target.value) || 0)}
              className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Top/Bottom Thickness
            <input
              type="number" min={0} max={5} step={0.1}
              value={settings.topBottomThickness}
              onChange={(e) => setTopBottomThickness(parseFloat(e.target.value) || 0)}
              className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-xs"
            />
          </label>
        </div>
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Material</span>
          <select
            value={settings.material}
            onChange={(e) => set("material", e.target.value)}
            className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
          >
            {MATERIAL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
      </section>

      {/* Support */}
      <section className="space-y-2">
        <label className="flex items-center justify-between">
          <h4 className="text-xs font-medium">Support</h4>
          <input
            type="checkbox"
            checked={supportOn}
            onChange={(e) => set("generateSupport", e.target.checked)}
            className="accent-primary"
          />
        </label>
        {supportOn && (
          <div className="space-y-1 pl-1">
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Support Type</span>
              <select
                value={settings.supportStructure}
                onChange={(e) => set("supportStructure", e.target.value)}
                className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="normal">Normal</option>
                <option value="tree">Tree</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Placement</span>
              <select
                value={settings.supportPlacement}
                onChange={(e) => set("supportPlacement", e.target.value)}
                className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="everywhere">Everywhere</option>
                <option value="touching-buildplate">Touching Buildplate</option>
              </select>
            </label>
          </div>
        )}
      </section>

      {/* Adhesion */}
      <section className="space-y-2">
        <label className="flex items-center justify-between">
          <h4 className="text-xs font-medium">Adhesion</h4>
          <input
            type="checkbox"
            checked={adhesionOn}
            onChange={(e) => set("buildPlateAdhesionType", e.target.checked ? "skirt" : "none")}
            className="accent-primary"
          />
        </label>
        {adhesionOn && (
          <label className="flex items-center justify-between gap-2 pl-1">
            <span className="text-xs text-muted-foreground">Type</span>
            <select
              value={settings.buildPlateAdhesionType}
              onChange={(e) => set("buildPlateAdhesionType", e.target.value)}
              className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="skirt">Skirt</option>
              <option value="brim">Brim</option>
              <option value="raft">Raft</option>
            </select>
          </label>
        )}
      </section>
    </div>
  );
}

/* ------------------------------- Custom --------------------------------- */

function CustomView({
  settings,
  set,
}: {
  settings: SlicerSettings;
  set: (key: keyof SlicerSettings, value: number | boolean | string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SETTING_GROUPS.map((g) => [g.name, true])),
  );

  const visible = (f: FieldMeta) => !f.showIf || Boolean(settings[f.showIf]);

  return (
    <div className="space-y-1">
      {SETTING_GROUPS.map((group) => {
        const isOpen = open[group.name];
        return (
          <div key={group.name} className="rounded border border-input">
            <button
              onClick={() => setOpen((o) => ({ ...o, [group.name]: !o[group.name] }))}
              className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium hover:bg-accent"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {group.name}
            </button>
            {isOpen && (
              <div className="space-y-0.5 px-2 pb-2">
                {group.fields.filter(visible).map((field) => (
                  <SettingField
                    key={field.key}
                    field={field}
                    value={settings[field.key]}
                    onChange={set}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
