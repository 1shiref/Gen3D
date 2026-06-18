import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { buildFileUrl } from "@/lib/api";

function detectFormat(url: string): "stl" | "obj" | "gltf" {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".obj")) return "obj";
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "gltf";
  return "stl";
}

/** Normalize any loaded object to fit a ~1.6-unit cube centered at the origin. */
function normalize(obj: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 1.6 / maxDim;
  const wrapper = new THREE.Group();
  obj.position.sub(center);
  wrapper.add(obj);
  wrapper.scale.setScalar(s);
  return wrapper;
}

function ThumbObject({ url }: { url: string }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    const full = buildFileUrl(url);
    const fmt = detectFormat(url);
    const done = (o: THREE.Object3D) => { if (!cancelled) setObj(normalize(o)); };

    if (fmt === "stl") {
      new STLLoader().load(full, (g) => {
        g.computeVertexNormals();
        done(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#b0b8c8", roughness: 0.6 })));
      });
    } else if (fmt === "obj") {
      new OBJLoader().load(full, (group) => done(group));
    } else {
      new GLTFLoader().load(full, (gltf) => done(gltf.scene));
    }
    return () => { cancelled = true; };
  }, [url]);

  if (!obj) return null;
  return <primitive object={obj} />;
}

export default function CandidateThumb({ url }: { url: string }) {
  return (
    <Canvas camera={{ position: [1.8, 1.3, 1.8], fov: 45 }} dpr={1} gl={{ antialias: true }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 2]} intensity={1.1} />
      <ThumbObject url={url} />
    </Canvas>
  );
}
