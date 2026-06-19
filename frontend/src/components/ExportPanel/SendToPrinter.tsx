import { useState } from "react";
import { Printer, Loader2, X, Save, Play } from "lucide-react";
import { useExportStore } from "@/stores/exportStore";
import { useProjectStore } from "@/stores/projectStore";
import { sendToPrinter } from "@/lib/api";
import { goToMainsail } from "@/lib/mainsail";
import { useToast } from "@/hooks/useToast";

/** Turn the current project name into a friendly `<name>.gcode` filename. */
function gcodeFilename(projectName: string): string {
  const base = (projectName || "").trim().replace(/[\\/:*?"<>|]+/g, "_").trim();
  return `${base || "gen3d-model"}.gcode`;
}

export default function SendToPrinter() {
  const gcodeUrl = useExportStore((s) => s.gcodeUrl);
  const projectName = useProjectStore((s) => s.currentProjectName);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "print" | null>(null);

  const disabled = !gcodeUrl;

  const send = async (print: boolean) => {
    if (!gcodeUrl) return;
    setBusy(print ? "print" : "save");
    try {
      const name = gcodeFilename(projectName);
      const result = await sendToPrinter({ gcodeUrl, name, print });
      setOpen(false);
      if (print && result.printStarted) {
        toast({ title: "Print started", description: `${result.filename} — opening Mainsail…` });
        goToMainsail();
      } else if (print) {
        // Uploaded but Moonraker didn't start it (e.g. printer busy/not ready).
        toast({
          title: "Saved, but print didn't start",
          description: `${result.filename} is in Mainsail → G-Code Files. Start it from there.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Saved to Mainsail",
          description: `${result.filename} — find it under G-Code Files.`,
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't send to printer",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Slice the model first" : "Send G-code to the printer"}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Printer className="w-4 h-4" />
        Send to Printer
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => busy === null && setOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-lg p-6 w-[360px] max-w-[90vw] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold flex items-center gap-2">
                <Printer className="w-4 h-4" /> Send to Printer
              </h3>
              <button
                onClick={() => setOpen(false)}
                disabled={busy !== null}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Saving as <span className="font-mono text-foreground">{gcodeFilename(projectName)}</span>{" "}
              to your printer's G-Code Files (Mainsail).
            </p>

            <div className="space-y-2">
              <button
                onClick={() => send(false)}
                disabled={busy !== null}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md border border-border hover:border-primary/50 hover:bg-accent text-left disabled:opacity-50 transition-colors"
              >
                {busy === "save" ? (
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                ) : (
                  <Save className="w-5 h-5 shrink-0" />
                )}
                <span>
                  <span className="block text-sm font-medium">Save to Mainsail</span>
                  <span className="block text-xs text-muted-foreground">
                    Upload only — view it later in Mainsail
                  </span>
                </span>
              </button>

              <button
                onClick={() => send(true)}
                disabled={busy !== null}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-left disabled:opacity-50 transition-colors"
              >
                {busy === "print" ? (
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                ) : (
                  <Play className="w-5 h-5 shrink-0" />
                )}
                <span>
                  <span className="block text-sm font-medium">Save &amp; Print now</span>
                  <span className="block text-xs text-emerald-50/80">
                    Uploads and starts the print, then opens Mainsail
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
