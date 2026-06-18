import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { boolean } from "./csg";

// Accelerate THREE.Raycaster so the per-seam "is this point inside the model?"
// test (used to fit alignment pins) stays fast even on dense neural meshes.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Axis = "x" | "y" | "z";
const AXIS_I: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

// ─── shared helpers ──────────────────────────────────────────────────────────

/** True when the geometry has a real, finite bounding box. An empty/degenerate
 *  geometry (e.g. a CSG slice that came back with no triangles) yields +Inf/-Inf
 *  bounds — translating or sizing by those would fling geometry/the camera to
 *  infinity, so callers must skip the operation when this is false. */
function finiteBox(geo: THREE.BufferGeometry): boolean {
  const bb = geo.boundingBox;
  return !!bb && [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].every(Number.isFinite);
}

export function sizeOf(geo: THREE.BufferGeometry): THREE.Vector3 {
  geo.computeBoundingBox();
  if (!finiteBox(geo)) return new THREE.Vector3();
  return geo.boundingBox!.getSize(new THREE.Vector3());
}

/** Center on X/Z and drop the base to y=0 — the viewer's seating convention. */
export function centerOnBed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.computeBoundingBox();
  if (!finiteBox(g)) return g; // empty/degenerate — nothing to seat
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox();
  g.computeVertexNormals();
  return g;
}

/** Reverse triangle winding (used after a negative-determinant mirror). */
function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (index) {
    const a = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = a[i + k]; a[i + k] = a[i + 6 + k]; a[i + 6 + k] = t;
      }
    }
    pos.needsUpdate = true;
  }
}

/**
 * Bake an arbitrary world matrix into the geometry. Used to commit the viewer
 * transform gizmo (scale/rotate/move). Unlike centerOnBed it preserves X/Z so a
 * Move is honored; it only re-seats the base to y=0 so the part stays on the bed.
 */
export function bakeMatrix(
  geo: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  opts: { seatOnBed?: boolean } = { seatOnBed: true },
): THREE.BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) flipWinding(g); // mirror/negative scale
  g.computeBoundingBox();
  if (opts.seatOnBed && finiteBox(g)) {
    g.translate(0, -g.boundingBox!.min.y, 0);
    g.computeBoundingBox();
  }
  g.computeVertexNormals();
  return g;
}

/** Cylinder (default along +Y) reoriented to lie along the given axis. */
function axisCylinder(radius: number, length: number, axis: Axis): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(radius, radius, length, 48);
  if (axis === "x") cyl.rotateZ(Math.PI / 2);
  else if (axis === "z") cyl.rotateX(Math.PI / 2);
  return cyl;
}

// ─── transforms (matrix-only, always safe) ───────────────────────────────────

export function rotate(geo: THREE.BufferGeometry, axis: Axis, deg: number): THREE.BufferGeometry {
  const g = geo.clone();
  const rad = (deg * Math.PI) / 180;
  if (axis === "x") g.rotateX(rad);
  else if (axis === "y") g.rotateY(rad);
  else g.rotateZ(rad);
  return centerOnBed(g);
}

export function scaleNonUniform(geo: THREE.BufferGeometry, s: [number, number, number]): THREE.BufferGeometry {
  const g = geo.clone();
  g.scale(s[0], s[1], s[2]);
  return centerOnBed(g);
}

export function scaleUniform(geo: THREE.BufferGeometry, factor: number): THREE.BufferGeometry {
  return scaleNonUniform(geo, [factor, factor, factor]);
}

/**
 * Resize so `axis` measures exactly `mm`. When `uniform`, all axes scale by the
 * same factor (keeps proportions); otherwise only that axis stretches ("taller").
 */
export function resizeToDimension(
  geo: THREE.BufferGeometry,
  axis: Axis,
  mm: number,
  uniform = false,
): THREE.BufferGeometry {
  const size = sizeOf(geo);
  const cur = size.getComponent(AXIS_I[axis]) || 1;
  const f = mm / cur;
  return uniform ? scaleUniform(geo, f) : scaleNonUniform(
    geo,
    [axis === "x" ? f : 1, axis === "y" ? f : 1, axis === "z" ? f : 1],
  );
}

