# iOS — the two header windows and the bell on every tab (2026-10-24)

The owner approved this round in chat on 2026-10-24. This is piece 2 of that round; the other
pieces (a login without Register, onboarding cartoons, website parity) are separate sessions.

Mockup: `ios-redesign/.superpowers/brainstorm/74526-1792779410/content/windows-final.html`
(untracked, primary checkout). Branch: `feat/ios-header-windows`, cut from `main` at `95c62b39`.

## What is being built

1. **Two floating windows** (owner's choice B — two separate windows; A — a floating card over a
   dimmed screen, closing with ✕ or a tap outside). Today both header pills do nothing on tap.
   - The flame opens **Strikes**.
   - The XP pill opens **XP + points**.
2. **The notification bell in every tab's header**, not only Today.
3. **No backend change.** Every number comes from what `RewardsStore` and the Rewards hub already
   read (`/rewards/me/`, the hero board).

## Global constraints (inherited — the 2026-10-20 plan's "Global Constraints" still hold)

- Deployment target **17.0**; app target **Swift 6** strict concurrency.
- **No backend change.**
- Brand blue `#2a68c0`; growth-oriented English copy.
- **Reduce Motion never restructures the tree** (P4-R7): both tracks always exist and the setting
  picks the playback or the animation. No `if reduceMotion { … } else { … }` over view content.
  Choosing an `Animation` or a `LottieClip.Playback` with one expression is how it is done today
  (`CelebrationCenter.settleAnimation`, `RankUpCard`) and is what this plan means by "no if/else".
- Decorative overlays `.allowsHitTesting(false)`; guard no-op writes on `@Observable` state.
- **Refreshes run detached** (`.detachedRefresh` / `TabRootScroll(onRefresh:)`).
- **Error ≠ empty**; a failed read keeps the last good numbers and says it failed.
- Trigger-driven modifiers never sit on a `Group { if … }` whose branch flips in the same update
  (P4 device trap).
- Commits authored by **Viltrumlik <viltrumlik@gmail.com>**, `git add` named files only.

## Rulings taken here (each with its cost if wrong)

- **W-R1 The windows are ONE overlay at the root, not a sheet.** `AppRouter.headerWindow`
  (`nil | .strikes | .xp`) plus a `HeaderWindowOverlay` beside `RankUpOverlay` in
  `RootTabView`. The header's pills only write the router.
  *Why:* a header lives inside a scroll view, so an `.overlay` there is clipped; a `.sheet` would
  fight the router's one-sheet rule and the Me sheet's queue, and a `.fullScreenCover` slides up
  (the entrance must be calm). `RankUpOverlay` is the precedent: dim + card + tap outside, drawn
  above the tabs and the bar, under the two sheets.
  *Cost if wrong:* a window clipped by the header's scroll view, or a second sheet that cancels
  the Me sheet.
  *Touching `RootView.swift`:* two lines (`.overlay { HeaderWindowOverlay() }` and nothing else).
  `RootView.swift` belongs to `ios-onboarding` and `ios-parity-fixes` this round — keep it to that.
- **W-R2 The Strikes window's big number is `strikes`, never `current_streak`.** The pill shows the
  run (`RewardsStore.streak`); the window shows what is spendable, as the web's dashboard does
  (`DashboardPulse.tsx` ~156-196: `value={rewards.data.strikes}`, the run as the detail line). The
  run is the line underneath: "N lessons in a row · best M".
  *Cost if wrong:* a student is told they can spend strikes they have already spent.
- **W-R3 The windows read nothing of their own; they show what is already loaded.**
  - `strikes`, `bestStreak`, `points`, `coins`, `convertibleCoins`, `maxConvertiblePoints`,
    `pointsToNextCoin` come from one `MyRewards` the window holds.
  - `xp` and the run come from `RewardsStore` (`xp − heldXP`, `streakShown`) so the window and the
    pill behind it never disagree, and a flight still in the air is not shown twice.
  - The place (`#N in the centre`) and "N XP to pass <name>" come from `LeaderboardQuery.heroBoard`
    — the same question the Rewards hero and the welcome-back check ask (P3 ruling), so a place
    seen here is the same number.
  *Cost if wrong:* two totals in the app, or a place that contradicts the Rewards hero.
