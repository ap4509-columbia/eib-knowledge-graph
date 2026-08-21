// MCP endpoint for the EIB Knowledge Graph — lets an analyst connect
// Claude (claude.ai custom connector, Claude Desktop, Claude Code) to the
// deployed corpus and interrogate the news behind what they see in the
// UI: the articles, the graph, the factor loadings, and the predictions.
//
// Implementation notes:
// - Streamable-HTTP MCP, stateless: every request is a self-contained
//   JSON-RPC 2.0 POST answered with a plain JSON body (the spec allows
//   JSON instead of an SSE stream, and stateless servers may omit
//   session ids). No SDK dependency, no session store.
// - Read-only by construction: tools only fetch the same public JSON
//   the frontend renders (/data/**), via this deployment's own origin —
//   so the connector always answers from exactly what the site shows.
// - No auth: the underlying data is already public.

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
};

// ---------------------------------------------------------------------------
// Data access — mirror of frontend/lib/api/client.ts, server-side.
// ---------------------------------------------------------------------------

async function loadJson<T>(origin: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${origin}/data/${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface SourceEntry {
  id: string;
  label: string;
  description?: string;
  kind: string;
  available: boolean;
  features?: string[];
}

interface Article {
  date: string;
  title: string;
  ticker: string;
  url: string;
  source: string;
  text: string;
}

async function loadMonths(origin: string, sourceId: string): Promise<string[]> {
  const idx = await loadJson<{ months?: string[] }>(
    origin,
    `sources/${sourceId}/index.json`
  );
  return idx?.months ?? [];
}

function monthsInRange(
  all: string[],
  from?: string,
  to?: string
): string[] {
  return all.filter((m) => (!from || m >= from) && (!to || m <= to));
}

async function loadArticles(
  origin: string,
  sourceId: string,
  months: string[]
): Promise<Article[]> {
  const batches = await Promise.all(
    months.map((m) =>
      loadJson<Article[]>(origin, `sources/${sourceId}/articles/${m}.json`)
    )
  );
  return batches.flatMap((b) => b ?? []);
}

function snippet(text: string, terms: string[], len = 400): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - 80);
  const s = text.slice(start, start + len);
  return (start > 0 ? "…" : "") + s + (start + len < text.length ? "…" : "");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
  run: (origin: string, args: Record<string, unknown>) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

const TOOLS: Record<string, ToolDef> = {
  list_sources: {
    description:
      "List the available corpora (data sources) in the EIB Knowledge Graph: " +
      "historical FNSPID runs and the live STOXX Europe 600 / S&P 100 corpora " +
      "refreshed daily by the qwen2.5:14b extraction → judge → refinement " +
      "pipeline. Start here to get valid source_id values.",
    inputSchema: { type: "object", properties: {} },
    run: async (origin) => {
      const file = await loadJson<{ sources: SourceEntry[]; default: string }>(
        origin,
        "sources.json"
      );
      if (!file) throw new Error("sources.json not reachable");
      return {
        default_source: file.default,
        sources: file.sources
          .filter((s) => s.available && s.kind !== "report")
          .map((s) => ({
            source_id: s.id,
            label: s.label,
            kind: s.kind,
            features: s.features ?? [],
            description: s.description ?? "",
          })),
      };
    },
  },

  get_timeline: {
    description:
      "Months of graph data available for a source, plus the dates of the " +
      "daily factor bundles (live sources only). Use these values for the " +
      "month/date arguments of the other tools.",
    inputSchema: {
      type: "object",
      properties: { source_id: str("Source id from list_sources") },
      required: ["source_id"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const months = await loadMonths(origin, sourceId);
      const fidx = await loadJson<{ dates?: string[] }>(
        origin,
        `sources/${sourceId}/factors/index.json`
      );
      return {
        graph_months: months,
        latest_month: months[months.length - 1] ?? null,
        factor_dates: fidx?.dates ?? [],
      };
    },
  },

  get_graph: {
    description:
      "One month's knowledge-graph snapshot: the most-connected entities and " +
      "the relationships among them, each edge carrying relation, weight " +
      "(article support), sentiment, event type and materiality (USD from " +
      "the story) where extracted.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source id from list_sources"),
        month: str("YYYY-MM month from get_timeline"),
        top_n: int("Max entities by connectivity (default 40, max 120)"),
      },
      required: ["source_id", "month"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const month = String(args.month);
      const topN = Math.min(120, Number(args.top_n) || 40);
      const snap = await loadJson<{
        nodes: { id: string; type: string; degree: number }[];
        edges: {
          source: string;
          target: string;
          rel: string;
          rel_cat?: string;
          weight?: number;
          sentiment?: number;
          materiality_usd?: number;
          event_type?: string;
        }[];
        stats?: unknown;
      }>(origin, `sources/${sourceId}/snapshots/${month}.json`);
      if (!snap) throw new Error(`No snapshot for ${sourceId} ${month}`);
      const nodes = [...snap.nodes]
        .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
        .slice(0, topN);
      const keep = new Set(nodes.map((n) => n.id));
      const edges = snap.edges
        .filter((e) => keep.has(e.source) && keep.has(e.target))
        .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
        .slice(0, 200)
        .map((e) => ({
          source: e.source,
          relation: e.rel,
          target: e.target,
          weight: e.weight ?? 1,
          sentiment: e.sentiment,
          event_type: e.event_type,
          materiality_usd: e.materiality_usd,
        }));
      return {
        month,
        total_entities: snap.nodes.length,
        total_relationships: snap.edges.length,
        shown_entities: nodes.map((n) => ({
          entity: n.id,
          type: n.type,
          connections: n.degree,
        })),
        relationships: edges,
      };
    },
  },

  search_news: {
    description:
      "Keyword search over the full text of the news articles behind the " +
      "graph. Returns headline, date, ticker, link and a snippet around the " +
      "first match. Use this to find the stories that drove an edge, a " +
      "factor move, or a prediction.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source id from list_sources"),
        query: str("Keywords, e.g. 'Novo Nordisk obesity drug'"),
        month_from: str("Optional YYYY-MM lower bound"),
        month_to: str("Optional YYYY-MM upper bound"),
        limit: int("Max results (default 10, max 25)"),
      },
      required: ["source_id", "query"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const terms = String(args.query)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const limit = Math.min(25, Number(args.limit) || 10);
      const all = await loadMonths(origin, sourceId);
      const months = monthsInRange(
        all,
        args.month_from ? String(args.month_from) : undefined,
        args.month_to ? String(args.month_to) : undefined
      );
      const articles = await loadArticles(origin, sourceId, months);
      const scored = articles
        .map((a) => {
          const title = a.title.toLowerCase();
          const text = (a.text ?? "").toLowerCase();
          let score = 0;
          for (const t of terms) {
            if (title.includes(t)) score += 3;
            if (text.includes(t)) score += 1;
          }
          return { a, score };
        })
        .filter((s) => s.score > 0)
        .sort((x, y) => y.score - x.score || (x.a.date < y.a.date ? 1 : -1))
        .slice(0, limit);
      return {
        months_searched: months,
        total_matches: scored.length,
        articles: scored.map(({ a }) => ({
          date: a.date,
          title: a.title,
          ticker: a.ticker || undefined,
          url: a.url,
          snippet: snippet(a.text ?? "", terms),
        })),
      };
    },
  },

  get_entity_news: {
    description:
      "All articles mentioning a specific entity (company, concept, " +
      "person…) by name — the primary way to answer 'what news is behind " +
      "this node?'. Matching is case-insensitive substring over headline " +
      "and body.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source id from list_sources"),
        entity: str("Entity name as shown in the graph, e.g. 'Novo Nordisk'"),
        month_from: str("Optional YYYY-MM lower bound"),
        month_to: str("Optional YYYY-MM upper bound"),
        limit: int("Max results (default 10, max 25)"),
      },
      required: ["source_id", "entity"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const needle = String(args.entity).toLowerCase();
      const limit = Math.min(25, Number(args.limit) || 10);
      const all = await loadMonths(origin, sourceId);
      const months = monthsInRange(
        all,
        args.month_from ? String(args.month_from) : undefined,
        args.month_to ? String(args.month_to) : undefined
      );
      const articles = await loadArticles(origin, sourceId, months);
      const hits = articles
        .filter(
          (a) =>
            a.title.toLowerCase().includes(needle) ||
            (a.text ?? "").toLowerCase().includes(needle)
        )
        .sort((x, y) => (x.date < y.date ? 1 : -1))
        .slice(0, limit);
      return {
        entity: args.entity,
        months_searched: months,
        total_matches: hits.length,
        articles: hits.map((a) => ({
          date: a.date,
          title: a.title,
          ticker: a.ticker || undefined,
          url: a.url,
          snippet: snippet(a.text ?? "", [needle]),
        })),
      };
    },
  },

  get_factors: {
    description:
      "A day's factor-model bundle for a live source: per-entity z-scores " +
      "on the five news factors (attention, sentiment, consensus, novelty, " +
      "materiality), PCA coordinates, and the KMeans archetype clusters " +
      "with their factor signatures.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source id from list_sources"),
        date: str("Optional YYYY-MM-DD from get_timeline; default latest"),
      },
      required: ["source_id"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const date = args.date ? String(args.date) : "latest";
      const f = await loadJson<{
        date: string;
        kept_factors: string[];
        entities: {
          name: string;
          type: string;
          cluster: number;
          factors: Record<string, number>;
        }[];
        pca: { explained_variance: number[] };
        kmeans: {
          k: number;
          clusters: {
            cluster: number;
            size: number;
            signature: { factor: string; loading: number }[];
            members: string[];
          }[];
        };
      }>(origin, `sources/${sourceId}/factors/${date}.json`);
      if (!f) throw new Error(`No factor bundle for ${sourceId} ${date}`);
      return {
        date: f.date,
        factors: f.kept_factors,
        pca_explained_variance: f.pca.explained_variance,
        entities: f.entities.map((e) => ({
          entity: e.name,
          type: e.type,
          cluster: e.cluster,
          z_scores: e.factors,
        })),
        clusters: f.kmeans.clusters.map((c) => ({
          cluster: c.cluster,
          size: c.size,
          signature: c.signature,
          members: c.members,
        })),
      };
    },
  },

  get_predictions: {
    description:
      "GAT link predictions for a source (if trained): per period, the " +
      "top-ranked entities and which entities the model expects them to " +
      "impact next, plus the model name and its MRR on held-out data.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: str("Source id from list_sources"),
        period: str("Optional YYYY-MM period; default the latest available"),
      },
      required: ["source_id"],
    },
    run: async (origin, args) => {
      const sourceId = String(args.source_id);
      const p = await loadJson<{
        model: string;
        strategy: string;
        mrr: number | string;
        periods: Record<
          string,
          {
            period: string;
            total_entities: number;
            entries: unknown[];
          }
        >;
      }>(origin, `sources/${sourceId}/predictions.json`);
      if (!p) throw new Error(`No predictions published for ${sourceId}`);
      const keys = Object.keys(p.periods).sort();
      const period = args.period ? String(args.period) : keys[keys.length - 1];
      const bundle = p.periods[period];
      if (!bundle)
        throw new Error(
          `No predictions for period ${period}; available: ${keys.join(", ")}`
        );
      return {
        model: p.model,
        mrr: p.mrr,
        available_periods: keys,
        period,
        total_entities: bundle.total_entities,
        entries: bundle.entries,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: CORS_HEADERS }
  );
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: CORS_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let msg: RpcRequest;
  try {
    msg = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  // Notifications get an empty 202 per streamable-HTTP transport rules.
  if (msg.method?.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (msg.method) {
    case "initialize":
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "eib-knowledge-graph",
          title: "EIB Knowledge Graph",
          version: "1.0.0",
        },
        instructions:
          "Read-only analyst access to the EIB Knowledge Graph corpora " +
          "(financial news → entities, relationships, factor loadings, GAT " +
          "predictions). Call list_sources first, then get_timeline for " +
          "valid months/dates. Live sources (STOXX Europe 600, S&P 100) " +
          "refresh every morning via a local-LLM pipeline.",
      });

    case "ping":
      return rpcResult(msg.id, {});

    case "tools/list":
      return rpcResult(msg.id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS[name];
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const out = await tool.run(request.nextUrl.origin, args);
        return rpcResult(msg.id, {
          content: [{ type: "text", text: JSON.stringify(out) }],
        });
      } catch (e) {
        return rpcResult(msg.id, {
          content: [
            {
              type: "text",
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// Stateless server: no SSE stream to resume, so GET declines politely.
export function GET() {
  return new Response("MCP endpoint — POST JSON-RPC here.", {
    status: 405,
    headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
