import { Loader2, AlertTriangle, Check } from "lucide-react";
import { useCandidateStore } from "@/stores/candidateStore";
import { buildFileUrl } from "@/lib/api";
import CandidateThumb from "./CandidateThumb";
import HelpTip from "@/components/UI/HelpTip";

/**
 * Horizontal strip of generated candidates. Each engine gets a tile (pending /
 * ready / failed); click a ready tile to make it the active model. Persists for
 * the session so the user can switch between results at any time.
 */
export default function CandidateGallery() {
  const plan = useCandidateStore((s) => s.plan);
  const candidates = useCandidateStore((s) => s.candidates);
  const activeId = useCandidateStore((s) => s.activeId);
  const select = useCandidateStore((s) => s.select);

  // Rows = the engines in the current run, plus any extra candidates (e.g. uploads)
  // that aren't part of a plan row.
  const planIds = new Set(plan.map((p) => p.id));
  const extras = candidates.filter((c) => !planIds.has(c.engineId));
  const rows = [
    ...plan.map((p) => ({ id: p.id, label: p.label, status: p.status, error: p.error })),
    ...extras.map((c) => ({ id: c.engineId, label: c.engineLabel, status: "ready" as const, error: undefined })),
  ];

  if (rows.length === 0) return null;

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 max-w-[92%]">
      <div className="flex items-center gap-1.5 mb-1 pl-1">
        <span className="text-[10px] font-medium text-white/70">Results — pick one</span>
        <HelpTip id="candidates" className="text-white/60 hover:text-white" />
      </div>
      <div className="flex gap-2 overflow-x-auto rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 p-2">
        {rows.map((row) => {
          const cand = candidates.find((c) => c.engineId === row.id);
          const active = activeId === row.id;
          const ready = row.status === "ready" && cand;
          return (
            <button
              key={row.id}
              onClick={() => ready && select(row.id)}
              disabled={!ready}
              title={row.status === "failed" ? row.error : row.label}
              className={`relative shrink-0 w-[104px] rounded-md overflow-hidden border transition-colors ${
                active ? "border-primary ring-1 ring-primary" : "border-white/15 hover:border-white/40"
              } ${ready ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="h-[72px] w-full bg-zinc-800 flex items-center justify-center">
                {row.status === "pending" && <Loader2 className="w-5 h-5 animate-spin text-white/60" />}
                {row.status === "failed" && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {ready && (cand!.previewUrl
                  ? <img src={buildFileUrl(cand!.previewUrl)} alt={row.label} className="h-full w-full object-contain" />
                  : <CandidateThumb url={cand!.url} />)}
              </div>
              <div className="flex items-center gap-1 px-1.5 py-1 bg-black/50">
                {active && <Check className="w-3 h-3 text-primary shrink-0" />}
                <span className="text-[10px] text-white/80 truncate">{row.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
