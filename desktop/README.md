# MasterSAT — the Windows exam app

A small [Tauri v2](https://v2.tauri.app) shell around the website. Its one window loads
`https://mastersat.uz/desktop` and the site runs inside it exactly as it does in a browser — but
in the app the pages reach a native layer a browser cannot: a machine pre-check, a keyboard lock,
a signed lockdown proof, the battery, and "Sign in with browser". Students without Windows sit the
same midterms in a browser under a teacher-granted exemption (the server half already shipped).

This directory is **only the native shell**. The server half (`backend/desktop/`) and the web pages
it loads (`frontend/src/app/desktop/`, `frontend/src/lib/desktop/`) live in the main app and are
already merged behind the `MIDTERM_DESKTOP_REQUIRED` flag.

## How it fits together

```
 Windows app (this dir)                    mastersat.uz (already shipped)
 ┌───────────────────────────┐             ┌───────────────────────────────┐
 │ Tauri window              │  loads ───▶ │ /desktop/*  (React pages)      │
 │  └ src-tauri/src/         │             │  └ lib/desktop/bridge.ts       │
 │     commands → invoke  ◀──┼── invoke ───┼──  desktop.enter()/prove()/... │
 │     proof.rs (HMAC)       │             │ backend/desktop/ (DRF)         │
 │     lockdown.rs (Win32)   │             │  proof.py  verifies the proof  │
 └───────────────────────────┘             └───────────────────────────────┘
```

- **The contract is fixed by the other half.** The command names and payloads are exactly those
  `frontend/src/lib/desktop/bridge.ts` calls; the proof arithmetic is exactly
  `backend/desktop/proof.py`. `src-tauri/src/proof.rs` runs the *same* fixed vectors as the server's
  `tests_desktop.ProofVectorTests`, so the two halves cannot drift silently.
- **Only mastersat.uz can drive the lockdown.** `src-tauri/capabilities/mastersat.json` grants the
  native commands to the remote origin `https://mastersat.uz` and to no other; `build.rs` registers
  the commands so the ACL is per-command. Any other site opened in the window gets nothing.

## What the lockdown does (and cannot do)

On `lockdown_enter`, after a passing pre-check, the shell: makes the window full-screen and topmost,
swallows **Alt+Tab / Windows key / Menu key / Alt+F4 / Ctrl+Esc**, keeps the machine awake, and asks
Windows to exclude the window from screen capture (`WDA_EXCLUDEFROMCAPTURE`). A background watcher
reports absences the page can't see (focus stolen, a second monitor plugged in) as the
`mastersat:away` DOM event the off-screen guard already listens for. If the page stops sending
`lockdown_heartbeat` for 10 seconds, the shell releases on its own so no one is ever trapped.

It **cannot** block Ctrl+Alt+Del — the secure attention sequence is reserved by Windows. That gap is
exactly what the server's three-strike off-screen rule covers. The pre-check (`displays`, `remote`,
`vm`, blocked apps) is **evidence, not a wall**: the shell refuses to lock a failing machine, and the
server stores the report, but a determined attacker who reverse-engineers the build is stopped by key
rotation, not by the pre-check.

## Building the installer

There is **no cross-compile**: a Tauri Windows installer is built on Windows. CI does this for you —
`.github/workflows/desktop.yml` builds the NSIS installer on `windows-latest` and uploads it as the
`MasterSAT-Setup` artifact; a Linux job runs the proof vectors on every change. Download the artifact
and publish it to the release's `downloads/desktop/MasterSAT-Setup.exe`, which is where
`routes.ts` (`DESKTOP_DOWNLOAD_URL`) points.

To build locally on a Windows machine:

```powershell
cd desktop
npm ci
npm run icons   # tauri icon app-icon.png -> src-tauri/icons (git-ignored, regenerated each build)
npm run build   # -> src-tauri/target/release/bundle/nsis/*.exe
```

`app-icon.png` is a placeholder; replace it with the real artwork and re-run `npm run icons`.

## The signing key

The proof's strength is the secrecy of a key that ships inside the `.exe`, so it stops a student
opening a midterm in Chrome — not someone who reverse-engineers the build. Keys therefore rotate with
releases, and the build's version is part of what is signed.

- **Production:** CI injects `DESKTOP_PROOF_KEY` (repo secret, format `key_id:hex`) at compile time.
  Add the same `key_id:hex` to the server's `DESKTOP_PROOF_KEYS` (which holds every key still
  accepted, comma-separated) *before* shipping the build.
- **Development:** without that secret the build embeds a clearly-labelled `dev1` key. A production
  server does not list it, so a dev build cannot prove against production.

## Requirements this build pins

`tauri` is pinned to **>= 2.11.1**. Below it, a remote origin could invoke custom commands with no
capability, and remote URLs were misclassified as trusted local origins on Windows
(CVE-2026-42184) — either of which would let a page that is *not* mastersat.uz drive the lockdown.
Do not relax this floor.
