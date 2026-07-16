#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22+ and npm are required." >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "Preparing the local Python environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate
if ! python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  python -m pip install --disable-pip-version-check -r backend/requirements.txt
fi

if [[ ! -d node_modules ]]; then
  npm install --no-audit --no-fund
fi

echo "Scanning configured trace directories…"
python -m backend.build_catalog --if-needed

API_PORT="${TRACE_EXPLORER_API_PORT:-8000}"
WEB_PORT="${TRACE_EXPLORER_WEB_PORT:-3000}"
export TRACE_EXPLORER_WEB_PORT="$WEB_PORT"
export NEXT_PUBLIC_TRACE_API_URL="http://127.0.0.1:${API_PORT}"

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

python -m uvicorn backend.main:app --host 127.0.0.1 --port "$API_PORT" &
BACKEND_PID=$!
npm run dev -- --port "$WEB_PORT" --strictPort &
FRONTEND_PID=$!

echo ""
echo "Training Power Trace Explorer is starting:"
echo "  App: http://localhost:${WEB_PORT}"
echo "  API: http://127.0.0.1:${API_PORT}/docs"
echo "Press Ctrl-C to stop both services."

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 2
done

cleanup
wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
