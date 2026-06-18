import { Download, FileCode2, Box, FileType } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useExportStore } from "@/stores/exportStore";
import { downloadFileUrl } from "@/lib/stl-utils";
import { useToast } from "@/hooks/useToast";

export default function DownloadButtons() {
  // Prefer the locally mesh-edited STL so downloads reflect split/hole edits.
  const stlUrl = useGenerationStore((s) => s.editedStlUrl ?? s.stlUrl);
  const gcodeUrl = useExportStore((s) => s.gcodeUrl);
  const { toast } = useToast();

  const download = async (url: string | null, filename: string) => {
    if (!url) {
      toast({ title: `${filename} not available`, description: "Generate or slice the model first", variant: "destructive" });
      return;
    }
    try {
      await downloadFileUrl(url, filename);
    } catch (err) {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const downloadObj = async () => {
    if (!stlUrl) {
      toast({ title: "No model", variant: "destructive" });
      return;
    }
    const objUrl = stlUrl.replace("/api/files/", "/api/export/obj/");
    await download(objUrl, "model.obj");
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Downloads</p>
      <div className="flex flex-wrap gap-1">
        {[
          { icon: Box, label: "STL", action: () => download(stlUrl, "model.stl") },
          { icon: FileType, label: "OBJ", action: downloadObj },
          { icon: FileCode2, label: "G-code", action: () => download(gcodeUrl, "model.gcode") },
        ].map(({ icon: Icon, label, action }) => (
          <button
            key={label}
            onClick={action}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:border-primary/50 hover:bg-accent transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
