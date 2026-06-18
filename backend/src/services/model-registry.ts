/**
 * Curated list of known-good model IDs per FallbackEntry.id.
 * The frontend uses this to populate the model-picker dropdowns.
 * Users can also type any custom ID via the "Other (custom)…" option.
 *
 * Model IDs are the raw strings each provider's API expects — same format the chain uses today.
 */

export interface ModelOption {
  id: string;
  label: string;
}

export interface EntryModels {
  text: ModelOption[];
  vision: ModelOption[];
}

// Claude family — multimodal, same list for text + vision.
const CLAUDE_MODELS: ModelOption[] = [
  { id: "claude-opus-4-7",                label: "Claude Opus 4.7 (most capable)" },
  { id: "claude-sonnet-4-6",              label: "Claude Sonnet 4.6 (latest balanced)" },
  { id: "claude-sonnet-4-5-20250514",     label: "Claude Sonnet 4.5 (May 2025)" },
  { id: "claude-haiku-4-5-20251001",      label: "Claude Haiku 4.5 (fast & cheap)" },
  { id: "claude-sonnet-4-20250514",       label: "Claude Sonnet 4 (legacy)" },
];

// OpenRouter prefixes Claude IDs with `anthropic/`.
const OPENROUTER_CLAUDE_MODELS: ModelOption[] = [
  { id: "anthropic/claude-opus-4-7",     label: "Claude Opus 4.7" },
  { id: "anthropic/claude-sonnet-4-6",   label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-sonnet-4-5",   label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4-5",    label: "Claude Haiku 4.5" },
];

// AgentRouter recommended IDs per https://docs.agentrouter.org/en/start.html
const AGENTROUTER_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-5-20250929",  label: "Claude Sonnet 4.5 (Sep 2025 — default)" },
  { id: "claude-sonnet-4-5-20250514",  label: "Claude Sonnet 4.5 (May 2025)" },
  { id: "claude-haiku-4-5-20251001",   label: "Claude Haiku 4.5 (fast)" },
  { id: "claude-3-5-haiku-20241022",   label: "Claude 3.5 Haiku (legacy fast)" },
];

export const MODEL_REGISTRY: Record<string, EntryModels> = {
  anthropic: {
    text:   CLAUDE_MODELS,
    vision: CLAUDE_MODELS,
  },

  "openrouter-claude": {
    text:   OPENROUTER_CLAUDE_MODELS,
    vision: OPENROUTER_CLAUDE_MODELS,
  },

  "agentrouter-claude": {
    text:   AGENTROUTER_MODELS,
    vision: AGENTROUTER_MODELS,
  },

  "openrouter-free": {
    text: [
      { id: "openai/gpt-oss-120b:free",                  label: "GPT-OSS 120B (free)" },
      { id: "meta-llama/llama-3.1-405b-instruct:free",   label: "Llama 3.1 405B Instruct (free)" },
      { id: "google/gemini-2.0-flash-exp:free",          label: "Gemini 2.0 Flash exp (free)" },
      { id: "qwen/qwen-2.5-coder-32b-instruct:free",     label: "Qwen 2.5 Coder 32B (free)" },
    ],
    vision: [
      { id: "nvidia/nemotron-nano-12b-v2-vl:free",       label: "Nemotron Nano 12B Vision (free)" },
      { id: "meta-llama/llama-3.2-11b-vision-instruct:free", label: "Llama 3.2 11B Vision (free)" },
      { id: "google/gemini-2.0-flash-exp:free",          label: "Gemini 2.0 Flash exp (free, vision)" },
    ],
  },

  groq: {
    text: [
      { id: "llama-3.3-70b-versatile",                       label: "Llama 3.3 70B (versatile)" },
      { id: "llama-3.1-8b-instant",                          label: "Llama 3.1 8B (instant)" },
      { id: "mixtral-8x7b-32768",                            label: "Mixtral 8x7B (32k ctx)" },
      { id: "deepseek-r1-distill-llama-70b",                 label: "DeepSeek R1 Distill 70B" },
    ],
    vision: [
      { id: "meta-llama/llama-4-scout-17b-16e-instruct",     label: "Llama 4 Scout 17B (vision)" },
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick 17B (vision)" },
    ],
  },

  ollama: {
    text: [
      { id: "qwen2.5-coder",     label: "Qwen 2.5 Coder" },
      { id: "llama3.2",          label: "Llama 3.2" },
      { id: "llama3.1",          label: "Llama 3.1" },
      { id: "codellama",         label: "CodeLlama" },
      { id: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
    ],
    vision: [
      { id: "llava",        label: "LLaVA" },
      { id: "llava-llama3", label: "LLaVA Llama 3" },
      { id: "bakllava",     label: "BakLLaVA" },
    ],
  },
};
