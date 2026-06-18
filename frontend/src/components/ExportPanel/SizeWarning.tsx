import { AlertTriangle } from "lucide-react";
import { useGenerationStore, type DimensionCheck } from "@/stores/generationStore";
import { useViewerStore } from "@/stores/viewerStore";

const MISMATCH_LOW = 0.75;
const MISMATCH_HIGH = 1.25;

export function hasSizeProblem(dc: DimensionCheck | null): boolean {
  if (!dc) return false;
  if (dc.exceedsBed) return true;
  if (dc.mismatchFactor !== null && (dc.mismatchFactor > MISMATCH_HIGH || dc.mismatchFactor < MISMATCH_LOW)) return true;
  return false;
}

/**
 * Re-evaluate the size check against the user's current viewer scale. After
 * applying a fix (e.g. "Scale to declared"), the original `dc.exceedsBed` and
 * `dc.mismatchFactor` no longer reflect reality — this projects them through
 * the active scale so the SliceButton re-enables once the fix is applied.
 */
export function hasEffectiveSizeProblem(
  dc: DimensionCheck | null,
  scale: [number, number, number],
): boolean {
  if (!dc) return false;
  const sx = dc.actual.x * scale[0];
  const sy = dc.actual.y * scale[1];
  const sz = dc.actual.z * scale[2];
  if (sx > dc.bed.w || sy > dc.bed.d || sz > dc.bed.h) return true;
  if (dc.declared) {
    const rx = sx / dc.declared.x;
    const ry = sy / dc.declared.y;
    const rz = sz / dc.declared.z;
    const f = Math.max(rx, ry, rz, 1 / rx, 1 / ry, 1 / rz);
    if (f > MISMATCH_HIGH || f < MISMATCH_LOW) return true;
  }
  return false;
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

export default function SizeWarning() {
  const dc = useGenerationStore((s) => s.dimensionCheck);
  const modelTransform = useViewerStore((s) => s.modelTransform);
  const setTransform = useViewerStore((s) => s.setTransform);

  if (!hasSizeProblem(dc) || !dc) return null;
  // Once the user picks a fix, the banner stops nagging — but stays visible
  // (in a "fixed" state) so they remember the AI's original output was off.
  const stillProblem = hasEffectiveSizeProblem(dc, modelTransform.scale);

  const mismatch = dc.mismatchFactor !== null && (dc.mismatchFactor > MISMATCH_HIGH || dc.mismatchFactor < MISMATCH_LOW);
  const currentUniform = modelTransform.scale[0];
  const declaredApplied = dc.scaleToDeclared !== null && Math.abs(currentUniform - dc.scaleToDeclared) < 1e-3;
  const fitApplied = dc.scaleToFitBed !== null && Math.abs(currentUniform - dc.scaleToFitBed) < 1e-3;

  const applyScale = (factor: number) => {
    setTransform({ scale: [factor, factor, factor] });
  };

  return (
    <div
      className={`rounded-md border p-2 text-xs space-y-2 ${
        stillProblem
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-emerald-500/40 bg-emerald-500/10"
      }`}
    >
      <div className={`flex items-start gap-2 ${stillProblem ? "text-amber-200" : "text-emerald-200"}`}>
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          {mismatch && dc.declared && (
            <div>
              <span className="font-medium">Size mismatch.</span> AI declared{" "}
              <span className="font-mono">{fmt(dc.declared.x)}×{fmt(dc.declared.y)}×{fmt(dc.declared.z)} mm</span>,
              but the STL measures{" "}
              <span className="font-mono">{fmt(dc.actual.x)}×{fmt(dc.actual.y)}×{fmt(dc.actual.z)} mm</span>.
            </div>
          )}
          {dc.exceedsBed && (
            <div>
              <span className="font-medium">Exceeds bed.</span> Model is{" "}
              <span className="font-mono">{fmt(dc.actual.x)}×{fmt(dc.actual.y)}×{fmt(dc.actual.z)} mm</span>,
              bed is <span className="font-mono">{fmt(dc.bed.w)}×{fmt(dc.bed.d)}×{fmt(dc.bed.h)} mm</span>.
            </div>
          )}
          <div className={stillProblem ? "text-amber-200/70" : "text-emerald-200/80"}>
            {stillProblem
              ? "Slicing is disabled until you apply a fix."
              : "Fix applied — slicing will use the rescaled model."}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {dc.scaleToDeclared !== null && dc.declared && (
          <button
            onClick={() => applyScale(dc.scaleToDeclared!)}
            className={`px-2 py-1 rounded text-xs border transition-colors ${
              declaredApplied
                ? "bg-emerald-600/30 border-emerald-500/60 text-emerald-100"
                : "bg-amber-600/30 hover:bg-amber-600/50 border-amber-500/50 text-amber-50"
            }`}
          >
            {declaredApplied ? "✓ " : ""}Scale to declared ({dc.scaleToDeclared.toFixed(3)}×)
          </button>
        )}
        {dc.scaleToFitBed !== null && (
          <button
            onClick={() => applyScale(dc.scaleToFitBed!)}
            className={`px-2 py-1 rounded text-xs border transition-colors ${
              fitApplied
                ? "bg-emerald-600/30 border-emerald-500/60 text-emerald-100"
                : "bg-amber-600/30 hover:bg-amber-600/50 border-amber-500/50 text-amber-50"
            }`}
          >
            {fitApplied ? "✓ " : ""}Scale to fit bed ({dc.scaleToFitBed.toFixed(3)}×)
          </button>
        )}
      </div>
    </div>
  );
}
