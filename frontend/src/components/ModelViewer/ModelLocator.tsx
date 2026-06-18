import { useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";
import { computeTransformedBounds } from "@/lib/print-volume";

// Hysteresis (in on-screen pixels of the model's radius) so the marker doesn't
// flicker on/off right at the threshold.
const SHOW_BELOW_PX = 14;
const HIDE_ABOVE_PX = 24;

/**
 * On-screen locator for the model. When the part is so small on screen that it's
 * easy to lose (e.g. a 20 mm cube framed against a 300 mm bed), a bright marker
 * is drawn at its location. Clicking it snaps the camera back to the model.
 */
export default function ModelLocator() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const modelBounds = useViewerStore((s) => s.modelBounds);
  const modelTransform = useViewerStore((s) => s.modelTransform);
  const requestFit = useViewerStore((s) => s.requestFit);

  const [visible, setVisible] = useState(false);
  const visRef = useRef(false);

  // Model center + radius in world space (tracks scale/rotation/position).
  const { center, radius } = useMemo(() => {
    if (!modelBounds) return { center: new THREE.Vector3(), radius: 0 };
    const sphere = computeTransformedBounds(modelBounds, modelTransform).getBoundingSphere(
      new THREE.Sphere(),
    );
    return { center: sphere.center, radius: Math.max(sphere.radius, 1e-4) };
  }, [modelBounds, modelTransform]);

  useFrame(() => {
    if (!modelBounds) return;
    const distance = Math.max(camera.position.distanceTo(center), 1e-4);
    const vFov = (camera.fov * Math.PI) / 180;
    // Projected radius of the model's bounding sphere, in pixels.
    const pxRadius = (radius * (size.height / 2)) / (distance * Math.tan(vFov / 2));

    const next = visRef.current
      ? pxRadius < HIDE_ABOVE_PX // currently shown — keep until comfortably large
      : pxRadius < SHOW_BELOW_PX; // currently hidden — show once it gets small
    if (next !== visRef.current) {
      visRef.current = next;
      setVisible(next);
    }
  });

  if (!modelBounds || !visible) return null;

  return (
    <Html position={[center.x, center.y, center.z]} center zIndexRange={[40, 0]}>
      <button
        onClick={() => requestFit("model")}
        title="Model is here — click to zoom to it"
        className="flex items-center gap-1 -translate-y-1/2 whitespace-nowrap rounded-full border border-amber-300/70 bg-amber-400/90 px-2 py-0.5 text-[10px] font-semibold text-black shadow-[0_0_8px_rgba(251,191,36,0.7)] hover:bg-amber-300"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-black/80" />
        Model
      </button>
    </Html>
  );
}
