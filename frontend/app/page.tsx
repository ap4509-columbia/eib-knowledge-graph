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
import { mergeSnapshots } from "@/lib/mergeSnapshots";
import { formatMonthRange, monthsBetween } from "@/lib/months";
import { TimeSlider } from "@/components/controls/TimeSlider";
import { FilterRail } from "@/components/controls/FilterRail";
import { EntitySearch } from "@/components/controls/EntitySearch";
import { NodeDetailSheet } from "@/components/detail/NodeDetailSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GraphSettingsDialog } from "@/components/settings/GraphSettingsDialog";
import { DEFAULT_PHYSICS, type PhysicsSettings } from "@/components/GraphCanvas";
import { PredictionsView } from "@/components/PredictionsPanel";

type ActiveTab = "graph" | "predictions";

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
  // The timeline selects an inclusive month range. from === to is the
  // single-month case, which stays the default on load.
  const [monthFrom, setMonthFrom] = useState<string | null>(null);
  const [monthTo, setMonthTo] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotCacheRef = useRef<Map<string, Snapshot>>(new Map());
  // Bumped after a pipeline run so the range effect refetches even when the
  // selected range itself hasn't changed.
  const [reloadToken, setReloadToken] = useState(0);

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("graph");

  // Initial load: index → latest snapshot
  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idx = await fetchIndex();
      setIndex(idx);
      if (idx.latest) {
        // Default view: trailing 12 months ending at the latest available
        // month. Falls back to the corpus start if less than 12 months exist.
        const latestIdx = idx.months.indexOf(idx.latest);
        const fromIdx = Math.max(0, latestIdx - 11);
        setMonthFrom(idx.months[fromIdx] ?? idx.latest);
        setMonthTo(idx.latest);
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

  // Every month the current range covers, chronological.
  const selectedMonths = useMemo(
    () => monthsBetween(index?.months ?? [], monthFrom, monthTo),
    [index, monthFrom, monthTo]
  );
  // Primitive key so the fetch effect doesn't re-run on identical ranges.
  const rangeKey = selectedMonths.join(",");

  const isForecast = selectedMonths.some((m) => futureMonths.includes(m));

  // Fetch every month in the range (in parallel, cached per month) and fold
  // them into one graph. A one-month range short-circuits inside
  // mergeSnapshots and returns the runner's snapshot untouched.
  useEffect(() => {
    if (selectedMonths.length === 0) return;

    const cache = snapshotCacheRef.current;
    const missing = selectedMonths.filter((m) => !cache.has(m));

    const applyFromCache = () => {
      const snaps = selectedMonths
        .map((m) => cache.get(m))
        .filter((s): s is Snapshot => !!s);
      setSnapshot(mergeSnapshots(snaps));
    };

    if (missing.length === 0) {
      applyFromCache();
      // Clear loading explicitly: an in-flight fetch we just cancelled skips
      // its own finally, so without this the flag could stay stuck on.
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all(
      missing.map((m) =>
        fetchSnapshot(m).then((snap) => [m, snap] as const)
      )
    )
      .then((fetched) => {
        if (cancelled) return;
        for (const [m, snap] of fetched) cache.set(m, snap);
        applyFromCache();
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
    // selectedMonths is derived from rangeKey; listing both keeps lint happy
    // without re-running on an unchanged range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, reloadToken]);

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
      // Cache is empty; the bump makes the range effect refetch and re-merge
      // even if the selected range came back identical.
      setReloadToken((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [loadIndex]);

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
                ? `${formatMonthRange(monthFrom, monthTo)}${
                    selectedMonths.length > 1
                      ? `  (${selectedMonths.length} mo)`
                      : ""
                  }  ·  ${snapshot.stats.nodes} entities  ·  ${
                    snapshot.stats.edges
                  } relationships`
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

        {/* Safari-style tab strip. Tabs sit in a slightly recessed bar; the
            active one is filled with the content background and rounded on
            top corners so it reads as "attached" to the panel below. */}
        <div className="flex shrink-0 items-end gap-1 border-b border-border bg-muted/60 px-2 pt-2">
          {(
            [
              { id: "graph", label: "Knowledge graph" },
              { id: "predictions", label: "Predictions" },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={active}
                className={
                  "relative -mb-px rounded-t-md border px-4 py-2 text-xs font-medium transition " +
                  (active
                    ? "border-border border-b-background bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground")
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body: filter rail (graph tab only) | active tab content */}
        <div className="flex flex-1 overflow-hidden">
          {activeTab === "graph" && (
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
          )}

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
            {loading && !snapshot && !error && activeTab === "graph" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {activeTab === "graph" ? (
              <>
                <GraphCanvas
                  snapshot={snapshot}
                  filters={{ visibleTypes, visibleCategories, minDegree }}
                  focusedNodeId={focusedNodeId}
                  onNodeClick={handleNodeClick}
                  physics={physics}
                />
                {isForecast && (
                  <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-border bg-muted/80 px-3 py-1.5 text-[11px] text-foreground backdrop-blur-md">
                    <span className="font-mono uppercase tracking-wider">
                      Forecast · {formatMonthRange(monthFrom, monthTo)}
                    </span>
                    <span className="ml-2 opacity-70">model prediction</span>
                  </div>
                )}
              </>
            ) : (
              <PredictionsView monthTo={monthTo} />
            )}
          </main>
        </div>

        {/* Time slider — shared control for both tabs */}
        <TimeSlider
          months={actualMonths}
          futureMonths={futureMonths}
          monthFrom={monthFrom}
          monthTo={monthTo}
          onChange={(from, to) => {
            setMonthFrom(from);
            setMonthTo(to);
          }}
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
        monthFrom={monthFrom}
        monthTo={monthTo}
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
