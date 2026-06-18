import { useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { createNewProject } from "@/lib/project-actions";
import ProjectListModal from "./ProjectListModal";

/**
 * Header control for the current project: an inline-editable name, a "Projects"
 * button to open the saved-projects list, and a "New" button for a blank project.
 */
export default function ProjectMenu() {
  const name = useProjectStore((s) => s.currentProjectName);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) setProjectName(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-1">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-40 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <button
          onClick={startEdit}
          title="Rename project"
          className="max-w-[12rem] truncate rounded px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          {name}
        </button>
      )}

      <button
        onClick={() => setListOpen(true)}
        title="Open a saved project"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Projects
      </button>

      <button
        onClick={() => createNewProject()}
        title="Start a new project"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        New
      </button>

      <ProjectListModal open={listOpen} onClose={() => setListOpen(false)} />
    </div>
  );
}
