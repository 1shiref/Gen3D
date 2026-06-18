import { useMemo } from "react";
import * as THREE from "three";
import { useViewerStore } from "@/stores/viewerStore";
import { useSelectedPrinter } from "@/stores/printerStore";
import { computeTransformedBounds, evaluateFit } from "@/lib/print-volume";

const FITS_COLOR = "#22c55e";   // green — inside the build volume
const EXCEEDS_COLOR = "#ef4444"; // red — spills past the printer

/**
 * Draws the printer's full build volume: the bed plate plus a wireframe box up
 * to the printer's max Z height. The wireframe turns red the moment the model
 * (after its viewer transform) pokes outside the volume — the at-a-glance cue
 * for "will this fit in my printer?".
 */
export default function PrintBedPreview() {
  const modelBounds = useViewerStore((s) => s.modelBounds);
  const modelTransform = useViewerStore((s) => s.modelTransform);
  const profile = useSelectedPrinter();

  const w = profile.bedWidth;
  const d = profile.bedDepth;
  const h = profile.bedHeight;

  const fits = useMemo(() => {
    if (!modelBounds) return true;
    const box = computeTransformedBounds(modelBounds, modelTransform);
    return evaluateFit(box, profile).fits;
  }, [modelBounds, modelTransform, profile]);

  // Wireframe edges of the build-volume box, base sitting on the bed (y = 0).
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    [w, h, d],
  );

  const volumeColor = fits ? FITS_COLOR : EXCEEDS_COLOR;

  return (
    <group>
      {/* Bed plate — 0.5 mm thick, top surface at y = 0 so models rest on it. */}
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <boxGeometry args={[w, 0.5, d]} />
        <meshStandardMaterial
          color={profile.color}
          transparent
          opacity={0.15}
          roughness={0.8}
        />
      </mesh>

      {/* Build-volume envelope — wireframe box up to the printer's max height. */}
      <lineSegments position={[0, h / 2, 0]} geometry={edges}>
        <lineBasicMaterial
          color={volumeColor}
          transparent
          opacity={fits ? 0.35 : 0.7}
        />
      </lineSegments>
    </group>
  );
}
