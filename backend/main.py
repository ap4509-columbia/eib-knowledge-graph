"""
EIB Knowledge Graph backend.

Three endpoints (per the plan):
    GET  /api/index              — which months are available
    GET  /api/snapshot/{month}   — the actual graph data for that month
    POST /api/run                — trigger the runner; returns when done

Run with:
    uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from runner import get_index, get_snapshot, run as runner_run
from chat import (
    chat as chat_fn,
    ChatNotConfigured,
    ChatRateLimited,
    retrieve_articles,
)

app = FastAPI(title="EIB Knowledge Graph backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Public read-only API — allow any origin. The Vercel preview URL changes
    # per deploy, so a strict allowlist would mean editing this on every push.
    allow_origin_regex=r"https?://(localhost(:\d+)?|.*\.vercel\.app|.*\.ngrok-free\.(app|dev))",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"ok": True, "service": "eib-knowledge-graph-backend"}


@app.get("/api/health")
def health():
    return {"status": "healthy"}


# ── Real endpoints ─────────────────────────────────────────────────────


@app.get("/api/index")
def index():
    """Manifest of available months."""
    return get_index()


@app.get("/api/snapshot/{month}")
def snapshot(month: str):
    """Graph data for a specific month."""
    snap = get_snapshot(month)
    if snap is None:
        raise HTTPException(status_code=404, detail=f"No snapshot for month {month}")
    return snap


@app.post("/api/run")
def run():
    """Re-run the runner against the source CSV. Returns the new index + timing."""
    try:
        return runner_run()
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))


class ChatRequest(BaseModel):
    query: str
    # Legacy single-month context (kept for backward compatibility).
    month: Optional[str] = None
    # Preferred: range. If only one end is set, treat it as an open bound.
    month_from: Optional[str] = None
    month_to: Optional[str] = None
    focused_entity: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    month: Optional[str] = None
    month_from: Optional[str] = None
    month_to: Optional[str] = None
    focused_entity: Optional[str] = None
    limit: int = 20


@app.post("/api/search")
def search_endpoint(req: SearchRequest):
    """Pure article retrieval. Keyword search over titles + summaries, filtered
    by month range and focused entity. Returns matching articles with their
    source URLs — no LLM, no summaries, no commentary.
    """
    month_from = req.month_from or req.month
    month_to = req.month_to or req.month
    articles = retrieve_articles(
        query=req.query,
        month_from=month_from,
        month_to=month_to,
        focused_entity=req.focused_entity,
        max_articles=max(1, min(req.limit, 50)),
    )
    results = []
    for _, row in articles.iterrows():
        summary = (row.get("summary") or "")[:400]
        score_val = row.get("_score", 0)
        try:
            score_int = int(score_val)
        except (ValueError, TypeError):
            score_int = 0
        results.append(
            {
                "title": row["title"],
                "ticker": row["ticker"],
                "date": str(row["date"].date()),
                "url": row.get("url", "") or "",
                "summary": summary,
                "score": score_int,
            }
        )
    return {"results": results}


@app.post("/api/chat")
def chat_endpoint(
    req: ChatRequest,
    x_llm_provider: Optional[str] = Header(default=None),
    x_llm_model: Optional[str] = Header(default=None),
    x_llm_api_key: Optional[str] = Header(default=None),
    # Backwards compat: an earlier version of the frontend sent this header.
    x_gemini_api_key: Optional[str] = Header(default=None),
):
    """Ask the LLM about the knowledge graph. Retrieves relevant article summaries.

    Provider/model/key can be supplied via headers (set by the frontend Settings
    dialog) or fall back to env vars in backend/.env.
    """
    # If only `month` is sent (legacy frontends), treat it as a single-month range.
    month_from = req.month_from or req.month
    month_to = req.month_to or req.month

    try:
        return chat_fn(
            query=req.query,
            month_from=month_from,
            month_to=month_to,
            focused_entity=req.focused_entity,
            provider=x_llm_provider,
            model=x_llm_model,
            api_key=x_llm_api_key or x_gemini_api_key,
        )
    except ChatNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ChatRateLimited as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")
