import * as THREE from "three";
import {
  rotate, scaleNonUniform, scaleUniform, resizeToDimension, mirror, layFlat,
  centerOnBed, addHole, splitIntoParts, splitIntoPartGeometries, type Axis, type SplitParams,
} from "./operations";

export type ParamType = "number" | "select" | "boolean" | "text";

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /** Hide this field in the Tools form when the predicate is true (other params still apply). */
  hidden?: (values: FeatureParams) => boolean;
}

export type FeatureGroup = "Transform" | "Holes" | "Split";

/** Model size (X/Y/Z extents, mm) — mirrors viewerStore.ModelBounds but kept local so this
 *  lib stays free of store imports. */
export interface Dims {
  x: number;
  y: number;
  z: number;
}

/**
 * Which in-viewport "Edit in 3D" draft visual a feature uses.
 *  - rotate/scale/scaleAxes/resize/mirror/seat: cheap matrix ops → live full-geometry ghost.
 *  - hole/split: expensive CSG → lightweight schematic ghost (no live boolean).
 */
export type DraftKind =
  | "rotate" | "scale" | "scaleAxes" | "resize" | "mirror" | "seat"
  | "hole" | "split";

export type FeatureParams = Record<string, number | string | boolean>;

export interface Feature {
  id: string;
  label: string;
  description: string;
  group: FeatureGroup;
  params: ParamSpec[];
  apply: (geo: THREE.BufferGeometry, p: FeatureParams) => THREE.BufferGeometry;
  /** Optional in-viewport draft visual; presence enables the "Edit in 3D" button. */
  draftKind?: DraftKind;
  /** Short "when to use it" hint shown under the form, above the parameters. */
  hint?: string;
  /** Initial values fitted to the loaded model (mm). Merged over the static defaults the
   *  first time a form opens; the user can still edit freely afterwards. */
  fit?: (d: Dims) => Partial<FeatureParams>;
}

const AXIS_OPTIONS = [
  { value: "x", label: "X" },
  { value: "y", label: "Y (up)" },
  { value: "z", label: "Z" },
];

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const axis = (v: unknown, d: Axis = "y"): Axis => (v === "x" || v === "y" || v === "z" ? v : d);
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Round to a sensible UI precision (0.5 mm for small features). */
const round1 = (v: number) => Math.round(v * 10) / 10;
const roundHalf = (v: number) => Math.round(v * 2) / 2;

