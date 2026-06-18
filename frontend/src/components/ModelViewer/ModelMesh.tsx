import { useEffect, useMemo, useRef, useState } from "react";
import { TransformControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";
import { useMeshEditStore, partColor, type MeshPart } from "@/stores/meshEditStore";
import { useGenerationStore } from "@/stores/generationStore";
import { getSelectedPrinter } from "@/stores/printerStore";
import { normalizeModelSize } from "@/lib/normalize-size";
import { useToast } from "@/hooks/useToast";

interface Props {
  stlUrl: string;
  onLoaded?: () => void;
}

type Format = "stl" | "obj" | "gltf";

function detectFormat(url: string): Format {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".obj")) return "obj";
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "gltf";
  return "stl";
}

/**
 * Merge all meshes in a Group/Scene into a single BufferGeometry so the rest of
 * the viewer (bounding box, materials, transforms) can treat every model uniformly.
 */
function flattenToGeometry(root: THREE.Object3D): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      const g = (m.geometry as THREE.BufferGeometry).clone();
      g.applyMatrix4(m.matrixWorld);
      // Keep only the position attribute (+ optional normal) — color/uv/skin attrs
      // vary across meshes and would break BufferGeometryUtils.mergeGeometries.
      const stripped = new THREE.BufferGeometry();
      stripped.setAttribute("position", g.getAttribute("position"));
      if (g.index) stripped.setIndex(g.index);
      geos.push(stripped);
    }
  });
  if (geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0];
  // Simple manual merge: concat position arrays, no shared index.
  let total = 0;
  for (const g of geos) {
    const idx = g.getIndex();
    total += idx ? idx.count : (g.getAttribute("position") as THREE.BufferAttribute).count;
  }
  const positions = new Float32Array(total * 3);
  let cursor = 0;
  for (const g of geos) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        const v = idx.getX(i);
        positions[cursor++] = pos.getX(v);
        positions[cursor++] = pos.getY(v);
        positions[cursor++] = pos.getZ(v);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        positions[cursor++] = pos.getX(i);
        positions[cursor++] = pos.getY(i);
        positions[cursor++] = pos.getZ(i);
      }
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return merged;
}

export default function ModelMesh({ stlUrl, onLoaded }: Props) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addMeasurePoint, isMeasuring, modelTransform, setModelBounds, resetTransform, setTransform } = useViewerStore();
  const gizmoMode = useViewerStore((s) => s.gizmoMode);
  const draft = useMeshEditStore((s) => s.draft);
  const setBaseGeometry = useMeshEditStore((s) => s.setBaseGeometry);
  const workingGeometry = useMeshEditStore((s) => s.workingGeometry);
  const parts = useMeshEditStore((s) => s.parts);
  const selectedPartId = useMeshEditStore((s) => s.selectedPartId);
  const meshRef = useRef<THREE.Mesh>(null);
  const [groupObj, setGroupObj] = useState<THREE.Group | null>(null);
  const { toast } = useToast();

  // Format-aware loader. We avoid useLoader because OBJ/GLTF resolve to objects,
  // not BufferGeometry directly, and we want one uniform pipeline downstream.
  useEffect(() => {
    let cancelled = false;
    const fmt = detectFormat(stlUrl);
    setError(null);
    setGeometry(null);
    // A new model arrives at its true size — drop any transform left over from
    // the previous model so the displayed size and fit are correct on load.
    resetTransform();

    const onError = (err: unknown) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the failure: console for devs, toast for users. Silent return-null
      // makes upload failures look like the model just "didn't appear."
      console.error(`[ModelMesh] failed to load ${fmt.toUpperCase()} at ${stlUrl}:`, err);
      toast({
        title: "Couldn't load 3D model",
        description: `${fmt.toUpperCase()} load failed: ${msg}`,
        variant: "destructive",
      });
      setError(msg);
      onLoaded?.();
    };

    if (fmt === "stl") {
      new STLLoader().load(
        stlUrl,
        (g) => { if (!cancelled) setGeometry(g); },
        undefined,
        onError,
      );
    } else if (fmt === "obj") {
      new OBJLoader().load(
        stlUrl,
        (group) => { if (!cancelled) setGeometry(flattenToGeometry(group)); },
        undefined,
        onError,
      );
    } else {
      new GLTFLoader().load(
        stlUrl,
        (gltf) => { if (!cancelled) setGeometry(flattenToGeometry(gltf.scene)); },
        undefined,
        onError,
      );
    }

    return () => { cancelled = true; };
  }, [stlUrl, onLoaded, toast, resetTransform]);

  useEffect(() => {
    if (!geometry) return;
    const positionAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!positionAttr || positionAttr.count === 0) {
      console.error(`[ModelMesh] ${stlUrl} loaded but contained no vertices`);
      toast({
        title: "Empty 3D model",
        description: "The file loaded but had no geometry to display.",
        variant: "destructive",
      });
      setError("empty geometry");
      onLoaded?.();
      return;
    }
    // Neural engines emit ~unit-cube geometry that the viewer/slicer read as ~1-2 mm.
    // Rescale to a printable size before centering (generated models always; uploads only
    // when implausibly tiny). Baked into geometry so export/slice match the preview.
    const modelSource = useGenerationStore.getState().modelSource;
    normalizeModelSize(geometry, getSelectedPrinter(), modelSource !== "uploaded");

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    // Centre on X and Z, then lift along Y so the model's bottom sits at y=0.
    // Print bed is positioned so its top is at y=0 — the model rests on it.
    geometry.translate(
      -(bb.min.x + bb.max.x) / 2,
      -bb.min.y,
      -(bb.min.z + bb.max.z) / 2,
    );
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    onLoaded?.();

    // Hand the freshly-centered geometry to the mesh-edit store as the new base
    // (this also clears any edits/undo from the previous model).
    setBaseGeometry(geometry);

    // Publish the centered model's raw extents so the overlay, bounding-box
    // helper, print-volume check, and CameraRig all share one source of truth
    // (and no one re-loads the mesh). CameraRig handles framing from here.
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    setModelBounds({ x: size.x, y: size.y, z: size.z });
  }, [geometry, onLoaded, setModelBounds, setBaseGeometry]);

  // When a local mesh edit produces a new geometry, refresh the shared bounds
  // (overlay / locator / build-volume check / CameraRig all follow from these).
  useEffect(() => {
    if (!workingGeometry) return;
    workingGeometry.computeBoundingBox();
    const size = workingGeometry.boundingBox!.getSize(new THREE.Vector3());
    setModelBounds({ x: size.x, y: size.y, z: size.z });
  }, [workingGeometry, setModelBounds]);

  const material = useMemo(() => {
    return <meshStandardMaterial color="#b0b8c8" roughness={0.5} metalness={0.1} />;
  }, []);

  const handleClick = (e: THREE.Event) => {
    if (!isMeasuring) return;
    // @ts-ignore — three-fiber injects intersection point
    const point = e.point;
    if (point) addMeasurePoint([point.x, point.y, point.z]);
  };

  if (error) {
    // Loading failed — render nothing; ViewerOverlay can be extended to display this later
    return null;
  }

  // Parts mode (after Split): each piece is its own selectable/movable object.
  if (parts && parts.length > 0) {
    return (
      <>
        {parts.map((part, i) => (
          <PartMesh
            key={part.id}
            part={part}
            index={i}
            selected={part.id === selectedPartId}
            gizmoMode={gizmoMode}
            isMeasuring={isMeasuring}
            onMeasureClick={handleClick}
          />
        ))}
      </>
    );
  }

  // Locally mesh-edited geometry takes precedence over the URL-loaded one.
  const displayGeometry = workingGeometry ?? geometry;
  if (!displayGeometry) return null;

  const [sx, sy, sz] = modelTransform.scale;
  const [rx, ry, rz] = modelTransform.rotation;
  const [px, py, pz] = modelTransform.position;

  // Mirror the gizmo-driven object transform back into the store so the numeric
  // Transform panel + size HUD stay in sync, and Apply/slice can bake it.
  const syncFromGizmo = () => {
    if (!groupObj) return;
    setTransform({
      position: [groupObj.position.x, groupObj.position.y, groupObj.position.z],
      rotation: [
        (groupObj.rotation.x * 180) / Math.PI,
        (groupObj.rotation.y * 180) / Math.PI,
        (groupObj.rotation.z * 180) / Math.PI,
      ],
      scale: [groupObj.scale.x, groupObj.scale.y, groupObj.scale.z],
    });
  };

  // Gizmo and CSG drafts / measure are mutually exclusive.
  const showGizmo = gizmoMode !== "off" && !isMeasuring && !draft;

  return (
    <>
      <group
        ref={setGroupObj}
        scale={[sx, sy, sz]}
        rotation={[(rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180]}
        position={[px, py, pz]}
      >
        <mesh ref={meshRef} geometry={displayGeometry} castShadow receiveShadow onClick={handleClick}>
          {material}
        </mesh>
      </group>

      {showGizmo && groupObj && (
        <TransformControls object={groupObj} mode={gizmoMode} onObjectChange={syncFromGizmo} />
      )}
    </>
  );
}

