/**
 * Headless smoke test for every mesh-edit tool.
 *
 * Mesh-edit ops are pure JS (three + three-bvh-csg, no WebGL/DOM), so we can run each
 * FEATURE.apply() outside the browser and assert it produces a valid geometry. Catches real
 * CSG/transform failures (and that the new model-fitted defaults stay in range) without the UI.
 *
 *   npx tsx scripts/test-mesh-tools.ts      (from text2print/frontend)
 *
 * Exits non-zero if any feature fails.
 */
import * as THREE from "three";
import { FEATURE_LIST, initialParams, type Dims, type Feature } from "../src/lib/mesh-edit/features";

type Sample = { name: string; geo: () => THREE.BufferGeometry };

// A blocky model (clean, indexed) and a smooth one (stand-in for a neural mesh).
const SAMPLES: Sample[] = [
  { name: "box 40×60×30", geo: () => new THREE.BoxGeometry(40, 60, 30) },
  { name: "sphere r25", geo: () => new THREE.SphereGeometry(25, 32, 24) },
];

function dimsOf(geo: THREE.BufferGeometry): Dims {
  geo.computeBoundingBox();
  const s = geo.boundingBox!.getSize(new THREE.Vector3());
  return { x: s.x, y: s.y, z: s.z };
}

/** Assert a geometry is something the viewer + slicer can actually use. */
function validate(geo: THREE.BufferGeometry): string | null {
  const pos = geo.getAttribute("position");
  if (!pos) return "no position attribute";
  if (pos.count < 3) return `too few vertices (${pos.count})`;
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return `non-finite vertex at index ${i}`;
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  for (const v of [bb.min, bb.max]) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return "non-finite bounding box";
  }
  const size = bb.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return `degenerate size ${size.x}×${size.y}×${size.z}`;
  return null;
}

function runOne(feature: Feature, sample: Sample, dims: Dims | null): { ok: boolean; detail: string } {
  const geo = sample.geo();
  try {
    geo.computeBoundingBox();
    const params = initialParams(feature, dims);
    const out = feature.apply(geo, params);
    const err = validate(out);
    if (err) return { ok: false, detail: err };
    const c = (out.getAttribute("position") as THREE.BufferAttribute).count;
    return { ok: true, detail: `${c} verts` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

let failures = 0;
console.log("Mesh-edit tool smoke test\n=========================");
for (const sample of SAMPLES) {
  const dims = dimsOf(sample.geo());
  console.log(`\n● ${sample.name}  (fitted to ${dims.x}×${dims.y}×${dims.z} mm)`);
  for (const feature of FEATURE_LIST) {
    // Test with model-fitted defaults; for fit-aware tools also test the static (no-model) path.
    const r = runOne(feature, sample, dims);
    if (!r.ok) failures++;
    console.log(`   ${r.ok ? "PASS" : "FAIL"}  ${feature.id.padEnd(14)} ${r.detail}`);
    if (feature.fit) {
      const rs = runOne(feature, sample, null);
      if (!rs.ok) failures++;
      console.log(`   ${rs.ok ? "PASS" : "FAIL"}  ${(feature.id + " (static)").padEnd(14)} ${rs.detail}`);
    }
  }
}

console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
