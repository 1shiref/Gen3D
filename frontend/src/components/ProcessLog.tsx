import { Loader2, Check, X } from "lucide-react";
import { useProcessStore, type ProcessStep } from "@/stores/processStore";

function StepRow({ step }: { step: ProcessStep }) {
  const icon =
    step.status === "active" ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
    ) : step.status === "done" ? (
      <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
    ) : (
      <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
    );

  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div
          className={`text-xs leading-snug ${
            step.status === "active"
              ? "text-foreground font-medium"
              : step.status === "error"
              ? "text-red-300"
              : "text-muted-foreground"
          }`}
        >
          {step.label}
        </div>
        {step.detail && (
          <div
            className={`text-[10px] leading-snug truncate ${
              step.status === "error" ? "text-red-300/80" : "text-muted-foreground/70"
            }`}
            title={step.detail}
          >
            {step.detail}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  variant?: "inline" | "overlay";
  /** Show even when finished (so the user can review the steps). Default true. */
  showWhenIdle?: boolean;
}

/**
 * Live step list of the current/last operation. Reads the shared processStore, so any
 * hook that drives it (generate, Photo→3D, edit, slice, convert) gets a uniform display.
 */
export default function ProcessLog({ variant = "inline", showWhenIdle = true }: Props) {
  const title = useProcessStore((s) => s.title);
  const steps = useProcessStore((s) => s.steps);
  const running = useProcessStore((s) => s.running);

  if (steps.length === 0) return null;
  if (!running && !showWhenIdle) return null;

  const body = (
    <div className="space-y-1.5">
      {title && (
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
          {title}
        </div>
      )}
      <div className="space-y-1.5">
        {steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>
    </div>
  );

  if (variant === "overlay") {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
        <div className="pointer-events-auto max-w-sm w-full max-h-[70%] overflow-y-auto bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-3 shadow-xl">
          {body}
        </div>
      </div>
    );
  }

  return <div className="rounded-md border border-border bg-muted/40 px-3 py-2">{body}</div>;
}
