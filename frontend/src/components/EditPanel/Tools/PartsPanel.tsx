import { useEffect, useState } from "react";
import { Copy, Trash2, Check, X, Box } from "lucide-react";
import { useMeshEditStore, partColor } from "@/stores/meshEditStore";
import { useToast } from "@/hooks/useToast";

/** True when the user is typing in a field — keyboard shortcuts must not fire then. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

/**
 * Parts list shown only after a Split. Each piece is an independent object: click a
 * row (or the piece in 3D) to select it, then move/rotate/scale it with the gizmo,
 * duplicate it, or delete it — without affecting the others. Delete is guarded by an
 * inline confirm (trash button OR the Delete/Backspace key).
 */
export default function PartsPanel() {
  const parts = useMeshEditStore((s) => s.parts);
  const selectedPartId = useMeshEditStore((s) => s.selectedPartId);
  const selectPart = useMeshEditStore((s) => s.selectPart);
  const deletePart = useMeshEditStore((s) => s.deletePart);
  const duplicatePart = useMeshEditStore((s) => s.duplicatePart);
  const busy = useMeshEditStore((s) => s.busy);
  const { toast } = useToast();

  // Which part has an armed "Delete? ✓ ✕" confirm.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Delete / Backspace arms the inline confirm on the selected part (not while typing).
  useEffect(() => {
    if (!parts || parts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isTypingTarget(e.target)) return;
      const id = useMeshEditStore.getState().selectedPartId;
      if (!id) return;
      e.preventDefault();
      setConfirmingId(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parts]);

  if (!parts || parts.length === 0) return null;

  const confirmDelete = async (id: string) => {
    setConfirmingId(null);
    try {
      await deletePart(id);
      toast({ title: "Part deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  const onDuplicate = async (id: string) => {
    try {
      await duplicatePart(id);
      toast({ title: "Part duplicated" });
    } catch (err) {
      toast({ title: "Duplicate failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parts</div>
        <div className="text-[10px] text-muted-foreground/70 leading-snug">
          Click a piece to select it, then move/rotate/scale it with the gizmo. Duplicate or delete pieces independently.
        </div>
      </div>

      {parts.map((part, i) => {
        const selected = part.id === selectedPartId;
        const confirming = part.id === confirmingId;
        return (
          <div
            key={part.id}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] border ${
              selected ? "bg-accent border-primary/50" : "border-transparent hover:bg-accent/50"
            }`}
          >
            <button
              onClick={() => selectPart(part.id)}
              className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
              title="Select this part"
            >
              <Box className="w-3.5 h-3.5 shrink-0" style={{ color: partColor(i) }} />
              <span className="truncate">Part {i + 1}</span>
            </button>

            {confirming ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Delete?</span>
                <button
                  onClick={() => void confirmDelete(part.id)}
                  disabled={busy}
                  title="Confirm delete"
                  className="p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setConfirmingId(null)}
                  title="Cancel"
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => void onDuplicate(part.id)}
                  disabled={busy}
                  title="Duplicate part"
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setConfirmingId(part.id)}
                  disabled={busy}
                  title="Delete part"
                  className="p-0.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
