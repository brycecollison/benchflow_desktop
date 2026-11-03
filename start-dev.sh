#!/usr/bin/env bash
# Run with: bash start-dev.sh
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${BENCHFLOW_PYTHON:-}"
# The repo is synced by OneDrive, so ./venv may hold compiled wheels built for another
# machine's Python (e.g. cp314 wheels under a 3.12 interpreter). Accept only an
# interpreter that can actually import the backend dependencies.
if [[ -z "$PYTHON" ]] || ! "$PYTHON" -c 'import fastapi, sqlmodel' >/dev/null 2>&1; then
  PYTHON=""
  for candidate in "$ROOT/venv/Scripts/python.exe" "$ROOT/venv/bin/python" \
                   "$HOME/.venvs/lab-planner-eln/Scripts/python.exe" "$HOME/.venvs/lab-planner-eln/bin/python"; do
    if [[ -x "$candidate" ]] && "$candidate" -c 'import fastapi, sqlmodel' >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
  done
fi
if [[ -z "$PYTHON" ]]; then
  printf 'No usable Python environment: the synced venv does not work with this machine'\''s Python.\nCreate one outside the synced folder (python -m venv && pip install -r backend/requirements.txt) and set BENCHFLOW_PYTHON.\n' >&2
  exit 1
fi
command -v node >/dev/null || { printf 'Node.js is required.\n' >&2; exit 1; }
if [[ ! -f "$ROOT/frontend/node_modules/vite/bin/vite.js" ]]; then
  printf 'Missing frontend dependencies. Run: npm --prefix frontend ci\n' >&2
  exit 1
fi

pids=()
cleanup() {
  trap - EXIT INT TERM
  printf '\nStopping development servers...\n'
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Backend:  http://127.0.0.1:8000\nFrontend: http://localhost:5173\nPress Ctrl+C to stop both. Restart this script after backend code changes.\n'
# No reload supervisor: each PID is the actual server, including under Git Bash.
(cd "$ROOT/backend" && exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
pids+=("$!")
(cd "$ROOT/frontend" && exec node node_modules/vite/bin/vite.js --host localhost --port 5173 --strictPort) &
pids+=("$!")
wait -n "${pids[@]}"
