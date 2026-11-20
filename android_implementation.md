# Android companion app: plan

## Goal

An in-lab companion to the desktop app, for three jobs:

1. **Reference** experimental protocols at the bench.
2. **Record** observations as they happen.
3. **Amend** protocols when the run deviates from the plan.

Not a port of the whole app. **In scope:** a phase agenda, a phase view/editor, a full-experiment
view/editor, and sync with desktop. **Out of scope:** flowchart, Gantt, MCP, calendar, papers
overview, OneNote/SharePoint import, TIFF/ND2 processing, creating or restructuring projects
(**the phone only edits existing experiments**; creating them is a later version).

**Sync with desktop is the product's critical requirement.** A phone edit that is lost, duplicated
or silently overwritten is worse than no app. Sync (section 4) is designed first and gates every
other phase.

## 1. Screens

| Screen | Behavior |
| --- | --- |
| **Agenda (default)** | One row per scheduled phase (experiment name, phase name, project, start-end dates, completed tick), sorted by start date ascending. **Phases active today (start <= today <= end) are pinned at the top**, then upcoming by date, then past/overdue below, collapsed by default. Completed phases dim. Filter chips: project, hide completed. Search by experiment name |
| **Phase view/edit** | Tap a row. Shows the phase text (protocol, acquisition, analysis, or custom phase), dates, duration, completed toggle, and attached images/tables/files for that phase. Edit text in place |
| **Experiment view/edit** | Full experiment: name, status, purpose, expected results, design, every phase, results, notes. Reachable from the phase screen and from search |
| **Sync status** | Last sync, pending edits count, conflicts to review, "Sync now" |

Phase, scheduled-date and "today" rules come from the existing code and are not re-derived:
`frontend/src/types/lab.ts` (`getExperimentPhases`, `getExperimentPhaseData`),
`utils/schedule.ts`, `utils/calendarPhaseFilters.ts`. The agenda is a flattening of
experiments -> phases. Unscheduled phases (no start date) are not listed in the agenda; they are
reachable via the experiment view.

Bench-use details: large text, screen-awake toggle on the phase screen, glove-friendly targets, dark
mode. Observations are typed straight into the phase/experiment text like on desktop: no separate
observation feature or section. A **timestamp** toolbar button inserts `**HH:MM** ` at the cursor,
so typed observations carry a timeline with no extra feature and no schema change.

**Deviations are a structured field.** Each phase gets an append-only list `deviations`:
`{id, at, device_id, text}`. The phone has a "Log deviation" button on the phase screen that adds an
entry; the desktop shows the list on the phase and can filter experiments that have deviations.
Entries are only added (edit/delete by the author later), so they merge by union on `id` and never
conflict. This is a small desktop schema and UI addition: **a new `deviations` JSON column on
`experiments`, keyed by phase key** (`{phaseKey: [entry, ...]}`). It cannot ride in existing phase
JSON: the built-in phases are flat columns (`experimental_protocol`, `data_acquisition_*`, ...) and
`phases` is only a list of key strings, so only custom phases have JSON at all. One column for both
kinds keeps the merge rule in one place. Protocol text itself is still edited freely when the user
wants to amend the plan.

## 2. Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Capacitor, Android WebView, `minSdk 26` (`android/variables.gradle` still has the template's 24; raise it when phase 3 replaces the spike code) | Reuses the React 19 + Tailwind + TipTap stack, so editor behaviour matches desktop |
| UI | New small React app `mobile/` that **imports** shared code from `frontend/src` (`types/lab.ts`, `utils/schedule.ts`, `SectionTextEditor`, `SectionAttachments`) | Phase and date semantics must match desktop exactly; do not fork them |
| Storage | SQLite on device (`@capacitor-community/sqlite`), the same tables as `backend/app/models.py`, plus sync tables (section 4) | Offline in the lab is the normal case. Every edit hits disk before the UI confirms it |
| Backend | **None on device.** Desktop's FastAPI is the sync peer | No Python on the phone |

Shared code approach: move reusable pieces into a `frontend/src/shared/` or a workspace package
so both bundles import them. Do this refactor first, with the desktop tests as a safety net.

Editor: the "text editor" is TipTap with the same extensions as desktop (markdown, tables, images,
highlight, font size, MathJax), in a trimmed toolbar. Same extensions means no content is lost or
reformatted on a round trip. Verify IME, selection and keyboard-resize behaviour on real devices
early; this is the biggest UI risk.

