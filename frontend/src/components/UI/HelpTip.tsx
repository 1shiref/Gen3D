import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { HELP, type HelpId, type HelpEntry } from "@/lib/help-content";

interface Props {
  /** Key into the shared HELP registry. */
  id?: HelpId;
  /** Or pass content directly instead of an id. */
  title?: string;
  body?: string | string[];
  /** Extra classes for the trigger icon button. */
  className?: string;
}

const POPOVER_WIDTH = 240; // px (matches w-60)

/**
 * Small "?" help button that opens a tiny tutorial popover on click. The popover
 * is rendered in a portal and positioned with fixed coordinates so it never gets
 * clipped by the app's many overflow containers. Closes on outside click or Esc.
 */
export default function HelpTip({ id, title, body, className = "" }: Props) {
  const entry: HelpEntry | undefined = id ? HELP[id] : title ? { title, body: body ?? "" } : undefined;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Position the popover under the icon, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, r.right - POPOVER_WIDTH),
      window.innerWidth - POPOVER_WIDTH - 8
    );
    setPos({ top: r.bottom + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!entry) return null;

  const bullets = Array.isArray(entry.body) ? entry.body : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Help: ${entry.title}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={`shrink-0 text-muted-foreground hover:text-foreground transition-colors ${className}`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
            className="fixed z-[100] bg-card border border-border rounded-lg p-3 shadow-xl text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h4 className="text-xs font-semibold text-primary">{entry.title}</h4>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Close help"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {bullets ? (
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground leading-snug">
                {bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground leading-snug">{entry.body as string}</p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
