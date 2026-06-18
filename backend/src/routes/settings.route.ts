import { Router } from "express";
import { spawn } from "child_process";
import {
  getRuntimeSettings,
  setRuntimeApiKey,
  setRuntimeAgentRouterUseCLI,
  getRuntimeApiKey,
  getRuntimeAgentRouterUseCLI,
  maskKey,
  type ApiKeyProvider,
} from "../services/runtime-settings";
import { config, getEffectiveApiKey, getEffectiveAgentRouterUseCLI } from "../config";
import { logger } from "../utils/logger";

const router = Router();

const VALID_PROVIDERS: ApiKeyProvider[] = ["anthropic", "agentrouter", "openrouter", "groq"];

function isValidProvider(p: string): p is ApiKeyProvider {
  return (VALID_PROVIDERS as string[]).includes(p);
}

/** Probes whether the `claude` CLI is on PATH. Resolves quickly with bool + version (if any). */
function probeClaudeCLI(): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn("claude", ["--version"], {
      shell: process.platform === "win32",
    });
    let stdout = "";
    child.stdout?.on("data", (b) => (stdout += b.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (resolved) return;
      resolved = true;
      resolve({ available: false, error: err.code === "ENOENT" ? "claude CLI not found on PATH" : err.message });
    });
    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      if (code === 0) {
        resolve({ available: true, version: stdout.trim().split("\n")[0] || undefined });
      } else {
        resolve({ available: false, error: `claude --version exited ${code}` });
      }
    });
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill();
      resolve({ available: false, error: "claude --version timed out" });
    }, 4000);
  });
}

/**
 * Builds a UI-safe snapshot of runtime + env-effective settings.
 * API keys are masked. Reveals which keys came from .env vs the runtime UI.
 */
function snapshot() {
  const runtime = getRuntimeSettings();
  const apiKeys: Record<ApiKeyProvider, { present: boolean; masked: string | null; source: "runtime" | "env" | "none" }> = {
    anthropic: keyStatus("anthropic", runtime.apiKeys?.anthropic, config.anthropicApiKey),
    agentrouter: keyStatus("agentrouter", runtime.apiKeys?.agentrouter, config.agentrouterApiKey),
    openrouter: keyStatus("openrouter", runtime.apiKeys?.openrouter, config.openrouterApiKey),
    groq: keyStatus("groq", runtime.apiKeys?.groq, config.groqApiKey),
  };
  return {
    apiKeys,
    agentrouter: {
      useCLI: getEffectiveAgentRouterUseCLI(),
      useCLISource: getRuntimeAgentRouterUseCLI() !== undefined ? "runtime" : "env",
    },
  };
}

function keyStatus(
  provider: ApiKeyProvider,
  runtimeKey: string | undefined,
  envKey: string,
): { present: boolean; masked: string | null; source: "runtime" | "env" | "none" } {
  const effective = getEffectiveApiKey(
    provider === "anthropic" ? "anthropic" :
    provider === "agentrouter" ? "agentrouter" :
    provider === "openrouter" ? "openrouter" : "groq",
  );
  const present = effective.length > 10 && !effective.includes("your_") && !effective.includes("_here");
  const source: "runtime" | "env" | "none" =
    runtimeKey ? "runtime" : (envKey && envKey.length > 10 && !envKey.includes("your_") ? "env" : "none");
  // Only surface a masked key when there's actually a valid value (avoid masking the .env placeholder)
  return { present, masked: present ? maskKey(effective || undefined) : null, source };
}

router.get("/settings", async (_req, res) => {
  res.json(snapshot());
});

router.post("/settings/api-key/:provider", (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }
  const body = req.body as { key?: string | null } | undefined;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body must be an object" });
    return;
  }
  // null/empty → clear; otherwise validate basic shape
  if (body.key !== null && body.key !== undefined) {
    if (typeof body.key !== "string") {
      res.status(400).json({ error: "`key` must be a string, null, or omitted" });
      return;
    }
    const trimmed = body.key.trim();
    if (trimmed !== "" && trimmed.length < 10) {
      res.status(400).json({ error: "API key looks too short" });
      return;
    }
    setRuntimeApiKey(provider, trimmed === "" ? null : trimmed);
    logger.info(`Runtime API key ${trimmed === "" ? "cleared" : "set"} for ${provider}`);
  } else {
    setRuntimeApiKey(provider, null);
    logger.info(`Runtime API key cleared for ${provider}`);
  }
  res.json(snapshot());
});

router.post("/settings/agentrouter-cli", async (req, res) => {
  const body = req.body as { enabled?: boolean | null } | undefined;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body must be an object" });
    return;
  }
  if (body.enabled === undefined) {
    res.status(400).json({ error: "`enabled` (boolean or null) is required" });
    return;
  }
  if (body.enabled === true) {
    const probe = await probeClaudeCLI();
    if (!probe.available) {
      res.status(412).json({
        error: `Cannot enable CLI mode: ${probe.error}. Install with: npm i -g @anthropic-ai/claude-code`,
      });
      return;
    }
  }
  setRuntimeAgentRouterUseCLI(body.enabled === null ? null : !!body.enabled);
  logger.info(`AgentRouter CLI mode → ${body.enabled === null ? "unset (env default)" : body.enabled ? "enabled" : "disabled"}`);
  res.json(snapshot());
});

router.get("/settings/claude-cli-status", async (_req, res) => {
  const probe = await probeClaudeCLI();
  res.json(probe);
});

export default router;