export const FEATURES: Record<string, Feature> = {
  rotate: {
    id: "rotate",
    label: "Rotate",
    description: "Rotate the model about an axis by an angle in degrees.",
    hint: "Reorient the model — e.g. spin it to face front or tilt it before laying flat.",
    group: "Transform",
    draftKind: "rotate",
    params: [
      { key: "axis", label: "Axis", type: "select", default: "z", options: AXIS_OPTIONS },
      { key: "deg", label: "Angle", type: "number", default: 90, min: -360, max: 360, step: 5, unit: "°" },
    ],
    apply: (g, p) => rotate(g, axis(p.axis, "z"), num(p.deg, 90)),
  },

  scale_uniform: {
    id: "scale_uniform",
    label: "Scale",
    description: "Scale the whole model uniformly by a factor (1 = unchanged).",
    hint: "Make the whole model bigger or smaller while keeping its proportions.",
    group: "Transform",
    draftKind: "scale",
    params: [{ key: "factor", label: "Factor", type: "number", default: 1, min: 0.01, max: 100, step: 0.05, unit: "×" }],
    apply: (g, p) => scaleUniform(g, num(p.factor, 1)),
  },

  scale_axes: {
    id: "scale_axes",
    label: "Scale per axis",
    description: "Scale X, Y, Z independently (stretch/squash).",
    hint: "Stretch or squash one direction — e.g. make it wider without making it taller.",
    group: "Transform",
    draftKind: "scaleAxes",
    params: [
      { key: "sx", label: "X", type: "number", default: 1, min: 0.01, max: 100, step: 0.05, unit: "×" },
      { key: "sy", label: "Y", type: "number", default: 1, min: 0.01, max: 100, step: 0.05, unit: "×" },
      { key: "sz", label: "Z", type: "number", default: 1, min: 0.01, max: 100, step: 0.05, unit: "×" },
    ],
    apply: (g, p) => scaleNonUniform(g, [num(p.sx, 1), num(p.sy, 1), num(p.sz, 1)]),
  },

  resize: {
    id: "resize",
    label: "Resize to size",
    description: "Resize so one axis measures an exact mm value. Use this to 'make it taller' (axis Y). Uniform keeps proportions.",
    hint: "Set an exact real-world size in mm. Opens at the model's current height.",
    group: "Transform",
    draftKind: "resize",
    params: [
      { key: "axis", label: "Axis", type: "select", default: "y", options: AXIS_OPTIONS },
      { key: "mm", label: "Target", type: "number", default: 50, min: 0.1, max: 2000, step: 1, unit: "mm" },
      { key: "uniform", label: "Keep proportions", type: "boolean", default: false },
    ],
    apply: (g, p) => resizeToDimension(g, axis(p.axis, "y"), num(p.mm, 50), bool(p.uniform)),
    // Default the target to the current height (Y) so the field shows the real size.
    fit: (d) => ({ mm: round1(d.y) }),
  },

  mirror: {
    id: "mirror",
    label: "Mirror",
    description: "Mirror the model across an axis.",
    hint: "Flip the model to make a left/right-handed version.",
    group: "Transform",
    draftKind: "mirror",
    params: [{ key: "axis", label: "Axis", type: "select", default: "x", options: AXIS_OPTIONS }],
    apply: (g, p) => mirror(g, axis(p.axis, "x")),
  },

  center_on_bed: {
    id: "center_on_bed",
    label: "Center on bed",
    description: "Recenter the model on the bed with its base flat at the floor.",
    hint: "Fix a model that floats above or sinks below the bed, or sits off-center.",
    group: "Transform",
    draftKind: "seat",
    params: [],
    apply: (g) => centerOnBed(g),
  },

  lay_flat: {
    id: "lay_flat",
    label: "Lay flat",
    description: "Tip the model so the chosen axis points down onto the bed.",
    hint: "Lay a tall/leaning model on its side for a stronger, support-free print.",
    group: "Transform",
    draftKind: "seat",
    params: [{ key: "downAxis", label: "Axis down", type: "select", default: "z", options: AXIS_OPTIONS }],
    apply: (g, p) => layFlat(g, axis(p.downAxis, "z")),
  },

  add_hole: {
    id: "add_hole",
    label: "Add hole / cutout",
    description: "Subtract a cylindrical bore or rectangular cutout. depth 0 = through hole. x/y/z is the hole center in mm from the model center (base at y=0).",
    hint: "Bore a hole or cut a pocket — e.g. a mounting hole or cable pass-through.",
    group: "Holes",
    draftKind: "hole",
    params: [
      { key: "shape", label: "Shape", type: "select", default: "cylinder", options: [
        { value: "cylinder", label: "Cylinder" }, { value: "box", label: "Box" }] },
      { key: "axis", label: "Axis", type: "select", default: "z", options: AXIS_OPTIONS },
      { key: "diameter", label: "Diameter", type: "number", default: 5, min: 0.2, max: 500, step: 0.5, unit: "mm", help: "Cylinder only" },
      { key: "width", label: "Width", type: "number", default: 5, min: 0.2, max: 500, step: 0.5, unit: "mm", help: "Box only" },
      { key: "height", label: "Height", type: "number", default: 5, min: 0.2, max: 500, step: 0.5, unit: "mm", help: "Box only" },
      { key: "depth", label: "Depth (0 = through)", type: "number", default: 0, min: 0, max: 1000, step: 1, unit: "mm" },
      { key: "x", label: "X", type: "number", default: 0, min: -1000, max: 1000, step: 1, unit: "mm" },
      { key: "y", label: "Y", type: "number", default: 0, min: 0, max: 1000, step: 1, unit: "mm" },
      { key: "z", label: "Z", type: "number", default: 0, min: -1000, max: 1000, step: 1, unit: "mm" },
      { key: "rx", label: "Tilt X", type: "number", default: 0, min: -180, max: 180, step: 1, unit: "°" },
      { key: "ry", label: "Tilt Y", type: "number", default: 0, min: -180, max: 180, step: 1, unit: "°" },
      { key: "rz", label: "Tilt Z", type: "number", default: 0, min: -180, max: 180, step: 1, unit: "°" },
    ],
    apply: (g, p) => {
      g.computeBoundingBox();
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      return addHole(g, {
        shape: p.shape === "box" ? "box" : "cylinder",
        axis: axis(p.axis, "z"),
        diameter: num(p.diameter, 5),
        width: num(p.width, 5),
        height: num(p.height, 5),
        depth: num(p.depth, 0),
        x: num(p.x, c.x),
        y: num(p.y, c.y),
        z: num(p.z, c.z),
        rx: num(p.rx, 0),
        ry: num(p.ry, 0),
        rz: num(p.rz, 0),
      });
    },
    // Size the bore relative to the footprint and center it at mid-height (matches the handle).
    fit: (d) => {
      const dia = roundHalf(clamp(Math.min(d.x, d.z) * 0.15, 1, 500));
      return { diameter: dia, width: dia, height: dia, y: round1(d.y / 2) };
    },
  },

  split_parts: {
    id: "split_parts",
    label: "Split into parts",
    description: "Cut a model too big for the bed into parts along an axis, with optional alignment pins and matching holes to assemble after printing. Pieces stay in place as separate, movable objects.",
    hint: "Cut a model that's too big for the bed into parts with alignment pins. Pins are fitted to the model.",
    group: "Split",
    draftKind: "split",
    params: [
      { key: "axis", label: "Cut axis", type: "select", default: "z", options: AXIS_OPTIONS },
      { key: "count", label: "Parts", type: "number", default: 2, min: 2, max: 8, step: 1 },
      { key: "cut", label: "Custom cut (0 = even)", type: "number", default: 0, min: -1000, max: 1000, step: 1, unit: "mm" },
      { key: "addPins", label: "Alignment pins", type: "boolean", default: false,
        help: "Add male pins + matching sockets so parts snap together. Off = clean cuts only." },
      { key: "pinRadius", label: "Pin radius", type: "number", default: 2, min: 0.5, max: 20, step: 0.5, unit: "mm", hidden: (v) => v.addPins !== true },
      { key: "pinLength", label: "Pin length", type: "number", default: 6, min: 1, max: 60, step: 1, unit: "mm", hidden: (v) => v.addPins !== true },
      { key: "pinCount", label: "Pins per cut", type: "number", default: 3, min: 1, max: 4, step: 1, hidden: (v) => v.addPins !== true },
      { key: "clearance", label: "Hole clearance", type: "number", default: 0.2, min: 0, max: 2, step: 0.05, unit: "mm", hidden: (v) => v.addPins !== true },
    ],
    apply: (g, p) => splitIntoParts(g, toSplitParams(p)),
    // Size the alignment pins to the model (cut stays 0 — SplitHandles seeds the midpoint).
    fit: (d) => {
      const min = Math.min(d.x, d.y, d.z);
      return {
        pinRadius: roundHalf(clamp(min * 0.03, 1, 6)),
        pinLength: Math.round(clamp(min * 0.1, 3, 30)),
      };
    },
  },
};

