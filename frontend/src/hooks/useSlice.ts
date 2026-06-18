import { useCallback } from "react";
import { sliceModel, checkHealth } from "@/lib/api";
import { useExportStore } from "@/stores/exportStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useViewerStore } from "@/stores/viewerStore";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { getSelectedPrinter } from "@/stores/printerStore";
import { useProcessStore } from "@/stores/processStore";
import { useToast } from "./useToast";

/** Friendly name for the backend slicer reported by /api/health. */
function prettySlicer(raw: string | undefined): string {
  if (!raw) return "slicer engine";
  const r = raw.toLowerCase();
  if (r.includes("cura")) return "CuraEngine";
  if (r.includes("prusa")) return "PrusaSlicer";
  if (r.includes("ts") || r.includes("built")) return "Built-in slicer";
  return raw;
}

export function useSlice() {
  const exportStore = useExportStore();
  const generationStore = useGenerationStore();
  const { toast } = useToast();

  const slice = useCallback(async () => {
    // Bake any pending viewer transform (gizmo / Transform panel) into the model
    // first, so rotation + position + scale all reach the slicer — not just scale.
    const t = useViewerStore.getState().modelTransform;
    const pending =
      !(t.scale.every((v) => v === 1) && t.rotation.every((v) => v === 0) && t.position.every((v) => v === 0));
    if (pending) {
      try { await useMeshEditStore.getState().commitTransform(); }
      catch { /* non-fatal — fall back to slicing the un-baked model */ }
    }

    // Prefer the locally mesh-edited STL when present, so transform/split/hole
    // edits are what actually gets sliced. Read fresh — commitTransform just set it.
    const gen = useGenerationStore.getState();
    const stlUrl = gen.editedStlUrl ?? gen.stlUrl;
    if (!stlUrl) {
      toast({ title: "No model to slice", description: "Generate a model first", variant: "destructive" });
      return;
    }

    exportStore.setSliceStatus("slicing");
    const proc = useProcessStore.getState();
    proc.start("Slicing to G-code");

    try {
      proc.step("Preparing model");

      // Ask the backend which slicer it will use so the log can name it.
      let slicerName = "slicer engine";
      try {
        const health = await checkHealth();
        slicerName = prettySlicer(health.slicer);
      } catch { /* non-fatal — keep generic name */ }

      proc.step("Slicing", slicerName);

      const printer = getSelectedPrinter();
      const result = await sliceModel({
        stlPath: stlUrl,
        settings: exportStore.slicerSettings,
        printerPreset: printer.id,
        machine: {
          name: printer.name,
          bedWidth: printer.bedWidth,
          bedDepth: printer.bedDepth,
          bedHeight: printer.bedHeight,
          originAtCenter: printer.originAtCenter,
          gcodeFlavor: printer.gcodeFlavor,
          nozzleSize: printer.nozzleSize,
          filamentDiameter: printer.filamentDiameter,
          coolingFanNumber: printer.coolingFanNumber,
          startGcode: printer.startGcode,
          endGcode: printer.endGcode,
        },
      });

      proc.step("Reading print stats");

      exportStore.setSliceResult({
        gcodeUrl: result.gcodeUrl,
        stats: result.stats,
        preview: result.preview,
      });

      proc.done();
      toast({
        title: "Slicing complete",
        description: `${result.stats.layerCount} layers · ~${result.stats.estimatedTimeMinutes} min`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Slicing failed";
      exportStore.setSliceError(msg);
      useProcessStore.getState().fail(msg);
      toast({ title: "Slicing failed", description: msg, variant: "destructive" });
    }
  }, [exportStore, generationStore.editedStlUrl, generationStore.stlUrl, toast]);

  return { slice, status: exportStore.sliceStatus };
}
