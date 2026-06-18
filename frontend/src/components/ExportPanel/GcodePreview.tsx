import { useExportStore } from "@/stores/exportStore";

function highlightGcode(line: string): string {
  if (line.startsWith(";")) return `<span class="comment">${line}</span>`;
  const parts = line.split(/(;.*)$/);
  let main = parts[0];
  const comment = parts[1] ?? "";

  main = main.replace(/\b(G\d+)\b/g, '<span class="g-cmd">$1</span>');
  main = main.replace(/\b(M\d+)\b/g, '<span class="m-cmd">$1</span>');
  main = main.replace(/\b([XYZEF]-?\d+\.?\d*)\b/g, '<span class="coord">$1</span>');

  return main + (comment ? `<span class="comment">${comment}</span>` : "");
}

export default function GcodePreview() {
  const preview = useExportStore((s) => s.gcodePreview);

  if (!preview) return null;

  const lines = preview.split("\n").slice(0, 100);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">G-code preview (first 100 lines)</p>
      <div className="bg-zinc-900 rounded border border-border overflow-auto max-h-36">
        <pre className="text-xs font-mono p-2 gcode leading-4">
          {lines.map((line, i) => (
            <div key={i} dangerouslySetInnerHTML={{ __html: highlightGcode(line) }} />
          ))}
        </pre>
      </div>
    </div>
  );
}
