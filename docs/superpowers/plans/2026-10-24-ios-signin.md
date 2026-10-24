# iOS sign-in: minimal login, no Register, lc-up first sign-in

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` — a fresh
> implementer per task, a review after each task, then one whole-branch review and one fix wave.

**Goal.** Replace the app's `/login` + `/register` pair with one quiet sign-in page (look C), take
Register out of the app entirely, let the one identity field take a phone number, and teach the
profile-completion gate the two lc-up steps (`password`, `lcup_phone`) that currently leave those
students stuck forever.

**Branch.** `claude/ios-signin-c7ef34`, cut from `main` (`95c62b39`, which carries the whole
redesign: #304 → #311 plus #312).

**No backend change.** Every endpoint below exists and is live. Google and Telegram stay off.

**Approved in chat (2026-10-24, owner).** Piece 1 of a four-piece round; the design was approved
section by section and is copied into **Approved design** below so this plan stands alone. The other
pieces run in parallel sessions (`ios-header-windows`, `ios-onboarding`, `ios-parity-fixes`,
`ios-test-results`) — see **Files other sessions own**.

---

## Approved design (owner, 2026-10-24)

1. **Look C, minimal.** The third card of
   `ios-redesign/.superpowers/brainstorm/74526-1792779410/content/login-look.html` (untracked, in the
   primary checkout). The whole page, top to bottom:
   - white page (the mockup's `#fff`, not the grouped grey);
   - centred brand mark in a 56×56 brand-blue rounded square (radius 16), keeping phase 4's
     `LogoArrival` spring;
   - "Sign in" (22 pt heavy, tracking −0.4), and under it "MasterSAT Center" (12 pt, secondary);
   - two **soft grey** fields (the mockup's `#f4f5f8`, as a token so dark mode follows), no visible
     border, radius 12: "Phone, email or username", then "Password" with the existing show/hide eye;
   - a full-width brand-blue "Sign in" button;
   - two quiet centred lines, secondary, with the second half of the first line in brand blue:
     "Forgot your password? **Your centre resets it.**" and "No account yet? Your learning centre
     creates it for you." **Text only — no buttons, no disclosure.** The owner chose this: the centre
     does both jobs, so there is nothing for the student to tap.
   - **No marketing panel.** `BrandPanel`, `Brand.promises` and `FloatingShapes` leave the sign-in
     screen, and `BrandPanel` is deleted. Only `BrandMark` is kept: once the panel goes, the
     `Brand` gradient enum, `BrandLockup` and `AuthField` have **no** remaining user either
     (About tints `BrandMark` itself, the update screen loads `Image("BrandMark")`, and the gate
     uses `AccountTextField`), so they go too — an earlier draft of this plan wrongly kept them.
2. **Appearance.** The screen follows the Appearance setting (System / Light / Dark, phase 5's
   `appliesStoredAppearance`). Dark mode must be readable: any inverted fill uses the
   `Theme.ink` / `Theme.onInk` pair, never `.white` on a colour that lightens.
3. **Register is gone.** No `.register` mode, no `RegisterForm`, no `Session.register`, no kit
   `AuthService.register` / `RegisteredAccount`. The app is for learning-centre students, whose
   accounts the centre creates.
4. **One identity field** takes a phone, an email or a username. The server already accepts all
   three (`users/backends.py:_phone_username` normalises `+998 90 123 45 67` to the `998…` username;
   `lcup/auth_backend.py` signs an lc-up account in with phone + last four digits).
5. **Phase 4's sign-in behaviour is kept**: a wrong password shakes the password field with a warning
   haptic and a spoken alert; "cannot reach the server" never shakes; a public (non-centre) account
   shows the server's own 403 sentence ("This app is for learning center students. Please use
   mastersat.uz in your browser.", `users/audience.py:71`).
6. **lc-up first sign-in**, in the website's order and on the website's endpoints
   (`frontend/src/components/ProfileCompletionGate.tsx:71-81`):
   `password` → `lcup_phone` (with "Bu men emasman") → names → email.
   The phone step's copy is **Uzbek, verbatim from the website** — it is the one screen whose words
   the owner wrote for the number an administrator holds, and a second translation would be a second
   meaning.

---

## Current state and why the gate traps students

- `MasterSATKit/Account/AccountRules.swift:33-52` — `ProfileCompletion.Step` is `.names | .email`,
  and `firstStep(missing:)` sends anything that is not a name field to `.email`.
- `Screens/Account/CompleteProfileView.swift` renders exactly those two steps.
- The server's `missing_fields` is `extra + missing` (`users/profile_completeness.py:69-74`), and the
  extras are `password` (`lcup/claims.py:18-24`) and `lcup_phone`
  (`lcup/phone_confirm.py:37`, `REQUIREMENT = "lcup_phone"`).
- So an lc-up student who signs in with phone + last four digits gets `missing_fields == ["password"]`
  → the app shows the **email** step, whose "Confirm" cannot clear `password`. The gate never lifts,
  and the only way out is "Not now — log out". **This is the bug this piece fixes.**

### The two endpoints (both `IsAuthenticated`, both reached from behind the gate)

| Step | Call | Answers |
| --- | --- | --- |
| password | `POST /api/lcup/claim/password/` `{"password": "…"}` | `204`; `400 {"password": ["…"]}` (too short / Django validators); `403 {"detail": "There is no first password to choose for this account."}` |
| phone | `POST /api/lcup/claim/phone/` `{"phone": "…"}` | `200 {"moved": true/false}`; `400 {"phone": ["…mos kelmadi…••NN…"], "hint": "NN"}`; `403` nothing to confirm; `409` account linked to another student; `429` too many tries |
| not me | `POST /api/lcup/claim/phone/` `{"not_me": true}` | `204`; `403 {"detail": NOTHING_TO_CONFIRM}` |

Facts that shape the app's behaviour:

- Setting the first password **does not** end the session (`lcup/claims.py:set_initial_password` only
  writes `password` + `password_set_at`; no `last_password_change`, no session revocation — unlike
  `/auth/password/change/`). So the gate continues straight to the next step; the app must **not**
  sign out.
- Neither answer carries the verdict, so each step re-reads it: `GET /users/me/` via
  `AccountAPI.profile()` (what the web's `invalidateMe` does), then re-derives the next step. That is
  already how `CompleteProfileView.afterEmailConfirmed()` works.
- A `moved: true` phone confirmation starts a Celery job server-side (`follow_student`); the app shows
  nothing extra for it — the marks arrive when they arrive.
- `/api/lcup/claim/password/` is allowlisted on the teacher console only (`access/host_guard.py:380`);
  the app talks to the main host, which is permissive. No guard change needed.

---

## Files

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):

- `Auth/AuthService.swift` — **delete** `register`, `RegisteredAccount`, `RegisterRequest`.
- `Account/AccountRules.swift` — `ProfileCompletion.Step` gains `.password` and `.phone`;
  `needsPassword`/`needsPhone`; `firstStep` becomes the four-step order; new `next(after:missing:)`;
  new `InitialPasswordCheck` and `PhoneClaimEntry`; new sentences on `AccountCopy`.
- `Account/LcupClaimAPI.swift` — **new.** `setInitialPassword(_:)`, `confirmPhone(_:) -> PhoneClaim`,
  `sayNotMe()`, and `PhoneClaimRefusal` (`nothingToConfirm`, `wrongNumber(hint:)`, `linkedElsewhere`,
  `tooManyTries`) carrying the server's own sentence.

Kit tests (`ios/MasterSATKit/Tests/MasterSATKitTests/`):

- `AccountTests.swift` — the extended `ProfileCompletion` suite.
- `LcupClaimTests.swift` — **new.** The API (bodies, 204, each refusal) and both checks.
- `AuthAndStudentTests.swift` — the five `register` tests go (nothing is left to test).

App (`ios/MasterSAT/`):

- `Sources/Screens/Auth/AuthView.swift` — rewritten: `AuthView` is the look-C page and the sign-in
  form; `RegisterForm` and `Mode` are gone.
- `Sources/Screens/Auth/AuthChrome.swift` — `BrandPanel`, `PromiseRow`, `FloatingShapes`,
  `Brand.promises` deleted; `SoftField` added (the look-C grey box); `AuthField`, `AuthAlert`,
  `PasswordField`, `BrandMark`, `BrandLockup`, `Brand.top/bottom/panel` stay (the gate, About, the
  update screen and `AccountEmailVerification` use them). `AuthFocus` loses the register-only cases.
- `Sources/App/MasterSATApp.swift` — `Session.register` deleted (~206-224).
- `Sources/Screens/Account/CompleteProfileView.swift` — the two new steps, the four-step order, and
  one `advance(from:)` that reads the fresh profile after every save.

Docs: this plan. No spec doc (owner's rule).

### Files other sessions own — stay out

`Shell/AppHeader.swift` (`ios-header-windows`), `Screens/RootView.swift` (`ios-onboarding`,
`ios-parity-fixes`), the Me sheet's Settings (`ios-onboarding`). This piece needs none of them:
`RootView` already mounts `AuthView(notice:)` and `CompleteProfileView(user:onDone:)` with the same
signatures, which do not change. Before the PR, `sync_with_base_branch`.

### Rig (claimed in the shared notes folder, `ios-signin-rig.md`)

Four sibling sessions are checking devices at the same time, so this one uses **its own** simulator
(created as `signin-17pro`, driven by UDID — never `booted`) and **port 8017** for the local backend
in this worktree's `backend/`. The pin is
`xcrun simctl spawn <udid> defaults write uz.mastersat.app apiBaseURL http://localhost:8017`, written
**before every launch** (`sim-relaunch-hits-prod`: an unpinned relaunch once reached production with
the owner's own session). Implementers never launch the app; the controller runs the rig.

---

## Tasks

### Task 1 — Kit: the four-step gate, the two checks, the lc-up API

**Files:** `Account/AccountRules.swift`, `Account/LcupClaimAPI.swift` (new),
`Tests/.../AccountTests.swift`, `Tests/.../LcupClaimTests.swift` (new).

1. `ProfileCompletion`:
   - `Step` becomes `case password, phone, names, email`.
   - `passwordField = "password"`, `phoneField = "lcup_phone"`; `needsPassword(_:)`, `needsPhone(_:)`.
   - `firstStep(missing:)` → the first of password, phone, names, email that is missing; with nothing
     missing it still answers `.email` (today's behaviour for an empty list; the gate is not mounted
     then — `isRequired` already refuses an empty `missing_fields`).
   - `next(after:missing:) -> Step?` — the next step still outstanding, ignoring every step at or
     before `after` in that order; `nil` when nothing is left. The gate finishes on `nil`.
   - `isRequired` is untouched (`profile_complete == false` AND a non-empty `missing_fields`, frozen
     wins).
2. `InitialPasswordCheck` — the web's two checks, in its words: `minimumLength = 8`
   ("Use at least 8 characters.") and a mismatch ("The two passwords are different."). Count
   `unicodeScalars`, as `PasswordChangeCheck` does, so the app and Python never disagree.
3. `PhoneClaimEntry.problem(_:)` — the web's one check: a blank number →
   "Telefon raqamingizni kiriting." (verbatim; this screen is Uzbek).
4. `AccountCopy` gains: `initialPasswordFailed` = "Could not save the password. Try a longer one.",
   `phoneSaveFailed` = "Raqamni saqlab bo'lmadi. Qaytadan urinib ko'ring.",
   `notMeFailed` = "Saqlab bo'lmadi. Qaytadan urinib ko'ring." — the web's three fallbacks — plus
   `initialPasswordFailure(_:)` / `phoneFailure(_:)`, which prefer the server's field message, then
   `detail`, then the fallback (the same shape as `passwordFailure`).
5. `LcupClaimAPI`:
   - `setInitialPassword(_ password: String)` → `POST /lcup/claim/password/`, body `{"password": …}`,
     no decode (204). A `403` arrives as `APIError.forbidden`, a `400` as `APIError.validation` with
     `fields["password"]` — both are left to `AccountCopy.initialPasswordFailure`.
   - `confirmPhone(_ phone: String) -> PhoneClaim` (`moved: Bool`) → `POST /lcup/claim/phone/`
     `{"phone": …}`.
   - `sayNotMe()` → the same path with `{"not_me": true}`, 204.
   - `PhoneClaimRefusal` maps the server's statuses: `400` → `wrongNumber`; `403` →
     `nothingToConfirm`; `409` → `linkedElsewhere`; `429` → `tooManyTries`. Each keeps the server's
     own sentence (the owner's Uzbek wording, which already contains the `••NN` hint) and exposes it
     through `errorDescription`. Anything else is rethrown untouched.
     **No `hint` value** (review ruling, Task 1): the server sends it as a top-level string, which
     `APIError.validation` cannot carry, and nothing needs it — the sentence shown to the student is
     the sentence the server built the digits into. Reading them back out of Uzbek prose would break
     silently the day that sentence is reworded.
     The reason is **derived from the status alone**, so `.nothingToConfirm` means "this request got
     a 403", not "the question is already answered" — any other 403 (a host guard, a future rule)
     lands there too. The screen must therefore never advance on a reason; only a fresh
     `profile()` read may say a step is done (see Task 4).
   - Construction mirrors `AccountAPI`: `public init(client: APIClient)`, `Sendable`, no state.
6. Tests (swift-testing, `StubServer` as `AccountAPITests` uses it):
   - `firstStep` for `["password"]`, `["lcup_phone"]`, `["password","lcup_phone","first_name","email"]`,
     `["email"]`, `["username","email"]`; `next(after:)` for every step, including `.email` → `nil`
     and `next(after: .password, missing: ["password"])` → `nil` (a step cannot repeat itself).
   - `InitialPasswordCheck` at 7 / 8 scalars and a mismatch; `PhoneClaimEntry` blank vs typed.
   - `LcupClaimAPI`: the path, method and JSON of each of the three calls; a 204 answers with
     nothing; a `400` with `{"phone": ["…••77"], "hint": "77"}` → `wrongNumber(hint: "77")` with that
     sentence; `403`/`409`/`429` → their cases; a `500` stays `APIError.http`.
   - `AccountCopy.initialPasswordFailure` / `phoneFailure` prefer the field message over the fallback.

**Verify:** `cd ios/MasterSATKit && swift test 2>&1 | tail -3` — "Test run with N tests … passed",
N ≥ 953 plus the new tests, nothing removed except by Task 2.

### Task 2 — Kit + app: Register removed

**Files:** `Auth/AuthService.swift`, `Tests/.../AuthAndStudentTests.swift`,
`App/MasterSATApp.swift`.

1. Delete `AuthService.register`, `RegisteredAccount`, `RegisterRequest`.
2. Delete `Session.register` (~206-224). `signIn`, `identify`, `signOut` untouched.
3. Delete the five register tests in `AuthAndStudentTests.swift` (~85-200); keep every sign-in and
   `/me` test. `AuthErrorCopy` needs no edit — the `duplicate_full_name` branch lives in
   `RegisterForm`, which Task 3 deletes.
4. `grep -rn "register" ios/MasterSAT/Sources ios/MasterSATKit/Sources` must show only push
   registration (`PushRegistrar`), classroom **registers** and `Events`' `isRegistered`.

**Verify:** `swift test 2>&1 | tail -3` green; `grep` as above.

### Task 3 — App: the look-C sign-in page

**Files:** `Screens/Auth/AuthView.swift`, `Screens/Auth/AuthChrome.swift`.

1. `AuthChrome.swift`:
   - delete `BrandPanel`, `PromiseRow`, `FloatingShapes` and `Brand.promises`; keep `Brand.top`,
     `Brand.bottom`, `Brand.panel` (About and the update screen draw the gradient), `BrandMark`,
     `BrandLockup`, `LogoArrival`, `AuthField`, `AuthAlert`, `PasswordField`.
   - `LogoArrival` becomes reachable from `AuthView` (the new logo tile uses it); the spring is the
     phase-4 one, and Reduce Motion still only fades.
   - new `SoftField<Content>`: the mockup's grey box — a token fill, no stroke, radius
     `Theme.Radius.control`, 48 pt tall (44 pt minimum target; the mockup's 40 pt is a 270-pt-wide
     mock), 13 pt horizontal padding, and `focusShake(_:cornerRadius:)` for the refusal shake. Dark
     mode follows the token; text is `Theme.ink`-family.
   - `AuthFocus` keeps `.email` (the identity field) and `.password`; `.firstName`, `.lastName`,
     `.username` go (`PasswordField` and the gate's own `AccountField` focus are unaffected).
   - `PasswordField` takes the soft box without changing the gate's call sites (a defaulted parameter
     or a box `@ViewBuilder` — the implementer picks).
2. `AuthView.swift` — one view, no `Mode`:
   - a `ScrollView` whose content is centred with `minHeight: screen.size.height` (the page is short;
     the keyboard must be able to push it), `.scrollDismissesKeyboard(.interactively)`;
   - page background `Color(.systemBackground)` — white in light, near-black in dark — **not**
     `Theme.background`;
   - the logo tile: 56×56 `RoundedRectangle(cornerRadius: 16)` filled `Theme.accent` with a white
     `BrandMark` inside, `LogoArrival` on the tile. White on brand blue is right in both themes
     (`Theme.accent` is blue in both).
   - "Sign in" `appFont(22, weight: .heavy)`, tracking −0.4; "MasterSAT Center" `appFont(12, .medium)`
     `Theme.textSecondary`; both centred.
   - the two fields in `SoftField`, 10 pt apart, the column at most 460 pt wide with 20 pt side
     padding; the identity field's placeholder is "Phone, email or username" as `Text(verbatim:)` (a
     plain string is a `LocalizedStringKey` and SwiftUI would draw an address in it as a blue link);
     `.textContentType(.username)`, `.keyboardType(.emailAddress)` (no autocaps, `@` and `.` on the
     first plane, digits one tap away — a phone is typable and a password manager still fills),
     `.textInputAutocapitalization(.never)`, `.autocorrectionDisabled()`, `submitLabel(.next)` →
     focus the password. No icons inside the fields (the mockup has none).
   - the "Sign in" button: `PrimaryButtonStyle(fullWidth: true)`, the spinner while
     `session.isWorking`, `.disabled` until both fields have something, and
     `accessibilityLabel(session.isWorking ? "Signing in" : "Sign in")` — phase 4's wording.
   - the alert (`AuthAlert`) sits above the fields and keeps phase 4's Retry for a retryable failure;
     the session notice (`notice`) sits above it until a submit (`noticeDismissed`).
   - the two help lines, centred, secondary, with "Your centre resets it." in `Theme.accentText`;
     built so VoiceOver reads each line once and neither is tappable. The copyright line stays at the
     bottom (`© <year> MasterSAT Center`).
   - **iPad:** no split any more — the same centred column, capped at 460 pt. `horizontalSizeClass`
     is no longer read.
3. Behaviour kept verbatim from phase 4: `submit()` cancels an in-flight attempt, trims the
   identity, treats `Task.isCancelled` as no failure, bumps `refusals` **only** on
   `APIError.unauthorized` (so `AccountDidNotLoad` and transport failures never shake),
   `.sensoryFeedback(.warning, trigger: refusals)`, and posts the message as an announcement. The
   forgot-password disclosure is gone (the line is now always visible), so `forgotOpen` goes with it.
4. The owner's open copy question from phase 5 ("You're signed in, but your account didn't load") is
   **not** touched here — it lives in the kit's `AuthErrorCopy` and is still the owner's to decide.

**Verify:** `cd ios/MasterSAT && xcodegen generate && xcodebuild -project MasterSAT.xcodeproj -scheme
MasterSAT -destination 'generic/platform=iOS Simulator' build` → `** BUILD SUCCEEDED **`, no new
warnings in the touched files.

### Task 4 — App: the gate's password and phone steps

**File:** `Screens/Account/CompleteProfileView.swift`.

1. State: `password`, `passwordAgain`, `phone`, plus the existing `missing`, `step`, `busy`, `error`.
   `step` starts at `ProfileCompletion.firstStep(missing:)` — now possibly `.password` or `.phone`.
2. One `advance(from: Step)`: re-read `account.profile()`, write `missing`, then
   `ProfileCompletion.next(after:missing:)`. It replaces the hand-rolled "what next" branches in
   `saveNames` and `afterEmailConfirmed`. When the profile cannot be re-read (offline), drop the
   step's own field from `missing` locally and advance from that — what `afterEmailConfirmed` does
   today.
   **`nil` is not "done" on its own** (review ruling): it means "no step after this one is
   outstanding", which is also what a field this app does not know (a future server requirement)
   looks like. So on `nil`, re-derive from the fresh `missing`: empty → `finish()`; otherwise
   `firstStep(missing:)` and show that step. A student then sees a step they can act on, or at worst
   the email step, instead of the gate lifting and remounting under them.
   **Never advance on a refusal reason.** `.nothingToConfirm` is only "the server answered 403", so
   a 403 from anything else would otherwise skip the phone step. A step is done when the re-read
   profile says so, and not before.
3. **Password step** — title "Choose your password", description verbatim from the web: "You signed in
   with a one-time code. Choose your own password — from now on you sign in with your phone number
   and this password." Two `AccountSecureField`s ("New password", "Type it again", both
   `.newPassword`), `InitialPasswordCheck` before sending, then `LcupClaimAPI.setInitialPassword`,
   then `advance(from: .password)`. Failure: `AccountCopy.initialPasswordFailure`. The session is
   **not** ended (see the facts above) and nothing signs out.
4. **Phone step** — Uzbek, verbatim from the web: title "Telefon raqamingiz"; description
   "O'zingizning raqamingizni kiriting — administratorga bergan raqamingizni. Raqamni qaysi akkauntda
   yozsangiz, o'sha akkaunt asosiy bo'ladi va guruhlaringiz unga o'tadi."; field label "Telefon
   raqami" (`AccountTextField`, `.telephoneNumber`, `keyboardType(.phonePad)`, placeholder
   "+998 90 123 45 67"); button "Tasdiqlash"; and under it "Shu ism-familiyali boshqa o'quvchi
   bo'lsangiz: **Bu men emasman**" — a plain text button, 44 pt tall, calling `sayNotMe()`. Both
   paths `advance(from: .phone)`. A `wrongNumber` refusal shows the server's sentence (it carries the
   `••NN` hint) under the field; `tooManyTries` / `linkedElsewhere` / `nothingToConfirm` show theirs
   as the form's alert.
