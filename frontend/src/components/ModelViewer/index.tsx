import { Suspense, useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Sparkles } from "lucide-react";
import { useGenerationStore } from "@/stores/generationStore";
import { useProcessStore } from "@/stores/processStore";
import { useScreenshot } from "@/hooks/useScreenshot";
import ProcessLog from "@/components/ProcessLog";
import Scene from "./Scene";
import ViewerControls from "./ViewerControls";
import ViewerOverlay from "./ViewerOverlay";
import TransformsPanel from "./TransformsPanel";
import CandidateGallery from "./CandidateGallery";
import ImageReview from "./ImageReview";
import ReferenceThumbnail from "./ReferenceThumbnail";
import { useImageStageStore } from "@/stores/imageStageStore";

function PreviewFallback({ previewUrl }: { previewUrl: string | null }) {
  if (!previewUrl) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
      <img
        src={previewUrl}
        alt="Model preview"
        className="max-w-full max-h-full object-contain opacity-80"
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/50 bg-black/60 px-2 py-1 rounded">
        Loading 3D viewer…
      </div>
    </div>
  );
}

function EmptyStateHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center text-white/70 bg-black/50 backdrop-blur-sm rounded-lg px-5 py-4 max-w-xs">
        <Sparkles className="w-6 h-6 text-blue-400/80" />
        <div className="text-sm font-medium text-white/90">No model yet</div>
        <div className="text-xs text-white/55 leading-snug">
          Generate from a prompt or drop a 3D file to begin.
        </div>
      </div>
    </div>
  );
}

export default function ModelViewer() {
  const stlUrl = useGenerationStore((s) => s.stlUrl);
  const previewUrl = useGenerationStore((s) => s.previewUrl);
  const status = useGenerationStore((s) => s.status);
  const { setCanvas, downloadScreenshot } = useScreenshot();
  const [sceneLoaded, setSceneLoaded] = useState(false);

  // Reset sceneLoaded when a new model URL arrives so PreviewFallback can show
  // again while the next geometry streams in.
  useEffect(() => {
    if (stlUrl) setSceneLoaded(false);
  }, [stlUrl]);

  const handleSceneLoaded = useCallback(() => setSceneLoaded(true), []);

  const processRunning = useProcessStore((s) => s.running);
  const imageStage = useImageStageStore((s) => s.stage);
  const isGenerating = status === "uploading" || status === "streaming" || status === "compiling";
  const showEmptyState = !stlUrl && !isGenerating && !previewUrl && !processRunning && imageStage === "idle";

  return (
    <div className="relative w-full h-full bg-zinc-900">
      {/* PNG preview shown until the 3D scene finishes loading */}
      {!sceneLoaded && <PreviewFallback previewUrl={previewUrl} />}

      <Canvas
        camera={{ position: [30, 30, 30], fov: 50, near: 0.1, far: 10000 }}
        shadows
        onCreated={({ gl }) => setCanvas(gl.domElement)}
        gl={{ preserveDrawingBuffer: true }}
      >
        <Suspense fallback={null}>
          <Scene stlUrl={stlUrl} onLoaded={handleSceneLoaded} />
        </Suspense>
      </Canvas>

      {showEmptyState && <EmptyStateHint />}

      {/* Live step-by-step log of the running operation, centered over the viewer.
          Hidden during the photo-review stage — ImageReview shows its own progress. */}
      {processRunning && imageStage === "idle" && <ProcessLog variant="overlay" showWhenIdle={false} />}

      <ViewerControls onScreenshot={downloadScreenshot} />
      <ViewerOverlay />
      {stlUrl && <TransformsPanel />}
      <CandidateGallery />
      <ReferenceThumbnail />
      <ImageReview />
    </div>
  );
}
