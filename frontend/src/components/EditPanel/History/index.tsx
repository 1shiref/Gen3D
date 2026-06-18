import { useEffect } from "react";
import { RotateCcw, Loader2, Check } from "lucide-react";
import { useHistoryStore, type VersionSource } from "@/stores/historyStore";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useGenerationStore } from "@/stores/generationStore";
import { renderGeometryThumbnail } from "@/lib/mesh-thumbnail";
import { useToast } from "@/hooks/useToast";
import VersionThumb from "./VersionThumb";

const SOURCE_LABEL: Record<VersionSource, string> = {
  generate: "Generated",
  upload: "Uploaded",
  candidate: "Candidate",
  tool: "Tool",
  "smart-plan": "Smart plan",
  gizmo: "Gizmo",
  restore: "Restored",
};

const SOURCE_CLASS: Record<VersionSource, string> = {
  generate: "bg-primary/15 text-primary",
  upload: "bg-primary/15 text-primary",
  candidate: "bg-primary/15 text-primary",
  tool: "bg-blue-500/15 text-blue-400",
  "smart-plan": "bg-purple-500/15 text-purple-400",
  gizmo: "bg-amber-500/15 text-amber-400",
  restore: "bg-emerald-500/15 text-emerald-400",
};

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function HistoryPanel() {
  const stlUrl = useGenerationStore((s) => s.stlUrl);
  const versions = useHistoryStore((s) => s.versions);
  const activeId = useHistoryStore((s) => s.activeId);
  const setThumbnail = useHistoryStore((s) => s.setThumbnail);
  const restore = useHistoryStore((s) => s.restore);
  const busy = useMeshEditStore((s) => s.busy);
  const { toast } = useToast();

  // Lazily render thumbnails for any versions that don't have one yet (tab is mounted).
  useEffect(() => {
    for (const v of versions) {
      if (!v.thumbnail) {
        const url = renderGeometryThumbnail(v.geometry);
        if (url) setThumbnail(v.id, url);
      }
    }
  }, [versions, setThumbnail]);

  const onRestore = async (id: string, label: string) => {
    try {
      await restore(id);
      toast({ title: `Restored ${label}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Restore failed";
      toast({ title: "Restore failed", description: msg, variant: "destructive" });
    }
  };

  if (!stlUrl || versions.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground text-center py-8">
        Generate or upload a model — every edit will appear here as a version you can restore.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border">
        <span className="text-[11px] font-medium text-muted-foreground flex-1">Version History</span>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
        <span className="text-[10px] text-muted-foreground/70">{versions.length} versions</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {[...versions].reverse().map((v) => {
          const active = v.id === activeId;
          return (
            <div
              key={v.id}
              className={`flex items-center gap-2 p-1.5 rounded border ${
                active ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <VersionThumb src={v.thumbnail} alt={v.label} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">{v.label}</span>
                  <span className={`text-[9px] px-1 py-px rounded uppercase tracking-wide ${SOURCE_CLASS[v.source]}`}>
                    {SOURCE_LABEL[v.source]}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">{relativeTime(v.timestamp)}</div>
              </div>
              {active ? (
                <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-primary shrink-0">
                  <Check className="w-3.5 h-3.5" /> Current
                </span>
              ) : (
                <button
                  onClick={() => onRestore(v.id, v.label)}
                  disabled={busy}
                  title="Restore this version"
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