- **W-R4 A window opened while nothing has loaded reads once, detached, and says which state it
  is in.** Loading → skeleton; failed with nothing kept → `ErrorState(.inline)` with "Try again";
  failed with something kept → the numbers plus `StaleNote`. Never "0 strikes" for a failed read.
  *Cost if wrong:* "you have 0 strikes" on a bad connection.
- **W-R5 The art loops the whole time the window is open and holds still under Reduce Motion.**
  - The flame is the existing `strike-flame` Lottie (`LottieClip(.strikeFlame, playback: .loop)`),
    96 pt, over a SwiftUI glow. No new Lottie file, so the 15 000-byte budget is untouched and the
    generator does not change.
  - The bolt and the coin are SwiftUI (`.phaseAnimator` / a repeating animation driven by a value),
    not Lottie: they would otherwise be two more looping clips and two more files.
  - The looping budget in `LottieClip`'s header comment gains the window: while one is open the
    page behind it is dimmed but still drawn, so Rewards can show three loops (header flame,
    `StreakCard` flame, the window's). Accepted and written down there.
  *Cost if wrong:* motion sickness for a student who asked for none, or a byte budget breach.
- **W-R6 The card's entrance is ≤250 ms with no overshoot over content** (`Motion.focus`-class;
  the dim fades, the card scales from 0.96 with no bounce). Reduce Motion: a plain fade of both.
  *Cost if wrong:* a motivation surface that reads as a focus-zone violation.
- **W-R7 VoiceOver reads the numbers once; the art is silent.** The card is `.isModal`, the art
  `.accessibilityHidden(true)`, each figure one element with its unit ("3 strikes to spend"), the
  cursor moves to the window's title when it opens. `.escape` closes it. No announcement — the
  student asked for the window.
  *Cost if wrong:* the same number read three times, or a window VoiceOver cannot leave.
- **W-R8 The bell is on every tab's header** (owner). `AppHeader(showsBell:)` defaults to `true`
  and the parameter goes away; `HeaderLayout`'s `.actions` slot already carries bell + avatar in
  both the row and the stacked arrangement. One `NotificationBell` per tab means one poll per tab
  root that has appeared — the poll is `task(id: scenePhase)` on a view that exists in all five
  roots once each has been visited. Checked in Task 5: at most one timer runs per visited tab and
  each is a 60 s poll of one small aggregate, as Today's is today.
  *Cost if wrong:* five polls a minute instead of one.

## File structure

New:
- `ios/MasterSATKit/Sources/MasterSATKit/Rewards/HeaderWindows.swift` — the windows' numbers and
  wording as pure values (`StrikesWindow`, `XPWindow`), with tests.
- `ios/MasterSAT/Sources/Screens/Shell/HeaderWindow.swift` — `HeaderWindowKind`,
  `HeaderWindowOverlay`, the shared card chrome (dim, ✕, entrance, modal semantics).
- `ios/MasterSAT/Sources/Screens/Shell/StrikesWindowView.swift`
- `ios/MasterSAT/Sources/Screens/Shell/XPWindowView.swift`
- `ios/MasterSATKit/Tests/MasterSATKitTests/HeaderWindowsTests.swift`

Changed:
- `ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift` — the pills become buttons; `showsBell`
  goes away.
- `ios/MasterSAT/Sources/Screens/Shell/AppRouter.swift` — `headerWindow`, `openHeaderWindow`,
  `closeHeaderWindow`, and the sheets/links close it.
- `ios/MasterSAT/Sources/Screens/RootView.swift` — one `.overlay { HeaderWindowOverlay() }`.
- `ios/MasterSAT/Sources/Screens/Today/TodayView.swift` — drops `showsBell: true`.
- `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift` — the budget comment (W-R5).

## Task 1 (kit) — the windows' numbers and wording, with tests

`HeaderWindows.swift` holds two pure values built from a `MyRewards` (and, for XP, the hero board's
standing), so the wording is testable without a view:

- `StrikesWindow`: `spendable` (`MyRewards.strikes` — **not** `currentStreak`, W-R2), `run`, `best`,
  plus `runLine` and `spokenSpendable`.
