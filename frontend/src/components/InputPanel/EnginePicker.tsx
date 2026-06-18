import { useEffect } from "react";
import { Loader2, Cpu } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useEngineStore, availableEngineIds } from "@/stores/engineStore";
import HelpTip from "@/components/UI/HelpTip";

/**
 * Engine checklist for multi-candidate generation. Defaults to all available
 * engines; image-only engines are greyed out until an image is provided. The
 * selected ids are sent to the backend, which runs them in parallel.
 */
export default function EnginePicker() {
  const engines = useEngineStore((s) => s.engines);
  const loaded = useEngineStore((s) => s.loaded);
  const error = useEngineStore((s) => s.error);
  const load = useEngineStore((s) => s.load);
  const hasImages = useGenerationStore((s) => s.images.length > 0);
  const selected = useGenerationStore((s) => s.selectedEngines);
  const setSelected = useGenerationStore((s) => s.setSelectedEngines);

  useEffect(() => {
    load();
  }, [load]);

  // Default: select every available engine the first time the catalog is known.
  useEffect(() => {
    if (loaded && selected.length === 0 && engines.length > 0) {
      setSelected(availableEngineIds(engines));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, engines]);

  const toggle = (id: string) => {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div data-tour="engines">
      <div className="flex items-center gap-1.5 mb-2">
        <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
        <label className="text-xs font-medium text-foreground">Generation engines</label>
        <span className="text-[10px] text-muted-foreground">(runs all checked in parallel)</span>
        <HelpTip id="engines" />
      </div>

      {error && <div className="text-[11px] text-destructive">Couldn't load engines: {error}</div>}
      {!loaded && !error && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading engines…
        </div>
      )}

      <div className="space-y-1">
        {engines.map((e) => {
          const blockedNoImage = e.needsImage && !hasImages;
          const disabled = !e.available || blockedNoImage;
          const checked = selected.includes(e.id) && !disabled;
          return (
            <label
              key={e.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent cursor-pointer"
              }`}
              title={
                !e.available ? "Unavailable — missing API key on the server"
                : blockedNoImage ? "Needs an image"
                : "Image → 3D mesh"
              }
            >
              <input
                type="checkbox"
                className="accent-primary"
                disabled={disabled}
                checked={checked}
                onChange={() => toggle(e.id)}
              />
              <span className="flex-1 min-w-0 truncate">{e.label}</span>
              <span className="text-[9px] px-1 rounded bg-purple-500/20 text-purple-300">
                AI mesh
              </span>
              {blockedNoImage && <span className="text-[9px] text-amber-400">needs image</span>}
              {!e.available && <span className="text-[9px] text-muted-foreground">no key</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
