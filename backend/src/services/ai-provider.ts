/**
 * Unified AI provider — routes to Anthropic, AgentRouter, OpenRouter, Groq, or Ollama.
 * Uses FallbackEntry chain with billing-error detection and auto-fallback.
 */
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import {
  config,
  getProviderFallbackOrder, isBillingFailed, markBillingFailed, clearBillingFailed,
  getEffectiveApiKey, getEffectiveAgentRouterUseCLI,
  type AIProvider, type FallbackEntry,
} from "../config";
import { logger } from "../utils/logger";

export type { FallbackEntry };

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string | AIContentPart[];
}

export interface AIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ProviderTestResult {
  entry: FallbackEntry;
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

// ─── Custom error with HTTP status + retry metadata ───────────

class AIProviderError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly isBillingError?: boolean
  ) { super(message); }
}

function isBillingBody(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes("credit balance") ||
    lower.includes("insufficient credit") ||
    lower.includes("billing") ||
    lower.includes("payment") ||
    lower.includes("quota exceeded")
  );
}

// Pulls the most meaningful human-readable line out of a nested provider error.
// OpenRouter wraps upstream errors in JSON like:
//   {"error":{"message":"Provider returned error","metadata":{"raw":"{\"error\":{\"message\":\"the real reason\"}}"}}}
// We want "the real reason", not "Provider returned error".
function extractCoreMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Surface native network errors via their cause (`fetch failed` + ECONNREFUSED, etc.)
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (msg === "fetch failed" && cause) {
    if (cause.code === "ECONNREFUSED") return "connection refused (provider unreachable)";
    if (cause.code === "ETIMEDOUT") return "connection timed out";
    if (cause.message) return `network error: ${cause.message.slice(0, 200)}`;
  }
  // Try to find any JSON-encoded "message" deep inside the string
  const matches = [...msg.matchAll(/"message"\s*:\s*"([^"]{1,200})"/g)].map((m) => m[1]);
  if (matches.length === 0) return msg.slice(0, 300);
  // Prefer the LAST one (most deeply nested) — that's usually the upstream provider's real reason
  const candidates = matches.filter(
    (m) => m && m !== "Provider returned error" && !m.startsWith("UNAUTHENTICATED")
  );
  return (candidates.pop() ?? matches[matches.length - 1] ?? msg).slice(0, 300);
}

// ─── Anthropic provider (also used for AgentRouter, which is Anthropic-API-compatible) ─

// Clients are constructed per-call so that runtime API-key changes (via UI) take
// effect on the very next request without needing a backend restart.
function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: getEffectiveApiKey("anthropic") || "placeholder" });
}

// AgentRouter is an Anthropic-API gateway. From a non-CLI client (this backend)
// it returns {"type":"unauthorized_client_error"} — the SDK config below is the
// most correct shape and will start working immediately if AgentRouter ever drops
// its TLS/HTTP fingerprinting. For now, the AGENTROUTER_USE_CLI flag (settable
// from the UI) routes calls through a `claude` subprocess instead.
function getAgentRouterClient(): Anthropic {
  const key = getEffectiveApiKey("agentrouter") || "placeholder";
  return new Anthropic({
    baseURL: "https://agentrouter.org/",
    apiKey: key,
    authToken: key,
  });
}

