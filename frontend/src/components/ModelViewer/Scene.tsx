import { useEffect } from "react";
import { Grid, OrbitControls } from "@react-three/drei";
import { useViewerStore } from "@/stores/viewerStore";
import ModelMesh from "./ModelMesh";
import PrintBedPreview from "./PrintBedPreview";
import BoundingBoxHelper from "./BoundingBoxHelper";
import MeasurementTool from "./MeasurementTool";
import CameraRig from "./CameraRig";
import ModelLocator from "./ModelLocator";
import DraftHandles from "./DraftHandles";
import { useMeshEditStore } from "@/stores/meshEditStore";

interface Props {
  stlUrl?: string | null;
  onLoaded?: () => void;
}

export default function Scene({ stlUrl, onLoaded }: Props) {
  const { showGrid, showPrintBed, showBoundingBox, isMeasuring, setModelBounds } = useViewerStore();
  const draft = useMeshEditStore((s) => s.draft);

  // Without a model, ModelMesh never mounts and would never call onLoaded —
  // signal the parent so the PreviewFallback can hide, and clear the shared
  // bounds so the overlay / bounding box / volume check reset.
  useEffect(() => {
    if (!stlUrl) {
      onLoaded?.();
      setModelBounds(null);
    }
  }, [stlUrl, onLoaded, setModelBounds]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[50, 100, 50]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-50, 50, -50]} intensity={0.3} />

      {/* Frames the model on load and on Fit; also sets controls.target. */}
      <CameraRig />

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={0.05}
        maxDistance={5000}
        makeDefault
      />

      {showGrid && (
        <Grid
          args={[500, 500]}
          cellSize={5}
          cellThickness={0.5}
          cellColor="#444"
          sectionSize={50}
          sectionThickness={1}
          sectionColor="#666"
          fadeDistance={300}
          position={[0, -0.05, 0]}
        />
      )}

      {stlUrl && <ModelMesh stlUrl={stlUrl} onLoaded={onLoaded} />}

      {showBoundingBox && stlUrl && <BoundingBoxHelper />}
      {showPrintBed && <PrintBedPreview />}
      {isMeasuring && <MeasurementTool />}
      {stlUrl && <ModelLocator />}
      {stlUrl && draft && <DraftHandles />}
    </>
  );
}
