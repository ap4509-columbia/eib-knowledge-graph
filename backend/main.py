"""
EIB Knowledge Graph backend.

Three endpoints (per the plan):
    GET  /api/index              — which months are available
    GET  /api/snapshot/{month}   — the actual graph data for that month
    POST /api/run                — trigger the runner; returns when done

Run with:
    uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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


# ── Stubs — implemented in Session 3 ─────────────────────────────────

@app.get("/api/index")
def index():
    """List available months and which ones have GAT scores."""
    return {
        "months": [],
        "latest": None,
        "hasScores": [],
        "note": "stub — implement in session 3",
    }


@app.get("/api/snapshot/{month}")
def snapshot(month: str):
    """Return the graph for a specific month."""
    raise HTTPException(status_code=501, detail="stub — implement in session 3")


@app.post("/api/run")
def run():
    """Trigger the runner to refresh data from source CSVs."""
    raise HTTPException(status_code=501, detail="stub — implement in session 3")
