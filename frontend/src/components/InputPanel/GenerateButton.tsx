import { useGenerationStore } from "@/stores/generationStore";
import { useImageStageStore } from "@/stores/imageStageStore";
import { useGenerate } from "@/hooks/useGenerate";
import { Loader2, Cpu, Sparkles, CheckCircle, Image as ImageIcon } from "lucide-react";

const STATUS_CONFIG = {
  idle: { label: "Generate (Ctrl+G)", icon: Sparkles, color: "bg-primary hover:bg-primary/90", disabled: false },
  uploading: { label: "Uploading images…", icon: Loader2, color: "bg-muted cursor-not-allowed", disabled: true },
  streaming: { label: "Generating 3D model…", icon: Loader2, color: "bg-amber-600 cursor-not-allowed", disabled: true },
  compiling: { label: "Working…", icon: Cpu, color: "bg-purple-600 cursor-not-allowed", disabled: true },
  done: { label: "Generate Again", icon: CheckCircle, color: "bg-primary hover:bg-primary/90", disabled: false },
  error: { label: "Retry Generation", icon: Sparkles, color: "bg-destructive hover:bg-destructive/90", disabled: false },
};

export default function GenerateButton() {
  const status = useGenerationStore((s) => s.status);
  const imageStage = useImageStageStore((s) => s.stage);
  const { generate } = useGenerate();

  // The photo stage drives its own progress/actions in the viewer overlay; reflect it here.
  const cfg =
    imageStage === "generating"
      ? { label: "Generating photo…", icon: Loader2, color: "bg-amber-600 cursor-not-allowed", disabled: true, spin: true }
      : imageStage === "review"
        ? { label: "Reviewing photo…", icon: ImageIcon, color: "bg-muted cursor-not-allowed", disabled: true, spin: false }
        : { ...STATUS_CONFIG[status], spin: status === "streaming" || status === "uploading" || status === "compiling" };
  const Icon = cfg.icon;

  return (
    <button
      onClick={() => generate()}
      disabled={cfg.disabled}
      className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium text-white transition-colors ${cfg.color}`}
    >
      <Icon className={`w-4 h-4 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </button>
  );
}
