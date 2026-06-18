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
