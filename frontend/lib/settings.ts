// Browser-side settings stored in localStorage.
// Supports multiple LLM providers (Gemini, OpenAI). Keys are stored separately
// per provider so switching providers doesn't wipe the other's key.

export type Provider = "gemini" | "openai";

export interface ModelOption {
  value: string;
  label: string;
  badge?: string;
}

export const PROVIDERS: Record<
  Provider,
  { label: string; keyUrl: string; models: ModelOption[] }
> = {
  gemini: {
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", badge: "free tier" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", badge: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", badge: "best" },
    ],
  },
  openai: {
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { value: "gpt-4o-mini", label: "GPT-4o mini", badge: "cheap" },
      { value: "gpt-4o", label: "GPT-4o", badge: "best" },
    ],
  },
};

const STORAGE = {
  provider: "eib_kg_llm_provider",
  model: "eib_kg_llm_model",
  key: (p: Provider) => `eib_kg_${p}_key`,
};

function lsGet(k: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(k);
}
function lsSet(k: string, v: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(k, v);
}
function lsDel(k: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(k);
}

export function getProvider(): Provider {
  const v = lsGet(STORAGE.provider);
  return v === "openai" ? "openai" : "gemini";
}

export function setProvider(p: Provider): void {
  lsSet(STORAGE.provider, p);
}

export function getModel(provider: Provider = getProvider()): string {
  const saved = lsGet(STORAGE.model);
  const models = PROVIDERS[provider].models;
  // If the saved model belongs to the current provider, use it; otherwise default.
  if (saved && models.some((m) => m.value === saved)) return saved;
  return models[0].value;
}

export function setModel(m: string): void {
  lsSet(STORAGE.model, m);
}

export function getApiKey(provider: Provider = getProvider()): string | null {
  return lsGet(STORAGE.key(provider));
}

export function setApiKey(provider: Provider, key: string): void {
  if (key.trim()) lsSet(STORAGE.key(provider), key.trim());
  else lsDel(STORAGE.key(provider));
}

export function clearApiKey(provider: Provider): void {
  lsDel(STORAGE.key(provider));
}
