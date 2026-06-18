import { Router } from "express";
import { enhancePrompt } from "../services/claude.service";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Rewrite a user's text prompt into a richer single-object description for
 * image→3D generation. Plain JSON (not SSE). Body: { prompt }. Returns { prompt }.
 */
router.post("/enhance-prompt", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const enhanced = await enhancePrompt(prompt);
    res.json({ prompt: enhanced });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Enhancement failed";
    logger.error("enhance-prompt error:", err);
    res.status(500).json({ error: msg });
  }
});

export default router;
