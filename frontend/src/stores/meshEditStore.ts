import * as THREE from "three";
import { create } from "zustand";
import { exportAsStl } from "@/lib/mesh-convert";
import { uuid } from "@/lib/uuid";
import { uploadModel } from "@/lib/api";
import { useGenerationStore } from "@/stores/generationStore";
import { useViewerStore, IDENTITY_TRANSFORM, type ModelTransform } from "@/stores/viewerStore";
import { FEATURES, coerceParams, splitPartGeometries, type FeatureParams } from "@/lib/mesh-edit/features";
import { bakeMatrix, mergeParts } from "@/lib/mesh-edit/operations";
import { useHistoryStore, type VersionSource } from "@/stores/historyStore";

export interface MeshEditDraft {
  feature: string;
  params: FeatureParams;
}

/** A single split piece, rendered as its own selectable/movable object in the viewer.
 *  `geometry` is the placed slab; `transform` accumulates the user's per-part gizmo edits. */
export interface MeshPart {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: ModelTransform;
}

/** Distinct colours so adjacent split pieces are easy to tell apart even when they
 *  sit flush against each other (kept in their assembled position). Shared by the
 *  viewer (`ModelMesh`) and the Parts list (`PartsPanel`). */
export const PART_COLORS = ["#4f9dff", "#ff8a4f", "#57c785", "#c77dff", "#ffd24f", "#ff6b8a", "#4fd6d6", "#9ca3af"];
export const partColor = (i: number): string => PART_COLORS[((i % PART_COLORS.length) + PART_COLORS.length) % PART_COLORS.length];

const newPartId = () => `part-${uuid()}`;

/** A fresh identity transform with its own arrays (never share IDENTITY_TRANSFORM's arrays). */
const identityTransform = (): ModelTransform => ({
  scale: [...IDENTITY_TRANSFORM.scale],
  rotation: [...IDENTITY_TRANSFORM.rotation],
  position: [...IDENTITY_TRANSFORM.position],
});

/** Context recorded alongside a new geometry so the version history can label it. */
interface EditContext {
  source: VersionSource;
  label: string;
  featureId?: string;
  params?: FeatureParams;
}

interface MeshEditStore {
  /** Geometry as loaded from the model URL (the pipeline's current model). */
  baseGeometry: THREE.BufferGeometry | null;
  /** Geometry after local mesh edits; overrides base in the viewer. */
  workingGeometry: THREE.BufferGeometry | null;
  busy: boolean;
  error: string | null;
  /** Active in-viewport CSG edit being positioned with handles (split/hole). */
  draft: MeshEditDraft | null;

  /** Split pieces as independent objects (parts mode); null when not in a split. */
  parts: MeshPart[] | null;
  /** Currently selected part (for gizmo + delete/duplicate), or null. */
  selectedPartId: string | null;

  /** Called by ModelMesh when a fresh model loads — resets all edit state. */
  setBaseGeometry: (g: THREE.BufferGeometry | null) => void;
  current: () => THREE.BufferGeometry | null;
  applyFeature: (featureId: string, params?: FeatureParams, source?: "tool" | "smart-plan") => Promise<void>;
  /** Bake the live viewer transform (gizmo) into the geometry as a real edit. */
  commitTransform: () => Promise<void>;
  /** Display a geometry restored from version history (no new version recorded here). */
  applyRestoredGeometry: (geo: THREE.BufferGeometry) => Promise<void>;
  undo: () => void;
  reset: () => void;
  /** Seed base/working geometry from a restored project WITHOUT recording a
   *  milestone or re-normalizing (unlike setBaseGeometry). History is hydrated
   *  separately by the project loader. */
  hydrateFromProject: (payload: {
    baseGeometry: THREE.BufferGeometry | null;
    workingGeometry: THREE.BufferGeometry | null;
  }) => void;
  /** Full wipe for a blank project: drops + disposes base/working/parts geometry. */
  clearAll: () => void;

  startDraft: (featureId: string, initial?: FeatureParams) => void;
  updateDraftParam: (key: string, value: FeatureParams[string]) => void;
  cancelDraft: () => void;
  applyDraft: () => Promise<void>;

