import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export function exportAsStl(geometry: THREE.BufferGeometry, binary = true): Blob {
  const mesh = new THREE.Mesh(geometry);
  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary });
  if (result instanceof ArrayBuffer) return new Blob([new Uint8Array(result)], { type: "model/stl" });
  return new Blob([result as string], { type: "text/plain" });
}

/**
 * Export the geometry as an STL oriented for the slicer (printer Z-up).
 *
 * The viewer works in three.js **Y-up** space: models stand along +Y with their
 * base seated at y=0. The backend slicer treats **Z as the print height**, so an
 * un-converted export would be sliced through its depth axis and print lying on
 * its side. Rotating +90° about X maps viewer +Y (height) → +Z (height), giving
 * the slicer exactly what the user sees. Any gizmo rotation/scale the caller has
 * already baked into `geometry` is preserved — this conversion composes on top.
 */
export function exportForSlicing(geometry: THREE.BufferGeometry, binary = true): Blob {
  const g = geometry.clone();
  g.rotateX(Math.PI / 2); // Y-up → Z-up (viewer height +Y becomes printer height +Z)
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (bb && Number.isFinite(bb.min.z)) {
    // Re-seat the base on the bed (z=0) and roughly center XY; the backend
    // re-centers XY anyway, this just keeps coordinates sane and non-negative.
    g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  }
  g.computeVertexNormals();
  const blob = exportAsStl(g, binary);
  g.dispose();
  return blob;
}

export function exportAsObj(geometry: THREE.BufferGeometry): Blob {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const scene = new THREE.Scene();
  scene.add(mesh);
  const exporter = new OBJExporter();
  const result = exporter.parse(scene);
  return new Blob([result], { type: "text/plain" });
}

export async function exportAsGltf(geometry: THREE.BufferGeometry): Promise<Blob> {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x888888 }));
  const scene = new THREE.Scene();
  scene.add(mesh);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        if (gltf instanceof ArrayBuffer) {
          resolve(new Blob([gltf], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(gltf)], { type: "model/gltf+json" }));
        }
      },
      reject,
      { binary: true }
    );
  });
}