async function streamAnthropicCompat(
  client: Anthropic,
  model: string,
  system: string,
  messages: AIMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  enableThinking = false
): Promise<string> {
  let fullText = "";

  const anthropicMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: typeof m.content === "string"
      ? m.content
      : m.content.map((part): Anthropic.MessageParam["content"][0] => {
          if (part.type === "text") return { type: "text", text: part.text! };
          const url = part.image_url!.url;
          const [header, data] = url.split(",");
          const mediaType = header.split(":")[1].split(";")[0] as "image/jpeg" | "image/png" | "image/webp";
          return { type: "image", source: { type: "base64", media_type: mediaType, data } };
        }),
  }));

  // Extended thinking improves mesh-edit planning reasoning. Anthropic requires
  // budget_tokens >= 1024 and max_tokens > budget_tokens; thinking deltas arrive
  // as `thinking_delta` events which we ignore (only text_delta becomes output).
  const useThinking = enableThinking && config.thinkingBudget >= 1024;
  const maxTokens = useThinking
    ? Math.max(config.maxTokens, config.thinkingBudget + 1024)
    : config.maxTokens;

  try {
    const stream = await client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages as Anthropic.MessageParam[],
      ...(useThinking
        ? { thinking: { type: "enabled" as const, budget_tokens: config.thinkingBudget } }
        : {}),
    });

    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        onToken(event.delta.text);
      }
    }
  } catch (err: unknown) {
    // Anthropic SDK throws an APIError for HTTP errors
    const anyErr = err as { status?: number; message?: string; error?: unknown };
    if (anyErr?.status) {
      // Surface the raw body when present — AgentRouter returns its own UNAUTHENTICATED shape
      const bodyStr = anyErr.error ? JSON.stringify(anyErr.error).slice(0, 500) : "";
      const fullMsg = bodyStr ? `${anyErr.message} ${bodyStr}` : (anyErr.message ?? "Anthropic-compat error");

      // AgentRouter (and similar CLI-only gateways) reject non-whitelisted clients
      // via TLS/HTTP fingerprinting. Rewrite the confusing "UNAUTHENTICATED" body
      // into something actionable.
      if (/unauthorized_client_error|unauthorized client detected/i.test(fullMsg)) {
        throw new AIProviderError(
          anyErr.status,
          "AgentRouter blocks non-CLI clients (token is fine, gateway only accepts " +
          "the official `claude` CLI). Workarounds: use OpenRouter (Claude) here, " +
          "OR set AGENTROUTER_USE_CLI=true in backend/.env after `npm i -g @anthropic-ai/claude-code`.",
          undefined,
          false,
        );
      }

      const billing = isBillingBody(fullMsg);
      throw new AIProviderError(anyErr.status, fullMsg, undefined, billing);
    }
    throw err;
  }

  return fullText;
}

// ─── AgentRouter via official `claude` CLI subprocess (opt-in) ────────────────
//
// AgentRouter fingerprint-blocks all non-CLI clients. The only way to actually
// reach it from this backend is to spawn the official `claude` binary as a child
// process. Enable with AGENTROUTER_USE_CLI=true (or via the UI toggle) after
// installing the CLI globally: `npm i -g @anthropic-ai/claude-code`.
//
// Supports both text and vision inputs:
//   - Text: plain text stdin (default --input-format text).
//   - Vision: --input-format stream-json + Anthropic content blocks on stdin
//     (the SDKUserMessage shape, same as the Anthropic Messages API).

interface StreamJsonEvent {
  type: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  delta?: { type?: string; text?: string };
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

interface AnthropicContentBlock {
  type: "text" | "image";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
}

/** Convert one AIMessage into an Anthropic content-block array (SDKUserMessage.message.content). */
function aiMessageToAnthropicBlocks(m: AIMessage): AnthropicContentBlock[] {
  if (typeof m.content === "string") {
    return [{ type: "text", text: m.content }];
  }
  return m.content.map((p): AnthropicContentBlock => {
    if (p.type === "text") return { type: "text", text: p.text ?? "" };
    // image_url is a data: URL — convert to base64 source
    const url = p.image_url?.url ?? "";
    const [header, data] = url.split(",");
    const mediaType = (header.split(":")[1] ?? "").split(";")[0] || "image/png";
    return { type: "image", source: { type: "base64", media_type: mediaType, data: data ?? "" } };
  });
}

async function streamAgentRouterCLI(
  model: string,
  system: string,
  messages: AIMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const hasImages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  );

