import { useEffect } from "react";
import { useGenerate } from "./useGenerate";
import { useProject } from "./useProject";
import { useMeshEditStore } from "@/stores/meshEditStore";

export function useKeyboard() {
  const { generate } = useGenerate();
  const undo = useMeshEditStore((s) => s.undo);
  const { save } = useProject();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "g":
            e.preventDefault();
            generate();
            break;
          case "s":
            e.preventDefault();
            save();
            break;
          case "z":
            e.preventDefault();
            undo();
            break;
          case "e":
            e.preventDefault();
            // Trigger export panel focus — dispatched as custom event
            document.dispatchEvent(new CustomEvent("t2p:export"));
            break;
        }
      }

      if (e.key === "?") {
        document.dispatchEvent(new CustomEvent("t2p:shortcuts"));
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [generate, undo, save]);
}
