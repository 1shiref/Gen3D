import { Router } from "express";
import {
  planSmart,
  type SmartActionSpec,
  type SmartPlanContext,
  type SmartAnswer,
} from "../services/smart-plan.service";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Map a natural-language goal to a full-workflow plan (or clarification questions).
 * The frontend supplies its action catalog so the planner only ever orders actions
 * that actually exist in the app. Plain JSON (not SSE).
 */
router.post("/smart-plan", async (req, res) => {
  try {
    const { goal, context, actions, answers, round } = req.body as {
      goal?: string;
      context?: SmartPlanContext;
      actions?: SmartActionSpec[];
      answers?: SmartAnswer[];
      round?: number;
    };

    if (!goal || typeof goal !== "string" || !goal.trim()) {
      res.status(400).json({ error: "goal is required" });
      return;
    }
    if (!Array.isArray(actions) || actions.length === 0) {
      res.status(400).json({ error: "actions catalog is required" });
      return;
    }

    const result = await planSmart(
      goal.trim(),
      context ?? {},
      actions,
      Array.isArray(answers) ? answers : [],
      typeof round === "number" ? round : 0,
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Planning failed";
    logger.error("smart-plan error:", err);
    res.status(500).json({ error: msg });
  }
});

export default router;
