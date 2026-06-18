import { create } from "zustand";
import type { ViewMode } from "@/lib/constants";

export interface ModelTransform {
  scale: [number, number, number];
  rotation: [number, number, number]; // degrees, applied as XYZ Euler
  position: [number, number, number]; // mm
}

export const IDENTITY_TRANSFORM: ModelTransform = {
  scale:    [1, 1, 1],
  rotation: [0, 0, 0],
  position: [0, 0, 0],
};

/** Size (X/Y/Z extents, in scene units) of the currently loaded geometry.
 *  Geometry is centered on X/Z with its bottom at Y=0, so size fully describes
 *  the un-transformed bounding box. Shared so the overlay, bounding-box helper,
 *  and print-volume check all use the same numbers without re-loading the mesh. */
export interface ModelBounds {
  x: number;
  y: number;
  z: number;
}

export interface ViewerStore {
  viewMode: ViewMode;
  showBoundingBox: boolean;
  showGrid: boolean;
  showPrintBed: boolean;
  isMeasuring: boolean;
  measurePoints: [number, number, number][];
  measureDistance: number | null;
  modelTransform: ModelTransform;
  /** Raw (un-transformed) extents of the loaded model, or null when nothing is loaded. */
  modelBounds: ModelBounds | null;
  /** Bumped to request a one-shot camera fit from outside the Canvas. */
  fitNonce: number;
  /** What the next fit should frame — the model, or the whole printer build volume. */
  fitTarget: "model" | "printer";
  /** Active in-viewport transform gizmo. "off" = no gizmo (orbit only). */
  gizmoMode: "off" | "translate" | "rotate" | "scale";

  setViewMode: (m: ViewMode) => void;
  setGizmoMode: (m: ViewerStore["gizmoMode"]) => void;
  toggleBoundingBox: () => void;
  toggleGrid: () => void;
  togglePrintBed: () => void;
  toggleMeasure: () => void;
  addMeasurePoint: (pt: [number, number, number]) => void;
  clearMeasure: () => void;
  setTransform: (t: Partial<ModelTransform>) => void;
  resetTransform: () => void;
  setModelBounds: (b: ModelBounds | null) => void;
  requestFit: (target?: "model" | "printer") => void;
}

export const useViewerStore = create<ViewerStore>((set) => ({
  viewMode: "solid",
  showBoundingBox: false,
  showGrid: true,
  showPrintBed: true,
  isMeasuring: false,
  measurePoints: [],
  measureDistance: null,
  modelTransform: { ...IDENTITY_TRANSFORM },
  modelBounds: null,
  fitNonce: 0,
  fitTarget: "model",
  gizmoMode: "off",

  setViewMode: (m) => set({ viewMode: m }),
  setGizmoMode: (m) => set({ gizmoMode: m }),
  toggleBoundingBox: () => set((s) => ({ showBoundingBox: !s.showBoundingBox })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  togglePrintBed: () => set((s) => ({ showPrintBed: !s.showPrintBed })),
  toggleMeasure: () => set((s) => ({ isMeasuring: !s.isMeasuring, measurePoints: [], measureDistance: null })),
  addMeasurePoint: (pt) =>
    set((s) => {
      const pts = [...s.measurePoints, pt] as [number, number, number][];
      if (pts.length === 2) {
        const [a, b] = pts;
        const d = Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2);
        return { measurePoints: pts, measureDistance: Math.round(d * 100) / 100, isMeasuring: false };
      }
      return { measurePoints: pts };
    }),
  clearMeasure: () => set({ measurePoints: [], measureDistance: null }),
  setTransform: (t) =>
    set((s) => ({ modelTransform: { ...s.modelTransform, ...t } })),
  resetTransform: () => set({ modelTransform: { ...IDENTITY_TRANSFORM } }),
  // Setting fresh bounds = a new model loaded → auto-fit should frame the model,
  // not whatever the last Fit Printer click left behind.
  setModelBounds: (b) => set(b ? { modelBounds: b, fitTarget: "model" } : { modelBounds: b }),
  requestFit: (target = "model") => set((s) => ({ fitTarget: target, fitNonce: s.fitNonce + 1 })),
}));