  // ── Parts mode (after Split) ──────────────────────────────────────────────
  /** Select a part for the gizmo / delete / duplicate (mirrors 3D click + list click). */
  selectPart: (id: string | null) => void;
  /** Update a part's live transform (called continuously from the gizmo). Cheap; no merge/upload. */
  setPartTransform: (id: string, transform: ModelTransform) => void;
  /** Rebuild the merged sliceable geometry from live parts + upload STL (drag end / explicit). */
  commitParts: () => Promise<void>;
  /** Remove a part; re-selects a neighbor and re-merges. Exits parts mode if none remain. */
  deletePart: (id: string) => Promise<void>;
  /** Clone a part as a new independent object, offset along X. */
  duplicatePart: (id: string) => Promise<void>;
}

function disposeIfOrphan(g: THREE.BufferGeometry | null, keep: (THREE.BufferGeometry | null)[]) {
  if (g && !keep.includes(g)) g.dispose();
}

function isIdentity(t: ModelTransform): boolean {
  return t.scale.every((v) => v === 1) && t.rotation.every((v) => v === 0) && t.position.every((v) => v === 0);
}

/** Compose the viewer transform into a world matrix (T · R · S — matches ModelMesh). */
function transformMatrix(t: ModelTransform): THREE.Matrix4 {
  const pos = new THREE.Vector3(...t.position);
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((t.rotation[0] * Math.PI) / 180, (t.rotation[1] * Math.PI) / 180, (t.rotation[2] * Math.PI) / 180, "XYZ"),
  );
  const scale = new THREE.Vector3(...t.scale);
  return new THREE.Matrix4().compose(pos, quat, scale);
}

