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
from chat import chat as chat_fn, ChatNotConfigured

app = FastAPI(title="EIB Knowledge Graph backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://localhost:3000",
    ],
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
    month: Optional[str] = None
    focused_entity: Optional[str] = None


@app.post("/api/chat")
def chat_endpoint(
    req: ChatRequest,
    x_gemini_api_key: Optional[str] = Header(default=None),
):
    """Ask the LLM about the knowledge graph. Retrieves relevant article summaries.

    The Gemini API key can be supplied via:
      1. GEMINI_API_KEY env var on the backend, or
      2. X-Gemini-Api-Key request header (set by the frontend Settings dialog).
    """
    try:
        return chat_fn(
            query=req.query,
            month=req.month,
            focused_entity=req.focused_entity,
            api_key=x_gemini_api_key,
        )
    except ChatNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")
