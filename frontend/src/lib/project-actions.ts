import { v4 as uuidv4 } from "uuid";
import { exportAsStl } from "@/lib/mesh-convert";
import {
  getProject,
  putProject,
  deleteProject as dbDeleteProject,
  listProjects,
  isQuotaError,
} from "@/lib/project-db";
import { serializeProject, deserializeProject, type ProjectMeta } from "@/lib/project-serialize";
import { useProjectStore } from "@/stores/projectStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useCandidateStore } from "@/stores/candidateStore";
import { useImageStageStore } from "@/stores/imageStageStore";
import { useProcessStore } from "@/stores/processStore";
import { useViewerStore } from "@/stores/viewerStore";
import { useToastStore } from "@/hooks/useToast";

/**
 * Project orchestration — the plain (non-React) glue that ties the per-project
 * stores to durable IndexedDB storage. Reused by the autosave hook and the
 * project-menu UI. See `project-db.ts` / `project-serialize.ts` for storage.
 */

/** createdAt is fixed per project; remembered here so saves don't reset it. */
const createdAtById = new Map<string, number>();
/** Object URLs minted for restored models — revoked on the next reset/load. */
const restoredUrls = new Set<string>();

function toast(title: string, description?: string, destructive = false) {
  useToastStore.getState().addToast({
    title,
    description,
    variant: destructive ? "destructive" : "default",
  });
}

function revokeRestoredUrls() {
  for (const url of restoredUrls) URL.revokeObjectURL(url);
  restoredUrls.clear();
}

/** Blank every per-project store. Global settings (printer/slicer/engines) are untouched. */
export function resetProjectState(): void {
  useCandidateStore.getState().reset();
  useHistoryStore.getState().clear();
  useMeshEditStore.getState().clearAll();
  useGenerationStore.getState().hardReset();
  useImageStageStore.getState().reset();
  useProcessStore.getState().reset();
  const viewer = useViewerStore.getState();
  viewer.resetTransform();
  viewer.setGizmoMode("off");
  viewer.clearMeasure();
  viewer.setModelBounds(null);
  revokeRestoredUrls();
}

/** Start a brand-new, empty project. */
export function createNewProject(): void {
  resetProjectState();
  useProjectStore.getState().newProject();
  const id = useProjectStore.getState().currentProjectId;
  if (id) createdAtById.set(id, Date.now());
}

/** True when there's any model content worth persisting. */
function hasContent(): boolean {
  return useHistoryStore.getState().versions.length > 0;
}

/** True when a generation/edit/slice is mid-flight (don't snapshot a half-built model). */
export function isBusy(): boolean {
  const status = useGenerationStore.getState().status;
  const busyStatuses = ["uploading", "streaming", "compiling"];
  return (
    busyStatuses.includes(status) ||
    useProcessStore.getState().running ||
    useCandidateStore.getState().running ||
    useMeshEditStore.getState().busy
  );
}

/** Persist the current project to IndexedDB. No-op when empty or mid-generation. */
export async function saveCurrentProject(): Promise<void> {
  if (!hasContent() || isBusy()) return;

  const projectStore = useProjectStore.getState();
  let id = projectStore.currentProjectId;
  if (!id) {
    id = uuidv4();
    projectStore.setCurrentProject(id, projectStore.currentProjectName);
  }
  if (!createdAtById.has(id)) createdAtById.set(id, Date.now());

  const gen = useGenerationStore.getState();
  const history = useHistoryStore.getState();
  const meta: ProjectMeta = {
    id,
    name: useProjectStore.getState().currentProjectName,
    createdAt: createdAtById.get(id) as number,
    prompt: gen.prompt,
    referenceImageUrl: gen.referenceImageUrl,
    modelSource: gen.modelSource,
  };

  let record;
  try {
    record = await serializeProject(meta, history.versions, history.activeId);
    await putProject(record);
  } catch (err) {
    if (isQuotaError(err)) {
      toast("Storage full", "Couldn't save the project — free up browser storage.", true);
    } else {
      console.error("[project] save failed:", err);
    }
    return;
  }

  useProjectStore.getState().markSaved(id);
  useProjectStore.getState().addRecentProject({
    id,
    name: meta.name,
    updatedAt: new Date(record.updatedAt).toISOString(),
    thumbnailDataUrl: record.thumbnailDataUrl,
  });
}

