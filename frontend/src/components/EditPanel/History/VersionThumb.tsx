import { Box } from "lucide-react";

/** Static preview for a version row. Shows the rendered thumbnail once available. */
export default function VersionThumb({ src, alt }: { src?: string; alt: string }) {
  return (
    <div className="w-12 h-12 shrink-0 rounded bg-muted/40 border border-border overflow-hidden flex items-center justify-center">
      {src ? (
        <img src={src} alt={alt} className="w-full h-full object-contain" />
      ) : (
        <Box className="w-5 h-5 text-muted-foreground/50" />
      )}
    </div>
  );
}
