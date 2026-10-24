# iOS parity fixes — payments, report a problem, event invitations, grade and story fixes

Branch `claude/ios-parity-fixes-8b9298`, cut from `main` (`95c62b39`). Five tasks, each its own
commit, each reviewed by a fresh agent; then one whole-branch review, one fix wave, a device check
on the iOS 26.3 simulator against the LOCAL backend, and a PR into `main`.

Scope is the owner's list of 2026-10-24 (a read-only audit of website vs app). Nothing else: no
highlighter, no notes, no `/analytics` charts, no test-taking. Full-test results and `/review/{id}`
routing belong to the `ios-test-results` session; `Shell/AppHeader.swift` to `ios-header-windows`;
auth to `ios-signin`; the Me sheet's Settings and `RootView`'s intro to `ios-onboarding`.

**No backend change.** Every endpoint the app needs is already open to it: the native client sends
`X-MasterSAT-Client: ios/<v>` and reaches the apex host, where `access/host_guard.py` falls
through. `GET /api/lcup/me/finance/` is `IsAuthenticated` on purpose (a frozen student must read
their own debt); `POST /api/question-reports/reports/` is `IsAuthenticatedAndNotFrozen`;
`/api/events/` and `/api/events/{id}/sign-up/` are ones the app already calls. If an endpoint
refuses the app on the device, STOP and tell the session that started this one.

## Conventions carried in (phase 1–5 outcomes of `docs/superpowers/plans/2026-10-20-ios-redesign.md`)

- **Error ≠ empty, and a cancelled load is not a failure.** A screen says "nothing" only after a
  load that worked. A failed first load shows its own error with a retry.
- **`.detachedRefresh`** for every new `.refreshable` on a pushed page; tab roots use
  `TabRootScroll(onRefresh:)`.
- **Value routes only.** Pushes are `AppLink` (or the stack's own `Route`) values declared at the
  stack root — never `NavigationLink { destination }`.
- **One prompt at a time**, and never over a full-screen cover (`coversCelebrations`) or the Me /
  certificate sheet.
- **`appFont`** everywhere (never `.font(.system(size:))`); chrome capped with `capDynamicType()`;
  rows that must stack use `AdaptiveStack`. Check AX5.
- **Motion:** focus zones use `Motion.focus` (≤250 ms, no overshoot); Reduce Motion picks a track,
  it never restructures the tree.
- **Kit first.** Decoding, money formatting, grade composition, "which event, and when" are kit
  types with tests; the app target only draws.
- **Implementers never launch the simulator.** The controller runs one rig, pinned to the local
  backend (`xcrun simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000`).

## Rulings taken before implementation (cost if wrong)

- **R1. Money reads exactly as the website's `formatUzs`: `1,250,000 UZS`** — digits grouped
  en-US, rounded to a whole, never `-0`. The owner's brief says "so'm"; the website says UZS
  everywhere a student sees money, and the brief also says "formatted as the website formats it".
  The website wins, and the word is the only thing to change later if the owner says so.
  *Cost if wrong: one string constant and its tests.*
- **R2. The Payments panel is the website's panel, line for line** — "You owe" (danger) /
  "In credit" / "Balance: All paid", "Monthly price" with a per-group breakdown only when there is
  more than one group, the due-day sentence only while something is owed, then "Recent payments"
  (the latest five; a refund as "Refund" with a minus). An account lc-up does not know says so and
  shows nothing else. *Cost if wrong: a redraw of one panel.*
- **R3. The frozen screen keeps its two buttons and gains the debt**, the way `FrozenOverlay.tsx`
  does: for a debt freeze, "This month's payment hasn't been made…", the amount when it is above
  zero, and "unlocks by itself within 15 minutes". Any other freeze keeps today's administrator
  wording. A finance load that fails leaves the administrator wording (never an invented debt) and
  says nothing about there being no debt. *Cost if wrong: one screen's copy.*
- **R4. Reporting a problem uses the website's endpoint and vocabulary unchanged**:
  `POST /question-reports/reports/` with `system` (`"assessment"` from both app surfaces),
  `question_id`, a `category` of the five, an optional `message` (≤2000) and an optional
  `attempt_id`. The runner sends the attempt id, the review does not — exactly as the website's two
  call sites do. A deduped answer is thanked differently ("You've already reported this question").
  *Cost if wrong: a mismatch with the ops queue the reports land in.*
- **R5. The event invitation is one sheet, shown once per launch per event**, for the soonest event
  with `can_sign_up`, to a student, after the shell has settled (2.2 s, as the website), and only
  while the stage is clear: no full-screen cover, no Me or certificate sheet, no onboarding intro,
  nothing else modal. It re-checks every second rather than stacking. A failed events load shows
  nothing. Sign-up happens in the sheet; "See all events" goes to the Events screen through the
  router; "Later" closes it. Remembering is per launch (in memory, per event id), the app's
  equivalent of the web's `sessionStorage` — a relaunch is a new sign-in moment, and the seat is
  still worth one interruption. *Cost if wrong: a prompt a student meets twice in a day.*
- **R6. A weighted homework shows the composed grade, never the bare mark.** `composed_grade` is
  read from the server and never recomputed; its states drive the words, the way
  `AssignmentDetail.tsx` does them: `awaiting_manual_mark` → "Waiting on your teacher's mark" (and,
  before any review exists, the "Part of this grade is already decided" card), `unavailable` → "we
  could not work the total out", a 0% manual share → "this grade is worked out automatically", a
  100% share → no split line. *Cost if wrong: a student reads a 20%-weight 50 as their grade.*
- **R7. A story's "Open" is routed, not browsed.** A link whose site path the app has a screen for
  opens that screen and closes the viewer; anything else on the site, and any other http(s) URL,
  opens in the system browser, where the student's web session lives. The in-app
  `SFSafariViewController` goes: it is signed out, and an "Open" that lands on a sign-in form is
  the bug. *Cost if wrong: one more tap to reach a page.*
- **R8. The story rail tells the truth about a failure.** A cancelled first load leaves the rail in
  `.loading` with nothing to re-trigger it, so the rail stays zero-height for the life of the
  screen: a cancelled load must leave the rail in a state a later appearance retries. An
  undecodable payload is a failure, not an empty rail. The caption's 8-line cap goes (the website
  has none). *Cost if wrong: a silent empty band where the school posted notices.*