## 2b. Repo layout

**Same repo, new `mobile/` folder** (decided). The phone UI shares phase/schedule logic and the editor
with desktop, and the sync contract (op format, relay layout, merge rules, schema) has two ends that
must change together, so one commit and one version number keep them in step.

```
frontend/src/shared/      types/lab.ts, schedule utils, editor pieces, used by both bundles
mobile/                   Capacitor project + phone React app + phone SQLite/sync client
mobile/android/           generated Gradle project
backend/app/mobile_sync/  desktop sync endpoint (Tailscale) or relay worker (fallback) + merge module (the merge module has no I/O, so it is unit-testable alone)
docs/adr/0002-mobile-sync.md   op format, transport, merge rules, versioning
```

ADR 0002 also amends ADR 0001, which says to re-open it "if the window stops being the only way in":
with the sync endpoint the phone is a second way in.

- `mobile/` is self-contained: its own `package.json`, build and CI job. CI runs the mobile job only when
  `mobile/`, `frontend/src/shared/` or the sync module changes. It does not touch the PyInstaller/Inno
  Setup pipeline.
- Cross-side sync tests (desktop merge module fed phone-produced ops) live in the repo and run in CI.
- Update the root README ("this repo is the Windows desktop app") to say it also holds the companion,
  and add a CHANGELOG section for it.
- Build the Phase 0 spike inside `mobile/` from day one.
- Split into a separate repo only if the shared code stabilises into a package and the sync contract
  is versioned and documented. Not now.

## 3. What on desktop must change

Verified in the current code:

- The desktop UI saves by posting the **entire** lab state (`POST /api/lab/state`,
  `db_service.save_lab_state`), and rows missing from that payload are **deleted**.
- Backup/sync today (`backend/app/backup.py`) is whole-notebook: fingerprints, one writer at a
  time, and on a both-sides-changed conflict the other copy is parked as a `benchflow-conflict-*.db`
  file. There is no merge.

Both are unsafe for a phone that edits one phase while the desktop window is open: an open desktop
window would overwrite phone edits with its stale in-memory state on its next autosave, and
whole-notebook conflicts would be raised for every edit on both sides.

Required desktop work (this is part of the project, not optional):

1. **Per-record versioning.** Add `rev` (integer, bumped on every change) and `device_id` of last
   writer to experiments (and projects). Replace updated_at-only tracking.
2. **Stale-write protection.** `POST /api/lab/state` carries the revs the client loaded; the
   server applies changes per experiment/field and rejects or merges stale ones instead of
   replacing everything. The desktop store must refetch changed experiments after a sync lands
   (window open) so its memory is never behind the DB.
3. **Tombstones** for deletes, so "absent from payload" is no longer interpreted as deleted by a
   sync peer.
4. **Stable block ids.** Blocks (`ELNBlock` in `frontend/src/types/lab.ts`, the `blocks` JSON column)
   have no `id` today, so they cannot be merged one at a time. Add an `id` to every block (backfilled
   by a migration, generated on create by desktop and phone) and make the desktop's whole-state save
   keep it.
5. **`deviations` column** (section 1) and its desktop UI.
6. **Mobile sync endpoint** (section 4, Transport): a second small FastAPI app on a fixed
   `127.0.0.1` port, separate from the window's API, plus the merge module. The relay-folder worker
   is built only if the spike falls back to the OneDrive relay.
7. Keep the OneDrive snapshot backup as is. It stays a backup, not the phone sync path.

## 4. Sync design

### Principles

- Edits never block on connectivity. Phone queues them and sends them later.
- **No silent loss.** Every conflict resolution keeps both versions somewhere recoverable.
- Merge at the **field** level, text fields by three-way merge. Whole-notebook replacement is never
  used for phone sync.
- Idempotent: retrying a sync after a dropped connection never duplicates or reapplies edits.

### Data model

- Each device has a `device_id` (UUID). Each pending edit is an op:
  `{op_id, device_id, experiment_id, field | phase_key+field, base_rev, base_value, new_value, at}`.
- Fields are the units of merge: each section text, each phase's `duration`/`start`/`end`/
  `completed`, `status`, `name`, each phase's `deviations` (union), and individual **blocks**
  (images/tables/files) by block id (block ids are new, section 3).
- Phone stores per experiment the **base snapshot** (value as of last sync) so it can send
  `base_value` and compute three-way merges.

