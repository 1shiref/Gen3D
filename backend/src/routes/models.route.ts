import { Router } from "express";
import { getProviderFallbackOrder, isBillingFailed } from "../config";
import { MODEL_REGISTRY } from "../services/model-registry";
import {
  getAllOverrides,
  setOverride,
  clearOverride,
  getOverride,
} from "../services/model-overrides";
import { logger } from "../utils/logger";

const router = Router();

function snapshot() {
  const chain = getProviderFallbackOrder().map((entry) => ({
    ...entry,
    status: isBillingFailed(entry.id) ? "billing-failed" : "ready",
  }));
  return { registry: MODEL_REGISTRY, overrides: getAllOverrides(), chain };
}

router.get("/models", (_req, res) => {
  res.json(snapshot());
});

/**
 * POST body: { model?, visionModel? }
 *   field absent          → keep current override value (or env default if no override)
 *   field === ""  or null → clear this field (revert to env default)
 *   field === non-empty   → set to this value
 *
 * If after applying the patch both fields are empty, the entire entry override is cleared.
 */
router.post("/models/:entryId", (req, res) => {
  const { entryId } = req.params;

  if (!getProviderFallbackOrder().some((e) => e.id === entryId)) {
    res.status(404).json({ error: `Unknown entry id: ${entryId}` });
    return;
  }

  const body = req.body as { model?: string | null; visionModel?: string | null } | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Request body must be an object" });
    return;
  }

  // Validate types
  if (body.model !== undefined && body.model !== null && typeof body.model !== "string") {
    res.status(400).json({ error: "`model` must be a string, null, or omitted" });
    return;
  }
  if (body.visionModel !== undefined && body.visionModel !== null && typeof body.visionModel !== "string") {
    res.status(400).json({ error: "`visionModel` must be a string, null, or omitted" });
    return;
  }

  // Reject obviously-invalid model ids (typos like "r"). Real model ids are at least 4 chars
  // and almost always contain a separator (- / . :).
  function looksValid(v: string | null | undefined): boolean {
    if (v === undefined || v === null || v === "") return true; // means "clear"
    const s = v.trim();
    return s.length >= 4 && /[-/.:]/.test(s);
  }
  if (!looksValid(body.model)) {
    res.status(400).json({ error: `\`model\` "${body.model}" does not look like a valid model id` });
    return;
  }
  if (!looksValid(body.visionModel)) {
    res.status(400).json({ error: `\`visionModel\` "${body.visionModel}" does not look like a valid model id` });
    return;
  }

  // Compute next override by merging current + patch (trim incoming strings)
  const current = getOverride(entryId) ?? {};
  const next = {
    model:
      body.model === undefined
        ? current.model
        : body.model === null || body.model === ""
        ? undefined
        : body.model.trim(),
    visionModel:
      body.visionModel === undefined
        ? current.visionModel
        : body.visionModel === null || body.visionModel === ""
        ? undefined
        : body.visionModel.trim(),
  };

  if (!next.model && !next.visionModel) {
    clearOverride(entryId);
    logger.info(`Override cleared for ${entryId}`);
  } else {
    setOverride(entryId, { model: next.model, visionModel: next.visionModel });
    logger.info(`Override set for ${entryId}: model=${next.model ?? "(env)"} vision=${next.visionModel ?? "(env)"}`);
  }

  res.json(snapshot());
});

export default router;
