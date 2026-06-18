import { Router } from "express";
import { getSlicerBackend } from "../services/slicer.service";
import { getProviderFallbackOrder, isBillingFailed, getBillingFailedIds } from "../config";
import { testProviderEntry } from "../services/ai-provider";

const router = Router();

router.get("/health", async (_req, res) => {
  const slicer = getSlicerBackend();
  const chain = getProviderFallbackOrder();
  const billingFailed = getBillingFailedIds();

  const chainWithStatus = chain.map((entry) => ({
    ...entry,
    status: isBillingFailed(entry.id) ? "billing-failed" : "ready",
  }));

  const activeEntry = chainWithStatus.find((e) => e.status === "ready") ?? chainWithStatus[0] ?? null;

  res.json({
    status: "ok",
    slicer,
    ai: {
      activeEntry: activeEntry
        ? { id: activeEntry.id, label: activeEntry.label, model: activeEntry.model, isClaudeModel: activeEntry.isClaudeModel }
        : null,
      chain: chainWithStatus,
      billingFailed,
    },
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Test all configured providers and return live status
router.get("/test-ai", async (req, res) => {
  const chain = getProviderFallbackOrder();
  const results = await Promise.all(chain.map(testProviderEntry));

  const anyOk = results.some((r) => r.ok);
  res.status(anyOk ? 200 : 503).json({
    results: results.map((r) => ({
      id: r.entry.id,
      label: r.entry.label,
      model: r.entry.model,
      isClaudeModel: r.entry.isClaudeModel,
      ok: r.ok,
      latencyMs: r.latencyMs,
      reply: r.reply,
      error: r.error,
      billingFailed: isBillingFailed(r.entry.id),
    })),
    summary: anyOk
      ? `OK — ${results.filter((r) => r.ok).map((r) => r.entry.label).join(", ")} working`
      : "ERROR — all providers failed",
  });
});

// Re-test one specific entry — used by the per-row "Recheck" button.
// On success the billing-failed mark is auto-cleared (testProviderEntry handles that).
router.post("/test-entry/:entryId", async (req, res) => {
  const { entryId } = req.params;
  const entry = getProviderFallbackOrder().find((e) => e.id === entryId);
  if (!entry) {
    res.status(404).json({ error: `Unknown provider entry: ${entryId}` });
    return;
  }

  const result = await testProviderEntry(entry);
  res.status(result.ok ? 200 : 502).json({
    id: entry.id,
    label: entry.label,
    model: entry.model,
    isClaudeModel: entry.isClaudeModel,
    ok: result.ok,
    latencyMs: result.latencyMs,
    reply: result.reply,
    error: result.error,
    billingFailed: isBillingFailed(entry.id),
  });
});

export default router;
