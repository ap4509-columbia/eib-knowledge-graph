"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";

import { fetchIndex, fetchSnapshot, runPipeline } from "@/lib/api/client";
import type { Index, Snapshot } from "@/lib/api/types";

const GraphCanvas = dynamic(
  () => import("@/components/GraphCanvas").then((m) => m.GraphCanvas),
  { ssr: false }
);

export default function Home() {
  const [index, setIndex] = useState<Index | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idx = await fetchIndex();
      setIndex(idx);
      if (idx.latest) {
        const snap = await fetchSnapshot(idx.latest);
        setSnapshot(snap);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await runPipeline();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [load]);

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight">
            EIB Knowledge Graph
          </h1>
          <p className="text-xs text-zinc-400 font-mono">
            {snapshot
              ? `${snapshot.month}  ·  ${snapshot.stats.nodes} entities  ·  ${snapshot.stats.edges} relationships`
              : loading
                ? "loading…"
                : "no data"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {index && (
            <span className="text-xs text-zinc-500 font-mono">
              {index.months.length} months available
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={running || loading}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {running ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="flex-1 relative">
        {error && (
          <div className="absolute inset-x-0 top-0 z-20 bg-red-950/90 border-b border-red-900 text-red-100 px-6 py-3 text-sm backdrop-blur">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
              <div>
                <div className="font-medium">Backend unreachable.</div>
                <div className="mt-1 text-red-300/80 text-xs">
                  Run{" "}
                  <code className="rounded bg-red-950 px-1 py-0.5 font-mono text-red-200">
                    uvicorn main:app --reload --port 8000
                  </code>{" "}
                  in <code>backend/</code>.
                </div>
                <div className="mt-1 text-red-400/60 text-[10px] font-mono">
                  {error}
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && !snapshot && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
          </div>
        )}

        <GraphCanvas snapshot={snapshot} />
      </main>

      <footer className="border-t border-zinc-800 px-6 py-2 text-[10px] text-zinc-600 font-mono shrink-0">
        IEOR 4737 · Sponsor: European Investment Bank · Summer 2026
      </footer>
    </div>
  );
}
