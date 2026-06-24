#!/usr/bin/env bash
# One-command launcher for local dev.
# Boots the FastAPI backend on :8000 and the Next.js frontend on :3000.
# First run installs deps (~2 min); subsequent runs skip that.
#
# Usage:
#   ./dev.sh
# Then open http://localhost:3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Backend setup ──────────────────────────────────────────────────────

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Install from python.org or 'brew install python'."
  exit 1
fi

if [ ! -d "backend/.venv" ]; then
  echo "▸ Creating Python venv + installing backend deps..."
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
  echo "  ✓ backend deps installed"
fi

# ── Frontend setup ─────────────────────────────────────────────────────

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found. Install Node.js from nodejs.org or 'brew install node'."
  exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "▸ Installing frontend deps..."
  (cd frontend && npm install --silent)
  echo "  ✓ frontend deps installed"
fi

# ── Boot both servers ──────────────────────────────────────────────────

echo ""
echo "▸ Starting backend on http://localhost:8000"
(cd backend && .venv/bin/uvicorn main:app --port 8000 > /tmp/eib-backend.log 2>&1) &
BACKEND_PID=$!

# Make sure we kill the backend when the frontend exits (Ctrl-C).
cleanup() {
  echo ""
  echo "▸ Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Give the backend a moment to bind.
sleep 2
if ! curl -s -o /dev/null http://localhost:8000/; then
  echo "ERROR: backend failed to start. Check /tmp/eib-backend.log"
  tail -20 /tmp/eib-backend.log
  exit 1
fi
echo "  ✓ backend ready"

echo ""
echo "▸ Starting frontend on http://localhost:3000 (Ctrl-C to stop both)"
echo ""
cd frontend && npm run dev
