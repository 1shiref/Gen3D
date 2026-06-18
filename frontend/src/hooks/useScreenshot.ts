import { useCallback } from "react";
import { downloadBlob } from "@/lib/stl-utils";

// Module-level so multiple consumers (screenshot button, convert-to-editable hook)
// can read the SAME canvas — one Canvas exists per app, and ModelViewer registers it.
let sharedCanvas: HTMLCanvasElement | null = null;

export function getViewerCanvas(): HTMLCanvasElement | null {
  return sharedCanvas;
}

/** Take a PNG screenshot of the viewer canvas as a File (ready to POST). */
export async function takeViewerScreenshotAsFile(
  filename = `viewer-${Date.now()}.png`,
): Promise<File | null> {
  if (!sharedCanvas) return null;
  return new Promise((resolve) => {
    sharedCanvas!.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      resolve(new File([blob], filename, { type: "image/png" }));
    }, "image/png");
  });
}

export function useScreenshot() {
  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    sharedCanvas = canvas;
  }, []);

  const takeScreenshot = useCallback((): string | null => {
    if (!sharedCanvas) return null;
    return sharedCanvas.toDataURL("image/png");
  }, []);

  const downloadScreenshot = useCallback(() => {
    const dataUrl = takeScreenshot();
    if (!dataUrl) return;
    const byteString = atob(dataUrl.split(",")[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: "image/png" });
    downloadBlob(blob, `gen3d-${Date.now()}.png`);
  }, [takeScreenshot]);

  return { setCanvas, takeScreenshot, downloadScreenshot };
}
