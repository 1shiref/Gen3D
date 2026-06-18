import { useCallback } from "react";
import { enhancePrompt, buildFileUrl } from "@/lib/api";
import { downloadFileUrl } from "@/lib/stl-utils";
import { FEATURES, type FeatureParams } from "@/lib/mesh-edit/features";
import { coerceActionParams } from "@/lib/smart-plan/actions";
import { useGenerationStore, type GenerationStore } from "@/stores/generationStore";
import { useExportStore, type SlicerSettings } from "@/stores/exportStore";
import { usePrinterStore } from "@/stores/printerStore";
import { useImageStageStore } from "@/stores/imageStageStore";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useGenerate } from "./useGenerate";
import { useSlice } from "./useSlice";
import { useProject } from "./useProject";
import { useToast } from "./useToast";

/**
 * Resolve once a fresh model is ready (after the user confirms the image and a candidate
 * is auto-selected), or reject if generation errors. This is how `generate_model` pauses
 * the plan at the interactive image-review / candidate-pick UI, then auto-continues.
 */
function waitForGeneration(prevStl: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (s: GenerationStore) => {
      if (s.status === "error") {
        unsub();
        reject(new Error(s.errorMessage ?? "Generation failed"));
      } else if (s.status === "done" && s.stlUrl && s.stlUrl !== prevStl) {
        unsub();
        resolve();
      }
    };
    const unsub = useGenerationStore.subscribe(check);
    check(useGenerationStore.getState()); // in case it is already ready
  });
}

/**
 * Executes one Smart-plan step by dispatching its action id to the right store/hook.
 * Mesh-edit features go through `meshEditStore.applyFeature`; app-level actions drive
 * generation, fitting, slicing, and export. The SmartPlan component sequences steps and
 * tracks per-step status; this hook just performs a single step (throwing on failure).
 */
export function useSmartPlanRunner() {
  const { generate } = useGenerate();
  const { slice } = useSlice();
  const { exportT2P } = useProject();
  const { toast } = useToast();

  const runStep = useCallback(
    async (actionId: string, params: FeatureParams = {}): Promise<void> => {
      // Mesh-edit feature → existing edit pipeline.
      if (FEATURES[actionId]) {
        await useMeshEditStore.getState().applyFeature(actionId, coerceActionParams(actionId, params), "smart-plan");
        return;
      }

      const p = coerceActionParams(actionId, params);
      const gen = useGenerationStore.getState();

      switch (actionId) {
        case "set_prompt": {
          gen.setPrompt(String(p.text ?? "").trim());
          return;
        }

        case "enhance_prompt": {
          const cur = gen.prompt.trim();
          if (!cur) throw new Error("No prompt to enhance — add a prompt first");
          const better = await enhancePrompt(cur);
          useGenerationStore.getState().setPrompt(better);
          return;
        }

        case "generate_model": {
          const prev = gen.stlUrl;
          const wait = waitForGeneration(prev);
          await generate({ allowAutoConfirm: true }); // text-only returns at the image-review step; image returns when done
          if (!useImageStageStore.getState().autoConfirm) {
            toast({ title: "Generating…", description: "Confirm the image / pick a candidate to continue the plan." });
          }
          await wait;
          return;
        }

        case "select_printer": {
          usePrinterStore.getState().selectPrinter(String(p.printerId));
          return;
        }

        case "fit_to_bed": {
          if (!gen.stlUrl) throw new Error("Generate or load a model first");
          const dc = gen.dimensionCheck;
          if (!dc || !dc.exceedsBed) {
            toast({ title: "Already fits", description: "The model is within the printer build volume." });
            return;
          }
          if (p.mode === "split") {
            await useMeshEditStore.getState().applyFeature("split_parts", coerceActionParams("split_parts", {}), "smart-plan");
          } else {
            const factor = dc.scaleToFitBed ?? 1;
            await useMeshEditStore
              .getState()
              .applyFeature("scale_uniform", coerceActionParams("scale_uniform", { factor }), "smart-plan");
          }
          return;
        }

        case "set_slicer_settings": {
          const patch: Partial<SlicerSettings> = {};
          if (typeof p.infillDensity === "number") patch.infillDensity = p.infillDensity;
          if (typeof p.infillPattern === "string") patch.infillPattern = p.infillPattern as SlicerSettings["infillPattern"];
          if (typeof p.wallThickness === "number") patch.wallThickness = p.wallThickness;
          if (typeof p.layerHeight === "number") patch.layerHeight = p.layerHeight;
          if (typeof p.material === "string") patch.material = p.material as SlicerSettings["material"];
          if (typeof p.generateSupport === "boolean") patch.generateSupport = p.generateSupport;
          if (typeof p.buildPlateAdhesionType === "string") patch.buildPlateAdhesionType = p.buildPlateAdhesionType as SlicerSettings["buildPlateAdhesionType"];
          useExportStore.getState().updateSettings(patch);
          return;
        }

        case "slice_model": {
          await slice();
          const ex = useExportStore.getState();
          if (ex.sliceStatus === "error") throw new Error(ex.sliceError ?? "Slicing failed");
          return;
        }

        case "export_stl": {
          const url = gen.editedStlUrl ?? gen.stlUrl;
          if (!url) throw new Error("No model to export");
          await downloadFileUrl(buildFileUrl(url), "model.stl");
          return;
        }

        case "export_gcode": {
          const gcodeUrl = useExportStore.getState().gcodeUrl;
          if (!gcodeUrl) throw new Error("No G-code yet — slice the model first");
          await downloadFileUrl(buildFileUrl(gcodeUrl), "model.gcode");
          return;
        }

        case "export_zip": {
          await exportT2P();
          return;
        }

        default:
          throw new Error(`Unknown action: ${actionId}`);
      }
    },
    [generate, slice, exportT2P, toast],
  );

  return { runStep };
}
