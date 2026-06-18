import { X, Plus, Trash2, Copy, Check } from "lucide-react";
import {
  usePrinterStore,
  useAllPrinters,
  type PrinterDraft,
} from "@/stores/printerStore";
import { BUILTIN_PROFILES, type PrinterProfile } from "@/lib/printer-profiles";

const CUSTOM_COLOR = "#607d8b";

function draftFrom(p: PrinterProfile): PrinterDraft {
  const { bedWidth, bedDepth, bedHeight, nozzleTemp, bedTemp, printSpeed, color } = p;
  return { name: `${p.name} Copy`, bedWidth, bedDepth, bedHeight, nozzleTemp, bedTemp, printSpeed, color };
}

/** A labeled number input bound to one numeric field of a custom printer. */
function NumField({
  label, value, min, onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(Math.max(min, n));
        }}
        className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

export default function PrinterManagerModal() {
  const open = usePrinterStore((s) => s.managerOpen);
  const closeManager = usePrinterStore((s) => s.closeManager);
  const selectedId = usePrinterStore((s) => s.selectedId);
  const addPrinter = usePrinterStore((s) => s.addPrinter);
  const updatePrinter = usePrinterStore((s) => s.updatePrinter);
  const deletePrinter = usePrinterStore((s) => s.deletePrinter);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const printers = useAllPrinters();

  if (!open) return null;

  const selected = printers.find((p) => p.id === selectedId) ?? BUILTIN_PROFILES[0];
  const builtIns = printers.filter((p) => p.builtIn);
  const customs = printers.filter((p) => !p.builtIn);

  const addBlank = () =>
    addPrinter({
      name: "My Printer",
      bedWidth: 200, bedDepth: 200, bedHeight: 200,
      nozzleTemp: 200, bedTemp: 60, printSpeed: 50,
      color: CUSTOM_COLOR,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeManager}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold">Manage Printers</h3>
          <button onClick={closeManager} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {/* Built-in presets — read only, with duplicate-to-custom */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Built-in presets
            </div>
            {builtIns.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                  p.id === selectedId ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <button onClick={() => selectPrinter(p.id)} className="flex-1 min-w-0 text-left">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {" "}— {p.bedWidth}×{p.bedDepth}×{p.bedHeight} mm
                  </span>
                </button>
                {p.id === selectedId && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                <button
                  onClick={() => addPrinter(draftFrom(p))}
                  title="Duplicate to a custom printer"
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Custom printers — editable */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Your printers
              </div>
              <button
                onClick={addBlank}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-3.5 h-3.5" /> Add printer
              </button>
            </div>

            {customs.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-1">
                No custom printers yet. Add one or duplicate a preset above.
              </p>
            )}

            {customs.map((p) => (
              <div
                key={p.id}
                className={`rounded border p-2.5 space-y-2 ${
                  p.id === selectedId ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={p.name}
                    onChange={(e) => updatePrinter(p.id, { name: e.target.value })}
                    placeholder="Printer name"
                    className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {p.id === selectedId ? (
                    <span className="text-[10px] text-primary px-1.5 shrink-0">Active</span>
                  ) : (
                    <button
                      onClick={() => selectPrinter(p.id)}
                      className="shrink-0 text-[11px] px-2 py-1 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                    >
                      Use
                    </button>
                  )}
                  <button
                    onClick={() => deletePrinter(p.id)}
                    title="Delete printer"
                    className="shrink-0 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <NumField label="Width (mm)"  value={p.bedWidth}  min={1} onChange={(n) => updatePrinter(p.id, { bedWidth: n })} />
                  <NumField label="Depth (mm)"  value={p.bedDepth}  min={1} onChange={(n) => updatePrinter(p.id, { bedDepth: n })} />
                  <NumField label="Height (mm)" value={p.bedHeight} min={1} onChange={(n) => updatePrinter(p.id, { bedHeight: n })} />
                  <NumField label="Nozzle °C"   value={p.nozzleTemp} min={0} onChange={(n) => updatePrinter(p.id, { nozzleTemp: n })} />
                  <NumField label="Bed °C"      value={p.bedTemp}    min={0} onChange={(n) => updatePrinter(p.id, { bedTemp: n })} />
                  <NumField label="Speed mm/s"  value={p.printSpeed} min={1} onChange={(n) => updatePrinter(p.id, { printSpeed: n })} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Active: <span className="text-foreground font-medium">{selected.name}</span> · saved automatically
          </span>
          <button
            onClick={closeManager}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
