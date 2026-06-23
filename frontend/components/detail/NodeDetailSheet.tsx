"use client";

import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ENTITY_COLORS } from "@/components/graphStyles";
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
  const data = useMemo(() => {
    if (!snapshot || !nodeId) return null;
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const outgoing = snapshot.edges.filter((e) => e.source === nodeId);
    const incoming = snapshot.edges.filter((e) => e.target === nodeId);
    return { node, outgoing, incoming };
  }, [snapshot, nodeId]);

  return (
    <Sheet open={!!nodeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-zinc-950 border-zinc-800 text-zinc-100"
      >
        <SheetHeader>
          {data ? (
            <>
              <div className="flex items-center gap-2 mb-1">
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
              <SheetTitle className="text-zinc-100 text-lg break-words leading-tight">
                {data.node.id}
              </SheetTitle>
              <SheetDescription className="text-zinc-400 text-xs font-mono">
                {snapshot?.month}  ·  degree {data.node.degree}  ·{" "}
                {data.outgoing.length} out / {data.incoming.length} in
              </SheetDescription>
            </>
          ) : (
            <SheetTitle>—</SheetTitle>
          )}
        </SheetHeader>

        {data && (
          <ScrollArea className="h-[calc(100vh-180px)] mt-4 -mx-6 px-6">
            <div className="space-y-4 pb-12">
              {data.outgoing.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-2">
                    Outgoing ({data.outgoing.length})
                  </h3>
                  <ul className="space-y-1">
                    {data.outgoing.map((e) => (
                      <li
                        key={e.id}
                        className="text-xs leading-relaxed text-zinc-300"
                      >
                        <span className="text-zinc-500">→</span>{" "}
                        <span className="text-zinc-200">{e.rel}</span>{" "}
                        <span className="text-zinc-500">·</span>{" "}
                        <span className="font-medium text-zinc-100">
                          {e.target}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.incoming.length > 0 && (
                <>
                  <Separator className="bg-zinc-800" />
                  <section>
                    <h3 className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-2">
                      Incoming ({data.incoming.length})
                    </h3>
                    <ul className="space-y-1">
                      {data.incoming.map((e) => (
                        <li
                          key={e.id}
                          className="text-xs leading-relaxed text-zinc-300"
                        >
                          <span className="text-zinc-500">←</span>{" "}
                          <span className="font-medium text-zinc-100">
                            {e.source}
                          </span>{" "}
                          <span className="text-zinc-500">·</span>{" "}
                          <span className="text-zinc-200">{e.rel}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