## Task 1 — Payments, with the student's real money

**Kit** (`MasterSATKit/Sources/MasterSATKit/Finance/`, new):
- `Money.swift`: `public enum UZS { public static func format(_ amount: Double) -> String }` —
  rounds to a whole, groups the digits as the website does, never prints `-0`, appends ` UZS`.
- `Finance.swift`: `FinancePayment` (`id`, `date`, `amount`, `kind`, `method`, `month`, `group`)
  and `MyFinance` (`balance`, `debt`, `updatedAt`, `frozenForDebt`, `freezeDay`, `monthlyCost`,
  `groups`, `payments`), decoded leniently (DRF sends decimals as strings in places — read both, as
  `SubmissionReview` does). `linked: false` is its own case:
  `public enum MyFinanceState { case unlinked, linked(MyFinance) }`.
- `FinanceRules.swift`: the panel's reading of it — the summary line (owes / in credit / all paid),
  `recentPayments(limit: 5)`, `methodLabel` (the website's three Uzbek names → Cash / Card /
  Bank transfer, anything else as received), `dueSentence(freezeDay:)` with the English ordinal,
  `payDay`, `payMonth` (formatted like the website, Tashkent calendar).
- `FinanceAPI.swift`: `mine() async throws -> MyFinanceState` on `/lcup/me/finance/`.
- `Tests/MasterSATKitTests/FinanceTests.swift`: the format (0, negative zero, millions,
  fractions), both decimal shapes, `linked: false`, a debt, a credit, exact zero, several groups,
  a refund row, the ordinal (1st/2nd/3rd/11th/21st), an unknown method, an empty `month`.

**App**:
- `ProfileModel` gains `finance: ProfileLoad<MyFinanceState>` and `loadFinance(_:)`, loaded with
  the Overview's other panels and retried through `ProfileRetry.finance`.