### Protocol (phone <-> desktop)

1. **Pull:** fetch experiments whose `rev` changed since the phone's last pull, plus tombstones
   (`GET /api/mobile/changes?since=<rev>` over Tailscale, or `state/*.json` on the relay; see
   Transport). Phone applies them to fields it has **not** edited; fields with pending local ops go
   through step 3's merge on the phone.
2. **Push:** send queued ops, in order (`POST /api/mobile/ops`, or files in `ops/<device_id>/` on the
   relay), each with an `op_id` (desktop remembers applied `op_id`s: replay is a no-op).
3. **Desktop-side apply, per field:**
   - current value == `base_value`: apply `new_value`, bump `rev`.
   - differs, non-text field: last-writer-wins by timestamp, loser saved to `sync_conflicts`.
   - differs, text field: **three-way merge** (`base_value`, desktop current, phone `new_value`)
     using a line/paragraph diff (diff-match-patch or `diff3`). Clean merge: applied. Overlapping
     edits: the field keeps the desktop version, the phone version goes to `sync_conflicts`, and
     both apps show a banner on that section until the user resolves it; nothing is dropped. No
     inline `<<<`/`>>>` markers: at the bench they read as garbled protocol text, and they can
     break tables and math when the editor reparses the Markdown.
   - experiment deleted on desktop: phone edit is restored as a new experiment flagged for review,
     never discarded.
4. Server returns the merged record(s); phone replaces its base snapshot and clears applied ops.
5. **Conflicts screen** on both apps lists `sync_conflicts` and lets the user keep either side or
   hand-edit. Conflicts are rare because merging is per-field, and phone edits are mostly
   appended observations.

### Transport: Tailscale first, OneDrive relay as fallback

The primary network is eduroam (WPA2-Enterprise). Eduroam normally isolates clients and gives
phones and desktops different subnets, so **plain phone -> desktop LAN sync is unlikely to work**.
The desktop server also only listens on `127.0.0.1` with no auth. Both devices can reach the
internet, so there are two ways through. In both, the desktop is the only merger and the op format,
merge rules and protocol above are the same; only the transport differs.

#### Primary: Tailscale (to be confirmed in the spike)

Phone and desktop both run Tailscale on the user's own personal (free) tailnet. Each device connects
outward to the internet, directly or through Tailscale's relays on port 443, so eduroam's client
isolation and separate subnets do not matter, and mobile data works the same way.

- **The window's API is unchanged** (random `127.0.0.1` port, origin guard). A **second FastAPI
  app** in the same process listens on a fixed `127.0.0.1` port and exposes only the sync surface:
  `GET /api/mobile/changes?since=<rev>` (changed records, tombstones, `applied_op_ids`),
  `POST /api/mobile/ops` (op batch, deduped by `op_id`), attachment upload/download, pairing. No
  backup, update, SharePoint, reset or whole-state endpoints. It runs only while the window is open,
  like the rest of the server.
- **`tailscale serve`** publishes it as `https://<pc>.<tailnet>.ts.net` with a real certificate.
  Never `tailscale funnel`: the endpoint must not be on the public internet.
- **Auth:** requests through `serve` arrive from localhost, so the sync app must not trust the
  caller the way the window's API does. Every request carries a per-device bearer token. Desktop
  shows a QR code (URL + one-time code) in Settings, the phone exchanges it for its token, and the
  desktop stores only a hash. Devices are listed and revocable. The tailnet may hold other devices,
  so the token is required, not optional.
- **Encryption:** WireGuard encrypts the link and the data stays on the two devices, so there is no
  app-level encryption layer.
- **Latency is seconds.** The open desktop window is told about merged phone ops (SSE) and
  refetches those experiments, which is how section 3's "refetch after a sync lands" is met.
- **Desktop must be running.** Pending ops wait **on the phone** until a current PC is reachable
  (in the relay design they wait in OneDrive). Accepted trade-off: a phone lost or wiped before a
  desktop is opened loses its pending ops. The phone shows pending counts so this is visible.
- No app registration, no Microsoft sign-in or token refresh, no OneDrive placeholder handling, and
  no cleartext HTTP.

#### Fallback: OneDrive relay

Used only if the spike shows Tailscale cannot be used (not installable on the lab PC, blocked on
eduroam, or clashing with a required VPN on the phone). Sync goes through a relay both devices
already reach: the **OneDrive folder the desktop backup already targets** (`backup.py`). No new
server, nothing leaves the user's own OneDrive.