  // Build the args. Vision path uses stream-json input so we can send image blocks.
  // We always set --include-partial-messages so onToken sees incremental deltas
  // (default stream-json mode otherwise only emits whole assistant blocks).
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--model", model,
  ];
  if (hasImages) {
    args.push("--input-format", "stream-json", "--include-partial-messages");
  }
  if (system) {
    // --append-system-prompt grafts our prompt onto Claude Code's built-in one.
    // For gen3d's mesh-edit planner this is fine — the default coding-assistant
    // scaffolding doesn't hurt the strict-JSON planning task.
    args.push("--append-system-prompt", system);
  }

  return new Promise<string>((resolve, reject) => {
    const arKey = getEffectiveApiKey("agentrouter");
    const child = spawn("claude", args, {
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: "https://agentrouter.org/",
        ANTHROPIC_AUTH_TOKEN: arKey,
        ANTHROPIC_API_KEY: arKey,
      },
      shell: process.platform === "win32", // Windows needs shell to resolve `.cmd` shims
    });

    let stderrBuf = "";
    let fullText = "";
    let stdoutBuf = "";
    let killed = false;
    let timedOut = false;
    // With --include-partial-messages we receive both deltas AND the final
    // assistant message — track which path is delivering text so we don't double-emit.
    let streamedViaDeltas = false;

    // No-output watchdog: if the spawned `claude` produces nothing for this
    // long, kill it so the provider chain can fall through. Resets on each
    // chunk of stdout/stderr (see handlers below).
    const NO_OUTPUT_TIMEOUT_MS = 90_000;
    let idleTimer: NodeJS.Timeout = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill();
    }, NO_OUTPUT_TIMEOUT_MS);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        killed = true;
        child.kill();
      }, NO_OUTPUT_TIMEOUT_MS);
    };

    const onAbort = () => {
      if (!killed) {
        killed = true;
        clearTimeout(idleTimer);
        child.kill();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
      if (err.code === "ENOENT") {
        reject(new AIProviderError(
          500,
          "`claude` CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code`, " +
          "or set AGENTROUTER_USE_CLI=false in backend/.env.",
          undefined,
          false,
        ));
      } else {
        reject(new AIProviderError(500, `claude CLI spawn error: ${err.message}`, undefined, false));
      }
    });

    child.stderr.on("data", (b: Buffer) => {
      stderrBuf += b.toString();
      resetIdle();
    });

    child.stdout.on("data", (b: Buffer) => {
      resetIdle();
      stdoutBuf += b.toString();
      // stream-json emits one JSON object per line
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt: StreamJsonEvent;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        // Text comes through either as deltas (preferred when streaming) or as a
        // complete assistant message. Prefer deltas when present.
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
          streamedViaDeltas = true;
          fullText += evt.delta.text;
          onToken(evt.delta.text);
        } else if (evt.type === "assistant" && evt.message?.content && !streamedViaDeltas) {
          for (const block of evt.message.content) {
            if (block.type === "text" && block.text) {
              fullText += block.text;
              onToken(block.text);
            }
          }
        } else if (evt.type === "result" && evt.is_error) {
          // CLI signals a terminal error — capture but let the close handler reject
          stderrBuf = (stderrBuf + "\n" + (evt.result ?? "claude CLI error")).trim();
        }
      }
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(idleTimer);
      if (timedOut) {
        // Surface a clear error so the chain can fall through to the next
        // provider instead of the connection sitting idle until the browser
        // times it out and shows "aborted". Not billing-related — pass false
        // so the entry isn't permanently skipped.
        reject(new AIProviderError(
          504,
          `AgentRouter CLI produced no output for ${NO_OUTPUT_TIMEOUT_MS / 1000}s — likely auth or network stall. ` +
          `Disable CLI mode in Settings (or runtime-settings.json: agentrouter.useCLI = false) if this persists.`,
          undefined,
          false,
        ));
        return;
      }
      if (killed || signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      if (code !== 0) {
        const reason = stderrBuf.trim() || `claude CLI exited with code ${code}`;
        reject(new AIProviderError(502, `AgentRouter CLI failed: ${reason.slice(0, 500)}`, undefined, false));
        return;
      }
      if (!fullText.trim()) {
        reject(new AIProviderError(502, "AgentRouter CLI returned empty output", undefined, false));
        return;
      }
      resolve(fullText);
    });

    // Stdin: text-only uses plain text; vision uses NDJSON of SDKUserMessage
    // shapes so we can embed image content blocks.
    if (hasImages) {
      for (const m of messages) {
        const blocks = aiMessageToAnthropicBlocks(m);
        const sdkUserMsg = {
          type: "user",
          message: {
            role: m.role as "user" | "assistant",
            content: blocks,
          },
        };
        child.stdin.write(JSON.stringify(sdkUserMsg) + "\n");
      }
    } else {
      // Flatten the conversation into a single prompt string.
      const promptParts: string[] = [];
      for (const m of messages) {
        const text = typeof m.content === "string"
          ? m.content
          : m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
        promptParts.push(text);
      }
      child.stdin.write(promptParts.join("\n\n"));
    }
    child.stdin.end();
  });
}

