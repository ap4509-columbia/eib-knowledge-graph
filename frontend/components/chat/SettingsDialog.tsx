"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROVIDERS,
  type Provider,
  getProvider,
  setProvider as persistProvider,
  getModel,
  setModel as persistModel,
  getApiKey,
  setApiKey,
  clearApiKey,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState<string>("");
  const [keyValue, setKeyValue] = useState<string>("");

  // Load state when opened
  useEffect(() => {
    if (!open) return;
    const p = getProvider();
    setProvider(p);
    setModel(getModel(p));
    setKeyValue(getApiKey(p) ?? "");
  }, [open]);

  // When the user switches provider, swap the key field to that provider's saved key.
  function handleProviderChange(p: Provider) {
    setProvider(p);
    setModel(getModel(p));
    setKeyValue(getApiKey(p) ?? "");
  }

  function handleSave() {
    persistProvider(provider);
    persistModel(model);
    setApiKey(provider, keyValue);
    onOpenChange(false);
  }

  function handleClearCurrentKey() {
    clearApiKey(provider);
    setKeyValue("");
  }

  const providerInfo = PROVIDERS[provider];
  const savedHasKey = !!getApiKey(provider);
  const otherProvider: Provider = provider === "gemini" ? "openai" : "gemini";
  const otherHasKey = !!getApiKey(otherProvider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-purple-500 dark:text-purple-400" />
            Connect AI
          </DialogTitle>
          <DialogDescription>
            Choose a provider, a model, and paste your API key. Everything stays
            in your browser only and is sent to the backend on each request via
            HTTP headers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider segmented control */}
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-1 rounded-md border border-border bg-muted/50 p-1">
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
                const active = p === provider;
                const has = !!getApiKey(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleProviderChange(p)}
                    className={cn(
                      "flex-1 rounded px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {PROVIDERS[p].label}
                    {has && (
                      <span
                        className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                        aria-label="key configured"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="model-select" className="text-xs">
              Model
            </Label>
            <select
              id="model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition focus:ring-2 focus:ring-ring/50"
            >
              {providerInfo.models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                  {m.badge ? `  —  ${m.badge}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="text-xs">
              {providerInfo.label} API key
            </Label>
            <Input
              id="api-key"
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder={provider === "gemini" ? "AIza…" : "sk-…"}
              className="font-mono text-xs"
              autoComplete="off"
            />
            <a
              href={providerInfo.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-purple-600 transition hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
            >
              <ExternalLink className="h-3 w-3" />
              Get a key
            </a>
          </div>

          {savedHasKey && (
            <p className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400/80">
              ✓ {providerInfo.label} key saved in your browser.
            </p>
          )}
          {otherHasKey && (
            <p className="font-mono text-[10px] text-muted-foreground">
              · {PROVIDERS[otherProvider].label} key also saved (switch
              provider above to edit it).
            </p>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <button
            type="button"
            onClick={handleClearCurrentKey}
            disabled={!savedHasKey && !keyValue}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Clear this key
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-foreground transition hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
            >
              Save
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
