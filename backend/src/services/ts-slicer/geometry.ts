import type { Pt, Loop } from "./types";
import type { Segment } from "./slicer-engine";

/**
 * 2D polygon geometry helpers for the pure-TS slicer.
 *
 * NOTE: polygon offsetting here is a pragmatic edge-offset (no external clipper
 * dependency). It is robust for convex and mildly concave outlines; very sharp
 * concavities can self-intersect. Collapsed/inverted loops are dropped. Good
 * enough for FDM walls/infill boundaries at this project's scale — see plan.
 */

const EPS = 1e-6;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area; > 0 ⇒ counter-clockwise (CCW), < 0 ⇒ clockwise (CW). */
export function signedArea(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function loopLength(loop: Loop): number {
  let len = 0;
  for (let i = 0; i < loop.length; i++) len += dist(loop[i], loop[(i + 1) % loop.length]);
  return len;
}

/** Ray-casting point-in-polygon for a single loop (treats loop as closed). */
export function pointInLoop(pt: Pt, loop: Loop): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    const intersect =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Even-odd membership across a set of loops (outer + holes). */
export function pointInRegion(pt: Pt, loops: Loop[]): boolean {
  let inside = false;
  for (const loop of loops) if (pointInLoop(pt, loop)) inside = !inside;
  return inside;
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bboxOfLoops(loops: Loop[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops)
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}

/**
 * Stitch loose layer segments into closed loops by joining matching endpoints.
 * Returns loops oriented so outer boundaries are CCW and holes are CW (so the
 * "erode" offset convention below shrinks the solid uniformly).
 */
export function stitchLoops(segments: Segment[], tol = 0.02): Loop[] {
  const pts: Pt[] = [];
  const segs: [number, number][] = [];
  const key = (x: number, y: number) => `${Math.round(x / tol)}:${Math.round(y / tol)}`;
  const index = new Map<string, number>();
  const idOf = (x: number, y: number): number => {
    const k = key(x, y);
    const found = index.get(k);
    if (found !== undefined) return found;
    const id = pts.length;
    pts.push({ x, y });
    index.set(k, id);
    return id;
  };

  for (const s of segments) {
    const a = idOf(s.a.x, s.a.y);
    const b = idOf(s.b.x, s.b.y);
    if (a !== b) segs.push([a, b]);
  }

  // Adjacency: each point → list of [otherPoint, segIndex]
  const adj = new Map<number, Array<{ to: number; seg: number }>>();
  segs.forEach(([a, b], i) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ to: b, seg: i });
    adj.get(b)!.push({ to: a, seg: i });
  });

  const used = new Array(segs.length).fill(false);
  const loops: Loop[] = [];

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    const [s0, s1] = segs[start];
    used[start] = true;
    const loop: number[] = [s0, s1];
    let cur = s1;
    let prev = s0;

    // Walk forward, always taking an unused edge from the current vertex.
    while (cur !== s0) {
      const nbrs = adj.get(cur) ?? [];
      let next = -1;
      let nextSeg = -1;
      for (const n of nbrs) {
        if (used[n.seg]) continue;
        if (n.to === prev && nbrs.length > 1) continue;
        next = n.to;
        nextSeg = n.seg;
        break;
      }
      if (next === -1) break; // open chain — give up on this loop
      used[nextSeg] = true;
      if (next === s0) break;
      loop.push(next);
      prev = cur;
      cur = next;
    }

    if (loop.length >= 3) loops.push(loop.map((id) => pts[id]));
  }

  return orientLoops(loops);
}

/** Force outer loops CCW and holes CW based on even-odd nesting depth. */
export function orientLoops(loops: Loop[]): Loop[] {
  return loops.map((loop) => {
    const rep = loop[0];
    let depth = 0;
    for (const other of loops) {
      if (other === loop) continue;
      if (pointInLoop(rep, other)) depth++;
    }
    const isHole = depth % 2 === 1;
    const ccw = signedArea(loop) > 0;
    // outer → CCW, hole → CW
    if (isHole === ccw) return [...loop].reverse();
    return loop;
  });
}

/**
 * Offset (erode) a single loop by `dist` mm using its orientation. With the
 * CCW-outer / CW-hole convention, a positive distance shrinks the solid region.
 * Returns null if the loop collapses or inverts.
 */
export function offsetLoop(loop: Loop, d: number): Loop | null {
  if (loop.length < 3 || Math.abs(d) < EPS) return loop.length >= 3 ? loop : null;

  const n = loop.length;
  // Each edge i: from loop[i] → loop[i+1]. Inward (left) normal for CCW.
  const offsetA: Pt[] = [];
  const offsetDir: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    const ex = q.x - p.x, ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = -ey / len, ny = ex / len; // left normal
    offsetA.push({ x: p.x + nx * d, y: p.y + ny * d });
    offsetDir.push({ x: ex / len, y: ey / len });
  }

  // New vertex j = intersection of offset edge (j-1) and offset edge (j).
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const i = (j - 1 + n) % n;
    const p = lineIntersect(offsetA[i], offsetDir[i], offsetA[j], offsetDir[j]);
    out.push(p ?? offsetA[j]);
  }

  const origCCW = signedArea(loop) > 0;
  const newArea = signedArea(out);
  if (Math.abs(newArea) < EPS) return null;
  // Orientation flipped ⇒ loop turned inside out (over-eroded).
  if (origCCW !== newArea > 0) return null;
  return out;
}

