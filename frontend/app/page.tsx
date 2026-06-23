"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Search as SearchIcon,
  Sparkles,
} from "lucide-react";

import { fetchIndex, fetchSnapshot, runPipeline } from "@/lib/api/client";
import type { Index, Snapshot } from "@/lib/api/types";
import { TimeSlider } from "@/components/controls/TimeSlider";
import { FilterRail } from "@/components/controls/FilterRail";
import { EntitySearch } from "@/components/controls/EntitySearch";
import { NodeDetailSheet } from "@/components/detail/NodeDetailSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";

const GraphCanvas = dynamic(
  () => import("@/components/GraphCanvas").then((m) => m.GraphCanvas),
  { ssr: false }
);

export default function Home() {
  // Data
  const [index, setIndex] = useState<Index | null>(null);
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotCacheRef = useRef<Map<string, Snapshot>>(new Map());

  // Filter state
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(
    new Set()
  );
  const [minDegree, setMinDegree] = useState(2);

  // Interaction state
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const filtersInitializedRef = useRef(false);

  // UI state
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: index → latest snapshot
  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idx = await fetchIndex();
      setIndex(idx);
      if (idx.latest) {
        setCurrentMonth(idx.latest);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  // Fetch snapshot whenever currentMonth changes
  useEffect(() => {
    if (!currentMonth) return;
    const cached = snapshotCacheRef.current.get(currentMonth);
    if (cached) {
      setSnapshot(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSnapshot(currentMonth)
      .then((snap) => {
        if (cancelled) return;
        snapshotCacheRef.current.set(currentMonth, snap);
        setSnapshot(snap);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  // Initialize filter sets once on the first snapshot (so they include all types).
  useEffect(() => {
    if (!snapshot || filtersInitializedRef.current) return;
    const types = new Set(snapshot.nodes.map((n) => n.type));
    const cats = new Set(snapshot.edges.map((e) => e.rel_cat));
    setVisibleTypes(types);
    setVisibleCategories(cats);
    filtersInitializedRef.current = true;
  }, [snapshot]);

  // Add any new types/cats from later months so they're visible by default
  useEffect(() => {
    if (!snapshot || !filtersInitializedRef.current) return;
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      for (const n of snapshot.nodes) next.add(n.type);
      return next.size === prev.size ? prev : next;
    });
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      for (const e of snapshot.edges) next.add(e.rel_cat);
      return next.size === prev.size ? prev : next;
    });
  }, [snapshot]);

  // ⌘K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await runPipeline();
      snapshotCacheRef.current.clear();
      await loadIndex();
      // Re-fetch current month if it survived
      if (currentMonth) {
        const snap = await fetchSnapshot(currentMonth);
        snapshotCacheRef.current.set(currentMonth, snap);
        setSnapshot(snap);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [currentMonth, loadIndex]);

  const handleToggleType = useCallback((type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleToggleCategory = useCallback((cat: string) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback((id: string) => {
    setFocusedNodeId(id || null);
  }, []);

  return (
    <>
      <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        {/* Header */}
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
          <div className="flex items-center gap-2">
            {index && (
              <span className="text-xs text-zinc-500 font-mono mr-2">
                {index.months.length} months available
              </span>
            )}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800 hover:border-zinc-700 transition"
            >
              <SearchIcon className="h-3.5 w-3.5" />
              Search
              <kbd className="ml-1 hidden sm:inline-block rounded border border-zinc-700 bg-zinc-950 px-1.5 font-mono text-[10px] text-zinc-400">
                ⌘K
              </kbd>
            </button>
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

        {/* Body: filter rail | graph */}
        <div className="flex flex-1 overflow-hidden">
          <FilterRail
            snapshot={snapshot}
            visibleTypes={visibleTypes}
            visibleCategories={visibleCategories}
            minDegree={minDegree}
            onToggleType={handleToggleType}
            onToggleCategory={handleToggleCategory}
            onMinDegreeChange={setMinDegree}
          />

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
            <GraphCanvas
              snapshot={snapshot}
              filters={{ visibleTypes, visibleCategories, minDegree }}
              focusedNodeId={focusedNodeId}
              onNodeClick={handleNodeClick}
            />
          </main>
        </div>

        {/* Time slider */}
        <TimeSlider
          months={index?.months ?? []}
          currentMonth={currentMonth}
          onChange={setCurrentMonth}
        />

        <footer className="border-t border-zinc-800 px-6 py-2 text-[10px] text-zinc-600 font-mono shrink-0">
          IEOR 4737 · Sponsor: European Investment Bank · Summer 2026
        </footer>
      </div>

      <EntitySearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        snapshot={snapshot}
        onSelect={(id) => setFocusedNodeId(id)}
      />
      <NodeDetailSheet
        nodeId={focusedNodeId}
        snapshot={snapshot}
        onClose={() => setFocusedNodeId(null)}
      />
      <ChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        month={currentMonth}
        focusedEntity={focusedNodeId}
      />

      {/* Floating chat trigger — clearly AI-branded */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Ask AI about the knowledge graph"
          className="group fixed bottom-24 right-6 z-30 flex items-center gap-2 rounded-full border border-purple-500/40 bg-gradient-to-r from-purple-600/30 via-fuchsia-600/25 to-blue-600/30 px-4 py-2.5 text-sm font-medium text-zinc-100 shadow-lg shadow-purple-500/30 backdrop-blur-xl transition hover:from-purple-600/40 hover:via-fuchsia-600/35 hover:to-blue-600/40 hover:shadow-purple-500/40"
        >
          <Sparkles className="h-4 w-4 text-purple-300 transition group-hover:text-purple-200" />
          <span className="bg-gradient-to-r from-purple-200 via-fuchsia-200 to-blue-200 bg-clip-text text-transparent font-semibold">
            Ask AI
          </span>
        </button>
      )}
    </>
  );
}
