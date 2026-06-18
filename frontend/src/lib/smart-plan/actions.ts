import {
  FEATURES,
  coerceParams as coerceFeatureParams,
  featureCatalogForAI,
  type FeatureParams,
  type ParamSpec,
} from "@/lib/mesh-edit/features";
import { BUILTIN_PROFILES } from "@/lib/printer-profiles";
import { usePrinterStore } from "@/stores/printerStore";

/**
 * The Smart-plan action catalog — the single source of truth (and whitelist) for everything
 * the master planner is allowed to do. App-level actions live here; the mesh-edit `FEATURES`
 * registry is reused verbatim for the "edit" phase. The combined catalog is what the AI sees,
 * so it can only ever emit steps that map to real code (unknown ids are dropped on parse).
 */

export type ActionPhase = "generate" | "fit" | "edit" | "slice" | "export";

export interface AppAction {
  id: string;
  phase: ActionPhase;
  label: string;
  description: string;
  params: ParamSpec[];
}

const MATERIAL_OPTIONS = [
  { value: "PLA", label: "PLA" },
  { value: "PETG", label: "PETG" },
  { value: "ABS", label: "ABS" },
  { value: "TPU", label: "TPU" },
];

export const APP_ACTIONS: Record<string, AppAction> = {
  set_prompt: {
    id: "set_prompt",
    phase: "generate",
    label: "Set prompt",
    description: "Set the text prompt describing the single object to generate (e.g. 'a sitting cat').",
    params: [{ key: "text", label: "Prompt", type: "text", default: "" }],
  },
  enhance_prompt: {
    id: "enhance_prompt",
    phase: "generate",
    label: "Enhance prompt with AI",
    description: "Rewrite the current text prompt into a richer single-object description for a better image→3D result. Operates on the current prompt.",
    params: [],
  },
  generate_model: {
    id: "generate_model",
    phase: "generate",
    label: "Generate model",
    description: "Run AI generation from the current prompt/image. Pauses at the image-review and candidate-pick UI for the user, then the plan continues automatically.",
    params: [],
  },
  select_printer: {
    id: "select_printer",
    phase: "fit",
    label: "Select printer",
    description: "Choose which printer profile (build volume + temperatures) to target.",
    params: [{ key: "printerId", label: "Printer", type: "select", default: BUILTIN_PROFILES[0].id, options: [] }],
  },
  fit_to_bed: {
    id: "fit_to_bed",
    phase: "fit",
    label: "Fit to printer bed",
    description: "Make the model fit the selected printer's build volume if it is too big. mode=scale shrinks it uniformly; mode=split cuts it into bed-sized parts with alignment pins. No-op if it already fits.",
    params: [{
      key: "mode", label: "How", type: "select", default: "scale",
      options: [{ value: "scale", label: "Shrink to fit" }, { value: "split", label: "Split into parts" }],
    }],
  },
  set_slicer_settings: {
    id: "set_slicer_settings",
    phase: "slice",
    label: "Set slicer settings",
    description: "Set slicing parameters: infill density (%), infill pattern, wall thickness (mm), layer height (mm), material, supports, and build-plate adhesion.",
    params: [
      { key: "infillDensity", label: "Infill", type: "number", default: 30, min: 0, max: 100, step: 5, unit: "%" },
      { key: "infillPattern", label: "Infill pattern", type: "select", default: "lines", options: [
        { value: "lines", label: "Lines" }, { value: "grid", label: "Grid" },
        { value: "triangles", label: "Triangles" }, { value: "concentric", label: "Concentric" },
        { value: "zigzag", label: "Zig Zag" },
      ] },
      { key: "wallThickness", label: "Wall thickness", type: "number", default: 0.8, min: 0.4, max: 5, step: 0.1, unit: "mm" },
      { key: "layerHeight", label: "Layer height", type: "number", default: 0.24, min: 0.05, max: 1, step: 0.01, unit: "mm" },
      { key: "material", label: "Material", type: "select", default: "PETG", options: MATERIAL_OPTIONS },
      { key: "generateSupport", label: "Supports", type: "boolean", default: true },
      { key: "buildPlateAdhesionType", label: "Adhesion", type: "select", default: "skirt", options: [
        { value: "none", label: "None" }, { value: "skirt", label: "Skirt" },
        { value: "brim", label: "Brim" }, { value: "raft", label: "Raft" },
      ] },
    ],
  },
  slice_model: {
    id: "slice_model",
    phase: "slice",
    label: "Slice to G-code",
    description: "Slice the current model into printable G-code using the current slicer settings. Requires a model.",
    params: [],
  },
  export_stl: {
    id: "export_stl",
    phase: "export",
    label: "Download STL",
    description: "Download the current (edited) model as an STL file. Requires a model.",
    params: [],
  },
  export_gcode: {
    id: "export_gcode",
    phase: "export",
    label: "Download G-code",
    description: "Download the sliced G-code file. Requires a completed slice.",
    params: [],
  },
  export_zip: {
    id: "export_zip",
    phase: "export",
    label: "Export project (.t2p)",
    description: "Export the whole project (prompt, model, settings) as a .t2p file.",
    params: [],
  },
};