interface PartMeshProps {
  part: MeshPart;
  index: number;
  selected: boolean;
  gizmoMode: "off" | "translate" | "rotate" | "scale";
  isMeasuring: boolean;
  onMeasureClick: (e: THREE.Event) => void;
}

/**
 * One split piece, rendered as its own object with its own transform. Clicking it
 * selects it (highlight + gizmo). The gizmo (when this part is selected) drives the
 * part's transform live; the merged sliceable geometry is rebuilt on drag end.
 */
function PartMesh({ part, index, selected, gizmoMode, isMeasuring, onMeasureClick }: PartMeshProps) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const selectPart = useMeshEditStore((s) => s.selectPart);
  const setPartTransform = useMeshEditStore((s) => s.setPartTransform);
  const commitParts = useMeshEditStore((s) => s.commitParts);

  const [sx, sy, sz] = part.transform.scale;
  const [rx, ry, rz] = part.transform.rotation;
  const [px, py, pz] = part.transform.position;

  const syncFromGizmo = () => {
    if (!group) return;
    setPartTransform(part.id, {
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [
        (group.rotation.x * 180) / Math.PI,
        (group.rotation.y * 180) / Math.PI,
        (group.rotation.z * 180) / Math.PI,
      ],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    });
  };

  const showGizmo = selected && gizmoMode !== "off" && !isMeasuring;

  return (
    <>
      <group
        ref={setGroup}
        scale={[sx, sy, sz]}
        rotation={[(rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180]}
        position={[px, py, pz]}
      >
        <mesh
          geometry={part.geometry}
          castShadow
          receiveShadow
          onClick={onMeasureClick}
          onPointerDown={(e) => {
            if (isMeasuring) return;
            e.stopPropagation(); // pick only the front-most part
            selectPart(part.id);
          }}
        >
          <meshStandardMaterial
            color={partColor(index)}
            roughness={0.5}
            metalness={0.1}
            emissive={selected ? partColor(index) : "#000000"}
            emissiveIntensity={selected ? 0.45 : 0}
          />
        </mesh>
      </group>

      {showGizmo && group && (
        <TransformControls
          object={group}
          mode={gizmoMode}
          onObjectChange={syncFromGizmo}
          onMouseUp={() => { void commitParts(); }}
        />
      )}
    </>
  );
}