5. The email and names steps keep their current copy and controls; the names step's "Save and
   continue" caption now reads from whether **anything** is still outstanding, not only the email.
   The "Edit your name" back link is shown on the email step only when a name step exists in this
   student's `missing` (it is unconditional today).
6. The footer is unchanged: "You can't use the rest of the app until this is done." and
   "Not now — log out" (the only way out; there is no password reset anywhere).
7. The account screens' announcement rules are kept: an error is posted as a VoiceOver announcement
   once, and a step change posts `ScreenChanged`.

**Verify:** the same `xcodebuild`; `swift test` still green.

### Task 5 — Device check (the controller only)

On the session's **own** simulator, against **this worktree's** backend on port 8017, pinned first.

Rig:

```
cd backend && SECRET_KEY=dev-secret DEBUG=True ~/.pyenv/versions/3.12.2/bin/python3 manage.py migrate
… manage.py seed_classroom_uat          # student uat_s1@mastersat.test / uatpass123
… an lc-up-style account: AccountClaim with password_set_at=None, username 998901234567,
  an unusable password (so phone + last four digits signs in and missing_fields == ["password"]),
  then a pending LcupPhonePrompt on it for the phone step, and a second such account for "Bu men emasman".
```

Checks:

1. The sign-in page in **light** and **dark**: the white/near-black page, the logo tile's spring, the
   two grey fields, the button, both help lines, the copyright. At xxxLarge and AX3.
