import { useState } from "react";
import { X, RotateCcw, Save, Copy } from "lucide-react";
import { usePrinterStore, useSelectedPrinter, isMachineDirty } from "@/stores/printerStore";
import type { PrinterProfile } from "@/lib/printer-profiles";

/** Labeled number input bound to one numeric machine field. */
function Num({
  label, value, unit, min, step, onChange,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  min?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value ?? 0}
          min={min}
          step={step}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) onChange(n);
          }}
          className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {unit && <span className="w-8 text-[10px] text-muted-foreground">{unit}</span>}
      </span>
    </label>
  );
}

function Toggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean | undefined;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
    </label>
  );
}

function GcodeArea({
  label, value, onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (s: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={6}
        className="w-full rounded border border-input bg-muted/30 px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

export default function MachineSettingsModal() {
  const open = usePrinterStore((s) => s.machineModalOpen);
  const close = usePrinterStore((s) => s.closeMachineSettings);
  const updatePrinter = usePrinterStore((s) => s.updatePrinter);
  const addPrinter = usePrinterStore((s) => s.addPrinter);
  const savedDefault = usePrinterStore((s) => s.savedDefaultMachine);
  const saveAsDefault = usePrinterStore((s) => s.saveMachineAsDefault);
  const resetToDefault = usePrinterStore((s) => s.resetMachineToDefault);
  const resetToFactory = usePrinterStore((s) => s.resetMachineToFactory);
  const printer = useSelectedPrinter();

  const [tab, setTab] = useState<"printer" | "extruder">("printer");

  if (!open) return null;

  const readOnly = Boolean(printer.builtIn);
  const dirty = isMachineDirty(printer, savedDefault);
  const set = (patch: Partial<PrinterProfile>) => updatePrinter(printer.id, patch);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold">Machine Settings — {printer.name}</h3>
          <button onClick={close} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4">
          {(["printer", "extruder"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "printer" ? "Printer" : "Extruder 1"}
            </button>
          ))}
        </div>

        {readOnly && (
          <div className="m-4 mb-0 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-center justify-between">
            <span className="text-amber-700 dark:text-amber-400">This is a read-only preset.</span>
            <button
              onClick={() => {
                const { id: _id, builtIn: _b, ...rest } = printer;
                void _id; void _b;
                addPrinter({ ...rest, name: `${printer.name} Copy` });
              }}
              className="flex items-center gap-1 rounded border border-input px-2 py-1 hover:bg-accent"
            >
              <Copy className="h-3 w-3" /> Duplicate to edit
            </button>
          </div>
        )}

        <div className={`overflow-y-auto px-4 py-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
          {tab === "printer" ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Printer Settings</h4>
                <Num label="X (Width)" unit="mm" value={printer.bedWidth} min={1} onChange={(n) => set({ bedWidth: n })} />
                <Num label="Y (Depth)" unit="mm" value={printer.bedDepth} min={1} onChange={(n) => set({ bedDepth: n })} />
                <Num label="Z (Height)" unit="mm" value={printer.bedHeight} min={1} onChange={(n) => set({ bedHeight: n })} />
                <label className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-xs text-muted-foreground">Build plate shape</span>
                  <select
                    value={printer.buildPlateShape ?? "rectangular"}
                    onChange={(e) => set({ buildPlateShape: e.target.value as PrinterProfile["buildPlateShape"] })}
                    className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    <option value="rectangular">Rectangular</option>
                    <option value="elliptic">Elliptic</option>
                  </select>
                </label>
                <Toggle label="Origin at center" checked={printer.originAtCenter} onChange={(b) => set({ originAtCenter: b })} />
                <Toggle label="Heated bed" checked={printer.heatedBed} onChange={(b) => set({ heatedBed: b })} />
                <Toggle label="Heated build volume" checked={printer.heatedBuildVolume} onChange={(b) => set({ heatedBuildVolume: b })} />
                <label className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-xs text-muted-foreground">G-code flavor</span>
                  <select
                    value={printer.gcodeFlavor ?? "Marlin"}
                    onChange={(e) => set({ gcodeFlavor: e.target.value as PrinterProfile["gcodeFlavor"] })}
                    className="w-32 rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    {["Marlin", "RepRap", "Griffin", "UltiGCode", "RepRap (Volumetric)"].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Printhead Settings</h4>
                <Num label="X min" unit="mm" value={printer.headXMin} onChange={(n) => set({ headXMin: n })} />
                <Num label="Y min (towards back)" unit="mm" value={printer.headYMin} onChange={(n) => set({ headYMin: n })} />
                <Num label="X max" unit="mm" value={printer.headXMax} onChange={(n) => set({ headXMax: n })} />
                <Num label="Y max (towards front)" unit="mm" value={printer.headYMax} onChange={(n) => set({ headYMax: n })} />
                <Num label="Gantry Height" unit="mm" value={printer.gantryHeight} onChange={(n) => set({ gantryHeight: n })} />
                <Num label="Number of Extruders" value={printer.extruderCount} min={1} step={1} onChange={(n) => set({ extruderCount: Math.round(n) })} />
                <Toggle label="Apply Extruder offsets to GCode" checked={printer.applyExtruderOffsets} onChange={(b) => set({ applyExtruderOffsets: b })} />
                <Toggle label="Start GCode must be first" checked={printer.startGcodeFirst} onChange={(b) => set({ startGcodeFirst: b })} />
              </section>

              <div className="md:col-span-1"><GcodeArea label="Start G-code" value={printer.startGcode} onChange={(s) => set({ startGcode: s })} /></div>
              <div className="md:col-span-1"><GcodeArea label="End G-code" value={printer.endGcode} onChange={(s) => set({ endGcode: s })} /></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nozzle Settings</h4>
                <Num label="Nozzle size" unit="mm" value={printer.nozzleSize} min={0.1} step={0.05} onChange={(n) => set({ nozzleSize: n })} />
                <Num label="Compatible material diameter" unit="mm" value={printer.filamentDiameter} min={1} step={0.05} onChange={(n) => set({ filamentDiameter: n })} />
                <Num label="Nozzle offset X" unit="mm" value={printer.nozzleOffsetX} onChange={(n) => set({ nozzleOffsetX: n })} />
                <Num label="Nozzle offset Y" unit="mm" value={printer.nozzleOffsetY} onChange={(n) => set({ nozzleOffsetY: n })} />
                <Num label="Cooling Fan Number" value={printer.coolingFanNumber} min={0} step={1} onChange={(n) => set({ coolingFanNumber: Math.round(n) })} />
              </section>
              <section className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extruder G-code</h4>
                <Num label="Extruder Change duration" unit="s" value={printer.extruderChangeDuration} min={0} onChange={(n) => set({ extruderChangeDuration: n })} />
                <Num label="Extruder Start G-code duration" unit="s" value={printer.extruderStartDuration} min={0} onChange={(n) => set({ extruderStartDuration: n })} />
                <Num label="Extruder End G-code duration" unit="s" value={printer.extruderEndDuration} min={0} onChange={(n) => set({ extruderEndDuration: n })} />
              </section>
              <div className="md:col-span-1"><GcodeArea label="Extruder Start G-code" value={printer.extruderStartGcode} onChange={(s) => set({ extruderStartGcode: s })} /></div>
              <div className="md:col-span-1"><GcodeArea label="Extruder End G-code" value={printer.extruderEndGcode} onChange={(s) => set({ extruderEndGcode: s })} /></div>
            </div>
          )}
        </div>

        {/* Dirty banner + footer */}
        <div className="border-t border-border px-4 py-2.5 space-y-2">
          {dirty && !readOnly && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-center justify-between">
              <span className="text-amber-700 dark:text-amber-400">You changed some machine settings from your default.</span>
              <div className="flex items-center gap-2">
                <button onClick={saveAsDefault} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90">
                  <Save className="h-3 w-3" /> Save as default
                </button>
                <button onClick={resetToDefault} className="flex items-center gap-1 rounded border border-input px-2 py-1 hover:bg-accent">
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <button onClick={resetToFactory} className="text-[11px] text-muted-foreground underline hover:text-foreground">
              Reset to Custom Gen 3D printer defaults
            </button>
            <button onClick={close} className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
