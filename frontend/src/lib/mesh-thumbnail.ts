import * as THREE from "three";

/**
 * Renders a BufferGeometry to a small PNG data URL for the version-history list.
 *
 * Uses ONE shared offscreen WebGL renderer for every thumbnail so we never exceed
 * the browser's WebGL context limit (mounting a live <Canvas> per version row would).
 * The geometry is borrowed (not mutated, not disposed) — only a temporary material
 * and wrapper group are created and torn down per call.
 */

const SIZE = 128;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function ensure(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  if (!renderer || !scene || !camera) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(3, 4, 2);
    scene.add(dir);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(1.8, 1.3, 1.8);
    camera.lookAt(0, 0, 0);
  }
  return { renderer, scene, camera };
}

export function renderGeometryThumbnail(geometry: THREE.BufferGeometry): string | null {
  try {
    const { renderer, scene, camera } = ensure();

    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: "#b0b8c8", roughness: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);

    // Normalize into a ~1.6-unit cube centered at the origin (matches CandidateThumb).
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    mesh.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    wrapper.scale.setScalar(1.6 / maxDim);

    scene.add(wrapper);
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");

    scene.remove(wrapper);
    material.dispose();
    return dataUrl;
  } catch (err) {
    console.error("[thumbnail] render failed:", err);
    return null;
  }
}
