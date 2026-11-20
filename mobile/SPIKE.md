# Phase 0 spike: Android companion

The questions that gated the Android plan (phase 0), and what the spike found:

1. Is the desktop's TipTap editor usable on a phone with the on-screen keyboard?
2. Can the phone reach the desktop over **Tailscale** (`tailscale serve`, HTTPS), on eduroam and on
   mobile data? This is the primary transport if it passes.
3. Only if 2 fails: can the phone read/write a **personal** OneDrive folder through Microsoft Graph,
   on eduroam and on mobile data, including after the token expires?

Plus, for completeness: can the phone reach the desktop over the plain LAN on eduroam?

Not in the spike: persistence of edits, sync, attachments, SAF, full experiment view.

## What is here

| File | Purpose |
| --- | --- |
| `src/agenda.ts` (+ `agenda.test.ts`) | Scheduled phases from the bundled `seed/lab_state.json`: today first, then upcoming, then past |
| `src/App.tsx` | Agenda, phase screen with the **unmodified** desktop `SectionTextEditor`, and the sync probe screen |
| `src/graph.ts` | Sign-in (authorization code + PKCE, personal accounts), the Graph checks, and the URL probe (`lanProbe`) used for both the Tailscale and the plain LAN checks |
| `android/` | Generated Capacitor project. Manifest adds the sign-in redirect, `adjustResize`, `allowBackup=false`, and cleartext for the plain LAN probe (spike only; Tailscale is HTTPS and does not need it) |

The editor is imported straight from `../frontend/src`; `vite.config.ts` dedupes React/TipTap so
only `mobile/node_modules` copies are bundled (checked: one React, one TipTap in the build).

## One-time setup

1. **Android Studio** (bundles JDK and SDK; this machine had neither). Enable USB debugging on the phone.
2. **Tailscale** (needed for the Tailscale checks). Create a personal tailnet (free) and sign in to
   it from the lab PC (Windows client from tailscale.com; note whether the install needed admin
   rights, which is check T1) and from the phone (Tailscale app from the Play Store). In the admin
   console, enable **MagicDNS** and **HTTPS certificates**, which `tailscale serve` needs.
3. **App registration** (needed only for the Graph checks, so skip it if the Tailscale checks pass). Not in the institution tenant: use an Entra
   tenant you own (a free Azure account creates one) at https://entra.microsoft.com > App registrations > New:
   - Supported account types: **Personal Microsoft accounts only**
   - Platform: **Mobile and desktop applications**, custom redirect URI `org.benchflow.companion://auth`
   - API permissions: Microsoft Graph, delegated, `Files.ReadWrite` and `offline_access` (no admin consent needed for personal accounts)
   - Copy the Application (client) ID.
4. `cp .env.example .env.local` and set `VITE_GRAPH_CLIENT_ID` (Graph checks only).
5. `npm install`

## Run

```
npm test             # agenda ordering
npm run android      # build, sync into android/, open Android Studio; then Run on the phone
```

Tailscale probe target on the lab PC: a throwaway page bound to localhost only, published to the
tailnet over HTTPS (never `tailscale funnel`, which would put it on the public internet):

```
python -m http.server 8765 --bind 127.0.0.1
tailscale serve --bg 8765
```

`tailscale serve status` prints the URL (`https://<pc>.<tailnet>.ts.net/`). Enter it as the
**Desktop URL** in the app and use **Probe LAN** (the same probe works for any URL). Afterwards run
`tailscale serve reset` and stop the Python server.

Plain LAN probe target on the desktop (any PC on the same network; allow it through the Windows
firewall prompt, and stop it afterwards):

```
python -m http.server 8765 --bind 0.0.0.0
```

Enter `http://<desktop IP>:8765/` in the app (`ipconfig` shows the IP).

## Test script

Run the Tailscale checks (T) first. If T1-T4 pass, the Graph checks (G) are optional.

Graph, in the Sync probe tab: **Sign in** with the personal account, then **Run checks**. Each run
logs `network=wifi|cellular` and PASS/FAIL per step: token (cached/refreshed), create, read,
overwrite, list, delete, gone. Every probe, Tailscale and LAN included, goes to the same log, which
persists across restarts; **Copy log** to paste results below.