2. `uat_s1@mastersat.test` + `uatpass123` signs in; so does the same account's **username**; so does
   the lc-up account's **phone number** (`+998 90 123 45 67`, spaces and all) with its last four
   digits.
3. A wrong password: the field shakes once, the alert says "The email or password you entered is
   incorrect.", and the password field keeps focus.
4. The backend stopped: "Cannot connect to the server…" with Retry, and **no** shake.
5. A `public_student` account: the server's "This app is for learning center students…" sentence.
6. The lc-up account's first sign-in: password step → phone step (a wrong number first, for the
   `••NN` hint, then the right one) → names → email, and the gate lifts on its own. Then "Bu men
   emasman" on the second seeded prompt account.
7. iPhone SE (3rd gen): the whole page without scrolling into the keyboard.

Each item is recorded with a screenshot. **If the simulator panel stops focusing text fields** (a
phase-4 trap that cost real time), the typing items are recorded as "not verified" rather than chased.

### Task 6 — Whole-branch review and one fix wave

One opus review of the whole diff against `main`, then one fix wave, then a re-review. Screenshots to
an orphan `pr-assets/ios-signin` branch, a short demo video, and the PR
"iOS: minimal login, no Register, lc-up first sign-in" into `main` — with the "Not verified" list.
**Not merged** without the owner's "ha".

