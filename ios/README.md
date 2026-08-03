# MasterSAT for iOS

Native SwiftUI student app for the MasterSAT platform, including a full native exam runner.

```
ios/
  MasterSATKit/     Swift package — API client + exam engine. Builds and tests WITHOUT Xcode.
  MasterSAT/        SwiftUI app target. Needs Xcode.
```

## Why the split

Everything correctness-critical — the API client, the attempt state, the autosave timing,
draft recovery, snapshot merging, the clock — lives in `MasterSATKit`, a plain Swift
package with no UI. That package builds and runs its tests with the command-line toolchain
alone:

```bash
cd ios/MasterSATKit && swift test
```

73 tests, ~1.5s. This is the part of the app that must never regress, so it is also the
part that stays verifiable from a terminal, in CI, with no simulator.

`MasterSAT` is the SwiftUI layer on top. It needs Xcode, because an iOS `.app` cannot be
produced by SwiftPM.

## Opening the project

Xcode is not currently installed on this machine (only Command Line Tools), so the app
target has **never been compiled** — see *Verification status* below.

The project is described by `MasterSAT/project.yml` (XcodeGen) rather than a checked-in
`.xcodeproj`, which keeps the file reviewable and avoids merge conflicts in a generated
plist:

```bash
brew install xcodegen
cd ios/MasterSAT && xcodegen generate && open MasterSAT.xcodeproj
```

Xcode itself is required to build and run: install it from the App Store, then
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

## Verification status

Be precise about this, because "it compiles" and "it is written" are different claims.

| Component | Status |
| --- | --- |
| `MasterSATKit` — build | ✅ `swift build` clean |
| `MasterSATKit` — tests | ✅ 73 tests passing |
| Backend native-auth change | ✅ 10 Django tests passing |
| `MasterSAT` app target — syntax | ✅ `swiftc -parse` clean on all files |
| `MasterSAT` app target — type check / build | ❌ **not run** — requires Xcode |
| On-device / simulator run | ❌ **not run** — requires Xcode |

Expect to fix ordinary compile errors on the first build of the app target. The kit it
depends on is exercised by tests; the view layer is not.

## Backend contract

The app authenticates as a **native client**: it sends `X-MasterSAT-Client` on every
request, holds the token pair in the Keychain, and sends `Authorization: Bearer`. It never
uses cookies.

That required three backend changes (`backend/users/auth_cookies.py`,
`backend/config/csrf_api.py`, `backend/users/views.py`):

1. CSRF is skipped only when a request declares the header **and** carries no auth cookie.
   CSRF defends against *ambient* credentials; a request with no cookie has none to forge.
   A browser that somehow sent the header still has cookies, so it stays fully enforced.
2. A native login sets no cookie at all and returns the token pair in the body — so an
   exempted login cannot plant a session in a browser either.
3. `/api/auth/refresh/` returns the **rotated** refresh token to native clients. Rotation
   revokes the token it spends, and without the replacement the app would be locked out at
   its first renewal, three hours in.

`/api/auth/logout/` now also accepts the refresh token in the body, so signing out on a
phone actually revokes that session.

## Deliberate decisions

**Question content renders in a `WKWebView`.** Questions are authored once, as HTML with
embedded math. Porting a math renderer to Swift would be a second implementation of *how a
question looks*, and the first time the two disagreed a student would be sitting a
different exam on their phone than on their laptop. So the content is rendered by the same
engine the web runner uses — with JavaScript disabled, no navigation, no network — and
everything around it is native: timer, navigation, answer state, autosave, submission.

**No fullscreen lock.** iOS gives an app no way to stop the student leaving it. The web
runner leans on browser fullscreen; the platform's real equivalent is Guided Access, which
only the student can turn on. The pre-exam screen asks for it on invigilated sittings
rather than pretending the app can enforce it.

**The clock keeps running while the phone sleeps.** `ExamClock` reads
`mach_continuous_time()`, not `systemUptime` — the latter stops during sleep and would
hand a student free time by locking their screen. It re-anchors on every server snapshot,
so local drift can never exceed one poll interval.

**Leaving the foreground flushes and reports.** Backgrounding is the phone's version of
closing the tab, and iOS can kill a backgrounded app without warning. On `.background` the
runner stands the autosave down, pushes a `background: true` save, and — on a proctored
sitting — reports the off-screen event. The server owns the violation count, because a
tally kept on the device resets with the app.

## What the runner ports, and why each rule exists

From `frontend/src/features/testing-simulation`, faithfully, comments included:

- **Autosave delay table.** A discrete choice sends at 0ms; grid-in typing coalesces for
  400ms but is never held past 1.2s from the first unsent keystroke; flags and bulk
  rehydration take the 1.5s debounce; a 300ms floor stops rapid tapping becoming a request
  storm. A flat debounce once meant an answer chosen in a module's last second existed only
  in the submit payload.
- **Payload signature as JSON.** With a separator that can occur in the data,
  `{"3":"12"} + flagged[5]` and `{"3":"125"} + flagged[]` sign identically — so a changed
  answer reads as "already sent" and is dropped in silence.
- **Draft merge by recency.** The server wins on conflicts only when strictly newer; the
  draft always fills gaps. The rule this replaced — "server wins if it has anything" —
  discarded exactly the answers the draft exists to save.
- **Forward-only snapshots.** Lower version, or a module-order regression while active, is
  refused, so a slow response cannot rewind the exam.
- **409 adoption.** A conflict adopts the canonical attempt and re-arms, instead of
  retrying a version it has already lost.
- **`module_id` on submit.** The server no-ops a submit aimed at a module the attempt has
  left. It is the only thing between a retried request and a skipped section.
- **Single-flight token refresh.** Three requests meeting a 401 together produce one
  refresh; rotation revokes the token it spends, so a second caller would present a dead
  one and sign the student out mid-exam.

## Not built yet

Scoped out of this pass, in rough priority order:

- Midterm and pastpaper runners. The engine already speaks all three backends
  (`ExamBackend.midterms` / `.exams`); only the entry points and the midterm's start-code
  and rules screens are missing.
- Homework **submission** (file upload) — the list and status are read-only today.
- Vocabulary study modes.
- Review Center / per-question review after scoring.
- Push notifications. There is no push transport server-side yet; this needs APNs plus a
  sender, not just client work.
- Offline reading of already-fetched homework.
