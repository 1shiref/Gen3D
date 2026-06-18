import { useEffect } from "react";
import { Loader2, Wand2, Sparkles, Undo2, ArrowRight, AlertTriangle, X } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useImageStageStore, type ProviderScope } from "@/stores/imageStageStore";
import { useEngineStore } from "@/stores/engineStore";
import { useGenerate } from "@/hooks/useGenerate";
import { buildFileUrl } from "@/lib/api";
import EnhanceButton from "@/components/InputPanel/EnhanceButton";

/**
 * Phase A review overlay — a single iterative workspace over the current working image. The user
 * can Enhance (background removal / upscale) or Reimagine (image + text → new photo) in any order,
 * any number of times, Undo a step, then convert the result to 3D. Mounted over the viewer while
 * the image stage is active.
 */
export default function ImageReview() {
  const stage = useImageStageStore((s) => s.stage);
  const mode = useImageStageStore((s) => s.mode);
  const current = useImageStageStore((s) => s.current);
  const history = useImageStageStore((s) => s.history);
  const error = useImageStageStore((s) => s.error);
  const provider = useImageStageStore((s) => s.provider);
  const setProvider = useImageStageStore((s) => s.setProvider);
  const ops = useImageStageStore((s) => s.ops);
  const setOps = useImageStageStore((s) => s.setOps);
  const reset = useImageStageStore((s) => s.reset);
  const statusMessage = useGenerationStore((s) => s.statusMessage);
  const prompt = useGenerationStore((s) => s.prompt);
  const setPrompt = useGenerationStore((s) => s.setPrompt);
  const engines = useEngineStore((s) => s.engines);
  const load = useEngineStore((s) => s.load);
  const { confirmImage, enhance, reimagine, undo } = useGenerate();

  useEffect(() => {
    load();
  }, [load]);

  // Which provider scopes are actually selectable, derived from what the server offers.
  const hasFal = engines.some((e) => e.available && e.id.startsWith("fal:"));
  const hasHf = engines.some((e) => e.available && e.id.startsWith("hf:"));
  const scopeOptions: { value: ProviderScope; label: string; enabled: boolean }[] = [
    { value: "fal", label: "fal", enabled: hasFal },
    { value: "hf", label: "HF", enabled: hasHf },
    { value: "both", label: "Both", enabled: hasFal && hasHf },
  ];

  if (stage === "idle") return null;

  const busy = stage === "generating";
  // A failed op leaves the previous good image as `current`, so it stays usable despite the error.
  const canConfirm = stage === "review" && !busy && !!current;
  const canUndo = history.length > 0;
  const progressLabel =
    statusMessage ?? (mode === "enhance" ? "Enhancing image…" : mode === "reimagine" ? "Reimagining…" : "Generating photo…");

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm p-4">
      <div className="relative flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-zinc-800 p-5 shadow-2xl">
        <button
          type="button"
          onClick={reset}
          title="Close"
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-white/90">Refine before 3D</div>
          <div className="text-xs text-white/55">Enhance or reimagine in any order, then convert to 3D.</div>
        </div>

        {/* Preview panel — checkered so a transparent cutout reads as "object on white". */}
        <div
          className="flex aspect-square max-h-[40vh] w-full shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{
            backgroundColor: "#ffffff",
            backgroundImage:
              "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
          }}
        >
          {busy && (
            <div className="flex flex-col items-center gap-2 text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <div className="text-xs">{progressLabel}</div>
            </div>
          )}
          {!busy && current && (
            <img src={buildFileUrl(current.url)} alt="Working image" className="max-h-full max-w-full object-contain" />
          )}
          {!busy && !current && error && (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-amber-600">
              <AlertTriangle className="h-6 w-6" />
              <div className="text-xs">{error}</div>
            </div>
          )}
        </div>

        {/* Last operation failed, but the previous image is still usable. */}
        {!busy && error && current && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Edit instruction — Reimagine edits the photo, keeping everything else. */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="What to change? e.g. 'make the lid red', 'add a handle' — Reimagine edits this photo"
          className="w-full resize-y min-h-[4rem] max-h-[40vh] overflow-y-auto rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-white/90 placeholder:text-white/30 focus:border-primary focus:outline-none"
        />
        <div className="flex justify-end">
          <EnhanceButton className="border-white/10 bg-zinc-900 text-white/90 hover:bg-zinc-700" />
        </div>

        {/* Enhancement options — used by Enhance. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/85">
            <input
              type="checkbox"
              checked={ops.removeBg}
              onChange={(e) => setOps({ removeBg: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Remove background
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/85">
            <input
              type="checkbox"
              checked={ops.upscale}
              onChange={(e) => setOps({ upscale: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Upscale / sharpen
          </label>
        </div>

        {/* Apply operations to the current image (chainable). */}
        <div className="flex gap-2">
          <button
            onClick={enhance}
            disabled={busy}
            title="Clean up the current image (remove background / upscale)"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-700 py-2 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Enhance
          </button>
          <button
            onClick={reimagine}
            disabled={busy || !prompt.trim()}
            title={prompt.trim() ? "Use the current image as a reference + your text" : "Add a prompt to reimagine"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-700 py-2 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            Reimagine
          </button>
          <button
            onClick={undo}
            disabled={busy || !canUndo}
            title="Step back to the previous image"
            aria-label="Undo"
            className="flex items-center justify-center rounded-md bg-zinc-700 py-2 px-3 text-white transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        </div>

        {/* Which provider(s) turn the confirmed photo into a 3D mesh. */}
        <div>
          <div className="mb-1.5 text-xs text-white/55">Generate 3D with</div>
          <div className="flex gap-1.5">
            {scopeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setProvider(opt.value)}
                disabled={!opt.enabled}
                title={opt.enabled ? `Use ${opt.label}` : "No matching engine selected"}
                className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  provider === opt.value
                    ? "border-primary bg-primary/20 text-white"
                    : "border-white/10 bg-zinc-900 text-white/70 hover:bg-zinc-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={confirmImage}
          disabled={!canConfirm}
          className="flex items-center justify-center gap-2 rounded-md bg-primary py-2.5 px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use this
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
