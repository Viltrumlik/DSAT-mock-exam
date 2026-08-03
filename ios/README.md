# MasterSAT for iOS

Native SwiftUI student app for the MasterSAT platform.

```
ios/
  MasterSATKit/     Swift package — API client, models, runners. Builds and tests WITHOUT Xcode.
  MasterSAT/        SwiftUI app target. Needs Xcode.
```

## What the app is for

It deliberately does **not** host the timed sittings. Mocks, invigilated sittings, midterms,
past papers, practice packs and the question bank are three-hour papers sat on a laptop
under exam conditions, and a phone is the wrong instrument for them.

What it does host is the daily loop: what was set, working through it, and learning words.

| Tab | Holds |
| --- | --- |
| **Home** | Today, homework due, and midterm results |
| **Learn** | Classroom, Homework, Assessments |
| **Words** | Assigned sets, the whole word bank, the student's own sets |
| **Profile** | Account, target score, sign out |

Midterm **results** still land here even though the paper was not sat here — a score is
worth checking anywhere. An unreleased one says so rather than showing a blank, because a
blank reads as a zero.

## Why the split

Everything correctness-critical — the API client, the token pair, answer sequencing, the
vocabulary game rules — lives in `MasterSATKit`, a plain Swift package with no UI. It
builds and runs its tests with the command-line toolchain alone:

```bash
cd ios/MasterSATKit && swift test
```

90 tests, well under a second. This is the part that must never regress, so it is also the
part that stays verifiable from a terminal, in CI, with no simulator.

`MasterSAT` is the SwiftUI layer on top. It needs Xcode, because an iOS `.app` cannot be
produced by SwiftPM.

## Opening the project

The project is described by `MasterSAT/project.yml` (XcodeGen) rather than a checked-in
`.xcodeproj`, which keeps the file reviewable and avoids merge conflicts in a generated
plist:

```bash
brew install xcodegen
cd ios/MasterSAT && xcodegen generate && open MasterSAT.xcodeproj
```

Signing is the usual first stop: select the MasterSAT target → Signing & Capabilities →
pick a team. `uz.mastersat.app` may already be taken on another account, in which case
change `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` and regenerate.

### Running against a local backend

```bash
cd backend && python3 manage.py migrate && python3 manage.py runserver 0.0.0.0:8000
```

```bash
xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"
```

`-apiBaseURL` lands in `UserDefaults`, which `Session.defaultConfig()` reads — in DEBUG
builds only, so a shipped app can never be pointed at another host. ATS permits this via
`NSAllowsLocalNetworking`, which covers localhost and `.local` without relaxing anything on
the internet.

Build with signing enabled. `CODE_SIGNING_ALLOWED=NO` produces an unsigned bundle with no
entitlements, and the Keychain then refuses every write — the app signs in and is
immediately signed out again.

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

One more, added later: `/api/classes/my-assignments/` hand-rolls its payload for batching
rather than going through `AssignmentSerializer`, and never populated `vocab_homeworks` —
so a homework whose entire content was a word set arrived looking empty. It is now batched
in alongside the assessments, in its own `try` block so an assessments failure cannot take
vocabulary down with it.

## The assessment runner

This is the app's only runner, and it is not a cut-down exam engine — an assessment is a
different object. There is no clock and there are no modules: it is a set of questions
saved **one answer at a time** through `/assessments/attempts/answer/`.

What it borrows from the web runner is the discipline about saving, and the chrome a
student actually reaches for on a long set:

- **`client_seq` per question.** The server keeps the highest sequence it has seen, so an
  answer that overtakes its own replacement on the wire is dropped rather than winning.
- **Typing coalesces, choices do not.** A tapped choice is a complete thought and goes at
  once; a grid-in would otherwise cost one request per keystroke.
- **Submit flushes first.** A submit that races an unsent answer grades work the server
  never saw.
