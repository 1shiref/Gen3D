import type { SlicerSettings, InfillPattern } from "../slicer.service";
import type { Pt, Loop, ExtrusionPath, FeatureType } from "./types";
import {
  offsetRegion, scanlineFill, dist,
  GridSpec, sampleGrid,
} from "./geometry";

/** Cross-layer data needed to decide which infill cells are top/bottom skin. */
export interface SkinContext {
  grids: Uint8Array[];
  g: GridSpec;
  layerIndex: number;
  total: number;
}

const closedPath = (loop: Loop, type: FeatureType): ExtrusionPath => ({
  pts: [...loop, loop[0]],
  type,
  closed: true,
});

/**
 * Concentric wall loops. With `horizontalExpansion` the outline is grown/shrunk
 * first, then `wallLineCount` centreline loops are offset inward by lineWidth.
 * Returned inner→outer so the outer wall prints last (better surface finish).
 */
export function buildWalls(region: Loop[], s: SlicerSettings): ExtrusionPath[] {
  const lw = s.lineWidth;
  const base = s.horizontalExpansion !== 0 ? offsetRegion(region, -s.horizontalExpansion) : region;
  const loopsByRing: ExtrusionPath[][] = [];

  for (let i = 0; i < Math.max(0, s.wallLineCount); i++) {
    const ringLoops = offsetRegion(base, (i + 0.5) * lw);
    if (ringLoops.length === 0) break;
    const type: FeatureType = i === 0 ? "wall-outer" : "wall-inner";
    loopsByRing.push(ringLoops.map((l) => closedPath(l, type)));
  }

  // Emit innermost ring first, outer wall last.
  const out: ExtrusionPath[] = [];
  for (let i = loopsByRing.length - 1; i >= 0; i--) out.push(...loopsByRing[i]);
  return out;
}

/** Region available for infill/skin = solid eroded by all the walls. */
export function infillRegion(region: Loop[], s: SlicerSettings): Loop[] {
  const inset = Math.max(0, s.wallLineCount) * s.lineWidth;
  return inset > 0 ? offsetRegion(region, inset) : region;
}

function exposed(ctx: SkinContext, x: number, y: number, dir: 1 | -1, layers: number): boolean {
  for (let k = 1; k <= layers; k++) {
    const idx = ctx.layerIndex + dir * k;
    if (idx < 0 || idx >= ctx.total) return true; // open to air at model top/bottom
    if (!sampleGrid(ctx.grids[idx], ctx.g, x, y)) return true;
  }
  return false;
}

function isSkinCell(ctx: SkinContext, s: SlicerSettings, x: number, y: number): boolean {
  return (
    exposed(ctx, x, y, 1, Math.max(0, s.topLayers)) ||
    exposed(ctx, x, y, -1, Math.max(0, s.bottomLayers))
  );
}

/** Split a fill segment into runs where `keep(pt)` holds, sampled every `step` mm. */
function splitRuns(a: Pt, b: Pt, keep: (p: Pt) => boolean, step: number): Array<[Pt, Pt]> {
  const len = dist(a, b);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Array<[Pt, Pt]> = [];
  let runStart: Pt | null = null;
  let prev: Pt = a;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const mid = i === 0 ? a : { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    const k = keep(mid);
    if (k && runStart === null) runStart = prev;
    if (!k && runStart !== null) { out.push([runStart, prev]); runStart = null; }
    prev = p;
  }
  if (runStart !== null) out.push([runStart, b]);
  return out;
}

function patternAngles(pattern: InfillPattern, layerIndex: number): { angles: number[]; spacingMul: number } {
  const alt = layerIndex % 2 === 0 ? 45 : 135;
  switch (pattern) {
    case "grid": return { angles: [45, 135], spacingMul: 2 };
    case "triangles": return { angles: [0, 60, 120], spacingMul: 3 };
    case "concentric": return { angles: [], spacingMul: 1 };
    case "lines":
    case "zigzag":
    default: return { angles: [alt], spacingMul: 1 };
  }
}

/**
 * Top/bottom solid skin + sparse infill for one layer. Skin is laid where the
 * cell is exposed within top/bottom layers; sparse infill fills the rest at the
 * configured density and pattern.
 */
