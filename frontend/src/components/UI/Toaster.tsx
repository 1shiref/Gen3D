import { useToast } from "@/hooks/useToast";
import { X, CheckCircle, AlertCircle } from "lucide-react";

export default function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 pointer-events-auto rounded-lg border px-4 py-3 shadow-lg min-w-[240px] max-w-sm animate-in slide-in-from-bottom-5 ${
            t.variant === "destructive"
              ? "bg-destructive border-destructive/50 text-destructive-foreground"
              : "bg-card border-border text-foreground"
          }`}
        >
          {t.variant === "destructive" ? (
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-400" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{t.title}</p>
            {t.description && <p className="text-xs opacity-80 mt-0.5">{t.description}</p>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
