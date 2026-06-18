import { Router } from "express";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { buildProjectZip, type ProjectState } from "../services/project.service";
import { stlToObj } from "../services/mesh.service";
import { tempPath } from "../utils/file-helpers";
import { logger } from "../utils/logger";

const router = Router();

// Serve uploaded files (STL, gcode, etc.)
//
// Viewer-friendly model types are served inline so Three.js loaders can fetch
// them without the browser treating the response as a download. ZIPs and
// G-code still default to attachment.
const VIEWER_INLINE_EXTS = new Set([".stl", ".obj", ".glb", ".gltf"]);

router.get("/files/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(config.uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".stl": "model/stl",
    ".gcode": "text/plain",
    ".obj": "model/obj",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".zip": "application/zip",
  };

  res.setHeader("Content-Type", contentTypes[ext] ?? "application/octet-stream");
  const disposition = VIEWER_INLINE_EXTS.has(ext) ? "inline" : "attachment";
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  const stream = fs.createReadStream(filePath);
  stream.on("error", (err) => {
    logger.error("File stream error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to read file" });
    else res.end();
  });
  stream.pipe(res);
});

// Export OBJ from STL
router.get("/export/obj/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const stlPath = path.join(config.uploadsDir, filename);

  if (!fs.existsSync(stlPath)) {
    res.status(404).json({ error: "STL not found" });
    return;
  }

  try {
    const objContent = stlToObj(stlPath);
    const objName = filename.replace(/\.stl$/i, ".obj");
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="${objName}"`);
    res.send(objContent);
  } catch (err) {
    logger.error("OBJ export error:", err);
    res.status(500).json({ error: "OBJ conversion failed" });
  }
});

// Export project ZIP
router.post("/export/zip", async (req, res) => {
  try {
    const project = req.body as ProjectState;
    if (
      !project ||
      typeof project !== "object" ||
      typeof project.id !== "string" ||
      !Array.isArray(project.versions)
    ) {
      res.status(400).json({
        error: "Invalid project payload: requires { id: string, versions: array, ... }",
      });
      return;
    }
    const zipPath = tempPath(".zip");
    await buildProjectZip(project, zipPath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="gen3d-project.zip"`);

    const stream = fs.createReadStream(zipPath);
    stream.on("error", (err) => {
      logger.error("ZIP stream error:", err);
      try { fs.unlinkSync(zipPath); } catch {}
      if (!res.headersSent) res.status(500).json({ error: "Failed to serve ZIP" });
      else res.end();
    });
    stream.on("end", () => {
      try { fs.unlinkSync(zipPath); } catch {}
    });
    stream.pipe(res);
  } catch (err) {
    logger.error("ZIP export error:", err);
    res.status(500).json({ error: "ZIP export failed" });
  }
});

export default router;
