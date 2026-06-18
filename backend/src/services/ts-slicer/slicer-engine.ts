import type { Triangle, Vec3 } from "./stl-parser";

export interface Segment { a: Vec3; b: Vec3 }
export type Layer = Segment[];

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function intersectTriPlane(tri: Triangle, z: number): Segment | null {
  const verts = [tri.v0, tri.v1, tri.v2];
  const above = verts.filter((v) => v.z > z + 1e-9);
  const below = verts.filter((v) => v.z < z - 1e-9);
  const on = verts.filter((v) => Math.abs(v.z - z) <= 1e-9);

  if (above.length === 0 || below.length === 0) return null;

  const pts: Vec3[] = [];

  const addEdge = (a: Vec3, b: Vec3) => {
    if ((a.z > z && b.z < z) || (a.z < z && b.z > z)) {
      const t = (z - a.z) / (b.z - a.z);
      pts.push(lerp(a, b, t));
    }
  };

  for (const v of on) pts.push(v);
  if (pts.length < 2) {
    addEdge(verts[0], verts[1]);
    addEdge(verts[1], verts[2]);
    addEdge(verts[2], verts[0]);
  }

  if (pts.length < 2) return null;
  return { a: pts[0], b: pts[1] };
}

/** Intersect every triangle with the plane at `z`, returning the cut segments. */
export function sliceAtZ(triangles: Triangle[], z: number): Segment[] {
  const segs: Segment[] = [];
  for (const tri of triangles) {
    const seg = intersectTriPlane(tri, z);
    if (seg) segs.push(seg);
  }
  return segs;
}

export function sliceTriangles(
  triangles: Triangle[],
  minZ: number,
  maxZ: number,
  layerHeight: number
): Layer[] {
  const numLayers = Math.ceil((maxZ - minZ) / layerHeight);
  const layers: Layer[] = [];
  for (let i = 0; i < numLayers; i++) {
    layers.push(sliceAtZ(triangles, minZ + (i + 0.5) * layerHeight));
  }
  return layers;
}