export const FEATURE_LIST: Feature[] = Object.values(FEATURES);

/** Map raw split_parts form params → the operations-level SplitParams. Shared by the
 *  single-mesh apply and the multi-object (parts mode) path so both stay in sync. */
export function toSplitParams(p: FeatureParams): SplitParams {
  const cut = num(p.cut, 0);
  return {
    axis: axis(p.axis, "z"),
    count: num(p.count, 2),
    positions: cut !== 0 ? [cut] : undefined,
    addPins: bool(p.addPins, false),
    pinRadius: num(p.pinRadius, 2),
    pinLength: num(p.pinLength, 6),
    pinCount: num(p.pinCount, 3),
    clearance: num(p.clearance, 0.2),
  };
}

/** Split a model into its individual piece geometries (parts mode). */
export function splitPartGeometries(g: THREE.BufferGeometry, raw: FeatureParams): THREE.BufferGeometry[] {
  return splitIntoPartGeometries(g, toSplitParams(coerceParams(FEATURES.split_parts, raw)));
}

/**
 * Live ghost geometry for cheap transform drafts (rotate/scale/resize/mirror/seat) — the
 * preview is literally the feature's own result, so what you see is what Apply produces.
 * Returns null for CSG kinds (hole/split), which use lightweight schematic ghosts.
 */
export function featurePreview(
  geo: THREE.BufferGeometry,
  featureId: string,
  raw: FeatureParams = {},
): THREE.BufferGeometry | null {
  const feature = FEATURES[featureId];
  if (!feature) return null;
  switch (feature.draftKind) {
    case "rotate":
    case "scale":
    case "scaleAxes":
    case "resize":
    case "mirror":
    case "seat":
      try {
        return feature.apply(geo, coerceParams(feature, raw));
      } catch {
        return null;
      }
    default:
      return null; // hole / split → schematic ghost, no live boolean
  }
}

/** Clamp/fill a raw param object against a feature's specs (for UI + AI plans). */
export function coerceParams(feature: Feature, raw: FeatureParams = {}): FeatureParams {
  const out: FeatureParams = {};
  for (const spec of feature.params) {
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

/**
 * Initial form values for a feature, fitted to the loaded model when available.
 * Starts from the static `default`s, merges `feature.fit(dims)` (if any), then clamps via
 * `coerceParams`. This is the single seed the Tools UI uses — the user edits freely after.
 */
export function initialParams(feature: Feature, dims: Dims | null): FeatureParams {
  const raw: FeatureParams = {};
  for (const p of feature.params) raw[p.key] = p.default;
  if (dims && feature.fit) Object.assign(raw, feature.fit(dims));
  return coerceParams(feature, raw);
}

/** Compact catalog handed to the AI planner so it only orders features that exist. */
export function featureCatalogForAI(): { id: string; label: string; description: string; params: { key: string; type: string; default: unknown; options?: string[] }[] }[] {
  return FEATURE_LIST.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    params: f.params.map((p) => ({
      key: p.key,
      type: p.type,
      default: p.default,
      ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
    })),
  }));
}