---

## Rulings to record in the PR (each with its cost if wrong)

- **S1-R1** The help lines are text, not actions (owner). A tappable "contact the centre" would
  promise a channel the app does not have.
- **S1-R2** Register is removed, not hidden. A hidden form is a way in that the centre cannot see.
- **S1-R3** The identity field is one field with an email keyboard. Three fields, or a phone keyboard,
  would each lock out two of the three ways in.
- **S1-R4** Only a `401` from the token exchange shakes. Shaking on a transport failure teaches
  students to retype a correct password.
- **S1-R5** The gate's order is the website's (`password → lcup_phone → names → email`) and every
  step re-reads `/users/me/`. A different order, or a step that trusts its own answer, is how the
  current trap was built.
- **S1-R6** The phone step stays in Uzbek, verbatim. It asks for the number an administrator holds; a
  translation would be a second meaning of "o'zingizning raqamingiz".
- **S1-R8** A refusal's reason is read from its status, and nothing advances on one. A 403 that is
  not the gate's (a host guard, a future rule) would otherwise look like "already answered" and skip
  the step it was refusing.
- **S1-R9** `next(after:) == nil` is re-derived from the fresh `missing`, never trusted as "done". A
  requirement this app has not been taught (the server's extras are open-ended) would otherwise lift
  the gate and remount it under the student.
- **S1-R7** Choosing the first password does not sign the student out — unlike changing a password.
  Signing out there would drop them back at a sign-in form with a password the server has only just
  learned.