// ─── OpenAI-compatible streaming (AgentRouter / OpenRouter / Groq / Ollama) ─

interface OAIChatChunk {
  choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
}

async function streamOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: AIMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const body = {
    model,
    stream: true,
    max_tokens: config.maxTokens,
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST", headers, body: JSON.stringify(body),
    signal: signal as RequestInit["signal"],
  });

  if (!res.ok) {
    const errBody = await res.text();
    let retryAfterMs: number | undefined;
    const billing = res.status === 402 || isBillingBody(errBody);

    if (res.status === 429) {
      try {
        const parsed = JSON.parse(errBody);
        const secs = parsed?.error?.metadata?.retry_after_seconds;
        if (typeof secs === "number") retryAfterMs = Math.ceil(secs) * 1000;
      } catch {}
      if (!retryAfterMs) {
        const h = res.headers.get("Retry-After");
        if (h) retryAfterMs = parseInt(h) * 1000;
      }
    }

    throw new AIProviderError(res.status, `AI provider error ${res.status}: ${errBody}`, retryAfterMs, billing);
  }

  if (!res.body) throw new Error("No response body from AI provider");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done || signal?.aborted) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;
      try {
        const chunk: OAIChatChunk = JSON.parse(payload);
        const token = chunk.choices?.[0]?.delta?.content ?? "";
        if (token) { fullText += token; onToken(token); }
      } catch (e) {
        logger.warn(`SSE chunk parse error: ${payload.slice(0, 80)}`);
      }
    }
  }

  // Flush any remaining buffered content (last chunk may not end with \n)
  if (buf.trim()) {
    for (const line of buf.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk: OAIChatChunk = JSON.parse(payload);
        const token = chunk.choices?.[0]?.delta?.content ?? "";
        if (token) { fullText += token; onToken(token); }
      } catch (e) {
        logger.warn(`SSE flush parse error: ${String(e).slice(0, 80)}`);
      }
    }
  }

  return fullText;
}

// ─── Per-entry call dispatcher ─────────────────────────────────

async function callEntry(
  entry: FallbackEntry,
  hasImages: boolean,
  system: string,
  messages: AIMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const model = hasImages ? entry.visionModel : entry.model;

  switch (entry.provider) {
    case "anthropic":
      // Extended thinking only on the direct Anthropic provider — AgentRouter/OpenRouter
      // gateways may reject the `thinking` parameter, so we don't risk it there.
      return streamAnthropicCompat(getAnthropicClient(), model, system, messages, onToken, signal, true);

    case "agentrouter":
      // AgentRouter is CLI-only — even the SDK + custom baseURL gets fingerprint-blocked.
      // When the runtime/env flag is true → spawn the `claude` binary; otherwise hit the
      // SDK path so streamAnthropicCompat can throw the clear actionable error.
      if (getEffectiveAgentRouterUseCLI()) {
        return streamAgentRouterCLI(model, system, messages, onToken, signal);
      }
      return streamAnthropicCompat(getAgentRouterClient(), model, system, messages, onToken, signal);

    case "openrouter":
      return streamOpenAICompat(
        "https://openrouter.ai/api", getEffectiveApiKey("openrouter"), model,
        system, messages, onToken, signal,
        { "HTTP-Referer": "https://gen3d.local", "X-Title": "Gen3D" }
      );

    case "groq":
      return streamOpenAICompat(
        "https://api.groq.com/openai", getEffectiveApiKey("groq"), model,
        system, messages, onToken, signal
      );

    case "ollama":
      return streamOpenAICompat(
        config.ollamaBaseUrl, "", model,
        system, messages, onToken, signal
      );

    default:
      throw new Error(`Unknown provider: ${(entry as FallbackEntry).provider}`);
  }
}

