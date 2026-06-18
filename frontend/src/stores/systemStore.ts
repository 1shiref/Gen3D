import { create } from "zustand";
import type { ProviderChainEntry } from "@/lib/api";

export interface ActiveProviderInfo {
  id: string;
  label: string;
  model: string;
  isClaudeModel: boolean;
}

interface SystemStore {
  activeEntry: ActiveProviderInfo | null;
  chain: ProviderChainEntry[];
  lastHealthCheck: number | null;

  setActiveEntry: (entry: ActiveProviderInfo) => void;
  setChain: (chain: ProviderChainEntry[], active: ActiveProviderInfo | null) => void;
}

export const useSystemStore = create<SystemStore>((set) => ({
  activeEntry: null,
  chain: [],
  lastHealthCheck: null,

  setActiveEntry: (entry) => set({ activeEntry: entry }),

  setChain: (chain, active) =>
    set({ chain, activeEntry: active, lastHealthCheck: Date.now() }),
}));
