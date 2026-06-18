import { useEffect, useRef, useState } from "react";
import {
  checkHealth, getModels, setEntryModels, testEntry,
  getSettings, setApiKey, setAgentRouterCLI,
} from "@/lib/api";
import { useSystemStore } from "@/stores/systemStore";
import { useGenerationStore } from "@/stores/generationStore";
import type {
  ProviderChainEntry,
  ModelRegistry,
  ModelOverrides,
  EntryModels,
  SettingsSnapshot,
  ApiKeyProvider,
} from "@/lib/api";

// Map FallbackEntry.id → ApiKeyProvider for the per-row key editor.
const ENTRY_TO_KEY_PROVIDER: Record<string, ApiKeyProvider> = {
  "anthropic": "anthropic",
  "agentrouter-claude": "agentrouter",
  "openrouter-claude": "openrouter",
  "openrouter-free": "openrouter",
  "groq": "groq",
};

const STATUS_ICONS: Record<string, string> = {
  ready: "○",
  "billing-failed": "✕",
};

const CUSTOM_VALUE = "__custom__";

interface ModelPickerProps {
  entry: ProviderChainEntry;
  models: EntryModels | undefined;
  override: { model?: string; visionModel?: string } | undefined;
  onApply: (patch: { model?: string | null; visionModel?: string | null }) => Promise<void>;
}

