"use client";

// Status chip for corpora refreshed daily by the VM's AI pipeline. The
// date shown is the last factor-bundle date — i.e. the last morning the
// qwen extraction → judge → refine chain actually ran — not a
// client-side clock, so a stalled or retired cron is visible at a
// glance. When the last run is more than STALE_AFTER_DAYS old the chip
// flips from a pulsing emerald "Live" to an amber "Paused": the corpus
// is still fully browsable, it just stopped growing.

import { useEffect, useState } from "react";

import { fetchFactorsIndex } from "@/lib/api/client";

const STALE_AFTER_DAYS = 3;

export function useLastRun(sourceId: string) {
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

  const stale =
    lastRun != null &&
    Date.now() - new Date(`${lastRun}T12:00:00Z`).getTime() >
      STALE_AFTER_DAYS * 24 * 3600 * 1000;

  return { lastRun, stale };
}

export function LiveBadge({ sourceId }: { sourceId: string }) {
  const { lastRun, stale } = useLastRun(sourceId);

  if (stale) {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
        title={`Daily refresh paused — last pipeline run ${lastRun}. The corpus is fully browsable; it has just stopped growing. See the maintenance note on this page for how to resume it.`}
      >
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        Paused
        {lastRun && (
          <span className="normal-case tracking-normal text-amber-700/70 dark:text-amber-400/70">
            {lastRun}
          </span>
        )}
      </span>
    );
  }

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

/** Amber strip shown on live sources once the daily refresh has stopped:
 *  says what happened and exactly what a future maintainer needs (and
 *  pays) to bring it back. Dismissable per browser session only, so it
 *  reappears on the next visit as long as the feed stays stale. */
export function MaintenanceNotice({ sourceId }: { sourceId: string }) {
  const { lastRun, stale } = useLastRun(sourceId);
  const [dismissed, setDismissed] = useState(false);

  if (!stale || dismissed) return null;

  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300 sm:px-6 short:hidden">
      <span className="mt-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <p className="min-w-0">
        <span className="font-medium">
          Daily updates paused since {lastRun}.
        </span>{" "}
        This corpus refreshed itself every morning from a GPU VM at zero
        API cost (local Qwen runs the whole extract → judge → refine
        chain); the course VM that hosted it has been retired. Everything
        here stays browsable — to resume growth, a maintainer needs any
        machine with a GPU running the daily pipeline (roughly an hour of
        compute per day, no API keys) plus this site&rsquo;s free
        hosting.{" "}
        <a
          href="https://github.com/ap4509-columbia/eib-knowledge-graph/blob/main/docs/HANDOVER.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
        >
          Handover guide ↗
        </a>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="ml-auto shrink-0 rounded p-0.5 transition hover:bg-amber-500/20"
      >
        ×
      </button>
    </div>
  );
}
