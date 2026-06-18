import { Router } from "express";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { sliceToGcode, FACTORY_PROFILE, type SlicerSettings, type MachineProfile } from "../services/slicer.service";
import { writeScaledStl } from "../services/mesh.service";
import { tempPath, fileUrl } from "../utils/file-helpers";
import { logger } from "../utils/logger";

const router = Router();

router.post("/slice", async (req, res) => {
  let scaledStlPath: string | null = null;
  try {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Request body required" });
      return;
    }
    const {
      stlPath: stlRef,
      settings,
      printerPreset = "custom",
      machine,
      scale,
    } = req.body as {
      stlPath?: string;
      settings?: Partial<SlicerSettings>;
      printerPreset?: string;
      machine?: MachineProfile;
      scale?: [number, number, number];
    };

    if (!stlRef || typeof stlRef !== "string") {
      res.status(400).json({ error: "stlPath is required" });
      return;
    }

    // Resolve STL path from URL or filename
    const stlFilename = path.basename(stlRef);
    const originalStlPath = path.join(config.uploadsDir, stlFilename);

    if (!fs.existsSync(originalStlPath)) {
      res.status(404).json({ error: "STL file not found" });
      return;
    }

    // If the user rescaled the model in the viewer, bake that into a temp STL
    // so G-code coordinates match the previewed size. The slicer is unit-blind
    // and just consumes the vertex coords as mm.
    let stlPath = originalStlPath;
    if (Array.isArray(scale) && scale.length === 3 && scale.some((s) => Math.abs(s - 1) > 1e-4)) {
      if (!scale.every((s) => typeof s === "number" && isFinite(s) && s > 0)) {
        res.status(400).json({ error: "scale must be three positive finite numbers" });
        return;
      }
      scaledStlPath = tempPath(".scaled.stl");
      writeScaledStl(originalStlPath, scaledStlPath, scale);
      stlPath = scaledStlPath;
      logger.info(`Slicing with baked scale [${scale.join(", ")}] → ${scaledStlPath}`);
    }

    const mergedSettings: SlicerSettings = Object.assign(
      { ...FACTORY_PROFILE, printerPreset },
      settings ?? {}
    );

    // Machine nozzle size / filament diameter drive the whole pipeline (path
    // spacing + extrusion), so fold them into the slicer settings up front.
    if (machine?.nozzleSize && machine.nozzleSize > 0) {
      mergedSettings.nozzleDiameter = machine.nozzleSize;
      mergedSettings.lineWidth = machine.nozzleSize;
    }
    if (machine?.filamentDiameter && machine.filamentDiameter > 0) {
      mergedSettings.filamentDiameter = machine.filamentDiameter;
    }

    const result = await sliceToGcode(stlPath, mergedSettings, machine);

    const gcodePath = tempPath(".gcode");
    fs.writeFileSync(gcodePath, result.gcodeContent, "utf-8");

    res.json({
      gcodeUrl: fileUrl(gcodePath),
      stats: {
        layerCount: result.layerCount,
        estimatedTimeMinutes: result.estimatedTimeMinutes,
        filamentUsageMm: result.filamentUsageMm,
        filamentUsageGrams: result.filamentUsageGrams,
      },
      preview: result.gcodeContent.split("\n").slice(0, 100).join("\n"),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Slicing failed";
    logger.error("Slice error:", err);
    res.status(500).json({ error: msg });
  } finally {
    if (scaledStlPath) {
      try { fs.unlinkSync(scaledStlPath); } catch {}
    }
  }
});

export default router;
