import { Router } from "express";
import { planEdits, type PlanFeatureSpec, type PlanEditContext } from "../services/claude.service";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Map a natural-language goal to an ordered list of mesh-edit feature steps.
 * The frontend supplies its feature catalog so the planner only ever orders
 * features that actually exist. Plain JSON (not SSE).
 */
router.post("/plan-edit", async (req, res) => {
  try {
    const { goal, context, features } = req.body as {
      goal?: string;
      context?: PlanEditContext;
      features?: PlanFeatureSpec[];
    };

    if (!goal || typeof goal !== "string" || !goal.trim()) {
      res.status(400).json({ error: "goal is required" });
      return;
    }
    if (!Array.isArray(features) || features.length === 0) {
      res.status(400).json({ error: "features catalog is required" });
      return;
    }

    const steps = await planEdits(goal.trim(), context ?? {}, features);
    res.json({ steps });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Planning failed";
    logger.error("plan-edit error:", err);
    res.status(500).json({ error: msg });
  }
});

export default router;
