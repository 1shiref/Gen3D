/**
 * Single source of truth for the inline "?" tutorial help shown across the app.
 * Each entry is a short, beginner-friendly explanation of what a feature is and
 * how to use it. `body` is a paragraph, or an array rendered as bullet steps.
 *
 * Keep wording short and plain — this is read by first-time users.
 */
export interface HelpEntry {
  title: string;
  body: string | string[];
}

export const HELP = {
  input: {
    title: "Input",
    body: "Give the AI something to work from: drop a photo of an object, upload a 3D model, or type a description below. You only need one of these.",
  },
  engines: {
    title: "AI Engines",
    body: [
      "Pick which AI models build your 3D model — checked ones run at the same time.",
      "You then choose the best result from the gallery. Greyed-out engines need an image or a server API key.",
    ],
  },
  generate: {
    title: "Generate",
    body: "Starts the AI. Each engine makes a candidate model you can preview and pick from. Shortcut: Ctrl+G.",
  },
  smartPlan: {
    title: "Smart plan",
    body: [
      'Describe a goal in plain words (e.g. "make it 20% taller and add a hole on top").',
      "The AI returns editable steps you can run one at a time or all at once.",
    ],
  },
  tools: {
    title: "Tools",
    body: "Edit the model by hand: move, rotate or scale it, add holes, or split it into parts.",
  },
  history: {
    title: "History",
    body: "Every change is saved here. Click any version to go back to it — restoring is safe and never deletes your other versions.",
  },
  export: {
    title: "G-Code Export",
    body: "Slice the finished model into printer instructions (G-code) and download STL, G-code, or a ZIP. Shortcut: Ctrl+E.",
  },
  printer: {
    title: "Printer",
    body: "Choose your 3D printer (or add a custom one). Its build size and temperatures are used for the fit check and slicing.",
  },
  candidates: {
    title: "Results",
    body: "Each AI engine's model shows up here as a thumbnail. Click one to load it into the 3D viewer.",
  },
} satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof HELP;