- `XPWindow`: `xp`, `rank?`, `pass?`, `points`, `coins`, `convertibleCoins`, plus `placeLine`,
  `passLine?` and `coinsLine`.

Rules to encode and test:
- `runLine`: `"1 lesson in a row"` singular; `" · best N"` only when `best > 0`; a best equal to the
  run still prints (the mockup shows "4 lessons in a row · best 9"; "best 4" on a run of 4 is honest
  and the web prints it). A run of 0 reads "No run yet — your next lesson starts one".
- `spokenSpendable`: `RewardsFormat.count(spendable, "strike")` + " to spend".
- `placeLine`: `"#\(rank) in the centre"`; a place is an identifier, never grouped (`#1204`).
- `passLine` is `LeaderboardPass.text` and nothing else — the hero's rule, so the two agree; nil at
  #1 (then "You're top of the whole board", as the hero says), nil without a standing, and nil when
  the board cannot prove who is directly above.
- `coinsLine`: `RewardsFormat.count(coins, "coin")` + " to spend".

Tests cover: singular/plural at 0/1/2 for the run, strikes and coins; `best` at 0, below, equal to
and above the run; `rank` nil; `pass` nil at #1; and the W-R2 regression — a `MyRewards` with
`currentStreak: 9, strikes: 3` gives `spendable == 3`.

**Review after this task.**

## Task 2 — the overlay, the card chrome, the router

- `HeaderWindowKind: Hashable { case strikes, xp }` in `HeaderWindow.swift`.
- `AppRouter`:
  - `var headerWindow: HeaderWindowKind?`
  - `func openHeaderWindow(_ kind:)` / `func closeHeaderWindow()` — guarded writes.
  - `open(_:baseURL:openURL:)`, `openMe`, `show`, `showFresh` and `showClassToDo` close it first:
    a window must never stay over a tab the student has been sent to. The window's own Shop and
    Leaderboard buttons route through those, so this is the one place it is closed.
- `HeaderWindowOverlay`, modelled on `RankUpOverlay`:
  - dim `Color.black.opacity(0.38)` ignoring the safe area, tap to close, `.accessibilityHidden`;
  - the card centred, `.padding(.horizontal, 18)`, max width 420 (iPad), its content scrolling
    (`.scrollBounceBehavior(.basedOnSize)`) so AX5 never runs off the card;
  - ✕ at the top trailing, 26 pt drawn, `.hitTarget(44)`, label "Close";
  - entrance: dim `.opacity`, card `.scale(0.96).combined(with: .opacity)`, one
    `.animation(…, value:)` picking `Motion.focus` (Reduce Motion) or a ~0.24 s `easeOut` (W-R6);
  - `.allowsHitTesting(router.headerWindow != nil)`;
  - `.accessibilityAddTraits(.isModal)` on the card, `.accessibilityAction(.escape)` closing it;
  - `.coversCelebrations(celebrations)` so a celebration started under it waits, as under a cover.
- `RootView.swift`: `.overlay { HeaderWindowOverlay() }` directly after `.overlay { RankUpOverlay() }`.
  Nothing else in that file.
- `AppHeader`: `StrikeChip` and `XPPill` become `Button { router.openHeaderWindow(…) }` with
  `PressBounce()`; their geometry reporting, keyframe animators, large-content viewer and
  accessibility labels stay exactly as they are (the flight target must keep working), and each
  gains a hint ("Opens your strikes" / "Opens your XP and points").

Device trap to respect: the pills' `keyframeAnimator(trigger:)` and `onGeometryChange` must not move
onto a `Group { if … }` whose branch flips in the same update (the phase-4 trap). Wrapping the
existing body in a `Button` label keeps one stable view.

**Review after this task.**

## Task 3 — the Strikes window

Content, top to bottom (mockup):
- the flame: `LottieClip(.strikeFlame, playback: .loop)` 96 pt over a SwiftUI radial glow that
  breathes (opacity .35→.7, scale .92→1.08, ~2.2 s), both inside a fixed 120×128 box;
