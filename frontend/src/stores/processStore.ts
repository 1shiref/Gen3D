import { create } from "zustand";

export type StepStatus = "active" | "done" | "error";

export interface ProcessStep {
  id: string;
  label: string;
  /** What the step uses — model / tool / GPU Space / slicer. Shown muted under the label. */
  detail?: string;
  status: StepStatus;
}

/**
 * Shared live "Process Log" — every long-running operation (generate, Photo→3D, edit,
 * slice, convert) reports its steps here so the UI can show WHAT is happening and WHAT it uses.
 *
 * Usage from a hook:
 *   start("Generating 3D model")
 *   step("Generating 3D mesh", "Hunyuan3D-2")
 *   annotate("fal.ai · hunyuan3d/v2")          // attach the real provider once known
 *   done()                                      // or fail("…")
 */
export interface ProcessStore {
  title: string | null;
  steps: ProcessStep[];
  running: boolean;

  start: (title: string) => void;
  step: (label: string, detail?: string) => void;
  annotate: (detail: string) => void;
  done: () => void;
  fail: (message: string) => void;
  reset: () => void;
}

let counter = 0;
const nextId = () => `step-${Date.now()}-${counter++}`;

/** Mark the last still-active step as done (used when a new step starts or the run finishes). */
function settleActive(steps: ProcessStep[], to: StepStatus): ProcessStep[] {
  return steps.map((s) => (s.status === "active" ? { ...s, status: to } : s));
}

export const useProcessStore = create<ProcessStore>((set) => ({
  title: null,
  steps: [],
  running: false,

  start: (title) => set({ title, steps: [], running: true }),

  step: (label, detail) =>
    set((state) => ({
      steps: [...settleActive(state.steps, "done"), { id: nextId(), label, detail, status: "active" }],
      running: true,
    })),

  annotate: (detail) =>
    set((state) => {
      if (state.steps.length === 0) return state;
      const steps = [...state.steps];
      // Attach to the current active step, else the most recent one.
      let idx = steps.map((s) => s.status).lastIndexOf("active");
      if (idx === -1) idx = steps.length - 1;
      steps[idx] = { ...steps[idx], detail };
      return { steps };
    }),

  done: () => set((state) => ({ steps: settleActive(state.steps, "done"), running: false })),

  fail: (message) =>
    set((state) => {
      const steps = [...state.steps];
      const idx = steps.map((s) => s.status).lastIndexOf("active");
      if (idx !== -1) {
        steps[idx] = { ...steps[idx], status: "error", detail: message };
      } else {
        steps.push({ id: nextId(), label: "Failed", detail: message, status: "error" });
      }
      return { steps, running: false };
    }),

  reset: () => set({ title: null, steps: [], running: false }),
}));
