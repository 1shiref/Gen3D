import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";

export default function MeasurementTool() {
  const { measurePoints, measureDistance } = useViewerStore();

  return (
    <>
      {measurePoints.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshBasicMaterial color="#ff4444" />
          <Html center>
            <div className="text-xs bg-black/70 text-white px-1 py-0.5 rounded mt-2">P{i + 1}</div>
          </Html>
        </mesh>
      ))}

      {measureDistance !== null && measurePoints.length === 2 && (
        <Html
          position={[
            (measurePoints[0][0] + measurePoints[1][0]) / 2,
            (measurePoints[0][1] + measurePoints[1][1]) / 2 + 3,
            (measurePoints[0][2] + measurePoints[1][2]) / 2,
          ]}
          center
        >
          <div className="bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded whitespace-nowrap">
            {measureDistance} mm
          </div>
        </Html>
      )}
    </>
  );
}
