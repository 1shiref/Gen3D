import fs from "fs";
import { parseStl, getStlBounds } from "./ts-slicer/stl-parser";

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface PrintabilityReport {
  hasOverhangs: boolean;
  overhangPercent: number;
  wallThicknessOk: boolean;
  warnings: string[];
  materialSuggestion: string;
}

export function getStlBoundingBox(stlPath: string): BoundingBox {
  const buffer = fs.readFileSync(stlPath);
  const triangles = parseStl(buffer);
  const bounds = getStlBounds(triangles);
  return {
    x: Math.round((bounds.max.x - bounds.min.x) * 100) / 100,
    y: Math.round((bounds.max.y - bounds.min.y) * 100) / 100,
    z: Math.round((bounds.max.z - bounds.min.z) * 100) / 100,
  };
}

export interface BedSize { w: number; d: number; h: number }

// Mirrors frontend printer-profiles.ts. The backend needs bed dimensions for
// pre-slice validation; we keep this small map here rather than sharing code
// across workspaces.
const BED_PROFILES: Record<string, BedSize> = {
  "ender3": { w: 220, d: 220, h: 250 },
  "bambu-x1c": { w: 256, d: 256, h: 256 },
  "prusa-mk4": { w: 250, d: 210, h: 220 },
  "anycubic-kobra": { w: 220, d: 220, h: 250 },
  "custom": { w: 200, d: 200, h: 200 },
};

export function getBedSize(printerPreset?: string): BedSize {
  return BED_PROFILES[printerPreset ?? "ender3"] ?? BED_PROFILES["ender3"];
}

export interface DimensionCheck {
  actual: BoundingBox;
  declared: BoundingBox | null;
  /** max(actual_i / declared_i) — null if no declared header. Flagged when outside [0.75, 1.25]. */
  mismatchFactor: number | null;
  /** Suggested uniform factor to apply to the STL so it matches the AI's declared size. */
  scaleToDeclared: number | null;
  exceedsBed: boolean;
  bed: BedSize;
  /** Suggested uniform factor to fit inside the bed with 5% margin. */
  scaleToFitBed: number | null;
}

export function checkDimensions(
  actual: BoundingBox,
  declared: BoundingBox | null,
  bed: BedSize,
): DimensionCheck {
  let mismatchFactor: number | null = null;
  let scaleToDeclared: number | null = null;
  if (declared && declared.x > 0 && declared.y > 0 && declared.z > 0) {
    const rx = actual.x / declared.x;
    const ry = actual.y / declared.y;
    const rz = actual.z / declared.z;
    // Use the extreme of (max, 1/min) so both "too big" and "too small" surface symmetrically.
    mismatchFactor = Math.max(rx, ry, rz, 1 / rx, 1 / ry, 1 / rz);
    // Uniform factor that brings the largest declared/actual axis ratio to 1.
    // Average the per-axis ratios so a slightly anisotropic STL still gets a sensible single factor.
    scaleToDeclared = (declared.x / actual.x + declared.y / actual.y + declared.z / actual.z) / 3;
  }

  const exceedsBed = actual.x > bed.w || actual.y > bed.d || actual.z > bed.h;
  const fitFactor = Math.min(bed.w / actual.x, bed.d / actual.y, bed.h / actual.z);
  const scaleToFitBed = isFinite(fitFactor) && fitFactor > 0 ? fitFactor * 0.95 : null;

  return {
    actual,
    declared,
    mismatchFactor: mismatchFactor !== null ? Math.round(mismatchFactor * 1000) / 1000 : null,
    scaleToDeclared: scaleToDeclared !== null ? Math.round(scaleToDeclared * 10000) / 10000 : null,
    exceedsBed,
    bed,
    scaleToFitBed: scaleToFitBed !== null ? Math.round(scaleToFitBed * 10000) / 10000 : null,
  };
}

