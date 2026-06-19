import { useCallback } from "react";
import { sliceModel, checkHealth, uploadModel } from "@/lib/api";
import { exportForSlicing } from "@/lib/mesh-convert";
import { BED_MARGIN_MM, evaluateFit } from "@/lib/print-volume";
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

    // The geometry currently on screen (working edit ?? base) is what we slice —
    // its viewer transform is already baked in by commitTransform above.
    const geo = useMeshEditStore.getState().current();
    const gen = useGenerationStore.getState();
    // Fallback URL only used if there's no in-memory geometry to re-export.
    let stlUrl = gen.editedStlUrl ?? gen.stlUrl;
    if (!geo && !stlUrl) {
      toast({ title: "No model to slice", description: "Generate a model first", variant: "destructive" });
      return;
    }

    const printer = getSelectedPrinter();

    // ---- Pre-slice out-of-range check (notify BEFORE; still slice) ----------
    // Bounds are in the viewer's Y-up frame (height along Y), seated at y=0 and
    // centered on X/Z — exactly what evaluateFit expects.
    if (geo) {
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (bb && Number.isFinite(bb.min.x)) {
        const fit = evaluateFit(bb.clone(), printer, BED_MARGIN_MM);
        if (!fit.fits) {
          const parts: string[] = [];
          if (fit.exceeds.x) parts.push(`${Math.ceil(fit.overflow.x)}mm too wide`);
          if (fit.exceeds.z) parts.push(`${Math.ceil(fit.overflow.z)}mm too deep`);
          if (fit.exceeds.y) parts.push(`${Math.ceil(fit.overflow.y)}mm too tall`);
          toast({
            title: "Model is outside the printable area",
            description: `${parts.join(", ")} (bed minus ${BED_MARGIN_MM}mm margin). Slicing anyway — rescale to print safely.`,
            variant: "destructive",
          });
        }
      }
    }

    exportStore.setSliceStatus("slicing");
    const proc = useProcessStore.getState();
    proc.start("Slicing to G-code");

    try {
      proc.step("Preparing model");

      // Re-export the on-screen geometry in the slicer's Z-up orientation so the
      // print matches the preview (viewer height +Y → printer height +Z),
      // including any rotation/edits. Upload it and slice THAT file.
      if (geo) {
        try {
          const blob = exportForSlicing(geo, true);
          const file = new File([blob], "slice.stl", { type: "model/stl" });
          stlUrl = (await uploadModel(file)).url;
        } catch (e) {
          // Non-fatal — fall back to the previously uploaded STL if present.
          console.error("[slice] Z-up export failed, using fallback STL:", e);
        }
      }
      if (!stlUrl) {
        throw new Error("Could not prepare the model for slicing");
      }

      // Ask the backend which slicer it will use so the log can name it.
      let slicerName = "slicer engine";
      try {
        const health = await checkHealth();
        slicerName = prettySlicer(health.slicer);
      } catch { /* non-fatal — keep generic name */ }

      proc.step("Slicing", slicerName);

      const result = await sliceModel({
        stlPath: stlUrl,
        settings: exportStore.slicerSettings,
        printerPreset: printer.id,
        marginMm: BED_MARGIN_MM,
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
          headXMin: printer.headXMin,
          headYMin: printer.headYMin,
          headXMax: printer.headXMax,
          headYMax: printer.headYMax,
          gantryHeight: printer.gantryHeight,
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

      // The model is auto-centered on the bed, but if it's larger than the build
      // volume the print would still run off the bed — surface that to the user.
      if (result.warnings && result.warnings.length > 0) {
        toast({
          title: "Model may not fit the printer",
          description: result.warnings.join(" "),
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Slicing failed";
      exportStore.setSliceError(msg);
      useProcessStore.getState().fail(msg);
      toast({ title: "Slicing failed", description: msg, variant: "destructive" });
    }
  }, [exportStore, generationStore.editedStlUrl, generationStore.stlUrl, toast]);

  return { slice, status: exportStore.sliceStatus };
}
