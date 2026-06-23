// Browser-side settings stored in localStorage.
// Currently just the Gemini API key; centralized here so we can extend later.

const KEY = "eib_kg_gemini_key";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setApiKey(value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, value);
}

export function clearApiKey(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
