import { create } from "zustand";
import { getEngines, type EngineInfo } from "@/lib/api";

/**
 * Shared, cached catalog of generation engines from `/api/engines`. One source of truth so the
 * EnginePicker, the fal/HF/Both scope selectors, and the text→3D run all agree on what the
 * server actually offers (independent of which engines are checked, or whether an image exists).
 */
interface EngineStore {
  engines: EngineInfo[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Fetch the catalog once; no-op if already loaded or in flight. */
  load: () => Promise<void>;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  engines: [],
  loaded: false,
  loading: false,
  error: null,
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    try {
      const list = await getEngines();
      set({ engines: list, loaded: true, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** Ids of engines the server can actually run (a key is present / keyless). */
export const availableEngineIds = (engines: EngineInfo[]): string[] =>
  engines.filter((e) => e.available).map((e) => e.id);