// ─── Public streaming entry-point (with auto-fallback) ────────

// How long to wait for the FIRST token before considering a provider dead and moving on.
// Bumped from 30s → 90s because Opus 4.x via AgentRouter CLI routinely takes 30–60s
// of "thinking" time on detailed prompts before emitting any output. Override with
// AI_FIRST_TOKEN_TIMEOUT_MS=<ms> for slower networks or even more aggressive provider failover.
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.AI_FIRST_TOKEN_TIMEOUT_MS) || 90_000;

export async function streamAI(
  system: string,
  messages: AIMessage[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  onProviderSelected?: (entry: FallbackEntry) => void,
  preferredEntryId?: string,   // try this entry first
  strict?: boolean,            // if true, ONLY use preferredEntryId — no fallback
): Promise<string> {
  const hasImages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")
  );

  const chain = getProviderFallbackOrder();

  // Strict: only the chosen entry. Otherwise: chosen entry first, then full chain.
  const orderedChain = preferredEntryId
    ? (strict
        ? chain.filter((e) => e.id === preferredEntryId)
        : [
            ...chain.filter((e) => e.id === preferredEntryId && !isBillingFailed(e.id)),
            ...chain.filter((e) => e.id !== preferredEntryId),
          ])
    : chain;

  if (preferredEntryId && orderedChain.length === 0) {
    throw new Error(`Forced provider "${preferredEntryId}" is not configured (not in active chain)`);
  }

  let lastError: Error = new Error("No AI providers configured");
  const attemptErrors: Array<{ label: string; err: string }> = [];

  for (const entry of orderedChain) {
    // Strict mode honors the user's explicit choice even if it was previously marked billing-failed
    // (the mark is just a hint; user may have topped up since).
    if (isBillingFailed(entry.id) && !strict) {
      logger.info(`Skipping "${entry.label}" — billing failed this session`);
      attemptErrors.push({ label: entry.label, err: "skipped (billing-failed mark)" });
      continue;
    }

    const model = hasImages ? entry.visionModel : entry.model;
    logger.info(`Trying: ${entry.label} / ${model}`);

    let tokensReceived = 0;

    // Per-attempt controller: aborts on user-cancel OR first-token timeout
    const attemptAC = new AbortController();
    const propagateAbort = () => attemptAC.abort();
    signal?.addEventListener("abort", propagateAbort, { once: true });

    const guardedOnToken = (t: string) => {
      if (tokensReceived === 0) {
        clearTimeout(firstTokenTimeout);
        onProviderSelected?.(entry);
      }
      tokensReceived++;
      onToken(t);
    };

    // Abort this attempt if no first token arrives within the timeout
    const firstTokenTimeout = setTimeout(() => {
      if (tokensReceived === 0) {
        logger.warn(`"${entry.label}" — no first token in ${FIRST_TOKEN_TIMEOUT_MS / 1000}s, trying next provider`);
        attemptAC.abort();
      }
    }, FIRST_TOKEN_TIMEOUT_MS);

    try {
      try {
        const result = await callEntry(entry, hasImages, system, messages, guardedOnToken, attemptAC.signal);
        // Successful real call — clear any stale billing-failed mark for this entry.
        if (clearBillingFailed(entry.id)) {
          logger.info(`Billing cleared for "${entry.label}" — back in chain`);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(msg);

        if (signal?.aborted) throw lastError;
        if (tokensReceived > 0) throw lastError; // mid-stream — cannot switch

        // First-token timeout fired (not user abort) — skip to next provider
        if (attemptAC.signal.aborted && !signal?.aborted) {
          logger.warn(`"${entry.label}" timed out — trying next provider`);
          attemptErrors.push({ label: entry.label, err: `no response in ${FIRST_TOKEN_TIMEOUT_MS / 1000}s` });
          continue;
        }

        // Billing error — mark and skip permanently for this session
        if (err instanceof AIProviderError && err.isBillingError) {
          markBillingFailed(entry.id);
          logger.warn(`"${entry.label}" has billing issue — skipping for this session`);
          attemptErrors.push({ label: entry.label, err: `billing issue — ${extractCoreMessage(err)}` });
          continue;
        }

        // Rate-limit — wait for retry-after then retry same entry once
        if (err instanceof AIProviderError && err.statusCode === 429 && err.retryAfterMs) {
          const waitMs = Math.min(err.retryAfterMs, 60_000);
          logger.warn(`"${entry.label}" rate-limited — retrying in ${waitMs / 1000}s…`);
          await new Promise((r) => setTimeout(r, waitMs));

          // Per-retry controller with its own first-token timeout
          const retryAC = new AbortController();
          const retryPropagate = () => retryAC.abort();
          signal?.addEventListener("abort", retryPropagate, { once: true });
          tokensReceived = 0;

          const retryGuardedOnToken = (t: string) => {
            if (tokensReceived === 0) {
              clearTimeout(retryFirstTokenTimeout);
              onProviderSelected?.(entry);
            }
            tokensReceived++;
            onToken(t);
          };

          const retryFirstTokenTimeout = setTimeout(() => {
            if (tokensReceived === 0) retryAC.abort();
          }, FIRST_TOKEN_TIMEOUT_MS);

          try {
            const result = await callEntry(entry, hasImages, system, messages, retryGuardedOnToken, retryAC.signal);
            if (clearBillingFailed(entry.id)) {
              logger.info(`Billing cleared for "${entry.label}" — back in chain`);
            }
            return result;
          } catch (retryErr) {
            lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
            if (signal?.aborted || tokensReceived > 0) throw lastError;
          } finally {
            clearTimeout(retryFirstTokenTimeout);
            signal?.removeEventListener("abort", retryPropagate);
          }
        }

        const isLast = entry === orderedChain[orderedChain.length - 1];
        if (!isLast) logger.warn(`"${entry.label}" failed (${msg}) — trying next…`);
        attemptErrors.push({ label: entry.label, err: extractCoreMessage(err) });
      }
    } finally {
      clearTimeout(firstTokenTimeout);
      signal?.removeEventListener("abort", propagateAbort);
    }
  }

  // All providers exhausted — build an error message that lists every attempt.
  if (attemptErrors.length > 0) {
    const summary = attemptErrors.map((a) => `  • ${a.label}: ${a.err}`).join("\n");
    const verb = strict ? "Forced provider failed" : `All ${attemptErrors.length} AI provider(s) failed`;
    throw new Error(`${verb}:\n${summary}`);
  }
  throw lastError;
}

// ─── Non-streaming calls ───────────────────────────────────────

export async function callAI(system: string, userMessage: string): Promise<string> {
  let result = "";
  await streamAI(system, [{ role: "user", content: userMessage }], (t) => { result += t; });
  return result;
}

export async function callAIMessages(
  system: string,
  messages: AIMessage[],
  onEntrySelected?: (entry: FallbackEntry) => void
): Promise<string> {
  let result = "";
  await streamAI(system, messages, (t) => { result += t; }, undefined, onEntrySelected);
  return result;
}

// ─── Provider test (one entry) ────────────────────────────────

export async function testProviderEntry(entry: FallbackEntry): Promise<ProviderTestResult> {
  const start = Date.now();
  try {
    let reply = "";
    await callEntry(
      entry, false,
      "You are a test assistant. Reply with exactly one word.",
      [{ role: "user", content: "Say: ok" }],
      (t) => { reply += t; }
    );
    // Test succeeded — if this entry was previously marked billing-failed,
    // clear the mark so it rejoins the chain.
    if (clearBillingFailed(entry.id)) {
      logger.info(`Billing cleared for "${entry.label}" — back in chain`);
    }
    return { entry, ok: true, latencyMs: Date.now() - start, reply: reply.trim() };
  } catch (err) {
    return {
      entry, ok: false, latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
