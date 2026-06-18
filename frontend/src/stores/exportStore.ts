import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FACTORY_PROFILE, type SlicerSettings } from "@/lib/slicer-profile";

export type { SlicerSettings } from "@/lib/slicer-profile";

export interface SliceStats {
  layerCount: number;
  estimatedTimeMinutes: number;
  filamentUsageMm: number;
  filamentUsageGrams: number;
}

export interface ExportStore {
  slicerSettings: SlicerSettings;
  /** The user's saved default profile — the "Reset to default" target. */
  savedDefault: SlicerSettings;
  /** Active printer id — a built-in preset id or a custom printer's uuid. */
  printerPreset: string;
  sliceStatus: "idle" | "slicing" | "done" | "error";
  sliceError: string | null;
  gcodeUrl: string | null;
  gcodePreview: string;
  sliceStats: SliceStats | null;

  updateSettings: (s: Partial<SlicerSettings>) => void;
  /** Persist the current settings as the new default. */
  saveAsDefault: () => void;
  /** Revert current settings to the saved default. */
  resetToDefault: () => void;
  /** Revert both current settings AND the saved default to the factory profile. */
  resetToFactory: () => void;
  setPresetId: (id: string) => void;
  setSliceStatus: (s: ExportStore["sliceStatus"]) => void;
  setSliceResult: (r: { gcodeUrl: string; stats: SliceStats; preview: string }) => void;
  setSliceError: (e: string) => void;
}

export const useExportStore = create<ExportStore>()(
  persist(
    (set) => ({
      slicerSettings: { ...FACTORY_PROFILE },
      savedDefault: { ...FACTORY_PROFILE },
      printerPreset: "gen3d",
      sliceStatus: "idle",
      sliceError: null,
      gcodeUrl: null,
      gcodePreview: "",
      sliceStats: null,

      updateSettings: (s) =>
        set((state) => ({ slicerSettings: { ...state.slicerSettings, ...s } })),
      saveAsDefault: () =>
        set((state) => ({ savedDefault: { ...state.slicerSettings } })),
      resetToDefault: () =>
        set((state) => ({ slicerSettings: { ...state.savedDefault } })),
      resetToFactory: () =>
        set({ slicerSettings: { ...FACTORY_PROFILE }, savedDefault: { ...FACTORY_PROFILE } }),
      setPresetId: (id) => set({ printerPreset: id }),
      setSliceStatus: (s) => set({ sliceStatus: s }),
      setSliceResult: (r) =>
        set({ gcodeUrl: r.gcodeUrl, sliceStats: r.stats, gcodePreview: r.preview, sliceStatus: "done" }),
      setSliceError: (e) => set({ sliceError: e, sliceStatus: "error" }),
    }),
    {
      name: "g3d-slicer",
      // Persist only the profile + saved default; transient slice state stays out.
      partialize: (s) => ({ slicerSettings: s.slicerSettings, savedDefault: s.savedDefault }),
      // Backfill any new fields added to the profile over time.
      merge: (persisted, current) => {
        const p = persisted as Partial<ExportStore> | undefined;
        return {
          ...current,
          ...(p ?? {}),
          slicerSettings: { ...FACTORY_PROFILE, ...(p?.slicerSettings ?? {}) },
          savedDefault: { ...FACTORY_PROFILE, ...(p?.savedDefault ?? {}) },
        };
      },
    },
  ),
);

/** Shallow-equality check used by the UI to know if settings differ from the saved default. */
export function settingsAreDefault(s: SlicerSettings, def: SlicerSettings): boolean {
  return (Object.keys(def) as (keyof SlicerSettings)[]).every((k) => s[k] === def[k]);
}
