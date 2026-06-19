import * as THREE from "three";
import type { ModelTransform, ModelBounds } from "@/stores/viewerStore";
import type { PrinterProfile } from "@/lib/printer-profiles";

/**
 * World-space axis-aligned bounding box of a model after its viewer transform.
 *
 * The loaded geometry is centered on X/Z with its bottom at Y=0, so its local
 * box is [-x/2, x/2] × [0, y] × [-z/2, z/2]. We transform the 8 corners through
 * the exact same scale → rotation (deg, XYZ Euler) → position pipeline the mesh
 * uses in ModelMesh, then take the min/max — this keeps the box correct even
 * under rotation, which a naive size*scale would not.
 */
export function computeTransformedBounds(
  size: ModelBounds,
  transform: ModelTransform,
): THREE.Box3 {
  const [sx, sy, sz] = transform.scale;
  const [rx, ry, rz] = transform.rotation;
  const [px, py, pz] = transform.position;

  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        (rx * Math.PI) / 180,
        (ry * Math.PI) / 180,
        (rz * Math.PI) / 180,
        "XYZ",
      ),
    ),
    new THREE.Vector3(sx, sy, sz),
  );

  const hx = size.x / 2;
  const hz = size.z / 2;
  const corners = [
    [-hx, 0, -hz], [hx, 0, -hz], [-hx, 0, hz], [hx, 0, hz],
    [-hx, size.y, -hz], [hx, size.y, -hz], [-hx, size.y, hz], [hx, size.y, hz],
  ];

  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const [x, y, z] of corners) {
    box.expandByPoint(v.set(x, y, z).applyMatrix4(matrix));
  }
  return box;
}

/** Safety clearance (mm) kept on every bed edge so the nozzle/head never runs
 *  off the printable area. Applied to the XY footprint check below and mirrored
 *  by the backend slicer's placement inset. */
export const BED_MARGIN_MM = 5;

export interface FitResult {
  /** True when the model is fully inside the printer's build volume. */
  fits: boolean;
  /** Per-axis overflow flags (model X→width, Y→height, Z→depth). */
  exceeds: { x: boolean; y: boolean; z: boolean };
  /** Per-axis overflow magnitude in mm (0 when the axis fits). */
  overflow: { x: number; y: number; z: number };
  /** Transformed model extents in mm (width, height, depth). */
  dims: { x: number; y: number; z: number };
  /** Bed footprint occupied by the model's XZ footprint, as a percentage. */
  footprintPct: number;
  /** Model height as a percentage of the printer's max Z height. */
  heightPct: number;
}

/**
 * Evaluate whether a model's world-space box fits inside a printer's build
 * volume. The volume occupies [-w/2, w/2] × [0, h] × [-d/2, d/2] (origin at the
 * center of the bed top), matching how the bed and models are placed.
 *
 * `marginMm` shrinks the usable XY footprint by that clearance on every edge,
 * matching the backend slicer's placement inset, so the pre-slice check agrees
 * with where the model will actually be printed.
 */
export function evaluateFit(
  box: THREE.Box3,
  profile: PrinterProfile,
  marginMm = 0,
): FitResult {
  const dims = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };

  const m = Math.max(0, marginMm);
  const halfW = Math.max(0, profile.bedWidth / 2 - m);
  const halfD = Math.max(0, profile.bedDepth / 2 - m);
  const EPS = 1e-3;

  const exceeds = {
    x: box.min.x < -halfW - EPS || box.max.x > halfW + EPS,
    y: box.min.y < -EPS || box.max.y > profile.bedHeight + EPS,
    z: box.min.z < -halfD - EPS || box.max.z > halfD + EPS,
  };

  // Overflow magnitude per axis (how far the model pokes past the usable area).
  const over = (lo: number, hi: number, bound: number) =>
    Math.max(0, -lo - bound, hi - bound);
  const overflow = {
    x: over(box.min.x, box.max.x, halfW),
    y: Math.max(0, -box.min.y, box.max.y - profile.bedHeight),
    z: over(box.min.z, box.max.z, halfD),
  };

  const bedArea = profile.bedWidth * profile.bedDepth;
  const footprintPct = bedArea > 0 ? (dims.x * dims.z) / bedArea * 100 : 0;
  const heightPct = profile.bedHeight > 0 ? (dims.y / profile.bedHeight) * 100 : 0;

  return {
    fits: !exceeds.x && !exceeds.y && !exceeds.z,
    exceeds,
    overflow,
    dims,
    footprintPct,
    heightPct,
  };
}