export function analyzePrintability(stlPath: string): PrintabilityReport {
  const buffer = fs.readFileSync(stlPath);
  const triangles = parseStl(buffer);
  const warnings: string[] = [];

  // Check overhangs: faces where normal.z < -cos(45°) ≈ -0.707
  const overhangThreshold = -0.707;
  let overhangCount = 0;

  for (const tri of triangles) {
    const nz = tri.normal.z;
    if (nz < overhangThreshold) overhangCount++;
  }

  const overhangPercent = Math.round((overhangCount / Math.max(triangles.length, 1)) * 100);
  const hasOverhangs = overhangPercent > 5;

  if (hasOverhangs) {
    warnings.push(`${overhangPercent}% of faces have overhangs >45° — supports may be required`);
  }

  // Material suggestion
  let materialSuggestion = "PLA";
  if (overhangPercent > 30) {
    materialSuggestion = "PETG (better layer adhesion for overhangs)";
  }

  // Wall thickness heuristic: check if model is very thin
  const bounds = getStlBounds(triangles);
  const minDim = Math.min(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  );

  const wallThicknessOk = minDim >= 1.2;
  if (!wallThicknessOk) {
    warnings.push(`Minimum dimension ${minDim.toFixed(1)}mm may be too thin for FDM (min recommended: 1.2mm)`);
    materialSuggestion = "TPU (flexible material handles thin walls better)";
  }

  return { hasOverhangs, overhangPercent, wallThicknessOk, warnings, materialSuggestion };
}

/**
 * Read an STL, multiply every vertex (and the per-axis normal sign) by `scale`,
 * write a binary STL to `outPath`. Used to bake a viewer-applied scale into the
 * STL before slicing so G-code matches what the user previewed.
 */
export function writeScaledStl(srcPath: string, outPath: string, scale: [number, number, number]): void {
  const buffer = fs.readFileSync(srcPath);
  const triangles = parseStl(buffer);
  const [sx, sy, sz] = scale;

  // Binary STL: 80-byte header + uint32 count + 50 bytes/triangle
  const out = Buffer.alloc(84 + triangles.length * 50);
  out.write("Gen3D scaled STL".padEnd(80, " "), 0, "ascii");
  out.writeUInt32LE(triangles.length, 80);

  let off = 84;
  for (const t of triangles) {
    // Normals stay unit-length under uniform scale; for non-uniform we recompute
    // from the scaled triangle to stay correct.
    const v0x = t.v0.x * sx, v0y = t.v0.y * sy, v0z = t.v0.z * sz;
    const v1x = t.v1.x * sx, v1y = t.v1.y * sy, v1z = t.v1.z * sz;
    const v2x = t.v2.x * sx, v2y = t.v2.y * sy, v2z = t.v2.z * sz;

    const ax = v1x - v0x, ay = v1y - v0y, az = v1z - v0z;
    const bx = v2x - v0x, by = v2y - v0y, bz = v2z - v0z;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nLen; ny /= nLen; nz /= nLen;

    out.writeFloatLE(nx, off); off += 4;
    out.writeFloatLE(ny, off); off += 4;
    out.writeFloatLE(nz, off); off += 4;
    out.writeFloatLE(v0x, off); off += 4;
    out.writeFloatLE(v0y, off); off += 4;
    out.writeFloatLE(v0z, off); off += 4;
    out.writeFloatLE(v1x, off); off += 4;
    out.writeFloatLE(v1y, off); off += 4;
    out.writeFloatLE(v1z, off); off += 4;
    out.writeFloatLE(v2x, off); off += 4;
    out.writeFloatLE(v2y, off); off += 4;
    out.writeFloatLE(v2z, off); off += 4;
    out.writeUInt16LE(0, off); off += 2;
  }

  fs.writeFileSync(outPath, out);
}

export function stlToObj(stlPath: string): string {
  const buffer = fs.readFileSync(stlPath);
  const triangles = parseStl(buffer);
  const lines: string[] = ["# OBJ exported by Gen3D"];
  let vi = 1;

  for (const tri of triangles) {
    for (const v of [tri.v0, tri.v1, tri.v2]) {
      lines.push(`v ${v.x} ${v.y} ${v.z}`);
    }
    lines.push(`f ${vi} ${vi + 1} ${vi + 2}`);
    vi += 3;
  }

  return lines.join("\n");
}
