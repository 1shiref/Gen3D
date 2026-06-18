import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "@/stores/projectStore";
import { useExportStore } from "@/stores/exportStore";
import { useGenerationStore } from "@/stores/generationStore";
import { downloadBlob } from "@/lib/stl-utils";
import { useToast } from "./useToast";

const PROJECT_PREFIX = "g3d-project-";

export function useProject() {
  const projectStore = useProjectStore();
  const exportStore = useExportStore();
  const generationStore = useGenerationStore();
  const { toast } = useToast();

  const save = useCallback(async (): Promise<string | null> => {
    const id = projectStore.currentProjectId ?? uuidv4();
    // Snapshot the currently-loaded model as a single version.
    const currentStl = generationStore.editedStlUrl ?? generationStore.stlUrl;
    const versions = currentStl
      ? [{
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          stlUrl: currentStl,
          message: "Current model",
          source: generationStore.modelSource ?? "generated",
        }]
      : [];
    const projectData = {
      id,
      name: projectStore.currentProjectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputs: {
        prompt: generationStore.prompt,
        imageRefs: [],
      },
      versions,
      currentVersionIndex: versions.length - 1,
      slicerSettings: exportStore.slicerSettings,
      printerPreset: exportStore.printerPreset,
    };

    try {
      localStorage.setItem(`${PROJECT_PREFIX}${id}`, JSON.stringify(projectData));
      projectStore.markSaved(id);
      projectStore.addRecentProject({
        id,
        name: projectStore.currentProjectName,
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Project saved" });
      return id;
    } catch {
      toast({ title: "Save failed", description: "localStorage may be full", variant: "destructive" });
      return null;
    }
  }, [projectStore, exportStore, generationStore, toast]);

  const exportT2P = useCallback(async () => {
    let id = projectStore.currentProjectId;
    let data = id ? localStorage.getItem(`${PROJECT_PREFIX}${id}`) : null;
    if (!data) {
      const savedId = await save();
      if (!savedId) return;
      id = savedId;
      data = localStorage.getItem(`${PROJECT_PREFIX}${id}`);
      if (!data) return;
    }
    const blob = new Blob([data], { type: "application/json" });
    downloadBlob(blob, `${projectStore.currentProjectName}.t2p`);
    toast({ title: "Project exported" });
  }, [projectStore, save, toast]);

  return { save, exportT2P };
}
