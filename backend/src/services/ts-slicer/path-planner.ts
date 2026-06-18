import type { Pt, ExtrusionPath } from "./types";
import { dist } from "./geometry";

/**
 * Greedy nearest-neighbour ordering of a layer's extrusion paths to minimise
 * travel. Open paths may be reversed; closed loops are rotated so the seam
 * starts near the current nozzle position. Feature order is preserved as a
 * primary key (walls → skin/fill → support → adhesion) so quality grouping is
 * kept while travel within a group is shortened.
 */
const ORDER: Record<ExtrusionPath["type"], number> = {
  "skirt": 0,
  "brim": 0,
  "wall-inner": 1,
  "wall-outer": 2,
  "skin": 3,
  "fill": 4,
  "support-interface": 5,
  "support": 5,
};

export function orderPaths(paths: ExtrusionPath[], start: Pt): ExtrusionPath[] {
  const groups = new Map<number, ExtrusionPath[]>();
  for (const p of paths) {
    const k = ORDER[p.type];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  const out: ExtrusionPath[] = [];
  let cursor = start;
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const remaining = groups.get(key)!;
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      let bestRev = false;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        const head = p.pts[0];
        const tail = p.pts[p.pts.length - 1];
        const dHead = dist(cursor, head);
        if (dHead < bestDist) { bestDist = dHead; bestIdx = i; bestRev = false; }
        if (!p.closed) {
          const dTail = dist(cursor, tail);
          if (dTail < bestDist) { bestDist = dTail; bestIdx = i; bestRev = true; }
        }
      }
      const chosen = remaining.splice(bestIdx, 1)[0];
      const oriented = orient(chosen, cursor, bestRev);
      out.push(oriented);
      cursor = oriented.pts[oriented.pts.length - 1];
    }
  }
  return out;
}

function orient(path: ExtrusionPath, cursor: Pt, reverse: boolean): ExtrusionPath {
  if (path.closed) return rotateLoopToNearest(path, cursor);
  if (reverse) return { ...path, pts: [...path.pts].reverse() };
  return path;
}

/** Rotate a closed loop so its start vertex is the one nearest the cursor. */
function rotateLoopToNearest(path: ExtrusionPath, cursor: Pt): ExtrusionPath {
  // pts is [v0..vn, v0] (closed). Work on the unique vertices.
  const verts = path.pts.slice(0, -1);
  if (verts.length < 2) return path;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const d = dist(cursor, verts[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  const rotated = [...verts.slice(best), ...verts.slice(0, best)];
  rotated.push(rotated[0]);
  return { ...path, pts: rotated };
}