/** Restore a saved project: hydrate history + geometry, then mount the viewer. */
export async function loadProject(id: string): Promise<void> {
  // Persist whatever is open before switching away (auto-save makes this safe).
  if (
    useProjectStore.getState().currentProjectId &&
    useProjectStore.getState().currentProjectId !== id &&
    hasContent() &&
    !isBusy()
  ) {
    await saveCurrentProject();
  }

  const record = await getProject(id);
  if (!record) {
    toast("Project not found", "It may have been deleted.", true);
    useProjectStore.getState().removeRecentProject(id);
    return;
  }

  // Clean slate (disposes old geometries, revokes old URLs).
  resetProjectState();

  const data = deserializeProject(record);
  createdAtById.set(record.id, record.createdAt);

  // Order matters: history first, then geometry, then the sentinel URL LAST
  // (setting stlUrl mounts ModelMesh, which skips loading on the sentinel).
  useHistoryStore.getState().hydrate(data.versions, data.activeId);
  useMeshEditStore.getState().hydrateFromProject({
    baseGeometry: data.baseGeometry,
    workingGeometry: data.workingGeometry,
  });

  // A real blob URL so slice/export (which prefer editedStlUrl) work.
  let editedStlUrl: string | null = null;
  if (data.activeGeometry) {
    editedStlUrl = URL.createObjectURL(exportAsStl(data.activeGeometry, true));
    restoredUrls.add(editedStlUrl);
  }

  let boundingBox: { x: number; y: number; z: number } | null = null;
  if (data.activeGeometry) {
    data.activeGeometry.computeBoundingBox();
    const box = data.activeGeometry.boundingBox;
    if (box) {
      boundingBox = {
        x: box.max.x - box.min.x,
        y: box.max.y - box.min.y,
        z: box.max.z - box.min.z,
      };
    }
  }

  useGenerationStore.getState().hydrateForRestore({
    prompt: data.prompt,
    modelSource: data.modelSource,
    referenceImageUrl: data.referenceImageUrl,
    boundingBox,
    editedStlUrl,
  });

  useProjectStore.getState().setCurrentProject(record.id, record.name);
  if (boundingBox) useViewerStore.getState().setModelBounds(boundingBox);
  useViewerStore.getState().requestFit("model");
}

/** Rename a saved project (updates IndexedDB + the open project if it's the one). */
export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const record = await getProject(id);
  if (!record) return;
  record.name = trimmed;
  record.updatedAt = Date.now();
  try {
    await putProject(record);
  } catch (err) {
    console.error("[project] rename failed:", err);
    return;
  }
  const store = useProjectStore.getState();
  store.addRecentProject({
    id,
    name: trimmed,
    updatedAt: new Date(record.updatedAt).toISOString(),
    thumbnailDataUrl: record.thumbnailDataUrl,
  });
  if (store.currentProjectId === id) store.setCurrentProject(id, trimmed);
}

/** Delete a project from IndexedDB + recents. Starts a fresh project if it was open. */
export async function deleteProject(id: string): Promise<void> {
  try {
    await dbDeleteProject(id);
  } catch (err) {
    console.error("[project] delete failed:", err);
  }
  useProjectStore.getState().removeRecentProject(id);
  createdAtById.delete(id);
  if (useProjectStore.getState().currentProjectId === id) createNewProject();
}

/** On app start: open the most-recently-updated project, or begin a fresh one. */
export async function openMostRecentOrNew(): Promise<void> {
  try {
    const projects = await listProjects();
    if (projects.length > 0) {
      await loadProject(projects[0].id);
      return;
    }
  } catch (err) {
    console.error("[project] failed to list projects on startup:", err);
  }
  createNewProject();
}