export function mirror(geo: THREE.BufferGeometry, axis: Axis): THREE.BufferGeometry {
  const g = geo.clone();
  g.scale(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1, axis === "z" ? -1 : 1);
  flipWinding(g);
  return centerOnBed(g);
}

/** Tip the model so the chosen axis points down onto the bed. */
export function layFlat(geo: THREE.BufferGeometry, downAxis: Axis): THREE.BufferGeometry {
  if (downAxis === "y") return centerOnBed(geo);
  const g = geo.clone();
  if (downAxis === "z") g.rotateX(-Math.PI / 2); // z → -y
  else g.rotateZ(Math.PI / 2); // x → -y
  return centerOnBed(g);
}

// ─── holes / cutouts ─────────────────────────────────────────────────────────

export interface HoleParams {
  shape: "cylinder" | "box";
  axis: Axis;
  /** Cylinder bore diameter (mm). */
  diameter?: number;
  /** Box cross-section (mm) on the two axes perpendicular to `axis`. */
  width?: number;
  height?: number;
  /** 0 = through hole; otherwise the tool length along `axis` (mm). */
  depth?: number;
  /** Hole center, in model-local mm (model centered X/Z, base at y=0). */
  x?: number;
  y?: number;
  z?: number;
  /** Free tilt of the bore (degrees), applied on top of the coarse `axis` orientation. */
  rx?: number;
  ry?: number;
  rz?: number;
}

const DEG = Math.PI / 180;

/** The coarse "bore along this axis" orientation — a +Y-local tool turned to face `axis`. */
export function holeBaseQuaternion(axis: Axis): THREE.Quaternion {
  // Matches the old axisCylinder rotations: x → rotateZ(90°), z → rotateX(90°), y → none.
  const e = new THREE.Euler(axis === "z" ? Math.PI / 2 : 0, 0, axis === "x" ? Math.PI / 2 : 0);
  return new THREE.Quaternion().setFromEuler(e);
}

/** Full bore orientation: free tilt (world frame) composed onto the axis orientation. */
export function holeOrientation(axis: Axis, rx = 0, ry = 0, rz = 0): THREE.Quaternion {
  const base = holeBaseQuaternion(axis);
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, "XYZ"));
  return tilt.multiply(base); // tilt ∘ base
}

export function addHole(geo: THREE.BufferGeometry, p: HoleParams): THREE.BufferGeometry {
  const size = sizeOf(geo);
  const through = !p.depth || p.depth <= 0;
  const length = through ? Math.max(size.x, size.y, size.z) * 2 + 10 : p.depth!;

  // Build the tool un-rotated (bore along local +Y); all orientation goes into the
  // matrix so the tool's local axes stay stable — that's what lets the 3D gizmo map
  // its rotation/scale back to params cleanly.
  let tool: THREE.BufferGeometry;
  if (p.shape === "box") {
    tool = new THREE.BoxGeometry(p.width ?? 5, length, p.height ?? 5);
  } else {
    const r = (p.diameter ?? 5) / 2;
    tool = new THREE.CylinderGeometry(r, r, length, 48);
  }

  const center = geo.boundingBox!.getCenter(new THREE.Vector3());
  const pos = new THREE.Vector3(
    p.x ?? center.x,
    p.y ?? center.y,
    p.z ?? center.z,
  );
  const q = holeOrientation(p.axis, p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  return centerOnBed(boolean(geo, tool, "subtract", m));
}

// ─── split into parts + connectors ───────────────────────────────────────────

export interface SplitParams {
  axis: Axis;
  /** Number of parts (>= 2); the axis extent is divided evenly. Ignored if `positions` is set. */
  count: number;
  /** Explicit cut coordinates along the axis (model-local mm). Overrides even division. */
  positions?: number[];
  /** Add alignment pins + matching sockets at each seam. Default false = clean cuts only. */
  addPins?: boolean;
  /** Connector pins straddling each cut. */
  pinRadius: number;
  pinLength: number;
  pinCount: number;
  clearance: number;
}

/** The actual material extent (u,v bounds + centroid) at a cut plane. */
interface CrossSection {
  uMin: number; uMax: number; vMin: number; vMax: number;
  uc: number; vc: number;
  count: number; // vertices found in the band
}

/**
 * Measure where the model actually has material at a cut plane by scanning the
 * vertices in a thin band around it. The cut-plane cross-section of an organic
 * model is far smaller and off-center than its bounding box, so this — not the
 * bbox — is what alignment pins must be fitted to.
 */
function crossSectionBounds(
  geo: THREE.BufferGeometry, ai: number, uI: number, vI: number, planePos: number, band: number,
): CrossSection | null {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  let uSum = 0, vSum = 0, count = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getComponent(i, ai) - planePos) > band) continue;
    const u = pos.getComponent(i, uI);
    const v = pos.getComponent(i, vI);
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    uSum += u; vSum += v; count++;
  }
  if (count === 0) return null;
  return { uMin, uMax, vMin, vMax, uc: uSum / count, vc: vSum / count, count };
}