function ModelPicker({ entry, models, override, onApply }: ModelPickerProps) {
  // Current effective values (override takes precedence over chain entry)
  const currentText = entry.model;
  const currentVision = entry.visionModel;

  const textOptions = models?.text ?? [];
  const visionOptions = models?.vision ?? [];

  // If the current value isn't in the curated list, treat it as "custom"
  const textInList = textOptions.some((o) => o.id === currentText);
  const visionInList = visionOptions.some((o) => o.id === currentVision);

  const [textSel, setTextSel] = useState(textInList ? currentText : CUSTOM_VALUE);
  const [visionSel, setVisionSel] = useState(visionInList ? currentVision : CUSTOM_VALUE);
  const [textCustom, setTextCustom] = useState(textInList ? "" : currentText);
  const [visionCustom, setVisionCustom] = useState(visionInList ? "" : currentVision);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isOverridden = !!(override?.model || override?.visionModel);

  async function handleApply() {
    setBusy(true);
    setErr(null);
    try {
      const model = textSel === CUSTOM_VALUE ? textCustom.trim() : textSel;
      const visionModel = visionSel === CUSTOM_VALUE ? visionCustom.trim() : visionSel;
      if (!model) throw new Error("Text model required");
      if (!visionModel) throw new Error("Vision model required");
      await onApply({ model, visionModel });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setErr(null);
    try {
      await onApply({ model: null, visionModel: null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selectClass =
    "w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="mt-2 ml-6 pl-2 border-l border-border space-y-2">
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Text model</label>
        <select className={selectClass} value={textSel} onChange={(e) => setTextSel(e.target.value)}>
          {textOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
          <option value={CUSTOM_VALUE}>Other (custom)…</option>
        </select>
        {textSel === CUSTOM_VALUE && (
          <input
            type="text"
            value={textCustom}
            onChange={(e) => setTextCustom(e.target.value)}
            placeholder="model id (e.g. claude-opus-4-7)"
            className={`${selectClass} mt-1 font-mono`}
          />
        )}
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Vision model</label>
        <select className={selectClass} value={visionSel} onChange={(e) => setVisionSel(e.target.value)}>
          {visionOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
          <option value={CUSTOM_VALUE}>Other (custom)…</option>
        </select>
        {visionSel === CUSTOM_VALUE && (
          <input
            type="text"
            value={visionCustom}
            onChange={(e) => setVisionCustom(e.target.value)}
            placeholder="vision model id"
            className={`${selectClass} mt-1 font-mono`}
          />
        )}
      </div>

      {err && <div className="text-[10px] text-red-400">{err}</div>}

      <div className="flex gap-1.5">
        <button
          onClick={handleApply}
          disabled={busy}
          className="flex-1 text-[11px] py-1 px-2 rounded bg-primary/20 hover:bg-primary/30 text-primary font-medium transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Apply"}
        </button>
        {isOverridden && (
          <button
            onClick={handleReset}
            disabled={busy}
            className="text-[11px] py-1 px-2 rounded border border-border hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
            title="Revert to .env default"
          >
            Reset
          </button>
        )}
      </div>
      {isOverridden && (
        <div className="text-[10px] text-amber-400">
          Override active — Reset to use .env defaults.
        </div>
      )}
    </div>
  );
}

interface ApiKeyEditorProps {
  provider: ApiKeyProvider;
  status: SettingsSnapshot["apiKeys"][ApiKeyProvider] | undefined;
  onSave: (key: string | null) => Promise<void>;
}

function ApiKeyEditor({ provider, status, onSave }: ApiKeyEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setErr(null);
    try {
      await onSave(value.trim() || null);
      setValue("");
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setErr(null);
    try {
      await onSave(null);
      setValue("");
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = status?.source === "runtime"
    ? "set from UI"
    : status?.source === "env"
    ? "from .env"
    : "not set";
  const sourceColor = status?.source === "runtime"
    ? "text-amber-300/80"
    : status?.source === "env"
    ? "text-muted-foreground"
    : "text-red-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground">API key</label>
        <span className={`text-[10px] ${sourceColor}`}>{sourceLabel}</span>
      </div>
      {!editing ? (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1 truncate">
            {status?.masked ?? "—"}
          </code>
          <button
            onClick={() => { setEditing(true); setValue(""); }}
            className="text-[11px] py-1 px-2 rounded bg-primary/20 hover:bg-primary/30 text-primary font-medium transition-colors"
          >
            {status?.present ? "Change" : "Set"}
          </button>
          {status?.source === "runtime" && (
            <button
              onClick={handleClear}
              disabled={busy}
              className="text-[11px] py-1 px-2 rounded border border-border hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
              title="Clear runtime key (revert to .env value if any)"
            >
              Clear
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Paste ${provider} API key`}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <button
              onClick={() => setReveal((v) => !v)}
              className="text-[11px] py-1 px-2 rounded border border-border hover:bg-accent text-muted-foreground transition-colors"
              title={reveal ? "Hide" : "Show"}
            >
              {reveal ? "🙈" : "👁"}
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={busy || value.trim().length < 10}
              className="flex-1 text-[11px] py-1 px-2 rounded bg-primary/20 hover:bg-primary/30 text-primary font-medium transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(""); setErr(null); }}
              disabled={busy}
              className="text-[11px] py-1 px-2 rounded border border-border hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </div>
  );
}

interface AgentRouterCLIToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

function AgentRouterCLIToggle({ enabled, onToggle }: AgentRouterCLIToggleProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      await onToggle(!enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <div className="text-[10px] text-muted-foreground">CLI subprocess mode</div>
          <div className="text-[10px] text-muted-foreground/80">
            {enabled
              ? "ON — routes via local `claude` binary (text only, ~2s overhead)"
              : "OFF — direct HTTP calls fail; AgentRouter blocks non-CLI clients"}
          </div>
        </div>
        <button
          onClick={handleClick}
          disabled={busy}
          className={`shrink-0 text-[11px] py-1 px-2 rounded font-medium transition-colors disabled:opacity-50 ${
            enabled
              ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
              : "bg-muted/40 hover:bg-muted/60 text-muted-foreground"
          }`}
        >
          {busy ? "…" : (enabled ? "Disable CLI" : "Enable CLI")}
        </button>
      </div>
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </div>
  );
}

interface EntryRowProps {
  entry: ProviderChainEntry;
  isActive: boolean;
  isForced: boolean;
  manualMode: boolean;
  registry: ModelRegistry | null;
  overrides: ModelOverrides;
  settings: SettingsSnapshot | null;
  isEditing: boolean;
  onSelect: () => void;
  onToggleEdit: () => void;
  onApply: (patch: { model?: string | null; visionModel?: string | null }) => Promise<void>;
  onRecheck: () => Promise<void>;
  onSaveApiKey: (provider: ApiKeyProvider, key: string | null) => Promise<void>;
  onToggleAgentRouterCLI: (enabled: boolean) => Promise<void>;
}

function EntryRow({ entry, isActive, isForced, manualMode, registry, overrides, settings, isEditing, onSelect, onToggleEdit, onApply, onRecheck, onSaveApiKey, onToggleAgentRouterCLI }: EntryRowProps) {
  const isFailed = entry.status === "billing-failed";
  const models = registry?.[entry.id];
  const override = overrides[entry.id];
  const [rechecking, setRechecking] = useState(false);

  async function handleRecheck(e: React.MouseEvent) {
    e.stopPropagation();
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  }

  function handleRowClick() {
    if (manualMode) onSelect();
  }

  const indicator = manualMode
    ? (isForced ? "◉" : "○")
    : (isActive ? "●" : STATUS_ICONS[entry.status] ?? "○");
  const indicatorColor = manualMode
    ? (isForced ? "text-amber-400" : "text-muted-foreground")
    : (isActive ? "text-green-400" : isFailed ? "text-red-400" : "text-muted-foreground");

  return (
    <div
      className={`rounded ${isActive && !manualMode ? "bg-primary/10" : ""} ${isForced ? "ring-1 ring-amber-500/40 bg-amber-500/5" : ""} ${manualMode ? "cursor-pointer hover:bg-accent/40" : ""}`}
      onClick={handleRowClick}
      role={manualMode ? "button" : undefined}
      title={manualMode ? `Use ${entry.label} for the next request` : undefined}
    >
      <div className="flex items-center gap-2 py-1.5 px-2 text-xs">
        <span className={`text-sm ${indicatorColor}`}>{indicator}</span>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${isFailed ? "line-through text-muted-foreground" : ""}`}>
            {entry.label}
          </div>
          <div className="text-muted-foreground truncate">{entry.model}</div>
        </div>
        {entry.isClaudeModel && (
          <span className="shrink-0 text-[10px] bg-violet-500/20 text-violet-300 px-1 rounded">Claude</span>
        )}
        {entry.id === "agentrouter-claude" && entry.label.includes("(CLI)") && (
          <span
            className="shrink-0 text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded"
            title="Routing AgentRouter through local `claude` subprocess"
          >CLI</span>
        )}
        {isFailed && (
          <span className="shrink-0 text-[10px] bg-red-500/20 text-red-300 px-1 rounded">billing</span>
        )}
        {isFailed && (
          <button
            onClick={handleRecheck}
            disabled={rechecking}
            className="shrink-0 text-xs px-1.5 py-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Re-test this provider — clears billing mark if it succeeds"
          >
            {rechecking ? "…" : "↻"}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
          className="shrink-0 text-xs px-1.5 py-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={isEditing ? "Close model picker" : "Change model"}
        >
          {isEditing ? "✕" : "⚙"}
        </button>
      </div>
      {isEditing && (
        <div className="pb-2 px-2 space-y-3" onClick={(e) => e.stopPropagation()}>
          {models ? (
            <ModelPicker entry={entry} models={models} override={override} onApply={onApply} />
          ) : (
            <div className="text-[10px] text-muted-foreground italic ml-6">Loading models…</div>
          )}

          {/* API key editor — Ollama is local and doesn't need a key */}
          {(() => {
            const keyProvider = ENTRY_TO_KEY_PROVIDER[entry.id];
            if (!keyProvider) return null;
            return (
              <div className="ml-6 pl-2 border-l border-border">
                <ApiKeyEditor
                  provider={keyProvider}
                  status={settings?.apiKeys[keyProvider]}
                  onSave={(key) => onSaveApiKey(keyProvider, key)}
                />
              </div>
            );
          })()}

          {/* AgentRouter-only: CLI subprocess toggle */}
          {entry.id === "agentrouter-claude" && settings && (
            <div className="ml-6 pl-2 border-l border-border">
              <AgentRouterCLIToggle
                enabled={settings.agentrouter.useCLI}
                onToggle={onToggleAgentRouterCLI}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AIStatusBadge() {
  const { activeEntry, chain, setChain } = useSystemStore();
  const forceProviderId = useGenerationStore((s) => s.forceProviderId);
  const setForceProviderId = useGenerationStore((s) => s.setForceProviderId);
  const manualMode = forceProviderId !== null;
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [registry, setRegistry] = useState<ModelRegistry | null>(null);
  const [overrides, setOverrides] = useState<ModelOverrides>({});
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  async function fetchHealth() {
    try {
      const health = await checkHealth();
      const chainData = health.ai?.chain ?? [];
      setChain(chainData, health.ai?.activeEntry ?? null);
      setFetchError(chainData.length === 0);
    } catch {
      setFetchError(true);
    }
  }

  async function loadModels() {
    try {
      const m = await getModels();
      setRegistry(m.registry);
      setOverrides(m.overrides);
      setChain(m.chain, m.chain.find((c) => c.status === "ready") ?? null);
    } catch {
      // ignore — picker shows "Loading models…"
    }
  }

  async function loadSettings() {
    try {
      setSettings(await getSettings());
    } catch {
      // settings panel will render placeholders
    }
  }

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Lazy-load registry + settings when the popover first opens
  useEffect(() => {
    if (open && registry === null) loadModels();
    if (open && settings === null) loadSettings();
  }, [open, registry, settings]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function testAll() {
    setTesting(true);
    try {
      const res = await fetch("/api/test-ai");
      if (res.ok) await fetchHealth();
    } finally {
      setTesting(false);
    }
  }

  async function handleApplyOverride(entryId: string, patch: { model?: string | null; visionModel?: string | null }) {
    const result = await setEntryModels(entryId, patch);
    setRegistry(result.registry);
    setOverrides(result.overrides);
    setChain(result.chain, result.chain.find((c) => c.status === "ready") ?? null);
    // also refresh health so the badge reflects new active entry if applicable
    fetchHealth();
  }

  async function handleRecheckEntry(entryId: string) {
    try {
      await testEntry(entryId);
    } catch {
      // ignore — fetchHealth below will reflect the current state
    }
    await fetchHealth();
  }

  async function handleSaveApiKey(provider: ApiKeyProvider, key: string | null) {
    const next = await setApiKey(provider, key);
    setSettings(next);
    // Key change may make a previously-unconfigured provider ready → refresh chain
    await fetchHealth();
  }

  async function handleToggleAgentRouterCLI(enabled: boolean) {
    const next = await setAgentRouterCLI(enabled);
    setSettings(next);
    // Label flips between "AgentRouter → Claude" and "AgentRouter → Claude (CLI)"
    await fetchHealth();
  }

  function setManualMode(manual: boolean) {
    if (manual) {
      // Switching to manual: pre-select the current active entry (or first ready, or first)
      if (forceProviderId === null) {
        const initial =
          chain.find((c) => c.id === activeEntry?.id)?.id ??
          chain.find((c) => c.status === "ready")?.id ??
          chain[0]?.id ??
          null;
        setForceProviderId(initial);
      }
    } else {
      setForceProviderId(null);
    }
  }

  // In Manual mode the badge shows what WILL be used next, not what was used last.
  // In Auto mode the badge shows the last-run / first-ready provider as before.
  const forcedEntry = forceProviderId
    ? chain.find((c) => c.id === forceProviderId) ?? null
    : null;
  const displayEntry = forcedEntry ?? activeEntry;

  const dotColor = !displayEntry
    ? "bg-gray-400"
    : displayEntry.isClaudeModel
    ? "bg-green-400"
    : "bg-amber-400";

  const label = displayEntry?.label ?? "No AI";
  const modelShort = displayEntry?.model
    ? displayEntry.model.split("/").pop()?.replace(/:free$/, "") ?? displayEntry.model
    : "–";

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors"
        title={forcedEntry ? `Forced: ${forcedEntry.label} (${forcedEntry.model}) — no fallback` : "AI provider status"}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${displayEntry && !forcedEntry ? "animate-pulse" : ""}`} />
        <span className="font-medium max-w-[120px] truncate">{label}</span>
        <span className="text-[10px] opacity-60 max-w-[100px] truncate hidden sm:block">{modelShort}</span>
        {forcedEntry && (
          <span className="shrink-0 text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded">forced</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-xl z-50 p-2 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <div className="text-xs font-semibold text-muted-foreground">AI Priority Chain</div>
          </div>

          {/* Mode toggle: Auto (use fallback chain) vs Manual (user picks) */}
          <div className="flex gap-1 px-2 mb-2 p-0.5 bg-muted/40 rounded">
            <button
              onClick={() => setManualMode(false)}
              className={`flex-1 text-[11px] py-1 px-2 rounded transition-colors ${
                !manualMode
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Try providers in priority order with automatic fallback"
            >
              Auto
            </button>
            <button
              onClick={() => setManualMode(true)}
              className={`flex-1 text-[11px] py-1 px-2 rounded transition-colors ${
                manualMode
                  ? "bg-amber-500/20 text-amber-300 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Pick one provider — only that one is used, no fallback"
            >
              Manual
            </button>
          </div>

          {chain.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-2">
              {fetchError ? "Backend not reachable — restart the server" : "Loading…"}
            </div>
          ) : (
            <div className="space-y-0.5">
              {chain.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  isActive={entry.id === activeEntry?.id}
                  isForced={manualMode && entry.id === forceProviderId}
                  manualMode={manualMode}
                  registry={registry}
                  overrides={overrides}
                  settings={settings}
                  isEditing={editingId === entry.id}
                  onSelect={() => setForceProviderId(entry.id)}
                  onToggleEdit={() => setEditingId(editingId === entry.id ? null : entry.id)}
                  onApply={(patch) => handleApplyOverride(entry.id, patch)}
                  onRecheck={() => handleRecheckEntry(entry.id)}
                  onSaveApiKey={handleSaveApiKey}
                  onToggleAgentRouterCLI={handleToggleAgentRouterCLI}
                />
              ))}
            </div>
          )}

          <div className="border-t border-border mt-2 pt-2 px-1">
            <button
              onClick={testAll}
              disabled={testing}
              className="w-full text-xs py-1.5 px-3 rounded bg-primary/10 hover:bg-primary/20 text-primary font-medium transition-colors disabled:opacity-50"
            >
              {testing ? "Testing…" : "Test All Providers"}
            </button>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">
              {manualMode
                ? "Manual: click a row to pick that provider · ⚙ = change model"
                : "Auto: try in order, fall back on failure · ⚙ = change model"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