- the big number: `StrikesWindow.spendable`, 42 pt black rounded, `contentTransition(.numericText)`;
- "strikes to spend" (singular aware);
- the run line (`runLine`);
- **"Spend in the Shop"** — a full-width button on the strike tint (the mockup's `#fff4e6`/`#d9600f`
  pair, through `Theme` so dark mode holds), which closes the window and opens `AppLink.shop`;
- **"ⓘ What a strike is"** — `RewardsExplainButton(explainer: .strike)` re-used, laid out with its
  title beside the glyph. If it cannot carry a title without changing its callers, add a `title:`
  parameter defaulting to nil in `RewardsPointsPill.swift` (that file holds only the explainers now).

States (W-R4): a loading skeleton for the figures with the flame still drawn; `ErrorState(.inline)`
with "Try again" when nothing is kept; `StaleNote` under the figures when a refresh failed over good
numbers.

**Review after this task.**

## Task 4 — the XP + points window

- the bolt: a SwiftUI bolt on the brand blue that pulses (scale 1→1.09→1.04, ~1.6 s) over a blue glow;
- `XPWindow.xp`, 42 pt, in the accent;
- "XP · #4 in the centre" (`placeLine`), and `passLine` under it when it can be known;
- a points box (`Theme.card` inset, radius 16): a coin that turns slowly
  (`RewardsCoinArt(kind: .coin, size: 34)` with a repeating `rotation3DEffect` about Y, ~2.4 s),
  "N points", `coinsLine`, and **Convert**:
  - Convert uses the hub's flow exactly: an `.alert` to confirm ("Convert N points into M coins?"),
    `session.rewards.convert(points: nil)`, a read-back ordered by `rewards.ticket()`, the same
    notes including the "couldn't confirm" line, a coin burst where the box is, and the button off
    from the press until the read-back settles. Not idempotent, never retried.
  - Nothing to convert → the quiet line "N points to your next coin" in place of the button.
- **Leaderboard** and **Shop** buttons side by side, each closing the window and routing
  (`AppLink.leaderboard`, `AppLink.shop`);
- "ⓘ What XP is · Points and coins" — both explainers, `RewardsExplainer.xp` and `.points`.

States as W-R4. The place and the pass line have their own state: the board read can fail while
`/rewards/me/` worked, and then the window shows the XP and says the place could not be read —
never "#—", and never a silent omission that reads as "not on the board".

**Review after this task.**

## Task 5 — the bell on every tab

- `AppHeader.showsBell` goes away; the bell is always built. `TodayView` drops the argument.
- Layout proof at AX5 and on the iPhone SE (375 pt): the `.actions` slot is bell + avatar, 42 + 34
  with an 8 gap = 84 pt, plus the pills (~150 pt at xxxLarge) ≈ 242 pt of SE's 343-pt content width
  — the line of context is what gives way (`HeaderLayout`'s `ViewThatFits` ending in an empty view),
  and at the accessibility sizes the header stacks. Task 5 verifies this rather than assuming it:
  Class, Words, Rewards and Explore at AX5 and at 375 pt, light and dark.
- The polling check of W-R8.

**Review after this task.**

## Task 6 — run it, prove it, open the PR

- Kit tests green (`swift test` in a test worktree — the suite needs its own).
- Device check on the **iOS 26.3 simulator against the LOCAL backend**, with the pin set BEFORE any
  launch (`xcrun simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000`)
  — an unpinned launch once reached production with the owner's session (P5-R8; the controller runs
  the rig, implementers never launch the app). Preview config `ios-redesign-backend`, seed
  `seed_classroom_uat`, student `uat_s1@mastersat.test`, given strikes, points and coins.
  Checks: both windows from every tab; the Shop / Leaderboard / Convert routes; tap outside and ✕;
  light, dark, **Reduce Motion** (no flicker, no pulse, no turning coin, no overshoot) and **AX5**;
  the bell on all five tabs; the SE width.
- Screenshots on an orphan `pr-assets/ios-header-windows` branch, and a short demo video.
- PR into `main`: **"iOS: strikes and XP windows, bell on every tab"**. Do not merge without the
  owner's "ha".

## Open for the owner

- none yet; any question goes to the session that started this one, one at a time, with a ★.
