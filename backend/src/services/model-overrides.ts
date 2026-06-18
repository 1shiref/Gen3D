/**
 * File-backed runtime override store for per-entry model selection.
 * Persists at backend/runtime-models.json (gitignored).
 *
 * Each chain build (in config.ts:getProviderFallbackOrder) reads the overrides
 * and patches entry.model / entry.visionModel — so changes take effect on the
 * next request, no restart required.
 */
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export interface OverridePatch {
  model?: string;
  visionModel?: string;
}

const OVERRIDES_PATH = path.resolve(__dirname, "../../runtime-models.json");

function readAll(): Record<string, OverridePatch> {
  try {
    if (!fs.existsSync(OVERRIDES_PATH)) return {};
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, OverridePatch>;
    }
    return {};
  } catch (e) {
    logger.warn("runtime-models.json read failed, treating as empty:", e);
    return {};
  }
}

function writeAll(data: Record<string, OverridePatch>): void {
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function getOverride(entryId: string): OverridePatch | undefined {
  const all = readAll();
  return all[entryId];
}

export function getAllOverrides(): Record<string, OverridePatch> {
  return readAll();
}

/**
 * Replaces the entry's override entirely with `patch`.
 * Empty-string fields are dropped. If the resulting object is empty, the entry is removed.
 */
export function setOverride(entryId: string, patch: OverridePatch): void {
  const all = readAll();
  const next: OverridePatch = {};
  if (typeof patch.model === "string" && patch.model.trim().length > 0) {
    next.model = patch.model.trim();
  }
  if (typeof patch.visionModel === "string" && patch.visionModel.trim().length > 0) {
    next.visionModel = patch.visionModel.trim();
  }
  if (!next.model && !next.visionModel) {
    delete all[entryId];
  } else {
    all[entryId] = next;
  }
  writeAll(all);
}

export function clearOverride(entryId: string): void {
  const all = readAll();
  if (entryId in all) {
    delete all[entryId];
    writeAll(all);
  }
}