/** Intersect line (a0 + t·d0) with (a1 + s·d1). */
function lineIntersect(a0: Pt, d0: Pt, a1: Pt, d1: Pt): Pt | null {
  const denom = d0.x * d1.y - d0.y * d1.x;
  if (Math.abs(denom) < EPS) return null; // parallel
  const t = ((a1.x - a0.x) * d1.y - (a1.y - a0.y) * d1.x) / denom;
  return { x: a0.x + d0.x * t, y: a0.y + d0.y * t };
}

/** Offset every loop in a region by `d` (erode). Drops collapsed loops. */
export function offsetRegion(loops: Loop[], d: number): Loop[] {
  const out: Loop[] = [];
  for (const loop of loops) {
    const o = offsetLoop(loop, d);
    if (o && Math.abs(signedArea(o)) > 0.05) out.push(o);
  }
  return out;
}

/**
 * Scanline fill: returns straight segments covering `loops` (even-odd) with
 * parallel lines at `angleDeg`, spaced `spacing` mm apart.
 */
export function scanlineFill(loops: Loop[], spacing: number, angleDeg: number): Array<[Pt, Pt]> {
  if (loops.length === 0 || spacing <= 0) return [];
  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-theta), sin = Math.sin(-theta);
  // Rotate loops by -theta so fill lines become horizontal.
  const rot = (p: Pt): Pt => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const inv = (p: Pt): Pt => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const rLoops = loops.map((l) => l.map(rot));
  const bb = bboxOfLoops(rLoops);

  const out: Array<[Pt, Pt]> = [];
  // Offset start so the pattern is stable across layers.
  const startY = Math.ceil(bb.minY / spacing) * spacing;
  for (let y = startY; y <= bb.maxY; y += spacing) {
    const xs: number[] = [];
    for (const loop of rLoops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if (a.y > y !== b.y > y) {
          const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
          xs.push(x);
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k], x1 = xs[k + 1];
      if (x1 - x0 < EPS) continue;
      out.push([inv({ x: x0, y }), inv({ x: x1, y })]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occupancy grids — used for top/bottom skin detection and support generation.
// ---------------------------------------------------------------------------

export interface GridSpec { minX: number; minY: number; res: number; w: number; h: number }

/** Build a grid covering `bb` (+margin) with the given resolution, capped to ~maxCells. */
export function makeGrid(bb: BBox, res: number, margin = 1, maxCells = 400_000): GridSpec {
  const minX = bb.minX - margin;
  const minY = bb.minY - margin;
  const spanX = bb.maxX - bb.minX + margin * 2;
  const spanY = bb.maxY - bb.minY + margin * 2;
  let r = Math.max(res, 0.1);
  let w = Math.max(1, Math.ceil(spanX / r));
  let h = Math.max(1, Math.ceil(spanY / r));
  while (w * h > maxCells) {
    r *= 1.5;
    w = Math.max(1, Math.ceil(spanX / r));
    h = Math.max(1, Math.ceil(spanY / r));
  }
  return { minX, minY, res: r, w, h };
}

/** Rasterize a region (even-odd loops) into an occupancy grid via row scanlines. */
export function rasterizeRegion(loops: Loop[], g: GridSpec): Uint8Array {
  const occ = new Uint8Array(g.w * g.h);
  if (loops.length === 0) return occ;
  for (let row = 0; row < g.h; row++) {
    const y = g.minY + (row + 0.5) * g.res;
    const xs: number[] = [];
    for (const loop of loops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if (a.y > y !== b.y > y) {
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.floor((xs[k] - g.minX) / g.res));
      const c1 = Math.min(g.w - 1, Math.ceil((xs[k + 1] - g.minX) / g.res));
      for (let c = c0; c <= c1; c++) occ[row * g.w + c] = 1;
    }
  }
  return occ;
}

export function sampleGrid(occ: Uint8Array, g: GridSpec, x: number, y: number): boolean {
  const c = Math.floor((x - g.minX) / g.res);
  const r = Math.floor((y - g.minY) / g.res);
  if (c < 0 || r < 0 || c >= g.w || r >= g.h) return false;
  return occ[r * g.w + c] === 1;
}

/** Morphological dilation by `cells` (Chebyshev). Used for xy-distance / overhang margins. */
export function dilateGrid(occ: Uint8Array, g: GridSpec, cells: number): Uint8Array {
  if (cells <= 0) return occ;
  let src = occ;
  for (let step = 0; step < cells; step++) {
    const dst = new Uint8Array(g.w * g.h);
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        if (!src[r * g.w + c]) continue;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nc >= 0 && nr < g.h && nc < g.w) dst[nr * g.w + nc] = 1;
          }
      }
    src = dst;
  }
  return src;
}

/** Trace the occupied cells of a grid mask into rectangular loops (one per cell run). */
export function gridToLoops(occ: Uint8Array, g: GridSpec): Loop[] {
  // Coarse outline: emit one box loop per horizontal run of occupied cells.
  const loops: Loop[] = [];
  for (let r = 0; r < g.h; r++) {
    let c = 0;
    while (c < g.w) {
      if (!occ[r * g.w + c]) { c++; continue; }
      let c1 = c;
      while (c1 < g.w && occ[r * g.w + c1]) c1++;
      const x0 = g.minX + c * g.res;
      const x1 = g.minX + c1 * g.res;
      const y0 = g.minY + r * g.res;
      const y1 = g.minY + (r + 1) * g.res;
      loops.push([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
      c = c1;
    }
  }
  return loops;
}
