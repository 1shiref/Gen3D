import * as THREE from "three";
import { create } from "zustand";
import { useMeshEditStore } from "@/stores/meshEditStore";
import type { FeatureParams } from "@/lib/mesh-edit/features";

/** Keep at most this many versions; oldest non-milestone entries are evicted + disposed. */
const CAP = 20;

export type VersionSource =
  | "generate" // AI-produced model load
  | "upload" // user-uploaded model load
  | "candidate" // switched to another generated candidate
  | "tool" // Tools-tab / CSG-draft edit
  | "smart-plan" // Smart-plan step edit
  | "gizmo" // baked gizmo transform
  | "restore"; // jumped back to an earlier version

/** Model-load milestones — these are never evicted to make room under the cap. */
const MILESTONE_SOURCES: VersionSource[] = ["generate", "upload", "candidate"];

export interface Version {
  id: string;
  timestamp: number;
  /** Human label, e.g. "Rotate", "Generated model", "Restored: Add hole". */
  label: string;
  source: VersionSource;
  /** Cloned snapshot owned by this store (never the live editing geometry). */
  geometry: THREE.BufferGeometry;
  featureId?: string;
  params?: FeatureParams;
  /** Lazily-rendered preview, filled in when the History tab is shown. */
  thumbnail?: string;
}

interface RecordInput {
  geometry: THREE.BufferGeometry;
  source: VersionSource;
  label: string;
  featureId?: string;
  params?: FeatureParams;
  /** A fresh model load — starts a new timeline (clears prior versions). */
  isMilestone?: boolean;
}

interface HistoryStore {
  /** Oldest first; index 0 is the model-load milestone for the current timeline. */
  versions: Version[];
  /** Which version is currently shown in the viewer. */
  activeId: string | null;

  record: (input: RecordInput) => void;
  restore: (id: string) => Promise<void>;
  stepBack: () => void;
  canStepBack: () => boolean;
  setThumbnail: (id: string, dataUrl: string) => void;
  clear: () => void;
  /** Replace the timeline wholesale with versions restored from a saved project
   *  (no milestone recorded, no clear-on-load). Geometries are owned by the store. */
  hydrate: (versions: Version[], activeId: string | null) => void;
}

/** Geometries still referenced by the live edit store — never dispose these. */
function liveGeometries(): (THREE.BufferGeometry | null)[] {
  const m = useMeshEditStore.getState();
  return [m.baseGeometry, m.workingGeometry, ...(m.parts?.map((p) => p.geometry) ?? [])];
}

function disposeGeo(g: THREE.BufferGeometry | null, keep: (THREE.BufferGeometry | null)[]) {
  if (g && !keep.includes(g)) g.dispose();
}

/** Index of the active version (defaults to the newest when nothing is active). */
function activeIndex(versions: Version[], activeId: string | null): number {
  if (versions.length === 0) return -1;
  if (!activeId) return versions.length - 1;
  const idx = versions.findIndex((v) => v.id === activeId);
  return idx === -1 ? versions.length - 1 : idx;
}

/** Append a version and evict the oldest non-milestone entry if over the cap. */
function appendCapped(versions: Version[], next: Version): Version[] {
  const out = [...versions, next];
  if (out.length > CAP) {
    const idx = out.findIndex((v) => !MILESTONE_SOURCES.includes(v.source));
    const removeIdx = idx === -1 ? 0 : idx;
    const [removed] = out.splice(removeIdx, 1);
    disposeGeo(removed.geometry, [...liveGeometries(), ...out.map((v) => v.geometry)]);
  }
  return out;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  versions: [],
  activeId: null,

  record: (input) => {
    if (input.isMilestone) get().clear();
    const version: Version = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      label: input.label,
      source: input.source,
      geometry: input.geometry.clone(),
      featureId: input.featureId,
      params: input.params,
    };
    set({ versions: appendCapped(get().versions, version), activeId: version.id });
  },

  restore: async (id) => {
    const target = get().versions.find((v) => v.id === id);
    if (!target) return;
    const snapshot = target.geometry.clone();
    const version: Version = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      label: `Restored: ${target.label}`,
      source: "restore",
      geometry: snapshot,
      featureId: target.featureId,
      params: target.params,
    };
    set({ versions: appendCapped(get().versions, version), activeId: version.id });
    // Hand the viewer/slicer a fresh, independent copy of the snapshot.
    await useMeshEditStore.getState().applyRestoredGeometry(snapshot.clone());
  },

  stepBack: () => {
    const { versions, activeId } = get();
    const idx = activeIndex(versions, activeId);
    if (idx <= 0) return; // already at the original model
    const prev = versions[idx - 1];
    set({ activeId: prev.id });
    void useMeshEditStore.getState().applyRestoredGeometry(prev.geometry.clone());
  },

  canStepBack: () => activeIndex(get().versions, get().activeId) > 0,

  setThumbnail: (id, dataUrl) =>
    set((s) => ({ versions: s.versions.map((v) => (v.id === id ? { ...v, thumbnail: dataUrl } : v)) })),

  clear: () => {
    const keep = liveGeometries();
    for (const v of get().versions) disposeGeo(v.geometry, keep);
    set({ versions: [], activeId: null });
  },

  hydrate: (versions, activeId) => {
    // Drop whatever was here first (project switch already cleared, but be safe).
    const keep = liveGeometries();
    for (const v of get().versions) disposeGeo(v.geometry, keep);
    set({ versions, activeId: activeId ?? (versions.length ? versions[versions.length - 1].id : null) });
  },
}));
