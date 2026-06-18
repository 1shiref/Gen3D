import * as THREE from "three";
import type { PrinterProfile } from "@/lib/printer-profiles";

/** Fraction of the smallest bed axis the longest model dimension should fill. */
export const TARGET_BED_FRACTION = 0.4;
/** Below this longest-dimension (mm) any model is treated as "unit-scale junk" and rescaled. */
export const TINY_THRESHOLD_MM = 10;

/**
 * Scale `geometry` IN PLACE so its longest dimension ≈ TARGET_BED_FRACTION * min(bed axes).
 *
 * Neural mesh engines (Hunyuan3D etc.) emit GLB geometry normalized to ~a unit cube, which the
 * viewer/slicer then read as ~1-2 mm — microscopic. This rescales such models to a printable size.
 *
 * - `force` true (generated meshes): always normalize (neural output is arbitrary unit space).
 * - `force` false (uploaded meshes): only rescue implausibly tiny models (< TINY_THRESHOLD_MM),
 *   so legitimately mm-sized uploads are left untouched.
 *
 * Returns the scale factor applied (1 = unchanged).
 */
export function normalizeModelSize(
  geometry: THREE.BufferGeometry,
  profile: PrinterProfile,
  force: boolean,
): number {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest <= 0) return 1;
  if (!force && longest >= TINY_THRESHOLD_MM) return 1;

  const target =
    TARGET_BED_FRACTION * Math.min(profile.bedWidth, profile.bedDepth, profile.bedHeight);
  if (target <= 0) return 1;

  const scale = target / longest;
  if (Math.abs(scale - 1) < 1e-3) return 1;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  return scale;
}
