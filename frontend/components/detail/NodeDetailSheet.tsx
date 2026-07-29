"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ENTITY_COLORS } from "@/components/graphStyles";
import { formatPeriod } from "@/lib/months";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/lib/api/types";

export interface NodeDetailSheetProps {
  nodeId: string | null;
  snapshot: Snapshot | null;
  onClose: () => void;
}

export function NodeDetailSheet({
  nodeId,
  snapshot,
  onClose,
}: NodeDetailSheetProps) {
  const open = !!nodeId;

  const data = useMemo(() => {
    if (!snapshot || !nodeId) return null;
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const outgoing = snapshot.edges.filter((e) => e.source === nodeId);
    const incoming = snapshot.edges.filter((e) => e.target === nodeId);
    return { node, outgoing, incoming };
  }, [snapshot, nodeId]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <aside
      aria-hidden={!open}
      aria-label="Node details"
      className={cn(
        "fixed right-0 top-0 bottom-0 z-40 w-full sm:max-w-md",
        "border-l border-border bg-background text-foreground",
        "shadow-2xl shadow-black/30 dark:shadow-black/60",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      )}
    >
      {data ? (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{
                    backgroundColor:
                      ENTITY_COLORS[data.node.type] ?? "#71717a",
                  }}
                />
                <Badge
                  variant="secondary"
                  className="border border-border bg-muted font-mono text-[10px] text-muted-foreground"
                >
                  {data.node.type}
                </Badge>
              </div>
              <h2 className="break-words text-lg font-semibold leading-tight">
                {data.node.id}
              </h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {formatPeriod(snapshot)}  ·  degree {data.node.degree}  ·{" "}
                {data.outgoing.length} out / {data.incoming.length} in
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <ScrollArea className="flex-1">
            <div className="space-y-5 px-6 py-4 pb-12">
              {data.outgoing.length > 0 && (
                <section>
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Outgoing ({data.outgoing.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {data.outgoing.map((e) => (
                      <li
                        key={e.id}
                        className="text-xs leading-relaxed"
                      >
                        <span className="text-muted-foreground">→</span>{" "}
                        <span>{e.rel}</span>{" "}
                        <span className="text-muted-foreground">·</span>{" "}
                        <span className="break-words font-medium">
                          {e.target}
                        </span>
                        {e.weight > 1 && (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            ×{e.weight}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.outgoing.length > 0 && data.incoming.length > 0 && (
                <Separator />
              )}
              {data.incoming.length > 0 && (
                <section>
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Incoming ({data.incoming.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {data.incoming.map((e) => (
                      <li
                        key={e.id}
                        className="text-xs leading-relaxed"
                      >
                        <span className="text-muted-foreground">←</span>{" "}
                        <span className="break-words font-medium">
                          {e.source}
                        </span>{" "}
                        <span className="text-muted-foreground">·</span>{" "}
                        <span>{e.rel}</span>
                        {e.weight > 1 && (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            ×{e.weight}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.outgoing.length === 0 && data.incoming.length === 0 && (
                <p className="text-xs italic text-muted-foreground">
                  No relationships in this period.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </aside>
  );
}