/** Current printer choices (built-ins + user customs), resolved fresh for selects + the AI catalog. */
function printerOptions(): { value: string; label: string }[] {
  const { customPrinters } = usePrinterStore.getState();
  return [...BUILTIN_PROFILES, ...customPrinters].map((p) => ({ value: p.id, label: p.name }));
}

/** True if an id is a real action (app action or mesh-edit feature). */
export function actionExists(id: string): boolean {
  return Boolean(FEATURES[id] || APP_ACTIONS[id]);
}

export function actionLabel(id: string): string {
  return FEATURES[id]?.label ?? APP_ACTIONS[id]?.label ?? id;
}

export function actionDescription(id: string): string | undefined {
  return FEATURES[id]?.description ?? APP_ACTIONS[id]?.description;
}

export function actionPhase(id: string): ActionPhase {
  return APP_ACTIONS[id]?.phase ?? (FEATURES[id] ? "edit" : "generate");
}

/** Param specs for an action — with dynamic select options (printers) injected at call time. */
export function paramsForAction(id: string): ParamSpec[] {
  if (FEATURES[id]) return FEATURES[id].params;
  const a = APP_ACTIONS[id];
  if (!a) return [];
  if (id === "select_printer") {
    return a.params.map((p) => (p.key === "printerId" ? { ...p, options: printerOptions() } : p));
  }
  return a.params;
}

/** Clamp/fill a raw param object against an action's specs (app action or feature). */
export function coerceActionParams(id: string, raw: FeatureParams = {}): FeatureParams {
  if (FEATURES[id]) return coerceFeatureParams(FEATURES[id], raw);
  const out: FeatureParams = {};
  for (const spec of paramsForAction(id)) {
    const v = raw[spec.key];
    if (spec.type === "number") {
      let n = typeof v === "number" && isFinite(v) ? v : (spec.default as number);
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      out[spec.key] = n;
    } else if (spec.type === "boolean") {
      out[spec.key] = typeof v === "boolean" ? v : (spec.default as boolean);
    } else if (spec.type === "text") {
      out[spec.key] = typeof v === "string" ? v : (spec.default as string);
    } else {
      const valid = spec.options?.some((o) => o.value === v);
      out[spec.key] = valid ? (v as string) : (spec.default as string);
    }
  }
  return out;
}

export interface ActionCatalogEntry {
  id: string;
  phase: ActionPhase;
  label: string;
  description: string;
  params: { key: string; type: string; default: unknown; options?: string[] }[];
}

/** The combined catalog handed to the master planner so it only orders actions that exist. */
export function actionCatalogForAI(): ActionCatalogEntry[] {
  const app: ActionCatalogEntry[] = Object.values(APP_ACTIONS).map((a) => ({
    id: a.id,
    phase: a.phase,
    label: a.label,
    description: a.description,
    params: paramsForAction(a.id).map((p) => ({
      key: p.key,
      type: p.type,
      default: p.default,
      ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
    })),
  }));
  const feats: ActionCatalogEntry[] = featureCatalogForAI().map((f) => ({ ...f, phase: "edit" as const }));
  return [...app, ...feats];
}
