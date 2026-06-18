import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "Ctrl + G", action: "Generate model" },
  { key: "Ctrl + S", action: "Save project" },
  { key: "Ctrl + Z", action: "Undo last edit" },
  { key: "Ctrl + E", action: "Open export panel" },
  { key: "?", action: "Show this dialog" },
  { key: "Click mesh", action: "Add measure point (when measuring)" },
];

export default function KeyboardShortcuts({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg p-6 min-w-[300px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Keyboard Shortcuts</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map(({ key, action }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <kbd className="bg-muted text-xs px-2 py-1 rounded font-mono">{key}</kbd>
              <span className="text-sm text-muted-foreground">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
