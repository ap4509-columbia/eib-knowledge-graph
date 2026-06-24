# EIB Knowledge Graph Viewer

Risk-analyst-facing UI for the EIB sponsor project (IEOR 4737, Columbia).
Reads the existing model pipeline's output and renders it as an interactive,
time-sliced knowledge graph with entity search, filters, and a refresh trigger
that re-runs the data pipeline.

This project is the UI layer. The underlying model pipeline (triplet extraction
via LLM, Judge LLM quality scoring, GAT-based link prediction) lives in the
Spring 2026 team's deliverables and is not duplicated here.

---

## Structure

```
eib-knowledge-graph/
  frontend/                 # Next.js + Cytoscape.js, deploys to Vercel
  backend/                  # FastAPI service that wraps the model code
  README.md
  .gitignore
```

## Quick start (any teammate's laptop)

**One command:**

```bash
git clone https://github.com/ap4509-columbia/eib-knowledge-graph
cd eib-knowledge-graph
./dev.sh
```

Then open **http://localhost:3000**.

The first run installs Python + Node deps (~2 minutes) and creates a venv in
`backend/.venv`. Subsequent runs skip setup and boot in seconds. Ctrl-C in the
terminal stops both servers.

**Requirements:** Python 3.10+ and Node 20+ on `PATH`. On macOS:
`brew install python node`.

The repo includes cached snapshot JSONs (`backend/data/`), so the app works
out of the box without the source CSV. The `/api/run` "refresh data" endpoint
will only succeed for whoever has the source CSV at the expected path
(see `backend/runner.py`).

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  Next.js (Vercel)       │  HTTP   │  FastAPI (local laptop)  │
│  ─────────────────      │ ──────► │  ─────────────────       │
│  · time slider          │ ◄────── │  · GET  /api/index       │
│  · search + filters     │  JSON   │  · GET  /api/snapshot/   │
│  · detail panel         │         │  · POST /api/run         │
│  · refresh button       │         │                          │
└─────────────────────────┘         └────────────┬─────────────┘
                                                 │ reads (unmodified)
                                                 ▼
                                  Spring 2026 team's existing pipeline
                                  · triplet CSVs
                                  · GAT model weights
                                  · inference code

```

The runner reads the model team's outputs without modifying their code.
Frontend deploys to Vercel; backend runs locally with ngrok for sponsor demos.

## Status

In active development — Summer 2026.
