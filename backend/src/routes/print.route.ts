import { Router } from "express";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { logger } from "../utils/logger";

const router = Router();

/** Make a user-supplied name into a safe `<name>.gcode` basename. */
function safeGcodeName(name: string | undefined): string {
  const fallback = `gen3d-${Date.now()}.gcode`;
  if (!name || typeof name !== "string") return fallback;
  // Strip any path components and characters that are awkward in a filename.
  let base = path.basename(name).replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (!base) return fallback;
  if (!base.toLowerCase().endsWith(".gcode")) base += ".gcode";
  return base;
}

// Push a previously sliced G-code file to the Moonraker/Klipper printer. With
// `print: true` Moonraker stores the file in its gcodes folder AND starts the
// print; otherwise it just stores it so it shows up in Mainsail's G-Code Files.
router.post("/print", async (req, res) => {
  try {
    const { gcodeUrl, name, print } = (req.body ?? {}) as {
      gcodeUrl?: string;
      name?: string;
      print?: boolean;
    };

    if (!gcodeUrl || typeof gcodeUrl !== "string") {
      res.status(400).json({ error: "gcodeUrl is required" });
      return;
    }

    const filePath = path.join(config.uploadsDir, path.basename(gcodeUrl));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "G-code file not found — slice the model again" });
      return;
    }

    const filename = safeGcodeName(name);
    const buf = fs.readFileSync(filePath);

    const form = new FormData();
    form.append("file", new Blob([buf], { type: "text/plain" }), filename);
    form.append("root", "gcodes");
    form.append("print", print ? "true" : "false");

    const moonrakerRes = await fetch(`${config.moonrakerUrl}/server/files/upload`, {
      method: "POST",
      body: form,
    });

    const text = await moonrakerRes.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!moonrakerRes.ok) {
      logger.error(`Moonraker upload failed (${moonrakerRes.status}):`, text);
      res.status(502).json({
        error: data?.error?.message ?? data?.error ?? `Printer rejected upload (HTTP ${moonrakerRes.status})`,
      });
      return;
    }

    logger.info(`Sent G-code to printer: ${filename} (print=${!!print}, started=${!!data?.print_started})`);
    res.json({
      filename: data?.item?.path ?? filename,
      printStarted: !!data?.print_started,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to send G-code to printer";
    logger.error("Print route error:", err);
    // A connection refused here usually means Moonraker isn't reachable.
    res.status(502).json({ error: `Could not reach the printer (Moonraker): ${msg}` });
  }
});

export default router;