- `ProfilePaymentsPanel` (`Screens/Profile/ProfilePanels.swift`) takes the model: a skeleton while
  loading, an inline error + "Try again" on a failure ("Your payments didn't load. Nothing has
  changed — try again in a moment."), the unlinked sentence, else the figures and the list. The
  "Coming soon" badge and the three preview rows go.
- `FrozenAccountView` (`Screens/AccountStateViews.swift`) loads `/lcup/me/finance/` on appear (and
  again with "Check again"): for `frozenForDebt` it shows the debt line and the 15-minute sentence;
  otherwise the wording it has now. A failed load changes nothing.

**Done when:** kit tests green; the panel draws the seeded student's balance, monthly price and
payments; the frozen screen names an amount.

## Task 2 — Report a problem

**Kit** (`MasterSATKit/Sources/MasterSATKit/QuestionReports/QuestionReports.swift`):
- `QuestionReportSystem` (`exam`, `assessment`), `QuestionReportCategory` (the five, with the
  website's labels, in the website's order, `wrongAnswer` first), `QuestionReport` (the payload),
  `QuestionReportResult` (`id`, `status`, `deduped`), `QuestionReportsAPI.submit(_:)`.
- Tests: the wire names (`wrong_answer`, `answer_key`, `typo_unclear`, `image_figure`, `other`),
  the request body with and without `attempt_id` and `message`, a whitespace-only message omitted,
  `deduped`, an `APIError` surfaced.

**App** (`Screens/Assessments/`):
- `ReportProblemSheet.swift`: title "Report a problem", subtitle "Question N — tell us what looks
  wrong.", a picker of the five, an optional details field (2000 cap), Cancel / Send report. On
  success the app's existing confirmation idiom; on failure the error's own message, with the
  sheet left open.
- A 44-pt "Report" control in the runner's toolbar row beside the flag
  (`AssessmentRunnerView.toolbar`), sending `system: .assessment`, the current question id and the
  attempt id; and one per question card in `AssessmentReviewView`, sending the question id with no
  attempt id. Both labelled "Report a problem with this question" for VoiceOver.
- The runner is a focus zone: the sheet sits over the cover and the clock and answers behind it
  are untouched.

## Task 3 — The event invitation

**Kit** (`MasterSATKit/Sources/MasterSATKit/Community/EventInvite.swift`):
- `EventInviteRules.featured(_ events: [LearningEvent], shown: Set<Int>) -> LearningEvent?` — the
  soonest with `canSignUp` that has not been shown; nil for an empty or failed list and when every
  candidate was shown.
- `EventInviteMemory`: the per-launch set of ids, with `remember(_:)` / `wasShown(_:)`.
- Tests: ordering, `canSignUp` false skipped, a full event skipped, an already-shown id skipped, an
  empty list, a list whose first open event is not its first row.

**App**:
- `Screens/Events/EventInviteSheet.swift` — the website's card: "There's an event coming up",
  "Take a seat now — there are only so many.", the title, the when (weekday, month, day · time,
  Tashkent), the location, "N seats left", then Later / See all events / Sign up. Sign up calls
  `EventsAPI.signUp`, says plainly when the seat went, and on success says so and closes.
- `Screens/Events/EventInvitePrompt.swift` — an `@Observable` the root owns: loads
  `EventsAPI.upcoming()` once after the shell appears, waits 2.2 s, then opens only while the stage
  is clear (`!router.showingMe`, `router.certificate == nil`, no cover — a new read-only
  `CelebrationCenter.isCovered` over the existing `covered`), re-checking every second. It never
  opens on the Events screen itself and never while onboarding's intro is up
  (`AppPrompts.suppressed`, a one-line flag `ios-onboarding` can set; coordinate before
  committing).
- `RootView.swift` gains one line in `RootTabView`: the prompt view in `.background { }` beside
  `RewardsRefresher`, and its sheet. Keep the change self-contained — `ios-onboarding` owns the
  file's intro.

## Task 4 — A weighted homework shows the whole grade

**Kit** (`MasterSATKit/Sources/MasterSATKit/Homework/ComposedGrade.swift`):
- `ComposedGrade`, decoded from a submission's `composed_grade` (null = no manual component), with
  `state`, `percent`, `automaticPercent`, `manualPercent`, `manualWeight`, `automaticWeight` and
  the booleans `awaiting` / `unavailable`, mirroring the website's `describeManualShare`.
  `Submission` gains `composedGrade: ComposedGrade?`.
- `ComposedGradeRules`: `pillText` (the website's `gradePill` ladder, including the fall-back to
  `review.scoreText` when the share is 0 and nothing composes), `breakdownSentence`, and
  `settledSoFar` (the pre-review card's numbers). Percents print as the website's `+n.toFixed(2)%`.
- Tests: each state, a 0% share, a 100% share, the fall-back, the rounding (`90`, `90.5`, `90.25`),
  a missing key, a malformed one (treated as no composition, the raw mark shown as before).

**App** (`Screens/HomeworkDetailView.swift`):
- `reviewCard` shows `ComposedGradeRules.pillText` instead of `review.scoreText` whenever a
  composition exists, with the split sentence under the mark.
- Before any review, when the composition is awaiting with an automatic part, the "Part of this
  grade is already decided" card appears, worded as the website's `SettledSoFar`.

## Task 5 — Stories

**Kit** (`Community/Stories.swift`):
- The rail's envelope no longer swallows a decode failure: an envelope with no readable `stories`
  key throws (the per-row lossy list stays, so one bad story does not lose the rail).
- `Story.routedLink` → `AppLink?` for a site path the app has a screen for, beside `openableLink`
  for the rest. Tests: a `/events` link, an absolute `https://mastersat.uz/events`, an off-site
  link, an empty link, a `mailto:`.

**App**:
- `StoriesRail`: a cancelled first load leaves the rail in a state the next appearance retries
  (rather than zero-height for the life of the screen); a decode failure shows the failure line.
- `StoryViewer`: "Open" routes a known path through `AppRouter` (closing the viewer) and opens
  anything else with `openURL` (the system browser, where the student is signed in). The in-app
  `CommunitySafariView` presentation for story links goes, and the caption's `lineLimit(8)` with
  it.

## Final review, device check, delivery

- One whole-branch review (opus) after Task 5, then one fix wave, re-reviewed.
- Kit tests green (`swift test` in `ios/MasterSATKit`); the app builds clean under Swift 6.
- Device check on the iPhone 17 Pro, iOS 26.3, pinned to `http://localhost:8000`, preview config
  `ios-redesign-backend`, seed `seed_classroom_uat` plus the phase-5 seed, student
  `uat_s1@mastersat.test`. Seed locally, in addition: lc-up finance rows (a link with a negative
  balance, a monthly cost, several payments including a refund), an event the student can join, a
  story with a `/events` link and a long caption, and a homework with
  `manual_grade_weight_percent` set. Check light, dark and AX5.
- Screenshots on an orphan `pr-assets/ios-parity-fixes` branch, a demo video, then
  `sync_with_base_branch` and a PR into `main`: "iOS: payments, report a problem, event
  invitations, grade and story fixes". No merge without the owner's "ha".
