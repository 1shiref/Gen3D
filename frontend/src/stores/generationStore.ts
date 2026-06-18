import { create } from "zustand";
import type { GenerationStatus } from "@/lib/constants";

export interface DimensionCheck {
  actual: { x: number; y: number; z: number };
  declared: { x: number; y: number; z: number } | null;
  mismatchFactor: number | null;
  scaleToDeclared: number | null;
  exceedsBed: boolean;
  bed: { w: number; d: number; h: number };
  scaleToFitBed: number | null;
}

export interface GenerationStore {
  // Input
  images: File[];
  prompt: string;
  /** Engine ids to run on Generate (empty = all available). Drives multi-candidate generation. */
  selectedEngines: string[];
  /** null = Auto (use full fallback chain); otherwise entry id to try first. */
  forceProviderId: string | null;

  // Output
  status: GenerationStatus;
  statusMessage: string | null;
  stlUrl: string | null;
  /** STL URL of the locally mesh-edited model (overrides stlUrl for slicing/export). */
  editedStlUrl: string | null;
  previewUrl: string | null;
  boundingBox: { x: number; y: number; z: number } | null;
  dimensionCheck: DimensionCheck | null;
  materialSuggestion: string | null;
  printabilityWarnings: string[];
  suggestedDimensions: string | null;
  errorMessage: string | null;
  /** Servable URL (or blob URL) of the source image the current model was generated from.
   *  Persists past the photo-review step so it can be shown as a viewer reference thumbnail. */
  referenceImageUrl: string | null;
  /**
   * Origin of the currently-loaded model:
   *  - "generated" → AI-produced from prompt/images
   *  - "uploaded"  → user-uploaded file (STL/OBJ/GLTF)
   *  - null        → nothing loaded yet
   */
  modelSource: "generated" | "uploaded" | null;

  // Actions
  setImages: (files: File[]) => void;
  setPrompt: (p: string) => void;
  setSelectedEngines: (ids: string[]) => void;
  setForceProviderId: (id: string | null) => void;
  setStatus: (s: GenerationStatus) => void;
  setStatusMessage: (msg: string | null) => void;
  setStlReady: (payload: {
    url: string;
    previewUrl?: string | null;
    boundingBox: { x: number; y: number; z: number };
    dimensionCheck?: DimensionCheck | null;
    materialSuggestion?: string;
    printabilityWarnings?: string[];
    suggestedDimensions?: string;
  }) => void;
  /** Load an externally uploaded 3D model into the viewer. */
  setUploadedModel: (payload: { url: string; originalName: string }) => void;
  setEditedStlUrl: (url: string | null) => void;
  setReferenceImageUrl: (url: string | null) => void;
  setError: (msg: string) => void;
  reset: () => void;
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  images: [],
  prompt: "",
  selectedEngines: [],
  forceProviderId: null,
  status: "idle",
  statusMessage: null,
  stlUrl: null,
  editedStlUrl: null,
  previewUrl: null,
  boundingBox: null,
  dimensionCheck: null,
  materialSuggestion: null,
  printabilityWarnings: [],
  suggestedDimensions: null,
  errorMessage: null,
  referenceImageUrl: null,
  modelSource: null,

  setImages: (files) => set({ images: files }),
  setPrompt: (p) => set({ prompt: p }),
  setSelectedEngines: (ids) => set({ selectedEngines: ids }),
  setForceProviderId: (id) => set({ forceProviderId: id }),
  setStatus: (s) => set({ status: s }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setStlReady: (payload) =>
    set({
      stlUrl: payload.url,
      editedStlUrl: null,
      previewUrl: payload.previewUrl ?? null,
      boundingBox: payload.boundingBox,
      dimensionCheck: payload.dimensionCheck ?? null,
      materialSuggestion: payload.materialSuggestion ?? null,
      printabilityWarnings: payload.printabilityWarnings ?? [],
      suggestedDimensions: payload.suggestedDimensions ?? null,
      status: "done",
      modelSource: "generated",
    }),
  setUploadedModel: ({ url }) =>
    set({
      stlUrl: url,
      editedStlUrl: null,
      previewUrl: null,
      boundingBox: null,
      dimensionCheck: null,
      materialSuggestion: null,
      printabilityWarnings: [],
      suggestedDimensions: null,
      errorMessage: null,
      status: "done",
      modelSource: "uploaded",
    }),
  setEditedStlUrl: (url) => set({ editedStlUrl: url }),
  setReferenceImageUrl: (url) => set({ referenceImageUrl: url }),
  setError: (msg) => set({ errorMessage: msg, status: "error" }),
  reset: () =>
    set({
      status: "idle",
      statusMessage: null,
      errorMessage: null,
      printabilityWarnings: [],
      referenceImageUrl: null,
    }),
}));