- **Failed writes are named, not hidden.** A question whose write failed is remembered,
  retried on the next flush, and said out loud.
- **Question map** — every question at a glance, answered / flagged / blank, tap to jump.
- **Zoom, 70%–150%.** Applied as a bigger root font inside the rendered document, not a
  SwiftUI `scaleEffect`: scaling would blur the text and leave the frame the wrong size,
  while a bigger font reflows, exactly as the web's CSS `zoom` does.
- **Desmos** on maths sets — see below.

`question_order` is per *attempt*: two students can be served the same set in different
orders, and the answers were recorded against theirs. Never sort by `order` instead.

## Deliberate decisions

**Question content renders in a `WKWebView`.** Questions are authored once, as HTML with
embedded math. Porting a math renderer to Swift would be a second implementation of *how a
question looks*, and the first time the two disagreed a student would be answering a
different question on their phone than on their laptop. So the content is rendered by the
same engine the web uses — with JavaScript disabled, no navigation, no network — and
everything around it is native.

**Desmos is the real Desmos.** There is no version of "write our own graphing calculator"
that a student should trust in a maths assessment, so the calculator is `calculator.js`
from Desmos in a `WKWebView`, with the same options and the same key the web runner uses.
It is a separate view type from the content renderer *on purpose*: that one runs no
JavaScript and reaches no network, and must not quietly become a general-purpose browser
because one screen needed one. Offered on maths sets only — the rule the platform applies
everywhere else. Desmos measures its container once at mount, so the page runs a
`ResizeObserver`; without it the calculator mounts at zero height inside an animating
sheet and stays blank.

**Vocabulary runs in a focus shell.** No tab bar, no status bar, no home indicator, the
screen kept awake, one thing on screen at a time, and type sized for a phone held at arm's
length. All four study modes ship. The pure rules — round chunking, distractor picking,
pair matching — are in the kit and tested; a distractor is never a word that *means* the
same thing, because that is a second correct answer rather than a wrong one.

**Leaving the foreground flushes.** Backgrounding is the phone's version of closing the
tab, and iOS can kill a backgrounded app without warning. A half-finished vocabulary run
flushes as `partial: true` so 20 of 25 cards still count; an assessment writes every
pending answer before it goes.

## Verification status

| Component | Status |
| --- | --- |
| `MasterSATKit` — build + tests | ✅ 90 tests |
| Backend (`classes`) | ✅ 307 tests |
| `MasterSAT` app target — build | ✅ builds for the simulator (Xcode 26.3) |
| Sign in → home → homework → assessment → submit → review | ✅ driven against a local backend |
| Classroom (roster, materials, leaderboard) | ✅ driven on the simulator |
| Vocabulary — Flashcards, Matching, Speed | ✅ driven on the simulator |
| Desmos — graphing and scientific | ✅ driven on the simulator |
| Vocabulary custom-set builder | ✅ search driven; save verified against the API |

Two pre-existing failures in `users.tests.test_role_escalation_and_scoping` were confirmed
present on a clean tree and are unrelated to this work.

## Not built

- The question map is built and the build is clean, but it was never opened on a device —
  the simulator bridge went unreliable at the end of that session.
- Editing an existing custom vocabulary set. They can be built and deleted, not renamed.
- Push notifications. There is no push transport server-side yet; this needs APNs plus a
  sender, not just client work.
- Offline reading of already-fetched homework.

Homework photos are uploaded as the picker returns them, EXIF and all. Stripping location
metadata before it reaches a school server would be a sensible next step.

## Removed, and where to find it

The full SAT exam engine — `ExamRunner`, `ExamClock` (`mach_continuous_time()`, so locking
the phone could not buy a student time), the autosave delay table, draft recovery, snapshot
merging, 409 adoption — was ported, tested, and then deleted along with the sittings it
served. It is in the history: `git show b64b3973 -- ios/MasterSATKit/Sources/MasterSATKit/Exam/`.
