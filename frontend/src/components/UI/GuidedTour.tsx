import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

const DONE_KEY = "g3d-onboarding-done";
const CARD_WIDTH = 300; // px
const PAD = 8; // spotlight padding around the target
const GAP = 14; // gap between target and card

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

interface TourStep {
  /** CSS selector for the element to spotlight. Omit for a centered step. */
  target?: string;
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Gen3D! 👋",
    body: "This quick tour shows you how to turn a photo or a text description into a 3D-printable model. Use Back and Next to move through it, or Skip anytime.",
  },
  {
    target: '[data-tour="input"]',
    title: "1. Add your input",
    body: "Start here. Drop a photo of an object, upload an existing 3D model, or type a description. You only need one of these.",
  },
  {
    target: '[data-tour="engines"]',
    title: "2. Pick AI engines",
    body: "Choose which AI models build your 3D model — the checked ones run at the same time so you get several results to compare.",
  },
  {
    target: '[data-tour="generate"]',
    title: "3. Generate",
    body: "Click Generate (or press Ctrl+G). The AI gets to work and produces candidate models for you.",
  },
  {
    target: '[data-tour="viewer"]',
    title: "4. Preview & pick a result",
    body: "Your models appear in this 3D viewer. After generating, a strip of results shows at the bottom — click any thumbnail to load it. Drag to rotate, scroll to zoom.",
  },
  {
    target: '[data-tour="edit"]',
    title: "5. Refine your model",
    body: 'Use Smart plan to edit with plain words ("make it 20% taller"), the Tools tab for manual edits like holes and splitting, or History to go back a step.',
  },
  {
    target: '[data-tour="export"]',
    title: "6. Export for printing",
    body: "When you're happy, open this panel to pick your printer, slice the model into G-code, and download the STL or G-code ready to print. Shortcut: Ctrl+E.",
  },
  {
    title: "You're all set! 🎉",
    body: "That's the whole workflow. Look for the small (?) icons next to features for quick tips, and reopen this tour anytime from the ? button at the top.",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Guided spotlight tour. Dims the screen and highlights each real panel in turn,
 * with a card explaining what to do and Back / Next / Skip controls. Auto-starts on
 * first visit; reopened on demand via the `t2p:tour` CustomEvent (header ? button).
 */
export default function GuidedTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: CARD_WIDTH, h: 220 });
  const cardRef = useRef<HTMLDivElement>(null);

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  const close = useCallback(() => {
    setActive(false);
    localStorage.setItem(DONE_KEY, "1");
  }, []);

  // Measure the current step's target (after scrolling it into view).
  const measure = useCallback(() => {
    if (!current?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(current.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [current]);

  // Start automatically on first visit.
  useEffect(() => {
    if (!localStorage.getItem(DONE_KEY)) {
      const t = setTimeout(() => {
        setStep(0);
        setActive(true);
      }, 400);
      return () => clearTimeout(t);
    }
  }, []);

  // Launch on demand from the header ? button.
  useEffect(() => {
    const onTour = () => {
      setStep(0);
      setActive(true);
    };
    document.addEventListener("t2p:tour", onTour);
    return () => document.removeEventListener("t2p:tour", onTour);
  }, []);

  // Bring the target into view, then measure (on each step).
  useLayoutEffect(() => {
    if (!active) return;
    if (current?.target) {
      const el = document.querySelector(current.target) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    measure();
  }, [active, step, current, measure]);

  // Measure the rendered card so we can clamp it accurately within the viewport.
  useLayoutEffect(() => {
    if (!active || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setCardSize((prev) =>
      Math.abs(prev.w - r.width) > 1 || Math.abs(prev.h - r.height) > 1
        ? { w: r.width, h: r.height }
        : prev
    );
  }, [active, step, rect]);

  // Keep the spotlight aligned on resize / scroll, and handle Esc / arrows.
  useEffect(() => {
    if (!active) return;
    const onResize = () => measure();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, measure, close]);

  if (!active) return null;

  const next = () => (isLast ? close() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Place the card on whichever side of the target has room (below → above →
  // right → left), then clamp it fully inside the viewport so it's never cut off.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { w, h } = cardSize;
    const fitsBelow = rect.top + rect.height + GAP + h + PAD <= vh;
    const fitsAbove = rect.top - GAP - h - PAD >= 0;
    const fitsRight = rect.left + rect.width + GAP + w + PAD <= vw;

    let top: number;
    let left: number;
    if (fitsBelow || fitsAbove) {
      // Card above or below: center horizontally on the target.
      top = fitsBelow ? rect.top + rect.height + GAP : rect.top - GAP - h;
      left = rect.left + rect.width / 2 - w / 2;
    } else {
      // Tall target (e.g. a full-height side panel): place beside it instead.
      left = fitsRight ? rect.left + rect.width + GAP : rect.left - GAP - w;
      top = rect.top + rect.height / 2 - h / 2;
    }

    cardStyle = {
      top: clamp(top, PAD, vh - h - PAD),
      left: clamp(left, PAD, vw - w - PAD),
      width: CARD_WIDTH,
    };
  } else {
    cardStyle = {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: CARD_WIDTH,
    };
  }

  return createPortal(
    <div className="fixed inset-0 z-[200]">
      {/* Dim layer with a spotlight hole, or a full dim when no target */}
      {rect ? (
        <div
          className="fixed rounded-md ring-2 ring-primary pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/60" />
      )}

      {/* Step card */}
      <div
        ref={cardRef}
        style={cardStyle}
        className="fixed z-[201] bg-card border border-primary/50 rounded-lg p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h4 className="text-sm font-semibold text-primary">{current.title}</h4>
          <button
            onClick={close}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Close tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-snug mb-3">{current.body}</p>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-4 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={close}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={back}
              disabled={step === 0}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3 h-3" />
              Back
            </button>
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isLast ? "Done" : "Next"}
              {!isLast && <ChevronRight className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          Step {step + 1} of {TOUR_STEPS.length}
        </div>
      </div>
    </div>,
    document.body
  );
}
