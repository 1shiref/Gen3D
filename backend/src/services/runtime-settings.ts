/**
 * File-backed runtime settings (API keys + provider toggles).
 * Persists at backend/runtime-settings.json (gitignored).
 *
 * Resolution: when both .env and runtime-settings.json define a value, runtime wins.
 * Read on every chain build / call dispatch — no restart required.
 */
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export type ApiKeyProvider = "anthropic" | "agentrouter" | "openrouter" | "groq";

export interface RuntimeSettings {
  apiKeys?: Partial<Record<ApiKeyProvider, string>>;
  agentrouter?: {
    useCLI?: boolean;
  };
}

const SETTINGS_PATH = path.resolve(__dirname, "../../runtime-settings.json");

function readAll(): RuntimeSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RuntimeSettings;
    }
    return {};
  } catch (e) {
    logger.warn("runtime-settings.json read failed, treating as empty:", e);
    return {};
  }
}

function writeAll(data: RuntimeSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function getRuntimeSettings(): RuntimeSettings {
  return readAll();
}

/** Returns the runtime API key for a provider if present and non-empty. */
export function getRuntimeApiKey(provider: ApiKeyProvider): string | undefined {
  const s = readAll();
  const k = s.apiKeys?.[provider];
  return typeof k === "string" && k.trim().length > 0 ? k.trim() : undefined;
}

/** Sets or clears (when `key` is null/empty) a runtime API key. */
export function setRuntimeApiKey(provider: ApiKeyProvider, key: string | null): void {
  const all = readAll();
  if (!all.apiKeys) all.apiKeys = {};
  if (key === null || key.trim() === "") {
    delete all.apiKeys[provider];
    if (Object.keys(all.apiKeys).length === 0) delete all.apiKeys;
  } else {
    all.apiKeys[provider] = key.trim();
  }
  writeAll(all);
}

/** Returns the runtime override for AgentRouter CLI mode, undefined if unset. */
export function getRuntimeAgentRouterUseCLI(): boolean | undefined {
  const s = readAll();
  return s.agentrouter?.useCLI;
}

/** Sets or clears (when `enabled` is null) the AgentRouter CLI mode. */
export function setRuntimeAgentRouterUseCLI(enabled: boolean | null): void {
  const all = readAll();
  if (enabled === null) {
    if (all.agentrouter) {
      delete all.agentrouter.useCLI;
      if (Object.keys(all.agentrouter).length === 0) delete all.agentrouter;
    }
  } else {
    if (!all.agentrouter) all.agentrouter = {};
    all.agentrouter.useCLI = enabled;
  }
  writeAll(all);
}

/** Masks an API key for display (`sk-Wg79...zab8`). */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 12) return "•••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
