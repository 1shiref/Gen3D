import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { enhancePrompt } from "@/lib/api";
import { useGenerationStore } from "@/stores/generationStore";
import { useToast } from "@/hooks/useToast";

interface Props {
  /** Optional extra classes for layout in different containers. */
  className?: string;
}

/**
 * Rewrites the current text prompt into a richer single-object description via Claude.
 * Reads/writes `generationStore.prompt` so it can be reused anywhere the prompt is edited
 * (InputPanel + the photo-review overlay).
 */
export default function EnhanceButton({ className = "" }: Props) {
  const prompt = useGenerationStore((s) => s.prompt);
  const setPrompt = useGenerationStore((s) => s.setPrompt);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const onEnhance = async () => {
    const current = prompt.trim();
    if (!current || loading) return;
    setLoading(true);
    try {
      const enhanced = await enhancePrompt(current);
      setPrompt(enhanced);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Enhancement failed";
      toast({ title: "Couldn't enhance prompt", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onEnhance}
      disabled={loading || !prompt.trim()}
      title="Rewrite the prompt with Claude for a better result"
      className={`flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {loading ? "Enhancing…" : "Enhance"}
    </button>
  );
}
