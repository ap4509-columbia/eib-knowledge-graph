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