Relay layout (each file has exactly one writer, so OneDrive never makes conflict copies):

```
<folder>/mobile-sync/
  state/<experiment_id>.json      written by desktop only: full record + rev + applied_op_ids
  ops/<device_id>/<seq>.json      written by that phone only: one queued edit batch
  uploads/<name>                  attachments, content-addressed, either side
  pairing.json                    device ids, key check value
```

- **Desktop is the only merger.** It watches the folder (on launch, on a timer, and on file
  change), applies phone ops with the field rules above, writes the merged record to `state/`, and
  lists the op ids it applied. Merges are deterministic and all conflict handling lives in one place.
- **Phone** reads `state/` to pull and writes `ops/` to push. An op stays "pending" on the phone
  until it appears in a state file's `applied_op_ids`; only then is the local base snapshot
  advanced. The protocol above is unchanged, with the HTTP calls replaced by file reads/writes.
- **Latency is minutes, and desktop must be running** (or opened later) for phone edits to land.
  The phone shows each edit as pending / applied. The phone stays the record of what happened at
  the bench until desktop catches up.
- **Encryption:** OneDrive holds the data, so op and state files are encrypted (AES-GCM) with a key
  shared once through a QR code shown by desktop at pairing and kept in the Android Keystore.
  Pairing also records the phone's `device_id`; ops from unpaired devices are ignored.

If the relay is needed, how the phone reaches OneDrive is the next spike question:

| Option | Notes |
| --- | --- |
| **Microsoft Graph API on a personal OneDrive (recommended)** | Phone signs in (MSAL) with the user's **personal** Microsoft account and reads/writes `mobile-sync/` directly. The institution account is not used (admin consent is not obtainable), and a personal account needs only user-level consent for an app registration. Reliable in the background. Verify in the spike on the real phone and eduroam |
| Android SAF via the OneDrive app's document provider | No app registration, but unreliable for background and large-file access, and needs the OneDrive app installed and signed in |

The relay folder is a **personal OneDrive folder** (decided: institutional accounts are too
restricted). The desktop backup folder must point at the same personal folder on every PC. If
Graph fails even on a personal account, fall back to SAF, then to another relay the user owns; the
op format and merge module are unchanged.

A plain LAN listener (no Tailscale) is not planned: on eduroam it is unlikely to connect, and
elsewhere Tailscale covers the same case with encryption and a certificate. The spike still probes
it once for the record.

### Attachments

Phone edits can add photos (bench photos are a main use). Images upload as content-addressed files
(`uploads/<name>` as on desktop) before the op that references them; desktop keeps names stable so
the existing `extract_refs`/backup logic keeps working. Pull downloads only attachments referenced
by experiments the phone holds (see below). Phone downscales images before storing.

### What the phone holds

All non-archived experiments' text and phase metadata (small), but attachments lazily: on demand
and prefetched for phases scheduled within the next 7 days. Offline view of a prefetched protocol
must work with no network.

## 4b. Multiple desktops

Today several PCs share a notebook only through the OneDrive snapshot (`backup.py`): each PC has its
own live copy, one writer at a time, and a both-sides-changed pull is parked as a
`benchflow-conflict-*.db` file with no merge. The changes above interact with that as follows.

