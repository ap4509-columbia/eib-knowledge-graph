# Analyst MCP connector

The deployed app exposes an MCP (Model Context Protocol) endpoint so an
analyst can connect Claude directly to the knowledge graph and
interrogate the news behind what the UI shows — in natural language,
with Claude calling the corpus as a tool.

```
https://eib-knowledge-graph.vercel.app/api/mcp
```

Read-only, no authentication (the underlying data is already public),
stateless streamable HTTP. The endpoint serves the exact same JSON the
frontend renders, so answers always match the site.

## Connecting

- **claude.ai** (web/desktop): Settings → Connectors → *Add custom
  connector* → paste the URL above.
- **Claude Code**:

  ```bash
  claude mcp add --transport http eib-kg https://eib-knowledge-graph.vercel.app/api/mcp
  ```

## Tools

| Tool | What it answers |
| --- | --- |
| `list_sources` | Which corpora exist (live STOXX Europe 600 / S&P 100, historical FNSPID runs) |
| `get_timeline` | Months of graph data + daily factor-bundle dates for a source |
| `get_graph` | A month's entities and relationships (weight, sentiment, event type, materiality) |
| `search_news` | Keyword search over the full article text behind the graph |
| `get_entity_news` | Every article mentioning a given entity — "what news is behind this node?" |
| `get_factors` | A day's factor z-scores (attention, sentiment, consensus, novelty, materiality) + archetype clusters |
| `get_predictions` | GAT link predictions per period, with model + MRR |

## Example analyst prompts

- "Why is Novo Nordisk in the attention+ cluster this week? Show me the
  articles."
- "Compare Shell's news sentiment in July vs August."
- "Does the news actually support the top-ranked prediction for August?"
- "Which S&P 100 tech names had the most negative coverage this month?"

## Implementation

`frontend/app/api/mcp/route.ts` — a dependency-free JSON-RPC 2.0 route
handler (initialize / tools/list / tools/call), deployed with every push
like the rest of the app. Tools fetch `/data/**` from the deployment's
own origin, so no database and no extra infrastructure are involved.
