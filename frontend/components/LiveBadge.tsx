"use client";

// Pulsing "Live" chip for corpora refreshed daily by the VM's AI
// pipeline. The date shown is the last factor-bundle date — i.e. the
// last morning the qwen extraction → judge → refine chain actually ran —
// not a client-side clock, so a stalled cron is visible at a glance.

import { useEffect, useState } from "react";

import { fetchFactorsIndex } from "@/lib/api/client";

export function LiveBadge({ sourceId }: { sourceId: string }) {
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLastRun(null);
    fetchFactorsIndex(sourceId)
      .then((dates) => {
        if (!cancelled && dates.length > 0)
          setLastRun(dates[dates.length - 1]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  return (
    <span
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
      title={`Refreshed every morning (07:30 UTC) by the AI pipeline on the team GPU VM — qwen2.5:14b extraction, judge and refinement LLMs${
        lastRun ? ` · last run ${lastRun}` : " · awaiting first run"
      }`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      Live
      {lastRun && (
        <span className="normal-case tracking-normal text-emerald-600/70 dark:text-emerald-400/70">
          {lastRun}
        </span>
      )}
    </span>
  );
}