| Change | Effect with 2+ PCs | Handling |
| --- | --- | --- |
| Phone ops merged by "the desktop" | Two PCs could each merge the same ops into their own copy; both copies then differ, and the next pull is a whole-notebook conflict | **Merge gate:** a PC merges phone ops only after its `sync_pull` reports `up-to-date` (it holds the current folder notebook), and publishes immediately after. A stale or unmatched PC defers the merge: on the relay, phone ops just wait in `ops/`; over Tailscale, the PC answers the push with "defer" and the ops stay pending on the phone. Both PCs open at once: the second one is refused by the existing publish guard until reopened, same as today |
| Phone paired with several PCs (Tailscale) | The phone could push to whichever PC answers, including a stale one | The phone pairs with each PC separately (its own token per PC) and tries each reachable one; only a PC whose pull is `up-to-date` accepts, the rest defer |
| `applied_op_ids`, `rev`, tombstones | If kept in a machine-local file they would not travel with the notebook, and PC B would re-apply what PC A already did | Store them **in the notebook DB** (rows), so they move with snapshots and count in the fingerprint. Machine-local items (this PC's `device_id`, folder paths) stay in settings / `benchflow-sync.json`, which pull already preserves |
| `state/<id>.json` has one writer (relay only) | Two PCs writing it breaks the one-writer rule | It is a pure function of the notebook, and the merge gate means only the current-notebook PC writes it, so no two PCs write different content |
| Encryption key (relay only; Tailscale needs none) | A second PC cannot decrypt without the key | Key is derived from a **passphrase** (salt in `pairing.json`), entered once per PC; QR carries it to the phone. Not stored in the OneDrive folder |
| Per-record `rev` in schema | Older desktop builds on another PC would not understand the new columns and would drop them on save | Schema migration is additive, and the snapshot records the app version; a PC with an older build refuses to pull a newer-schema notebook and says to update. Update all PCs together |
| Stale-write protection | Per-window only | No cross-PC effect; PC-to-PC is still the snapshot route |

What does **not** change: PC-to-PC is still one notebook at a time through snapshots, and a real
two-PC conflict is still a parked conflict file for the user to resolve. Phone edits do not make
that more frequent as long as the merge gate holds.

Deliberately not in this plan: converting PC-to-PC sync to record-level merge. It would remove
conflict files but means a base copy per PC, merging whole notebooks, and re-testing the existing
backup design. Revisit only if users routinely work on two PCs without closing one first. The merge
module built for the phone is reusable for it if that day comes.

Added tests: PC A merges and publishes, PC B pulls and sees no conflict and no duplicate ops; PC B
stale while the phone pushes -> merge deferred, applied after B's next pull; same op id seen by
both PCs -> applied once; older build opens a newer notebook -> refused with a clear message.

## 5. Phases and exit criteria

| # | Work | Exit criterion |
| --- | --- | --- |
| 0 | **Spike (1 wk):** Capacitor shell + TipTap editor on a real phone against a canned notebook; **reach the desktop from the phone through Tailscale (`tailscale serve`, on eduroam and mobile data)**; only if that fails, write and read a file in the user's OneDrive via Graph (personal account). Implemented in `mobile/`, results go in `mobile/SPIKE.md`; try plain LAN reachability on eduroam for completeness | Editor usable with the on-screen keyboard; transport decided: Tailscale, or Graph / SAF / other relay |
| 1 | **Desktop sync groundwork (2-3 wk), including the multi-PC merge gate (section 4b):** `rev`, tombstones, stale-write protection, stable block ids, `sync_conflicts`, `deviations` column + desktop UI, dependency-free merge module + unit tests, and the transport's desktop end (mobile sync app for Tailscale, or relay-folder worker for the fallback); ADR 0002 | Desktop alone passes the merge test matrix; autosave from a stale window can no longer clobber a newer record or drop block ids |
| 2 | **Shared code extraction (1 wk):** move types/schedule/editor to a shared location | Desktop build and tests unchanged |
| 3 | **Phone data layer + agenda + phase/experiment editing (3 wk)** | Agenda order matches desktop for the seed notebook; edits persist across process kill |
| 4 | **Sync client, QR pairing, conflicts UI (about 1 wk over Tailscale; 2-3 wk on the relay, which adds Graph sign-in, the folder protocol and encryption)** | Sync test matrix below passes against a real desktop |
| 5 | **Attachments + bench-use features (1-2 wk)** | Photo taken on phone appears in the desktop experiment |
| 6 | **Hardening + release (1-2 wk):** device matrix, signing, CI, docs, ADR `0002-mobile-sync.md`, README/CHANGELOG | Pilot with one real lab week, zero lost edits |

About 10-12 weeks for one developer over Tailscale, 11-14 on the relay. Phase 1 is the real risk
and goes first (after the spike).

## 6. Test matrix (sync is the acceptance gate)

Automated against the merge module and then end to end (emulator + desktop):

- Phone edits phone-only field; desktop idle -> desktop shows it.
- Phone and desktop edit **different** fields of the same experiment -> both kept.
- Both edit **different paragraphs** of the same text -> clean merge.
- Both edit the **same** paragraph -> field keeps the desktop version, phone version in
  `sync_conflicts`, banner shown on that section in both apps, nothing lost, no markers in the text.
- Phone adds a block and desktop adds another to the same experiment -> both kept, ids unchanged;
  a later desktop whole-state save keeps every block id.
- Desktop deleted the experiment the phone edited -> restored for review.
- Push interrupted mid-way, retried -> no duplicate or lost ops (`op_id` idempotency).
- Phone offline for days, many edits, then sync.
- Desktop window open with stale state while a phone push lands -> autosave does not revert it.
- Clock skew on phone (wrong date) -> ordering uses revs, not wall clock, except LWW tie-break.
- Two phones, one desktop.
- Revoked or unknown device token -> push refused, nothing applied, ops stay pending on the phone.
- Phone paired with two PCs, one stale -> stale PC defers, current PC applies, each op applied once.
- Desktop closed for days while the phone pushes ops; ops apply in order on next launch.
- OneDrive placeholder / partially synced file: reader skips it and retries, never treats it as empty.
- Deviation entries from phone and desktop on the same phase: union, none lost.
- Kill the phone app mid-edit: the edit is either fully saved or not at all, and the queue is intact.
- Round trip with images/tables/math: byte-stable content after sync both ways.
- Existing OneDrive snapshot backup/restore still works with the new columns.

## 7. Risks

- **Desktop whole-state save** is the main hazard (section 3). If per-record stale-write
  protection slips, do not ship sync.
- **Transport access:** Tailscale may not be installable on a managed lab PC (the Windows client
  needs admin rights to install), eduroam may block it, and Android allows one VPN at a time, so a
  required institutional VPN on the phone would clash with it. If Tailscale fails, Graph consent on a
  personal account is the next unknown. Resolve in the spike, before any other phone work.
- **Desktop must be running** (either transport), and on the relay sync latency is minutes: shown
  in the UI, not hidden.
- **Pending ops live on the phone** over Tailscale until a current PC is reachable: a lost or wiped
  phone loses them. Pending counts are always visible.
- Text merging of TipTap markdown/HTML: merge on a normalised form (paragraph/line units) and
  verify that merged output reparses in the editor; tables and math are merge-atomic (keep one
  side whole plus a conflict entry).
- Mobile keyboard and selection quirks in the WebView editor.
- Old WebViews: Tailwind 4 needs a recent Chromium; check at startup.
- Android may kill the app at any time: write-through on every keystroke batch (debounced under
  1 s) and on `pause`.
- Security: no login exists on desktop today; the phone adds a second copy of the notebook, so
  offer an optional biometric lock, `allowBackup=false`, and an app-private DB. The sync endpoint
  is a new way into the notebook: bearer token per device, never `tailscale funnel`, and remove the
  spike's `usesCleartextTraffic` (HTTPS through `serve` does not need it).

## Decisions

- Observations: typed into the phase/experiment text as on desktop, with a timestamp toolbar
  button. No separate feature.
- Network: eduroam, so plain LAN-direct is unlikely. **Tailscale** (personal tailnet,
  `tailscale serve`, separate sync app, bearer token per device) is the primary transport if the
  spike confirms it; the personal OneDrive relay is the fallback.
- Relay account (fallback only): **personal OneDrive only** (institution Graph/admin consent is not
  available).
- Text conflicts: the field keeps the desktop version, the phone version goes to `sync_conflicts`
  with a banner. No inline conflict markers.
- Deviations: their own `deviations` JSON column keyed by phase key (not inside phase JSON).
- Desktop merges phone ops **only while open** (no tray/background worker). Combined with the merge
  gate in 4b, phone edits wait until a current PC is opened.
- Phone edits existing experiments only (no creation in v1).
- Deviations: structured, append-only per-phase field, filterable on desktop.
- PC-to-PC stays snapshot-based, one notebook at a time.
- Latency model accepted: phone edits wait until a current PC is opened.

## Still open

- Does Tailscale work for this setup? First task of the spike (phase 0), and it gates the rest.
  Pass criteria: Tailscale installs and runs on the lab PC; the phone reaches a page published with
  `tailscale serve` over HTTPS on eduroam and on mobile data; it still does after the PC sleeps and
  wakes; and Tailscale on the phone coexists with whatever VPN the phone must use. If any of these
  fail, test Graph next.
- Only if Tailscale fails: does Graph with a personal Microsoft account work from the phone on
  eduroam and on mobile data? Pass criteria: sign
  in with a personal account, create/read/overwrite/delete a small file in a `mobile-sync/` folder,
  and list a folder, on both eduroam and mobile data, including after the app was backgrounded for
  an hour (token refresh). If it fails, try SAF via the OneDrive app next (same checks); if that
  fails too, stop and pick a different relay before any other phone work.
