"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { PhysicsSettings } from "@/components/GraphCanvas";
import { DEFAULT_PHYSICS } from "@/components/GraphCanvas";
import { cn } from "@/lib/utils";

// Minimal switch — avoids pulling in another shadcn component just for one toggle.
function Toggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
        checked ? "bg-foreground" : "bg-muted-foreground/40"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export interface GraphSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  physics: PhysicsSettings;
  onPhysicsChange: (next: PhysicsSettings) => void;
}

export function GraphSettingsDialog({
  open,
  onOpenChange,
  physics,
  onPhysicsChange,
}: GraphSettingsDialogProps) {
  const [local, setLocal] = useState<PhysicsSettings>(physics);

  // Sync when the dialog is (re)opened so we always start from the live value
  useEffect(() => {
    if (open) setLocal(physics);
  }, [open, physics]);

  const update = (patch: Partial<PhysicsSettings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onPhysicsChange(next);
  };

  const reset = () => {
    setLocal(DEFAULT_PHYSICS);
    onPhysicsChange(DEFAULT_PHYSICS);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Graph settings</DialogTitle>
          <DialogDescription>
            By default the graph loads at a fixed, precomputed layout. Turn
            physics on if you want nodes to move around live.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Master toggle */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <div className="flex flex-col">
              <Label className="text-sm">Live physics</Label>
              <span className="text-[11px] text-muted-foreground">
                When off, nodes stay put. When on, they respond to the sliders below.
              </span>
            </div>
            <Toggle
              checked={local.enabled}
              onCheckedChange={(checked) => update({ enabled: checked })}
            />
          </div>

          {/* Sliders (disabled when physics off) */}
          <div
            className={
              local.enabled
                ? "space-y-4"
                : "space-y-4 opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="repulsion" className="text-xs">
                  Node repulsion
                </Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {local.repulsion}
                </span>
              </div>
              <Slider
                id="repulsion"
                min={20}
                max={400}
                step={10}
                value={[local.repulsion]}
                onValueChange={(v) => {
                  const n = Array.isArray(v) ? v[0] : v;
                  if (typeof n === "number") update({ repulsion: n });
                }}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                Higher = nodes push each other apart more. Spreads dense clusters.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="linkStrength" className="text-xs">
                  Edge/link strength
                </Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {local.linkStrength}
                </span>
              </div>
              <Slider
                id="linkStrength"
                min={20}
                max={200}
                step={5}
                value={[local.linkStrength]}
                onValueChange={(v) => {
                  const n = Array.isArray(v) ? v[0] : v;
                  if (typeof n === "number") update({ linkStrength: n });
                }}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                Higher = connected nodes sit farther apart. Loosens tight bundles.
              </p>
            </div>
          </div>

          {/* Analyst MCP connector — the URL is the whole setup: public
              read-only data, so no password, token, or OAuth exists. */}
          <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <Label className="text-sm">Ask Claude about this data (MCP)</Label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Add this URL as a custom connector in Claude
              (Settings&nbsp;→&nbsp;Connectors) and ask about the news
              behind any node, factor, or prediction. URL only — no
              password or key; the connector is read-only over this
              site&apos;s public data.
            </p>
            <code className="block select-all break-all rounded bg-background px-2 py-1 font-mono text-[11px] text-foreground">
              https://eib-knowledge-graph.vercel.app/api/mcp
            </code>
            <a
              href="https://github.com/ap4509-columbia/eib-knowledge-graph/blob/main/docs/MCP_CONNECTOR.md"
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-[11px] text-foreground underline underline-offset-2 hover:text-muted-foreground"
            >
              docs/MCP_CONNECTOR.md
            </a>
          </div>

          {/* Ops & handover — read-only pointers, not editable settings.
              The site is static and public, so credentials can never be
              entered here; this section tells a successor where each
              account binding lives instead. */}
          <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <Label className="text-sm">Ops &amp; handover</Label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              This system runs on swappable account bindings and needs no
              API keys in production (all LLM stages run on a local
              model). The runbook has two tiers: a light one for
              maintaining the site and the live corpora, and a full one
              for rerunning the pipeline at scale:
            </p>
            <a
              href="https://github.com/ap4509-columbia/eib-knowledge-graph/blob/main/docs/HANDOVER.md"
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-[11px] text-foreground underline underline-offset-2 hover:text-muted-foreground"
            >
              docs/HANDOVER.md
            </a>
            <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
              Analysts can also connect Claude directly to this corpus: add
              the URL below as a custom connector (claude.ai → Settings →
              Connectors). Public read-only — no key, no password.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground">
                https://eib-knowledge-graph.vercel.app/api/mcp
              </code>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    "https://eib-knowledge-graph.vercel.app/api/mcp"
                  )
                }
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
