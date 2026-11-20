# Phase 0 spike: Android companion

Throwaway-quality code to answer the questions that gate the plan
(`../android_implementation.md`, section 5, phase 0):

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
| T1 | Tailscale installs and stays connected on the lab PC (record whether the install needed admin rights) | |
| T2 | Probe the `https://<pc>.<tailnet>.ts.net/` URL on **eduroam**: PASS, HTTP 200 | |
| T3 | Same on **mobile data** (Wi-Fi off) | |
| T4 | Let the PC sleep, wake it, probe again without touching the phone's Tailscale app | |
| T5 | Tailscale on the phone alongside any VPN the phone must use (Android allows one VPN at a time): works / clashes / no VPN needed | |
| T6 | Latency: note the probe's ms on eduroam and on mobile data (direct or relayed: `tailscale status` on the PC shows `direct` or `relay`) | |
| G1 | Sign in with a personal Microsoft account on the phone | |
| G2 | Run checks on **eduroam** | |
| G3 | Run checks on **mobile data** (Wi-Fi off) | |
| G4 | Leave the app in the background > 1 h, run checks again: token step says `refreshed` and all pass | |
| G5 | Kill the app, reopen, run checks without signing in again | |
| G6 | The probe file appears in the desktop's OneDrive folder while it exists (watch the folder during a run, or comment out the delete step) | |
| L1 | Probe LAN on eduroam | |
| L2 | Probe LAN on a home/lab Wi-Fi (if available) | |
| E1 | Agenda opens; today's phases at the top match what desktop's calendar shows today | |
| E2 | Open a long protocol: scroll, place cursor mid-text, type; keyboard does not cover the cursor | |
| E3 | Select text: bubble menu usable, bold/italic/link work | |
| E4 | Toolbar: headings, lists, table add row/column usable by touch | |
| E5 | Math: existing inline/block math renders; editing it works | |
| E6 | Rotation and keyboard show/hide keep the cursor and text | |
| E7 | Back button returns to the agenda; again exits | |
| E8 | Cold start time to agenda (seconds) | |

Device / Android version / WebView version: 

## Decision (fill in)

- Transport: Tailscale / Graph relay / SAF via OneDrive app / other:
- Editor: usable as is / needs a mobile toolbar / needs a different editor:
- Plain LAN: works on eduroam yes/no:

If any of T1-T4 fail (or T5 clashes with a VPN the phone must keep), run the Graph checks. If
G2-G5 fail too, retry them with SAF (OneDrive app's document provider) before choosing another
relay, as the plan says.
