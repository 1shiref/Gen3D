/** 2D point in a layer plane (mm). */
export interface Pt { x: number; y: number }

/** A closed polygon loop (implicit closing edge from last → first). */
export type Loop = Pt[];

/** Feature class of an extrusion path — drives speed, flow and fan in the emitter. */
export type FeatureType =
  | "wall-outer"
  | "wall-inner"
  | "skin"        // top/bottom solid
  | "fill"        // sparse infill
  | "support"
  | "support-interface"
  | "skirt"
  | "brim";

/** One continuous extrusion path within a layer. */
export interface ExtrusionPath {
  pts: Pt[];
  type: FeatureType;
  /** True for wall/perimeter loops (last point connects back to first). */
  closed: boolean;
}

/** All extrusion for a single layer, plus its absolute Z height. */
export interface SliceLayer {
  z: number;
  thickness: number;
  paths: ExtrusionPath[];
}
