import { Sparkles } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useGenerate } from "@/hooks/useGenerate";

/**
 * Optional pre-generation entry for an uploaded image. Plain Generate still goes straight to 3D;
 * this opens the refine popup where the user chooses what they need — Enhance (background removal /
 * upscale) and/or Reimagine (image + text → new photo), chainable in any order until confirm.
 * Operates on the first uploaded image.
 */
export default function ImageRefineActions() {
  const images = useGenerationStore((s) => s.images);
  const status = useGenerationStore((s) => s.status);
  const { openRefine } = useGenerate();

  if (images.length === 0) return null;

  const busy = status === "streaming" || status === "compiling";

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={openRefine}
        disabled={busy}
        title="Enhance or reimagine the image before generating"
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Enhance
      </button>
      {images.length > 1 && (
        <p className="text-[11px] text-muted-foreground">Refine uses the first image.</p>
      )}
    </div>
  );
}
