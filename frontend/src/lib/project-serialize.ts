import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { exportAsStl } from "@/lib/mesh-convert";
import { renderGeometryThumbnail } from "@/lib/mesh-thumbnail";
import type { Version } from "@/stores/historyStore";
import type { StoredProject, StoredVersion } from "@/lib/project-db";

/**
 * Bridges the in-memory version-history timeline (THREE.BufferGeometry) and the
 * persisted IndexedDB record (binary STL). Kept apart from `project-db.ts` so the
 * DB layer stays free of THREE.
 *
 * STL is triangle-soup — it drops the index, UVs, and vertex colors, but the app
 * already reduces every model to position+normal (see ModelMesh.flattenToGeometry)
 * and recomputes normals on load, so the round-trip is lossless for our purposes.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  prompt: string;
  referenceImageUrl?: string | null;
  modelSource: "generated" | "uploaded" | null;
}

/** Hydrated form ready to push into the stores (geometries are independent clones). */
export interface DeserializedProject {
  versions: Version[];
  activeId: string | null;
  /** The milestone geometry (versions[0]) — meshEditStore.baseGeometry. */
  baseGeometry: THREE.BufferGeometry | null;
  /** The active version's geometry when it isn't the milestone, else null. */
  workingGeometry: THREE.BufferGeometry | null;
  /** What the viewer/slicer should show = workingGeometry ?? baseGeometry. */
  activeGeometry: THREE.BufferGeometry | null;
  prompt: string;
  referenceImageUrl: string | null;
  modelSource: "generated" | "uploaded" | null;
}

async function geometryToStl(geometry: THREE.BufferGeometry): Promise<ArrayBuffer> {
  const blob = exportAsStl(geometry, true);
  return blob.arrayBuffer();
}

function stlToGeometry(stl: ArrayBuffer): THREE.BufferGeometry {
  const geometry = new STLLoader().parse(stl);
  geometry.computeVertexNormals();
  return geometry;
}

/** Build a persistable record from the current timeline. */
export async function serializeProject(
  meta: ProjectMeta,
  versions: Version[],
  activeId: string | null,
): Promise<StoredProject> {
  const storedVersions: StoredVersion[] = [];
  for (const v of versions) {
    storedVersions.push({
      id: v.id,
      timestamp: v.timestamp,
      label: v.label,
      source: v.source,
      featureId: v.featureId,
      params: v.params,
      stl: await geometryToStl(v.geometry),
    });
  }

  // Thumbnail of the active (displayed) version so the project list shows the
  // model as the user last left it.
  const active = versions.find((v) => v.id === activeId) ?? versions[versions.length - 1];
  const thumbnailDataUrl = active ? renderGeometryThumbnail(active.geometry) ?? undefined : undefined;

  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: Date.now(),
    thumbnailDataUrl,
    inputs: { prompt: meta.prompt, referenceImageUrl: meta.referenceImageUrl ?? null },
    modelSource: meta.modelSource,
    activeVersionId: activeId,
    versions: storedVersions,
  };
}

/** Rebuild geometries + timeline from a stored record. */
export function deserializeProject(record: StoredProject): DeserializedProject {
  const versions: Version[] = record.versions.map((v) => ({
    id: v.id,
    timestamp: v.timestamp,
    label: v.label,
    source: v.source,
    featureId: v.featureId,
    params: v.params,
    geometry: stlToGeometry(v.stl),
  }));

  const activeId = record.activeVersionId ?? (versions.length ? versions[versions.length - 1].id : null);
  const milestone = versions[0] ?? null;
  const active = versions.find((v) => v.id === activeId) ?? versions[versions.length - 1] ?? null;

  // meshEditStore owns geometry separately from history's clones, so clone for it.
  const baseGeometry = milestone ? milestone.geometry.clone() : null;
  const workingGeometry =
    active && milestone && active.id !== milestone.id ? active.geometry.clone() : null;
  const activeGeometry = workingGeometry ?? baseGeometry;

  return {
    versions,
    activeId,
    baseGeometry,
    workingGeometry,
    activeGeometry,
    prompt: record.inputs.prompt ?? "",
    referenceImageUrl: record.inputs.referenceImageUrl ?? null,
    modelSource: record.modelSource,
  };
}
