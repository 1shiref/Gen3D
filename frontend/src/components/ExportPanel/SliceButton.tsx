import { useSlice } from "@/hooks/useSlice";
import { useGenerationStore } from "@/stores/generationStore";
import { useViewerStore } from "@/stores/viewerStore";
import { Layers, Loader2 } from "lucide-react";
import { hasEffectiveSizeProblem } from "./SizeWarning";

export default function SliceButton() {
  const { slice, status } = useSlice();
  const hasModel = useGenerationStore((s) => !!s.stlUrl);
  const dimensionCheck = useGenerationStore((s) => s.dimensionCheck);
  const scale = useViewerStore((s) => s.modelTransform.scale);
  const blocked = hasEffectiveSizeProblem(dimensionCheck, scale);

  const disabled = !hasModel || status === "slicing" || blocked;
  const reason = !hasModel
    ? "Generate or upload a model first"
    : blocked
      ? "Resolve the size warning before slicing"
      : undefined;

  return (
    <button
      onClick={slice}
      disabled={disabled}
      title={reason}
      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {status === "slicing" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Layers className="w-4 h-4" />
      )}
      {status === "slicing" ? "Slicing…" : "Slice Model"}
    </button>
  );
}
