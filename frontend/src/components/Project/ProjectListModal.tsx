import { useEffect, useState } from "react";
import { X, Trash2, Pencil, Check, Plus } from "lucide-react";
import { listProjects, type ProjectSummary } from "@/lib/project-db";
import { loadProject, deleteProject, renameProject, createNewProject } from "@/lib/project-actions";
import { useProjectStore } from "@/stores/projectStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export default function ProjectListModal({ open, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const currentId = useProjectStore((s) => s.currentProjectId);

  const refresh = () => {
    setLoading(true);
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) {
      refresh();
      setRenamingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  if (!open) return null;

  const handleOpen = async (id: string) => {
    await loadProject(id);
    onClose();
  };

  const handleRename = async (id: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) await renameProject(id, trimmed);
    setRenamingId(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    setConfirmDeleteId(null);
    refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Projects</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                createNewProject();
                onClose();
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
            <button onClick={onClose} className="rounded p-1 hover:bg-accent" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              No saved projects yet. Generate a model and it'll be saved automatically.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-md border p-2 ${
                    p.id === currentId ? "border-primary/60 bg-accent/40" : "border-transparent hover:bg-accent"
                  }`}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {p.thumbnailDataUrl ? (
                      <img src={p.thumbnailDataUrl} alt="" className="h-full w-full object-contain" />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    {renamingId === p.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => handleRename(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(p.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    ) : (
                      <button
                        onClick={() => handleOpen(p.id)}
                        className="block w-full truncate text-left text-sm font-medium hover:underline"
                        title="Open project"
                      >
                        {p.name}
                      </button>
                    )}
                    <span className="text-[10px] text-muted-foreground">{relativeTime(p.updatedAt)}</span>
                  </div>

                  {renamingId === p.id ? (
                    <button onClick={() => handleRename(p.id)} className="rounded p-1 hover:bg-accent" title="Save name">
                      <Check className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setRenameDraft(p.name);
                        setRenamingId(p.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {confirmDeleteId === p.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(p.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
