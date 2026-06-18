import type { FeatureParams } from "@/lib/mesh-edit/features";
import type { VersionSource } from "@/stores/historyStore";

/**
 * Durable per-project storage in the browser via IndexedDB.
 *
 * Why IndexedDB (not localStorage): a project carries the full edit-history
 * timeline as binary STL blobs — far past localStorage's ~5 MB cap. Backend
 * upload files are also ephemeral (deleted after ~10 min), so the geometry must
 * live client-side to survive reloads and server restarts.
 *
 * One object store `projects`, keyed by id, with an `updatedAt` index for the
 * "recent first" list. STL ArrayBuffers are stored INLINE in the record — a
 * project is always read/written as a whole, so a single store + single
 * transaction is simplest. This module is pure IndexedDB (no THREE imports);
 * geometry (de)serialization lives in `project-serialize.ts`.
 */

const DB_NAME = "gen3d";
const DB_VERSION = 1;
const STORE = "projects";

/** One version-history entry, with its geometry frozen as a binary STL. */
export interface StoredVersion {
  id: string;
  timestamp: number;
  label: string;
  source: VersionSource;
  featureId?: string;
  params?: FeatureParams;
  /** Binary STL of this version's geometry. */
  stl: ArrayBuffer;
}

/** A whole project as persisted to IndexedDB. */
export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnailDataUrl?: string;
  inputs: { prompt: string; referenceImageUrl?: string | null };
  modelSource: "generated" | "uploaded" | null;
  activeVersionId: string | null;
  versions: StoredVersion[];
}

/** Lightweight row for the project list (no heavy `versions` payload). */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  thumbnailDataUrl?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

/** Promisify a single-request transaction; rejects on error/abort. */
function runRequest<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

/** True when an error is IndexedDB's quota-exceeded signal. */
export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
}

export function putProject(project: StoredProject): Promise<void> {
  return runRequest("readwrite", (s) => s.put(project)).then(() => undefined);
}

export function getProject(id: string): Promise<StoredProject | undefined> {
  return runRequest<StoredProject | undefined>("readonly", (s) => s.get(id));
}

export function deleteProject(id: string): Promise<void> {
  return runRequest("readwrite", (s) => s.delete(id)).then(() => undefined);
}

/** All projects as light summaries, newest-updated first (heavy `versions` stripped). */
export function listProjects(): Promise<ProjectSummary[]> {
  return runRequest<StoredProject[]>("readonly", (s) => s.getAll()).then((all) =>
    all
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        thumbnailDataUrl: p.thumbnailDataUrl,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );
}
