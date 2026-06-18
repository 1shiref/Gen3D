import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Phase A (text → photo) review state, kept separate from the 3D generation lifecycle. */
export type ImageStage = "idle" | "generating" | "review";

/**
 * How the reviewable photo is produced:
 *   - "text"      : synthesize from the text prompt (text→image).
 *   - "reimagine" : uploaded image + text prompt → new photo (image→image).
 *   - "enhance"   : clean an uploaded image (upscale / background removal).
 */
export type StageMode = "text" | "reimagine" | "enhance";

/** Which provider(s) turn the confirmed photo into a 3D mesh. */
export type ProviderScope = "fal" | "hf" | "both";

/** Enhancement operations for the "enhance" mode. */
export interface RefineOps {
  removeBg: boolean;
  upscale: boolean;
}

export interface PendingImage {
  /** Uploads basename — passed back to /api/generate as an imageRefs entry. */
  ref: string;
  /** Servable URL for the preview. */
  url: string;
}

interface ImageStageStore {
  stage: ImageStage;
  /** The operation currently running / just ran — used only to label progress. */
  mode: StageMode;
  /** The starting image of the current chain (uploaded source, or null for text). For revert. */
  original: PendingImage | null;
  /** The working image: input to the next op, what the overlay shows, and what Confirm uses. */
  current: PendingImage | null;
  /** Stack of previous `current` values, for Undo. */
  history: PendingImage[];
  error: string | null;
  /** Provider scope for text→3D; overrides the engine selection. Persisted. Default HF. */
  provider: ProviderScope;
  /** When true, skip the photo review and run 3D automatically once the photo is ready. Persisted. */
  autoConfirm: boolean;
  /** Enhancement operations for the "enhance" mode. Persisted as a preference. */
  ops: RefineOps;

  /** Begin synthesizing a photo from text (fresh chain; keeps provider/autoConfirm/ops). */
  start: () => void;
  /** Seed the chain from an uploaded source image (sets original + current). Does not touch stage. */
  beginFromImage: (p: PendingImage) => void;
  /** Open the review workspace seeded with an image, without running any operation. */
  openFromImage: (p: PendingImage) => void;
  /** Enter the "generating" stage for the given operation. */
  beginOp: (mode: StageMode) => void;
  /** An operation produced a result — push the prior current to history and show it for review. */
  setResult: (p: PendingImage) => void;
  /** Step back one operation in the chain (→ previous current, or the original). */
  undo: () => void;
  setError: (msg: string) => void;
  setProvider: (p: ProviderScope) => void;
  setAutoConfirm: (v: boolean) => void;
  setOps: (ops: Partial<RefineOps>) => void;
  /** Leave the image stage (e.g. on confirm or new run). Keeps the user's persisted prefs. */
  reset: () => void;
}

const CLEARED = { mode: "text" as StageMode, original: null, current: null, history: [], error: null };

export const useImageStageStore = create<ImageStageStore>()(
  persist(
    (set) => ({
      stage: "idle",
      mode: "text",
      original: null,
      current: null,
      history: [],
      error: null,
      provider: "hf",
      autoConfirm: true,
      ops: { removeBg: true, upscale: false },

      start: () => set({ stage: "generating", ...CLEARED }),
      beginFromImage: (p) => set({ original: p, current: p, history: [], error: null }),
      openFromImage: (p) => set({ stage: "review", original: p, current: p, history: [], error: null }),
      beginOp: (mode) => set({ stage: "generating", mode, error: null }),
      setResult: (p) =>
        set((s) => ({
          stage: "review",
          current: p,
          history: s.current ? [...s.history, s.current] : s.history,
          error: null,
        })),
      undo: () =>
        set((s) => {
          if (s.history.length > 0) {
            const history = s.history.slice(0, -1);
            return { current: s.history[s.history.length - 1], history, stage: "review", error: null };
          }
          return { current: s.original, history: [], stage: "review", error: null };
        }),
      // Always surface errors in the review workspace (never leave the popup stuck on the spinner).
      setError: (msg) => set({ error: msg, stage: "review" }),
      setProvider: (p) => set({ provider: p }),
      setAutoConfirm: (v) => set({ autoConfirm: v }),
      setOps: (ops) => set((s) => ({ ops: { ...s.ops, ...ops } })),
      reset: () => set({ stage: "idle", ...CLEARED }),
    }),
    {
      name: "g3d-image-stage",
      // Persist only the user's preferences — never the transient chain state.
      partialize: (s) => ({ provider: s.provider, autoConfirm: s.autoConfirm, ops: s.ops }),
    },
  ),
);
