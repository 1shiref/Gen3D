import fs from "fs";
import path from "path";
import archiver from "archiver";
import { config } from "../config";

export interface ProjectState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  inputs: {
    imageRefs: string[];
    prompt: string;
  };
  versions: ModelVersion[];
  currentVersionIndex: number;
  slicerSettings: Record<string, unknown>;
  printerPreset: string;
  thumbnailDataUrl?: string;
}

export interface ModelVersion {
  id: string;
  timestamp: string;
  stlUrl: string;
  message: string;
  source: "generated" | "edited" | "uploaded";
}

export async function buildProjectZip(
  project: ProjectState,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    let settled = false;
    const cleanup = () => {
      try { archive.abort(); } catch {}
      try { output.destroy(); } catch {}
    };
    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const safeResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    output.on("close", safeResolve);
    output.on("error", safeReject);
    archive.on("error", safeReject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") safeReject(err);
    });
    archive.pipe(output);

    try {
      // project.t2p JSON
      archive.append(JSON.stringify(project, null, 2), { name: "project.t2p" });

      // STL files
      for (let i = 0; i < project.versions.length; i++) {
        const v = project.versions[i];
        const stlFilename = path.basename(v.stlUrl);
        const stlPath = path.join(config.uploadsDir, stlFilename);
        if (fs.existsSync(stlPath)) {
          archive.file(stlPath, { name: `models/model-v${i + 1}.stl` });
        }
      }

      archive.finalize();
    } catch (err) {
      safeReject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
