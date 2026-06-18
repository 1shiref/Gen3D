import { Settings2, SlidersHorizontal } from "lucide-react";
import { usePrinterStore, useAllPrinters } from "@/stores/printerStore";

interface Props {
  /** Tailwind classes for the wrapper, so callers control width/spacing. */
  className?: string;
  /** Visual size; "sm" suits the dark viewer overlay, "md" the export panel. */
  size?: "sm" | "md";
}

/**
 * Printer picker shared by the 3D viewer and the Export panel. Selecting routes
 * through printerStore.selectPrinter so the build-volume sim, slicer defaults,
 * and backend all follow one source of truth. The gear opens the manager modal.
 */
export default function PrinterSelect({ className = "", size = "md" }: Props) {
  const printers = useAllPrinters();
  const selectedId = usePrinterStore((s) => s.selectedId);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const openManager = usePrinterStore((s) => s.openManager);
  const openMachineSettings = usePrinterStore((s) => s.openMachineSettings);

  const sm = size === "sm";
  const selectCls = sm
    ? "flex-1 min-w-0 bg-white/10 hover:bg-white/15 text-white text-[11px] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
    : "flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
  const btnCls = sm
    ? "shrink-0 p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
    : "shrink-0 p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30";

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <select
        value={selectedId}
        onChange={(e) => selectPrinter(e.target.value)}
        className={selectCls}
      >
        {printers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.bedWidth}×{p.bedDepth}×{p.bedHeight}
            {p.builtIn ? "" : " *"}
          </option>
        ))}
      </select>
      <button onClick={openMachineSettings} title="Machine settings" className={btnCls}>
        <SlidersHorizontal className={sm ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </button>
      <button onClick={openManager} title="Manage printers" className={btnCls}>
        <Settings2 className={sm ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </button>
    </div>
  );
}
