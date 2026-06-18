import { useEffect, useRef } from "react";
import { useHistoryStore } from "@/stores/historyStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useProjectStore } from "@/stores/projectStore";
import { saveCurrentProject, isBusy } from "@/lib/project-actions";

/**
 * Auto-saves the current project to IndexedDB shortly after meaningful changes
 * (a new model, an edit, a prompt change, a rename). Debounced so rapid edits
 * collapse into a single write, and skipped while a generation/slice is running.
 * Mount once (in App).
 */

const DEBOUNCE_MS = 1500;

export function useProjectAutosave(): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (isBusy()) {
          // Try again shortly once the in-flight operation settles.
          schedule();
          return;
        }
        void saveCurrentProject();
      }, DEBOUNCE_MS);
    };

    // Save when the timeline changes (new model / edit / restore / undo) — but
    // not on thumbnail fills, which don't change what's persisted meaningfully.
    const unsubHistory = useHistoryStore.subscribe((s, prev) => {
      if (s.versions !== prev.versions || s.activeId !== prev.activeId) schedule();
    });
    // …or the inputs / name change.
    const unsubGen = useGenerationStore.subscribe((s, prev) => {
      if (s.prompt !== prev.prompt || s.modelSource !== prev.modelSource) schedule();
    });
    const unsubProject = useProjectStore.subscribe((s, prev) => {
      if (s.currentProjectName !== prev.currentProjectName) schedule();
    });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubHistory();
      unsubGen();
      unsubProject();
    };
  }, []);
}