/** Is `point` inside the solid model? Majority vote over a few ray directions
 *  (odd crossings = inside) so a slightly non-watertight neural mesh still reads right. */
const INSIDE_DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0.7071, 0, 0.7071),
];
function insideMesh(mesh: THREE.Mesh, raycaster: THREE.Raycaster, point: THREE.Vector3): boolean {
  let votes = 0;
  for (const dir of INSIDE_DIRS) {
    raycaster.set(point, dir);
    if (raycaster.intersectObject(mesh, false).length % 2 === 1) votes++;
  }
  return votes >= 2;
}

/** A seam's fitted connector plan: pin (u,v) positions plus pin sizes clamped to the seam. */
interface SeamPlan {
  positions: [number, number][];
  radius: number;
  length: number;
}

/**
 * Plan the alignment pins for one seam so they always land in solid material and
 * never overflow a thin cross-section. Builds a candidate grid over the real
 * material bounds, keeps only points solid on BOTH sides of the seam (so the pin
 * actually bridges the two parts), then spreads up to `pinCount` of them apart.
 */
function seamPinPlan(
  geo: THREE.BufferGeometry,
  mesh: THREE.Mesh,
  raycaster: THREE.Raycaster,
  ai: number, uI: number, vI: number,
  planePos: number,
  loSeg: number, hiSeg: number,
  reqRadius: number, reqLength: number, reqCount: number,
  band: number,
): SeamPlan {
  const empty: SeamPlan = { positions: [], radius: reqRadius, length: reqLength };
  const cs = crossSectionBounds(geo, ai, uI, vI, planePos, band);
  if (!cs) return empty;

  const uExt = cs.uMax - cs.uMin;
  const vExt = cs.vMax - cs.vMin;
  const minExt = Math.min(uExt, vExt);

  // Silent auto-fit: shrink pins to the seam. Radius leaves material around the
  // pin; length/socket never pierces the thinner of the two adjacent parts.
  const radius = Math.max(0.5, Math.min(reqRadius, minExt * 0.2));
  const length = Math.max(1, Math.min(reqLength, Math.min(loSeg, hiSeg) * 0.8));
  const margin = radius * 1.2;

  // Probe both sides of the seam, a hair inside each part, so the pin is anchored.
  const off = Math.min(loSeg, hiSeg) * 0.25 + 1e-3;
  const solid = (u: number, v: number): boolean => {
    const lo = new THREE.Vector3(); lo.setComponent(ai, planePos - off); lo.setComponent(uI, u); lo.setComponent(vI, v);
    const hi = new THREE.Vector3(); hi.setComponent(ai, planePos + off); hi.setComponent(uI, u); hi.setComponent(vI, v);
    return insideMesh(mesh, raycaster, lo) && insideMesh(mesh, raycaster, hi);
  };

  // Candidate grid inset by the pin margin so the pin body stays within material.
  const u0 = cs.uMin + margin, u1 = cs.uMax - margin;
  const v0 = cs.vMin + margin, v1 = cs.vMax - margin;
  const candidates: [number, number][] = [];
  const N = 5;
  for (let iu = 0; iu < N; iu++) {
    for (let iv = 0; iv < N; iv++) {
      const u = u1 > u0 ? u0 + ((u1 - u0) * iu) / (N - 1) : cs.uc;
      const v = v1 > v0 ? v0 + ((v1 - v0) * iv) / (N - 1) : cs.vc;
      if (solid(u, v)) candidates.push([u, v]);
    }
  }
  // Centroid is usually the safest single anchor — prefer it when valid.
  if (solid(cs.uc, cs.vc)) candidates.unshift([cs.uc, cs.vc]);

  if (candidates.length === 0) return { positions: [], radius, length };

  // Farthest-point sampling: seed at the centroid-most candidate, then keep
  // adding the candidate farthest from those already chosen for good spread.
  const want = Math.max(1, Math.min(reqCount, candidates.length));
  const chosen: [number, number][] = [candidates[0]];
  while (chosen.length < want) {
    let best: [number, number] | null = null;
    let bestDist = -1;
    for (const c of candidates) {
      let nearest = Infinity;
      for (const ch of chosen) {
        const d = (c[0] - ch[0]) ** 2 + (c[1] - ch[1]) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDist) { bestDist = nearest; best = c; }
    }
    if (!best || bestDist <= 1e-6) break;
    chosen.push(best);
  }
  return { positions: chosen, radius, length };
}

