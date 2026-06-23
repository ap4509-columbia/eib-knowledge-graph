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
import { getApiKey, setApiKey, clearApiKey } from "@/lib/settings";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [value, setValue] = useState("");
  const [savedHasKey, setSavedHasKey] = useState(false);

  // Read existing key when opened
  useEffect(() => {
    if (!open) return;
    const existing = getApiKey();
    setSavedHasKey(!!existing);
    setValue(existing ?? "");
  }, [open]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed) setApiKey(trimmed);
    else clearApiKey();
    onOpenChange(false);
  };

  const handleClear = () => {
    clearApiKey();
    setValue("");
    setSavedHasKey(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <KeyRound className="h-4 w-4 text-purple-400" />
            Connect AI
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            The chat uses Google Gemini under the hood. Paste your API key — it
            stays in your browser only and is sent to the backend on each
            request via the <code className="text-zinc-300">X-Gemini-Api-Key</code>{" "}
            header.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="text-xs text-zinc-300">
              Gemini API key
            </Label>
            <Input
              id="api-key"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="AIza…"
              className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs"
              autoComplete="off"
            />
          </div>

          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition"
          >
            <ExternalLink className="h-3 w-3" />
            Get a free key at aistudio.google.com
          </a>

          {savedHasKey && (
            <p className="text-[10px] text-emerald-400/80 font-mono">
              ✓ A key is currently saved in your browser.
            </p>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <button
            type="button"
            onClick={handleClear}
            disabled={!savedHasKey && !value}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white transition"
            >
              Save
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
