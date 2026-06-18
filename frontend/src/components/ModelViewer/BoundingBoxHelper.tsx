import { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";

const BOX_COLOR = "#00ff88";

/**
 * Wireframe bounding box drawn straight from the shared `modelBounds` (no second
 * geometry load) and wrapped in a group carrying the live `modelTransform`, so
 * it tracks the model as the user scales/rotates/moves it. Labels report the
 * transformed extents in mm — X = width, Y = height, Z = depth.
 */
export default function BoundingBoxHelper() {
  const bounds = useViewerStore((s) => s.modelBounds);
  const transform = useViewerStore((s) => s.modelTransform);

  const edges = useMemo(() => {
    if (!bounds) return null;
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(bounds.x, bounds.y, bounds.z));
  }, [bounds]);

  if (!bounds || !edges) return null;

  const [sx, sy, sz] = transform.scale;
  const [rx, ry, rz] = transform.rotation;
  const [px, py, pz] = transform.position;

  // Local box is centered on X/Z with its base at y=0 → center is at y = bounds.y/2.
  const cy = bounds.y / 2;

  const label = (n: number) => `${n.toFixed(1)}mm`;

  return (
    <group
      position={[px, py, pz]}
      rotation={[(rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180]}
      scale={[sx, sy, sz]}
    >
      <lineSegments position={[0, cy, 0]} geometry={edges}>
        <lineBasicMaterial color={BOX_COLOR} />
      </lineSegments>

      {/* X = width */}
      <Html position={[bounds.x / 2 + 2, cy, 0]}>
        <div className="text-xs bg-black/70 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
          X: {label(bounds.x * sx)}
        </div>
      </Html>
      {/* Y = height (vertical) */}
      <Html position={[0, bounds.y + 2, 0]}>
        <div className="text-xs bg-black/70 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
          Y: {label(bounds.y * sy)}
        </div>
      </Html>
      {/* Z = depth */}
      <Html position={[0, cy, bounds.z / 2 + 2]}>
        <div className="text-xs bg-black/70 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
          Z: {label(bounds.z * sz)}
        </div>
      </Html>
    </group>
  );
}
