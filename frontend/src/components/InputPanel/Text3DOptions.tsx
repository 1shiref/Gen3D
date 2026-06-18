import { useEffect } from "react";
import { Wand2 } from "lucide-react";
import { useImageStageStore, type ProviderScope } from "@/stores/imageStageStore";
import { useEngineStore } from "@/stores/engineStore";

/**
 * Text → 3D preferences, set before generating (since with auto-confirm the review overlay
 * never appears). Picks which provider(s) turn the synthesized photo into a mesh, and whether
 * to skip the photo review. Only affects the text-only path; uploaded images go straight to 3D.
 */
export default function Text3DOptions() {
  const provider = useImageStageStore((s) => s.provider);
  const setProvider = useImageStageStore((s) => s.setProvider);
  const autoConfirm = useImageStageStore((s) => s.autoConfirm);
  const setAutoConfirm = useImageStageStore((s) => s.setAutoConfirm);
  const engines = useEngineStore((s) => s.engines);
  const load = useEngineStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  // A scope is selectable when the server actually offers a matching engine.
  const hasFal = engines.some((e) => e.available && e.id.startsWith("fal:"));
  const hasHf = engines.some((e) => e.available && e.id.startsWith("hf:"));
  const scopeOptions: { value: ProviderScope; label: string; enabled: boolean }[] = [
    { value: "hf", label: "HF", enabled: hasHf },
    { value: "fal", label: "fal", enabled: hasFal },
    { value: "both", label: "Both", enabled: hasFal && hasHf },
  ];

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Wand2 className="w-3.5 h-3.5 text-muted-foreground" />
        <label className="text-xs font-medium text-foreground">Text → 3D</label>
        <span className="text-[10px] text-muted-foreground">(when generating from text only)</span>
      </div>

      <div className="mb-1.5 text-[10px] text-muted-foreground">Generate 3D with</div>
      <div className="flex gap-1.5 mb-2">
        {scopeOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setProvider(opt.value)}
            disabled={!opt.enabled}
            title={opt.enabled ? `Use ${opt.label}` : "No matching engine selected above"}
            className={`flex-1 rounded-md border py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              provider === opt.value
                ? "border-primary bg-primary/20 text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          className="accent-primary"
          checked={autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
        />
        Auto-confirm photo (skip review)
      </label>
    </div>
  );
}
