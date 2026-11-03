# Connecting pi to the Benchflow MCP Server (via LM Studio)

This guide wires up a local coding-agent session where:

- **LM Studio** serves the local LLM (OpenAI-compatible API on port 1234).
- **pi** runs the agent and, per session, **launches the Benchflow MCP server itself** as a stdio subprocess (`backend/mcp_server.py`).
- The MCP server reads this install's notebook (`%LOCALAPPDATA%\Benchflow\data\benchflow.db`) **read-only** and exposes 3 tools + 4 resources.

```text
pi session (agent)
 ├── inference ──> LM Studio server  http://127.0.0.1:1234/v1
 └── MCP (stdio) ──> per-machine Python backend/mcp_server.py ──> benchflow.db (read-only)
```

Note: LM Studio is the **model provider**, not the MCP host. pi spawns the MCP server directly, so nothing in LM Studio needs to know about Benchflow. (LM Studio can *also* host this server for its own chat UI — see the LM Studio entry in `README.md` — but that is optional and separate.)

---

## Step 1 — Prerequisites

| What | Check |
|---|---|
| This repo checked out | `backend/mcp_server.py` exists |
| Per-machine Python venv with the pinned MCP SDK | `& "$env:USERPROFILE\.venvs\lab-planner-eln\Scripts\python.exe" -c "from importlib.metadata import version; print(version('mcp'))"` prints `2.3.0` |
| Notebook database exists | `%LOCALAPPDATA%\Benchflow\data\benchflow.db` (start the app once if missing — the MCP server never seeds it) |
| LM Studio installed, ≥1 model in the library | e.g. `swift-1.5-qwen3.8-27b` |
| pi installed | `pi --version` |

Create the per-machine environment with Python 3.12+ if it is missing (PowerShell, from the repo root):

```powershell
python -m venv "$env:USERPROFILE\.venvs\lab-planner-eln"
& "$env:USERPROFILE\.venvs\lab-planner-eln\Scripts\python.exe" -m pip install -r backend\requirements.txt
```

Keep this environment outside the repository so copying or syncing the checkout does not replace its interpreter or compiled dependencies. The development launchers also support this environment. On macOS/Linux, create the same environment under `~/.venvs/lab-planner-eln` and use `bin/python` instead of `Scripts/python.exe` in the config below.

## Step 2 — Start the LM Studio server

1. Open LM Studio → **Developer** tab → **Start Server** (default: `http://127.0.0.1:1234`).
2. Keep it running for the whole pi session. No model needs to be pre-loaded — the pi extension (Step 3) loads the model you select, and unloads the others first to free VRAM.
3. Sanity check: `curl http://127.0.0.1:1234/api/v1/models` returns a JSON model list.

> Remote machine? The server must listen beyond localhost: `lms server start --host 0.0.0.0`, then set `LMSTUDIO_BASE_URL` (e.g. the Tailscale magic-DNS URL) on the machine running pi. The API has **no auth** — only expose port 1234 on a trusted network.

## Step 3 — Give pi the `lmstudio` provider

pi has no built-in LM Studio provider; it comes from a small pi extension that registers the `lmstudio` provider, pulls the model list from LM Studio's `/api/v1/models`, and loads the selected model before it is used.

1. The extension file is `lmstudio.ts` (this machine keeps it at `~/.pi/agent/extensions/lmstudio.ts`).
2. On a new machine, copy it into pi's user extensions directory:

```powershell
# Windows
Copy-Item .\lmstudio.ts $env:USERPROFILE\.pi\agent\extensions\lmstudio.ts
# macOS / Linux
cp lmstudio.ts ~/.pi/agent/extensions/lmstudio.ts
```

3. The extension reads `LMSTUDIO_BASE_URL` (default `http://127.0.0.1:1234`) — no code edits needed for a different host/port.

## Step 4 — Configure pi's MCP server

This repo ships a **project-level** MCP config at `.pi/mcp.json`:

```json
{
  "mcpServers": {
    "benchflow-notebook": {
      "command": "~/.venvs/lab-planner-eln/Scripts/python.exe",
      "args": ["backend/mcp_server.py"],
      "description": "Read-only Benchflow lab notebook: list projects, search experiments, retrieve experiment records, sections and attachment metadata.",
      "exposure": "direct"
    }
  }
}
```