export const useMeshEditStore = create<MeshEditStore>((set, get) => ({
  baseGeometry: null,
  workingGeometry: null,
  busy: false,
  error: null,
  draft: null,
  parts: null,
  selectedPartId: null,

  setBaseGeometry: (g) => {
    // New model from the pipeline — drop edits, draft, parts, and the edited-STL override.
    useGenerationStore.getState().setEditedStlUrl(null);
    disposePartGeometries(get().parts);
    set({ baseGeometry: g, workingGeometry: null, draft: null, error: null, parts: null, selectedPartId: null });
    // Record the freshly-loaded model as a milestone that starts a new timeline.
    if (g) {
      const modelSource = useGenerationStore.getState().modelSource;
      const source: VersionSource = modelSource === "uploaded" ? "upload" : "generate";
      const label = modelSource === "uploaded" ? "Uploaded model" : "Generated model";
      useHistoryStore.getState().record({ geometry: g, source, label, isMilestone: true });
    }
  },

  current: () => get().workingGeometry ?? get().baseGeometry,

  applyFeature: async (featureId, raw = {}, source = "tool") => {
    const feature = FEATURES[featureId];
    if (!feature) {
      set({ error: `Unknown feature: ${featureId}` });
      return;
    }
    const cur = get().current();
    if (!cur) {
      set({ error: "No model loaded" });
      return;
    }

    set({ busy: true, error: null });
    try {
      const params = coerceParams(feature, raw);
      // CSG/transform is synchronous; yield a frame first so the spinner paints.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Bake any pending gizmo transform first so e.g. rotate-then-split composes.
      const baked = bakePendingTransform(cur);

      // Split is special: produce independent piece geometries and enter parts mode
      // instead of collapsing into a single merged mesh.
      if (featureId === "split_parts") {
        const geos = splitPartGeometries(baked, params);
        await enterPartsMode(set, get, geos, { source, label: feature.label, featureId, params });
        return;
      }

      // Any other feature collapses parts mode back to the single (merged) geometry first.
      if (get().parts) {
        disposePartGeometries(get().parts);
        set({ parts: null, selectedPartId: null });
      }

      const next = feature.apply(baked, params);
      await pushGeometry(set, get, next, { source, label: feature.label, featureId, params });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      set({ error: msg });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  commitTransform: async () => {
    const t = useViewerStore.getState().modelTransform;
    if (isIdentity(t)) return;
    const cur = get().current();
    if (!cur) return;
    set({ busy: true, error: null });
    try {
      const next = bakeMatrix(cur, transformMatrix(t));
      await pushGeometry(set, get, next, { source: "gizmo", label: "Transform (gizmo)" });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Apply failed" });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  applyRestoredGeometry: async (geo) => {
    const prev = get().workingGeometry;
    // Restoring a version leaves parts mode — go back to a single editable geometry.
    disposePartGeometries(get().parts);
    set({ workingGeometry: geo, draft: null, error: null, parts: null, selectedPartId: null });
    useViewerStore.getState().resetTransform();
    // The previous display geometry isn't referenced by history (it keeps clones), so free it.
    disposeIfOrphan(prev, [get().baseGeometry, geo]);
    await syncEditedStl(geo);
  },

  hydrateFromProject: ({ baseGeometry, workingGeometry }) => {
    disposePartGeometries(get().parts);
    set({
      baseGeometry,
      workingGeometry,
      draft: null,
      error: null,
      parts: null,
      selectedPartId: null,
    });
    useViewerStore.getState().resetTransform();
    const display = workingGeometry ?? baseGeometry;
    if (display) refreshBounds(display);
  },

  clearAll: () => {
    const { baseGeometry, workingGeometry, parts } = get();
    disposePartGeometries(parts);
    if (workingGeometry && workingGeometry !== baseGeometry) workingGeometry.dispose();
    baseGeometry?.dispose();
    set({ baseGeometry: null, workingGeometry: null, draft: null, parts: null, selectedPartId: null, error: null });
    useViewerStore.getState().resetTransform();
    useGenerationStore.getState().setEditedStlUrl(null);
  },

  // Undo walks the version timeline back one step (Ctrl+Z); no new version is appended.
  undo: () => useHistoryStore.getState().stepBack(),

  reset: () => {
    const { workingGeometry, baseGeometry, parts } = get();
    disposeIfOrphan(workingGeometry, [baseGeometry]);
    disposePartGeometries(parts);
    set({ workingGeometry: null, draft: null, parts: null, selectedPartId: null });
    useViewerStore.getState().resetTransform();
    useGenerationStore.getState().setEditedStlUrl(null);
    // Point the history back at the loaded model without discarding edit versions.
    const versions = useHistoryStore.getState().versions;
    if (versions.length > 0) useHistoryStore.setState({ activeId: versions[0].id });
  },

  startDraft: (featureId, initial) => {
    const feature = FEATURES[featureId];
    if (!feature) return;
    // Drafts and the transform gizmo are mutually exclusive.
    useViewerStore.getState().setGizmoMode("off");
    set({ draft: { feature: featureId, params: coerceParams(feature, initial ?? {}) } });
  },

  updateDraftParam: (key, value) =>
    set((s) => (s.draft ? { draft: { ...s.draft, params: { ...s.draft.params, [key]: value } } } : {})),

  cancelDraft: () => set({ draft: null }),

  applyDraft: async () => {
    const d = get().draft;
    if (!d) return;
    set({ draft: null });
    await get().applyFeature(d.feature, d.params);
  },

  selectPart: (id) => set({ selectedPartId: id }),

  setPartTransform: (id, transform) =>
    set((s) =>
      s.parts ? { parts: s.parts.map((p) => (p.id === id ? { ...p, transform } : p)) } : {},
    ),

  commitParts: async () => {
    await syncParts(set, get);
  },

  deletePart: async (id) => {
    const parts = get().parts;
    if (!parts) return;
    const idx = parts.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const victim = parts[idx];
    const remaining = parts.filter((p) => p.id !== id);

    if (remaining.length === 0) {
      // Nothing left — leave parts mode and clear the model edit.
      victim.geometry.dispose();
      const prev = get().workingGeometry;
      set({ parts: null, selectedPartId: null, workingGeometry: null });
      disposeIfOrphan(prev, [get().baseGeometry]);
      useViewerStore.getState().resetTransform();
      await syncEditedStl(null);
      return;
    }

    // Re-select a neighbor if the deleted part was selected.
    const wasSelected = get().selectedPartId === id;
    const nextSel = wasSelected ? remaining[Math.min(idx, remaining.length - 1)].id : get().selectedPartId;
    set({ parts: remaining, selectedPartId: nextSel });
    victim.geometry.dispose();
    await syncParts(set, get);
  },

  duplicatePart: async (id) => {
    const parts = get().parts;
    if (!parts) return;
    const src = parts.find((p) => p.id === id);
    if (!src) return;
    src.geometry.computeBoundingBox();
    const w = src.geometry.boundingBox!.getSize(new THREE.Vector3()).x;
    const clone: MeshPart = {
      id: newPartId(),
      geometry: src.geometry.clone(),
      // Offset the copy along X (on top of the source's current transform) so it's visible.
      transform: {
        scale: [...src.transform.scale],
        rotation: [...src.transform.rotation],
        position: [src.transform.position[0] + w + 10, src.transform.position[1], src.transform.position[2]],
      },
    };
    set({ parts: [...parts, clone], selectedPartId: clone.id });
    await syncParts(set, get);
  },
}));

/** Enter parts mode from a set of freshly-split piece geometries. Records ONE history
 *  version of the merged result so Undo/History still work. */
async function enterPartsMode(
  set: (partial: Partial<MeshEditStore>) => void,
  get: () => MeshEditStore,
  geos: THREE.BufferGeometry[],
  ctx: EditContext,
): Promise<void> {
  // No pieces (every CSG slice came back empty). Surface it and leave the current model
  // untouched — entering parts mode with nothing would blank the viewer. (splitPartGeometries
  // already throws in this case; this is a belt-and-suspenders guard for any other caller.)
  if (geos.length === 0) {
    set({ error: "Split produced no pieces" });
    return;
  }
  disposePartGeometries(get().parts);
  // Keep each piece in its original (assembled) position — they read as a whole model
  // but are individually selectable/movable. The viewer paints each a distinct colour
  // (see `partColor`) so flush pieces are still easy to tell apart.
  const parts: MeshPart[] = geos.map((geometry) => ({
    id: newPartId(),
    geometry,
    transform: identityTransform(),
  }));
  const prevDisplay = get().workingGeometry;
  const merged = mergeParts(geos);
  set({ parts, selectedPartId: parts[0]?.id ?? null, workingGeometry: merged });
  useViewerStore.getState().resetTransform();
  // One timeline entry for the whole split (part moves/deletes don't push versions).
  useHistoryStore.getState().record({ geometry: merged, ...ctx });
  disposeIfOrphan(prevDisplay, [get().baseGeometry, merged]);
  refreshBounds(merged);
  await syncEditedStl(merged);
}

/** Bake each live part's transform, merge into one centered geometry, and keep the
 *  sliceable STL + shared bounds in step. Heavy (CSG merge + upload) → call on commit
 *  events (drag end / delete / duplicate), not on every gizmo frame. */
async function syncParts(
  set: (partial: Partial<MeshEditStore>) => void,
  get: () => MeshEditStore,
): Promise<void> {
  const parts = get().parts;
  if (!parts || parts.length === 0) return;
  const prev = get().workingGeometry;
  const baked = parts.map((p) =>
    isIdentity(p.transform) ? p.geometry : bakeMatrix(p.geometry, transformMatrix(p.transform), { seatOnBed: false }),
  );
  const merged = mergeParts(baked);
  set({ workingGeometry: merged });
  refreshBounds(merged);
  disposeIfOrphan(prev, [get().baseGeometry, merged, ...parts.map((p) => p.geometry)]);
  await syncEditedStl(merged);
}

function refreshBounds(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  // An empty/degenerate merge yields non-finite bounds; pushing those would make the
  // camera fit-to-view fly off and the model "disappear". Keep the prior bounds instead.
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)) return;
  useViewerStore.getState().setModelBounds({ x: size.x, y: size.y, z: size.z });
}

function disposePartGeometries(parts: MeshPart[] | null): void {
  if (parts) for (const p of parts) p.geometry.dispose();
}

/** Push a new display geometry: set it, record a version, clear the preview transform, upload STL. */
async function pushGeometry(
  set: (partial: Partial<MeshEditStore>) => void,
  get: () => MeshEditStore,
  next: THREE.BufferGeometry,
  ctx: EditContext,
): Promise<void> {
  const prevDisplay = get().workingGeometry; // null on first edit (was base)
  set({ workingGeometry: next });
  useViewerStore.getState().resetTransform();
  // History keeps its own clone, so the previous display geometry is now orphaned.
  useHistoryStore.getState().record({ geometry: next, ...ctx });
  disposeIfOrphan(prevDisplay, [get().baseGeometry, next]);
  await syncEditedStl(next);
}

/** Apply the live viewer transform to a geometry (no-op if identity). */
function bakePendingTransform(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const t = useViewerStore.getState().modelTransform;
  if (isIdentity(t)) return geo;
  return bakeMatrix(geo, transformMatrix(t));
}

/**
 * Keep the sliceable STL in step with the edited geometry. Null → clear the
 * override so slicing falls back to the original model URL.
 */
async function syncEditedStl(geo: THREE.BufferGeometry | null): Promise<void> {
  const gen = useGenerationStore.getState();
  if (!geo) {
    gen.setEditedStlUrl(null);
    return;
  }
  try {
    const blob = exportAsStl(geo, true);
    const file = new File([blob], "edited.stl", { type: "model/stl" });
    const { url } = await uploadModel(file);
    useGenerationStore.getState().setEditedStlUrl(url);
  } catch (err) {
    console.error("[meshEdit] failed to upload edited STL for slicing:", err);
    // Non-fatal: the viewer still shows the edit; slicing will warn if used.
  }
}