export function buildInfill(region: Loop[], s: SlicerSettings, ctx: SkinContext): ExtrusionPath[] {
  const inner = infillRegion(region, s);
  if (inner.length === 0) return [];

  const lw = s.lineWidth;
  const step = Math.max(lw, 0.5);
  const skin = (p: Pt) => isSkinCell(ctx, s, p.x, p.y);
  const paths: ExtrusionPath[] = [];

  // --- Solid skin (100%): scanlines spaced one line width, kept where exposed.
  const skinAngle = ctx.layerIndex % 2 === 0 ? 45 : 135;
  for (const [a, b] of scanlineFill(inner, lw, skinAngle)) {
    for (const [p, q] of splitRuns(a, b, skin, step))
      paths.push({ pts: [p, q], type: "skin", closed: false });
  }

  // --- Sparse infill: only where NOT skin.
  const density = Math.max(0, Math.min(100, s.infillDensity));
  if (density > 0) {
    const notSkin = (p: Pt) => !skin(p);
    if (s.infillPattern === "concentric") {
      // Successive inward offsets of the infill region.
      let ring = inner;
      const ringStep = lw / (density / 100);
      for (let guard = 0; guard < 200; guard++) {
        ring = offsetRegion(ring, ringStep);
        if (ring.length === 0) break;
        for (const loop of ring) {
          // keep concentric loops only over non-skin area (sampled at centroid-ish point)
          const mid = loop[0];
          if (notSkin(mid)) paths.push(closedPathOpen(loop));
        }
      }
    } else {
      const { angles, spacingMul } = patternAngles(s.infillPattern, ctx.layerIndex);
      const spacing = (lw / (density / 100)) * spacingMul;
      for (const ang of angles) {
        for (const [a, b] of scanlineFill(inner, spacing, ang)) {
          for (const [p, q] of splitRuns(a, b, notSkin, step))
            paths.push({ pts: [p, q], type: "fill", closed: false });
        }
      }
    }
  }

  return paths;
}

const closedPathOpen = (loop: Loop): ExtrusionPath => ({
  pts: [...loop, loop[0]],
  type: "fill",
  closed: true,
});

/**
 * First-layer build-plate adhesion. Skirt = loops offset OUTWARD from the
 * outline at a gap; brim = loops hugging the outline outward; raft is
 * approximated as a wide brim; none = nothing.
 */
export function buildAdhesion(region: Loop[], s: SlicerSettings): ExtrusionPath[] {
  const lw = s.lineWidth;
  const out: ExtrusionPath[] = [];

  if (s.buildPlateAdhesionType === "skirt") {
    for (let i = 0; i < Math.max(0, s.skirtLineCount); i++) {
      const d = -(s.skirtDistance + (i + 0.5) * lw); // negative = grow outward
      const loops = offsetRegion(region, d);
      for (const l of loops) out.push(closedPath(l, "skirt"));
    }
  } else if (s.buildPlateAdhesionType === "brim" || s.buildPlateAdhesionType === "raft") {
    const width = s.buildPlateAdhesionType === "raft" ? Math.max(s.brimWidth, 8) : s.brimWidth;
    const rings = Math.max(1, Math.round(width / lw));
    for (let i = 0; i < rings; i++) {
      const d = -((i + 0.5) * lw); // hug the outline, growing outward
      const loops = offsetRegion(region, d);
      for (const l of loops) out.push(closedPath(l, "brim"));
    }
  }
  return out;
}

/**
 * Best-effort support fill for one layer from a precomputed support occupancy
 * grid (see index.ts). Fills the masked cells with a zig-zag/line pattern at the
 * support density; the top `interface` layers of a column are laid solid.
 */
export function buildSupport(
  supportLoops: Loop[],
  s: SlicerSettings,
  layerIndex: number,
  isInterface: boolean,
): ExtrusionPath[] {
  if (supportLoops.length === 0) return [];
  const lw = s.lineWidth;
  const density = isInterface
    ? Math.max(s.supportInterfaceDensity, s.supportDensity)
    : s.supportDensity;
  const spacing = density > 0 ? lw / (Math.max(1, density) / 100) : lw * 4;
  const angle = layerIndex % 2 === 0 ? 0 : 90;
  const type: FeatureType = isInterface ? "support-interface" : "support";

  const paths: ExtrusionPath[] = [];
  for (const [a, b] of scanlineFill(supportLoops, spacing, angle))
    paths.push({ pts: [a, b], type, closed: false });
  return paths;
}
