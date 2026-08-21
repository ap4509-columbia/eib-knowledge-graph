"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Search as SearchIcon,
  Settings as SettingsIcon,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  fetchIndex,
  fetchSnapshot,
  fetchSources,
  runPipeline,
  HAS_BACKEND,
} from "@/lib/api/client";
import type { Index, Snapshot, SourcesFile } from "@/lib/api/types";
import { mergeSnapshots } from "@/lib/mergeSnapshots";
import { formatMonthRange, monthsBetween } from "@/lib/months";
import {
  getDefaultCheckedSectors,
  getSectorOrder,
  inferNodeSectors,
  SECTOR_SOURCE_IDS,
} from "@/lib/sectors";
import { LiveBadge } from "@/components/LiveBadge";
import { TimeSlider } from "@/components/controls/TimeSlider";
import { FilterRail } from "@/components/controls/FilterRail";
import { EntitySearch } from "@/components/controls/EntitySearch";
import { NodeDetailSheet } from "@/components/detail/NodeDetailSheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GraphSettingsDialog } from "@/components/settings/GraphSettingsDialog";
import { DEFAULT_PHYSICS, type PhysicsSettings } from "@/components/GraphCanvas";
import { PredictionsView } from "@/components/PredictionsPanel";
import { FactorAnalysisView } from "@/components/FactorAnalysisPanel";

type ActiveTab = "graph" | "predictions" | "factors" | "report";

const GraphCanvas = dynamic(
  () => import("@/components/GraphCanvas").then((m) => m.GraphCanvas),
  { ssr: false }
);

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Types that start UNCHECKED in the entity-type filter on a fresh source
// load. The extractor emits a lot of generic "Stock Price"/"IPO Price"/etc.
// entities tagged FININSTRUMENTINFO — they're rarely useful to an analyst
// on first look, so we ship them hidden by default. Toggleable via the rail.
const DEFAULT_HIDDEN_TYPES = new Set(["FININSTRUMENTINFO", "FIN_INSTRUMENT_INFO"]);

const ACTIVE_SOURCE_STORAGE_KEY = "eibkg.activeSource";

