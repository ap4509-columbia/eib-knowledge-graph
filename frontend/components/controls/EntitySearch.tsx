"use client";

import { useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ENTITY_COLORS } from "@/components/graphStyles";
import type { Snapshot } from "@/lib/api/types";

export interface EntitySearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot | null;
  onSelect: (entityId: string) => void;
}

export function EntitySearch({
  open,
  onOpenChange,
  snapshot,
  onSelect,
}: EntitySearchProps) {
  // Sort entities by degree descending so the most relevant show first.
  const entities = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.nodes].sort((a, b) => b.degree - a.degree).slice(0, 500);
  }, [snapshot]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search entities"
      description="Type a name or ticker to jump to that entity in the graph"
    >
      <CommandInput placeholder="Search entities (e.g. NVDA, TSMC, Inflation)…" />
      <CommandList>
        <CommandEmpty>No entities found in this month.</CommandEmpty>
        <CommandGroup heading={snapshot ? `${snapshot.month}` : ""}>
          {entities.map((n) => {
            const color = ENTITY_COLORS[n.type] ?? "#71717a";
            return (
              <CommandItem
                key={n.id}
                value={n.id}
                onSelect={() => {
                  onSelect(n.id);
                  onOpenChange(false);
                }}
                className="flex items-center gap-2"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="flex-1 truncate">{n.id}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {n.type}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                  ×{n.degree}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
