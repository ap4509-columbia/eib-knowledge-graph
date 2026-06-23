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

## Quick start (once scaffolded)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Frontend runs on `localhost:3000`; backend on `localhost:8000`.

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
