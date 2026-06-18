import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";
import { useSelectedPrinter } from "@/stores/printerStore";
import { computeTransformedBounds } from "@/lib/print-volume";

/** Build volume as a world-space box, base on the bed (y = 0), centered on X/Z. */
function printerBox(p: { bedWidth: number; bedDepth: number; bedHeight: number }): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(-p.bedWidth / 2, 0, -p.bedDepth / 2),
    new THREE.Vector3(p.bedWidth / 2, p.bedHeight, p.bedDepth / 2),
  );
}

/**
 * True fit-to-view. Frames either the *model* (default, on load) or the whole
 * *printer* build volume on demand, so the user can inspect the boundary without
 * blindly zooming. Zoom limits span both scales so a tiny model and a big bed are
 * both reachable.
 *
 * Runs inside the Canvas so it can drive the camera and OrbitControls directly.
 * Refits when a new model loads (modelBounds changes) and whenever a Fit button
 * bumps `fitNonce`.
 */
export default function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void; minDistance: number; maxDistance: number })
    | null;
  const size = useThree((s) => s.size);

  const modelBounds = useViewerStore((s) => s.modelBounds);
  const modelTransform = useViewerStore((s) => s.modelTransform);
  const fitNonce = useViewerStore((s) => s.fitNonce);
  const fitTarget = useViewerStore((s) => s.fitTarget);
  const printer = useSelectedPrinter();

  useEffect(() => {
    if (!modelBounds) return;

    // Radii of both scales — used for framing (the chosen target) and for the
    // zoom limits (so the user can move freely between model and full printer).
    const modelBox = computeTransformedBounds(modelBounds, modelTransform);
    const modelRadius = Math.max(modelBox.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    const bedBox = printerBox(printer);
    const printerRadius = Math.max(bedBox.getBoundingSphere(new THREE.Sphere()).radius, 0.001);

    const box = fitTarget === "printer" ? bedBox : modelBox;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.001);
    const center = sphere.center;

    // Keep the current viewing direction; fall back to an isometric angle when
    // the camera and target coincide (first frame).
    const target =
      controls?.target ?? new THREE.Vector3(0, modelBounds.y / 2, 0);
    let dir = new THREE.Vector3().subVectors(camera.position, target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.8, 1);
    dir.normalize();

    // Distance that fits the bounding sphere, using the *narrower* of the
    // vertical/horizontal FOV so the model fits in portrait viewports too.
    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = size.width / Math.max(size.height, 1);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const fitFov = Math.min(vFov, hFov);
    const distance = (radius / Math.sin(fitFov / 2)) * 1.3; // 1.3 = breathing room

    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(modelRadius / 100, 0.01);
    // Far must clear the whole printer even when framing a tiny model.
    camera.far = Math.max((distance + radius) * 4, printerRadius * 20);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      // Span both scales: zoom right up to a tiny mesh, and out past the full printer.
      controls.minDistance = Math.max(0.1, modelRadius * 0.04);
      controls.maxDistance = printerRadius * 12;
      controls.update();
    }
    // modelTransform is intentionally excluded: refitting on every scale tweak
    // would fight the user. New models (modelBounds) and the Fit buttons refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelBounds, fitNonce, fitTarget, camera, controls, size.width, size.height]);

  return null;
}
