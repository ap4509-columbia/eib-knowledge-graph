"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Search as SearchIcon,
  FileSearch,
  Settings as SettingsIcon,
} from "lucide-react";

import {
  fetchIndex,
  fetchSnapshot,
  runPipeline,
  HAS_BACKEND,
} from "@/lib/api/client";
import type { Index, Snapshot } from "@/lib/api/types";
import { TimeSlider } from "@/components/controls/TimeSlider";
import { FilterRail } from "@/components/controls/FilterRail";
import { EntitySearch } from "@/components/controls/EntitySearch";
import { NodeDetailSheet } from "@/components/detail/NodeDetailSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GraphSettingsDialog } from "@/components/settings/GraphSettingsDialog";
import { DEFAULT_PHYSICS, type PhysicsSettings } from "@/components/GraphCanvas";

const GraphCanvas = dynamic(
  () => import("@/components/GraphCanvas").then((m) => m.GraphCanvas),
  { ssr: false }
);

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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
  // Min-degree threshold expressed as a percentage of the current month's max
  // degree. Stays meaningful across months even though absolute degree ranges
  // change wildly (March 2020 has 5× the activity of January 2019).
  const [minDegreePct, setMinDegreePct] = useState(5);

  // Interaction state
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
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

  // Split the backend-provided months into past vs forecast based on today.
  // If the backend doesn't return any months past today, the forecast zone
  // simply doesn't exist and the slider stops at the latest actual month.
  const { actualMonths, futureMonths } = useMemo(() => {
    const all = index?.months ?? [];
    const today = currentMonthYYYYMM();
    return {
      actualMonths: all.filter((m) => m <= today),
      futureMonths: all.filter((m) => m > today),
    };
  }, [index]);

  const isForecast = !!currentMonth && futureMonths.includes(currentMonth);

  // Fetch snapshot whenever currentMonth changes.
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

  // Initialize filter sets once on the first snapshot.
  // Category filter now keys on causal_type (edge meaning), not on rel_cat.
  useEffect(() => {
    if (!snapshot || filtersInitializedRef.current) return;
    const types = new Set(snapshot.nodes.map((n) => n.type));
    const cats = new Set(snapshot.edges.map((e) => e.causal_type ?? "OTHER"));
    setVisibleTypes(types);
    setVisibleCategories(cats);
    filtersInitializedRef.current = true;
  }, [snapshot]);

  // Add any new types/causal-types from later months so they're visible by default
  useEffect(() => {
    if (!snapshot || !filtersInitializedRef.current) return;
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      for (const n of snapshot.nodes) next.add(n.type);
      return next.size === prev.size ? prev : next;
    });
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      for (const e of snapshot.edges) next.add(e.causal_type ?? "OTHER");
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

  // Derive the current snapshot's max degree, then the absolute threshold.
  const maxDegree = (snapshot?.nodes ?? []).reduce(
    (acc, n) => (n.degree > acc ? n.degree : acc),
    1
  );
  const minDegree = Math.max(1, Math.round((minDegreePct / 100) * maxDegree));

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold tracking-tight">
              EIB Knowledge Graph
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              {snapshot
                ? `${snapshot.month}  ·  ${snapshot.stats.nodes} entities  ·  ${snapshot.stats.edges} relationships`
                : loading
                  ? "loading…"
                  : "no data"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {index && (
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                {index.months.length} months available
              </span>
            )}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            >
              <SearchIcon className="h-3.5 w-3.5" />
              Search
              <kbd className="ml-1 hidden rounded border border-border bg-background px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                ⌘K
              </kbd>
            </button>
            {/* Refresh button only appears when a backend is wired in
                (NEXT_PUBLIC_API_BASE_URL set). The static Vercel build
                hides it since /api/run has no destination there. */}
            {HAS_BACKEND && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={running || loading}
                className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {running ? "Refreshing…" : "Refresh"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Graph settings"
              title="Graph settings (physics)"
              className="flex items-center justify-center rounded-md border border-border bg-muted p-1.5 text-foreground transition hover:bg-accent"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* Body: filter rail | graph */}
        <div className="flex flex-1 overflow-hidden">
          <FilterRail
            snapshot={snapshot}
            visibleTypes={visibleTypes}
            visibleCategories={visibleCategories}
            minDegreePct={minDegreePct}
            minDegree={minDegree}
            maxDegree={maxDegree}
            onToggleType={handleToggleType}
            onToggleCategory={handleToggleCategory}
            onMinDegreePctChange={setMinDegreePct}
          />

          <main className="relative flex-1">
            {error && (
              <div className="absolute inset-x-0 top-0 z-20 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-sm backdrop-blur">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="text-destructive">
                    <div className="font-medium">Backend unreachable.</div>
                    <div className="mt-1 text-xs opacity-80">
                      Run{" "}
                      <code className="rounded bg-destructive/20 px-1 py-0.5 font-mono">
                        uvicorn main:app --reload --port 8000
                      </code>{" "}
                      in <code>backend/</code>.
                    </div>
                    <div className="mt-1 font-mono text-[10px] opacity-60">
                      {error}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {loading && !snapshot && !error && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <GraphCanvas
              snapshot={snapshot}
              filters={{ visibleTypes, visibleCategories, minDegree }}
              focusedNodeId={focusedNodeId}
              onNodeClick={handleNodeClick}
              physics={physics}
            />
            {isForecast && (
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-[11px] text-purple-700 backdrop-blur-md dark:text-purple-200">
                <span className="font-mono uppercase tracking-wider">
                  Forecast · {currentMonth}
                </span>
                <span className="ml-2 opacity-70">model prediction</span>
              </div>
            )}
          </main>
        </div>

        {/* Time slider */}
        <TimeSlider
          months={actualMonths}
          futureMonths={futureMonths}
          currentMonth={currentMonth}
          onChange={setCurrentMonth}
        />

        <footer className="shrink-0 border-t border-border px-6 py-2 font-mono text-[10px] text-muted-foreground">
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
        months={index?.months ?? []}
        month={currentMonth}
        focusedEntity={focusedNodeId}
      />
      <GraphSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        physics={physics}
        onPhysicsChange={setPhysics}
      />

      {/* Floating article-search trigger */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Find articles in the source data"
          className="fixed bottom-40 right-6 z-30 flex items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg backdrop-blur-xl transition hover:bg-accent"
        >
          <FileSearch className="h-4 w-4 text-purple-500 dark:text-purple-400" />
          <span>Find articles</span>
        </button>
      )}
    </>
  );
}