| # | Check | Result |
| --- | --- | --- |
| T1 | Tailscale installs and stays connected on the lab PC (record whether the install needed admin rights) | Partial (dev PC `desktop-vufjor6`, not the lab PC): installed and connected; `tailscale serve --bg 8765` then `curl https://desktop-vufjor6.taildde081.ts.net/` gave HTTP 200 with a valid certificate (first request 31 s while the cert was issued). Admin rights not recorded. Lab PC still to do |
| T2 | Probe the `https://<pc>.<tailnet>.ts.net/` URL on **eduroam**: PASS, HTTP 200 | Not eduroam yet. On home Wi-Fi (same LAN as the PC), probing the real sync app (`app/mobile_sync/api.py`, `/api/mobile/health` behind `tailscale serve`): PASS x3, HTTP 200, 146/53/41 ms, `network=wifi`. **Eduroam still to do**: it is the case that matters (client isolation) |
| T3 | Same on **mobile data** (Wi-Fi off) | PASS x3, HTTP 200, 393/92/78 ms, `network=cellular` (LTE). Also a full sync round trip from the app's WebView over cellular: pair with a one-time code, no-token call refused (401), pull 5 experiments, push a notes op (`applied`), replay it (`duplicate: true`), pull again (the edit came back at rev 7). 849 ms for all of it |
| T4 | Let the PC sleep, wake it, probe again without touching the phone's Tailscale app | Not run: the PC running the tests cannot sleep itself |
| T5 | Tailscale on the phone alongside any VPN the phone must use (Android allows one VPN at a time): works / clashes / no VPN needed | Tailscale is the only VPN on the phone. Whether the institution requires another one: for you to answer |
| T6 | Latency: note the probe's ms on eduroam and on mobile data (direct or relayed: `tailscale status` on the PC shows `direct` or `relay`) | Home Wi-Fi: direct (LAN `192.168.1.75`), `tailscale ping` 11 ms, probe 41-146 ms. Mobile data: **direct** over IPv6 (no DERP relay), `tailscale ping` 348 ms, probe 78-393 ms. Eduroam to do |
| G1 | Sign in with a personal Microsoft account on the phone | Skipped: Tailscale passed T3 and the home-Wi-Fi T2; Graph is only the fallback |
| G2 | Run checks on **eduroam** | |
| G3 | Run checks on **mobile data** (Wi-Fi off) | |
| G4 | Leave the app in the background > 1 h, run checks again: token step says `refreshed` and all pass | |
| G5 | Kill the app, reopen, run checks without signing in again | |
| G6 | The probe file appears in the desktop's OneDrive folder while it exists (watch the folder during a run, or comment out the delete step) | |
| L1 | Probe LAN on eduroam | Not run (not on eduroam) |
| L2 | Probe LAN on a home/lab Wi-Fi (if available) | Not run: it needs a listener on all interfaces and a Windows Firewall prompt on the PC. Plain LAN is not planned anyway |
| E1 | Agenda opens; today's phases at the top match what desktop's calendar shows today | Opens. Today (0) matches desktop for 2026-11-20. **Bug:** all 46 "Upcoming" rows are past phases whose dates are stored as `Friday, January 12, 2024` (OneNote import), not `YYYY-MM-DD`, so they sort as text after today. Desktop's calendar also compares strings and does not show them at all. Fix the data (normalize dates in a migration) rather than the agenda. Also fixed during the run: the list did not scroll and the tab bar was off-screen (`#root` had no height under the desktop CSS's `body { overflow: hidden }`) |
| E2 | Open a long protocol: scroll, place cursor mid-text, type; keyboard does not cover the cursor | PASS (10.5k-char protocol): tapped a line near the bottom, the view resized above the keyboard and the caret stayed visible; typing went in at the caret. But the toolbar is 3 rows (4 inside a table), so only about 5 lines of text show with the keyboard up |
| E3 | Select text: bubble menu usable, bold/italic/link work | PASS with a snag: on long-press, Android's own Cut/Copy/Translate bar covers the bubble menu until the first toolbar tap. Bold (toolbar), italic and link (bubble menu) all applied. The link and equation inputs auto-capitalize (`https://` became `Https://`); they need `autocapitalize="off"` |
| E4 | Toolbar: headings, lists, table add row/column usable by touch | PASS: the heading dropdown opens Android's native picker (Heading 2 applied), bullet list toggles, table inserted 3x3, Add row and Add column took it to 4x4, typing in a cell works. Four columns are narrow on a phone |
| E5 | Math: existing inline/block math renders; editing it works | PASS: inserted inline math rendered with MathJax (SVG); tapping it selects it, the Σ button opens Edit equation with the LaTeX, and the change applied. No math in the seed notebook to check existing content |
| E6 | Rotation and keyboard show/hide keep the cursor and text | PASS for state: text, focus and caret position kept through portrait -> landscape -> portrait and keyboard hide. **Landscape with the keyboard up shows no text at all**: header + toolbar fill the 132 px left |
| E7 | Back button returns to the agenda; again exits | PASS (first Back hides the keyboard, the next returns to the agenda, the next exits) |
| E8 | Cold start time to agenda (seconds) | about 0.6 s: activity 0.40-0.41 s (`am start -W`, 3 runs), then first contentful paint 0.2 s later |

Run 2026-11-20 over USB adb (screens and WebView inspected through DevTools), PC `desktop-vufjor6`
on home Wi-Fi, not the lab PC and not eduroam. The sync target was the real phone sync app with a
throwaway notebook, published with `tailscale serve --bg 18766`, reset afterwards.

Device / Android version / WebView version: Pixel 10 Pro / Android 17 (SDK 37) / WebView 157.0.8103.50

## Decision (fill in)

- Transport: **Tailscale (decided 2026-11-20).** Passes on mobile data and home Wi-Fi, including a
  full sync round trip. `desktop-vufjor6` is the in-lab PC, so T1 is this machine; the owner already
  uses Tailscale on eduroam daily, so T2 is taken as passing. T4 (sleep/wake) was not run. The
  OneDrive relay and the Graph code are dropped.
- Editor: **usable, needs a mobile toolbar.** Editing, formatting, tables, math and rotation all
  work with the desktop editor unchanged; the 3-4 row toolbar leaves too little text on screen with
  the keyboard up, and none in landscape. Also turn off auto-capitalize in the link/equation inputs.
- Plain LAN: not tested on eduroam.
- Data: OneNote-imported phase dates (`Friday, January 12, 2024`) need normalizing to `YYYY-MM-DD`
  before the agenda (or desktop's calendar) can place them.

If any of T1-T4 fail (or T5 clashes with a VPN the phone must keep), run the Graph checks. If
G2-G5 fail too, retry them with SAF (OneDrive app's document provider) before choosing another
relay, as the plan says.