- Pi expands the leading `~/` in `command` to your home directory. The relative `backend/mcp_server.py` argument resolves against the **session directory**, so start pi from the repo root. For clients that do not expand `~/`, use the interpreter's absolute path.
- `exposure: direct` declares all 3 tools to the model without a tool search. Drop the field to use the default (`codemode`).
- Point the server at a database **copy** instead of the live file by adding `"env": { "BENCHFLOW_DB_PATH": "C:\\...\\benchflow-copy.db" }` (copy the `-wal`/`-shm` files too, or copy with the backend stopped).
- No project file? Add it from PowerShell instead: `pi mcp add -l benchflow-notebook -- "$env:USERPROFILE/.venvs/lab-planner-eln/Scripts/python.exe" backend/mcp_server.py`
- After changing `.pi/mcp.json` in a running pi session, run `/reload` to load the new interpreter path.
- User-level (all projects) config lives in `~/.pi/agent/mcp.json` if you prefer that.

## Step 5 — Start pi

From the **repo root**:

```powershell
pi --provider lmstudio --model swift-1.5-qwen3.8-27b
```

- On first run in this project pi asks for **project trust** — accept it. Project-level `mcp.json` is only read after trust is granted; without it you will start pi with no MCP tools.
- The model id must match a key in LM Studio's model library (the `key` field from `/api/v1/models`); the extension loads it on demand (big models can take minutes — a status line shows the load).
- Make it the default so plain `pi` works: set `defaultProvider: "lmstudio"` and `defaultModel: "<key>"` in `~/.pi/agent/settings.json`.

## Step 6 — Verify

1. Outside a session: `pi mcp list` → `benchflow-notebook` shows **connected** with 3 tools (`list_projects`, `search_experiments`, `get_experiment`) and no errors. Exit code 0 means every enabled server connected.
2. Inside a session: `/mcp` → server listed with tool count and `direct` exposure.
3. Smoke test: ask *"list my projects and their experiment counts"* → the answer should come from `mcp__benchflow_notebook__list_projects`. Then *"find experiments about HDAC8 inhibitor concentrations"* to exercise `search_experiments` + `get_experiment`.
4. If a connection problem appears later, `pi mcp list` prints the error and the tail of the server's stderr; full server logging is in `~/.pi/agent/mcp.log`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `cannot reach LM Studio at http://127.0.0.1:1234` | Server not started (Step 2), or bound to localhost only while pi runs on another machine (`--host 0.0.0.0` + `LMSTUDIO_BASE_URL`) |
| `LM Studio: "<id>" is not in the model library` | Model id doesn't match a library key — check `/api/v1/models` |
| pi starts with **no MCP tools** | Project trust not granted; pi not started from the repo root (relative paths); project file shadowed by a same-named user-level entry |
| Server fails to start / no tools in `pi mcp list` | Run it by hand to see the error: `& "$env:USERPROFILE\.venvs\lab-planner-eln\Scripts\python.exe" backend/mcp_server.py`. JSON on Windows needs escaped backslashes for absolute paths. First start is slow (scientific Python imports) — raise the client's startup timeout rather than assuming a crash |
| `pydantic_core` / binary-extension import errors | A `pip install mcp` ran in a venv built by a different Python. Rebuild the venv and `pip install -r backend\requirements.txt` |
| Tools answer with **no records** | `%LOCALAPPDATA%\Benchflow\data\benchflow.db` missing or stale (check `BENCHFLOW_DB_PATH`); archived projects need `include_archived: true`; unsaved browser edits never reach the database |
| Model loads, then pi is slow to answer | Expected for 27B-class models on a single GPU — not an MCP problem |

## Limits to keep in mind

- The MCP server is **read-only** (`mode=ro` + `query_only`); it can never create, edit, or delete notebook records.
- No authentication: anyone who can configure a client on this machine can read the served notebook.
- Search is literal, case-insensitive substring matching (all terms must match) — no fuzzy/semantic/image search. Attachment **metadata** is returned; attachment **contents** are not.
