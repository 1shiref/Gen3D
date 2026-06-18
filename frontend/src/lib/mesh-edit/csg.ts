import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type BoolOp = "union" | "subtract" | "intersect";

const OP_MAP = {
  union: ADDITION,
  subtract: SUBTRACTION,
  intersect: INTERSECTION,
} as const;

// One evaluator reused across calls. We only keep position + normal on the output
// so messy multi-attribute meshes (e.g. neural GLBs) don't break the boolean.
const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];

/**
 * Harden a geometry for CSG: drop everything but position, weld coincident verts
 * (neural meshes are often soup), and recompute normals. three-bvh-csg needs a
 * reasonably clean, indexed, normal-bearing geometry to produce solid results.
 */
export function cleanForCsg(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const stripped = new THREE.BufferGeometry();
  const pos = geo.getAttribute("position");
  if (!pos) return stripped;
  stripped.setAttribute("position", pos.clone());
  if (geo.index) stripped.setIndex(geo.index.clone());
  let merged: THREE.BufferGeometry;
  try {
    merged = mergeVertices(stripped, 1e-4);
  } catch {
    merged = stripped;
  }
  merged.computeVertexNormals();
  return merged;
}

function toBrush(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): Brush {
  const brush = new Brush(cleanForCsg(geo));
  if (matrix) brush.applyMatrix4(matrix);
  brush.updateMatrixWorld(true);
  return brush;
}

/**
 * Boolean of two geometries. `toolMatrix` positions the tool (B) geometry in the
 * same space as the base (A) geometry.
 */
export function boolean(
  base: THREE.BufferGeometry,
  tool: THREE.BufferGeometry,
  op: BoolOp,
  toolMatrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const a = toBrush(base);
  const b = toBrush(tool, toolMatrix);
  const result = evaluator.evaluate(a, b, OP_MAP[op]);
  const out = result.geometry.clone();
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}