export default function Home() {
  // Data
  const [sources, setSources] = useState<SourcesFile | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
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
  // Industry filter (sources listed in SECTOR_SOURCE_IDS only). Sectors are
  // inferred per connected cluster from the watchlist companies mentioned
  // in it — see lib/sectors.ts.
  const [visibleSectors, setVisibleSectors] = useState<Set<string>>(new Set());
  const knownSectorsRef = useRef<Set<string>>(new Set());
  // Min-degree threshold expressed as a percentage of the current month's max
  // degree. Stays meaningful across months even though absolute degree ranges
  // change wildly (March 2020 has 5× the activity of January 2019).
  const [minDegreePct, setMinDegreePct] = useState(5);
  // Auto-tighten the min-degree threshold when the graph is huge (STOXX 600
  // months routinely exceed 1,000 nodes). Small graphs → 5% (default);
  // 500-node graphs → 8%; 1,000+ → 12%. User can override in the rail.
  // Only auto-adjusts before the user has touched the slider themselves.
  const userAdjustedDegreeRef = useRef(false);
  const handleMinDegreePctChange = useCallback((pct: number) => {
    userAdjustedDegreeRef.current = true;
    setMinDegreePct(pct);
  }, []);
  useEffect(() => {
    if (userAdjustedDegreeRef.current || !snapshot) return;
    const n = snapshot.nodes.length;
    if (n <= 200) {
      setMinDegreePct(5);
      return;
    }
    // Pick the threshold that keeps roughly the top ~300 most-connected
    // nodes. A fixed percentage of the max degree breaks on heavy-tailed
    // corpora — one 800-connection hub pushes 12% to a bar only the hub
    // itself clears, rendering a single lonely node.
    const degrees = snapshot.nodes
      .map((nd) => nd.degree)
      .sort((a, b) => b - a);
    const maxDeg = Math.max(1, degrees[0] ?? 1);
    let cutoff = degrees[Math.min(degrees.length - 1, 299)] ?? 1;
    // Long-tail corpora tie hundreds of nodes at the 300th node's degree;
    // bump the threshold one step so the default view stays readable.
    if (degrees.filter((d) => d >= cutoff).length > 450) cutoff += 1;
    const pct = Math.max(1, Math.min(20, Math.ceil((cutoff / maxDeg) * 100)));
    setMinDegreePct(pct);
  }, [snapshot]);

  // Interaction state
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Phone-width filter drawer (the rail is inline from md up).
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // Types / causal-types the app has ever encountered under the current
  // source. New types get added to the visible set with default rules;
  // types the user has explicitly toggled off are NOT re-added on later
  // snapshots, so switching months / tabs won't reset their choices.
  const knownTypesRef = useRef<Set<string>>(new Set());
  const knownCategoriesRef = useRef<Set<string>>(new Set());
  const filtersInitializedRef = useRef(false);
  // Which source the current `index` (and monthFrom/monthTo) belong to.
  // During a source switch there's a commit where activeSourceId is already
  // the new source but index/months are still the old one's — the snapshot
  // fetch effect must not fire in that window (it would request the old
  // months against the new source's path, 404, and drop the view).
  const indexSourceRef = useRef<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("graph");

  // Bootstrap: load the sources catalogue, pick either the last-used source
  // (from localStorage) or the catalogue default, then load that source's
  // index.
  useEffect(() => {
    let cancelled = false;
    fetchSources().then((s) => {
      if (cancelled) return;
      setSources(s);
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_SOURCE_STORAGE_KEY)
          : null;
      const initial =
        (stored && s.sources.find((x) => x.id === stored && x.available)?.id) ||
        s.default;
      setActiveSourceId(initial);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadIndex = useCallback(
    async (sourceId: string) => {
      setLoading(true);
      setError(null);
      try {
        const idx = await fetchIndex(sourceId);
        indexSourceRef.current = sourceId;
        setIndex(idx);
        if (idx.latest) {
          // Default view: trailing quarter (3 months) ending at the latest
          // available month. Falls back to corpus start if fewer exist.
          const latestIdx = idx.months.indexOf(idx.latest);
          const fromIdx = Math.max(0, latestIdx - 2);
          setMonthFrom(idx.months[fromIdx] ?? idx.latest);
          setMonthTo(idx.latest);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Reload index when the active source changes. Also reset per-source
  // caches so we don't merge snapshots across corpora.
  useEffect(() => {
    if (!activeSourceId) return;
    snapshotCacheRef.current.clear();
    knownTypesRef.current = new Set();
    knownCategoriesRef.current = new Set();
    filtersInitializedRef.current = false;
    setVisibleTypes(new Set());
    setVisibleCategories(new Set());
    knownSectorsRef.current = new Set();
    setVisibleSectors(new Set());
    // Drop the old corpus's index/snapshot immediately — otherwise the
    // snapshot-fetch effect fires once with the old months against the new
    // source's path and 404s before loadIndex swaps the months in. The ref
    // closes the same window synchronously (state updates land a render
    // later; effects in THIS commit still see the old index).
    indexSourceRef.current = null;
    setIndex(null);
    setSnapshot(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_SOURCE_STORAGE_KEY, activeSourceId);
    }
    // The report pseudo-source has no index/snapshots — it renders a PDF.
    if (activeSourceId === "report") {
      setLoading(false);
      return;
    }
    loadIndex(activeSourceId);
  }, [activeSourceId, loadIndex]);

  // If the user switches sources while on a tab that the new source doesn't
  // support (e.g. Factor Analysis → historical source), fall back to
  // Knowledge graph instead of rendering a blank pane.
  useEffect(() => {
    if (!sources) return;
    const currentSource = sources.sources.find((s) => s.id === activeSourceId);
    const features = new Set(currentSource?.features ?? ["graph"]);
    if (!features.has(activeTab)) {
      setActiveTab(
        features.has("graph")
          ? "graph"
          : features.has("predictions")
            ? "predictions"
            : features.has("factors")
              ? "factors"
              : features.has("report")
                ? "report"
                : "graph"
      );
    }
  }, [sources, activeSourceId, activeTab]);

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
    // Stale-window guard: only fetch when the loaded index actually belongs
    // to the active source (see indexSourceRef).
    if (!activeSourceId || indexSourceRef.current !== activeSourceId) return;

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

    if (!activeSourceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      missing.map((m) =>
        fetchSnapshot(activeSourceId, m).then((snap) => [m, snap] as const)
      )
    )
      .then((fetched) => {
        if (cancelled) return;
        for (const [m, snap] of fetched) cache.set(m, snap);
        applyFromCache();
        setError(null);
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
  }, [rangeKey, reloadToken, activeSourceId]);

  // Filter-set maintenance.
  // Rule 1: on first snapshot after a source load, default-check every type
  //   EXCEPT the DEFAULT_HIDDEN_TYPES set (currently: financial instrument).
  //   Default-check every causal category.
  // Rule 2: on later snapshots, add ONLY never-before-seen types to the
  //   visible set (also using the default-hidden rule). Types the user
  //   explicitly toggled off stay off — no reset on tab change or timeline
  //   scrub.
  useEffect(() => {
    if (!snapshot) return;

    const newTypes: string[] = [];
    for (const n of snapshot.nodes) {
      if (!knownTypesRef.current.has(n.type)) newTypes.push(n.type);
    }
    const newCats: string[] = [];
    for (const e of snapshot.edges) {
      const c = e.causal_type ?? "OTHER";
      if (!knownCategoriesRef.current.has(c)) newCats.push(c);
    }
    if (
      filtersInitializedRef.current &&
      newTypes.length === 0 &&
      newCats.length === 0
    ) {
      return;
    }

    for (const t of newTypes) knownTypesRef.current.add(t);
    for (const c of newCats) knownCategoriesRef.current.add(c);

    setVisibleTypes((prev) => {
      const next = new Set(prev);
      for (const t of newTypes) {
        if (!DEFAULT_HIDDEN_TYPES.has(t)) next.add(t);
      }
      return next.size === prev.size ? prev : next;
    });
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      for (const c of newCats) next.add(c);
      return next.size === prev.size ? prev : next;
    });
    filtersInitializedRef.current = true;
  }, [snapshot]);

  // Industry inference — only for sources that have a watchlist-backed
  // sector map. nodeSectors: node id → sector for the current merged
  // snapshot; null hides the Industry filter entirely.
  const nodeSectors = useMemo(() => {
    if (!snapshot || !activeSourceId || !SECTOR_SOURCE_IDS.has(activeSourceId))
      return null;
    return inferNodeSectors(snapshot, activeSourceId);
  }, [snapshot, activeSourceId]);

  const sectorCounts = useMemo(() => {
    if (!nodeSectors) return null;
    const counts = new Map<string, number>();
    for (const sector of nodeSectors.values()) {
      counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }
    // Stable per-source order; drop sectors absent from this view.
    return getSectorOrder(activeSourceId ?? "").filter((s) => counts.has(s)).map(
      (s) => [s, counts.get(s) as number] as const
    );
  }, [nodeSectors, activeSourceId]);

  // Same maintenance rule as types, but only the source's default sectors
  // start checked — the rest ship unchecked so the first view is one
  // industry, not the whole swarm. The user's later checks/unchecks stay
  // put across timeline scrubs.
  useEffect(() => {
    if (!nodeSectors || !activeSourceId) return;
    const defaults = getDefaultCheckedSectors(activeSourceId);
    const fresh: string[] = [];
    for (const sector of new Set(nodeSectors.values())) {
      if (!knownSectorsRef.current.has(sector)) fresh.push(sector);
    }
    if (fresh.length === 0) return;
    for (const s of fresh) knownSectorsRef.current.add(s);
    setVisibleSectors((prev) => {
      const next = new Set(prev);
      for (const s of fresh) {
        if (defaults.has(s)) next.add(s);
      }
      return next;
    });
  }, [nodeSectors, activeSourceId]);

  const handleToggleSector = useCallback((sector: string) => {
    setVisibleSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  }, []);

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
    if (!activeSourceId) return;
    setRunning(true);
    setError(null);
    try {
      await runPipeline();
      snapshotCacheRef.current.clear();
      await loadIndex(activeSourceId);
      // Cache is empty; the bump makes the range effect refetch and re-merge
      // even if the selected range came back identical.
      setReloadToken((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [loadIndex, activeSourceId]);

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
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="whitespace-nowrap text-sm font-semibold tracking-tight sm:text-base">
              EIB Knowledge Graph
            </h1>
            <p className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
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
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 sm:w-auto sm:flex-nowrap">
            {sources &&
              activeSourceId &&
              sources.sources.find((s) => s.id === activeSourceId)?.kind ===
                "live" && <LiveBadge sourceId={activeSourceId} />}
            {sources && (
              <label className="flex min-w-[8.5rem] flex-1 items-center gap-1.5 text-xs text-muted-foreground sm:min-w-0 sm:flex-initial">
                <span className="hidden sm:inline">Data source</span>
                <select
                  className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground transition hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring sm:w-auto"
                  value={activeSourceId ?? sources.default}
                  onChange={(e) => setActiveSourceId(e.target.value)}
                >
                  {/* Unavailable sources are hidden outright (not grayed):
                      retiring a source is a one-flag change in
                      sources.json — set "available": false. */}
                  {sources.sources
                    .filter((s) => s.available)
                    .map((s) => (
                      <option key={s.id} value={s.id} title={s.description}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {index && (
              <span className="mr-2 hidden font-mono text-xs text-muted-foreground md:inline">
                {index.months.length} months
              </span>
            )}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            >
              <SearchIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
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

        {/* Safari-style tab strip. Only tabs the current source supports
            are rendered — no grey placeholders. Right-side tools shown per
            active tab (KG gets a merged/single toggle). */}
        <div className="flex shrink-0 items-end gap-1 border-b border-border bg-muted/60 px-2 pt-2">
          {(() => {
            const currentSource = sources?.sources.find(
              (s) => s.id === activeSourceId
            );
            const features = new Set(currentSource?.features ?? ["graph"]);
            return [
              { id: "graph" as const, label: "Knowledge graph" },
              { id: "predictions" as const, label: "Predictions" },
              { id: "factors" as const, label: "Factor analysis" },
              { id: "report" as const, label: "Report" },
            ].filter((t) => features.has(t.id));
          })().map((tab) => {
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
          {(activeTab === "graph" || activeTab === "predictions") && (
            <button
              type="button"
              onClick={() => setMobileRailOpen(true)}
              className="ml-auto mb-1 flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground md:hidden"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </button>
          )}
        </div>

        {/* Body: filter rail | active tab content.
            Filter rail shows on the graph + predictions tabs — its
            entity-type toggles drive the graph AND the predictions
            leaderboard. It's hidden on Factor analysis: that tab renders
            the whole precomputed bundle and none of the rail's controls
            apply to it. */}
        <div className="flex flex-1 overflow-hidden">
          {activeTab !== "factors" &&
            activeTab !== "report" &&
            (() => {
              const rail = (
                <FilterRail
                  snapshot={snapshot}
                  visibleTypes={visibleTypes}
                  visibleCategories={visibleCategories}
                  minDegreePct={minDegreePct}
                  minDegree={minDegree}
                  maxDegree={maxDegree}
                  onToggleType={handleToggleType}
                  onToggleCategory={handleToggleCategory}
                  onMinDegreePctChange={handleMinDegreePctChange}
                  sectors={sectorCounts}
                  visibleSectors={visibleSectors}
                  onToggleSector={handleToggleSector}
                />
              );
              return (
                <>
                  {/* Desktop: inline column. Phone: slide-over drawer
                      behind the Filters button in the tab strip. */}
                  <div className="hidden md:contents">{rail}</div>
                  {mobileRailOpen && (
                    <div className="fixed inset-0 z-40 md:hidden">
                      <div
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setMobileRailOpen(false)}
                      />
                      <div className="absolute inset-y-0 left-0 flex max-w-[85vw] flex-col bg-background shadow-xl">
                        <div className="flex items-center justify-end border-b border-border px-2 py-1">
                          <button
                            type="button"
                            aria-label="Close filters"
                            onClick={() => setMobileRailOpen(false)}
                            className="rounded-md p-2 text-muted-foreground transition hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden [&>aside]:h-full [&>aside]:border-r-0">
                          {rail}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

          <main className="relative flex-1 overflow-hidden">
            {error && (
              <div className="absolute inset-x-0 top-0 z-20 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-sm backdrop-blur">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="text-destructive">
                    <div className="font-medium">
                      Couldn&apos;t load data for this view.
                    </div>
                    <div className="mt-1 text-xs opacity-80">
                      Try reloading the page or switching data source.
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
                  filters={{
                    visibleTypes,
                    visibleCategories,
                    minDegree,
                    sectorOf: nodeSectors,
                    visibleSectors: nodeSectors ? visibleSectors : null,
                  }}
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
            ) : activeTab === "predictions" ? (
              activeSourceId && (
                <PredictionsView
                  sourceId={activeSourceId}
                  monthTo={monthTo}
                  visibleTypes={visibleTypes}
                />
              )
            ) : activeTab === "factors" ? (
              activeSourceId && (
                <FactorAnalysisView sourceId={activeSourceId} />
              )
            ) : activeTab === "report" ? (
              // Browser-native PDF viewer over the compiled project report,
              // with an escape hatch for browsers that won't inline PDFs.
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2 font-mono text-[10px] text-muted-foreground">
                  <span>
                    LLM and Graphs for Financial Texts — full project report
                  </span>
                  <a
                    href="/report.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border px-2 py-0.5 transition hover:text-foreground"
                  >
                    Open in new tab ↗
                  </a>
                </div>
                <iframe
                  src="/report.pdf"
                  title="EIB Knowledge Graph — full project report"
                  className="min-h-0 w-full flex-1 border-0"
                />
              </div>
            ) : null}
          </main>
        </div>

        {/* Time slider — shared by the graph + predictions tabs. On the
            Predictions tab we overlay a training-vs-prediction band so
            it's clear which months fed the GAT vs which month is being
            visualized (trainingWindow mirrors the WINDOW_SIZE in the
            rolling-window GAT trainer, backend/eib-eval components/
            gat.py). Hidden on Factor analysis: the factor bundle is
            always the latest rolling window, so the timeline would be a
            dead control there. */}
        {activeTab !== "factors" && activeTab !== "report" && (
          <TimeSlider
            months={actualMonths}
            futureMonths={futureMonths}
            monthFrom={monthFrom}
            monthTo={monthTo}
            onChange={(from, to) => {
              setMonthFrom(from);
              setMonthTo(to);
            }}
            predictionsContext={
              activeTab === "predictions" && monthTo
                ? { predictionMonth: monthTo, trainingWindow: 3 }
                : undefined
            }
            endNote={(() => {
              const src = sources?.sources.find((s) => s.id === activeSourceId);
              return src?.end_note && src?.end_note_month
                ? { text: src.end_note, month: src.end_note_month }
                : undefined;
            })()}
          />
        )}

        <footer className="shrink-0 truncate border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground sm:px-6">
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
        sourceId={activeSourceId ?? ""}
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

      {/* Find articles button intentionally disabled for now — the chat
          panel is still available via ⌘K if we want to re-enable it later. */}
    </>
  );
}
