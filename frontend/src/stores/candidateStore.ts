import { create } from "zustand";
import { useGenerationStore, type DimensionCheck } from "@/stores/generationStore";
import { useMeshEditStore } from "@/stores/meshEditStore";

export type CandidateStatus = "pending" | "ready" | "failed";

export interface Candidate {
  engineId: string;
  engineLabel: string;
  kind: "neural" | "uploaded";
  url: string;
  format: string;
  /** Original filename, for uploaded candidates. */
  name?: string;
  boundingBox?: { x: number; y: number; z: number };
  dimensionCheck?: DimensionCheck | null;
  previewUrl?: string | null;
  materialSuggestion?: string;
  printabilityWarnings?: string[];
  suggestedDimensions?: string;
}

export interface PlanEntry {
  id: string;
  label: string;
  status: CandidateStatus;
  error?: string;
}

interface CandidateStore {
  /** One row per engine in the current run (pending → ready/failed). */
  plan: PlanEntry[];
  /** Successful candidates, newest engines appended as they finish. */
  candidates: Candidate[];
  activeId: string | null;
  running: boolean;

  startRun: (plan: { id: string; label: string }[]) => void;
  addCandidate: (c: Candidate) => void;
  failCandidate: (engineId: string, error: string) => void;
  finishRun: () => void;
  /** Add a one-off candidate (e.g. an uploaded model) and select it. */
  addExternal: (c: Candidate) => void;
  select: (engineId: string) => void;
  reset: () => void;
}

export const useCandidateStore = create<CandidateStore>((set, get) => ({
  plan: [],
  candidates: [],
  activeId: null,
  running: false,

  startRun: (plan) =>
    set({
      plan: plan.map((p) => ({ id: p.id, label: p.label, status: "pending" })),
      // Keep prior candidates so the user can still compare across runs.
      running: true,
    }),

  addCandidate: (c) => {
    set((s) => ({
      candidates: [...s.candidates.filter((x) => x.engineId !== c.engineId), c],
      plan: s.plan.map((p) => (p.id === c.engineId ? { ...p, status: "ready" } : p)),
    }));
    // Auto-select the first result of a run so something shows immediately.
    if (!get().activeId) get().select(c.engineId);
  },

  failCandidate: (engineId, error) =>
    set((s) => ({
      plan: s.plan.map((p) => (p.id === engineId ? { ...p, status: "failed", error } : p)),
    })),

  finishRun: () => set({ running: false }),

  addExternal: (c) => {
    set((s) => ({ candidates: [...s.candidates.filter((x) => x.engineId !== c.engineId), c] }));
    get().select(c.engineId);
  },

  select: (engineId) => {
    const c = get().candidates.find((x) => x.engineId === engineId);
    if (!c) return;
    set({ activeId: engineId });
    // Route the chosen candidate into the rest of the app (viewer / edit / slice).
    useMeshEditStore.getState().reset(); // drop edits tied to the previous model

    // Uploaded models keep their "uploaded" source (enables Convert-to-editable).
    if (c.kind === "uploaded") {
      useGenerationStore.getState().setUploadedModel({ url: c.url, originalName: c.name ?? "model" });
      return;
    }

    useGenerationStore.getState().setStlReady({
      url: c.url,
      previewUrl: c.previewUrl ?? null,
      boundingBox: c.boundingBox ?? { x: 0, y: 0, z: 0 },
      dimensionCheck: c.dimensionCheck ?? null,
      materialSuggestion: c.materialSuggestion,
      printabilityWarnings: c.printabilityWarnings,
      suggestedDimensions: c.suggestedDimensions,
    });
  },

  reset: () => set({ plan: [], candidates: [], activeId: null, running: false }),
}));
