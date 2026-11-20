# 2. Phone sync: field-level merge on the desktop, over Tailscale

Date: 2026-11-20
Status: accepted, desktop and phone sides built. Tailscale is the transport (phase 0 results in
`mobile/SPIKE.md`; eduroam is assumed from daily use, not tested with this app).

Amends ADR 0001: the window is no longer the only way in. A second FastAPI app in the same process
serves the phone while the window is open.

## Context

The Android companion edits existing experiments at the bench, often offline, while a desktop
window may be open on the same notebook. Before this change the desktop could not take that:

- the window saved by posting the whole lab state, and the server deleted what was missing and
  overwrote everything else, so a window holding an old copy would revert a phone edit on its next
  autosave;
- there were no record versions, no tombstones and no block ids, so nothing could be merged one
  piece at a time;
- PC-to-PC sync is whole-notebook snapshots through OneDrive (`app/backup.py`), one writer at a time.

## Decision

**The desktop is the only merger.** The phone sends ops; the desktop applies them and is the record.

### Notebook (all in the notebook DB, so it travels with OneDrive snapshots)

- `experiments.rev`, `projects.rev`: one notebook-wide counter, set by a SQLAlchemy `before_flush`
  hook (`app/models.py`) whenever a row's content columns change. Every writer (window save, position
  drag, OneNote import, phone ops) bumps it the same way. `device_id` records the last writer.
- `tombstones`: a deleted experiment/project with its rev and data. A phone learns of deletes from
  them, and a phone edit to a deleted experiment restores it from `data` instead of dropping it.
- `sync_conflicts`: the losing side of every conflict (`kept`, `parked`, `base` as JSON). Never
  deleted by sync.
- `applied_ops`: op ids already applied. A replayed push is a no-op, also on a second PC that pulled
  this notebook.
- Blocks get a stable `id` (backfilled on startup; a missing id is a hash of the block, so every path
  derives the same one).
- `experiments.deviations`: `{phaseKey: [{id, at, device_id, text}]}`, append-only, merged by union.
- `PRAGMA user_version = 1`. A PC whose build is older than the folder's notebook refuses to pull it
  (`sync_pull` raises), because an older build would drop block ids and sync records on save.

Machine-local (settings, kept by a pull): this PC's `device_id`, paired devices (token hashes),
pending pairing codes.

### Merge (`app/mobile_sync/merge.py`, no I/O)

An experiment is flattened into units: each field, each block (`blocks/<id>`), each custom phase
property, each phase's deviations, and block / custom phase order. Per unit, against the base:

| Case | Result |
| --- | --- |
| one side changed it | that side |
| deviations | union by entry id |
| order units | current order plus what the other side added |
| text, both changed | line three-way merge; a Markdown table or `$$` block is one unit; both inserting at the same spot keeps both (desktop first) |
| text, overlapping edits | conflict |
| anything else, both changed | conflict |

A conflict keeps one side in the field and puts the other in `sync_conflicts`. Text conflicts keep
the desktop. Non-text conflicts from a phone op go to the later of the op's `at` and the experiment's
`updated_at`. No `<<<`/`>>>` markers ever go into the text.

### The window's save (stale-write protection)

The window keeps, per experiment, the last version it shares with the server (its baseline,
`frontend/src/utils/labSync.ts`). A save still posts the whole state, plus `since` (the rev it has
caught up to) and a `base` for each experiment the user changed. The server
(`db_service.save_lab_state`):

- writes only experiments that have a base (or are new), merged against the stored row with the
  window's edits winning and the overwritten value parked;
- does not delete a record whose rev is newer than `since`: the window has not seen it;
- returns the changes since `since`, so the window catches up in the same round trip.

The window also polls `GET /api/lab/changes?since=` every 3 s. A clean experiment takes the server
copy; an edited one keeps its edits and baseline, and the next save merges. A request without `since`
(imports, seeding, older callers) still replaces the notebook as before.

Plan deviation: polling instead of SSE. It is a few lines, local, and a phone edit shows up within
seconds either way.

### Transport (`app/mobile_sync/api.py`)

A second FastAPI app on `127.0.0.1:18766` (`BENCHFLOW_SYNC_PORT`, `0` = off), started by
`desktop.py` next to the window's server and stopped with it. Published to the user's tailnet with:

```
tailscale serve --bg 18766
```

Never `tailscale funnel`. Requests through `serve` arrive from localhost, so the window API's
trust-localhost model does not apply: every call except `/api/mobile/health` and `/api/mobile/pair`
needs `Authorization: Bearer <token>`.

| Endpoint | |
| --- | --- |
| `POST /api/mobile/pair` `{code, device_id, name}` | one-time code (from the window's `POST /api/mobile/pairing`, 10 min) -> token; only its SHA-256 is stored |
| `GET /api/mobile/changes?since=` | `{rev, projects, experiments, deleted}` |
| `POST /api/mobile/ops` `{ops: [{op_id, experiment_id, unit, base_value, new_value, at}]}` | applied in order, one commit per op; per-op result `applied`, `conflict`, `restored`, `rejected`, or `duplicate: true` |
| `POST /api/mobile/uploads`, `GET /api/mobile/uploads/<name>` | attachments, content-addressed (`<sha256[:16]>_<name>`), so a retried upload is stored once |

The window lists and revokes devices with `GET /api/mobile/devices` and
`DELETE /api/mobile/devices/<id>`.

The phone may edit: section text, name, status, built-in phase dates/duration/completed, custom
phase content/dates/completed, blocks, deviations. Anything else (deps, phases, positions, papers)
is parked as `rejected`, not applied and not dropped.

### Two or more PCs (merge gate)

A PC applies phone ops only if it holds the notebook last published to its OneDrive folder (the
folder's fingerprint equals the one this PC last matched). Otherwise the push is answered
`{"deferred": true}` and the ops stay pending on the phone. After applying ops, a configured PC
publishes within 30 s. With no folder configured (one PC) the gate is open.

## Consequences

- **The phone holds pending ops until a current PC is open.** A phone lost before that loses them.
  The phone must show pending counts (phase 4).
- **Conflicts are stored but not shown yet.** The desktop conflicts screen and the section banner are
  phase 4. Until then `sync_conflicts` is only readable in the database.
- **Dependencies do not bump `rev`.** They live in their own table, and only the desktop edits them.
- **Deviations cannot be deleted through sync.** Union would bring them back. The desktop only adds
  entries for now.
- **Not built:** `applied_op_ids` in `/changes` (a retried push returns each op's status instead), the
  OneDrive relay fallback (only if phase 0 rules Tailscale out), and the QR code and Settings UI for
  pairing (phase 4).
