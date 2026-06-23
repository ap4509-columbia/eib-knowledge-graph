"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ENTITY_COLORS } from "@/components/graphStyles";
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
        "bg-zinc-950 border-l border-zinc-800 text-zinc-100",
        "shadow-2xl shadow-black/50",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      )}
    >
      {data ? (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-zinc-900">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{
                    backgroundColor:
                      ENTITY_COLORS[data.node.type] ?? "#71717a",
                  }}
                />
                <Badge
                  variant="secondary"
                  className="font-mono text-[10px] bg-zinc-900 text-zinc-300 border border-zinc-800"
                >
                  {data.node.type}
                </Badge>
              </div>
              <h2 className="text-lg font-semibold leading-tight break-words">
                {data.node.id}
              </h2>
              <p className="mt-1 text-xs text-zinc-400 font-mono">
                {snapshot?.month}  ·  degree {data.node.degree}  ·{" "}
                {data.outgoing.length} out / {data.incoming.length} in
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <ScrollArea className="flex-1">
            <div className="px-6 py-4 space-y-5 pb-12">
              {data.outgoing.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-2">
                    Outgoing ({data.outgoing.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {data.outgoing.map((e) => (
                      <li
                        key={e.id}
                        className="text-xs leading-relaxed text-zinc-300"
                      >
                        <span className="text-zinc-500">→</span>{" "}
                        <span className="text-zinc-200">{e.rel}</span>{" "}
                        <span className="text-zinc-600">·</span>{" "}
                        <span className="font-medium text-zinc-100 break-words">
                          {e.target}
                        </span>
                        {e.weight > 1 && (
                          <span className="ml-1 text-[10px] text-zinc-500 font-mono">
                            ×{e.weight}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.outgoing.length > 0 && data.incoming.length > 0 && (
                <Separator className="bg-zinc-900" />
              )}
              {data.incoming.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-2">
                    Incoming ({data.incoming.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {data.incoming.map((e) => (
                      <li
                        key={e.id}
                        className="text-xs leading-relaxed text-zinc-300"
                      >
                        <span className="text-zinc-500">←</span>{" "}
                        <span className="font-medium text-zinc-100 break-words">
                          {e.source}
                        </span>{" "}
                        <span className="text-zinc-600">·</span>{" "}
                        <span className="text-zinc-200">{e.rel}</span>
                        {e.weight > 1 && (
                          <span className="ml-1 text-[10px] text-zinc-500 font-mono">
                            ×{e.weight}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.outgoing.length === 0 && data.incoming.length === 0 && (
                <p className="text-xs text-zinc-500 italic">
                  No relationships in this month.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </aside>
  );
}
