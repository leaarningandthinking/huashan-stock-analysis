"use client";

import { create } from "zustand";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type LLMConfig,
  type ProviderConfig,
  type ProviderId,
} from "@/lib/llm-config";

interface LLMStore {
  config: LLMConfig;
  hydrated: boolean;
  hydrate: () => void;
  setProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  removeProvider: (id: ProviderId) => void;
}

export const useLLMStore = create<LLMStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ config: loadConfig(), hydrated: true });
  },
  setProvider: (id, patch) => {
    const current = get().config.providers[id] ?? {
      apiKey: "",
      baseUrl: "",
      defaultModel: "",
      enabled: false,
      lastTestedAt: 0,
    };
    const next: LLMConfig = {
      ...get().config,
      providers: {
        ...get().config.providers,
        [id]: { ...current, ...patch },
      },
    };
    saveConfig(next);
    set({ config: next });
  },
  removeProvider: (id) => {
    const providers = { ...get().config.providers };
    delete providers[id];
    const next: LLMConfig = { ...get().config, providers };
    saveConfig(next);
    set({ config: next });
  },
}));
