import { useMemo } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useViewerStore } from "@/stores/viewerStore";
import { useSelectedPrinter } from "@/stores/printerStore";
import { computeTransformedBounds, evaluateFit } from "@/lib/print-volume";

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

/**
 * Bottom-left HUD: live model dimensions (computed client-side from the shared
 * bounds, so it works for generated and uploaded models alike and tracks
 * the live transform), the selected printer's build volume, and an at-a-glance
 * "does it fit?" status with footprint/height usage.
 */
export default function ViewerOverlay() {
  const modelBounds = useViewerStore((s) => s.modelBounds);
  const modelTransform = useViewerStore((s) => s.modelTransform);
  const profile = useSelectedPrinter();

  const fit = useMemo(() => {
    if (!modelBounds) return null;
    const box = computeTransformedBounds(modelBounds, modelTransform);
    return evaluateFit(box, profile);
  }, [modelBounds, modelTransform, profile]);

  if (!modelBounds || !fit) return null;

  const { dims, fits, footprintPct, heightPct } = fit;

  return (
    <div className="absolute bottom-2 left-2 text-xs text-white/80 bg-black/55 backdrop-blur-sm rounded-md px-2.5 py-1.5 space-y-1 max-w-[240px]">
      <div className="font-medium text-white/90">
        {fmt(dims.x)} × {fmt(dims.y)} × {fmt(dims.z)} mm
      </div>

      <div className="text-white/45">
        {profile.name} · {fmt(profile.bedWidth)}×{fmt(profile.bedDepth)}×{fmt(profile.bedHeight)} mm
      </div>

      <div
        className={`flex items-center gap-1.5 font-medium ${
          fits ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {fits ? (
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>{fits ? "Fits in build volume" : "Exceeds build volume"}</span>
      </div>

      <div className="text-white/45">
        Footprint {footprintPct.toFixed(0)}% · Height {heightPct.toFixed(0)}%
      </div>
    </div>
  );
}
