# 1. The API runs inside the window's own process

Date: 2026-11-03
Status: accepted (re-open only if the window stops being the only way in)

## Context

The web app is a FastAPI backend plus a React SPA served by Vite, with a PostgreSQL/SQLite notebook.
The desktop build has to run that same code on a lab machine with no Docker, no Python install and
no terminal, and PyInstaller has to freeze it into one `Benchflow.exe`.

The web app already separates "the API" from "the page that calls it". A desktop build has to put
them back together somehow, and there are three ways to do it:

- **A second process.** The shell starts `uvicorn` as a child, waits for the port, opens a window
  at it. Two processes to keep alive, two logs to read, and if the child survives a window close it
  keeps holding the notebook while a new instance complains about the lock.
- **A different shell.** Electron or Tauri means shipping a Node or Rust toolchain, rewriting the
  window code, and losing the `pythonnet`/`tifffile`/`imagecodecs` imports that only exist on the
  Python side. The backend is the science; it would have to be reimplemented, not re-used.
- **One process.** `uvicorn.Server` in a daemon thread, `pywebview`'s window in the main thread
  (`webview.start(..., gui="edgechromium")`), both inside `Benchflow.exe`.

## Decision

One process. `backend/desktop.py` picks a free port on `127.0.0.1`, starts uvicorn in a daemon
thread, opens a WebView2 window at it, and the built frontend is served by the API itself
(`app/main.py` mounts `frontend/dist` and `/uploads`). The window and the API have the same origin,
so there is no CORS and no Vite dev server in the shipped app.

Consequences we accepted:

- **Shutdown ordering is our job.** The window's close event stops the server, and uvicorn's
  lifespan shutdown is what runs the closing backup and the pending export. A process killed from
  Task Manager never gets there, so it logs that the run was cut short instead of pretending
  otherwise, and the snapshot rotation keeps the last good copy.
- **A windowed exe has no console.** stdout/stderr are teed into
  `%LOCALAPPDATA%\Benchflow\logs\backend.log`; `--version`, `--help` and `--mcp` re-attach a console
  so a terminal user still sees the answer.
- **One instance at a time.** The lock file in `%LOCALAPPDATA%\Benchflow\desktop.lock` is created
  exclusively at the OS level (`_create_exclusive`), and a lock left by a crash is recognised as
  dead (pid + health check) instead of wedging startup forever — two windows over one SQLite file
  is how a notebook gets corrupted.
- **WebView2 is a system runtime, not ours to ship** (`gui="edgechromium"`). Wherever Edge is
  installed it is already there; `docs/setup.md` says what to install if the window will not open.
- **The dev flow stays the web flow.** `start-dev.ps1` still runs uvicorn with `--reload` and Vite
  on 5173, so upstream development is undisturbed; the frozen path is only ever tested with
  `packaging/test_frozen.py`.

## Considered and rejected

- Child-process uvicorn — extra moving part, orphan processes holding the notebook, no gain.
- Electron/Tauri — would mean rewriting the backend and the binary import chain that already works.
- Serving the SPA from `file://` — breaks `/uploads` and makes the origin guard useless.