/** True when a geometry has renderable triangles (a CSG slice can come back empty). */
function hasGeometry(geo: THREE.BufferGeometry): boolean {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  return !!pos && pos.count > 0;
}

/**
 * Cut a model into pieces and return each piece as its OWN geometry, left **in
 * place** (in the model's original coordinates) so the pieces still line up. This
 * is the multi-object form used by the viewer's parts mode so each piece can be
 * selected/moved/deleted independently. `splitIntoParts` (below) merges these back
 * into one geometry for callers that still want a single mesh.
 */
export function splitIntoPartGeometries(geo: THREE.BufferGeometry, p: SplitParams): THREE.BufferGeometry[] {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!.clone();
  const ai = AXIS_I[p.axis];
  const min = bb.min.getComponent(ai);
  const max = bb.max.getComponent(ai);
  const size = bb.getSize(new THREE.Vector3());

  // Cut boundaries: either explicit positions (clamped, sorted, de-duped) or an
  // even division into `count` parts.
  const eps = (max - min) * 1e-3;
  let cuts: number[];
  if (p.positions && p.positions.length > 0) {
    cuts = [...new Set(p.positions.map((c) => Math.min(max - eps, Math.max(min + eps, c))))].sort((a, b) => a - b);
  } else {
    const n = Math.max(2, Math.floor(p.count));
    cuts = Array.from({ length: n - 1 }, (_, i) => min + ((i + 1) * (max - min)) / n);
  }
  const boundaries = [min, ...cuts, max];

  // The two axes perpendicular to the cut, for pin placement.
  const perp: Axis[] = (["x", "y", "z"] as Axis[]).filter((a) => a !== p.axis) as Axis[];
  const uI = AXIS_I[perp[0]];
  const vI = AXIS_I[perp[1]];

  const center = bb.getCenter(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z) * 2 + 20;
  const n = boundaries.length - 1; // number of parts

  // Fit the connector pins to the model: one plan per interior seam, each placing
  // pins only where there's real material straddling the cut (no floating pins).
  // Skipped entirely for clean cuts (addPins off) — also avoids the BVH/ray probe.
  const wantPins = p.addPins === true;
  const seamPlans: SeamPlan[] = [];
  if (wantPins) {
    const bvhMesh = new THREE.Mesh(geo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (geo as any).boundsTree = new MeshBVH(geo);
    const raycaster = new THREE.Raycaster();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (raycaster as any).firstHitOnly = false;
    const band = Math.max(1, (max - min) * 0.02);

    for (let i = 0; i < n - 1; i++) {
      const seamPos = boundaries[i + 1];
      const loSeg = boundaries[i + 1] - boundaries[i];
      const hiSeg = boundaries[i + 2] - boundaries[i + 1];
      seamPlans.push(seamPinPlan(
        geo, bvhMesh, raycaster, ai, uI, vI, seamPos, loSeg, hiSeg,
        p.pinRadius, p.pinLength, p.pinCount, band,
      ));
    }
  }

  const partGeos: THREE.BufferGeometry[] = [];

  for (let i = 0; i < n; i++) {
    const lo = boundaries[i];
    const hi = boundaries[i + 1];

    // Slab box covering [lo, hi] along the cut axis, full extent elsewhere.
    const slab = new THREE.BoxGeometry(
      p.axis === "x" ? hi - lo : big,
      p.axis === "y" ? hi - lo : big,
      p.axis === "z" ? hi - lo : big,
    );
    const slabCenter = center.clone();
    slabCenter.setComponent(ai, (lo + hi) / 2);
    const slabM = new THREE.Matrix4().makeTranslation(slabCenter.x, slabCenter.y, slabCenter.z);

    // CSG can throw or return empty on a messy/non-manifold mesh — keep a single bad
    // slice from aborting the whole split (skip it; the other pieces still come through).
    let part: THREE.BufferGeometry;
    try {
      part = boolean(geo, slab, "intersect", slabM);
    } catch (err) {
      console.warn(`[split] slice ${i} failed; skipping`, err);
      continue;
    }

    // Male pins on the TOP cut (shared with part i+1); holes on the BOTTOM cut
    // (shared with part i-1) so each interface mates exactly once. Both sides of
    // a seam use the same fitted plan, so pegs and sockets line up exactly.
    const addPinsAt = (planePos: number, plan: SeamPlan, male: boolean) => {
      for (const [u, v] of plan.positions) {
        const tool = axisCylinder(
          male ? plan.radius : plan.radius + p.clearance,
          plan.length + (male ? 0 : 1),
          p.axis,
        );
        const loc = new THREE.Vector3();
        loc.setComponent(ai, planePos + (male ? plan.length / 2 : 0));
        loc.setComponent(uI, u);
        loc.setComponent(vI, v);
        const m = new THREE.Matrix4().makeTranslation(loc.x, loc.y, loc.z);
        // A failed pin/socket shouldn't lose the whole part — `part` keeps its pre-pin
        // value because the assignment only lands when the boolean succeeds.
        try {
          part = boolean(part, tool, male ? "union" : "subtract", m);
        } catch (err) {
          console.warn(`[split] pin on slice ${i} failed; leaving part un-pinned`, err);
        }
      }
    };
    if (wantPins) {
      if (i < n - 1) addPinsAt(hi, seamPlans[i], true);  // pin sticks up into next part
      if (i > 0) addPinsAt(lo, seamPlans[i - 1], false);  // socket for previous part's pin
    }

    // Keep the piece IN PLACE (original model coordinates) — do NOT centerOnBed each
    // one (that would stack them all at the origin). Skip empty slices a flaky CSG
    // intersect can return so the parts list only shows real pieces.
    part.computeVertexNormals();
    part.computeBoundingBox();
    if (hasGeometry(part)) partGeos.push(part);
  }

  // Every slice came back empty (common on non-watertight neural meshes). Fail loudly
  // so the caller surfaces a toast and leaves the model intact — never enter parts mode
  // with nothing, which would blank the viewer and fling the camera to infinity.
  if (partGeos.length === 0) {
    throw new Error(
      "Couldn't split this model — the cut produced no solid pieces. Try a different cut axis or position.",
    );
  }

  return partGeos;
}

/** Single-mesh form: split then merge the pieces back into one centered geometry. */
export function splitIntoParts(geo: THREE.BufferGeometry, p: SplitParams): THREE.BufferGeometry {
  return mergeParts(splitIntoPartGeometries(geo, p));
}

/** Merge a set of part geometries (each with its own world matrix baked) into one
 *  centered, sliceable geometry. Used to derive `workingGeometry` from live parts.
 *  Empty geometries are skipped so the merge never null-falls-back to a single piece. */
export function mergeParts(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const usable = geos.filter(hasGeometry);
  if (usable.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(usable.map(normalizeAttrs), false) ?? usable[0];
  return centerOnBed(merged);
}

/** Keep only position+normal so geometries from different ops can be merged. */
function normalizeAttrs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", g.getAttribute("position"));
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  out.setAttribute("normal", g.getAttribute("normal"));
  return out;
}
