# Backend

FastAPI service that wraps the existing model code from the Spring 2026 team's
deliverables (the "past teams work" folder, untouched).

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate    # macOS / linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --port 8000
```

Then visit:

- http://localhost:8000/ — service health
- http://localhost:8000/docs — interactive Swagger UI
- http://localhost:8000/api/health — JSON health check

## Endpoints (per plan)

| Method | Path | Status |
|---|---|---|
| GET | /api/index | stubbed in session 2; implemented in session 3 |
| GET | /api/snapshot/{month} | stubbed in session 2; implemented in session 3 |
| POST | /api/run | stubbed in session 2; implemented in session 3 |

## Exposing to a deployed frontend

When the frontend is deployed to Vercel and needs to talk to this backend
running locally, use ngrok:

```bash
ngrok http 8000
```

Then set `NEXT_PUBLIC_API_BASE_URL` in Vercel to the ngrok URL.
