import { useState } from "react";
import { X } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useImageStageStore } from "@/stores/imageStageStore";

/**
 * Small corner thumbnail of the source image the current model was generated from
 * (AI-generated photo or uploaded image). Stays visible during and after 3D generation
 * so the user can compare the model to its reference. Click to enlarge.
 *
 * Hidden while the photo-review stage is active — ImageReview already shows it full-size.
 */
export default function ReferenceThumbnail() {
  const referenceImageUrl = useGenerationStore((s) => s.referenceImageUrl);
  const stage = useImageStageStore((s) => s.stage);
  const [enlarged, setEnlarged] = useState(false);

  if (!referenceImageUrl || stage !== "idle") return null;

  return (
    <>
      {/* Thumbnail pinned bottom-right of the viewer (clear of the transform/edit panel). */}
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        title="Reference image — click to enlarge"
        className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-lg border border-white/15 bg-black/50 shadow-lg backdrop-blur-sm transition-transform hover:scale-105"
      >
        <img
          src={referenceImageUrl}
          alt="Reference"
          className="h-20 w-20 object-contain"
        />
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[10px] font-medium text-white/70">
          Reference
        </div>
      </button>

      {/* Enlarged lightbox. */}
      {enlarged && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setEnlarged(false)}
        >
          <button
            type="button"
            onClick={() => setEnlarged(false)}
            title="Close"
            className="absolute right-4 top-4 rounded-md bg-white/10 p-1.5 text-white/80 transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={referenceImageUrl}
            alt="Reference"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
