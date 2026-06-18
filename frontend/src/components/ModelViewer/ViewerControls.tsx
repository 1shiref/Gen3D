import { Box, Grid3X3, Ruler, Camera, Layers, Maximize2, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useViewerStore } from "@/stores/viewerStore";
import PrinterSelect from "@/components/Printer/PrinterSelect";

interface Props {
  onScreenshot: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40 px-2 pt-1.5 pb-1">
      {children}
    </div>
  );
}

function Tile({
  icon: Icon, label, active, onClick, title,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`flex flex-col items-center justify-center gap-0.5 w-[52px] py-1.5 rounded text-[10px] font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="leading-tight">{label}</span>
    </button>
  );
}

export default function ViewerControls({ onScreenshot }: Props) {
  const store = useViewerStore();

  return (
    <div className="absolute top-2 right-2 w-[180px] rounded-lg overflow-hidden border border-border/50 bg-black/60 backdrop-blur-sm shadow-lg">
      {/* PRINTER — active printer drives the build-volume simulation */}
      <SectionLabel>Printer</SectionLabel>
      <div className="px-1.5 pb-1.5">
        <PrinterSelect size="sm" />
      </div>

      <div className="h-px bg-white/10 mx-1.5" />

      {/* OVERLAYS — what's drawn alongside the model */}
      <SectionLabel>Overlays</SectionLabel>
      <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
        <Tile
          icon={Box}
          label="Box"
          title="Bounding Box"
          active={store.showBoundingBox}
          onClick={store.toggleBoundingBox}
        />
        <Tile
          icon={Grid3X3}
          label="Grid"
          active={store.showGrid}
          onClick={store.toggleGrid}
        />
        <Tile
          icon={Layers}
          label="Bed"
          title="Print Bed"
          active={store.showPrintBed}
          onClick={store.togglePrintBed}
        />
      </div>

      <div className="h-px bg-white/10 mx-1.5" />

      {/* TOOLS — actions */}
      <SectionLabel>Tools</SectionLabel>
      <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
        <Tile
          icon={Maximize2}
          label="Fit"
          title="Fit model to view"
          onClick={() => store.requestFit("model")}
        />
        <Tile
          icon={Printer}
          label="Printer"
          title="Frame the whole printer build volume"
          onClick={() => store.requestFit("printer")}
        />
        <Tile
          icon={Ruler}
          label="Measure"
          active={store.isMeasuring}
          onClick={store.toggleMeasure}
        />
        <Tile
          icon={Camera}
          label="Snap"
          title="Screenshot"
          onClick={onScreenshot}
        />
      </div>

      {/* Measure feedback — sits inside the card so it doesn't float orphaned */}
      {(store.isMeasuring || store.measureDistance !== null) && (
        <div className="mx-1.5 mb-1.5 px-2 py-1 rounded text-center text-[11px] font-medium bg-yellow-500/90 text-black">
          {store.measureDistance !== null
            ? `${store.measureDistance} mm`
            : store.measurePoints.length === 0
              ? "Click point 1"
              : "Click point 2"}
        </div>
      )}
    </div>
  );
}
