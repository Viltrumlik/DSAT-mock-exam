# iOS Student App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MasterSAT iOS student app's look, navigation and motion — calm iOS look, playful motion, five tabs — without touching the backend.

**Architecture:** Phased on top of the existing SwiftUI app (`ios/MasterSAT`) and its Swift package (`ios/MasterSATKit`). Pure logic (where a link lands, confetti physics, motion budget, later the Today list and XP deltas) goes into the kit with swift-testing tests; views, motion and Lottie go into the app. Phase 1 lays the design tokens, motion kit and the new shell, which restyles every existing screen at once; phases 2–5 rebuild tab by tab.

**Tech Stack:** SwiftUI (iOS 17 floor, Swift 6 in the app), Observation, swift-testing in the kit, `lottie-spm` 4.5+, XcodeGen, Node (only to generate Lottie JSON).

**Spec:** None by the owner's rule ("spec = code"). The design was approved section by section in chat on 2026-10-20; its decisions are copied into **Approved design** below so this plan stands alone. The motion reference is the throwaway prototype at `/Users/macbook/Projects/DSAT-mock-exam/ios-redesign/prototype/Sources/Prototype.swift` (not in git).

## Global Constraints

- iOS deployment target stays **17.0**; anything newer (`navigationTransition(.zoom)`, iOS 18) is behind `if #available`.
- App target is **Swift 6** strict concurrency: no `DispatchQueue.main.asyncAfter` capturing main-actor state — use `Task { try? await Task.sleep(for:) }`; closures handed to animation completions are `@MainActor`.
- **No backend change.** Every screen reads today's API. The only kit addition outside this plan's new files is a `metric` parameter on the leaderboard query (phase 3; the server side shipped in #302).
- Timed sittings (mocks, midterm taking, past papers) stay OUT of the app, as today.
- UI copy is **English**, growth-oriented: a passed deadline reads "Catch up · Tue" (`DueLabel`), never "Overdue", "Late" or "Wrong"; results filter "To improve".
- Brand blue `#2a68c0` (dark `#3170d6`); Math = accent blue, English = `Theme.subjectEnglish` `#6d4ec7`, Words = `Theme.amber`.
- "+N XP" is shown **only** for a gain the server confirmed. Effort (handing in) is always celebrated; outcomes (scores) only when passed or improved.
- Reduce Motion: no confetti, no flights, no looping Lottie, springs become fades. Low Power Mode: half the confetti.
- Decorative overlays get `.allowsHitTesting(false)` (a SwiftUI `.overlay` is hit-testable). Only a tab ROOT hides its navigation bar.
- Guard no-op writes on `@Observable` state the root reads (every write notifies, equal or not).
- **Value routes at stack roots.** Every push from a tab root (and the Me sheet's root) is a value declared with `navigationDestination(for:)` at that root; a `NavigationLink { destination }` from a root view is a regression. Pages pushed deeper may keep item-bound or closure destinations.
- **A `TabView` never tears down its tabs:** a root's `.task` runs once per launch. Roots reload in `.onAppear` (every return to the tab, every pop back to the root); subviews that come and go (segments) may use `.task(id:)`.
- **The celebration overlay sits under every sheet and cover.** A full-screen cover's content carries `.coversCelebrations(center)` and never reads `CelebrationCenter` itself — its presenter hands the call in; work finished there is celebrated once the cover has gone (phase 2).
- Commits authored by **Viltrumlik <viltrumlik@gmail.com>**; `git add` named files only, never `-A`. One PR per phase, into `main`.
- Simulator screenshots: `sleep 2; xcrun simctl io booted screenshot <file>` (the MCP screenshot can return a stale frame). Taps are in points (402×874 on iPhone 17 Pro).

## Approved design (2026-10-20, owner)

1. **Look — "A":** Apple-style large titles, white cards on the grouped grey background, coloured icon tiles, floating capsule tab bar. **"B" (chunky, thick lower edge)** only on motivation surfaces: Rewards hero, "your row" on the leaderboard, celebration moments.
2. **Navigation:** five tabs **Today · Class · Words · Rewards · Explore**. **Me** = avatar at the top-right of every tab header → a large sheet. The Learn hub goes away.
   - Today: date, 🔥 streak, ⚡ XP, bell, avatar; today's progress ring; "Up next" = undone homework + open assessments + word homework + today's lesson across all classes, by due date; live quiz banner, new midterm result, survey card, stories, compact SAT countdown.
   - Class: all classes together with **All · Math · English** chips (hidden with one class); next lessons; segments **Tasks** (To do / Done / Results incl. midterm scores + reports) · **Schedule** · **People** · **Files**; Telegram group button; live quiz Join.
   - Words: "Review today" hero + Start; assigned sets, sections, search, my sets; four modes.
   - Rewards: trophy hero ("#4 in your class this week", "90 XP to pass Malika"), streak + coins cards (convert on coins), leaderboard XP | Strikes, "where your XP came from" ledger, shop.
   - Explore: four live cards — Roadmap, Services (support booking + SAT checklist), Events (+ tickets), Surveys.
   - Me sheet: profile, target scores + SAT date (moved from Home), My progress, midterm history + certificates, notification settings, account, sign out.
   - Links: `home`→Today; `classes`→Class tab; `classroom`, `homework`, `assessments`, `midterms`, `midtermResult`, `examReview`, `liveQuiz` → pushed on Class; `vocabulary`→Words, its set/section pushed on Words; `points`, `shop`, `leaderboard` → pushed on Rewards; `roadmap`, `roadmapDelivery`, `services`, `support`, `events`, `surveys`, `survey` → pushed on Explore; `profile` → Me sheet; `progress` → pushed inside the Me sheet; `certificate` → its own sheet; `unknown` → the website.
3. **Motion — level 3, playful everywhere:** press squash on every tappable, staggered spring entrances, tab icon bounce + sliding pill, rolling numbers with a pulse, list insert/remove springs, card→page zoom on iOS 18+, skeleton loading.
   - Celebrations (real events only): task finished (Lottie check + confetti + wobble + success haptic, every time); real XP gain ("+N XP" flies into the pill; also "while you were away" on launch); all of today done (double confetti + hero bounce); streak up; rank up (trophy); shop purchase (coin burst).
   - **Focus zones** get their own calm motion (≤250 ms, no overshoot over content, no looping Lottie near text, never hints at right/wrong while answering): assessment runner, vocab test, flashcards (3D flip + swipe), matching, speed, homework upload, reviews, sign-in.
   - Haptics: selection (tabs, chips, segments), light (buttons), success (task done), increase (XP lands), warning (errors). No sounds.
4. **Lottie** made by code (`ios/tools/lottie/make-lottie.mjs`), played with `lottie-spm`; interactive motion (confetti, XP flight, springs) in SwiftUI. Catalogue: strike-flame, task-complete, trophy (phase 1); coin-burst, star-burst, empty states all-done / no-tasks / no-words / offline / error (later phases).
5. **Phases** (one PR each, simulator demo — screenshots + screen recording — to the owner before merge):
   1. Foundation + shell (in full below; PR #304).
   2. Today + Class (in full below).
   3. Rewards + Words.
   4. Focus zones.
   5. Explore + Me + polish (empty/error Lottie, Reduce Motion, VoiceOver, dark mode, iPhone SE).

---

## File structure (phase 1)

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):
- `Notifications/LinkPlacement.swift` — **new.** `AppTab` and `AppLink.placement`: where a link lands.
- `Motion/Confetti.swift` — **new.** `SeededGenerator`, `ConfettiParticle`, `ConfettiBurst` (physics), `MotionBudget`.

Kit tests (`ios/MasterSATKit/Tests/MasterSATKitTests/`):
- `LinkPlacementTests.swift`, `ConfettiTests.swift` — **new.**

App (`ios/MasterSAT/`):
- `project.yml` — add the Lottie package + `Resources/Lottie`.
- `Resources/Lottie/{strike-flame,task-complete,trophy}.json` — **new**, generated.
- `Sources/Support/Theme.swift` — new tokens; restyled `cardStyle`, `Chip`, button styles.
- `Sources/Support/PageChrome.swift` — restyled `PageTitle`, `PillTabs`.
- `Sources/Support/Motion/Motion.swift` — **new.** Curves, `PressBounce`, `stagger`.
- `Sources/Support/Motion/LottieClip.swift` — **new.** `LottieAsset`, `LottieClip`.
- `Sources/Support/Motion/Celebrations.swift` — **new.** `CelebrationCenter`, `CelebrationLayer`, `ConfettiCanvas`, `XPFlightView`.
- `Sources/Screens/Shell/AppRouter.swift` — **new.** Selection, one path per tab, the Me sheet, `open(_:)`.
- `Sources/Screens/Shell/RewardsStore.swift` — **new.** XP / streak / coins for the headers.
- `Sources/Screens/Shell/AppHeader.swift` — **new.** `AppHeader`, `StrikeChip`, `XPPill`, `AvatarButton`.
- `Sources/Screens/Shell/FloatingTabBar.swift` — **new.**
- `Sources/Screens/Shell/HubCard.swift` — **new** (moved out of `RootView.swift`, restyled).
- `Sources/Screens/Shell/AppLinkPage.swift` — **new** (replaces `Screens/LinkDestination.swift`).
- `Sources/Screens/Shell/ClassHubView.swift` — **new** (interim Class tab; replaced in phase 2).
- `Sources/Screens/Shell/ExploreView.swift` — **new.**
- `Sources/Screens/RootView.swift` — `RootTabView` rewritten; `RootTab`, `LearnHubView`, `HubCard` removed.
- `Sources/Screens/DashboardView.swift`, `Vocabulary/VocabularyView.swift`, `Rewards/RewardsHubView.swift`, `ProfileView.swift` — take a `path` binding, use `AppHeader`, push `AppLink`s.
- `Sources/Screens/LinkDestination.swift` — **deleted.**

Tools: `ios/tools/lottie/make-lottie.mjs` — **new.**

---

## Phase 1 — Foundation and shell

### Task 0: Baseline

**Files:** none changed.

- [ ] **Step 1: Confirm the worktree and identity**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git branch --show-current          # feat/ios-redesign
git config user.email              # viltrumlik@gmail.com
git status --short                 # empty
```

- [ ] **Step 2: Kit tests are green before any change**

Run: `cd ios/MasterSATKit && swift test 2>&1 | tail -5`
Expected: a line `✔ Test run with N tests passed` (only a literal pass counts). Note N.

- [ ] **Step 3: The app builds before any change**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; echo "exit=$?"
grep -E "error:|BUILD (SUCCEEDED|FAILED)" /tmp/ms-build.log | head
```
Expected: `exit=0` and `** BUILD SUCCEEDED **`. Then `git status --short` lists neither `build/` nor the `.xcodeproj`; if either appears, add `ios/MasterSAT/build/` to `.gitignore` in Task 3's commit.

---

### Task 1: Where a link lands (`AppTab`, `LinkPlacement`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Notifications/LinkPlacement.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/LinkPlacementTests.swift`

**Interfaces:**
- Consumes: `AppLink` (existing, `Notifications/AppLink.swift`).
- Produces: `public enum AppTab: String, CaseIterable, Sendable, Hashable { case today, classes, words, rewards, explore }`; `public enum LinkPlacement: Equatable, Sendable { case tab(AppTab); case push(AppTab, AppLink); case me(push: AppLink?); case certificate(code: String); case web }`; `extension AppLink { public var placement: LinkPlacement }`.

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import MasterSATKit

@Suite struct LinkPlacementTests {

    @Test("A link that IS a tab switches to it")
    func tabs() {
        #expect(AppLink.home.placement == .tab(.today))
        #expect(AppLink.classes.placement == .tab(.classes))
        #expect(AppLink.vocabulary.placement == .tab(.words))
    }

    @Test("Class work is pushed onto the Class tab")
    func classWork() {
        let links: [AppLink] = [
            .classroom(id: 3), .homework(classroomId: 3, assignmentId: 9), .assessments,
            .midterms, .midtermResult(attemptId: 4), .examReview(attemptId: 4), .liveQuiz(sessionId: nil),
        ]
        for link in links { #expect(link.placement == .push(.classes, link)) }
    }

    @Test("A word set or section is pushed onto Words")
    func words() {
        #expect(AppLink.vocabularySet(id: 7).placement == .push(.words, .vocabularySet(id: 7)))
        #expect(AppLink.vocabularySection(id: 2).placement == .push(.words, .vocabularySection(id: 2)))
    }

    @Test("Points, shop and leaderboard are pushed onto Rewards")
    func rewards() {
        for link in [AppLink.points, .shop, .leaderboard] {
            #expect(link.placement == .push(.rewards, link))
        }
    }

    @Test("Roadmap, services, events and surveys are pushed onto Explore")
    func explore() {
        let links: [AppLink] = [.roadmap, .roadmapDelivery(id: 5), .services, .support, .events, .surveys, .survey(id: 8)]
        for link in links { #expect(link.placement == .push(.explore, link)) }
    }

    @Test("Profile opens the Me sheet; progress is pushed inside it")
    func me() {
        #expect(AppLink.profile.placement == .me(push: nil))
        #expect(AppLink.progress.placement == .me(push: .progress))
    }

    @Test("A certificate gets its own sheet; an unknown page opens on the site")
    func sheetsAndWeb() {
        #expect(AppLink.certificate(code: "AB12").placement == .certificate(code: "AB12"))
        #expect(AppLink.unknown("/teacher").placement == .web)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ios/MasterSATKit && swift test --filter LinkPlacementTests 2>&1 | tail -5`
Expected: build error `value of type 'AppLink' has no member 'placement'`. If instead an initializer label differs (e.g. `classroom(id:)`), read `Sources/MasterSATKit/Notifications/AppLink.swift` and use its labels in BOTH the test and Step 3.

- [ ] **Step 3: Implement**

```swift
import Foundation

/// The app's five tabs. Named in the kit so where a link lands can be tested without a UI.
public enum AppTab: String, CaseIterable, Sendable, Hashable {
    case today, classes, words, rewards, explore
}

/// Where opening an `AppLink` takes the student.
///
/// A page always lands INSIDE the tab it belongs to, pushed onto that tab's stack, so Back
/// walks the student out the way they would have walked in. Only the certificate keeps a
/// sheet of its own (it brings its own stack, Done and Share), and only Me lives in a sheet.
public enum LinkPlacement: Equatable, Sendable {
    /// Switch to the tab and pop it to its root.
    case tab(AppTab)
    /// Switch to the tab, pop it to its root, then push the page.
    case push(AppTab, AppLink)
    /// Open the Me sheet, optionally pushing a page inside it.
    case me(push: AppLink?)
    /// The certificate viewer, in its own sheet.
    case certificate(code: String)
    /// A page the app does not have; open it on the site.
    case web
}

extension AppLink {
    public var placement: LinkPlacement {
        switch self {
        case .home: return .tab(.today)
        case .classes: return .tab(.classes)
        case .classroom, .homework, .assessments, .midterms, .midtermResult, .examReview, .liveQuiz:
            return .push(.classes, self)
        case .vocabulary: return .tab(.words)
        case .vocabularySection, .vocabularySet: return .push(.words, self)
        case .points, .shop, .leaderboard: return .push(.rewards, self)
        case .roadmap, .roadmapDelivery, .services, .support, .events, .surveys, .survey:
            return .push(.explore, self)
        case .profile: return .me(push: nil)
        case .progress: return .me(push: self)
        case .certificate(let code): return .certificate(code: code)
        case .unknown: return .web
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ios/MasterSATKit && swift test --filter LinkPlacementTests 2>&1 | tail -3`
Expected: `✔ Suite LinkPlacementTests passed` with 7 tests.

- [ ] **Step 5: Commit**

```bash
git add ios/MasterSATKit/Sources/MasterSATKit/Notifications/LinkPlacement.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/LinkPlacementTests.swift
git commit -m "feat(ios-kit): where a link lands — five tabs, a push, the Me sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Confetti physics and the motion budget

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Motion/Confetti.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/ConfettiTests.swift`

**Interfaces:**
- Produces: `public struct SeededGenerator: RandomNumberGenerator, Sendable { public init(seed: UInt64) }`; `public struct ConfettiParticle: Sendable, Equatable { vx, vy, spin, size: Double; colorIndex: Int; shape: Int }`; `public struct ConfettiBurst: Sendable, Identifiable { id: UUID; originX, originY: Double; start: Date; particles: [ConfettiParticle]; static let lifetime: TimeInterval = 2.3; static func make(x:y:count:power:start:palette:seed:) -> ConfettiBurst; func position(of:at:) -> (x: Double, y: Double); func opacity(at:) -> Double; func isFinished(at:) -> Bool }`; `public struct MotionBudget: Sendable, Equatable { init(reduceMotion:lowPower:); func confetti(_ base: Int) -> Int; var allowsFlights: Bool; var allowsLoopingLottie: Bool }`.

- [ ] **Step 1: Write the failing test**

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ConfettiTests {

    private let start = Date(timeIntervalSince1970: 1_000)

    @Test("The same seed throws the same confetti")
    func deterministic() {
        let a = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 42)
        let b = ConfettiBurst.make(x: 100, y: 200, count: 20, start: start, seed: 42)
        #expect(a.particles == b.particles)
        #expect(a.particles.count == 20)
    }

    @Test("Every particle leaves upward")
    func upward() {
        let burst = ConfettiBurst.make(x: 0, y: 0, count: 60, start: start, seed: 7)
        #expect(burst.particles.allSatisfy { $0.vy < 0 })
    }

    @Test("A particle starts at the origin and gravity pulls it down")
    func motion() throws {
        let burst = ConfettiBurst.make(x: 100, y: 300, count: 1, start: start, seed: 1)
        let p = try #require(burst.particles.first)
        let atZero = burst.position(of: p, at: 0)
        #expect(atZero.x == 100)
        #expect(atZero.y == 300)
        // After two seconds the fall has beaten the upward throw.
        #expect(burst.position(of: p, at: 2).y > 300)
    }

    @Test("Opaque until 1.5 s, gone at the end of its life")
    func fade() {
        let burst = ConfettiBurst.make(x: 0, y: 0, count: 1, start: start, seed: 1)
        #expect(burst.opacity(at: 1.0) == 1)
        #expect(abs(burst.opacity(at: 1.9) - 0.5) < 0.001)
        #expect(burst.opacity(at: ConfettiBurst.lifetime) == 0)
        #expect(burst.isFinished(at: start.addingTimeInterval(ConfettiBurst.lifetime)))
        #expect(!burst.isFinished(at: start.addingTimeInterval(1)))
    }

    @Test("Reduce Motion throws nothing; Low Power throws half")
    func budget() {
        #expect(MotionBudget(reduceMotion: false, lowPower: false).confetti(44) == 44)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).confetti(44) == 22)
        #expect(MotionBudget(reduceMotion: true, lowPower: false).confetti(44) == 0)
        #expect(!MotionBudget(reduceMotion: true, lowPower: false).allowsFlights)
        #expect(!MotionBudget(reduceMotion: true, lowPower: false).allowsLoopingLottie)
        #expect(MotionBudget(reduceMotion: false, lowPower: true).allowsFlights)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ios/MasterSATKit && swift test --filter ConfettiTests 2>&1 | tail -5`
Expected: build error `cannot find 'ConfettiBurst' in scope`.

- [ ] **Step 3: Implement**

```swift
import Foundation

/// SplitMix64 — a tiny deterministic generator, so a burst can be replayed in a test.
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) { state = seed }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

public struct ConfettiParticle: Sendable, Equatable {
    public let vx: Double
    public let vy: Double
    public let spin: Double
    public let size: Double
    /// Index into the app's palette; the kit knows no colours.
    public let colorIndex: Int
    /// 0 strip, 1 dot, 2 ribbon.
    public let shape: Int
}

/// One throw of confetti: where it started, when, and how each piece moves.
///
/// Physics, not keyframes, so pieces thrown from a small row and from the whole screen
/// behave the same: thrown up and out, slowed by drag, pulled down by gravity, faded at
/// the end of a fixed life.
public struct ConfettiBurst: Sendable, Identifiable {
    public let id: UUID
    public let originX: Double
    public let originY: Double
    public let start: Date
    public let particles: [ConfettiParticle]

    public static let lifetime: TimeInterval = 2.3
    static let fadeStart: TimeInterval = 1.5
    static let drag = 2.4
    static let gravity = 520.0

    public static func make(
        x: Double, y: Double, count: Int, power: Double = 1, start: Date = .now,
        palette: Int = 6, seed: UInt64 = .random(in: 0...UInt64.max)
    ) -> ConfettiBurst {
        var rng = SeededGenerator(seed: seed)
        let particles = (0..<max(0, count)).map { index -> ConfettiParticle in
            let angle = Double.random(in: (-Double.pi * 0.97)...(-Double.pi * 0.03), using: &rng)
            let speed = Double.random(in: 380...900, using: &rng) * power
            return ConfettiParticle(
                vx: cos(angle) * speed,
                vy: sin(angle) * speed,
                spin: Double.random(in: -14...14, using: &rng),
                size: Double.random(in: 6...11, using: &rng),
                colorIndex: index % max(1, palette),
                shape: index % 3
            )
        }
        return ConfettiBurst(id: UUID(), originX: x, originY: y, start: start, particles: particles)
    }

    /// Where `particle` is `t` seconds after the throw.
    public func position(of particle: ConfettiParticle, at t: TimeInterval) -> (x: Double, y: Double) {
        let travel = (1 - exp(-Self.drag * t)) / Self.drag
        return (originX + particle.vx * travel,
                originY + particle.vy * travel + Self.gravity * t * t)
    }

    /// 1 until `fadeStart`, then down to 0 at `lifetime`.
    public func opacity(at t: TimeInterval) -> Double {
        guard t >= 0 else { return 0 }
        return max(0, min(1, 1 - (t - Self.fadeStart) / (Self.lifetime - Self.fadeStart)))
    }

    public func isFinished(at date: Date) -> Bool {
        date.timeIntervalSince(start) >= Self.lifetime
    }
}

/// What the student's settings allow the celebrations to do.
///
/// Reduce Motion is a promise: nothing flies, nothing loops, nothing is thrown. Low Power
/// Mode keeps the celebration but halves the work.
public struct MotionBudget: Sendable, Equatable {
    public var reduceMotion: Bool
    public var lowPower: Bool

    public init(reduceMotion: Bool, lowPower: Bool) {
        self.reduceMotion = reduceMotion
        self.lowPower = lowPower
    }

    public func confetti(_ base: Int) -> Int {
        if reduceMotion { return 0 }
        return lowPower ? base / 2 : base
    }

    public var allowsFlights: Bool { !reduceMotion }
    public var allowsLoopingLottie: Bool { !reduceMotion }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ios/MasterSATKit && swift test --filter ConfettiTests 2>&1 | tail -3`
Expected: `✔ Suite ConfettiTests passed` with 5 tests. Then the whole kit: `swift test 2>&1 | tail -2` → passed.

- [ ] **Step 5: Commit**

```bash
git add ios/MasterSATKit/Sources/MasterSATKit/Motion/Confetti.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/ConfettiTests.swift
git commit -m "feat(ios-kit): confetti physics and the motion budget (Reduce Motion, Low Power)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Lottie — generator, three files, the package, `LottieClip`

**Files:**
- Create: `ios/tools/lottie/make-lottie.mjs`
- Create (generated): `ios/MasterSAT/Resources/Lottie/strike-flame.json`, `task-complete.json`, `trophy.json`
- Modify: `ios/MasterSAT/project.yml`
- Create: `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift`

**Interfaces:**
- Produces: `enum LottieAsset: String, CaseIterable { case strikeFlame = "strike-flame", taskComplete = "task-complete", trophy }`; `struct LottieClip: View { init(_ asset: LottieAsset, loops: Bool = true) }`.

- [ ] **Step 1: Write the generator**

`ios/tools/lottie/make-lottie.mjs` — the three animations the owner approved in the browser preview, as code:

```js
// Generates the app's Lottie files. Run: node ios/tools/lottie/make-lottie.mjs
// Output: ios/MasterSAT/Resources/Lottie/*.json (checked in). Edit here, never the JSON.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../MasterSAT/Resources/Lottie');

const C = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1];
const S = v => ({ a: 0, k: v });
const IO = { o: { x: [.45], y: [0] }, i: { x: [.55], y: [1] } };
const OUTE = { o: { x: [.2], y: [0] }, i: { x: [.2], y: [1] } };
const IN = { o: { x: [.55], y: [0] }, i: { x: [.9], y: [.5] } };
const POP = { o: { x: [.34], y: [1.56] }, i: { x: [.64], y: [1] } };
const LIN = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
function A(frames, ease) {
  return { a: 1, k: frames.map(([t, v, e], n) => {
    const s = Array.isArray(v) ? v : [v];
    if (n === frames.length - 1) return { t, s };
    const z = e || ease || IO;
    return { t, s, o: z.o, i: z.i };
  }) };
}
function AS(frames) {
  return { a: 1, k: frames.map(([t, v], n) => n === frames.length - 1 ? { t, s: [v] }
    : { t, s: [v], o: { x: .45, y: 0 }, i: { x: .55, y: 1 } }) };
}
const P = (v, i, o, c = true) => ({ i, o, v, c });
const sh = k => ({ ty: 'sh', ks: k });
const fl = (hex, op = 100) => ({ ty: 'fl', c: S(C(hex)), o: S(op), r: 1 });
const st = (hex, w) => ({ ty: 'st', c: S(C(hex)), o: S(100), w: S(w), lc: 2, lj: 2, ml: 4 });
const tr = (o = {}) => ({ ty: 'tr', p: o.p || S([0, 0]), a: o.a || S([0, 0]), s: o.s || S([100, 100]), r: o.r || S(0), o: o.o || S(100), sk: S(0), sa: S(0) });
const gr = (items, t) => ({ ty: 'gr', it: [...items, t || tr()] });
const el = (w, h, p = [0, 0]) => ({ ty: 'el', p: S(p), s: S([w, h]), d: 1 });
const rc = (w, h, p, r) => ({ ty: 'rc', p: S(p), s: S([w, h]), r: S(r), d: 1 });
const tm = (s, e) => ({ ty: 'tm', s, e, o: S(0), m: 1 });
const rp = (n, rot) => ({ ty: 'rp', c: S(n), o: S(0), m: 1, tr: { ty: 'tr', p: S([0, 0]), a: S([0, 0]), s: S([100, 100]), r: S(rot), so: S(100), eo: S(100) } });
const star = (pt, inner, outer, p = [0, 0]) => ({ ty: 'sr', sy: 1, d: 1, pt: S(pt), p: S(p), r: S(0), ir: S(inner), is: S(0), or: S(outer), os: S(0) });
const L = (ind, nm, shapes, ks = {}, extra = {}) => ({ ddd: 0, ind, ty: 4, nm, sr: 1,
  ks: { o: ks.o || S(100), r: ks.r || S(0), p: ks.p || S([100, 100, 0]), a: ks.a || S([0, 0, 0]), s: ks.s || S([100, 100, 100]) },
  ao: 0, shapes, ip: 0, op: 9999, st: 0, bm: 0, ...extra });
const anim = (nm, op, layers) => ({ v: '5.7.4', fr: 60, ip: 0, op, w: 200, h: 200, nm, ddd: 0, assets: [], layers });

// Strike flame — loops. Three nested flames morph between three silhouettes; sparks rise.
function flame(tipX, tipY, w) {
  return P([[tipX, tipY], [30 * w, -8], [36 * w, 22], [0, 54], [-36 * w, 22], [-22 * w, -20]],
    [[-6, 14], [-6, -16], [0, -10], [20 * w, 0], [0, 20], [-8, 12]],
    [[6, 16], [8, 14], [0, 20], [-20 * w, 0], [0, -12], [6, -10]]);
}
const flick = () => AS([[0, flame(4, -62, 1)], [30, flame(-7, -56, 1.05)], [60, flame(9, -67, .96)], [90, flame(4, -62, 1)]]);
const sparks = [[-14, 0, -8], [10, 10, 12], [-4, 20, -16], [18, 30, 6], [-20, 40, 10]].map(([x, d, dx], n) =>
  L(10 + n, 'spark' + n, [gr([el(7, 7), fl('#fbbf24')])], {
    p: A([[d, [100 + x, 128, 0]], [d + 50, [100 + x + dx, 28, 0]]], OUTE),
    o: A([[d, 0], [d + 8, 100], [d + 50, 0]]),
    s: A([[d, [100, 100, 100]], [d + 50, [40, 40, 100]]]),
  }));
const FLAME = anim('strike-flame', 90, [
  ...sparks,
  L(2, 'flame', [
    gr([sh(flick()), fl('#fef3c7')], tr({ p: S([0, 38]), s: S([30, 30]) })),
    gr([sh(flick()), fl('#fbbf24')], tr({ p: S([0, 20]), s: S([62, 62]) })),
    gr([sh(flick()), fl('#f97316')]),
  ], { a: S([0, 54, 0]), p: S([100, 170, 0]), s: A([[0, [100, 100, 100]], [45, [95, 105, 100]], [90, [100, 100, 100]]]) }),
  L(3, 'glow', [gr([el(96, 18), fl('#f97316', 22)])], { p: S([100, 172, 0]) }),
]);

// Task complete — plays once. Circle pops, the tick draws, rays and dots burst out.
const dot = (hex, size, from, to, rot) => gr([
  gr([el(size, size), fl(hex)], tr({ p: A([[10, [0, -from]], [40, [0, -to]]], OUTE), s: A([[10, [100, 100]], [34, [100, 100]], [44, [0, 0]]]) })),
  rp(6, 60),
], tr({ r: S(rot) }));
const CHECK = anim('task-complete', 110, [
  L(1, 'check', [gr([sh(S(P([[-20, 2], [-6, 16], [22, -14]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false))),
    tm(S(0), A([[12, 0], [28, 100]], OUTE)), st('#ffffff', 10)])]),
  L(2, 'circle', [gr([el(84, 84), fl('#22c55e')])], { s: A([[0, [0, 0, 100], POP], [16, [112, 112, 100]], [26, [100, 100, 100]]]) }),
  L(3, 'dots', [dot('#f59e0b', 9, 46, 88, 30), dot('#a855f7', 7, 40, 74, 0)]),
  L(4, 'rays', [gr([sh(S(P([[0, -50], [0, -76]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false))),
    tm(A([[16, 0], [32, 100]], OUTE), A([[8, 0], [22, 100]], OUTE)), st('#f59e0b', 6), rp(8, 45)])]),
]);

// Trophy — loops. Drops in and squashes, a shine sweeps across, stars twinkle, rays turn.
const cupBody = P([[-38, -42], [38, -42], [0, 20]], [[0, 32], [0, 0], [28, 0]], [[0, 0], [0, 32], [-28, 0]]);
const cupPos = () => A([[0, [100, 40, 0], IN], [18, [100, 160, 0]], [90, [100, 160, 0], OUTE], [102, [100, 140, 0], IN], [114, [100, 160, 0]]]);
const cupScale = () => A([[0, [100, 100, 100]], [18, [100, 100, 100], OUTE], [24, [116, 84, 100]], [36, [94, 108, 100]], [46, [100, 100, 100]],
  [112, [100, 100, 100], OUTE], [118, [110, 90, 100]], [130, [100, 100, 100]]]);
const cupKs = () => ({ a: S([0, 56, 0]), p: cupPos(), s: cupScale(), o: A([[0, 0], [4, 100]]) });
const twinkle = (x, y, d, hex, size) => gr([star(4, size * .3, size), fl(hex)],
  tr({ p: S([x, y]), s: A([[d, [0, 0]], [d + 12, [100, 100]], [d + 30, [0, 0]]]), r: A([[d, 0], [d + 30, 45]]) }));
const TROPHY = anim('trophy', 150, [
  L(1, 'stars', [twinkle(-64, -44, 30, '#fbbf24', 12), twinkle(66, -22, 52, '#2a68c0', 10), twinkle(48, -72, 74, '#fbbf24', 9), twinkle(-52, 6, 96, '#2a68c0', 8)]),
  L(2, 'shine-matte', [gr([sh(S(cupBody)), fl('#000000')])], cupKs(), { td: 1 }),
  L(3, 'shine', [gr([rc(16, 150, [0, 0], 0), fl('#ffffff', 75)], tr({ p: A([[40, [-80, -10]], [66, [80, -10]]], IO), r: S(22) }))], cupKs(), { tt: 1 }),
  L(4, 'cup', [
    gr([star(5, 5, 11, [0, -18]), fl('#fff7d6')]),
    gr([rc(84, 10, [0, -44], 5), fl('#fbbf24')]),
    gr([sh(S(cupBody)), fl('#f59e0b')]),
    gr([el(30, 34, [-40, -20]), st('#f59e0b', 6)]),
    gr([el(30, 34, [40, -20]), st('#f59e0b', 6)]),
    gr([rc(12, 22, [0, 30], 2), fl('#d97706')]),
    gr([rc(54, 14, [0, 47], 5), fl('#b45309')]),
  ], cupKs()),
  L(5, 'burst', [gr([sh(S(P([[-7, -30], [7, -30], [0, -100]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]]))), fl('#fbbf24', 26), rp(12, 30)])],
    { p: S([100, 112, 0]), r: A([[0, 0], [150, 30]], LIN), s: A([[0, [0, 0, 100], POP], [26, [100, 100, 100]]]) }),
]);

mkdirSync(OUT, { recursive: true });
for (const data of [FLAME, CHECK, TROPHY]) {
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, data.nm + '.json'), json);
  console.log(data.nm, json.length, 'bytes');
}
```

- [ ] **Step 2: Generate the files**

Run: `node ios/tools/lottie/make-lottie.mjs`
Expected: three lines (`strike-flame`, `task-complete`, `trophy`), each under 15 000 bytes.

- [ ] **Step 3: Add the package and the resources to `project.yml`**

In `ios/MasterSAT/project.yml`, `packages:` becomes:

```yaml
packages:
  MasterSATKit:
    path: ../MasterSATKit
  # Plays the motion graphics in Resources/Lottie (generated by ios/tools/lottie).
  Lottie:
    url: https://github.com/airbnb/lottie-spm.git
    from: 4.5.0
```

Under `targets.MasterSAT.sources`, after the `Resources/katex` entry, add:

```yaml
      # Generated by `node ios/tools/lottie/make-lottie.mjs`; loaded by name (LottieAsset).
      - path: Resources/Lottie
        buildPhase: resources
```

Under `targets.MasterSAT.dependencies`, add `      - package: Lottie` after `      - package: MasterSATKit`.

- [ ] **Step 4: Write `LottieClip`**

`ios/MasterSAT/Sources/Support/Motion/LottieClip.swift`:

```swift
import SwiftUI
import Lottie

/// The bundled motion graphics, by file name (Resources/Lottie/<rawValue>.json).
enum LottieAsset: String, CaseIterable {
    case strikeFlame = "strike-flame"
    case taskComplete = "task-complete"
    case trophy
}

/// A Lottie, played the way the student's settings allow.
///
/// With Reduce Motion on, a looping clip shows its last frame, still; a one-shot shows
/// nothing at all — the static screen around it already says what happened.
struct LottieClip: View {
    let asset: LottieAsset
    var loops: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ asset: LottieAsset, loops: Bool = true) {
        self.asset = asset
        self.loops = loops
    }

    var body: some View {
        Group {
            if reduceMotion {
                if loops {
                    LottieView(animation: .named(asset.rawValue))
                        .playbackMode(.paused(at: .progress(1)))
                        .resizable()
                }
            } else if loops {
                LottieView(animation: .named(asset.rawValue))
                    .looping()
                    .resizable()
            } else {
                LottieView(animation: .named(asset.rawValue))
                    .playing(loopMode: .playOnce)
                    .resizable()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
```

- [ ] **Step 5: Build and prove the files are in the app**

```bash
cd ios/MasterSAT && xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; echo "exit=$?"
grep -E "error:|BUILD (SUCCEEDED|FAILED)" /tmp/ms-build.log | sort -u | head
for f in strike-flame task-complete trophy; do
  test -f build/dd/Build/Products/Debug-iphonesimulator/MasterSAT.app/$f.json && echo "ok $f"
done
```
Expected: `exit=0`, then `ok strike-flame`, `ok task-complete`, `ok trophy`. If a compile error names `playbackMode` or `playing(loopMode:)`, read the resolved package's `LottieView.swift` under `build/dd/SourcePackages/checkouts/` and use the method names it declares (same behaviour: paused at the end / play once / loop).

- [ ] **Step 6: Commit**

```bash
git add ios/tools/lottie/make-lottie.mjs ios/MasterSAT/Resources/Lottie ios/MasterSAT/project.yml \
        ios/MasterSAT/Sources/Support/Motion/LottieClip.swift
git commit -m "feat(ios): Lottie motion graphics — generated flame, task-complete, trophy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Design tokens and the app-wide restyle

**Files:**
- Create: `ios/MasterSAT/Sources/Support/Motion/Motion.swift`
- Modify: `ios/MasterSAT/Sources/Support/Theme.swift`
- Modify: `ios/MasterSAT/Sources/Support/PageChrome.swift` (`PageTitle`, `PillTabs`)

**Interfaces:**
- Produces: `enum Motion { static let press, pop, snappy, bouncy, focus: Animation; static let staggerStep: Double }`; `struct PressBounce: ButtonStyle`; `extension View { func stagger(_ index: Int, shown: Bool) -> some View }`; `Theme.strike`, `Theme.subjectMath`, `Theme.subjectWords`, `Theme.cardEdge`; `Theme.Radius.card == 18`.

- [ ] **Step 1: Capture "before" screenshots**

With the Task 0 build signed in on the simulator (local backend + test account: Task 9 Steps 2–3), save `before-home.png`, `before-words.png`, `before-rewards.png` to the session scratchpad with `sleep 2; xcrun simctl io booted screenshot <file>`.

- [ ] **Step 2: Write `Motion.swift`**

```swift
import SwiftUI

/// The app's motion vocabulary — level 3, "playful everywhere" (owner, 2026-10-20).
///
/// Every animated thing picks one of these rather than inventing a curve; the focus zones
/// (runner, vocab test, upload, review) use `focus` and nothing else.
enum Motion {
    /// A tap: quick squash, lively return.
    static let press = Animation.spring(response: 0.22, dampingFraction: 0.45)
    /// Something appearing, popping, or changing state.
    static let pop = Animation.spring(response: 0.32, dampingFraction: 0.45)
    /// Layout moving: tabs, chips, segments, filters.
    static let snappy = Animation.spring(response: 0.38, dampingFraction: 0.62)
    /// Whole blocks entering a screen.
    static let bouncy = Animation.spring(response: 0.55, dampingFraction: 0.56)
    /// Focus zones: short and without overshoot, so nothing moves over the content.
    static let focus = Animation.easeOut(duration: 0.2)
    /// The beat between blocks of a staggered entrance.
    static let staggerStep = 0.07
}

/// Every tappable squashes when pressed.
struct PressBounce: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

private struct Stagger: ViewModifier {
    let index: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .opacity(shown ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: shown)
        } else {
            content
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 44)
                .scaleEffect(shown ? 1 : 0.86, anchor: .top)
                .animation(Motion.bouncy.delay(Double(index) * Motion.staggerStep), value: shown)
        }
    }
}

extension View {
    /// Springs the block up from below, `index` beats after the screen appears.
    func stagger(_ index: Int, shown: Bool) -> some View {
        modifier(Stagger(index: index, shown: shown))
    }
}
```

- [ ] **Step 3: New tokens in `Theme.swift`**

Inside `enum Theme`, after `static let subjectEnglish = …`, add:

```swift
    /// Maths is the brand blue — the board already colours it so; named for call sites.
    static let subjectMath = accent
    /// Words carry the amber of the vocabulary hub.
    static let subjectWords = amber
    /// The streak's flame orange.
    static let strike = dynamic(light: 0xea580c, dark: 0xfb923c)
    /// A card's edge: nothing in light mode (the shadow separates it), a faint line in dark,
    /// where a shadow cannot be seen.
    static let cardEdge = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor.white.withAlphaComponent(0.08) : UIColor.clear })
```

In `enum Radius`: `static let card: CGFloat = 16` → `static let card: CGFloat = 18`, and its doc comment line → `/// 12 for controls, 18 for cards, 24 for hero panels.`

Replace the body of `cardStyle(padding:)` (keep its doc comment) with:

```swift
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.cardEdge, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 3)
```

In `Chip.body`: `Text(text).font(.system(size: 12, weight: .bold))` → `Text(text).font(.system(size: 12, weight: .bold, design: .rounded))`.

In `PrimaryButtonStyle.makeBody`, replace its last two modifiers (`.scaleEffect(… 0.98 …)` and `.animation(.easeOut(duration: 0.12), …)`) with:

```swift
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(Motion.press, value: configuration.isPressed)
```

In `SecondaryButtonStyle.makeBody`, append the same two lines after its `.background(…)`.

- [ ] **Step 4: Restyle `PageTitle` and `PillTabs` in `PageChrome.swift`**

`PageTitle.body` becomes:

```swift
        Text(text)
            .font(.system(.largeTitle, design: .rounded, weight: .heavy))
            .tracking(-0.5)
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
```

In `PillTabs`: add `@Namespace private var pill` under `@Binding var selection: Tab`. In the button action, `selection = item.tab` → `withAnimation(Motion.snappy) { selection = item.tab }`. Replace the label's `.background(Capsule().fill(active ? Theme.accent : Theme.card))` with:

```swift
                        .background {
                            if active {
                                Capsule().fill(Theme.accent).matchedGeometryEffect(id: "pill", in: pill)
                            } else {
                                Capsule().fill(Theme.card)
                            }
                        }
```

Change that button's `.buttonStyle(.plain)` to `.buttonStyle(PressBounce())`, and add `.sensoryFeedback(.selection, trigger: selection)` after `.scrollIndicators(.hidden)`.

- [ ] **Step 5: Build, then capture "after" screenshots**

Run the Task 3 Step 5 build. Expected `exit=0`. Install, launch, sign in; save `after-home.png`, `after-words.png`, `after-rewards.png`. Compared with "before": rounded heavy titles, 18-pt cards without hairlines in light mode, the profile tab pills slide. `xcrun simctl ui booted appearance dark` → screenshot Home: cards keep a faint edge. Back to light: `xcrun simctl ui booted appearance light`.

- [ ] **Step 6: Commit**

```bash
git add ios/MasterSAT/Sources/Support/Motion/Motion.swift ios/MasterSAT/Sources/Support/Theme.swift \
        ios/MasterSAT/Sources/Support/PageChrome.swift
git commit -m "feat(ios): the new look across every screen — tokens, rounded titles, springy controls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Celebrations — confetti and the XP flight

**Files:**
- Create: `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift`

**Interfaces:**
- Consumes: `ConfettiBurst`, `MotionBudget` (Task 2); `Motion` (Task 4); `Theme`.
- Produces: `@MainActor @Observable final class CelebrationCenter { var reduceMotion: Bool; private(set) var bursts: [ConfettiBurst]; private(set) var flights: [XPFlight]; private(set) var landedCount: Int; enum Size { case task, everything }; func confetti(at: CGPoint, size: Size = .task); func flyXP(_ amount: Int, from: CGPoint); func landed(_: XPFlight); func setXPTarget(_ rect: CGRect); func announce(_ text: String) }`; `struct CelebrationLayer: View` (full screen — place with `.ignoresSafeArea()`).

- [ ] **Step 1: Write `Celebrations.swift`**

```swift
import SwiftUI
import MasterSATKit

/// "+N XP" on its way from where it was earned to the header pill.
struct XPFlight: Identifiable, Equatable {
    let id = UUID()
    let amount: Int
    let from: CGPoint
    let to: CGPoint
}

/// Everything celebratory on screen, in one place, drawn by one overlay at the root.
///
/// Points are GLOBAL coordinates (`.frame(in: .global)`), which is what the overlay draws
/// in because it ignores the safe area. A flight is only ever started for XP the server
/// confirmed — this class does not decide that, its callers do.
@MainActor
@Observable
final class CelebrationCenter {
    enum Size { case task, everything }

    var reduceMotion = false
    private(set) var bursts: [ConfettiBurst] = []
    private(set) var flights: [XPFlight] = []
    /// Bumps when a flight lands; the XP pill pulses on it.
    private(set) var landedCount = 0
    private var xpTarget: CGRect = .zero

    private var budget: MotionBudget {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    func confetti(at point: CGPoint, size: Size = .task) {
        let count = budget.confetti(size == .task ? 44 : 80)
        guard count > 0 else { return }
        bursts.append(.make(x: point.x, y: point.y, count: count, power: size == .task ? 1 : 1.25))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(ConfettiBurst.lifetime + 0.2))
            self?.bursts.removeAll { $0.isFinished(at: .now) }
        }
    }

    func flyXP(_ amount: Int, from point: CGPoint) {
        guard amount > 0, budget.allowsFlights, xpTarget != .zero else { return }
        flights.append(XPFlight(amount: amount, from: point, to: CGPoint(x: xpTarget.midX, y: xpTarget.midY)))
    }

    func landed(_ flight: XPFlight) {
        flights.removeAll { $0.id == flight.id }
        landedCount += 1
    }

    func setXPTarget(_ rect: CGRect) {
        if rect != xpTarget { xpTarget = rect }
    }

    /// What a celebration says to VoiceOver, since it cannot be seen.
    func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

/// The overlay that draws the confetti and the flights. Never takes a touch.
struct CelebrationLayer: View {
    @Environment(CelebrationCenter.self) private var center

    var body: some View {
        ZStack {
            ConfettiCanvas(bursts: center.bursts)
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct ConfettiCanvas: View {
    let bursts: [ConfettiBurst]

    static let palette: [Color] = [Theme.accent, Theme.success, Theme.amber, Theme.subjectEnglish, Theme.danger, Theme.info]

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: bursts.isEmpty)) { timeline in
            Canvas { context, _ in
                for burst in bursts {
                    let t = timeline.date.timeIntervalSince(burst.start)
                    guard t >= 0, t < ConfettiBurst.lifetime else { continue }
                    let fade = burst.opacity(at: t)
                    for particle in burst.particles {
                        let point = burst.position(of: particle, at: t)
                        var piece = context
                        piece.opacity = fade
                        piece.translateBy(x: point.x, y: point.y)
                        piece.rotate(by: .radians(particle.spin * t))
                        piece.fill(Self.shape(particle), with: .color(Self.palette[particle.colorIndex % Self.palette.count]))
                    }
                }
            }
        }
    }

    private static func shape(_ particle: ConfettiParticle) -> Path {
        let s = particle.size
        switch particle.shape {
        case 0: return Path(roundedRect: CGRect(x: -s / 2, y: -s * 0.8, width: s, height: s * 1.6), cornerRadius: 2)
        case 1: return Path(ellipseIn: CGRect(x: -s / 2, y: -s / 2, width: s, height: s))
        default: return Path(roundedRect: CGRect(x: -s * 0.7, y: -s / 4, width: s * 1.4, height: s / 2), cornerRadius: 1)
        }
    }
}

struct XPFlightView: View {
    let flight: XPFlight
    let onLand: @MainActor () -> Void

    @State private var phase = 0

    var body: some View {
        Text("+\(flight.amount) XP")
            .font(.system(size: 22, weight: .black, design: .rounded))
            .foregroundStyle(Theme.amber)
            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
            .opacity(phase == 2 ? 0.3 : 1)
            .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
            .task {
                withAnimation(Motion.pop) { phase = 1 }
                try? await Task.sleep(for: .milliseconds(380))
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
            }
    }
}
```

- [ ] **Step 2: Build**

Run the Task 3 Step 5 build. Expected `exit=0`. If Swift 6 rejects calling `onLand` inside the completion (it is not main-actor in this SDK), write `completion: { Task { @MainActor in onLand() } }`.

- [ ] **Step 3: Commit**

```bash
git add ios/MasterSAT/Sources/Support/Motion/Celebrations.swift
git commit -m "feat(ios): celebrations — physics confetti and the +XP flight, Reduce Motion aware

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Router, rewards store, header and tab bar

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Shell/AppRouter.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/FloatingTabBar.swift`

**Interfaces:**
- Consumes: `AppTab`, `LinkPlacement` (Task 1); `LottieClip` (Task 3); `Motion`, `PressBounce` (Task 4); `CelebrationCenter` (Task 5); existing `Session` (`phase`, `rewards: RewardsAPI`, `client.config.baseURL`), `RewardsAPI.me() -> MyRewards` (`xp`, `currentStreak`, `coins`), `CurrentUser.initials`, `AppLink.webURL(base:)`, `NotificationBell(onOpen:)`, `NotificationRouter.shared.open(_:)`, `PageTitle`.
- Produces: `@MainActor @Observable final class AppRouter { var selection: AppTab; var today, classes, words, rewards, explore, me: NavigationPath; var showingMe: Bool; var certificate: CertificateCode?; func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void); func openMe(); func reselect(_ tab: AppTab) }`; `struct CertificateCode: Identifiable { let code: String }`; `@MainActor @Observable final class RewardsStore { private(set) var xp, streak, coins: Int?; func refresh(using: RewardsAPI) async }`; `struct AppHeader: View { init(title: String, subtitle: String? = nil, showsBell: Bool = false) }`; `struct FloatingTabBar: View { init(selection: Binding<AppTab>, onReselect: @escaping (AppTab) -> Void) }`; `extension AppTab { var title: String; var icon: String }`.

- [ ] **Step 1: Write `AppRouter.swift`**

```swift
import SwiftUI
import MasterSATKit

struct CertificateCode: Identifiable {
    let code: String
    var id: String { code }
}

/// Which tab is open, each tab's stack, and the two sheets.
///
/// One `NavigationPath` per tab, as separate properties: an `@Observable` notifies per
/// property, so a push on Words does not re-evaluate the Today stack. Pages are pushed as
/// `AppLink` values and every tab root declares `navigationDestination(for: AppLink.self)` —
/// value routes declared at the stack root, the only kind that does not drop a push.
@MainActor
@Observable
final class AppRouter {
    var selection: AppTab = .today
    var today = NavigationPath()
    var classes = NavigationPath()
    var words = NavigationPath()
    var rewards = NavigationPath()
    var explore = NavigationPath()
    var me = NavigationPath()
    var showingMe = false
    var certificate: CertificateCode?

    func open(_ link: AppLink, baseURL: URL, openURL: (URL) -> Void) {
        switch link.placement {
        case .tab(let tab):
            showingMe = false
            select(tab)
            popToRoot(tab)
        case .push(let tab, let page):
            showingMe = false
            select(tab)
            popToRoot(tab)
            push(page, on: tab)
        case .me(let page):
            me = NavigationPath()
            if let page { me.append(page) }
            showingMe = true
        case .certificate(let code):
            certificate = CertificateCode(code: code)
        case .web:
            if let url = link.webURL(base: baseURL) { openURL(url) }
        }
    }

    func openMe() {
        if !me.isEmpty { me = NavigationPath() }
        showingMe = true
    }

    /// Tapping the open tab again goes back to its top, as everywhere on iOS.
    func reselect(_ tab: AppTab) { popToRoot(tab) }

    private func select(_ tab: AppTab) {
        if selection != tab { selection = tab }
    }

    private func popToRoot(_ tab: AppTab) {
        switch tab {
        case .today: if !today.isEmpty { today = NavigationPath() }
        case .classes: if !classes.isEmpty { classes = NavigationPath() }
        case .words: if !words.isEmpty { words = NavigationPath() }
        case .rewards: if !rewards.isEmpty { rewards = NavigationPath() }
        case .explore: if !explore.isEmpty { explore = NavigationPath() }
        }
    }

    private func push(_ link: AppLink, on tab: AppTab) {
        switch tab {
        case .today: today.append(link)
        case .classes: classes.append(link)
        case .words: words.append(link)
        case .rewards: rewards.append(link)
        case .explore: explore.append(link)
        }
    }
}
```

- [ ] **Step 2: Write `RewardsStore.swift`**

```swift
import SwiftUI
import MasterSATKit

/// The three numbers every tab header shows. A failed refresh keeps the last known values:
/// a header that blanks on a bad connection reads as "you lost your XP".
@MainActor
@Observable
final class RewardsStore {
    private(set) var xp: Int?
    /// The run of lessons attended — the streak, not the spendable strikes.
    private(set) var streak: Int?
    private(set) var coins: Int?

    func refresh(using api: RewardsAPI) async {
        guard let me = try? await api.me() else { return }
        if xp != me.xp { xp = me.xp }
        if streak != me.currentStreak { streak = me.currentStreak }
        if coins != me.coins { coins = me.coins }
    }
}
```

- [ ] **Step 3: Write `AppHeader.swift`**

```swift
import SwiftUI
import MasterSATKit

/// Every tab's header: a line of context, streak, XP, (bell), avatar — then the title.
struct AppHeader: View {
    let title: String
    var subtitle: String?
    var showsBell: Bool

    init(title: String, subtitle: String? = nil, showsBell: Bool = false) {
        self.title = title
        self.subtitle = subtitle
        self.showsBell = showsBell
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                StrikeChip()
                XPPill()
                if showsBell {
                    // RootTabView routes what the inbox opens, the same way it routes a push.
                    NotificationBell(onOpen: { NotificationRouter.shared.open($0) })
                }
                AvatarButton()
            }
            PageTitle(title)
        }
    }
}

struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards

    var body: some View {
        if let streak = rewards.streak {
            HStack(spacing: 2) {
                LottieClip(.strikeFlame).frame(width: 22, height: 22)
                Text(String(streak))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak)))
            }
            .padding(.leading, 5)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(Theme.card, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(streak) lessons in a row")
        }
    }
}

private struct PillPulse { var scale = 1.0 }

struct XPPill: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations

    var body: some View {
        if let xp = rewards.xp {
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill").font(.system(size: 11, weight: .black))
                Text("\(xp) XP").contentTransition(.numericText(value: Double(xp)))
            }
            .font(.system(size: 13, weight: .heavy, design: .rounded))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.card, in: Capsule())
            .keyframeAnimator(initialValue: PillPulse(), trigger: celebrations.landedCount) { content, pulse in
                content.scaleEffect(pulse.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.4, duration: 0.14, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.5, spring: .bouncy(duration: 0.5, extraBounce: 0.3))
                }
            }
            .sensoryFeedback(.increase, trigger: celebrations.landedCount)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { celebrations.setXPTarget($0) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(xp) XP")
            #if DEBUG
            // Motion check only: a long-press throws a celebration so the kit can be seen
            // before phase 2 wires the real triggers. Compiled out of release builds; phase 2
            // deletes it.
            .onLongPressGesture {
                celebrations.confetti(at: CGPoint(x: 200, y: 420), size: .everything)
                celebrations.flyXP(15, from: CGPoint(x: 200, y: 520))
            }
            #endif
        }
    }
}

struct AvatarButton: View {
    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router

    private var initials: String {
        if case .signedIn(let user) = session.phase { return user.initials }
        return ""
    }

    var body: some View {
        Button { router.openMe() } label: {
            Text(initials)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(Theme.accent, in: Circle())
        }
        .buttonStyle(PressBounce())
        .accessibilityLabel("Your profile")
    }
}
```

- [ ] **Step 4: Write `FloatingTabBar.swift`**

```swift
import SwiftUI
import MasterSATKit

extension AppTab {
    var title: String {
        switch self {
        case .today: return "Today"
        case .classes: return "Class"
        case .words: return "Words"
        case .rewards: return "Rewards"
        case .explore: return "Explore"
        }
    }

    var icon: String {
        switch self {
        case .today: return "house.fill"
        case .classes: return "person.3.fill"
        case .words: return "character.book.closed.fill"
        case .rewards: return "trophy.fill"
        case .explore: return "safari.fill"
        }
    }
}

/// The floating capsule: a sliding pill under the open tab, a bounce on the tapped icon.
struct FloatingTabBar: View {
    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void

    @Namespace private var pill
    @State private var taps: [AppTab: Int] = [:]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                    taps[tab, default: 0] += 1
                    if selection == tab {
                        onReselect(tab)
                    } else {
                        withAnimation(Motion.snappy) { selection = tab }
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 19, weight: .semibold))
                            .symbolEffect(.bounce.up, value: taps[tab, default: 0])
                        Text(tab.title)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(selection == tab ? Theme.accent : Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        if selection == tab {
                            Capsule().fill(Theme.accent.opacity(0.13))
                                .matchedGeometryEffect(id: "pill", in: pill)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressBounce())
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(6)
        .background(.ultraThinMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.13), radius: 18, y: 6)
        .sensoryFeedback(.selection, trigger: selection)
    }
}
```

- [ ] **Step 5: Build**

Run the Task 3 Step 5 build. Expected `exit=0` (nothing uses these views yet; this proves they compile).

- [ ] **Step 6: Commit**

```bash
git add ios/MasterSAT/Sources/Screens/Shell/AppRouter.swift ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift \
        ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift ios/MasterSAT/Sources/Screens/Shell/FloatingTabBar.swift
git commit -m "feat(ios): the shell's parts — router, header (streak, XP, avatar), floating tab bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pages by link, the interim Class tab, Explore

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Shell/AppLinkPage.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/HubCard.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/ClassHubView.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/ExploreView.swift`
- Delete: `ios/MasterSAT/Sources/Screens/LinkDestination.swift`
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift` (remove `LearnHubView` and `HubCard`)

**Interfaces:**
- Consumes: `AppHeader` (Task 6); `Motion`, `PressBounce`, `stagger` (Task 4); the existing screens named in the code.
- Produces: `struct AppLinkPage: View { let link: AppLink }`; `struct HubCard<Route: Hashable>: View` (same parameters as before: `title, subtitle, icon, tone, count, route`); `struct ClassHubView: View { @Binding var path: NavigationPath }`; `struct ExploreView: View { @Binding var path: NavigationPath }`.

- [ ] **Step 1: Write `AppLinkPage.swift`** (the old sheet's switch, without the sheet)

```swift
import SwiftUI
import MasterSATKit

/// The page an `AppLink` names, pushed onto whichever stack it belongs to (see
/// `AppLink.placement`). Tabs, the Me sheet, the certificate and web pages never reach
/// here — `AppRouter.open` handles them — but a switch over a public enum must say something.
struct AppLinkPage: View {
    let link: AppLink

    var body: some View {
        switch link {
        case .classes: ClassesListView()
        case .classroom(let id): LearnMoreClassroomView(classroomId: id)
        case .homework(let classroomId, let assignmentId):
            HomeworkDetailView(classroomId: classroomId, assignmentId: assignmentId)
        case .midterms, .examReview: MidtermsView()
        case .midtermResult(let attemptId): MidtermReportView(attemptId: attemptId)
        case .support: SupportBookingView()
        case .services: ServicesView()
        case .events: EventsView()
        case .points: PointsView()
        case .shop: ShopView()
        case .leaderboard: LeaderboardView()
        case .surveys: SurveysListView()
        case .survey(let id): SurveyFillView(surveyId: id)
        case .roadmap: RoadmapView()
        case .roadmapDelivery(let id): RoadmapReadingView(deliveryId: id)
        case .progress: MyProgressView()
        case .assessments: AssessmentsListView()
        // No join by room id exists on the server: the join screen lists the rooms running
        // in the student's classes and takes the code.
        case .liveQuiz: LiveQuizJoinView()
        case .vocabularySet(let id): VocabSetView(setId: id, title: "")
        case .vocabularySection(let id): VocabSectionView(sectionId: id, title: "")
        case .home, .vocabulary, .profile, .certificate, .unknown:
            ContentUnavailableView("Nothing to open", systemImage: "link")
        }
    }
}
```

Before deleting `LinkDestination.swift`, compare: `sed -n 34,66p ios/MasterSAT/Sources/Screens/LinkDestination.swift`. Carry over any case or argument that differs from the switch above.

- [ ] **Step 2: Write `HubCard.swift`** (moved from `RootView.swift`, on the new card)

```swift
import SwiftUI
import MasterSATKit

/// A card that opens a page: tile, title, one line, an optional count, a chevron.
struct HubCard<Route: Hashable>: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    var count: Int?
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                IconTile(systemName: icon, tone: tone, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy, design: .rounded))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                // Zero is not shown: no badge says "nothing waiting" better than a grey 0.
                if let count, count > 0 {
                    Text(ScoreText.string(count))
                        .font(.system(size: 12, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(tone)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(tone.opacity(0.13)))
                        .contentTransition(.numericText(value: Double(count)))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
    }
}
```

- [ ] **Step 3: Write `ClassHubView.swift`** (interim; phase 2 replaces it with the merged Class tab)

```swift
import SwiftUI
import MasterSATKit

/// The Class tab until phase 2: the old Learn hub's class cards, on the new shell.
struct ClassHubView: View {
    enum Route: Hashable { case classrooms, homework }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @State private var assignments: [AssignmentListing] = []
    @State private var classroomCount: Int?
    @State private var midtermResults: Int?
    /// Rooms running in the student's classes — nil while live quizzes are off, which hides the card.
    @State private var liveRooms: [LiveQuizSummary]?
    @State private var shown = false

    /// The homework list's own "To do" rule — handed-in work is not waiting on the student.
    private var openHomework: Int {
        assignments.filter {
            !["submitted", "graded", "reviewed"].contains(($0.workflowStatus ?? "").lowercased())
        }.count
    }

    private var openAssessments: Int { AssessmentBoard(assignments: assignments).todo().count }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "Class").stagger(0, shown: shown)
                    HubCard(title: "Classroom", subtitle: "Your class, classmates and shared files",
                            icon: "person.3.fill", tone: Theme.accent, count: classroomCount, route: Route.classrooms)
                        .stagger(1, shown: shown)
                    HubCard(title: "Homework", subtitle: "Everything your teachers have set",
                            icon: "checklist", tone: Theme.info, count: openHomework, route: Route.homework)
                        .stagger(2, shown: shown)
                    HubCard(title: "Assessments", subtitle: "Quizzes to work through",
                            icon: "square.and.pencil", tone: Theme.success, count: openAssessments, route: AppLink.assessments)
                        .stagger(3, shown: shown)
                    HubCard(title: "Midterms", subtitle: "When the next one is, and how the last went",
                            icon: "calendar.badge.clock", tone: Theme.amber, count: midtermResults, route: AppLink.midterms)
                        .stagger(4, shown: shown)
                    if let liveRooms {
                        HubCard(title: "Live quiz", subtitle: "Join your class's quiz with the code on the board",
                                icon: "dot.radiowaves.left.and.right", tone: Theme.warning, count: liveRooms.count,
                                route: AppLink.liveQuiz(sessionId: nil))
                            .stagger(5, shown: shown)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                shown = true
                Task { await load() }
            }
            .onDisappear { shown = false }
            .refreshable { await load() }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .classrooms: ClassesListView()
                case .homework: HomeworkListView()
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .navigationDestination(for: AssignmentListing.self) { HomeworkDetailView(assignment: $0) }
        }
    }

    private func load() async {
        // Counts only — a failure leaves a card without its badge, never a hub that cannot draw.
        assignments = (try? await session.student.assignments()) ?? []
        classroomCount = (try? await session.classrooms.classrooms())?.count
        midtermResults = (try? await session.student.midterms())?.filter(\.submitted).count
        liveRooms = (try? await LiveQuizAPI(client: session.client).mine())?
            .filter { $0.status != .finished && $0.status != .terminated }
    }
}
```

- [ ] **Step 4: Write `ExploreView.swift`**

```swift
import SwiftUI
import MasterSATKit

/// Roadmap, Services, Events, Surveys — the learning center around the class.
/// Phase 5 gives each card its live state; until then each says what is behind it.
struct ExploreView: View {
    @Binding var path: NavigationPath
    @State private var shown = false

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    AppHeader(title: "Explore").stagger(0, shown: shown)
                    HubCard(title: "Roadmap", subtitle: "Your level, lesson by lesson, and what comes next",
                            icon: "map.fill", tone: Theme.accentDeep, route: AppLink.roadmap)
                        .stagger(1, shown: shown)
                    HubCard(title: "Services", subtitle: "Support hours with a teacher, and registering for the SAT",
                            icon: "lifepreserver", tone: Theme.subjectEnglish, route: AppLink.services)
                        .stagger(2, shown: shown)
                    HubCard(title: "Events", subtitle: "What's coming up, and your tickets",
                            icon: "calendar", tone: Theme.amber, route: AppLink.events)
                        .stagger(3, shown: shown)
                    HubCard(title: "Surveys", subtitle: "Tell the learning center how it's going",
                            icon: "list.clipboard", tone: Theme.success, route: AppLink.surveys)
                        .stagger(4, shown: shown)
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { shown = true }
            .onDisappear { shown = false }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
        }
    }
}
```

- [ ] **Step 5: Remove the old pieces**

```bash
git rm ios/MasterSAT/Sources/Screens/LinkDestination.swift
```

In `ios/MasterSAT/Sources/Screens/RootView.swift`, delete `struct LearnHubView` and `struct HubCard` entirely (from the doc comment `/// Classwork: the class itself…` to the end of the file). `RootTabView` still references `LearnHubView`, `RootTab` and `LinkDestinationSheet`; Task 8 rewrites it, so this task ends with a build that fails ONLY on those names:

```bash
cd ios/MasterSAT && xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; grep "error:" /tmp/ms-build.log | sort -u
```
Expected: errors only in `RootView.swift`, naming `LearnHubView`, `RootTab`, `LinkDestinationSheet`, `PresentedLink` or `.tab`/`opensOnTheWeb`. Do not commit yet — Task 8 completes the change and commits both.

---

### Task 8: The new `RootTabView` and the tab roots

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/DashboardView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/ProfileView.swift`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: the running five-tab app.

- [ ] **Step 1: Replace `RootTab` and `RootTabView` in `RootView.swift`**

Delete `enum RootTab` and its doc comment (`/// Four tabs.` …), and replace `struct RootTabView` with:

```swift
/// Five tabs — Today, Class, Words, Rewards, Explore — under a floating bar; Me is a sheet
/// behind the avatar in every header.
///
/// The app still does not host the timed sittings: mocks, midterms, past papers and the
/// question bank are sat on a laptop, under exam conditions.
struct RootTabView: View {
    let user: CurrentUser

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var router = AppRouter()
    @State private var rewards = RewardsStore()
    @State private var celebrations = CelebrationCenter()

    private var notifications: NotificationRouter { .shared }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selection) {
            DashboardView(user: user, path: $router.today)
                .tag(AppTab.today)
                .toolbar(.hidden, for: .tabBar)
            ClassHubView(path: $router.classes)
                .tag(AppTab.classes)
                .toolbar(.hidden, for: .tabBar)
            VocabularyView(path: $router.words)
                .tag(AppTab.words)
                .toolbar(.hidden, for: .tabBar)
            RewardsHubView(path: $router.rewards)
                .tag(AppTab.rewards)
                .toolbar(.hidden, for: .tabBar)
            ExploreView(path: $router.explore)
                .tag(AppTab.explore)
                .toolbar(.hidden, for: .tabBar)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FloatingTabBar(selection: $router.selection) { router.reselect($0) }
                .padding(.horizontal, 18)
                .padding(.bottom, 4)
        }
        .overlay { CelebrationLayer().ignoresSafeArea() }
        .environment(router)
        .environment(rewards)
        .environment(celebrations)
        .tint(Theme.accent)
        .sheet(isPresented: $router.showingMe) {
            ProfileView(user: user, path: $router.me)
                .overlay(alignment: .topTrailing) {
                    Button { router.showingMe = false } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(Theme.surface2, in: Circle())
                    }
                    .buttonStyle(PressBounce())
                    .padding(16)
                    .accessibilityLabel("Close")
                }
                .presentationDragIndicator(.visible)
                .environment(router)
                .environment(rewards)
                .environment(celebrations)
        }
        .sheet(item: $router.certificate) { MidtermCertificateSheet(code: $0.code) }
        // A tapped push, a reminder or an inbox row lands here. `onAppear` covers the tap
        // that launched the app from closed, which set the link before this view existed.
        .onAppear {
            celebrations.reduceMotion = reduceMotion
            if let link = notifications.consume() { open(link) }
            Task { await rewards.refresh(using: session.rewards) }
        }
        .onChange(of: reduceMotion) { _, value in celebrations.reduceMotion = value }
        .onChange(of: notifications.pendingLink) { _, link in
            if link != nil, let next = notifications.consume() { open(next) }
        }
    }

    private func open(_ link: AppLink) {
        router.open(link, baseURL: session.client.config.baseURL) { openURL($0) }
    }
}
```

- [ ] **Step 2: `DashboardView` — path, header, link pages**

In `DashboardView.swift`:
1. Under `let user: CurrentUser`, add `@Binding var path: NavigationPath`.
2. Change the first `NavigationStack {` (in `body`, line ~78) to `NavigationStack(path: $path) {`. Leave the second one (the goal sheet, line ~551) alone.
3. In `header`, replace the two lines `topBar` and `PageTitle("Welcome back, …")` with:

```swift
            AppHeader(
                title: "Today",
                subtitle: Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)),
                showsBell: true
            )
```
4. Delete the `topBar` property (from its doc comment `/// The web's top bar, on the phone…` through its closing brace).
5. After `.navigationDestination(item: $openedAssignmentId) { … }`, add `.navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }`.
6. `grep -rn "HomeEventsButton\|RewardsPointsPill" ios/MasterSAT/Sources` — delete each struct whose only remaining match is its own definition (Events now lives in Explore; XP in the header).

- [ ] **Step 3: `VocabularyView`, `RewardsHubView` — path, header, link pages**

`Vocabulary/VocabularyView.swift`: add `@Binding var path: NavigationPath` as the first stored property; `NavigationStack {` → `NavigationStack(path: $path) {`; insert `AppHeader(title: "Words")` as the first child of the root `VStack` (above `HeroHeader(`); after `.toolbar(.hidden, for: .navigationBar)` add `.navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }`.

`Rewards/RewardsHubView.swift`: add `@Binding var path: NavigationPath` as the first stored property; `NavigationStack {` → `NavigationStack(path: $path) {`; replace `PageTitle("Rewards")` with `AppHeader(title: "Rewards")`; after `.toolbar(.hidden, for: .navigationBar)` add `.navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }`.

- [ ] **Step 4: `ProfileView` as the Me sheet**

In `ProfileView.swift`:
1. Under `let user: CurrentUser`, add `@Binding var path: NavigationPath`.
2. `NavigationStack {` (line ~42) → `NavigationStack(path: $path) {`.
3. After `.toolbar(.hidden, for: .navigationBar)` add `.navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }`.
4. In `moreRows`, replace the two `ProfileLinkRow`s (Surveys and Events — both moved to Explore) with:

```swift
            ProfileLinkRow(
                icon: "chart.line.uptrend.xyaxis",
                title: "My progress",
                subtitle: "How you're doing, beside your group",
                badge: nil
            ) {
                MyProgressView()
            }
```

- [ ] **Step 5: Build until clean**

```bash
cd ios/MasterSAT && xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; echo "exit=$?"
grep -E "error:|BUILD (SUCCEEDED|FAILED)" /tmp/ms-build.log | sort -u | head -20
grep -rn "RootTab\b\|LearnHubView\|LinkDestinationSheet\|PresentedLink" Sources || echo "no leftovers"
```
Expected: `exit=0`, `** BUILD SUCCEEDED **`, `no leftovers`. A "missing argument for parameter 'path'" at a call site outside the tab bar (e.g. a `#Preview`) gets `path: .constant(NavigationPath())`.

- [ ] **Step 6: Commit Tasks 7 and 8 together**

```bash
git add ios/MasterSAT/Sources/Screens/Shell/AppLinkPage.swift ios/MasterSAT/Sources/Screens/Shell/HubCard.swift \
        ios/MasterSAT/Sources/Screens/Shell/ClassHubView.swift ios/MasterSAT/Sources/Screens/Shell/ExploreView.swift \
        ios/MasterSAT/Sources/Screens/RootView.swift ios/MasterSAT/Sources/Screens/DashboardView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift \
        ios/MasterSAT/Sources/Screens/ProfileView.swift
git status --short   # LinkDestination.swift staged as D; any other unstaged change is unexpected → stop and look
git commit -m "feat(ios): five tabs under a floating bar — Today, Class, Words, Rewards, Explore; Me behind the avatar

Links now land inside the tab they belong to instead of a sheet over it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If Step 2.6 deleted `HomeEventsButton` / `RewardsPointsPill`, add their files (or the edited files that held them) to this `git add`.

---

### Task 9: Run it, prove it, open the PR

**Files:** none (verification).

- [ ] **Step 1: Kit green**

Run: `cd ios/MasterSATKit && swift test 2>&1 | tail -3`
Expected: `✔ Test run with N tests passed`, N = the Task 0 count + 12.

- [ ] **Step 2: A local backend with a test student**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/backend
export SECRET_KEY=dev-secret DEBUG=True
~/.pyenv/versions/3.12.2/bin/python3 manage.py migrate
~/.pyenv/versions/3.12.2/bin/python3 manage.py seed_classroom_uat
~/.pyenv/versions/3.12.2/bin/python3 manage.py shell -c "from django.contrib.auth import get_user_model as g; from django.utils import timezone as t; g().objects.filter(email='uat_s1@mastersat.test').update(email_verified=True, email_verified_at=t.now())"
git -C .. status --short   # backend/db.sqlite3 must NOT appear (gitignored)
```
Start the server as a preview, never from Bash: add a configuration `ios-redesign-backend` to `/Users/macbook/Projects/DSAT-mock-exam/.claude/launch.json` — `runtimeExecutable: "bash"`, `runtimeArgs: ["-c", "cd /Users/macbook/Projects/dsat-wt-ios-redesign/backend && SECRET_KEY=dev-secret DEBUG=True exec ~/.pyenv/versions/3.12.2/bin/python3 manage.py runserver 0.0.0.0:8000"]`, `port: 8000` — and `preview_start` it.
The test login is `uat_s1@mastersat.test` with the password defined in `backend/classes/management/commands/seed_classroom_uat.py`.

- [ ] **Step 3: Run on the simulator against it**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
xcrun simctl install booted build/dd/Build/Products/Debug-iphonesimulator/MasterSAT.app
xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"
```
Sign in as the test student. Check each item and screenshot it (`sleep 2; xcrun simctl io booted screenshot <name>.png`):
1. Five tabs in the floating bar; tapping one bounces its icon, slides the pill, gives a selection haptic; tapping the open tab again returns it to its top.
2. Every tab header shows 🔥 streak (when the API returns one), ⚡ XP and the avatar; Today also shows the bell and the date.
3. The last card on every tab scrolls fully above the floating bar. If not: give each tab root's `ScrollView` `.safeAreaPadding(.bottom, 72)`, and in `RootTabView` replace `.safeAreaInset(edge: .bottom, spacing: 0) { … }` with `.overlay(alignment: .bottom) { … }` holding the same bar.
4. The system tab bar is NOT visible under the floating one. If it is: move `.toolbar(.hidden, for: .tabBar)` from the `TabView` children onto the view inside each tab root's `NavigationStack`.
5. Avatar → Me sheet; "My progress" pushes `MyProgressView`; ✕ and swipe-down close it.
6. Class tab: cards spring in one after another; Classroom, Homework, Assessments, Midterms open their pages and Back returns.
7. Explore: Roadmap, Services, Events, Surveys each push their page.
8. Long-press the XP pill (DEBUG): confetti from the middle, "+15 XP" flies into the pill, the pill pulses (the number does not change — motion check only).
9. If the seed produced a notification: bell → open it → it switches to the right tab and pushes the page.
10. Reduce Motion: `xcrun simctl spawn booted defaults write com.apple.Accessibility ReduceMotionEnabled -bool true`, relaunch, long-press the XP pill → no confetti, no flight; the flame is still. Turn it back off (`-bool false`) and relaunch.
11. Dark mode (`xcrun simctl ui booted appearance dark`): Today, Class, Rewards readable; back to light.

Record a 30-second walk-through of items 1, 5, 6 and 8: `xcrun simctl io booted recordVideo --codec h264 phase1.mp4` (Ctrl-C to stop; run it in the background).

- [ ] **Step 4: Push and open the PR**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git log --format='%an <%ae> %s' origin/main..HEAD   # every line: Viltrumlik <viltrumlik@gmail.com>
git push origin HEAD:refs/heads/feat/ios-redesign
gh pr create --base main --head feat/ios-redesign \
  --title "iOS redesign — phase 1: new look, motion kit, five-tab shell" --body-file /tmp/pr-phase1.md
```
`/tmp/pr-phase1.md` says: what changed (tokens + restyle of every screen; motion kit; generated Lottie; five tabs + Me sheet + Explore; links land in their tab), what did NOT (no backend change; Today/Words/Rewards content unchanged until phases 2–3; Class is the interim hub), the Step 3 checklist with results, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Send the owner the demo**

Send the screenshots and `phase1.mp4` (SendUserFile) with one line per tab saying what to look at. Merge only after the owner's "ha".

---

## Phase 2 — Today + Class

Branch `feat/ios-redesign-phase2` in `/Users/macbook/Projects/dsat-wt-ios-redesign`, built on phase 1 (PR #304). One PR into `main`, stacked on #304.

**What the student gets:** Today becomes "what to do now" — a ring for this week's homework, **Up next** across every class (catch-up first, then by deadline, then today's lessons), the live quiz banner, a fresh midterm result, the survey card, stories and a compact SAT countdown; the goal and the SAT date are set in the Me sheet, which already holds them. Class becomes all classes together — chips, each class's next lesson with its Telegram group and live quiz, and the segments Tasks · Schedule · People · Files. Handing in homework, an assessment, a word-game round or a survey is celebrated every time (check, confetti, haptic, VoiceOver); "+N XP" flies only for XP the server confirmed.

### Decisions taken where the design left room

- **One Up next row per homework, not per piece.** XP is paid per homework *bundle* (`backend/rewards/homework.py`: one `HOMEWORK` award per assignment; quizzes and word sets are items of the bundle), and there are no stand-alone assessments (`assessments.HomeworkAssignment.assignment` is non-null) or stand-alone word homework (`/vocabulary/homework/` groups by assignment). A homework that carries quizzes shows as a quiz row, one of only word sets as a words row — so "open assessments" and "word homework" are on the list without being listed twice — and it opens the homework page, which already launches every piece.
- **"up to +N XP" on every homework row whose deadline is still ahead** (N = the live `HOMEWORK` rule, only when `grants_xp`). Never on a catch-up row: a homework is settled as of its deadline, so work finished late earns nothing more. Never on lessons.
- **Done** (`HomeworkProgress.isDone`): every quiz and word set on the row finished, and then the server says it is in — or quizzes and word sets were all there was. Needed because `workflow_status` is the FIRST quiz's status on a quiz homework and a word-set homework is never "submitted".
- **The ring** counts homework due Monday–Sunday (the learning center's week), done against all of it. It completing during a session is the "all of today done" moment: double confetti + hero bounce (approved design §3).
- **Up next shows at most 6 homework rows**, then today's lessons, and "See all" switches to Class.
- **Fresh result** = the newest released midterm score not yet opened from Today (seen ids in `UserDefaults`, per student); "Later" puts it away. Outcome celebrations (passed / improved) stay in phase 4 with the reviews that own them.
- **Compact SAT countdown** is one row ("SAT · 54 days to go"); tapping it opens the Me sheet, whose Overview already has the goal sheet and the exam-date menu. `TargetScoresCard`, `CountdownCard`, the goal button and `HomePulse` leave Today (XP and streak are in the header; points and strikes on Rewards).
- **Class chips**: All first, then Math, then English; a subject with two classes shows one chip per class by name. People and Files under **All** are grouped per class with a class heading (a student has one to three classes; a picker would be one more tap for nothing). A midterm has no class, so Results places it by subject.
- **Class cards** open the full class page (`AppLink.classroom`) — it keeps Classwork, which the merged tab does not repeat. "Join another class" sits under the segments; the empty state offers "Join with a code". Tasks ends with two links: the assessment board (search, domains) and Midterms (dates, certificates).
- **Where a celebration plays (R-P2a):** finished on a visible page → the check and confetti play at once at the button; finished inside a full-screen cover (`.coversCelebrations`) or under the Me sheet → they wait and play at the screen's centre the moment it has gone. "+N XP" always waits for a tab-root pill on screen; it never flies from a pushed page. A word-game cover celebrates once per opening.
- **XP truth (R-P2b):** gain = header XP after a post-task refresh − header XP before the task (`XPDelta`, with a floor so two tasks never claim the same gain); requests are applied in order (`LatestOnly`). Until it lands the gain is held, so the pill rolls when the flight lands; under Reduce Motion nothing is held and nothing flies — the number just changes.
- **Re-tap (R-P2d):** a pushed page pops; a root already showing scrolls to its top. Only the pill a flight was aimed at pulses and buzzes.

### Phase 1 hand-off → tasks

| Carried into phase 2 (Phase 1 outcome) | Where |
|---|---|
| Where "+XP" flies from a pushed page | Never from one — Task 12 (`CelebrationQueue`), Task 13 (center, pill) |
| Apply XP independently of a landing | Task 13: the store holds the truth, the pill shows `xp − held`, a 2.5 s backstop gives held XP back |
| `RewardsStore` writes outside an animation; last-write-wins | Task 12 (`LatestOnly`), Task 13 (`ticket`/`apply`, `withAnimation`) |
| Only the visible pill pulses/haptics | Task 13 (`XPLanding.owner`) |
| Re-tap at a tab root scrolls to top | Task 14 |
| Delete the DEBUG long-press on `XPPill` | Task 13 |
| Today `path.append(assignment)` double-tap guard | Task 16 (the calendar's `open` moved to Class → Schedule, guarded by `path.isEmpty`); Task 15 guards Today's own append |
| One-shot `LottieClip`s need an explicit frame | Task 13 (`.once` under Reduce Motion keeps its frame) |
| Owner: check the shell on an iOS 17/18 runtime | Task 19 Step 6 |

Ruled out of phase 2, with where they went: **last-seen XP / streak / rank per user** → phase 3 (its only reader is "while you were away"); **kit `CelebrationRule` for outcomes** → phase 4 (its readers are the reviews and the midterm report; phase 2 celebrates effort only).

### The build check (used by every app task)

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT && xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; echo "exit=$?"
grep -E "error:|BUILD (SUCCEEDED|FAILED)" /tmp/ms-build.log | sort -u | head -20
```
Passes only with `exit=0` and `** BUILD SUCCEEDED **`.

Checked while this plan was written (2026-10-20), in throwaway copies of `ios/`: the kit code of Tasks 10–12 passes (685 tests), and the app, with Tasks 10–N applied exactly as written, builds for every N from 13 to 18. A failure at execution therefore means the tree has moved since — read the named file before improvising.

### File structure (phase 2)

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):
- `Today/WorkItem.swift` — **new.** `HomeworkProgress` (done or owed), `WorkItem` (one row), its order.
- `Today/TodayPlan.swift` — **new.** Up next, today's lessons, the week's ring, the HOMEWORK XP cap, the fresh result.
- `Classroom/ClassFilter.swift` — **new.** `ClassFilter` (chips), `ClassTasks` (To do / Done / Results).
- `Rewards/XPDelta.swift` — **new.** `XPDelta`, `LatestOnly`.
- `Motion/CelebrationQueue.swift` — **new.** `FinishedWork`, `CelebrationQueue`.

Kit tests (`ios/MasterSATKit/Tests/MasterSATKitTests/`): `TodayPlanTests.swift`, `ClassFilterTests.swift`, `CelebrationQueueTests.swift` — **new.**

App (`ios/MasterSAT/Sources/`):
- `Support/Motion/Celebrations.swift` — center rebuilt on the queue (sheets, covers, the pill that catches), the check badge, the success haptic.
- `Support/Motion/LottieClip.swift` — `Playback` (`loop`, `once`, `still`).
- `Support/Motion/Motion.swift` — `zoomSource` / `zoomDestination` (iOS 18+).
- `Support/PageChrome.swift` — `RetryNotice` moves in.
- `Screens/Shell/RewardsStore.swift`, `AppHeader.swift` (`XPPill`), `AppRouter.swift` (re-tap, `show`), `ExploreView.swift`.
- `Screens/Shell/TabRootScroll.swift`, `WorkRow.swift`, `SegmentBar.swift` — **new.**
- `Screens/Today/TodayView.swift`, `TodayCards.swift` — **new**; `Screens/DashboardView.swift`, `Screens/HomePulse.swift` — **deleted**; `Screens/Profile/GoalSheet.swift`, `Screens/LiveQuiz/LiveQuizRunningCard.swift` — **moved out of them**.
- `Screens/Class/ClassView.swift`, `ClassCards.swift`, `ClassTasksSegment.swift`, `ClassScheduleSegment.swift`, `ClassSectionsModel.swift`, `ClassPeopleFilesSegments.swift` — **new**; `Screens/Shell/ClassHubView.swift` — **deleted**; `Screens/HomeworkListView.swift` — the unused list goes, `HomeworkRow` stays.
- `Screens/RootView.swift` — Today and Class roots; the celebrations wired to the header and the sheets.
- `Screens/Vocabulary/VocabularyView.swift`, `Screens/Rewards/RewardsHubView.swift` — `TabRootScroll`; the hub's ticket.
- Celebration triggers: `Screens/HomeworkDetailView.swift`, `Screens/Assessments/AssessmentRunnerView.swift`, `AssessmentBoardViews.swift`, `AssessmentReviewView.swift`, `Screens/Vocabulary/VocabStudyView.swift`, `VocabSetPage.swift`, `Screens/Surveys/SurveyFillView.swift`.

---

### Task 10: Today's plan in the kit (`HomeworkProgress`, `WorkItem`, `TodayPlan`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Today/WorkItem.swift`
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Today/TodayPlan.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/TodayPlanTests.swift`

**Interfaces:**
- Consumes: `AssignmentListing`, `ScheduleEvent`, `MidtermListing` (`Models/Student.swift`); `RewardRule` (`Models/Rewards.swift`); `AssessmentCardState.of(_:)` (`Assessment/AssessmentBoard.swift`); `ProfileHomework.isTurnedIn(_:)`, `ProfileLessons.window(of:hours:calendar:)`, `ProfileCalendar.date(fromDay:calendar:)` (`Profile/ProfileRules.swift`); `AssignmentListing.offersFileUpload`, `.isClasswork` (`Models/AssignmentRules.swift`, `Classroom/ClassroomRules.swift`); `JSONCoding.parseServerDate`. Tests reuse `ProfileFixtures` (`Tests/MasterSATKitTests/ProfileTests.swift` — Tashkent, Monday 14 Sep 2026 15:30).
- Produces: `public enum HomeworkProgress { static func isDone(_: AssignmentListing) -> Bool }`; `public struct WorkItem: Identifiable, Sendable, Equatable { enum Look { quiz, words, paper, handIn, lesson, exam }; enum Source { homework(AssignmentListing), lesson(ScheduleEvent) }; source, look, title, detail: String; catchUp: Bool; dueAt: String?; start: Date?; xpCap: Int?; id: String; assignment: AssignmentListing?; static func homework(_:homeworkXP:now:) -> WorkItem; static func lesson(_:start:) -> WorkItem; static func contentsLine(_:) -> String; static func ordered(_:) -> [WorkItem] }`; `public struct TodayPlan: Sendable, Equatable { struct Progress { done, total: Int; init(done:total:); fraction: Double; isComplete: Bool }; homework, lessons: [WorkItem]; week: Progress; init(assignments:events:homeworkXP:now:calendar:); isAllClear: Bool; func upNext(limit:) -> (items: [WorkItem], more: Int); static func homeworkXP(_: [RewardRule]) -> Int?; static func freshResult(_: [MidtermListing], seen: Set<Int>) -> MidtermListing?; static func justFinished(previous: Progress?, current: Progress) -> Bool }`.

- [ ] **Step 1: Write the failing test**

`ios/MasterSATKit/Tests/MasterSATKitTests/TodayPlanTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

/// Homework rows on top of `ProfileFixtures` (Tashkent, Monday 14 September 2026, 15:30).
enum WorkFixtures {
    typealias F = ProfileFixtures

    static func quiz(_ homeworkId: Int, _ workflow: String) -> [String: Any] {
        let state = ["graded": "completed", "submitted": "completed", "in_progress": "in_progress"][workflow] ?? "not_started"
        return [
            "homework_id": homeworkId,
            "set": ["id": homeworkId, "subject": "math", "title": "Quiz \(homeworkId)"],
            "progress": ["workflow_status": workflow, "state": state],
        ]
    }

    static func words(_ id: Int, _ state: String) -> [String: Any] {
        ["id": id, "set_id": id, "set_title": "Set \(id)", "section_title": "", "word_count": 10, "state": state]
    }

    /// A homework in a class. `status` is the row's `workflow_status`.
    static func homework(
        _ id: Int, due: String?, status: String = "NOT_STARTED", classroom: Int = 1,
        className: String = "Math ODD", extra: [String: Any] = [:]
    ) throws -> AssignmentListing {
        var more: [String: Any] = ["classroom_id": classroom, "classroom_name": className]
        more.merge(extra) { _, new in new }
        return try F.homework(id, "Homework \(id)", due: due, status: status, extra: more)
    }
}

@Suite struct HomeworkProgressTests {
    typealias W = WorkFixtures

    @Test("A hand-in is done once it is with the teacher, and owed again when sent back")
    func handIn() throws {
        #expect(HomeworkProgress.isDone(try W.homework(1, due: nil, status: "SUBMITTED")))
        #expect(HomeworkProgress.isDone(try W.homework(2, due: nil, status: "GRADED")))
        #expect(!HomeworkProgress.isDone(try W.homework(3, due: nil, status: "RETURNED")))
        #expect(!HomeworkProgress.isDone(try W.homework(4, due: nil)))
    }

    @Test("A second quiz still open keeps the homework open, whatever the first one says")
    func quizzes() throws {
        let one = try W.homework(1, due: nil, status: "graded", extra: ["assessment_homeworks": [W.quiz(11, "graded")]])
        let two = try W.homework(2, due: nil, status: "graded", extra: [
            "assessment_homeworks": [W.quiz(21, "graded"), W.quiz(22, "not_started")],
        ])
        #expect(HomeworkProgress.isDone(one))
        #expect(!HomeworkProgress.isDone(two))
    }

    @Test("Word sets are finished by playing them, never by handing in")
    func words() throws {
        let finished = try W.homework(1, due: nil, extra: ["vocab_homeworks": [W.words(5, "completed"), W.words(6, "completed")]])
        let started = try W.homework(2, due: nil, extra: ["vocab_homeworks": [W.words(5, "completed"), W.words(6, "in_progress")]])
        #expect(HomeworkProgress.isDone(finished))
        #expect(!HomeworkProgress.isDone(started))
    }

    @Test("A quiz done does not finish a homework whose word set is still owed")
    func mixed() throws {
        let homework = try W.homework(1, due: nil, status: "graded", extra: [
            "assessment_homeworks": [W.quiz(11, "graded")],
            "vocab_homeworks": [W.words(5, "not_started")],
        ])
        #expect(!HomeworkProgress.isDone(homework))
    }

    @Test("A paper sat on a computer counts only once the server says so")
    func papers() throws {
        let paper: [String: Any] = ["contents": [["kind": "PASTPAPER", "title": "Paper"]]]
        #expect(!HomeworkProgress.isDone(try W.homework(1, due: nil, extra: paper)))
        #expect(HomeworkProgress.isDone(try W.homework(2, due: nil, status: "SUBMITTED", extra: paper)))
    }
}

@Suite struct WorkItemTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    @Test("A row says what kind of work it is: quiz, paper, words, or a hand-in")
    func looks() throws {
        let quiz = try W.homework(1, due: nil, extra: [
            "assessment_homeworks": [W.quiz(11, "not_started")], "vocab_homeworks": [W.words(5, "not_started")],
        ])
        let paper = try W.homework(2, due: nil, extra: [
            "contents": [["kind": "MOCK", "title": "Mock"]], "vocab_homeworks": [W.words(5, "not_started")],
        ])
        let words = try W.homework(3, due: nil, extra: ["vocab_homeworks": [W.words(5, "not_started")]])
        let handIn = try W.homework(4, due: nil)
        #expect(WorkItem.homework(quiz, homeworkXP: nil, now: F.now).look == .quiz)
        #expect(WorkItem.homework(paper, homeworkXP: nil, now: F.now).look == .paper)
        #expect(WorkItem.homework(words, homeworkXP: nil, now: F.now).look == .words)
        #expect(WorkItem.homework(handIn, homeworkXP: nil, now: F.now).look == .handIn)
    }

    @Test("The detail line names the class and what is inside")
    func detail() throws {
        let bundle = try W.homework(1, due: nil, extra: [
            "assessment_homeworks": [W.quiz(11, "not_started"), W.quiz(12, "not_started")],
            "vocab_homeworks": [W.words(5, "not_started")],
        ])
        #expect(WorkItem.homework(bundle, homeworkXP: nil, now: F.now).detail == "Math ODD · 2 quizzes · 1 word set")
        #expect(WorkItem.homework(try W.homework(2, due: nil), homeworkXP: nil, now: F.now).detail == "Math ODD")
    }

    @Test("Up to +N XP only while the deadline is ahead — work finished late earns nothing more")
    func xpCap() throws {
        let ahead = try W.homework(1, due: F.at(2))
        let passed = try W.homework(2, due: F.at(-1))
        let undated = try W.homework(3, due: nil)
        #expect(WorkItem.homework(ahead, homeworkXP: 15, now: F.now).xpCap == 15)
        #expect(WorkItem.homework(undated, homeworkXP: 15, now: F.now).xpCap == 15)
        #expect(WorkItem.homework(passed, homeworkXP: 15, now: F.now).xpCap == nil)
        #expect(WorkItem.homework(passed, homeworkXP: 15, now: F.now).catchUp)
        #expect(WorkItem.homework(ahead, homeworkXP: nil, now: F.now).xpCap == nil)
    }

    @Test("Catching up comes first, the longest-waiting first; then by deadline; undated last")
    func order() throws {
        let rows = try [
            W.homework(1, due: nil),
            W.homework(2, due: F.at(3)),
            W.homework(3, due: F.at(-1)),
            W.homework(4, due: F.at(1)),
            W.homework(5, due: F.at(-4)),
        ].map { WorkItem.homework($0, homeworkXP: nil, now: F.now) }
        #expect(WorkItem.ordered(rows).compactMap { $0.assignment?.id } == [5, 3, 4, 2, 1])
    }
}

@Suite struct TodayPlanTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    @Test("Up next holds every homework still owed; done work is not on it")
    func homeworkOwed() throws {
        let plan = TodayPlan(assignments: [
            try W.homework(1, due: F.at(1)),
            try W.homework(2, due: F.at(2), status: "SUBMITTED"),
            try W.homework(3, due: F.at(-1)),
        ], events: [], homeworkXP: 15, now: F.now, calendar: F.calendar)
        #expect(plan.homework.compactMap { $0.assignment?.id } == [3, 1])
    }

    @Test("Today's lessons still to come, by time; one that has ended and tomorrow's are not")
    func lessons() throws {
        let plan = TodayPlan(assignments: [], events: [
            try F.lesson("2026-09-14", "18:00", classroom: 1),
            try F.lesson("2026-09-14", "09:00-11:00", classroom: 2),
            try F.lesson("2026-09-15", "18:00", classroom: 1),
            try F.lesson("2026-09-14", "", classroom: nil, type: "midterm"),
        ], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(plan.lessons.map(\.look) == [.exam, .lesson])
        #expect(plan.lessons.last?.start == F.local(14, 18))
    }

    @Test("Lessons follow the homework, and only the homework is cut to the limit")
    func upNextLimit() throws {
        let homework = try (1...8).map { try W.homework($0, due: F.at(Double($0))) }
        let plan = TodayPlan(
            assignments: homework, events: [try F.lesson("2026-09-14", "18:00", classroom: 1)],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        let next = plan.upNext(limit: 6)
        #expect(next.items.count == 7)
        #expect(next.items.last?.look == .lesson)
        #expect(next.more == 2)
    }

    @Test("The week's ring counts homework due Monday to Sunday, done against all of it")
    func week() throws {
        let plan = TodayPlan(assignments: [
            try W.homework(1, due: F.at(2)),                      // Wednesday
            try W.homework(2, due: F.at(4), status: "SUBMITTED"),  // Friday, handed in
            try W.homework(3, due: F.at(-0.5)),                   // this morning, to catch up
            try W.homework(4, due: F.at(-1)),                     // last Sunday
            try W.homework(5, due: F.at(7)),                      // next Monday
            try W.homework(6, due: nil),
        ], events: [], homeworkXP: nil, now: F.now, calendar: F.calendar)
        #expect(plan.week == TodayPlan.Progress(done: 1, total: 3))
        #expect(!plan.week.isComplete)
    }

    @Test("Nothing owed and no lesson left: all clear, and the week is complete")
    func allClear() throws {
        let plan = TodayPlan(
            assignments: [try W.homework(1, due: F.at(1), status: "GRADED")], events: [],
            homeworkXP: nil, now: F.now, calendar: F.calendar
        )
        #expect(plan.isAllClear)
        #expect(plan.week.isComplete)
    }

    @Test("Up to +N comes from the live HOMEWORK rule, and only when it pays XP")
    func homeworkXP() {
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK", label: "Homework", points: 15)]) == 15)
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK", label: "Homework", points: 15, grantsXP: false)]) == nil)
        #expect(TodayPlan.homeworkXP([RewardRule(event: "HOMEWORK_FULL", label: "Old", points: 15)]) == nil)
        #expect(TodayPlan.homeworkXP([]) == nil)
    }

    @Test("The fresh result is the newest released score not yet looked at")
    func freshResult() throws {
        func midterm(_ attempt: Int, released: Bool = true) throws -> MidtermListing {
            try F.decode(MidtermListing.self, [
                "midterm_id": attempt, "title": "Midterm \(attempt)", "subject": "MATH", "attempt_id": attempt,
                "submitted": true, "results_visible": released, "score": 640,
            ])
        }
        let list = [try midterm(3), try midterm(7), try midterm(9, released: false)]
        #expect(TodayPlan.freshResult(list, seen: [])?.attemptId == 7)
        #expect(TodayPlan.freshResult(list, seen: [7])?.attemptId == 3)
        #expect(TodayPlan.freshResult(list, seen: [3, 7]) == nil)
    }

    @Test("The week counts as just finished only on the step from not done to done")
    func justFinished() {
        let p = TodayPlan.Progress.init(done:total:)
        #expect(TodayPlan.justFinished(previous: p(2, 3), current: p(3, 3)))
        #expect(TodayPlan.justFinished(previous: p(2, 3), current: p(4, 4)))
        #expect(!TodayPlan.justFinished(previous: nil, current: p(3, 3)))
        #expect(!TodayPlan.justFinished(previous: p(3, 3), current: p(3, 3)))
        #expect(!TodayPlan.justFinished(previous: p(0, 0), current: p(0, 0)))
        #expect(!TodayPlan.justFinished(previous: p(1, 3), current: p(2, 3)))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "HomeworkProgressTests|WorkItemTests|TodayPlanTests" 2>&1 | tail -5`
Expected: build error `cannot find 'HomeworkProgress' in scope` (and `WorkItem`, `TodayPlan`).

- [ ] **Step 3: Implement `Today/WorkItem.swift`**

```swift
import Foundation

// What Today's "Up next" and the Class tab's To do are made of. Pure, so the order a student
// meets their work in is tested rather than eyeballed (`TodayPlanTests`).

// MARK: - Done, or still owed

/// Whether a homework still asks anything of the student.
///
/// `workflow_status` alone cannot say. On a quiz homework it is the FIRST quiz's status, so a
/// second quiz can still be open under "graded"; and a homework of word sets is never handed in
/// at all — a word set is finished by playing it. So every quiz and word set on the row must be
/// finished, and then either the server says the work is in, or quizzes and word sets were all
/// there was. A paper sat on a computer, or a file to hand in, leaves no trace on the list row,
/// so for those the server's word is the only word.
public enum HomeworkProgress {
    /// Content sat on a computer, under exam conditions.
    static let paperKinds: Set<String> = ["PASTPAPER", "MOCK", "PRACTICE"]

    public static func isDone(_ homework: AssignmentListing) -> Bool {
        if homework.assessmentHomeworks.contains(where: { !AssessmentCardState.of($0.progress).isDone }) {
            return false
        }
        if homework.vocabHomeworks.contains(where: { $0.state.lowercased() != "completed" }) {
            return false
        }
        if ProfileHomework.isTurnedIn(homework.workflowStatus) { return true }
        let played = !homework.assessmentHomeworks.isEmpty || !homework.vocabHomeworks.isEmpty
        let leavesNoTrace = homework.offersFileUpload
            || homework.contents.contains { paperKinds.contains($0.kind) }
        return played && !leavesNoTrace
    }
}

// MARK: - One row

/// One thing to do: a homework still owed, or one of today's lessons.
public struct WorkItem: Identifiable, Sendable, Equatable {
    /// What the row looks like — the first thing a student reads off a list.
    public enum Look: String, Sendable, Equatable {
        case quiz, words, paper, handIn, lesson, exam
    }

    public enum Source: Sendable, Equatable {
        case homework(AssignmentListing)
        case lesson(ScheduleEvent)
    }

    public let source: Source
    public let look: Look
    public let title: String
    /// "Math ODD · 2 quizzes · 1 word set" — where it is from, and what is inside.
    public let detail: String
    /// Past its deadline and still owed. Drawn "Catch up · Tue" — never "Overdue".
    public let catchUp: Bool
    /// The deadline as the server wrote it, for the app's `DueLabel`. Nil for a lesson.
    public let dueAt: String?
    /// When a lesson starts. Nil for homework.
    public let start: Date?
    /// "up to +N XP": the live HOMEWORK rule's maximum, only while the deadline is ahead — a
    /// homework is settled as of its deadline, so work finished after it earns nothing more.
    public let xpCap: Int?

    public var id: String {
        switch source {
        case .homework(let homework): return "homework-\(homework.id)"
        case .lesson(let event): return "lesson-\(event.id)"
        }
    }

    /// The homework behind the row; nil for a lesson.
    public var assignment: AssignmentListing? {
        if case .homework(let homework) = source { return homework }
        return nil
    }

    public static func homework(_ homework: AssignmentListing, homeworkXP: Int?, now: Date = Date()) -> WorkItem {
        let due = homework.dueAt.flatMap(JSONCoding.parseServerDate)
        let catchUp = due.map { $0 < now } ?? false
        var cap: Int?
        if let homeworkXP, homeworkXP > 0, !catchUp, !homework.isClasswork { cap = homeworkXP }
        let detail = [homework.classroomName ?? "", contentsLine(homework)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return WorkItem(
            source: .homework(homework),
            look: look(of: homework),
            title: homework.title.isEmpty ? "Homework" : homework.title,
            detail: detail,
            catchUp: catchUp,
            dueAt: homework.dueAt,
            start: nil,
            xpCap: cap
        )
    }

    public static func lesson(_ event: ScheduleEvent, start: Date) -> WorkItem {
        WorkItem(
            source: .lesson(event),
            look: event.type == .classMeeting ? .lesson : .exam,
            title: event.title.isEmpty ? "Lesson" : event.title,
            detail: event.sub,
            catchUp: false,
            dueAt: nil,
            start: start,
            xpCap: nil
        )
    }

    /// The homework list's own reading of a bundle: a quiz first, then a paper, then words.
    static func look(of homework: AssignmentListing) -> Look {
        if !homework.assessmentHomeworks.isEmpty { return .quiz }
        if homework.contents.contains(where: { HomeworkProgress.paperKinds.contains($0.kind) }) { return .paper }
        if !homework.vocabHomeworks.isEmpty { return .words }
        return .handIn
    }

    /// "2 quizzes · 1 paper on a computer · 3 word sets"; empty for a plain hand-in.
    public static func contentsLine(_ homework: AssignmentListing) -> String {
        var parts: [String] = []
        let quizzes = homework.assessmentHomeworks.count
        if quizzes > 0 { parts.append(quizzes == 1 ? "1 quiz" : "\(quizzes) quizzes") }
        let papers = homework.contents.filter { HomeworkProgress.paperKinds.contains($0.kind) }.count
        if papers > 0 { parts.append(papers == 1 ? "1 paper on a computer" : "\(papers) papers on a computer") }
        let sets = homework.vocabHomeworks.count
        if sets > 0 { parts.append(sets == 1 ? "1 word set" : "\(sets) word sets") }
        return parts.joined(separator: " · ")
    }

    /// Work to catch up on first, the longest-waiting first; then by deadline; undated last.
    public static func ordered(_ items: [WorkItem]) -> [WorkItem] {
        items.sorted { a, b in
            if a.catchUp != b.catchUp { return a.catchUp }
            let da = a.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            let db = b.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            if da != db { return da < db }
            return (a.assignment?.id ?? 0) < (b.assignment?.id ?? 0)
        }
    }
}
```

- [ ] **Step 4: Implement `Today/TodayPlan.swift`**

```swift
import Foundation

/// The Today tab, worked out: the homework still owed across every class, today's lessons
/// still to come, and how much of this week's homework is done.
public struct TodayPlan: Sendable, Equatable {
    /// Homework due this week, done against all of it — the hero ring.
    public struct Progress: Sendable, Equatable {
        public let done: Int
        public let total: Int

        public init(done: Int, total: Int) {
            self.done = done
            self.total = total
        }

        public var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }
        /// Something was due, and all of it is in. Nothing due is not "done".
        public var isComplete: Bool { total > 0 && done == total }
    }

    /// Every homework still owed, in `WorkItem.ordered` order.
    public let homework: [WorkItem]
    /// Today's lessons (and papers sat in the centre) not yet over, by start time.
    public let lessons: [WorkItem]
    public let week: Progress

    public init(
        assignments: [AssignmentListing],
        events: [ScheduleEvent],
        homeworkXP: Int?,
        now: Date = Date(),
        calendar: Calendar = .current
    ) {
        homework = WorkItem.ordered(
            assignments
                .filter { !HomeworkProgress.isDone($0) }
                .map { WorkItem.homework($0, homeworkXP: homeworkXP, now: now) }
        )
        lessons = Self.todaysLessons(events, now: now, calendar: calendar)
        week = Self.week(assignments, now: now, calendar: calendar)
    }

    /// Nothing owed and nothing left today.
    public var isAllClear: Bool { homework.isEmpty && lessons.isEmpty }

    /// Up next: at most `limit` homework, then every lesson left today — and how many homework
    /// rows did not fit.
    public func upNext(limit: Int) -> (items: [WorkItem], more: Int) {
        let shown = Array(homework.prefix(max(0, limit)))
        return (shown + lessons, homework.count - shown.count)
    }

    /// The most a homework pays, read off the live rules — nil when the rule is missing, pays
    /// nothing, or pays points but no XP.
    public static func homeworkXP(_ rules: [RewardRule]) -> Int? {
        guard let rule = rules.first(where: { $0.event == "HOMEWORK" }), rule.grantsXP, rule.points > 0 else {
            return nil
        }
        return rule.points
    }

    /// The newest released midterm score the student has not opened from Today.
    public static func freshResult(_ midterms: [MidtermListing], seen: Set<Int>) -> MidtermListing? {
        midterms
            .filter { $0.submitted && $0.resultsVisible && $0.score != nil }
            .filter { $0.attemptId.map { !seen.contains($0) } ?? false }
            .max { ($0.attemptId ?? 0) < ($1.attemptId ?? 0) }
    }

    /// The step from "not all done" to "all done" — the moment the hero celebrates. Never on
    /// the first look, and never for a week with nothing due.
    public static func justFinished(previous: Progress?, current: Progress) -> Bool {
        guard let previous, previous.total > 0, !previous.isComplete else { return false }
        return current.isComplete
    }

    static func todaysLessons(_ events: [ScheduleEvent], now: Date, calendar: Calendar) -> [WorkItem] {
        let kinds: Set<ScheduleEvent.Kind> = [.classMeeting, .mock, .midterm]
        return events
            .filter { kinds.contains($0.type) }
            .compactMap { event -> (event: ScheduleEvent, start: Date)? in
                guard let day = ProfileCalendar.date(fromDay: event.date, calendar: calendar),
                      calendar.isDate(day, inSameDayAs: now),
                      let window = ProfileLessons.window(of: event, hours: 2, calendar: calendar),
                      window.end > now else { return nil }
                return (event, window.start)
            }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.event.id < $1.event.id }
            .map { WorkItem.lesson($0.event, start: $0.start) }
    }

    /// Monday to Sunday — the learning center's week (ODD classes meet Mon, Wed, Fri).
    static func week(_ assignments: [AssignmentListing], now: Date, calendar: Calendar) -> Progress {
        var weekCalendar = calendar
        weekCalendar.firstWeekday = 2
        guard let week = weekCalendar.dateInterval(of: .weekOfYear, for: now) else {
            return Progress(done: 0, total: 0)
        }
        let due = assignments.filter { homework in
            guard let date = homework.dueAt.flatMap(JSONCoding.parseServerDate) else { return false }
            return date >= week.start && date < week.end
        }
        return Progress(done: due.filter(HomeworkProgress.isDone).count, total: due.count)
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "HomeworkProgressTests|WorkItemTests|TodayPlanTests" 2>&1 | tail -6`
Expected: `✔ Suite HomeworkProgressTests passed` (5), `✔ Suite WorkItemTests passed` (4), `✔ Suite TodayPlanTests passed` (8). Then `swift test 2>&1 | tail -2` → `✔ Test run with 666 tests … passed` (649 + 17).

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Today/WorkItem.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Today/TodayPlan.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/TodayPlanTests.swift
git commit -m "feat(ios-kit): Today's plan — what is owed, catch-up first, the week's ring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Class chips and the Tasks lists in the kit (`ClassFilter`, `ClassTasks`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Classroom/ClassFilter.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/ClassFilterTests.swift`

**Interfaces:**
- Consumes: `Classroom.isMath` (`Classroom/ClassroomRules.swift`); `AssessmentSubjectKey` (`.of(_:)`, `.label`), `AssessmentBoard(assignments:).entries`, `AssessmentBoardEntry` (`Assessment/AssessmentBoard.swift`); `WorkItem`, `HomeworkProgress` (Task 10); `MidtermListing`. Tests reuse `ProfileFixtures`, `WorkFixtures` (Task 10).
- Produces: `public struct ClassFilter: Sendable, Equatable { struct Chip: Identifiable { id, label: String; classroomIds: Set<Int>; subject: AssessmentSubjectKey? }; static let allID = "all"; classrooms: [Classroom]; chips: [Chip]; init(classrooms:); func chip(_:) -> Chip?; func resolvedID(_:) -> String; func classes(for:) -> [Classroom]; func includes(classroomId: Int?, chipID: String) -> Bool; func includes(subject: String?, chipID: String) -> Bool }`; `public struct ClassTasks: Sendable, Equatable { toDo: [WorkItem]; done: [AssignmentListing]; assessmentResults: [AssessmentBoardEntry]; midtermResults: [MidtermListing]; resultsCount: Int; init(assignments:midterms:filter:chipID:homeworkXP:now:) }`.

- [ ] **Step 1: Write the failing test**

`ios/MasterSATKit/Tests/MasterSATKitTests/ClassFilterTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

private func room(_ id: Int, _ name: String, _ subject: String) throws -> Classroom {
    try ProfileFixtures.room(["id": id, "name": name, "subject": subject, "my_role": "STUDENT"])
}

@Suite struct ClassFilterTests {

    @Test("One class, or none, has nothing to choose between")
    func noChips() throws {
        #expect(ClassFilter(classrooms: []).chips.isEmpty)
        let one = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH")])
        #expect(one.chips.isEmpty)
        #expect(one.classes(for: ClassFilter.allID).map(\.id) == [1])
    }

    @Test("A class of each subject is named by its subject: All · Math · English")
    func subjectChips() throws {
        let filter = ClassFilter(classrooms: [try room(2, "English EVEN", "ENGLISH"), try room(1, "Math ODD", "MATH")])
        #expect(filter.chips.map(\.id) == ["all", "math", "english"])
        #expect(filter.chips.map(\.label) == ["All", "Math", "English"])
        #expect(filter.classes(for: "math").map(\.id) == [1])
    }

    @Test("Two classes of one subject are named by class")
    func classChips() throws {
        let filter = ClassFilter(classrooms: [
            try room(1, "Math ODD", "MATH"), try room(2, "Math EVEN", "MATH"), try room(3, "English EVEN", "ENGLISH"),
        ])
        #expect(filter.chips.map(\.label) == ["All", "Math EVEN", "Math ODD", "English"])
        #expect(filter.chips.map(\.id) == ["all", "class-2", "class-1", "english"])
    }

    @Test("A chip shows its own classes' work; work with no class only under All")
    func includesClassroom() throws {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        #expect(filter.includes(classroomId: 1, chipID: "math"))
        #expect(!filter.includes(classroomId: 2, chipID: "math"))
        #expect(!filter.includes(classroomId: nil, chipID: "math"))
        #expect(filter.includes(classroomId: nil, chipID: "all"))
        #expect(filter.includes(classroomId: 2, chipID: "gone"), "an unknown chip is All")
    }

    @Test("A midterm is placed by its subject")
    func includesSubject() throws {
        let filter = ClassFilter(classrooms: [
            try room(1, "Math ODD", "MATH"), try room(2, "Math EVEN", "MATH"), try room(3, "English EVEN", "ENGLISH"),
        ])
        #expect(filter.includes(subject: "MATH", chipID: "class-1"))
        #expect(!filter.includes(subject: "READING_WRITING", chipID: "class-1"))
        #expect(filter.includes(subject: "READING_WRITING", chipID: "english"))
        #expect(filter.includes(subject: "", chipID: "all"))
        #expect(!filter.includes(subject: "", chipID: "english"))
    }

    @Test("A chip that has gone reads as All")
    func resolved() throws {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        #expect(filter.resolvedID("math") == "math")
        #expect(filter.resolvedID("class-9") == "all")
    }
}

@Suite struct ClassTasksTests {
    typealias W = WorkFixtures
    typealias F = ProfileFixtures

    private func fixture() throws -> (ClassFilter, [AssignmentListing], [MidtermListing]) {
        let filter = ClassFilter(classrooms: [try room(1, "Math ODD", "MATH"), try room(2, "English EVEN", "ENGLISH")])
        let assignments = [
            try W.homework(1, due: F.at(2)),
            try W.homework(2, due: F.at(-1)),
            try W.homework(3, due: F.at(-3), status: "SUBMITTED"),
            try W.homework(4, due: F.at(-1), status: "SUBMITTED"),
            try W.homework(5, due: F.at(1), classroom: 2, className: "English EVEN"),
            try W.homework(6, due: F.at(-2), status: "graded", extra: ["assessment_homeworks": [W.quiz(61, "graded")]]),
        ]
        let midterms = [
            try F.decode(MidtermListing.self, ["midterm_id": 1, "title": "Math midterm", "subject": "MATH", "attempt_id": 4, "submitted": true]),
            try F.decode(MidtermListing.self, ["midterm_id": 2, "title": "English midterm", "subject": "READING_WRITING", "attempt_id": 5, "submitted": true]),
            try F.decode(MidtermListing.self, ["midterm_id": 3, "title": "Not sat", "subject": "MATH", "submitted": false]),
        ]
        return (filter, assignments, midterms)
    }

    @Test("Under a chip: to do in Today's order, done latest first, results of that subject")
    func underAChip() throws {
        let (filter, assignments, midterms) = try fixture()
        let tasks = ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: "math", homeworkXP: 15, now: F.now)
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 1])
        #expect(tasks.done.map(\.id) == [4, 6, 3])
        #expect(tasks.assessmentResults.map(\.id) == [61])
        #expect(tasks.midtermResults.map(\.title) == ["Math midterm"])
        #expect(tasks.resultsCount == 2)
    }

    @Test("Under All: every class, every sat midterm, newest sitting first")
    func underAll() throws {
        let (filter, assignments, midterms) = try fixture()
        let tasks = ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: "all", homeworkXP: 15, now: F.now)
        #expect(tasks.toDo.compactMap { $0.assignment?.id } == [2, 5, 1])
        #expect(tasks.midtermResults.map(\.title) == ["English midterm", "Math midterm"])
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "ClassFilterTests|ClassTasksTests" 2>&1 | tail -5`
Expected: build error `cannot find 'ClassFilter' in scope`.

- [ ] **Step 3: Implement `Classroom/ClassFilter.swift`**

```swift
import Foundation

/// The Class tab's chips, read off the student's classes.
///
/// One chip per subject — "Math", "English" — and, where two classes share a subject, one chip
/// per class by its name instead, so the chips always tell the classes apart. "All" comes first.
/// One class (or none) gets no chips: there is nothing to choose between.
public struct ClassFilter: Sendable, Equatable {
    public struct Chip: Identifiable, Sendable, Equatable {
        public let id: String
        public let label: String
        /// The classes the chip shows.
        public let classroomIds: Set<Int>
        /// The subject it stands for; nil for All.
        public let subject: AssessmentSubjectKey?
    }

    public static let allID = "all"

    public let classrooms: [Classroom]
    public let chips: [Chip]

    public init(classrooms: [Classroom]) {
        self.classrooms = classrooms
        guard classrooms.count > 1 else {
            chips = []
            return
        }
        var chips = [Chip(id: Self.allID, label: "All", classroomIds: Set(classrooms.map(\.id)), subject: nil)]
        for subject in [AssessmentSubjectKey.math, .english] {
            let rooms = classrooms
                .filter { Self.subject(of: $0) == subject }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            if rooms.count == 1, let room = rooms.first {
                chips.append(Chip(id: subject.rawValue, label: subject.label, classroomIds: [room.id], subject: subject))
            } else {
                chips += rooms.map {
                    Chip(id: "class-\($0.id)", label: $0.name, classroomIds: [$0.id], subject: subject)
                }
            }
        }
        self.chips = chips
    }

    /// Anything that is not maths is an English class — the classes list's own rule.
    static func subject(of room: Classroom) -> AssessmentSubjectKey { room.isMath ? .math : .english }

    public func chip(_ id: String) -> Chip? { chips.first { $0.id == id } }

    /// A chip that has gone (a class left, a reload) reads as All.
    public func resolvedID(_ id: String) -> String { chip(id) == nil ? Self.allID : id }

    public func classes(for chipID: String) -> [Classroom] {
        guard let chip = chip(chipID), chip.id != Self.allID else { return classrooms }
        return classrooms.filter { chip.classroomIds.contains($0.id) }
    }

    /// Work from a class shows under that class's chips; work with no class only under All.
    public func includes(classroomId: Int?, chipID: String) -> Bool {
        guard let chip = chip(chipID), chip.id != Self.allID else { return true }
        return classroomId.map(chip.classroomIds.contains) ?? false
    }

    /// A midterm carries no class, only a subject, so it shows under every chip of its subject.
    public func includes(subject raw: String?, chipID: String) -> Bool {
        guard let chip = chip(chipID), chip.id != Self.allID else { return true }
        return AssessmentSubjectKey.of(raw) == chip.subject
    }
}

/// The Tasks segment's three lists under one chip.
public struct ClassTasks: Sendable, Equatable {
    /// Still owed, in Today's order.
    public let toDo: [WorkItem]
    /// Done, the latest deadline first.
    public let done: [AssignmentListing]
    /// Quizzes handed in — marked, or being marked — the latest deadline first.
    public let assessmentResults: [AssessmentBoardEntry]
    /// Midterms sat, the newest sitting first.
    public let midtermResults: [MidtermListing]

    public init(
        assignments: [AssignmentListing],
        midterms: [MidtermListing],
        filter: ClassFilter,
        chipID: String,
        homeworkXP: Int?,
        now: Date = Date()
    ) {
        let mine = assignments.filter { filter.includes(classroomId: $0.classroomId, chipID: chipID) }
        toDo = WorkItem.ordered(
            mine.filter { !HomeworkProgress.isDone($0) }
                .map { WorkItem.homework($0, homeworkXP: homeworkXP, now: now) }
        )
        done = mine.filter(HomeworkProgress.isDone).sorted { a, b in
            let da = Self.deadline(a.dueAt), db = Self.deadline(b.dueAt)
            return da != db ? da > db : a.id > b.id
        }
        assessmentResults = AssessmentBoard(assignments: mine).entries
            .filter { $0.state.isDone }
            .sorted { a, b in
                let da = Self.deadline(a.dueAt), db = Self.deadline(b.dueAt)
                return da != db ? da > db : a.id > b.id
            }
        midtermResults = midterms
            .filter { $0.submitted && filter.includes(subject: $0.subject, chipID: chipID) }
            .sorted { ($0.attemptId ?? 0) > ($1.attemptId ?? 0) }
    }

    public var resultsCount: Int { assessmentResults.count + midtermResults.count }

    /// Undated work sorts as the oldest, so it ends a newest-first list.
    static func deadline(_ raw: String?) -> Date { raw.flatMap(JSONCoding.parseServerDate) ?? .distantPast }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "ClassFilterTests|ClassTasksTests" 2>&1 | tail -4`
Expected: `✔ Suite ClassFilterTests passed` (6), `✔ Suite ClassTasksTests passed` (2). Whole kit: `✔ Test run with 674 tests … passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Classroom/ClassFilter.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/ClassFilterTests.swift
git commit -m "feat(ios-kit): class chips by subject or by class, and the Tasks lists under each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: XP truth and the celebration queue in the kit (`XPDelta`, `LatestOnly`, `CelebrationQueue`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPDelta.swift`
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationQueueTests.swift`

**Interfaces:**
- Produces: `public enum XPDelta { static func gain(before: Int?, after: Int?) -> Int }`; `public struct LatestOnly: Sendable, Equatable { init(); mutating func issue() -> UInt64; mutating func accept(_: UInt64) -> Bool }`; `public enum FinishedWork: String, Sendable, CaseIterable { case homework, assessment, vocabSession, survey; var announcement: String }`; `public struct CelebrationQueue: Sendable, Equatable { struct Flight: Identifiable { id, amount: Int }; init(); held: Int; isEmpty, hasHiddenEffort, hasConfirmedGain: Bool; func isFlying(_: Int) -> Bool; mutating func record(_:xpBefore:stageVisible:) -> (id: Int, playNow: Bool); mutating func takeEfforts(stageVisible:) -> [FinishedWork]; mutating func resolve(_:xpAfter:allowsFlights:); mutating func takeFlight(stageVisible:pillVisible:allowsFlights:) -> Flight?; mutating func land(_:); mutating func releaseHeld() }`.

- [ ] **Step 1: Write the failing test**

`ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationQueueTests.swift`:

```swift
import Testing
@testable import MasterSATKit

@Suite struct XPTruthTests {

    @Test("The gain is what the header will read minus what it read; never negative")
    func delta() {
        #expect(XPDelta.gain(before: 100, after: 115) == 15)
        #expect(XPDelta.gain(before: 100, after: 100) == 0)
        #expect(XPDelta.gain(before: 100, after: 90) == 0)
        #expect(XPDelta.gain(before: nil, after: 115) == 0)
        #expect(XPDelta.gain(before: 100, after: nil) == 0)
    }

    @Test("An answer to an older request never overwrites a newer one")
    func latestOnly() {
        var order = LatestOnly()
        let first = order.issue()
        let second = order.issue()
        // `accept` is mutating, so it is called outside `#expect`.
        let newerAccepted = order.accept(second)
        let olderAccepted = order.accept(first)
        let third = order.issue()
        let laterAccepted = order.accept(third)
        #expect(newerAccepted)
        #expect(!olderAccepted)
        #expect(laterAccepted)
    }

    @Test("What a finished task says to VoiceOver")
    func announcements() {
        #expect(FinishedWork.homework.announcement == "Homework handed in. Well done.")
        #expect(FinishedWork.assessment.announcement == "Assessment handed in. Well done.")
        #expect(FinishedWork.vocabSession.announcement == "Round finished. Well done.")
        #expect(FinishedWork.survey.announcement == "Survey sent. Thank you.")
    }
}

/// Every mutating call is made on its own line, never inside `#expect`, so the queue is changed
/// exactly once per call whatever the macro does with its operands.
@Suite struct CelebrationQueueTests {

    @Test("Finished on screen: the check plays at once; the XP waits for a pill, then lands")
    func onScreen() {
        var queue = CelebrationQueue()
        let entry = queue.record(.homework, xpBefore: 100, stageVisible: true)
        #expect(entry.playNow)
        queue.resolve(entry.id, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
        let early = queue.takeFlight(stageVisible: true, pillVisible: false, allowsFlights: true)
        #expect(early == nil)
        #expect(queue.held == 15)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 15)
        #expect(queue.held == 15, "held until it lands, so the pill rolls on landing")
        if let flight { queue.land(flight.id) }
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Finished under a sheet or a cover: nothing plays until the stage can be seen")
    func covered() {
        var queue = CelebrationQueue()
        let entry = queue.record(.assessment, xpBefore: 100, stageVisible: false)
        #expect(!entry.playNow)
        let hidden = queue.takeEfforts(stageVisible: false)
        #expect(hidden.isEmpty)
        queue.resolve(entry.id, xpAfter: 110, allowsFlights: true)
        let underCover = queue.takeFlight(stageVisible: false, pillVisible: true, allowsFlights: true)
        #expect(underCover == nil)
        let beforeCheck = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(beforeCheck == nil, "not before its check has played")
        let shown = queue.takeEfforts(stageVisible: true)
        #expect(shown == [.assessment])
        let again = queue.takeEfforts(stageVisible: true)
        #expect(again.isEmpty, "each check is handed out once")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 10)
    }

    @Test("Nothing earned, a failed refresh, or an unknown start: nothing flies")
    func noGain() {
        let cases: [(Int?, Int?)] = [(100, 100), (100, nil), (nil, 115)]
        for (before, after) in cases {
            var queue = CelebrationQueue()
            let entry = queue.record(.survey, xpBefore: before, stageVisible: true)
            queue.resolve(entry.id, xpAfter: after, allowsFlights: true)
            #expect(queue.held == 0)
            let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
            #expect(flight == nil)
            #expect(queue.isEmpty)
        }
    }

    @Test("Reduce Motion: nothing is held and nothing flies — the number just changes")
    func reduceMotion() {
        var queue = CelebrationQueue()
        let entry = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(entry.id, xpAfter: 115, allowsFlights: false)
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Reduce Motion switched on midway gives back everything held")
    func releaseHeld() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        _ = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        let b = queue.record(.assessment, xpBefore: 115, stageVisible: true)
        queue.resolve(b.id, xpAfter: 125, allowsFlights: true)
        #expect(queue.held == 25)
        queue.releaseHeld()
        #expect(queue.held == 0)
        #expect(queue.isEmpty)
    }

    @Test("Two tasks whose refreshes read the same total count the gain once")
    func noDoubleCount() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        let b = queue.record(.survey, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        queue.resolve(b.id, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
    }

    @Test("Gains confirmed together fly together; one still out waits for its own")
    func together() {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        let b = queue.record(.assessment, xpBefore: 110, stageVisible: true)
        let c = queue.record(.vocabSession, xpBefore: 125, stageVisible: true)
        queue.resolve(a.id, xpAfter: 110, allowsFlights: true)
        queue.resolve(b.id, xpAfter: 125, allowsFlights: true)
        let first = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(first?.amount == 25)
        #expect(!queue.hasConfirmedGain)
        queue.resolve(c.id, xpAfter: 130, allowsFlights: true)
        let second = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(second?.amount == 5)
    }

    @Test("Landing twice is harmless, and a landed flight is no longer flying")
    func landing() throws {
        var queue = CelebrationQueue()
        let a = queue.record(.homework, xpBefore: 100, stageVisible: true)
        queue.resolve(a.id, xpAfter: 115, allowsFlights: true)
        let taken = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        let flight = try #require(taken)
        #expect(queue.isFlying(flight.id))
        queue.land(flight.id)
        queue.land(flight.id)
        #expect(!queue.isFlying(flight.id))
        #expect(queue.held == 0)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "XPTruthTests|CelebrationQueueTests" 2>&1 | tail -5`
Expected: build error `cannot find 'XPDelta' in scope` (and `LatestOnly`, `FinishedWork`, `CelebrationQueue`).

- [ ] **Step 3: Implement `Rewards/XPDelta.swift`**

```swift
import Foundation

/// The XP a finished task earned, as the server confirms it: the header's total after a
/// refresh, minus the total it showed before. Never negative, and nothing when either is unknown
/// — "+N XP" is only ever shown for a gain the server stands behind.
public enum XPDelta {
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
    }
}

/// Hands out tickets in request order and accepts an answer only if no later request's answer
/// is already in — two reads of `/rewards/me/` can come back the wrong way round.
public struct LatestOnly: Sendable, Equatable {
    public private(set) var issued: UInt64 = 0
    public private(set) var accepted: UInt64 = 0

    public init() {}

    public mutating func issue() -> UInt64 {
        issued += 1
        return issued
    }

    public mutating func accept(_ ticket: UInt64) -> Bool {
        guard ticket > accepted else { return false }
        accepted = ticket
        return true
    }
}
```

- [ ] **Step 4: Implement `Motion/CelebrationQueue.swift`**

```swift
import Foundation

/// A piece of work the app celebrates every time it is finished — effort, never a score.
public enum FinishedWork: String, Sendable, CaseIterable, Equatable {
    case homework, assessment, vocabSession, survey

    /// What VoiceOver says, since the check and the confetti cannot be seen.
    public var announcement: String {
        switch self {
        case .homework: return "Homework handed in. Well done."
        case .assessment: return "Assessment handed in. Well done."
        case .vocabSession: return "Round finished. Well done."
        case .survey: return "Survey sent. Thank you."
        }
    }
}

/// Celebrations waiting for the student to be able to see them.
///
/// A task can finish where the root overlay cannot be seen — inside the assessment runner or a
/// word game (full-screen covers), or under the Me sheet. Its check and confetti then wait until
/// the stage is clear. Its "+N XP" waits longer: for the post-task refresh to confirm a gain, for
/// the check to have played, and for a header pill on screen to catch it. Until it lands the gain
/// is HELD: the header shows the old number and rolls when the flight lands.
public struct CelebrationQueue: Sendable, Equatable {
    public struct Flight: Sendable, Equatable, Identifiable {
        public let id: Int
        public let amount: Int
    }

    struct Entry: Sendable, Equatable {
        let id: Int
        let work: FinishedWork
        let xpBefore: Int?
        var effortShown: Bool
        /// Nil while the refresh is out; 0 once it said nothing was earned, or nothing may fly.
        var gain: Int?
    }

    private(set) var entries: [Entry] = []
    private(set) var flying: [Flight] = []
    private var nextID = 1
    /// The highest total a task has been measured against, so two tasks whose refreshes read
    /// the same total do not both claim the same gain.
    private var measuredUpTo: Int?

    public init() {}

    /// XP the header holds back: confirmed, and not landed yet.
    public var held: Int {
        entries.reduce(0) { $0 + ($1.gain ?? 0) } + flying.reduce(0) { $0 + $1.amount }
    }

    public var isEmpty: Bool { entries.isEmpty && flying.isEmpty }

    /// A check and confetti still waiting for the stage.
    public var hasHiddenEffort: Bool { entries.contains { !$0.effortShown } }

    /// A confirmed gain not yet in the air.
    public var hasConfirmedGain: Bool { entries.contains { ($0.gain ?? 0) > 0 } }

    public func isFlying(_ id: Int) -> Bool { flying.contains { $0.id == id } }

    /// A task was finished. Its check plays now only when the stage can be seen; otherwise
    /// `takeEfforts` hands it out later.
    @discardableResult
    public mutating func record(_ work: FinishedWork, xpBefore: Int?, stageVisible: Bool) -> (id: Int, playNow: Bool) {
        let id = nextID
        nextID += 1
        entries.append(Entry(id: id, work: work, xpBefore: xpBefore, effortShown: stageVisible, gain: nil))
        return (id, stageVisible)
    }

    /// The checks still to show, now that the stage can be seen. Each is handed out once.
    public mutating func takeEfforts(stageVisible: Bool) -> [FinishedWork] {
        guard stageVisible else { return [] }
        var shown: [FinishedWork] = []
        for index in entries.indices where !entries[index].effortShown {
            entries[index].effortShown = true
            shown.append(entries[index].work)
        }
        dropSettled()
        return shown
    }

    /// The refresh after a task came back. Nothing earned — or no flights allowed — holds nothing.
    public mutating func resolve(_ id: Int, xpAfter: Int?, allowsFlights: Bool) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let floor = entries[index].xpBefore.map { max($0, measuredUpTo ?? $0) }
        let gain = XPDelta.gain(before: floor, after: xpAfter)
        if let xpAfter { measuredUpTo = max(measuredUpTo ?? xpAfter, xpAfter) }
        entries[index].gain = allowsFlights ? gain : 0
        dropSettled()
    }

    /// One flight carrying every confirmed gain whose check has played — when the stage can be
    /// seen and a pill is on screen to catch it. Without flights, gives everything back.
    public mutating func takeFlight(stageVisible: Bool, pillVisible: Bool, allowsFlights: Bool) -> Flight? {
        guard allowsFlights else {
            if held > 0 { releaseHeld() }
            return nil
        }
        guard stageVisible, pillVisible else { return nil }
        let ready = entries.filter { $0.effortShown && ($0.gain ?? 0) > 0 }
        guard !ready.isEmpty else { return nil }
        let readyIDs = Set(ready.map(\.id))
        entries.removeAll { readyIDs.contains($0.id) }
        let flight = Flight(id: nextID, amount: ready.reduce(0) { $0 + ($1.gain ?? 0) })
        nextID += 1
        flying.append(flight)
        return flight
    }

    /// The flight reached its pill: what it carried is no longer held.
    public mutating func land(_ id: Int) {
        flying.removeAll { $0.id == id }
    }

    /// Flights became impossible (Reduce Motion): nothing is held back any more.
    public mutating func releaseHeld() {
        for index in entries.indices where (entries[index].gain ?? 0) > 0 {
            entries[index].gain = 0
        }
        flying.removeAll()
        dropSettled()
    }

    /// An entry is finished with once its check has played and nothing is left to fly.
    private mutating func dropSettled() {
        entries.removeAll { $0.effortShown && $0.gain == 0 }
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "XPTruthTests|CelebrationQueueTests" 2>&1 | tail -4`
Expected: `✔ Suite XPTruthTests passed` (3), `✔ Suite CelebrationQueueTests passed` (8). Whole kit: `✔ Test run with 685 tests … passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPDelta.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationQueueTests.swift
git commit -m "feat(ios-kit): XP the server confirmed, in request order, and celebrations that wait to be seen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Celebrations on real XP — the center, the pill, the store

**Files:**
- Modify (rewrite): `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift`
- Modify (rewrite): `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift`
- Modify (rewrite): `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift` (`XPPill`)
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift` (`loadMe`)

**Interfaces:**
- Consumes: `CelebrationQueue`, `FinishedWork`, `LatestOnly` (Task 12); `ConfettiBurst`, `MotionBudget` (phase 1 kit); `Motion` (`Support/Motion/Motion.swift`); `RewardsAPI.me()`, `MyRewards`; `AppRouter.showingMe`, `.certificate`, `.sheetDismissed(baseURL:openURL:)`.
- Produces: `CelebrationCenter` — `reduceMotion: Bool`, `bursts`, `flights`, `effort: EffortCue?`, `effortCount: Int`, `landing: XPLanding?`, `heldXP: Int`, `xpNow: Int?`, `connect(rewards:api:)`, `celebrate(_: FinishedWork, xpBefore: Int?, at: CGPoint? = nil)`, `allDone()`, `confetti(at:size:)`, `announce(_:)`, `setStage(_:)`, `setSheetUp(_:)`, `coverAppeared()`, `coverDisappeared()`, `pillAppeared()`, `setXPTarget(_:owner:)`, `clearXPTarget(owner:)`, `landed(_:)`; `struct XPFlight { id: Int; amount: Int; from, to: CGPoint; owner: UUID }`; `struct EffortCue`, `struct XPLanding { count: Int; owner: UUID }`; `CelebrationLayer`, `TaskCompleteBadge`; `extension CGRect { var celebrationPoint: CGPoint? }`; `extension View { func coversCelebrations(_: CelebrationCenter) -> some View }`; `LottieClip.Playback` (`loop`, `once`, `still`) with `init(_:playback:)` (the `init(_:loops:)` stays); `RewardsStore.ticket() -> UInt64`, `refresh(using:) async -> Int?` (discardable), `apply(_:ticket:)`. Removed: `CelebrationCenter.flyXP`, `.landedCount`, `.setXPTarget(_:)`, and the DEBUG long-press on `XPPill` (R-P2c).

- [ ] **Step 1: Rewrite `Support/Motion/Celebrations.swift`**

```swift
import SwiftUI
import MasterSATKit

/// "+N XP" on its way from the middle of the screen to the header pill that will catch it.
struct XPFlight: Identifiable, Equatable {
    /// The queue's flight id: landing it gives the header back exactly what it carried.
    let id: Int
    let amount: Int
    let from: CGPoint
    let to: CGPoint
    /// The pill it was aimed at — the only one that pulses when it lands.
    let owner: UUID
}

/// The check that pops where a piece of work was finished.
struct EffortCue: Identifiable, Equatable {
    let id = UUID()
    let work: FinishedWork
    let at: CGPoint
}

/// A landing, and the pill it landed on.
struct XPLanding: Equatable {
    let count: Int
    let owner: UUID
}

/// The header pill on screen that a flight can land on.
private struct PillTarget: Equatable {
    let rect: CGRect
    let owner: UUID
}

/// Everything celebratory on screen, in one place, drawn by one overlay at the root.
///
/// A finished task (`celebrate`) plays its check, confetti, haptic and announcement at once
/// when the overlay can be seen — and later when it cannot: under the Me sheet, or inside a
/// full-screen cover (`coversCelebrations`). Its XP is the server's word: the header refreshes,
/// the gain is the new total minus the old, and only a positive gain flies — once a header pill
/// is on screen to catch it. Until it lands the gain is HELD, so the pill rolls when it lands
/// rather than before the flight leaves. The rules are `CelebrationQueue`, in the kit.
///
/// Points are GLOBAL coordinates (`.frame(in: .global)`): the overlay ignores the safe area and
/// covers the screen, so the two agree.
@MainActor
@Observable
final class CelebrationCenter {
    enum Size { case task, everything }

    var reduceMotion = false {
        didSet {
            // Nothing may fly any more: give the header back what it was holding.
            if reduceMotion, !oldValue, queue.held > 0 { queue.releaseHeld() }
        }
    }
    private(set) var bursts: [ConfettiBurst] = []
    private(set) var flights: [XPFlight] = []
    /// The check on screen now, if any.
    private(set) var effort: EffortCue?
    /// Bumps once per celebration — the success haptic's trigger.
    private(set) var effortCount = 0
    private(set) var landing: XPLanding?
    private var queue = CelebrationQueue()

    // Bookkeeping nothing renders from.
    @ObservationIgnored private var target: PillTarget?
    @ObservationIgnored private var sheetUp = false
    @ObservationIgnored private var coversUp = 0
    @ObservationIgnored private var stage: CGSize = .zero
    @ObservationIgnored private weak var rewards: RewardsStore?
    @ObservationIgnored private var rewardsAPI: RewardsAPI?

    /// XP earned but not landed yet. Every pill shows `xp − heldXP`.
    var heldXP: Int { queue.held }

    /// The XP the header shows now — what a task's gain is measured from.
    var xpNow: Int? { rewards?.xp }

    private var covered: Bool { sheetUp || coversUp > 0 }

    private var budget: MotionBudget {
        MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }

    private var stageCentre: CGPoint { CGPoint(x: stage.width / 2, y: stage.height * 0.45) }
    private var flightOrigin: CGPoint { CGPoint(x: stage.width / 2, y: stage.height * 0.6) }

    /// The header numbers a celebration refreshes and measures. Called once, by the root.
    func connect(rewards: RewardsStore, api: RewardsAPI) {
        self.rewards = rewards
        rewardsAPI = api
    }

    // MARK: - Finished work

    /// A piece of work is in. `xpBefore` is `xpNow` read when the work started; `point` is where
    /// the confetti leaves from when it plays at once (the button), else the screen's centre.
    func celebrate(_ work: FinishedWork, xpBefore: Int?, at point: CGPoint? = nil) {
        let entry = queue.record(work, xpBefore: xpBefore, stageVisible: !covered)
        if entry.playNow { playEffort(work, at: point) }
        Task { [weak self] in
            guard let self else { return }
            var after: Int?
            if let rewards = self.rewards, let api = self.rewardsAPI {
                after = await rewards.refresh(using: api)
            }
            self.queue.resolve(entry.id, xpAfter: after, allowsFlights: self.budget.allowsFlights)
            self.flyIfReady()
        }
    }

    /// Everything due this week is in: double confetti. The hero bounces on its own.
    func allDone() {
        guard !covered else { return }
        confetti(at: CGPoint(x: stage.width * 0.3, y: stage.height * 0.4), size: .everything)
        confetti(at: CGPoint(x: stage.width * 0.7, y: stage.height * 0.4), size: .everything)
        effortCount += 1
        announce("Everything due this week is done.")
    }

    func confetti(at point: CGPoint, size: Size = .task) {
        let count = budget.confetti(size == .task ? 44 : 80)
        guard count > 0 else { return }
        bursts.append(.make(x: point.x, y: point.y, count: count, power: size == .task ? 1 : 1.25))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(ConfettiBurst.lifetime + 0.2))
            self?.bursts.removeAll { $0.isFinished(at: .now) }
        }
    }

    /// What a celebration says to VoiceOver, since it cannot be seen.
    func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }

    // MARK: - What can be seen

    func setStage(_ size: CGSize) {
        if stage != size { stage = size }
    }

    /// The Me sheet or the certificate came up (the router says so at once), or has gone (its
    /// `onDismiss` says so, once it has left the screen).
    func setSheetUp(_ up: Bool) {
        guard sheetUp != up else { return }
        sheetUp = up
        if !covered { stageCleared() }
    }

    func coverAppeared() { coversUp += 1 }

    func coverDisappeared() {
        guard coversUp > 0 else { return }
        coversUp -= 1
        if !covered { stageCleared() }
    }

    /// A tab root's pill came on screen, so no cover is up — whatever a cover that never
    /// reported leaving left behind.
    func pillAppeared() {
        guard coversUp > 0 else { return }
        coversUp = 0
        if !covered { stageCleared() }
    }

    func setXPTarget(_ rect: CGRect, owner: UUID) {
        let next = PillTarget(rect: rect, owner: owner)
        guard target != next else { return }
        let arrived = target == nil
        target = next
        if arrived { flyIfReady() }
    }

    func clearXPTarget(owner: UUID) {
        if target?.owner == owner { target = nil }
    }

    // MARK: - Flights

    func landed(_ flight: XPFlight) {
        guard let index = flights.firstIndex(where: { $0.id == flight.id }) else { return }
        flights.remove(at: index)
        withAnimation(Motion.snappy) { queue.land(flight.id) }
        landing = XPLanding(count: (landing?.count ?? 0) + 1, owner: flight.owner)
    }

    private func stageCleared() {
        if queue.hasHiddenEffort {
            for work in queue.takeEfforts(stageVisible: true) { playEffort(work, at: nil) }
        }
        flyIfReady()
    }

    private func playEffort(_ work: FinishedWork, at point: CGPoint?) {
        let cue = EffortCue(work: work, at: point ?? stageCentre)
        effort = cue
        effortCount += 1
        confetti(at: cue.at)
        announce(work.announcement)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.9))
            if self?.effort?.id == cue.id { self?.effort = nil }
        }
    }

    private func flyIfReady() {
        guard queue.hasConfirmedGain, let pill = target,
              let flight = queue.takeFlight(stageVisible: !covered, pillVisible: true, allowsFlights: budget.allowsFlights)
        else { return }
        flights.append(XPFlight(
            id: flight.id,
            amount: flight.amount,
            from: flightOrigin,
            to: CGPoint(x: pill.rect.midX, y: pill.rect.midY),
            owner: pill.owner
        ))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            self?.settle(flight.id)
        }
    }

    /// The backstop: a flight whose view went away before it landed still gives its XP back.
    private func settle(_ id: Int) {
        guard queue.isFlying(id) else { return }
        if let index = flights.firstIndex(where: { $0.id == id }) { flights.remove(at: index) }
        queue.land(id)
    }
}

extension CGRect {
    /// The middle of a measured control; nil before it has been measured.
    var celebrationPoint: CGPoint? { self == .zero ? nil : CGPoint(x: midX, y: midY) }
}

extension View {
    /// Put on a full-screen cover's content. While it is up the root overlay is hidden behind
    /// it, so a celebration started inside waits, and plays the moment the cover has gone.
    func coversCelebrations(_ center: CelebrationCenter) -> some View {
        onAppear { center.coverAppeared() }
            .onDisappear { center.coverDisappeared() }
    }
}

/// The overlay that draws the confetti, the check and the flights. Never takes a touch.
struct CelebrationLayer: View {
    @Environment(CelebrationCenter.self) private var center

    var body: some View {
        ZStack {
            ConfettiCanvas(bursts: center.bursts)
            if let effort = center.effort {
                TaskCompleteBadge(reduceMotion: center.reduceMotion)
                    .frame(width: 120, height: 120)
                    .position(effort.at)
                    .id(effort.id)
                    .transition(.opacity)
            }
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .animation(.easeOut(duration: 0.25), value: center.effort?.id)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { center.setStage($0) }
        .sensoryFeedback(.success, trigger: center.effortCount)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The task-complete check. Under Reduce Motion a still tick, faded in and out by the layer.
struct TaskCompleteBadge: View {
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64, weight: .bold))
                .foregroundStyle(Theme.success)
                .background(Circle().fill(Theme.card).padding(6))
        } else {
            LottieClip(.taskComplete, playback: .once)
        }
    }
}

struct ConfettiCanvas: View {
    let bursts: [ConfettiBurst]

    static let palette: [Color] = [Theme.accent, Theme.success, Theme.amber, Theme.subjectEnglish, Theme.danger, Theme.info]

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: bursts.isEmpty)) { timeline in
            Canvas { context, _ in
                for burst in bursts {
                    let t = timeline.date.timeIntervalSince(burst.start)
                    guard t >= 0, t < ConfettiBurst.lifetime else { continue }
                    let fade = burst.opacity(at: t)
                    for particle in burst.particles {
                        let point = burst.position(of: particle, at: t)
                        var piece = context
                        piece.opacity = fade
                        piece.translateBy(x: point.x, y: point.y)
                        piece.rotate(by: .radians(particle.spin * t))
                        piece.fill(Self.shape(particle), with: .color(Self.palette[particle.colorIndex % Self.palette.count]))
                    }
                }
            }
        }
    }

    private static func shape(_ particle: ConfettiParticle) -> Path {
        let s = particle.size
        switch particle.shape {
        case 0: return Path(roundedRect: CGRect(x: -s / 2, y: -s * 0.8, width: s, height: s * 1.6), cornerRadius: 2)
        case 1: return Path(ellipseIn: CGRect(x: -s / 2, y: -s / 2, width: s, height: s))
        default: return Path(roundedRect: CGRect(x: -s * 0.7, y: -s / 4, width: s * 1.4, height: s / 2), cornerRadius: 1)
        }
    }
}

struct XPFlightView: View {
    let flight: XPFlight
    let onLand: @MainActor () -> Void

    @State private var phase = 0

    var body: some View {
        Text("+\(flight.amount) XP")
            .font(.system(size: 22, weight: .black, design: .rounded))
            .foregroundStyle(Theme.amber)
            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
            .opacity(phase == 2 ? 0.3 : 1)
            .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
            .task {
                withAnimation(Motion.pop) { phase = 1 }
                do { try await Task.sleep(for: .milliseconds(380)) } catch { return }
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
            }
    }
}
```

- [ ] **Step 2: Rewrite `Support/Motion/LottieClip.swift`**

```swift
import SwiftUI
import Lottie

/// The bundled motion graphics, by file name (Resources/Lottie/<rawValue>.json).
enum LottieAsset: String, CaseIterable {
    case strikeFlame = "strike-flame"
    case taskComplete = "task-complete"
    case trophy
}

/// A Lottie, played the way the student's settings allow.
///
/// `loop` plays forever (Reduce Motion: its last frame, still); `once` plays through once
/// (Reduce Motion: nothing — but it keeps the frame its caller gave it, so nothing around it
/// moves); `still` always shows the last frame.
struct LottieClip: View {
    enum Playback { case loop, once, still }

    let asset: LottieAsset
    let playback: Playback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ asset: LottieAsset, loops: Bool = true) {
        self.init(asset, playback: loops ? .loop : .once)
    }

    init(_ asset: LottieAsset, playback: Playback) {
        self.asset = asset
        self.playback = playback
    }

    var body: some View {
        Group {
            switch (playback, reduceMotion) {
            case (.still, _), (.loop, true):
                LottieView(animation: .named(asset.rawValue))
                    .playbackMode(.paused(at: .progress(1)))
                    .resizable()
            case (.loop, false):
                LottieView(animation: .named(asset.rawValue))
                    .looping()
                    .resizable()
            case (.once, false):
                LottieView(animation: .named(asset.rawValue))
                    .playing(loopMode: .playOnce)
                    .resizable()
            case (.once, true):
                Color.clear
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
```

- [ ] **Step 3: Rewrite `Screens/Shell/RewardsStore.swift`**

```swift
import SwiftUI
import MasterSATKit

/// The three numbers every tab header shows. A failed refresh keeps the last known values:
/// a header that blanks on a bad connection reads as "you lost your XP".
///
/// Answers are applied in REQUEST order (`LatestOnly`): two reads in flight can come back the
/// wrong way round, and the older must not wind the header back — a celebration measures its
/// gain against these numbers.
@MainActor
@Observable
final class RewardsStore {
    private(set) var xp: Int?
    /// The run of lessons attended — the streak, not the spendable strikes.
    private(set) var streak: Int?
    private(set) var coins: Int?
    @ObservationIgnored private var order = LatestOnly()

    /// Take one before asking `/rewards/me/` yourself, and hand it back to `apply`.
    func ticket() -> UInt64 { order.issue() }

    /// Refreshes, and returns the XP the header shows afterwards — nil when the read failed.
    @discardableResult
    func refresh(using api: RewardsAPI) async -> Int? {
        let ticket = ticket()
        guard let me = try? await api.me() else { return nil }
        apply(me, ticket: ticket)
        return xp
    }

    /// Takes the numbers from a `/rewards/me/` answer, so the Rewards hub and the header never
    /// show two totals. Animated, so the numbers roll; guarded, because every write to an
    /// `@Observable` property notifies, equal or not.
    func apply(_ me: MyRewards, ticket: UInt64) {
        guard order.accept(ticket) else { return }
        guard xp != me.xp || streak != me.currentStreak || coins != me.coins else { return }
        withAnimation(Motion.snappy) {
            if xp != me.xp { xp = me.xp }
            if streak != me.currentStreak { streak = me.currentStreak }
            if coins != me.coins { coins = me.coins }
        }
    }
}
```

- [ ] **Step 4: Replace `XPPill` in `Screens/Shell/AppHeader.swift`**

Replace everything from `private struct PillPulse { var scale = 1.0 }` down to (not including) `struct AvatarButton: View {` with:

```swift
private struct PillPulse { var scale = 1.0 }

struct XPPill: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    /// Which pill this is. Every tab has its own header, so there are several; a flight lands on
    /// the one on screen, and only that one pulses and buzzes.
    @State private var owner = UUID()
    @State private var frame = CGRect.zero
    @State private var showing = false
    @State private var pulses = 0

    var body: some View {
        if let xp = rewards.xp {
            // XP still in the air is not on the pill yet: it rolls up when the flight lands.
            let shown = max(0, xp - celebrations.heldXP)
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill").font(.system(size: 11, weight: .black))
                Text("\(shown) XP").contentTransition(.numericText(value: Double(shown)))
            }
            .font(.system(size: 13, weight: .heavy, design: .rounded))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.card, in: Capsule())
            .keyframeAnimator(initialValue: PillPulse(), trigger: pulses) { content, pulse in
                content.scaleEffect(pulse.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.4, duration: 0.14, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.5, spring: .bouncy(duration: 0.5, extraBounce: 0.3))
                }
            }
            .sensoryFeedback(.increase, trigger: pulses)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                frame = $0
                report()
            }
            .onAppear {
                showing = true
                celebrations.pillAppeared()
                report()
            }
            .onDisappear {
                showing = false
                celebrations.clearXPTarget(owner: owner)
            }
            .onChange(of: celebrations.landing) { _, landing in
                if landing?.owner == owner { pulses += 1 }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(shown) XP")
        }
    }

    /// Only a pill that is showing and on screen can catch a flight. Scrolled up off the top,
    /// it hands the job back, and a flight waits until a pill is in view again.
    private func report() {
        if showing, frame != .zero, frame.maxY > 0 {
            celebrations.setXPTarget(frame, owner: owner)
        } else {
            celebrations.clearXPTarget(owner: owner)
        }
    }
}

```

(The `#if DEBUG` long-press goes with the old body — R-P2c.)

- [ ] **Step 5: Wire the root in `Screens/RootView.swift`**

1. After the closing brace of `private struct RewardsRefresher`, add:

```swift
/// Tells the celebrations when a sheet covers the tabs, so a task finished under the Me sheet
/// waits to be celebrated. Its own view for `RewardsRefresher`'s reason: reading the router
/// here rebuilds this empty view, not the tab view.
private struct CelebrationSheetWatcher: View {
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: router.showingMe || router.certificate != nil) { _, up in
                // Up at once. Down only from the sheets' onDismiss (`RootTabView.sheetDismissed`),
                // once the sheet has actually left the screen.
                if up { celebrations.setSheetUp(true) }
            }
    }
}
```

2. Replace `.background { RewardsRefresher() }` with:

```swift
        .background {
            RewardsRefresher()
            CelebrationSheetWatcher()
        }
```

3. In `RootTabView`'s `.onAppear`, after `celebrations.reduceMotion = reduceMotion`, add:

```swift
            celebrations.connect(rewards: rewards, api: session.rewards)
```

4. Replace `sheetDismissed()` with:

```swift
    /// Both sheets call this when they close: a link that needed the other sheet opens now, and
    /// a celebration that waited under the sheet plays.
    private func sheetDismissed() {
        router.sheetDismissed(baseURL: session.client.config.baseURL) { openURL($0) }
        celebrations.setSheetUp(router.showingMe || router.certificate != nil)
    }
```

- [ ] **Step 6: The Rewards hub takes a ticket — `Screens/Rewards/RewardsHubView.swift`**

Replace `loadMe()` with:

```swift
    @MainActor
    private func loadMe() async {
        let api = session.rewards
        // Taken before asking, so an answer older than the header's own refresh cannot wind it back.
        let ticket = rewards.ticket()
        do {
            let me = try await api.me()
            mine = me
            meFailed = false
            // The header's XP and streak read the same answer, so the two cannot disagree.
            rewards.apply(me, ticket: ticket)
        } catch {
            meFailed = true
        }
    }
```

- [ ] **Step 7: Build**

Run the build check. Expected `exit=0`, `** BUILD SUCCEEDED **`, and:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
grep -rn "flyXP\|landedCount\|onLongPressGesture" Sources/Screens/Shell Sources/Support/Motion || echo "no leftovers"
```
→ `no leftovers`. If the compiler rejects calling `onLand()` in the `withAnimation` completion, write `completion: { Task { @MainActor in onLand() } }` (phase 1's note). If it rejects `.onChange(of: router.showingMe || router.certificate != nil)`, add `private var sheetUp: Bool { router.showingMe || router.certificate != nil }` to the watcher and observe `sheetUp`.

- [ ] **Step 8: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Support/Motion/Celebrations.swift ios/MasterSAT/Sources/Support/Motion/LottieClip.swift \
        ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift \
        ios/MasterSAT/Sources/Screens/RootView.swift ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift
git commit -m "feat(ios): celebrations on XP the server confirmed — held until a visible pill catches it

The check and confetti wait for a sheet or a cover to go; the header refreshes in request
order and rolls when the flight lands; only the pill it lands on pulses. The DEBUG
long-press is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Re-tapping a tab scrolls it to the top; the card → page zoom

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Shell/AppRouter.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/TabRootScroll.swift`
- Modify: `ios/MasterSAT/Sources/Support/Motion/Motion.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift`, `ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift`, `ios/MasterSAT/Sources/Screens/Shell/ExploreView.swift`

**Interfaces:**
- Consumes: `AppTab` (kit); `Motion.snappy`, `Motion.focus`.
- Produces: `struct ScrollRequest: Equatable { tab: AppTab; nonce: Int }`; `AppRouter.scrollToTop: ScrollRequest?`, `AppRouter.show(_ tab: AppTab)`; `reselect(_:)` now pops a pushed page or, at the root, scrolls up; `struct TabRootScroll<Content: View>: View { init(tab: AppTab, @ViewBuilder content: () -> Content) }`; `View.zoomSource(id:in:)`, `View.zoomDestination(id:in:)` (iOS 18+, nothing under Reduce Motion or before 18).

- [ ] **Step 1: `AppRouter.swift`**

1. After `struct CertificateCode { … }`, add:

```swift
/// "Scroll this tab's root to its top" — a fresh nonce each time, so a second tap asks again.
struct ScrollRequest: Equatable {
    let tab: AppTab
    let nonce: Int
}
```

2. After `var certificate: CertificateCode?`, add `private(set) var scrollToTop: ScrollRequest?`.

3. In `open(_:baseURL:openURL:)`, replace the `.tab` case body:

```swift
        case .tab(let tab):
            show(tab)
```

4. Replace `func reselect(_ tab: AppTab) { popToRoot(tab) }` (and its doc comment) with:

```swift
    /// Switch to a tab at its root, closing any sheet — a link to the tab itself, or "See all".
    func show(_ tab: AppTab) {
        queued = nil
        closeSheets()
        select(tab)
        popToRoot(tab)
    }

    /// Tapping the open tab again goes back to its top, as everywhere on iOS: a pushed page pops
    /// to the root; a root already showing scrolls back up.
    func reselect(_ tab: AppTab) {
        if isAtRoot(tab) {
            scrollToTop = ScrollRequest(tab: tab, nonce: (scrollToTop?.nonce ?? 0) + 1)
        } else {
            popToRoot(tab)
        }
    }
```

5. Before `private func popToRoot(_ tab: AppTab)`, add:

```swift
    private func isAtRoot(_ tab: AppTab) -> Bool {
        switch tab {
        case .today: return today.isEmpty
        case .classes: return classes.isEmpty
        case .words: return words.isEmpty
        case .rewards: return rewards.isEmpty
        case .explore: return explore.isEmpty
        }
    }
```

- [ ] **Step 2: Create `Screens/Shell/TabRootScroll.swift`**

```swift
import SwiftUI
import MasterSATKit

/// A tab root's scroll view. Tapping the open tab again with nothing pushed brings it back to
/// the top, as every iOS tab does (`AppRouter.reselect`).
struct TabRootScroll<Content: View>: View {
    let tab: AppTab
    @ViewBuilder let content: () -> Content

    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static var topID: String { "tab-root-top" }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id(Self.topID)
                    content()
                }
            }
            .onChange(of: router.scrollToTop) { _, request in
                guard request?.tab == tab else { return }
                withAnimation(reduceMotion ? Motion.focus : Motion.snappy) {
                    proxy.scrollTo(Self.topID, anchor: .top)
                }
            }
        }
    }
}
```

- [ ] **Step 3: The zoom, at the end of `Support/Motion/Motion.swift`**

```swift
// MARK: - Card → page zoom (iOS 18+)

private struct ZoomSource<ID: Hashable>: ViewModifier {
    let id: ID
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

private struct ZoomDestination<ID: Hashable>: ViewModifier {
    let id: ID
    let namespace: Namespace.ID
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            if reduceMotion {
                content
            } else {
                content.navigationTransition(.zoom(sourceID: id, in: namespace))
            }
        } else {
            content
        }
    }
}

extension View {
    /// The card a page zooms out of. A plain push before iOS 18.
    func zoomSource(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomSource(id: id, namespace: namespace))
    }

    /// The page that zooms out of its card. A plain push before iOS 18 and under Reduce Motion.
    func zoomDestination(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomDestination(id: id, namespace: namespace))
    }
}
```

- [ ] **Step 4: Three tab roots scroll to the top**

In each, replace the `ScrollView {` directly inside `NavigationStack(path: $path) {` (the only change):
- `Screens/Vocabulary/VocabularyView.swift` → `TabRootScroll(tab: .words) {`
- `Screens/Rewards/RewardsHubView.swift` → `TabRootScroll(tab: .rewards) {`
- `Screens/Shell/ExploreView.swift` → `TabRootScroll(tab: .explore) {`

(Today and Class get it when they are rebuilt, Tasks 15–16.)

- [ ] **Step 5: Build**

Run the build check. Expected `exit=0` and `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Shell/AppRouter.swift ios/MasterSAT/Sources/Screens/Shell/TabRootScroll.swift \
        ios/MasterSAT/Sources/Support/Motion/Motion.swift ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift \
        ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift ios/MasterSAT/Sources/Screens/Shell/ExploreView.swift
git commit -m "feat(ios): tap the open tab again to go back to its top; card-to-page zoom on iOS 18

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Today

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Today/TodayView.swift`
- Create: `ios/MasterSAT/Sources/Screens/Today/TodayCards.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/WorkRow.swift`
- Create: `ios/MasterSAT/Sources/Screens/Profile/GoalSheet.swift` (moved, unchanged)
- Create: `ios/MasterSAT/Sources/Screens/LiveQuiz/LiveQuizRunningCard.swift` (moved, unchanged)
- Modify: `ios/MasterSAT/Sources/Support/PageChrome.swift` (`RetryNotice` moved in, unchanged)
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift`
- Delete: `ios/MasterSAT/Sources/Screens/DashboardView.swift`, `ios/MasterSAT/Sources/Screens/HomePulse.swift`

**Interfaces:**
- Consumes: `TodayPlan`, `WorkItem`, `ProfileGoal.testDay(_:)` (kit); `TabRootScroll`, `zoomSource`/`zoomDestination`, `AppRouter.show(_:)`, `.openMe()` (Task 14 / phase 1); `CelebrationCenter.allDone()` (Task 13); `LottieClip(_:playback:)`; existing `AppHeader`, `StoriesRail(refreshID:)`, `UpdateNudgeCard(config:onDismiss:)`, `SurveysWaitingCard(refreshID:)`, `ReminderPromptCard(onEnable:onDismiss:)`, `DotHeading`, `CardHeading`, `IconTile`, `DueLabel`, `HomeworkDetailView(assignment:)`, `MidtermReportView(attemptId:title:)`, `AppLinkPage`, `Session.notifications.reschedule/announceResults/requestPermission/permission`, `StudentAPI.assignments/midterms/schedule(from:to:)`, `RewardsAPI.rules()`.
- Produces: `struct TodayView: View { init(user: CurrentUser, path: Binding<NavigationPath>); enum Route { midtermReport(attemptId:title:) } }`; `TodayHero(progress:loaded:bounce:)`, `AllDoneCard()`, `FreshResultCard(midterm:onOpen:onLater:)`, `SATCountdownRow(examDate:onOpen:)`; `WorkRow(item: WorkItem)`, `XPCapChip(amount:)`.

- [ ] **Step 1: Move the three shared pieces out of the files that go**

`Screens/Profile/GoalSheet.swift` (the sheet the Me sheet's goal panel opens — unchanged):

```swift
import SwiftUI
import MasterSATKit

/// The site's "Set your target score" popover, as a sheet. Opened from the Me sheet's goal panel.
struct GoalSheet: View {
    @State var english: Int
    @State var math: Int
    let onSave: (Int, Int) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                Text("Each section is 200–800.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)

                slider("Math score", value: $math)
                slider("English score", value: $english)

                HStack {
                    Text("Overall").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    Text(ScoreText.string(english + math))
                        .font(.system(size: 18, weight: .heavy).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    Spacer()
                }

                Spacer()

                Button {
                    saving = true
                    Task {
                        await onSave(english, math)
                        saving = false
                        dismiss()
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save goal")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(saving)
            }
            .padding(20)
            .background(Theme.background)
            .navigationTitle("Set your target score")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func slider(_ label: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(label).font(.system(size: 14, weight: .semibold))
                Text(ScoreText.string(value.wrappedValue))
                    .font(.system(size: 14, weight: .heavy).monospacedDigit())
            }
            Slider(
                value: Binding(get: { Double(value.wrappedValue) }, set: { value.wrappedValue = Int($0) }),
                in: 200...800,
                step: 10
            )
            .tint(Theme.accent)
        }
    }
}
```

`Screens/LiveQuiz/LiveQuizRunningCard.swift` (unchanged):

```swift
import SwiftUI
import MasterSATKit

/// A live quiz running in one of the student's classes. The web has no dashboard card for it —
/// a student reaches `/live` from the code the teacher projects — but a phone has no address
/// bar to type that into, so while a room is open in their class Home offers the way in.
/// Nothing running (or live quizzes switched off), nothing drawn.
struct LiveQuizRunningCard: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var running: [LiveQuizSummary] = []

    var body: some View {
        VStack(spacing: 0) {
            if let room = running.first {
                VStack(alignment: .leading, spacing: 14) {
                    CardHeading(
                        icon: "dot.radiowaves.left.and.right",
                        title: running.count == 1 ? "A live quiz is on" : "\(running.count) live quizzes are on",
                        subtitle: running.count == 1
                            ? "\(room.classroomName) · \(room.title). Join with the code on the board."
                            : "In your classes. Join with the code on the board."
                    )
                    NavigationLink(value: AppLink.liveQuiz(sessionId: nil)) { Text("Join the quiz") }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                }
                .cardStyle(padding: 18)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: refreshID) {
            let rooms = (try? await LiveQuizAPI(client: session.client).mine()) ?? []
            running = rooms.filter { $0.status != .finished && $0.status != .terminated }
        }
    }
}
```

At the end of `Support/PageChrome.swift` (unchanged, used by eleven screens):

```swift

// MARK: - Retry

struct RetryNotice: View {
    let message: String
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Theme.warning)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}
```

Then delete the old files: `git rm ios/MasterSAT/Sources/Screens/DashboardView.swift ios/MasterSAT/Sources/Screens/HomePulse.swift`. (`TargetScoresCard`, `CountdownCard`, `HomePulse` and `PulseChip` go with them: the Me sheet's Overview already shows the goal and picks the SAT date; XP and the streak are in every header.)

- [ ] **Step 2: Create `Screens/Shell/WorkRow.swift`**

```swift
import SwiftUI
import MasterSATKit

/// One thing to do — a homework still owed, or one of today's lessons. Today's Up next and the
/// Class tab's To do share it, so a piece of work looks the same wherever it is met.
struct WorkRow: View {
    let item: WorkItem

    private var visual: (icon: String, tone: Color) {
        switch item.look {
        case .quiz: return ("square.and.pencil", Theme.success)
        case .words: return ("character.book.closed.fill", Theme.subjectWords)
        case .paper: return ("doc.text", Theme.info)
        case .handIn: return ("tray.and.arrow.up.fill", Theme.accent)
        case .lesson: return ("person.2.fill", Theme.accent)
        case .exam: return ("list.clipboard.fill", Theme.amber)
        }
    }

    /// "Due Thu", "Catch up · Tue" — or, for a lesson, its time today.
    private var when: (text: String, late: Bool)? {
        switch item.source {
        case .homework:
            return DueLabel.text(item.dueAt)
        case .lesson(let event):
            let time = event.time.isEmpty ? "Today" : "Today · \(event.time)"
            return (item.look == .exam ? "\(time) · sat on a computer" : time, false)
        }
    }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: visual.icon, tone: visual.tone, size: 42)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                if when != nil || item.xpCap != nil {
                    HStack(spacing: 8) {
                        if let when {
                            // A passed deadline is information, never an accusation.
                            Text(when.text)
                                .font(.system(size: 12, weight: when.late ? .heavy : .semibold))
                                .foregroundStyle(when.late ? Theme.warning : Theme.textSecondary)
                        }
                        if let cap = item.xpCap { XPCapChip(amount: cap) }
                    }
                }
            }
            Spacer(minLength: 0)
            if item.assignment != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// "up to +15 XP" — the most this homework can pay, read off the live rule.
struct XPCapChip: View {
    let amount: Int

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "bolt.fill").font(.system(size: 9, weight: .black))
            Text("up to +\(amount) XP").font(.system(size: 11, weight: .heavy, design: .rounded))
        }
        .foregroundStyle(Theme.amber)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Theme.amberSoft))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Worth up to \(amount) XP")
    }
}
```

- [ ] **Step 3: Create `Screens/Today/TodayCards.swift`**

```swift
import SwiftUI
import MasterSATKit

private struct HeroBounce { var scale = 1.0 }

/// This week's homework as a ring: done against all of it. It draws itself in on arrival,
/// moves when work is handed in, and bounces when the week is done.
struct TodayHero: View {
    let progress: TodayPlan.Progress
    let loaded: Bool
    /// Bumped by Today when the week has just been finished.
    let bounce: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = 0.0

    private var tone: Color { progress.isComplete ? Theme.success : Theme.accent }

    private var headline: String {
        if !loaded { return "This week" }
        if progress.total == 0 { return "Nothing due this week" }
        if progress.isComplete { return "All done this week" }
        return "\(progress.total - progress.done) to go this week"
    }

    private var subline: String {
        if !loaded || progress.total == 0 { return "Homework due by Sunday shows up here." }
        return "\(progress.done) of \(progress.total) handed in"
    }

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                Circle().stroke(tone.opacity(0.14), lineWidth: 11)
                Circle()
                    .trim(from: 0, to: drawn)
                    .stroke(tone, style: StrokeStyle(lineWidth: 11, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if progress.isComplete {
                    Image(systemName: "checkmark")
                        .font(.system(size: 26, weight: .heavy))
                        .foregroundStyle(tone)
                } else {
                    Text(loaded && progress.total > 0 ? "\(progress.done)/\(progress.total)" : "—")
                        .font(.system(size: 20, weight: .heavy, design: .rounded).monospacedDigit())
                        .contentTransition(.numericText())
                }
            }
            .frame(width: 88, height: 88)
            .keyframeAnimator(initialValue: HeroBounce(), trigger: bounce) { content, value in
                content.scaleEffect(value.scale)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    SpringKeyframe(1.16, duration: 0.18, spring: .snappy)
                    SpringKeyframe(1.0, duration: 0.55, spring: .bouncy(duration: 0.55, extraBounce: 0.3))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("THIS WEEK")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(Theme.textLabel)
                Text(headline)
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .fixedSize(horizontal: false, vertical: true)
                Text(subline)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .cardStyle(padding: 18)
        .onAppear { draw(progress.fraction) }
        .onChange(of: progress) { _, now in draw(now.fraction) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("This week: \(headline). \(subline)")
    }

    private func draw(_ fraction: Double) {
        guard drawn != fraction else { return }
        withAnimation(reduceMotion ? Motion.focus : Motion.bouncy) { drawn = fraction }
    }
}

/// Nothing owed and nothing left today. The check is still until phase 5 brings an all-done
/// Lottie of its own.
struct AllDoneCard: View {
    var body: some View {
        VStack(spacing: 10) {
            LottieClip(.taskComplete, playback: .still)
                .frame(width: 84, height: 84)
            Text("You're all caught up")
                .font(.system(size: 17, weight: .heavy, design: .rounded))
            Text("New work from your teachers shows up here.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .cardStyle(padding: 20)
    }
}

/// A midterm score released since the student last looked — until it is opened or put off.
struct FreshResultCard: View {
    let midterm: MidtermListing
    let onOpen: @MainActor () -> Void
    let onLater: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeading(icon: "rosette", title: "Your result is in", subtitle: midterm.title, tone: Theme.success)
            if let score = midterm.score {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ScoreText.string(score))
                        .font(.system(size: 32, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("of \(ScoreText.string(ceiling))")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            HStack(spacing: 10) {
                Button("See your report", action: onOpen)
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                Button("Later", action: onLater)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .cardStyle(padding: 18)
    }
}

/// The SAT date, compact. Setting it lives in the Me sheet, which this opens.
struct SATCountdownRow: View {
    let examDate: String?
    let onOpen: @MainActor () -> Void

    private var day: ProfileGoal.TestDay { ProfileGoal.testDay(examDate) }

    private var title: String {
        if let unit = day.unit { return "SAT · \(day.value) \(unit)" }
        if day.value == "Today" { return "SAT · it's exam day" }
        return "Your SAT date"
    }

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                IconTile(systemName: "calendar", tone: Theme.accentDeep, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(.primary)
                    Text(day.detail)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressBounce())
        .accessibilityHint("Opens your profile, where the SAT date is set")
    }
}
```

- [ ] **Step 4: Create `Screens/Today/TodayView.swift`**

```swift
import SwiftUI
import MasterSATKit

/// Today — what to do now, across every class: how much of this week's homework is in, what is
/// up next (catching up first, then by deadline, then today's lessons), and the few things the
/// learning center wants seen today — stories, a live quiz, a fresh result, a survey.
///
/// The goal and the SAT date are set in the Me sheet (the countdown here opens it); the full
/// lesson calendar is Class → Schedule. A tab root: every push is a value resolved here.
struct TodayView: View {
    /// Pages this root pushes that no `AppLink` names.
    enum Route: Hashable {
        case midtermReport(attemptId: Int, title: String)
    }

    /// How many homework rows Up next shows before "See all".
    private static let upNextLimit = 6

    let user: CurrentUser
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    @State private var todayEvents: [ScheduleEvent] = []
    @State private var homeworkXP: Int?
    @State private var loadError: String?
    @State private var hasLoaded = false
    @State private var seenResults: Set<Int> = []
    @State private var lastWeek: TodayPlan.Progress?
    @State private var heroBounce = 0
    @State private var promptDismissed = false
    /// Bumped by pull-to-refresh, so the pieces that load themselves reload with the page.
    @State private var refreshTick = 0
    @State private var shown = false
    @Namespace private var zoom

    private var plan: TodayPlan {
        TodayPlan(assignments: assignments, events: todayEvents, homeworkXP: homeworkXP)
    }

    private var freshResult: MidtermListing? { TodayPlan.freshResult(midterms, seen: seenResults) }

    private var seenKey: String { "today.seenResults.\(user.id)" }

    private var rowAnimation: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    /// Only asked once iOS has confirmed it has not asked yet, and only when there is something
    /// real to be reminded about.
    private var showsReminderPrompt: Bool {
        !promptDismissed
            && session.notifications.permission == .notAsked
            && (!plan.homework.isEmpty || midterms.contains { !$0.submitted })
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .today) {
                VStack(alignment: .leading, spacing: 18) {
                    AppHeader(
                        title: "Today",
                        subtitle: Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)),
                        showsBell: true
                    )
                    .stagger(0, shown: shown)

                    // The learning center's noticeboard, above everything the student owns.
                    StoriesRail(refreshID: refreshTick)
                    LiveQuizRunningCard(refreshID: refreshTick)

                    if session.releaseGate.showsNudge {
                        UpdateNudgeCard(config: session.releaseGate.config) {
                            withAnimation { session.releaseGate.dismissNudge() }
                        }
                    }

                    TodayHero(progress: plan.week, loaded: hasLoaded, bounce: heroBounce)
                        .stagger(1, shown: shown)

                    upNext.stagger(2, shown: shown)

                    if let result = freshResult, let attemptId = result.attemptId {
                        FreshResultCard(
                            midterm: result,
                            onOpen: {
                                markSeen(attemptId)
                                // A root push: a second tap while the first is in flight stacks nothing.
                                guard path.isEmpty else { return }
                                path.append(Route.midtermReport(attemptId: attemptId, title: result.title))
                            },
                            onLater: { withAnimation(rowAnimation) { markSeen(attemptId) } }
                        )
                        .transition(rowTransition)
                    }

                    SurveysWaitingCard(refreshID: refreshTick)

                    SATCountdownRow(examDate: user.satExamDate) { router.openMe() }
                        .stagger(3, shown: shown)

                    if showsReminderPrompt {
                        ReminderPromptCard(
                            onEnable: {
                                Task {
                                    await session.notifications.requestPermission()
                                    await session.notifications.reschedule(assignments: assignments, midterms: midterms)
                                }
                            },
                            onDismiss: { promptDismissed = true }
                        )
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable {
                refreshTick += 1
                await load()
            }
            // Not `.task`: a TabView never tears its tabs down, so a task would load once per
            // launch. This runs on every return to the tab and every pop back to the root.
            .onAppear {
                shown = true
                loadSeen()
                Task { await load() }
            }
            .navigationDestination(for: AssignmentListing.self) { assignment in
                HomeworkDetailView(assignment: assignment).zoomDestination(id: assignment.id, in: zoom)
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .midtermReport(let attemptId, let title):
                    MidtermReportView(attemptId: attemptId, title: title)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
        }
    }

    // MARK: - Up next

    @ViewBuilder
    private var upNext: some View {
        let next = plan.upNext(limit: Self.upNextLimit)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                DotHeading(title: "Up next", count: hasLoaded ? plan.homework.count + plan.lessons.count : nil)
                if next.more > 0 {
                    Button("See all") { router.show(.classes) }
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            if !hasLoaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if let loadError, assignments.isEmpty {
                // A failed load is never "all caught up".
                RetryNotice(message: loadError) { await load() }
            } else if plan.isAllClear {
                AllDoneCard()
            } else {
                ForEach(next.items) { item in
                    row(item).transition(rowTransition)
                }
            }
        }
        .animation(rowAnimation, value: next.items.map(\.id))
    }

    @ViewBuilder
    private func row(_ item: WorkItem) -> some View {
        if let assignment = item.assignment {
            NavigationLink(value: assignment) { WorkRow(item: item) }
                .buttonStyle(PressBounce())
                .zoomSource(id: assignment.id, in: zoom)
        } else {
            // A lesson is information: there is nothing deeper to open on a phone.
            WorkRow(item: item)
        }
    }

    // MARK: - Fresh result

    private func loadSeen() {
        let stored = Set(UserDefaults.standard.array(forKey: seenKey) as? [Int] ?? [])
        if stored != seenResults { seenResults = stored }
    }

    private func markSeen(_ attemptId: Int) {
        guard !seenResults.contains(attemptId) else { return }
        seenResults.insert(attemptId)
        UserDefaults.standard.set(Array(seenResults).sorted(), forKey: seenKey)
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let student = session.student
        let rewardsAPI = session.rewards
        let now = Date.now
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        async let events = student.schedule(from: now, to: now)
        do {
            let freshHomework = try await homework
            let freshPapers = try await papers
            withAnimation(rowAnimation) {
                assignments = freshHomework
                midterms = freshPapers
            }
            loadError = nil
            // Today is opened most, so it keeps the device's reminders in step with the work.
            await session.notifications.reschedule(assignments: freshHomework, midterms: freshPapers)
            await session.notifications.announceResults(midterms: freshPapers)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        // The XP labels and today's lessons are extras: losing either never takes the page down.
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        if let fresh = try? await events { todayEvents = fresh }
        hasLoaded = true
        celebrateIfWeekJustFinished()
    }

    /// The week's last homework just went in: double confetti, and the ring bounces.
    private func celebrateIfWeekJustFinished() {
        let week = plan.week
        if TodayPlan.justFinished(previous: lastWeek, current: week) {
            celebrations.allDone()
            if !reduceMotion { heroBounce += 1 }
        }
        lastWeek = week
    }
}
```

- [ ] **Step 5: Today is the Today tab — `Screens/RootView.swift`**

Replace `DashboardView(user: user, path: $router.today)` with `TodayView(user: user, path: $router.today)`.

- [ ] **Step 6: Build and check nothing is left behind**

Run the build check. Expected `exit=0` and `** BUILD SUCCEEDED **`. Then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
grep -rnwE "DashboardView|HomePulse|PulseChip|TargetScoresCard|CountdownCard" Sources || echo "no leftovers"
```
→ `no leftovers` (`MidtermCountdownCard` is a different, whole word).

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Today/TodayView.swift ios/MasterSAT/Sources/Screens/Today/TodayCards.swift \
        ios/MasterSAT/Sources/Screens/Shell/WorkRow.swift ios/MasterSAT/Sources/Screens/Profile/GoalSheet.swift \
        ios/MasterSAT/Sources/Screens/LiveQuiz/LiveQuizRunningCard.swift ios/MasterSAT/Sources/Support/PageChrome.swift \
        ios/MasterSAT/Sources/Screens/RootView.swift
git status --short   # DashboardView.swift and HomePulse.swift staged as D; nothing else unexpected
git commit -m "feat(ios): Today — this week's ring, Up next across every class, catch-up first

The goal and the SAT date live in the Me sheet (the countdown opens it); the lesson
calendar moves to Class.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Class — chips, class cards, Tasks and Schedule

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Shell/SegmentBar.swift`
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassView.swift`
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassCards.swift`
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassTasksSegment.swift`
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassScheduleSegment.swift`
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/HomeworkListView.swift` (the unused list goes; `HomeworkRow` stays)
- Delete: `ios/MasterSAT/Sources/Screens/Shell/ClassHubView.swift`

**Interfaces:**
- Consumes: `ClassFilter`, `ClassTasks`, `TodayPlan.homeworkXP`, `HomeworkProgress`, `ProfileClasses.memberships`, `ProfileClasses.scheduleLine`, `ProfileLessons.next(in:classroomId:hours:)`, `ProfileLessons.label(_:)`, `ClassroomSchedule.roomLabel`, `TelegramGroupButton.resolve(state:classroomGroupURL:)`, `ClassroomTelegramAPI(client:).state(classroomId:)`, `LiveQuizAPI(client:).mine()`, `MidtermWording.subjectLabel`, `MidtermListing.releasedScore` (kit); `TabRootScroll`, `zoomSource`/`zoomDestination` (Task 14); `WorkRow` (Task 15); existing `PillTabs`, `HubCard`, `HomeworkRow`, `SubjectStyle.of(_:)`, `ScheduleMonth`, `LessonCalendarCard(month:year:monthIndex:selected:)`, `SelectedDayCard(dayKey:events:onOpen:)`, `DayKey`, `ClassroomErrorState`, `JoinClassSheet(onJoined:)`, `ClassroomTelegramSheet(classroomId:className:initialState:onChange:)`, `AssessmentReviewView(attemptId:homeworkId:)`, `MidtermReportView(attemptId:title:)`, `HomeworkDetailView(assignment:)`, `AppLinkPage`.
- Produces: `struct SegmentBar<Segment: Hashable>: View { struct Item { segment; title }; init(items:selection:) }`; `struct ClassView: View { init(path: Binding<NavigationPath>); enum Segment { tasks, schedule }; enum Route { assessmentReview(attemptId:homeworkId:), midtermReport(attemptId:title:) } }`; `ClassLessonCard(room:next:telegram:liveQuizOn:onTelegram:)`; `enum ClassTaskFilter { toDo, done, results }`; `ClassTasksSegment(tasks:filter:zoom:)`, `AssessmentResultRow(entry:opens:)`, `MidtermResultRow(midterm:opens:)`; `ClassScheduleSegment(classIds:assignments:refreshID:path:)`.

- [ ] **Step 1: Create `Screens/Shell/SegmentBar.swift`**

```swift
import SwiftUI
import MasterSATKit

/// Equal segments under a sliding capsule — the Class tab's Tasks · Schedule · People · Files.
/// Chips (`PillTabs`) narrow what is shown; this switches what kind of thing is shown.
struct SegmentBar<Segment: Hashable>: View {
    struct Item: Identifiable {
        let segment: Segment
        let title: String
        var id: Segment { segment }
    }

    let items: [Item]
    @Binding var selection: Segment

    @Namespace private var pill
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                let active = item.segment == selection
                Button {
                    guard !active else { return }
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { selection = item.segment }
                } label: {
                    Text(item.title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(active ? Color.primary : Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background {
                            if active {
                                Capsule()
                                    .fill(Theme.card)
                                    .shadow(color: .black.opacity(0.08), radius: 4, y: 1)
                                    .matchedGeometryEffect(id: "segment", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(PressBounce())
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surface2, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
    }
}
```

- [ ] **Step 2: Create `Screens/Class/ClassCards.swift`**

```swift
import SwiftUI
import MasterSATKit

/// One class: its next lesson, a way into its Telegram group, and the live quiz running in it.
/// The card opens the full class page, which keeps the class's Classwork and Overview.
struct ClassLessonCard: View {
    let room: Classroom
    let next: ProfileLessons.Next?
    let telegram: TelegramGroupButton
    let liveQuizOn: Bool
    let onTelegram: @MainActor () -> Void

    private var tone: Color { room.isMath ? Theme.subjectMath : Theme.subjectEnglish }

    private var lessonLine: String {
        guard let next else { return ProfileClasses.scheduleLine(room) }
        let place = ClassroomSchedule.roomLabel(room.roomNumber)
        let when = next.live ? "Lesson on now" : "Next lesson · \(ProfileLessons.label(next))"
        return place.isEmpty ? when : "\(when) · \(place)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: AppLink.classroom(id: room.id)) {
                HStack(spacing: 12) {
                    IconTile(systemName: room.isMath ? "function" : "book.closed.fill", tone: tone, size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(room.name)
                            .font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Text(lessonLine)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(next?.live == true ? Theme.success : Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textLabel)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressBounce())
            .accessibilityHint("Opens the class page")

            if liveQuizOn || telegram.title != nil {
                HStack(spacing: 10) {
                    if liveQuizOn {
                        // No join by room id exists: the join screen lists the rooms and takes the code.
                        NavigationLink(value: AppLink.liveQuiz(sessionId: nil)) {
                            Label("Join live quiz", systemImage: "dot.radiowaves.left.and.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle(tone: Theme.warning, fullWidth: true))
                    }
                    if let title = telegram.title {
                        Button(action: onTelegram) {
                            Label(title, systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                    }
                }
            }
        }
        .cardStyle(padding: 16)
    }
}
```

- [ ] **Step 3: Create `Screens/Class/ClassTasksSegment.swift`**

```swift
import SwiftUI
import MasterSATKit

/// Which list the Tasks segment shows.
enum ClassTaskFilter: Hashable { case toDo, done, results }

/// To do · Done · Results for the classes under the chip. Every row pushes a value resolved at
/// the Class root.
struct ClassTasksSegment: View {
    let tasks: ClassTasks
    @Binding var filter: ClassTaskFilter
    let zoom: Namespace.ID

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var motion: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var rowTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    private var items: [PillTabs<ClassTaskFilter>.Item] {
        [
            .init(tab: .toDo, title: "To do", icon: "tray",
                  count: tasks.toDo.isEmpty ? nil : tasks.toDo.count, highlighted: !tasks.toDo.isEmpty),
            .init(tab: .done, title: "Done", icon: "checkmark.circle",
                  count: tasks.done.isEmpty ? nil : tasks.done.count),
            .init(tab: .results, title: "Results", icon: "chart.bar.fill",
                  count: tasks.resultsCount == 0 ? nil : tasks.resultsCount),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PillTabs(items: items, selection: $filter)
            switch filter {
            case .toDo: toDo
            case .done: done
            case .results: results
            }
            // The board and the midterm page keep what the merged tab does not repeat: search by
            // subject and domain, the dates of papers still to come, and certificates.
            VStack(spacing: 10) {
                HubCard(title: "Assessment board", subtitle: "Every quiz, by subject and SAT domain, with search",
                        icon: "square.and.pencil", tone: Theme.success, route: AppLink.assessments)
                HubCard(title: "Midterms", subtitle: "When the next one is, your scores and certificates",
                        icon: "calendar.badge.clock", tone: Theme.amber, route: AppLink.midterms)
            }
            .padding(.top, 6)
        }
    }

    @ViewBuilder
    private var toDo: some View {
        if tasks.toDo.isEmpty {
            DashedEmpty(title: "Nothing to do here", hint: "New work from your teachers shows up here.")
        } else {
            VStack(spacing: 10) {
                ForEach(tasks.toDo) { item in
                    if let assignment = item.assignment {
                        NavigationLink(value: assignment) { WorkRow(item: item) }
                            .buttonStyle(PressBounce())
                            .zoomSource(id: assignment.id, in: zoom)
                            .transition(rowTransition)
                    }
                }
            }
            .animation(motion, value: tasks.toDo.map(\.id))
        }
    }

    @ViewBuilder
    private var done: some View {
        if tasks.done.isEmpty {
            DashedEmpty(title: "Nothing handed in yet", hint: "Work you hand in lands here.")
        } else {
            VStack(spacing: 10) {
                ForEach(tasks.done) { assignment in
                    NavigationLink(value: assignment) { HomeworkRow(assignment: assignment).cardStyle() }
                        .buttonStyle(PressBounce())
                        .zoomSource(id: assignment.id, in: zoom)
                        .transition(rowTransition)
                }
            }
            .animation(motion, value: tasks.done.map(\.id))
        }
    }

    @ViewBuilder
    private var results: some View {
        if tasks.resultsCount == 0 {
            DashedEmpty(title: "No results yet", hint: "Marked quizzes and midterm scores land here.")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if !tasks.assessmentResults.isEmpty {
                    DotHeading(title: "Assessments", count: tasks.assessmentResults.count, tone: Theme.success)
                    ForEach(tasks.assessmentResults) { entry in
                        if let attemptId = entry.progress?.attemptId {
                            NavigationLink(value: ClassView.Route.assessmentReview(attemptId: attemptId, homeworkId: entry.link.homeworkId)) {
                                AssessmentResultRow(entry: entry, opens: true)
                            }
                            .buttonStyle(PressBounce())
                        } else {
                            AssessmentResultRow(entry: entry, opens: false)
                        }
                    }
                }
                if !tasks.midtermResults.isEmpty {
                    DotHeading(title: "Midterms", count: tasks.midtermResults.count, tone: Theme.amber)
                        .padding(.top, tasks.assessmentResults.isEmpty ? 0 : 8)
                    ForEach(tasks.midtermResults) { midterm in
                        if let attemptId = midterm.attemptId {
                            // The report carries the score, the certificate and the skills to work on.
                            NavigationLink(value: ClassView.Route.midtermReport(attemptId: attemptId, title: midterm.title)) {
                                MidtermResultRow(midterm: midterm, opens: true)
                            }
                            .buttonStyle(PressBounce())
                        } else {
                            MidtermResultRow(midterm: midterm, opens: false)
                        }
                    }
                }
            }
        }
    }
}

/// A quiz handed in: its percent once marked, "Being marked" until then.
struct AssessmentResultRow: View {
    let entry: AssessmentBoardEntry
    let opens: Bool

    private var style: SubjectStyle.Style { SubjectStyle.of(entry.subject) }

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: style.icon, tone: style.tone, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text([entry.classroomName, style.label].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            if entry.state == .completed, entry.progress?.graded == true, let percent = entry.progress?.percent {
                Text("\(percent)%")
                    .font(.system(size: 20, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle(Theme.success)
            } else {
                Chip(text: "Being marked", icon: "clock", tone: .neutral)
            }
            if opens {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
    }
}

/// A midterm sat: its score once the teacher has released it — named, never blank, until then.
struct MidtermResultRow: View {
    let midterm: MidtermListing
    let opens: Bool

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: "calendar.badge.clock", tone: Theme.amber, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(midterm.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                let subject = MidtermWording.subjectLabel(midterm.subject)
                if !subject.isEmpty {
                    Text(subject)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if let score = midterm.releasedScore {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(ScoreText.string(score))
                        .font(.system(size: 20, weight: .heavy, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    if let ceiling = midterm.scoreCeiling {
                        Text("of \(ScoreText.string(ceiling))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            } else {
                Chip(text: "Not released", icon: "hourglass", tone: .warning)
            }
            if opens {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .cardStyle(padding: 14)
        .contentShape(Rectangle())
    }
}
```

- [ ] **Step 4: Create `Screens/Class/ClassScheduleSegment.swift`**

```swift
import SwiftUI
import MasterSATKit

/// The lesson calendar — moved here from Today — for the classes under the chip.
struct ClassScheduleSegment: View {
    /// The classes to show; nil under All, which also shows events tied to no class (mocks).
    let classIds: Set<Int>?
    /// The student's homework, so a homework day opens that homework.
    let assignments: [AssignmentListing]
    /// Bumped by the Class tab's pull-to-refresh.
    let refreshID: Int
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @State private var events: [ScheduleEvent] = []
    @State private var viewYear = Calendar(identifier: .gregorian).component(.year, from: Date())
    @State private var viewMonth = Calendar(identifier: .gregorian).component(.month, from: Date())
    @State private var selectedDay: String?
    @State private var isLoading = true
    @State private var failed = false

    private var month: ScheduleMonth {
        ScheduleMonth.build(from: events.filter { event in
            guard let classIds else { return true }
            return event.classroomId.map(classIds.contains) ?? false
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LessonCalendarCard(month: month, year: $viewYear, monthIndex: $viewMonth, selected: $selectedDay)
                .overlay(alignment: .topTrailing) {
                    if isLoading { ProgressView().padding(18) }
                }
            if failed {
                Label("The calendar didn't load just now. Pull down to try again.", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            SelectedDayCard(dayKey: selectedDay, events: month.byDate[selectedDay ?? ""] ?? [], onOpen: open)
        }
        .task(id: "\(viewYear)-\(viewMonth)-\(refreshID)") { await load() }
    }

    /// A homework day opens that homework. Pushed from the Class root, so a second tap while the
    /// first push is in flight must not stack a second page.
    private func open(_ event: ScheduleEvent) {
        guard path.isEmpty,
              let id = event.assignmentId,
              let assignment = assignments.first(where: { $0.id == id }) else { return }
        path.append(assignment)
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let (start, end) = ScheduleMonth.gridRange(year: viewYear, month: viewMonth)
        do {
            events = try await session.student.schedule(from: start, to: end)
            failed = false
            // Land on the next lesson the first time, so the day card is never empty on arrival.
            if selectedDay == nil { selectedDay = month.nextLessonDate ?? DayKey.string(Date()) }
        } catch {
            failed = true
        }
    }
}
```

- [ ] **Step 5: Create `Screens/Class/ClassView.swift`**

```swift
import SwiftUI
import MasterSATKit

/// The Class tab — every class the student is in, together.
///
/// Chips narrow it to a subject (or, with two classes of one subject, to one class); one class
/// has no chips. Under them, each class's next lesson with its Telegram group and a live quiz to
/// join, then the segments. A tab root: every row pushes a VALUE resolved here, so re-tapping
/// the tab pops it.
struct ClassView: View {
    enum Segment: Hashable { case tasks, schedule }

    /// Pages this root pushes that no `AppLink` names.
    enum Route: Hashable {
        case assessmentReview(attemptId: Int, homeworkId: Int)
        case midtermReport(attemptId: Int, title: String)
    }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var classrooms: [Classroom] = []
    @State private var classesError: String?
    @State private var hasLoaded = false
    @State private var assignments: [AssignmentListing] = []
    @State private var midterms: [MidtermListing] = []
    /// The next two weeks of lessons, for the class cards. The calendar loads its own month.
    @State private var upcoming: [ScheduleEvent] = []
    @State private var liveRooms: [LiveQuizSummary] = []
    @State private var telegram: [Int: TelegramGroupState] = [:]
    @State private var homeworkXP: Int?
    @State private var chip = ClassFilter.allID
    @State private var segment: Segment = .tasks
    @State private var taskFilter: ClassTaskFilter = .toDo
    @State private var telegramClass: Classroom?
    @State private var joining = false
    @State private var refreshTick = 0
    @State private var shown = false
    @Namespace private var zoom

    private var filter: ClassFilter { ClassFilter(classrooms: classrooms) }
    private var activeChip: String { filter.resolvedID(chip) }
    private var visibleClasses: [Classroom] { filter.classes(for: activeChip) }

    private var tasks: ClassTasks {
        ClassTasks(assignments: assignments, midterms: midterms, filter: filter, chipID: activeChip, homeworkXP: homeworkXP)
    }

    private var motion: Animation { reduceMotion ? Motion.focus : Motion.snappy }

    private var cardTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.92).combined(with: .opacity)
    }

    private var chipItems: [PillTabs<String>.Item] {
        filter.chips.map { chip in
            let open = assignments.filter {
                filter.includes(classroomId: $0.classroomId, chipID: chip.id) && !HomeworkProgress.isDone($0)
            }.count
            let icon = chip.subject == .math ? "function" : chip.subject == .english ? "book.closed" : "square.grid.2x2"
            return PillTabs<String>.Item(tab: chip.id, title: chip.label, icon: icon, count: open > 0 ? open : nil)
        }
    }

    private var segmentItems: [SegmentBar<Segment>.Item] {
        [
            .init(segment: .tasks, title: "Tasks"),
            .init(segment: .schedule, title: "Schedule"),
        ]
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .classes) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Class").stagger(0, shown: shown)
                    content
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable {
                refreshTick += 1
                await load()
            }
            // Not `.task`: a TabView never tears its tabs down.
            .onAppear {
                shown = true
                Task { await load() }
            }
            .navigationDestination(for: AssignmentListing.self) { assignment in
                HomeworkDetailView(assignment: assignment).zoomDestination(id: assignment.id, in: zoom)
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .assessmentReview(let attemptId, let homeworkId):
                    AssessmentReviewView(attemptId: attemptId, homeworkId: homeworkId)
                case .midtermReport(let attemptId, let title):
                    MidtermReportView(attemptId: attemptId, title: title)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .sheet(item: $telegramClass, onDismiss: { Task { await loadTelegram() } }) { room in
                ClassroomTelegramSheet(classroomId: room.id, className: room.name, initialState: telegram[room.id]) { state in
                    telegram[room.id] = state
                }
            }
            .sheet(isPresented: $joining) {
                JoinClassSheet { _ in Task { await load() } }
                    .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !hasLoaded && classrooms.isEmpty {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
        } else if let classesError, classrooms.isEmpty {
            // A failed load is never "no classes yet".
            ClassroomErrorState(
                title: "Couldn't load your classes",
                message: "Something went wrong on our end. Check your connection and try again."
            ) { await load() }
            .accessibilityHint(classesError)
        } else if classrooms.isEmpty {
            VStack(spacing: 12) {
                DashedEmpty(title: "No classes yet", hint: "Have a class code? Join now to get started.")
                Button("Join with a code") { joining = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
        } else {
            if !filter.chips.isEmpty {
                PillTabs(items: chipItems, selection: $chip).stagger(1, shown: shown)
            }

            VStack(spacing: 12) {
                ForEach(visibleClasses) { room in
                    ClassLessonCard(
                        room: room,
                        next: ProfileLessons.next(in: upcoming, classroomId: room.id, hours: room.lessonHours),
                        telegram: TelegramGroupButton.resolve(state: telegram[room.id], classroomGroupURL: room.telegramGroupURL),
                        liveQuizOn: liveRooms.contains { $0.classroomId == room.id },
                        onTelegram: { openTelegram(room) }
                    )
                    .transition(cardTransition)
                }
            }
            .animation(motion, value: visibleClasses.map(\.id))
            .stagger(2, shown: shown)

            SegmentBar(items: segmentItems, selection: $segment)
                .stagger(3, shown: shown)

            Group {
                switch segment {
                case .tasks:
                    ClassTasksSegment(tasks: tasks, filter: $taskFilter, zoom: zoom)
                case .schedule:
                    ClassScheduleSegment(
                        classIds: activeChip == ClassFilter.allID ? nil : Set(visibleClasses.map(\.id)),
                        assignments: assignments,
                        refreshID: refreshTick,
                        path: $path
                    )
                }
            }
            .stagger(4, shown: shown)

            Button { joining = true } label: {
                Label("Join another class", systemImage: "person.badge.plus")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PressBounce())
            .padding(.top, 4)
        }
    }

    private func openTelegram(_ room: Classroom) {
        switch TelegramGroupButton.resolve(state: telegram[room.id], classroomGroupURL: room.telegramGroupURL) {
        case .join: telegramClass = room
        case .link(let raw): if let url = URL(string: raw) { openURL(url) }
        case .none: break
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        let classroomsAPI = session.classrooms
        let student = session.student
        let rewardsAPI = session.rewards
        let live = LiveQuizAPI(client: session.client)
        let start = Date.now
        let end = Calendar.current.date(byAdding: .day, value: 14, to: start) ?? start
        async let rooms = classroomsAPI.classrooms()
        async let homework = student.assignments()
        async let papers = student.midterms()
        async let rules = rewardsAPI.rules()
        async let lessons = student.schedule(from: start, to: end)
        async let quizzes = live.mine()
        do {
            // A removed student's row still comes back from /classes/ with no role.
            let fresh = ProfileClasses.memberships(try await rooms)
            withAnimation(motion) { classrooms = fresh }
            classesError = nil
        } catch let error as APIError {
            classesError = error.errorDescription ?? "Couldn't load your classes."
        } catch {
            classesError = error.localizedDescription
        }
        // Each of the rest fails on its own and keeps what was on screen.
        if let fresh = try? await homework { withAnimation(motion) { assignments = fresh } }
        if let fresh = try? await papers { midterms = fresh }
        if let fresh = try? await rules { homeworkXP = TodayPlan.homeworkXP(fresh) }
        if let fresh = try? await lessons { upcoming = fresh }
        if let fresh = try? await quizzes {
            liveRooms = fresh.filter { $0.status != .finished && $0.status != .terminated }
        }
        hasLoaded = true
        if chip != ClassFilter.allID, filter.chip(chip) == nil { chip = ClassFilter.allID }
        await loadTelegram()
    }

    /// A failed lookup leaves the button on the class's static link, which still works.
    @MainActor
    private func loadTelegram() async {
        let api = ClassroomTelegramAPI(client: session.client)
        for room in classrooms {
            if let state = try? await api.state(classroomId: room.id), telegram[room.id] != state {
                telegram[room.id] = state
            }
        }
    }
}
```

- [ ] **Step 6: Class is the Class tab; the old pieces go**

1. `Screens/RootView.swift`: replace `ClassHubView(path: $router.classes)` with `ClassView(path: $router.classes)`.
2. `git rm ios/MasterSAT/Sources/Screens/Shell/ClassHubView.swift`
3. `Screens/HomeworkListView.swift`: delete `struct HomeworkListView` — everything from its doc comment `/// Everything set, grouped by class — the site's assignment list.` down to (not including) `struct HomeworkRow: View {`. Nothing pushes it any more (it was only `ClassHubView`'s Homework card); `HomeworkRow` and the `AssignmentListing: Hashable` extension stay.

- [ ] **Step 7: Build and check**

Run the build check. Expected `exit=0` and `** BUILD SUCCEEDED **`. Then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
grep -rnw "ClassHubView\|HomeworkListView" Sources || echo "no leftovers"
```
→ `no leftovers` (the comment in `HomeworkListView.swift` that named `ClassHubView` went with the struct).

- [ ] **Step 8: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Shell/SegmentBar.swift ios/MasterSAT/Sources/Screens/Class/ClassView.swift \
        ios/MasterSAT/Sources/Screens/Class/ClassCards.swift ios/MasterSAT/Sources/Screens/Class/ClassTasksSegment.swift \
        ios/MasterSAT/Sources/Screens/Class/ClassScheduleSegment.swift ios/MasterSAT/Sources/Screens/RootView.swift \
        ios/MasterSAT/Sources/Screens/HomeworkListView.swift
git status --short   # ClassHubView.swift staged as D; nothing else unexpected
git commit -m "feat(ios): Class — every class together, chips by subject, next lessons, Tasks and Schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Class — People and Files

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassSectionsModel.swift`
- Create: `ios/MasterSAT/Sources/Screens/Class/ClassPeopleFilesSegments.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Class/ClassView.swift`

**Interfaces:**
- Consumes: `ClassroomAPI.rankings(classroomId:)`, `.people(classroomId:)`, `.materials(classroomId:)` (kit); existing `ClassroomLoad<Value>` (`Classroom/ClassroomDetailView.swift`), `ClassroomRankingsSection(load:isStudent:retry:)`, `ClassroomPeopleSection(load:retry:)`, `ClassroomMaterialsSection(load:retry:)` (`Classroom/ClassroomSections.swift`).
- Produces: `@MainActor @Observable final class ClassSectionsModel { func board(_:), members(_:), files(_:) -> ClassroomLoad<…>; func loadPeople(for:api:refreshID:) async; func loadFiles(for:api:refreshID:) async; func loadBoard(_:api:force:), loadMembers(_:api:force:), loadMaterials(_:api:force:) async }`; `ClassPeopleSegment(classes:model:refreshID:)`, `ClassFilesSegment(classes:model:refreshID:)`, `ClassGroupHeading(room:)`; `ClassView.Segment` gains `.people`, `.files`.

- [ ] **Step 1: Create `Screens/Class/ClassSectionsModel.swift`**

```swift
import SwiftUI
import MasterSATKit

/// The People and Files segments' data, per class, kept while the tab lives — switching
/// segments or chips never reloads what is already on screen, and a failure keeps the last
/// answer (`ClassroomLoad`).
@MainActor
@Observable
final class ClassSectionsModel {
    private(set) var boards: [Int: ClassroomLoad<RankingBoard>] = [:]
    private(set) var people: [Int: ClassroomLoad<[ClassroomMember]>] = [:]
    private(set) var materials: [Int: ClassroomLoad<[ClassroomMaterial]>] = [:]
    /// The pull-to-refresh each segment last loaded for; a newer one reloads it.
    @ObservationIgnored private var peopleRefresh = 0
    @ObservationIgnored private var filesRefresh = 0

    func board(_ id: Int) -> ClassroomLoad<RankingBoard> { boards[id] ?? ClassroomLoad() }
    func members(_ id: Int) -> ClassroomLoad<[ClassroomMember]> { people[id] ?? ClassroomLoad() }
    func files(_ id: Int) -> ClassroomLoad<[ClassroomMaterial]> { materials[id] ?? ClassroomLoad() }

    func loadPeople(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != peopleRefresh
        peopleRefresh = refreshID
        for id in ids {
            await loadBoard(id, api: api, force: force)
            await loadMembers(id, api: api, force: force)
        }
    }

    func loadFiles(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != filesRefresh
        filesRefresh = refreshID
        for id in ids { await loadMaterials(id, api: api, force: force) }
    }

    func loadBoard(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = board(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        boards[id] = start
        boards[id] = await Self.fetched(start) { try await api.rankings(classroomId: id) }
    }

    func loadMembers(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = members(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        people[id] = start
        people[id] = await Self.fetched(start) { try await api.people(classroomId: id) }
    }

    func loadMaterials(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = files(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        materials[id] = start
        materials[id] = await Self.fetched(start) { try await api.materials(classroomId: id) }
    }

    private static func fetched<Value>(
        _ start: ClassroomLoad<Value>,
        _ fetch: @MainActor () async throws -> Value
    ) async -> ClassroomLoad<Value> {
        var load = start
        do {
            load.value = try await fetch()
            load.error = nil
        } catch {
            load.error = ClassroomLoad<Value>.message(for: error)
        }
        load.isLoading = false
        load.hasLoaded = true
        return load
    }
}
```

- [ ] **Step 2: Create `Screens/Class/ClassPeopleFilesSegments.swift`**

```swift
import SwiftUI
import MasterSATKit

/// What a segment's load depends on: which classes, and which pull-to-refresh.
private struct SegmentLoad: Hashable {
    let ids: [Int]
    let refreshID: Int
}

/// A class's name over its part of a segment — shown only when there is more than one class.
struct ClassGroupHeading: View {
    let room: Classroom

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(room.isMath ? Theme.subjectMath : Theme.subjectEnglish)
                .frame(width: 9, height: 9)
            Text(room.name)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// The class board and the people in it, for each class under the chip. Under All, one group
/// per class — a student has one to three, so the list stays short.
struct ClassPeopleSegment: View {
    let classes: [Classroom]
    let model: ClassSectionsModel
    let refreshID: Int

    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(classes) { room in
                VStack(alignment: .leading, spacing: 14) {
                    if classes.count > 1 { ClassGroupHeading(room: room) }
                    ClassroomRankingsSection(load: model.board(room.id), isStudent: room.isStudent) {
                        await model.loadBoard(room.id, api: session.classrooms, force: true)
                    }
                    ClassroomPeopleSection(load: model.members(room.id)) {
                        await model.loadMembers(room.id, api: session.classrooms, force: true)
                    }
                }
            }
        }
        .task(id: SegmentLoad(ids: classes.map(\.id), refreshID: refreshID)) {
            await model.loadPeople(for: classes.map(\.id), api: session.classrooms, refreshID: refreshID)
        }
    }
}

/// The files each class's teacher shared, grouped by class the same way.
struct ClassFilesSegment: View {
    let classes: [Classroom]
    let model: ClassSectionsModel
    let refreshID: Int

    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(classes) { room in
                VStack(alignment: .leading, spacing: 14) {
                    if classes.count > 1 { ClassGroupHeading(room: room) }
                    ClassroomMaterialsSection(load: model.files(room.id)) {
                        await model.loadMaterials(room.id, api: session.classrooms, force: true)
                    }
                }
            }
        }
        .task(id: SegmentLoad(ids: classes.map(\.id), refreshID: refreshID)) {
            await model.loadFiles(for: classes.map(\.id), api: session.classrooms, refreshID: refreshID)
        }
    }
}
```

- [ ] **Step 3: Add the two segments to `Screens/Class/ClassView.swift`**

1. `enum Segment: Hashable { case tasks, schedule }` → `enum Segment: Hashable { case tasks, schedule, people, files }`.
2. After `@State private var refreshTick = 0`, add `@State private var sections = ClassSectionsModel()`.
3. `segmentItems` becomes:

```swift
    private var segmentItems: [SegmentBar<Segment>.Item] {
        [
            .init(segment: .tasks, title: "Tasks"),
            .init(segment: .schedule, title: "Schedule"),
            .init(segment: .people, title: "People"),
            .init(segment: .files, title: "Files"),
        ]
    }
```

4. In the `switch segment`, after the `.schedule` case, add:

```swift
                case .people:
                    ClassPeopleSegment(classes: visibleClasses, model: sections, refreshID: refreshTick)
                case .files:
                    ClassFilesSegment(classes: visibleClasses, model: sections, refreshID: refreshTick)
```

- [ ] **Step 4: Build**

Run the build check. Expected `exit=0` and `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Class/ClassSectionsModel.swift \
        ios/MasterSAT/Sources/Screens/Class/ClassPeopleFilesSegments.swift ios/MasterSAT/Sources/Screens/Class/ClassView.swift
git commit -m "feat(ios): Class — People and Files, one group per class under All

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Celebrate the real finishes

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Assessments/AssessmentBoardViews.swift` (`AssessmentBoardScaffold`)
- Modify: `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabSetPage.swift` (`VocabSetView`)
- Modify: `ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift` (`SurveyFillScreen`)

**Interfaces:**
- Consumes: `CelebrationCenter.celebrate(_:xpBefore:at:)`, `.xpNow`, `View.coversCelebrations(_:)`, `CGRect.celebrationPoint` (Task 13); `FinishedWork` (Task 12).
- Produces: `AssessmentRunnerView(attemptId:onSubmitted:onClose:)` — `onSubmitted` optional, so existing call sites compile unchanged; `VocabStudyView(mode:set:assignmentId:onFinished:onClose:)` — `onFinished` optional.

How each trigger plays (R-P2a): the hand-in and the survey happen on a page the overlay covers, so they celebrate at once at their button; the runner and the word games are full-screen covers, so they celebrate the moment the work is in and `.coversCelebrations` holds the check until the cover has gone; under the Me sheet everything waits for the sheet. The XP is always measured from `xpNow` read when the work STARTED (the hand-in pressed, the cover opened).

- [ ] **Step 1: The homework hand-in and its quizzes — `HomeworkDetailView.swift`**

1. After `@State private var reviewAttemptId: Int?`, add:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    /// Where the Hand in button is, so the confetti leaves from it.
    @State private var handInFrame: CGRect = .zero
    /// The header's XP when a quiz was opened — what its hand-in's gain is measured from.
    @State private var xpAtQuizStart: Int?
```

2. Replace the runner cover:

```swift
        .fullScreenCover(item: $assessmentAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                assessmentAttemptId = nil
                Task { await load() }
            }
        }
```

with:

```swift
        .fullScreenCover(item: $assessmentAttemptId) { id in
            // Celebrated the moment it is handed in; the cover keeps it waiting until it has gone.
            AssessmentRunnerView(attemptId: id, onSubmitted: {
                celebrations.celebrate(.assessment, xpBefore: xpAtQuizStart)
            }) {
                assessmentAttemptId = nil
                Task { await load() }
            }
            .coversCelebrations(celebrations)
        }
```

3. In `openAssessment(_:)`, replace `                assessmentAttemptId = attempt.id` with:

```swift
                xpAtQuizStart = celebrations.xpNow
                assessmentAttemptId = attempt.id
```

4. In `uploadCard(_:)`, replace

```swift
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(isUploading || (staged.isEmpty && submission?.files.isEmpty != false))
```

with:

```swift
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(isUploading || (staged.isEmpty && submission?.files.isEmpty != false))
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { handInFrame = $0 }
```

5. In `submit(_:limits:)`, replace

```swift
        isUploading = true
        actionError = nil
        Task {
```

with:

```swift
        let xpBefore = celebrations.xpNow
        isUploading = true
        actionError = nil
        Task {
```

then replace

```swift
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
```

with:

```swift
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
                // Effort, every time — "Send again" included.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInFrame.celebrationPoint)
```

and in the "token already used" branch replace

```swift
                staged = []
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
            } catch APIError.conflict(let detail) {
```

with:

```swift
                staged = []
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
                // The earlier attempt did land: the work is in.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInFrame.celebrationPoint)
            } catch APIError.conflict(let detail) {
```

- [ ] **Step 2: The runner says when it is handed in — `AssessmentRunnerView.swift`**

1. Replace

```swift
    let attemptId: Int
    let onClose: @MainActor () -> Void
```

with:

```swift
    let attemptId: Int
    /// Called once the hand-in is accepted; the presenter celebrates it (`CelebrationCenter`).
    var onSubmitted: (@MainActor () -> Void)? = nil
    let onClose: @MainActor () -> Void
```

2. In `submit()`, replace `            if await runner.submit() { didSubmit = true }` with:

```swift
            if await runner.submit() {
                didSubmit = true
                onSubmitted?()
            }
```

- [ ] **Step 3: The assessment board's runner — `AssessmentBoardViews.swift` (`AssessmentBoardScaffold`)**

1. After `@State private var refusal: AssessmentStartRefusal?`, add:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    /// The header's XP when the runner opened — what a hand-in's gain is measured from.
    @State private var xpAtStart: Int?
```

2. Replace

```swift
        .fullScreenCover(item: $runnerAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                runnerAttemptId = nil
                Task { await model.load(session.student) }
            }
        }
```

with:

```swift
        .fullScreenCover(item: $runnerAttemptId) { id in
            AssessmentRunnerView(attemptId: id, onSubmitted: {
                celebrations.celebrate(.assessment, xpBefore: xpAtStart)
            }) {
                runnerAttemptId = nil
                Task { await model.load(session.student) }
            }
            .coversCelebrations(celebrations)
        }
```

3. In `open(_:)`, replace

```swift
            case .opened(let attemptId):
                runnerAttemptId = attemptId
```

with:

```swift
            case .opened(let attemptId):
                xpAtStart = celebrations.xpNow
                runnerAttemptId = attemptId
```

- [ ] **Step 4: A retry from the review — `AssessmentReviewView.swift`**

1. After `@State private var retryError: String?`, add:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var xpAtRetry: Int?
```

2. Replace

```swift
        .fullScreenCover(item: $retryAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                retryAttemptId = nil
                onRetryClosed?()
                // This review is of the attempt before; the new one lives on the board.
                dismiss()
            }
        }
```

with:

```swift
        .fullScreenCover(item: $retryAttemptId) { id in
            AssessmentRunnerView(attemptId: id, onSubmitted: {
                celebrations.celebrate(.assessment, xpBefore: xpAtRetry)
            }) {
                retryAttemptId = nil
                onRetryClosed?()
                // This review is of the attempt before; the new one lives on the board.
                dismiss()
            }
            .coversCelebrations(celebrations)
        }
```

3. In `retry()`, replace `            retryAttemptId = try await session.assessments.start(homeworkId: homeworkId).id` with:

```swift
            let attempt = try await session.assessments.start(homeworkId: homeworkId)
            xpAtRetry = celebrations.xpNow
            retryAttemptId = attempt.id
```

(This review pops itself while its cover closes; if that cover never reports leaving, the Class or Today pill's `pillAppeared()` clears it — Task 13.)

- [ ] **Step 5: A word-game round — `VocabStudyView.swift` and `VocabSetPage.swift`**

`VocabStudyView.swift`:
1. Replace

```swift
    let mode: StudyMode
    let set: VocabSetDetail
    var assignmentId: Int?
    let onClose: @MainActor () -> Void
```

with:

```swift
    let mode: StudyMode
    let set: VocabSetDetail
    var assignmentId: Int?
    /// Called when the first round of this cover is finished; the set page celebrates it.
    var onFinished: (@MainActor () -> Void)? = nil
    let onClose: @MainActor () -> Void
```

2. After `@State private var runKey = 0`, add:

```swift
    /// Once per cover: "Study again" is more practice, not another finish to announce.
    @State private var reportedFinish = false
```

3. In `finish(_:)`, after `outcome = result`, add:

```swift
        if !reportedFinish {
            reportedFinish = true
            onFinished?()
        }
```

`VocabSetPage.swift` (`VocabSetView`):
1. After `@State private var isEditing = false`, add:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    /// The header's XP when a game opened — what the round's gain is measured from.
    @State private var xpAtStudyStart: Int?
```

2. Replace

```swift
        .fullScreenCover(item: $studying) { mode in
            if let detail {
                VocabStudyView(mode: mode, set: detail, assignmentId: assignmentId) {
                    studying = nil
                    // Progress moved; repaint from the server rather than guessing.
                    Task { await load() }
                }
            }
        }
```

with:

```swift
        .fullScreenCover(item: $studying) { mode in
            if let detail {
                VocabStudyView(mode: mode, set: detail, assignmentId: assignmentId, onFinished: {
                    celebrations.celebrate(.vocabSession, xpBefore: xpAtStudyStart)
                }) {
                    studying = nil
                    // Progress moved; repaint from the server rather than guessing.
                    Task { await load() }
                }
                .coversCelebrations(celebrations)
            }
        }
        .onChange(of: studying) { _, mode in
            if mode != nil { xpAtStudyStart = celebrations.xpNow }
        }
```

- [ ] **Step 6: A survey sent — `SurveyFillView.swift` (`SurveyFillScreen`)**

1. After `@AccessibilityFocusState private var spokenGap: Int?`, add:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    /// Where Submit is, so the confetti leaves from it.
    @State private var submitFrame: CGRect = .zero
```

2. In `footer(proxy:)`, replace

```swift
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isSubmitting)
```

with:

```swift
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isSubmitting)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { submitFrame = $0 }
```

3. Replace

```swift
    private func submit(_ proxy: ScrollViewProxy) async {
        focus = nil
        guard let gap = await model.submit() else { return }
```

with:

```swift
    private func submit(_ proxy: ScrollViewProxy) async {
        focus = nil
        let xpBefore = celebrations.xpNow
        let wasDone = model.done
        guard let gap = await model.submit() else {
            // Sent: celebrated. A survey pays points, not XP, so nothing flies unless XP moved.
            if model.done, !wasDone {
                celebrations.celebrate(.survey, xpBefore: xpBefore, at: submitFrame.celebrationPoint)
            }
            return
        }
```

- [ ] **Step 7: Build**

Run the build check. Expected `exit=0` and `** BUILD SUCCEEDED **`. Every page touched here is pushed inside a tab stack or the Me sheet, all of which carry `CelebrationCenter` in the environment (`RootTabView` sets it on the tab view and again on the Me sheet); covers never read it — their presenters hand it in.

- [ ] **Step 8: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentBoardViews.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabSetPage.swift \
        ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift
git commit -m "feat(ios): homework, assessments, word games and surveys are celebrated every time they're in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Run it, prove it, open the PR

**Files:** none (verification).

- [ ] **Step 1: Kit green**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test 2>&1 | tail -2`
Expected: `✔ Test run with 685 tests … passed` (649 + 36).

- [ ] **Step 2: A local backend with phase-2 work on it**

Migrate and seed exactly as Task 9 Step 2 (`migrate`, `seed_classroom_uat`, the `email_verified` update), and start the `ios-redesign-backend` preview (already in `/Users/macbook/Projects/DSAT-mock-exam/.claude/launch.json`). Run this before 21:00 local, so the English lesson it schedules is still to come today. Save as `/tmp/seed_phase2.py`:

```python
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from classes.models import Assignment, Classroom, ClassroomMembership as M
from assessments.models import AssessmentSet, AssessmentQuestion, HomeworkAssignment
from vocabulary.models import VocabSection, VocabWord, VocabSet, VocabSetItem, VocabHomework
from surveys.models import Survey, SurveyQuestion
from users.models import ExamDateOption
from rewards.models import RewardRule

U = get_user_model()
owner = U.objects.get(email="uat_owner@mastersat.test")
s1 = U.objects.get(email="uat_s1@mastersat.test")
math = Classroom.objects.get(name="UAT Math Class")
now = timezone.localtime()

# A second class, of the other subject, meeting today two hours from now: chips, and a lesson in Up next.
days = Classroom.DAYS_ODD if now.weekday() in (0, 2, 4) else Classroom.DAYS_EVEN
english, _ = Classroom.objects.get_or_create(
    name="UAT English Class",
    defaults={"subject": Classroom.SUBJECT_ENGLISH, "lesson_days": days, "created_by": owner})
english.lesson_days = days
english.lesson_time = (now + timedelta(hours=2)).strftime("%H:%M")
english.save()
for user, role in ((owner, M.ROLE_OWNER), (s1, M.ROLE_STUDENT)):
    M.objects.update_or_create(classroom=english, user=user, defaults={"role": role, "status": M.STATUS_ACTIVE})

def homework(room, title, days_ahead):
    assignment, _ = Assignment.objects.get_or_create(
        classroom=room, title=title,
        defaults={"created_by": owner, "category": Assignment.CATEGORY_HOMEWORK,
                  "status": Assignment.STATUS_PUBLISHED, "max_score": 100,
                  "due_at": timezone.now() + timedelta(days=days_ahead)})
    return assignment

homework(math, "Phase 2 · hand in a photo", 2)
homework(english, "Phase 2 · hand in from Me", 2)
quiz = homework(math, "Phase 2 · quick quiz", 3)
aset, _ = AssessmentSet.objects.get_or_create(
    title="Phase 2 quiz",
    defaults={"subject": "math", "category": "Algebra › Linear functions", "review_status": "approved", "created_by": owner})
AssessmentQuestion.objects.get_or_create(
    assessment_set=aset, order=0,
    defaults={"prompt": "2 + 2 = ?", "question_type": "multiple_choice",
              "choices": [{"id": "A", "text": "3"}, {"id": "B", "text": "4"}], "correct_answer": "B"})
HomeworkAssignment.objects.get_or_create(classroom=math, assessment_set=aset, defaults={"assignment": quiz, "assigned_by": owner})

words = homework(english, "Phase 2 · five words", 1)
section, _ = VocabSection.objects.get_or_create(slug="phase-2", defaults={"title": "Phase 2", "created_by": owner})
vset, _ = VocabSet.objects.get_or_create(section=section, title="Phase 2 set")
for order, (word, meaning) in enumerate([("brisk", "quick and active"), ("candid", "honest and direct"),
                                         ("diligent", "careful and hard-working"), ("lucid", "clear"), ("terse", "brief")]):
    w, _ = VocabWord.objects.get_or_create(section=section, word=word, defaults={"definition": meaning})
    VocabSetItem.objects.get_or_create(vocab_set=vset, word=w, defaults={"order": order})
VocabHomework.objects.get_or_create(classroom=english, assignment=words, vocab_set=vset, defaults={"assigned_by": owner})

homework(english, "Phase 2 · catch-up reading", -1)

survey, _ = Survey.objects.get_or_create(
    title="Phase 2 survey", defaults={"status": Survey.STATUS_PUBLISHED, "points_award": 10, "created_by": owner})
SurveyQuestion.objects.get_or_create(
    survey=survey, order=0,
    defaults={"prompt": "How was this week?", "question_type": SurveyQuestion.TYPE_SINGLE_CHOICE,
              "is_required": True, "options": ["Good", "Okay", "Hard"]})

ExamDateOption.objects.get_or_create(exam_date=(now + timedelta(days=60)).date(), defaults={"label": "SAT"})
RewardRule.objects.get_or_create(event="HOMEWORK", defaults={"points": 15, "is_active": True})
print("phase 2 fixtures ready")
```

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/backend
SECRET_KEY=dev-secret DEBUG=True ~/.pyenv/versions/3.12.2/bin/python3 manage.py shell -c "exec(open('/tmp/seed_phase2.py').read())"
git -C .. status --short   # nothing new under backend/ (db.sqlite3 is gitignored)
```
Expected: `phase 2 fixtures ready`.

- [ ] **Step 3: Run on the simulator against it**

Build (the build check), then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
xcrun simctl install booted build/dd/Build/Products/Debug-iphonesimulator/MasterSAT.app
xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"
```
Sign in as `uat_s1@mastersat.test` (password in `seed_classroom_uat.py`). Screenshot each item (`sleep 2; xcrun simctl io booted screenshot <name>.png`):

1. **Today order:** header with date, 🔥, ⚡ XP, bell, avatar; the ring draws in ("N to go this week"); Up next starts with the catch-up rows ("Catch up · <day>", amber, no XP chip — "catch-up reading" among them), then "five words" (Due tomorrow, words row), "hand in a photo" and "hand in from Me", "quick quiz" (quiz row) — each with "up to +15 XP" — and the English lesson last ("Today · HH:MM", no chevron); "See all" only when more than six homework are owed. Never the word "Overdue".
2. **Zoom:** tap "hand in a photo" → the page zooms out of its row (iOS 26.3 runtime); Back.
3. **Me sheet holds the goal and the date:** tap the SAT row → the Me sheet opens on Overview; "Set a goal"/"Change goal" opens the goal sheet; the exam-date menu lists the seeded date; pick it, close Me → Today reads "SAT · 60 days to go".
4. **Survey:** Today's survey card → Take the survey → answer → Submit → check + confetti from the Submit button, success haptic, VoiceOver says "Survey sent. Thank you."; the pill's number does not change and nothing flies (a survey pays points only).
5. **Homework hand-in:** note the pill's XP. Open "hand in a photo" → Photo → pick one → Hand in → check + confetti at the button at once; no flight on this page. Back → on Today "+15 XP" rises from mid-screen into the pill; the pill's number rolls up as it lands (to the noted value + 15), pulses once, one increase haptic; the row leaves Up next with a spring; the ring moves.
6. **Assessment:** Class → Tasks → To do → "quick quiz" → Start → B → Hand in → Done. The check plays only once the runner has gone (screen centre, on the homework page). Back to the Class root → the flight lands on Class's pill — only if the pill's number then differs from before (`/rewards/me/` rose); otherwise nothing flies, which is correct.
7. **Word game:** Class → English chip → "five words" → the set → Flashcards → play to the end → Back. The check plays after the cover closes; a flight only if XP rose (a word homework below 100 % settles at its deadline, so normally none).
8. **Under the Me sheet:** avatar → Overview → Homework to do → "hand in from Me" → Photo → Hand in → nothing plays under the sheet; close Me → the check + confetti on the tab, then the flight into its pill.
9. **All done:** hand in "catch-up reading" too (and finish anything else due this week); back on Today the ring completes → double confetti + the ring bounces once; VoiceOver: "Everything due this week is done."
10. **Class chips and segments:** chips "All · Math · English"; tap English → the Math card springs out and To do re-springs; Schedule shows only English days; People shows the English board and people; Files the English files (or "No materials yet"); All → People and Files grouped under each class's name. The segment capsule and chips slide; selection haptic.
11. **Class cards:** "Next lesson · Today at HH:MM" on English; "Join live quiz" appears only while a room runs (none locally — say so in the PR); the Telegram button only where the class has a group (none locally — say so).
12. **Re-tap:** scroll Today down, tap Today → back to the top; push a page, tap Today → pops. During a flight only the visible tab's pill pulses (switch tabs right after a hand-in to check). Long-pressing the XP pill does nothing.
13. **Reduce Motion** (`xcrun simctl spawn booted defaults write com.apple.Accessibility ReduceMotionEnabled -bool true`, relaunch): a hand-in shows a still tick that fades, no confetti, no flight — the pill's number just changes; chips and segments fade; no zoom; the hero ring fills without overshoot. Turn it off (`-bool false`), relaunch.
14. **Dark mode** (`xcrun simctl ui booted appearance dark`): Today, Class and every segment readable; back to light.
15. **Bottom clearance:** the last row of Today, and of each Class segment, scrolls fully above the floating bar.

Record a 45-second walk-through of items 1, 5, 6 and 10 in the background: `xcrun simctl io booted recordVideo --codec h264 /tmp/phase2.mp4` (Ctrl-C to stop).

- [ ] **Step 4: Nothing unexpected in the tree, every commit by Viltrumlik**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git status --short                                   # empty
git log --format='%an <%ae> %s' origin/main..HEAD | grep -v "Viltrumlik <viltrumlik@gmail.com>" || echo "all Viltrumlik"
```

- [ ] **Step 5: Push and open the PR (stacked on #304)**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git push origin HEAD:refs/heads/feat/ios-redesign-phase2
gh pr create --base main --head feat/ios-redesign-phase2 \
  --title "iOS redesign — phase 2: Today and Class, real celebrations" --body-file /tmp/pr-phase2.md
```
`/tmp/pr-phase2.md` says: **stacked on #304 — merge that first; until then this diff includes phase 1**; what changed (Today: ring, Up next across classes, fresh result, compact SAT row → Me; Class: chips, class cards, Tasks/Schedule/People/Files; celebrations on homework, assessments, word rounds and surveys with "+N XP" only for a confirmed gain; re-tap scrolls to top; zoom on iOS 18+); what did not (no backend change; Rewards and Words content are phase 3); the Step 3 checklist with results, including what could not be seen locally (live quiz Join, Telegram); and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: iOS 17 / 18**

Run `xcrun simctl list runtimes | grep -E "iOS 1[78]"`. If a runtime is there, create a device on it, install, and repeat checklist items 1, 2 (a plain push — no zoom before 18), 5 and 10; note the results in the PR. If none is installed (only iOS 26.3 was, in phase 1), write in the PR under "Not verified" that the iOS 17/18 paths (no zoom; `onGeometryChange` back-deployed) are unchecked, and leave the ~8 GB runtime download to the owner.

- [ ] **Step 7: Send the owner the demo**

Send the screenshots and `/tmp/phase2.mp4` (SendUserFile), one line per item to look at. Merge only after the owner's "ha", and after #304.

---

## Phase 3 — Rewards + Words

Branch `feat/ios-redesign-phase3` in `/Users/macbook/Projects/dsat-wt-ios-redesign`, built on phase 2 (PR #305, HEAD `6a5dd83b`). One PR into `main`, merged after #305.

**What the student gets:** the Rewards tab becomes "where I stand and what I have" — a trophy hero with their place on the whole learning center's board ("#57 · overall · all time") and the one student to pass next ("121 XP to pass Malika"), chunky streak and coins cards (convert on the coins card), the board as XP | Strikes, "Where your XP came from", and the shop. Coming back to the app ("while you were away") flies the XP earned meanwhile into the header with what it was for, grows the flame when the run got longer, and shows a trophy card when they moved up a place. A purchase or a conversion bursts a coin. The Words tab opens on "Review today" — words still to master and ONE set that Start opens — with a search of the whole bank and the homework / bank / own-set lists in the new look.

**Checked while this plan was written (2026-10-21).** In a throwaway worktree of `6a5dd83b`, every task below was applied exactly as written — by a script that executes each task's **Create** / **Rewrite** / **Edit** blocks verbatim, in order — and at every task end the kit tests passed (694 → 705 → 715 → 721 after Tasks 20–22) and, for Tasks 23–28, the app built (`** BUILD SUCCEEDED **`, no new warnings in the touched files). The two new Lottie files were decoded and rendered frame by frame with lottie-ios 4.6.1. A failure at execution therefore means the tree has moved since — read the named file before improvising.

**How the code steps are written.** **Create** `path` — a new file, the whole of it. **Rewrite** `path` — the whole file replaced. **Edit** `path` — replace: OLD … with: NEW — OLD occurs exactly once in that file; replace it verbatim. Paths are from the repository root. Every app task ends with the build check of phase 2 ("The build check (used by every app task)").

### Decisions taken where the design left room

- **The hero's board is global, all time, XP — the owner's decision of 2026-10-21** (the approved design's "#4 in your class this week" is superseded, and the server has no week window — only `ALL` and `MONTH`). As built it asks `LeaderboardQuery.heroBoard` (the default board with `limit=200`, Ruling P3-R3 — the default 50 rows would hide the student to pass for ranks 51–200), and the welcome-back check asks the same; ties are numbered the same in the list and in `my` (`competition_ranks`), so every reader sees one number.
- **"N XP to pass <name>" is offered only when it is provable.** The response carries the top 50 rows plus the student's own (`my`, from `rank_of`). Ranks are competition ranks, so exactly `rank − 1` students are ahead; only when all of them are in the response is the nearest one "directly above" — otherwise the hero says "Keep earning XP to climb" with no number. A tie-mate printed above the student is not passed (that changes no number); the line names the nearest better rank. #1 reads "You're top of the whole board"; no XP yet reads "Not on the board yet". First names only (`LeaderboardName.firstName`, after the email guard).
- **The board on the tab is the global one: XP (All time · This month) | Strikes, the top five and the student's own row.** Strikes hides the window chips and sends neither window nor subject (the server forces all time and ignores the subject there). The full page (scopes, filters, podium) stays XP-only in this phase; "See the full board" shows under XP only.
- **Convert on the coins card spends Max after a confirmation** (`convert(points: nil)` — every point that buys a whole coin); choosing an amount stays on the Points page. A confirmed conversion bursts a coin there and on the Points page too — coins arriving is the same event as a purchase.
- **"Where your XP came from"** = the five newest earnings whose rule adds XP (`/rewards/rules/` `grants_xp`; without the rules every earning stays — the server's own fallback), amounts as the rows' points (equal to the XP for every XP-granting rule), then "All your points" → Points.
- **The shop on the tab is a card to the Shop page** — the storefront is the heaviest rewards request and the tab already makes four; the coin burst plays where the purchase is confirmed, on the Shop page.
- **The last-seen baseline lives in `UserDefaults`, one JSON value per user id** (`rewards.lastSeen.v1.<id>`): four integers do not justify a file (directory, atomic writes, migrations), it survives relaunch and updates, it is what Today's "fresh result" already uses per student, and a second account on the phone starts with no baseline.
- **"While you were away" runs on launch AND on every return to the front.** iOS keeps a backgrounded app alive for hours, so a student coming back after a lesson rarely launches it — the return is the moment. It replaces the scene-active header refresh, so a quick app switch costs nothing extra and celebrates nothing unless something changed. One check at a time.
- **"Seen" means shown:** the baseline stores the header's `xp − heldXP`, the flame's held number and the old rank while a rank-up card has not been shown — so a kill before a flight lands celebrates it next time, once. Written after every check and when the scene goes to the background.
- **The board is read for the rank only when XP rose (or no rank was ever read):** a place only improves through the student's own XP, and the board costs two aggregates on the server.
- **The trophy "sheet" is a drawn card at the root, not a `.sheet`:** a third sheet would fight the router's one-sheet rule and the Me sheet's queue. A chunky card over a dimmed backdrop, above the tab bar; tap outside / "Nice!" / "See the board" (→ Rewards at its root).
- **Order on a return:** the XP flight first (it needs a visible pill), the flame at the same time (0.45 s after it is on screen), the trophy card after the flight has landed. Under a sheet or a cover all of it waits.
- **The flight's caption** names the newest earning row added since the baseline ("Attendance", "Homework + 2 more"); a rise with no new row (a re-graded homework moves its own row) flies without a caption. VoiceOver hears every part, Reduce Motion or not.
- **Words: the hero counts the bank's words still to master** — the server has no spaced repetition and no "learning" bucket (`new` | `mastered`), so nothing is "due"; words − mastered per section is the one exact number the hub loads. **Start** opens the word-homework set due soonest that is not mastered (catch-up first, bound to its homework); with none, the section with the most words still to master — one read of it, then its set with the most (`bestSet`) — falling back to the section page. The student's own sets are never Start's target (no word progress on them, and their words are bank words). All caught up and nothing yet are states, not errors; the hero needs both the bank and the homework and says so when either never loaded.
- **Words lists:** a `SegmentBar` Homework · Word bank · My sets, opening on Homework when there is any, else the bank — decided once, never after the student picked; "New set" moves to the top of My sets; search on the tab (two letters, 300 ms pause, a failure is not "no matches").
- **Look "B" arrives as `ChunkySurface`** (the prototype's `.chunky`, ported): the trophy hero, the streak and coins cards, the student's own board row and the trophy card — nowhere else. Words keeps look A with amber as its identity; actions stay brand blue (white on amber fails contrast). At most two looping Lottie on a screen: the header flame and the streak card's flame; the trophy plays once.
- **The three Rewards pages refresh detached now** (Points, Shop, Leaderboard): this phase owns that tab, and the phase-2 `.refreshable` bug (a refresh cancelling its own requests) would show on exactly the screens it rebuilds. The other pushed pages stay on phase 5's list.
- **`Leaderboard.swift` grows by more than the `metric` parameter the Global Constraints name:** the strike board's rows carry `strikes` (and the board its `metric`), so they are decoded; `passTarget` and `firstName` are pure logic over the same response. Still no backend change, and nothing else in an existing kit file changes outside `CelebrationQueue.swift`, which phase 2 created.

### Phase 2 hand-off → tasks

| Carried into phase 3 (Phase 2 outcome; Phase 1 outcome where noted) | Where |
|---|---|
| "While you were away" rework of interleaved refresh dips | Task 21 (`CelebrationQueue.held(xpNow:)`, away entries recorded before the read), Task 24 (`heldXP` reads it), Task 25 (`expectAway` before the request, `streakRose` before `apply`) |
| The unanimated backstop landing | Task 24 (`settle` lands inside `withAnimation(Motion.snappy)`) |
| `allDone()` dropped (not held) while a cover is up | Task 24 (`allDoneWaiting`, played in `stageCleared()`) |
| Last-seen XP / streak / rank per student (ruled out of phase 2 → phase 3) | Task 21 (kit: `LastSeen`, `LastSeenBook`, `WelcomeBack`), Task 25 (app: `AwayCheck`) |
| `metric` on the leaderboard query (Global Constraints) | Task 20 |
| Phase 5 list: pushed pages on a plain `.refreshable` | Task 27 takes the three Rewards pages; the rest stay in phase 5 |
| Phase 1 kit polish: enforce the 15 000-byte Lottie budget | Task 23 (the generator throws over budget) |
| Phase 1 kit polish: a test that every `LottieAsset` loads | Not here — the project has no app test target to hold it; Task 29 sees each new asset play on the simulator |
| Owner: check on an iOS 17 / 18 runtime | Task 29 Step 6 |

### File structure (phase 3)

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):
- `Rewards/Leaderboard.swift` — `LeaderboardMetric`, the strike board's rows, `LeaderboardPass` / `passTarget`, `LeaderboardName.firstName`.
- `Rewards/XPLedger.swift` — **new.** "Where your XP came from".
- `Rewards/LastSeen.swift` — **new.** `LastSeen`, `LastSeenBook`, `Rise`, `WelcomeBack`.
- `Motion/CelebrationQueue.swift` — away entries, flight captions, `held(xpNow:)`, `resolve` returns the gain.
- `Vocabulary/VocabReview.swift` — **new.** "Review today".

Kit tests (`ios/MasterSATKit/Tests/MasterSATKitTests/`): `RewardsTabTests.swift`, `WelcomeBackTests.swift`, `VocabReviewTests.swift` — **new.**

App (`ios/`):
- `tools/lottie/make-lottie.mjs` — `coin-burst`, `star-burst`, the byte budget; `MasterSAT/Resources/Lottie/{coin-burst,star-burst}.json` — **new**, generated.
- `MasterSAT/Sources/Support/Chunky.swift` — **new.** Look B.
- `MasterSAT/Sources/Support/Motion/LottieClip.swift` (two assets), `Celebrations.swift` (the hand-off fixes, captions, coin burst, away / flame / trophy), `RankUpCard.swift` — **new.**
- `MasterSAT/Sources/Screens/Shell/RewardsStore.swift`, `AppHeader.swift` (`StrikeChip`), `AwayCheck.swift` — **new**; `MasterSAT/Sources/Screens/RootView.swift`.
- `MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift` (rewritten), `RewardsTabCards.swift` — **new**; `PointsView.swift`, `ShopView.swift`, `LeaderboardView.swift`.
- `MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift` (rewritten), `WordsTodayCards.swift` — **new**; `VocabComponents.swift`.

---

### Task 20: The Rewards tab's numbers in the kit (`LeaderboardMetric`, strikes rows, `passTarget`, `XPLedger`)

**Files:**
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift`
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPLedger.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/RewardsTabTests.swift`

**Interfaces:**
- Consumes: `LeaderboardQuery`, `LeaderboardRow`, `LeaderboardBoard`, `LeaderboardName`, `PointAward`, `RewardRule` (all existing).
- Produces: `public enum LeaderboardMetric: String { case xp = "XP", strikes = "STRIKES" }`; `LeaderboardQuery.metric` (init gains `metric: LeaderboardMetric = .xp` as its LAST parameter; `queryItems` sends `metric=STRIKES` and drops `window`/`subject` on the strike board; `activeFilterCount` counts only the branch there); `LeaderboardRow.strikes: Int?` (init gains `strikes: Int? = nil` as its last parameter) and `func score(_: LeaderboardMetric) -> Int`; `LeaderboardBoard.metric` (init gains `metric: LeaderboardMetric = .xp` as its FIRST parameter); `goal` is nil on the strike board; `public struct LeaderboardPass { name: String; xp: Int; rank: Int; var text: String }` and `LeaderboardBoard.passTarget: LeaderboardPass?`; `LeaderboardName.firstName(_:) -> String`; `public enum XPLedger { static func rows(_: [PointAward], rules: [RewardRule]?, limit: Int = 5) -> [PointAward] }`.

Rules for this task (kit): no backend change — the server shipped `?metric=STRIKES` in #302 and serves `strikes` on every row of that board (`backend/rewards/views.py` `_row`), and `metric` in the board's meta. The strike board forces all time and ignores the subject server-side, so the app does not send what the server would overrule. Every mutating call in a test sits on its own line, never inside `#expect`.

- [ ] **Step 1: Write the failing test**

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/RewardsTabTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LeaderboardMetricTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("XP is the server's default, so it is not sent; the strike board sends only what it obeys")
    func queryItems() {
        let xp = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4)
        #expect(xp.metric == .xp)
        #expect(xp.queryItems.map(\.name) == ["scope", "window", "subject", "branch"])

        let strikes = LeaderboardQuery(scope: .global, window: "MONTH", subject: "MATH", branchId: 4, metric: .strikes)
        let sent = Dictionary(uniqueKeysWithValues: strikes.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(sent == ["scope": "GLOBAL", "metric": "STRIKES", "branch": "4"])
        #expect(strikes.activeFilterCount == 1, "only the branch narrows a strike board")

        let groupStrikes = LeaderboardQuery(scope: .group, metric: .strikes)
        #expect(groupStrikes.queryItems.map(\.name) == ["scope", "metric"])
        #expect(groupStrikes.activeFilterCount == 0)
    }

    @Test("A strike board decodes its metric and each row's run; it offers no XP goal")
    func strikeBoardDecodes() throws {
        let board = try decode(LeaderboardBoard.self, #"""
        {"metric":"STRIKES","scope":"GLOBAL","window":"ALL","count":2,
         "rows":[{"rank":1,"student_id":7,"name":"Aziz","xp":0,"awards":0,"strikes":12,"is_me":false},
                 {"rank":2,"student_id":9,"name":"Madina","xp":0,"awards":0,"strikes":9,"is_me":true}],
         "my":{"rank":2,"student_id":9,"name":"Madina","xp":0,"awards":0,"strikes":9,"is_me":true}}
        """#)
        #expect(board.metric == .strikes)
        #expect(board.rows.map(\.strikes) == [12, 9])
        #expect(board.rows[0].score(.strikes) == 12)
        #expect(board.rows[0].score(.xp) == 0)
        #expect(board.goal == nil)
        #expect(board.passTarget == nil)
    }

    @Test("An XP board without `metric` (older server) reads as XP, and its rows carry no run")
    func xpBoardDefaults() throws {
        let board = try decode(LeaderboardBoard.self, #"""
        {"rows":[{"rank":1,"student_id":7,"name":"Aziz","xp":40}],"my":null}
        """#)
        #expect(board.metric == .xp)
        #expect(board.rows[0].strikes == nil)
        #expect(board.rows[0].score(.strikes) == 0)
    }
}

@Suite struct LeaderboardPassTests {

    private func row(_ rank: Int, _ id: Int, _ xp: Int, name: String? = nil, me: Bool = false) -> LeaderboardRow {
        LeaderboardRow(rank: rank, studentId: id, name: name ?? "S\(id)", xp: xp, isMe: me)
    }

    @Test("The student directly above, by first name, to pass and not to tie")
    func directlyAbove() {
        let me = row(4, 4, 150, me: true)
        let board = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 2, 300), row(3, 3, 270, name: "Malika Karimova"), me], my: me)
        let pass = board.passTarget
        #expect(pass == LeaderboardPass(name: "Malika", xp: 121, rank: 3))
        #expect(pass?.text == "121 XP to pass Malika")
    }

    @Test("Nobody to pass at #1, without a standing, or on a board that is not XP")
    func nothingToPass() {
        let top = row(1, 1, 400, me: true)
        #expect(LeaderboardBoard(rows: [top, row(2, 2, 300)], my: top).passTarget == nil)
        #expect(LeaderboardBoard(rows: [row(1, 1, 400)], my: nil).passTarget == nil)
        let me = row(2, 2, 300, me: true)
        #expect(LeaderboardBoard(metric: .strikes, rows: [row(1, 1, 0), me], my: me).passTarget == nil)
    }

    @Test("Below the page: named only when every student ahead is in the response")
    func belowThePage() {
        let page = (1...50).map { row($0, $0, 1000 - $0) }
        let next = row(51, 99, 900, me: true)
        let reachable = LeaderboardBoard(rows: page, my: next)
        #expect(reachable.passTarget == LeaderboardPass(name: "S50", xp: 51, rank: 50))

        let far = row(57, 99, 600, me: true)
        #expect(LeaderboardBoard(rows: page, my: far).passTarget == nil, "#51–#56 are not in the response")
    }

    @Test("Ties: a tie-mate printed above is not passed; a tie ahead is passed as one")
    func ties() {
        let me = row(2, 3, 300, me: true)
        let tiedWithMe = LeaderboardBoard(rows: [row(1, 1, 400), row(2, 2, 300), me], my: me)
        #expect(tiedWithMe.passTarget == LeaderboardPass(name: "S1", xp: 101, rank: 1))

        let behindATie = row(4, 4, 300, me: true)
        let tiedAhead = LeaderboardBoard(rows: [row(1, 1, 500), row(2, 2, 400), row(2, 3, 400), behindATie], my: behindATie)
        #expect(tiedAhead.passTarget == LeaderboardPass(name: "S3", xp: 101, rank: 2))

        // The page ends on a tie ahead of a student it does not show.
        let cut = LeaderboardBoard(rows: [row(1, 1, 500), row(2, 2, 400), row(2, 3, 400)], my: row(4, 9, 100, me: true))
        #expect(cut.passTarget == LeaderboardPass(name: "S3", xp: 301, rank: 2))
    }

    @Test("Level on XP but ranked below: one XP passes them")
    func levelXP() {
        let me = row(2, 2, 300, me: true)
        #expect(LeaderboardBoard(rows: [row(1, 1, 300), me], my: me).passTarget?.xp == 1)
    }

    @Test("A first name is the first word of the shown name — never an address")
    func firstName() {
        #expect(LeaderboardName.firstName("Malika Karimova") == "Malika")
        #expect(LeaderboardName.firstName("  Jasur  ") == "Jasur")
        #expect(LeaderboardName.firstName("") == "Student")
        #expect(LeaderboardName.firstName(LeaderboardName.display("malika@mail.uz")) == "malika")
    }
}

@Suite struct XPLedgerTests {

    private func award(_ id: Int, _ event: String, _ points: Int) -> PointAward {
        PointAward(id: id, event: event, label: event.capitalized, points: points, awardedAt: "2026-10-20T10:00:00Z")
    }

    @Test("Earnings that add XP, newest first, at most five; a conversion spends and is left out")
    func earningsOnly() {
        let history = [
            award(9, "COIN_CONVERSION", -30), award(8, "HOMEWORK", 15), award(7, "SURVEY", 10),
            award(6, "ATTENDANCE_PRESENT", 5), award(5, "ATTENDANCE_PRESENT", 5), award(4, "HOMEWORK", 12),
            award(3, "ATTENDANCE_LATE", 3), award(2, "ATTENDANCE_PRESENT", 5),
        ]
        let rules = [
            RewardRule(event: "HOMEWORK", label: "Homework", points: 15),
            RewardRule(event: "SURVEY", label: "Survey", points: 10, grantsXP: false),
        ]
        #expect(XPLedger.rows(history, rules: rules).map(\.id) == [8, 6, 5, 4, 3])
        #expect(XPLedger.rows(history, rules: rules, limit: 2).map(\.id) == [8, 6])
    }

    @Test("Without the rules every earning is kept — a missing rule adds XP on the server too")
    func withoutRules() {
        let history = [award(2, "SURVEY", 10), award(1, "HOMEWORK", 15)]
        #expect(XPLedger.rows(history, rules: nil).map(\.id) == [2, 1])
        #expect(XPLedger.rows([], rules: nil).isEmpty)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "LeaderboardMetricTests|LeaderboardPassTests|XPLedgerTests" 2>&1 | tail -5`
Expected: build errors — `extra argument 'metric' in call`, `value of type 'LeaderboardBoard' has no member 'passTarget'`, `cannot find 'XPLedger' in scope`.

- [ ] **Step 3: Add the metric to `Rewards/Leaderboard.swift`**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
/// What a board is being asked for. Everything the web sends, and nothing it does not: `limit`
/// and `level` go out only as their server defaults, so they are not sent at all.
public struct LeaderboardQuery: Sendable, Hashable {
```
with:

```swift
/// What a board ranks: XP earned, or the run of lessons attended right now (`?metric=STRIKES`,
/// the server's #302). The strike board ranks the RUN, never the spendable balance.
public enum LeaderboardMetric: String, Sendable, Hashable, CaseIterable {
    case xp = "XP"
    case strikes = "STRIKES"
}

/// What a board is being asked for. Everything the web sends, and nothing it does not: `limit`
/// and `level` go out only as their server defaults, so they are not sent at all.
public struct LeaderboardQuery: Sendable, Hashable {
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    public var branchId: Int?

    public init(scope: LeaderboardScope = .global, window: String = LeaderboardQuery.allTime, subject: String? = nil, branchId: Int? = nil) {
        self.scope = scope
        self.window = window
        self.subject = subject
        self.branchId = branchId
    }

    /// Whether the branch filter applies to the board being asked for.
    public var branchApplies: Bool { scope == .global && branchId != nil }

    public var queryItems: [URLQueryItem] {
        var items = [
            URLQueryItem(name: "scope", value: scope.rawValue),
            URLQueryItem(name: "window", value: window),
        ]
        if let subject, !subject.isEmpty { items.append(URLQueryItem(name: "subject", value: subject)) }
        if branchApplies, let branchId { items.append(URLQueryItem(name: "branch", value: String(branchId))) }
        return items
    }

    /// How many filters are narrowing the board — the badge on the Filters button.
    public var activeFilterCount: Int {
        (window != Self.allTime ? 1 : 0) + (subject != nil ? 1 : 0) + (branchApplies ? 1 : 0)
    }
```
with:

```swift
    public var branchId: Int?
    /// XP by default — the server's default, so it is only ever sent as `STRIKES`.
    public var metric: LeaderboardMetric

    public init(
        scope: LeaderboardScope = .global,
        window: String = LeaderboardQuery.allTime,
        subject: String? = nil,
        branchId: Int? = nil,
        metric: LeaderboardMetric = .xp
    ) {
        self.scope = scope
        self.window = window
        self.subject = subject
        self.branchId = branchId
        self.metric = metric
    }

    /// Whether the branch filter applies to the board being asked for.
    public var branchApplies: Bool { scope == .global && branchId != nil }

    public var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "scope", value: scope.rawValue)]
        if metric == .strikes {
            // A run is now, and it belongs to the student rather than to a subject: the server
            // forces all time and ignores the subject on this board, so neither is sent.
            items.append(URLQueryItem(name: "metric", value: metric.rawValue))
        } else {
            items.append(URLQueryItem(name: "window", value: window))
            if let subject, !subject.isEmpty { items.append(URLQueryItem(name: "subject", value: subject)) }
        }
        if branchApplies, let branchId { items.append(URLQueryItem(name: "branch", value: String(branchId))) }
        return items
    }

    /// How many filters are narrowing the board — the badge on the Filters button. On the strike
    /// board only the branch narrows anything.
    public var activeFilterCount: Int {
        if metric == .strikes { return branchApplies ? 1 : 0 }
        return (window != Self.allTime ? 1 : 0) + (subject != nil ? 1 : 0) + (branchApplies ? 1 : 0)
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    public let region: String?
    public let isMe: Bool

    public var id: Int { studentId }
```
with:

```swift
    public let region: String?
    public let isMe: Bool
    /// The run of lessons attended — filled on the strike board only (`xp` is 0 there).
    public let strikes: Int?

    public var id: Int { studentId }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
        region: String? = nil,
        isMe: Bool = false
    ) {
        self.rank = rank
        self.studentId = studentId
        self.name = name
        self.profileImageURL = profileImageURL
        self.xp = xp
        self.awards = awards
        self.branch = branch
        self.region = region
        self.isMe = isMe
    }

    enum CodingKeys: String, CodingKey {
        case rank, name, xp, awards, branch, region
```
with:

```swift
        region: String? = nil,
        isMe: Bool = false,
        strikes: Int? = nil
    ) {
        self.rank = rank
        self.studentId = studentId
        self.name = name
        self.profileImageURL = profileImageURL
        self.xp = xp
        self.awards = awards
        self.branch = branch
        self.region = region
        self.isMe = isMe
        self.strikes = strikes
    }

    enum CodingKeys: String, CodingKey {
        case rank, name, xp, awards, branch, region, strikes
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
        isMe = c.rewardsBool(.isMe) ?? false
    }
```
with:

```swift
        isMe = c.rewardsBool(.isMe) ?? false
        strikes = c.rewardsInt(.strikes)
    }

    /// The number this row is ranked on, on the given board.
    public func score(_ metric: LeaderboardMetric) -> Int {
        metric == .strikes ? (strikes ?? 0) : xp
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    /// First letters of the first two words, upper-cased; "?" when there are none.
```
with:

```swift
    /// The first word of a shown name — "Malika" for "Malika Karimova" — for a line that names
    /// somebody in passing. "Student" when there is nothing to show.
    public static func firstName(_ name: String) -> String {
        name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "Student"
    }

    /// First letters of the first two words, upper-cased; "?" when there are none.
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
/// `GET /api/rewards/leaderboard/`.
public struct LeaderboardBoard: Decodable, Sendable, Equatable {
    public let scope: String
```
with:

```swift
/// "120 XP to pass Malika" — the next student up, by name. Growth-oriented by construction: it
/// names the one place to take next, never the distance from the top.
public struct LeaderboardPass: Sendable, Equatable {
    public let name: String
    public let xp: Int
    public let rank: Int

    public init(name: String, xp: Int, rank: Int) {
        self.name = name
        self.xp = xp
        self.rank = rank
    }

    public var text: String { "\(xp) XP to pass \(name)" }
}

/// `GET /api/rewards/leaderboard/`.
public struct LeaderboardBoard: Decodable, Sendable, Equatable {
    /// What this board ranks — the meta the server sends back. An older server that never sent
    /// it only ever had the XP board.
    public let metric: LeaderboardMetric
    public let scope: String
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    public init(
        scope: String = LeaderboardScope.global.rawValue,
        window: String = LeaderboardQuery.allTime,
```
with:

```swift
    public init(
        metric: LeaderboardMetric = .xp,
        scope: String = LeaderboardScope.global.rawValue,
        window: String = LeaderboardQuery.allTime,
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
        my: LeaderboardRow?
    ) {
        self.scope = scope
```
with:

```swift
        my: LeaderboardRow?
    ) {
        self.metric = metric
        self.scope = scope
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
        case scope, window, subject, level, count, rows, my
```
with:

```swift
        case metric, scope, window, subject, level, count, rows, my
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
        self.init(
            scope: c.rewardsString(.scope) ?? LeaderboardScope.global.rawValue,
```
with:

```swift
        self.init(
            metric: c.rewardsString(.metric).flatMap { LeaderboardMetric(rawValue: $0.uppercased()) } ?? .xp,
            scope: c.rewardsString(.scope) ?? LeaderboardScope.global.rawValue,
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    public var goal: LeaderboardGoal? {
        guard let my else { return nil }
```
with:

```swift
    public var goal: LeaderboardGoal? {
        // An XP gap means nothing on the strike board.
        guard metric == .xp, let my else { return nil }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift` — replace:

```swift
    /// The goal, when the viewer is standing on the podium — it is shown under the podium then.
```
with:

```swift
    /// The student to pass next, by name — the Rewards hero's line.
    ///
    /// Offered only when EVERY student ranked ahead of the viewer is in this response. Ranks are
    /// competition ranks, so exactly `rank − 1` students are ahead; when all of them are here,
    /// the nearest is the one directly above. A viewer past the page with a gap the response
    /// does not show gets no line rather than a guess. A tie-mate printed above is not "above" —
    /// passing them changes no number — so the line names the nearest better rank. Nil at #1,
    /// without a standing, and on the strike board.
    public var passTarget: LeaderboardPass? {
        guard metric == .xp, let me = standing, me.rank > 1 else { return nil }
        let ahead = rows.filter { $0.rank < me.rank && $0.studentId != me.studentId }
        guard ahead.count == me.rank - 1, let above = ahead.last else { return nil }
        return LeaderboardPass(
            name: LeaderboardName.firstName(above.displayName),
            xp: max(1, above.xp - me.xp + 1),
            rank: above.rank
        )
    }

    /// The goal, when the viewer is standing on the podium — it is shown under the podium then.
```

- [ ] **Step 4: Create `Rewards/XPLedger.swift`**

**Create** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPLedger.swift`:

```swift
import Foundation

/// "Where your XP came from" — the newest earnings that added XP, from `/rewards/me/`'s history.
///
/// The history is the points ledger, so two kinds of row are left out: a conversion (it spends
/// points, and never touched XP) and an earning whose rule pays points only (a survey, since
/// 2026-09-01 — `RewardRule.grantsXP`). Without the rules — not loaded yet, or failed — every
/// earning stays: the server itself reads a missing rule as one that adds XP
/// (`rewards/constants.py::_rule_grants_xp`). The amounts are the rows' points, which is the XP
/// they added for every rule that grants XP.
public enum XPLedger {
    public static func rows(_ history: [PointAward], rules: [RewardRule]?, limit: Int = 5) -> [PointAward] {
        let pointsOnly = Set((rules ?? []).filter { !$0.grantsXP }.map(\.event))
        return Array(history.filter { $0.points > 0 && !pointsOnly.contains($0.event) }.prefix(limit))
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "LeaderboardMetricTests|LeaderboardPassTests|XPLedgerTests|LeaderboardAPITests|LeaderboardLayoutTests" 2>&1 | tail -6`
Expected: every suite passes — the three new ones (3 + 6 + 2 tests) and the existing leaderboard suites unchanged. Whole kit: `swift test 2>&1 | tail -2` → `✔ Test run with 705 tests … passed` (694 + 11).

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Rewards/Leaderboard.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPLedger.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/RewardsTabTests.swift
git commit -m "feat(ios-kit): the strike board, the student to pass next, and where XP came from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: "While you were away" in the kit (`LastSeen`, `LastSeenBook`, `WelcomeBack`, away flights in `CelebrationQueue`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Rewards/LastSeen.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/WelcomeBackTests.swift`

**Interfaces:**
- Consumes: `CelebrationQueue`, `FinishedWork`, `XPDelta` (Task 12); `PointAward` (existing).
- Produces: `public struct LastSeen: Codable { var xp: Int; var streak: Int; var rank: Int?; var newestAwardID: Int? }`; `public struct LastSeenBook { init(defaults: UserDefaults = .standard); static func key(userID:) -> String; func read(userID:) -> LastSeen?; func write(_:userID:) }`; `public struct Rise: Equatable { from: Int; to: Int }`; `public enum WelcomeBack { static func streak(seen: LastSeen?, now: Int) -> Rise?; static func rank(seen: Int?, now: Int?) -> Rise?; static func readsRank(seen: LastSeen?, xpNow: Int) -> Bool; static func label(history: [PointAward], since: Int?) -> String? }`; on `CelebrationQueue`: `Flight.label: String?`, `recordAway(xpSeen: Int?) -> Int`, `@discardableResult resolve(_:xpAfter:allowsFlights:label: String? = nil) -> Int` (the measured gain; the old three-argument statement still compiles), `held(xpNow: Int?) -> Int`.

Why these shapes (read before coding):
- **Where the baseline lives — `UserDefaults`, one small JSON value per student** (`rewards.lastSeen.v1.<userID>`). Four integers do not justify a file (no directory, no atomic-write or migration code), `UserDefaults` survives relaunch and app updates, it is what Today's "fresh result" already uses per student (`today.seenResults.<id>`), and the tests run it against a throwaway suite. Keyed by user id, so a second account on the phone never inherits the first one's numbers.
- **No double count.** An away entry is an ordinary queue entry: `xpBefore` = the XP last seen, measured by the next `/rewards/me/` read. `measuredUpTo` already stops two entries from claiming one rise, so an away entry and a homework whose refreshes read the same total fly that gain once, whichever resolves first.
- **No dip (phase 2 hand-off).** Today the pill shows `xp − held`, and `held` only grows when an entry RESOLVES — so a refresh that lands first (the launch refresh, the scene-active refresh, the Rewards hub) shows the new total, then the entry's resolve holds it back and the pill dips, then the flight lands and it rises again. `held(xpNow:)` also holds any rise above the lowest floor a still-pending entry will measure from, so the pill never shows a gain that a flight is about to bring. Confirmed gains sit below `measuredUpTo` and pending floors at or above it, so nothing is counted twice.
- **Never a decrease, never on the first launch:** `XPDelta.gain` is 0 for a drop and for an unknown start; `WelcomeBack.streak` / `.rank` are nil without a baseline and for anything that did not improve.

- [ ] **Step 1: Write the failing test**

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/WelcomeBackTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct LastSeenBookTests {

    private func scratch() -> (UserDefaults, String) {
        let name = "lastseen-tests-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test("Nothing stored reads as no baseline; what was written reads back, per student")
    func roundTrip() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = LastSeenBook(defaults: defaults)
        #expect(book.read(userID: 7) == nil)

        let seen = LastSeen(xp: 120, streak: 4, rank: 57, newestAwardID: 901)
        book.write(seen, userID: 7)
        #expect(book.read(userID: 7) == seen)
        #expect(book.read(userID: 8) == nil, "another account on the phone starts with no baseline")
        #expect(LastSeenBook.key(userID: 7) == "rewards.lastSeen.v1.7")
    }

    @Test("A value that will not decode is no baseline, not a crash")
    func corrupt() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(Data("not json".utf8), forKey: LastSeenBook.key(userID: 3))
        #expect(LastSeenBook(defaults: defaults).read(userID: 3) == nil)
    }
}

@Suite struct WelcomeBackTests {

    private func award(_ id: Int, _ label: String, _ points: Int) -> PointAward {
        PointAward(id: id, event: "E\(id)", label: label, points: points, awardedAt: "2026-10-20T10:00:00Z")
    }

    @Test("The streak grew: from what was seen to now. Nothing without a baseline, or for a run that stayed or restarted")
    func streak() {
        let seen = LastSeen(xp: 100, streak: 4, rank: nil, newestAwardID: nil)
        #expect(WelcomeBack.streak(seen: seen, now: 6) == Rise(from: 4, to: 6))
        #expect(WelcomeBack.streak(seen: seen, now: 4) == nil)
        #expect(WelcomeBack.streak(seen: seen, now: 1) == nil)
        #expect(WelcomeBack.streak(seen: nil, now: 6) == nil)
    }

    @Test("A better place is a smaller number; unknown, the same or a lower place is not celebrated")
    func rank() {
        #expect(WelcomeBack.rank(seen: 60, now: 55) == Rise(from: 60, to: 55))
        #expect(WelcomeBack.rank(seen: 55, now: 55) == nil)
        #expect(WelcomeBack.rank(seen: 55, now: 61) == nil)
        #expect(WelcomeBack.rank(seen: nil, now: 3) == nil)
        #expect(WelcomeBack.rank(seen: 9, now: nil) == nil)
    }

    @Test("The board is read only when the place can have improved — XP rose — or was never read")
    func readsRank() {
        let seen = LastSeen(xp: 100, streak: 4, rank: 57, newestAwardID: nil)
        #expect(WelcomeBack.readsRank(seen: seen, xpNow: 130))
        #expect(!WelcomeBack.readsRank(seen: seen, xpNow: 100))
        #expect(!WelcomeBack.readsRank(seen: seen, xpNow: 90))
        #expect(WelcomeBack.readsRank(seen: nil, xpNow: 0), "the first launch records a baseline")
        let neverRanked = LastSeen(xp: 100, streak: 4, rank: nil, newestAwardID: nil)
        #expect(WelcomeBack.readsRank(seen: neverRanked, xpNow: 100))
        let noXP = LastSeen(xp: 0, streak: 0, rank: nil, newestAwardID: nil)
        #expect(!WelcomeBack.readsRank(seen: noXP, xpNow: 0), "no XP, no place on the board")
    }

    @Test("The flight names the newest earning since it was last seen, and counts the rest")
    func label() {
        let history = [award(9, "Homework", 15), award(8, "Converted to coins", -30), award(7, "Attendance", 5), award(5, "Attendance", 5)]
        #expect(WelcomeBack.label(history: history, since: 7) == "Homework")
        #expect(WelcomeBack.label(history: history, since: 6) == "Homework + 1 more")
        #expect(WelcomeBack.label(history: history, since: nil) == "Homework + 2 more")
        #expect(WelcomeBack.label(history: history, since: 9) == nil, "a rise on a row already seen has no new row to name")
        #expect(WelcomeBack.label(history: [award(4, "", 5)], since: nil) == "Earned while you were away")
    }
}

/// Every mutating call on its own line, never inside `#expect` (as `CelebrationQueueTests`).
@Suite struct AwayFlightTests {

    @Test("An away gain flies with its label and plays no check")
    func flies() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        let efforts = queue.takeEfforts(stageVisible: true)
        #expect(efforts.isEmpty, "nothing was handed in, so there is no check")
        let gained = queue.resolve(away, xpAfter: 130, allowsFlights: true, label: "Attendance + 1 more")
        #expect(gained == 30)
        #expect(queue.held == 30)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 30)
        #expect(flight?.label == "Attendance + 1 more")
        if let flight { queue.land(flight.id) }
        #expect(queue.isEmpty)
    }

    @Test("A refresh that lands before the entry resolves is held at once — the pill never dips")
    func noDip() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        #expect(queue.held(xpNow: nil) == 0)
        #expect(queue.held(xpNow: 130) == 30, "the launch refresh landed first: still shows 100")
        queue.resolve(away, xpAfter: 130, allowsFlights: true)
        #expect(queue.held(xpNow: 130) == 30, "resolving changes nothing on screen")
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        if let flight { queue.land(flight.id) }
        #expect(queue.held(xpNow: 130) == 0)

        let task = queue.record(.homework, xpBefore: 130, stageVisible: true).id
        #expect(queue.held(xpNow: 145) == 15, "a scene-active refresh beat the task's own")
        queue.resolve(task, xpAfter: 145, allowsFlights: true)
        #expect(queue.held(xpNow: 145) == 15)
    }

    @Test("An away entry and a task measured against the same total count the gain once")
    func noDoubleCount() {
        var queue = CelebrationQueue()
        let away = queue.recordAway(xpSeen: 100)
        let task = queue.record(.homework, xpBefore: 100, stageVisible: true).id
        #expect(queue.held(xpNow: 115) == 15)
        queue.resolve(away, xpAfter: 115, allowsFlights: true, label: "Homework")
        queue.resolve(task, xpAfter: 115, allowsFlights: true)
        #expect(queue.held == 15)
        let flight = queue.takeFlight(stageVisible: true, pillVisible: true, allowsFlights: true)
        #expect(flight?.amount == 15)
        #expect(flight?.label == "Homework")

        var reversed = CelebrationQueue()
        let first = reversed.record(.homework, xpBefore: 100, stageVisible: true).id
        let second = reversed.recordAway(xpSeen: 100)
        reversed.resolve(first, xpAfter: 115, allowsFlights: true)
        reversed.resolve(second, xpAfter: 115, allowsFlights: true, label: "Homework")
        #expect(reversed.held == 15)
    }

    @Test("First launch, a drop, a failed read, Reduce Motion: nothing is held and nothing flies")
    func nothing() {
        let cases: [(Int?, Int?, Bool)] = [(nil, 130, true), (130, 120, true), (100, nil, true), (100, 130, false)]
        for (seen, after, flights) in cases {
            var queue = CelebrationQueue()
            let away = queue.recordAway(xpSeen: seen)
            let gained = queue.resolve(away, xpAfter: after, allowsFlights: flights)
            #expect(gained == (flights ? 0 : 30), "Reduce Motion still measures the gain, for VoiceOver")
            #expect(queue.held == 0)
            #expect(queue.held(xpNow: 130) == 0)
            #expect(queue.isEmpty)
        }
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "LastSeenBookTests|WelcomeBackTests|AwayFlightTests" 2>&1 | tail -5`
Expected: build errors — `cannot find 'LastSeenBook' in scope`, `value of type 'CelebrationQueue' has no member 'recordAway'`.

- [ ] **Step 3: Create `Rewards/LastSeen.swift`**

**Create** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/LastSeen.swift`:

```swift
import Foundation

/// What the header last showed this student — the baseline "while you were away" measures from.
///
/// "Seen" means shown: XP still held for a flight that has not landed is not seen yet, so the
/// app writes the number on the pill, not the server's.
public struct LastSeen: Codable, Sendable, Equatable {
    public var xp: Int
    /// The run of lessons attended, as the flame showed it.
    public var streak: Int
    /// The place on the default board (global, all time, XP). Nil until a board has been read.
    public var rank: Int?
    /// The newest `/rewards/me/` history row when this was written — what the flight's label
    /// counts new earnings from.
    public var newestAwardID: Int?

    public init(xp: Int, streak: Int, rank: Int?, newestAwardID: Int?) {
        self.xp = xp
        self.streak = streak
        self.rank = rank
        self.newestAwardID = newestAwardID
    }
}

/// The baseline on the phone, one small JSON value per student in `UserDefaults`.
///
/// Four numbers: a file would add a directory, atomic writes and a migration story for nothing,
/// and `UserDefaults` already survives relaunches and updates. Keyed by user id, so a second
/// account on the same phone starts with no baseline and celebrates nothing on its first launch.
/// A value that will not decode reads as no baseline — never a crash, never a celebration.
public struct LastSeenBook {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(userID: Int) -> String { "rewards.lastSeen.v1.\(userID)" }

    public func read(userID: Int) -> LastSeen? {
        guard let data = defaults.data(forKey: Self.key(userID: userID)) else { return nil }
        return try? JSONDecoder().decode(LastSeen.self, from: data)
    }

    public func write(_ seen: LastSeen, userID: Int) {
        guard let data = try? JSONEncoder().encode(seen) else { return }
        defaults.set(data, forKey: Self.key(userID: userID))
    }
}

/// A number that went the right way: a longer streak, or a better place (a smaller rank).
public struct Rise: Sendable, Equatable {
    public let from: Int
    public let to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

/// "While you were away" — what improved since the student last saw it. The XP part is not here:
/// it is measured by `CelebrationQueue` like every other confirmed gain (`recordAway`).
///
/// Nothing is ever celebrated without a baseline (the first launch on this phone), and nothing
/// that went down is ever named: a restarted run or a lower place is simply the new baseline.
public enum WelcomeBack {
    public static func streak(seen: LastSeen?, now: Int) -> Rise? {
        guard let seen, now > seen.streak else { return nil }
        return Rise(from: seen.streak, to: now)
    }

    public static func rank(seen: Int?, now: Int?) -> Rise? {
        guard let seen, let now, now < seen else { return nil }
        return Rise(from: seen, to: now)
    }

    /// Whether the welcome-back check reads the board: a place can only improve through the
    /// student's own XP, so only when XP rose — or to take a first baseline. A student with no
    /// XP has no place on the board (`rank_of` is null), so there is nothing to read.
    public static func readsRank(seen: LastSeen?, xpNow: Int) -> Bool {
        guard let seen else { return true }
        return xpNow > seen.xp || (seen.rank == nil && xpNow > 0)
    }

    /// The flight's caption: the newest earning since the baseline ("Attendance"), and how many
    /// more came with it. Nil when no new row explains the rise — a homework re-graded upward
    /// changes its own row rather than adding one — and the flight then flies without a caption.
    public static func label(history: [PointAward], since: Int?) -> String? {
        let fresh = history.filter { $0.points > 0 && $0.id > (since ?? Int.min) }
        guard let newest = fresh.first else { return nil }
        let name = newest.label.isEmpty ? "Earned while you were away" : newest.label
        return fresh.count == 1 ? name : "\(name) + \(fresh.count - 1) more"
    }
}
```

- [ ] **Step 4: Teach `Motion/CelebrationQueue.swift` away entries, labels and `held(xpNow:)`**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
    public struct Flight: Sendable, Equatable, Identifiable {
        public let id: Int
        public let amount: Int
    }

    struct Entry: Sendable, Equatable {
        let id: Int
        let work: FinishedWork
        let xpBefore: Int?
        var effortShown: Bool
        /// Nil while the refresh is out; 0 once it said nothing was earned, or nothing may fly.
        var gain: Int?
    }
```
with:

```swift
    public struct Flight: Sendable, Equatable, Identifiable {
        public let id: Int
        public let amount: Int
        /// A caption under "+N XP" — set by a "while you were away" gain, nil for a task's.
        public let label: String?
    }

    struct Entry: Sendable, Equatable {
        let id: Int
        /// Nil for a "while you were away" gain: nothing was handed in, so there is no check.
        let work: FinishedWork?
        let xpBefore: Int?
        var effortShown: Bool
        /// Nil while the refresh is out; 0 once it said nothing was earned, or nothing may fly.
        var gain: Int?
        var label: String?
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
    public var isEmpty: Bool { entries.isEmpty && flying.isEmpty }
```
with:

```swift
    /// XP the header holds back, given the total it shows the server's word for now: `held`,
    /// plus any rise above the lowest floor a still-pending entry will measure from. A refresh
    /// that lands before an entry resolves is then held at once, instead of showing and dipping
    /// back when the entry resolves (phase 2 hand-off).
    public func held(xpNow: Int?) -> Int {
        guard let xpNow, let floor = pendingFloor else { return held }
        return held + max(0, xpNow - floor)
    }

    /// The lowest total a pending entry will measure its gain from (`resolve`'s floor).
    private var pendingFloor: Int? {
        entries
            .filter { $0.gain == nil }
            .compactMap { entry in entry.xpBefore.map { max($0, measuredUpTo ?? $0) } }
            .min()
    }

    public var isEmpty: Bool { entries.isEmpty && flying.isEmpty }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
        entries.append(Entry(id: id, work: work, xpBefore: xpBefore, effortShown: stageVisible, gain: nil))
        return (id, stageVisible)
    }
```
with:

```swift
        entries.append(Entry(id: id, work: work, xpBefore: xpBefore, effortShown: stageVisible, gain: nil, label: nil))
        return (id, stageVisible)
    }

    /// "While you were away": XP the student has not seen, measured from what the header last
    /// showed them (`xpSeen`, nil on the first launch) by the read that is about to go out.
    /// Recorded BEFORE that read, so a rise landing meanwhile is held at once. No check, no
    /// confetti — only a flight, once `resolve` says what was gained.
    @discardableResult
    public mutating func recordAway(xpSeen: Int?) -> Int {
        let id = nextID
        nextID += 1
        entries.append(Entry(id: id, work: nil, xpBefore: xpSeen, effortShown: true, gain: nil, label: nil))
        return id
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
        for index in entries.indices where !entries[index].effortShown {
            entries[index].effortShown = true
            shown.append(entries[index].work)
        }
```
with:

```swift
        for index in entries.indices where !entries[index].effortShown {
            entries[index].effortShown = true
            if let work = entries[index].work { shown.append(work) }
        }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
    /// The refresh after a task came back. Nothing earned — or no flights allowed — holds nothing.
    public mutating func resolve(_ id: Int, xpAfter: Int?, allowsFlights: Bool) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let floor = entries[index].xpBefore.map { max($0, measuredUpTo ?? $0) }
        let gain = XPDelta.gain(before: floor, after: xpAfter)
        if let xpAfter { measuredUpTo = max(measuredUpTo ?? xpAfter, xpAfter) }
        entries[index].gain = allowsFlights ? gain : 0
        dropSettled()
    }
```
with:

```swift
    /// The refresh after a task came back. Nothing earned — or no flights allowed — holds nothing.
    /// `label` captions the flight (a "while you were away" gain names what was earned). Returns
    /// the gain it measured — also under Reduce Motion, where nothing is held, so the app can
    /// still say it to VoiceOver.
    @discardableResult
    public mutating func resolve(_ id: Int, xpAfter: Int?, allowsFlights: Bool, label: String? = nil) -> Int {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return 0 }
        let floor = entries[index].xpBefore.map { max($0, measuredUpTo ?? $0) }
        let gain = XPDelta.gain(before: floor, after: xpAfter)
        if let xpAfter { measuredUpTo = max(measuredUpTo ?? xpAfter, xpAfter) }
        entries[index].gain = allowsFlights ? gain : 0
        if let label { entries[index].label = label }
        dropSettled()
        return gain
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift` — replace:

```swift
        let flight = Flight(id: nextID, amount: ready.reduce(0) { $0 + ($1.gain ?? 0) })
```
with:

```swift
        let flight = Flight(
            id: nextID,
            amount: ready.reduce(0) { $0 + ($1.gain ?? 0) },
            label: ready.last(where: { $0.label != nil })?.label
        )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "LastSeenBookTests|WelcomeBackTests|AwayFlightTests|CelebrationQueueTests|XPTruthTests" 2>&1 | tail -6`
Expected: `LastSeenBookTests` (2), `WelcomeBackTests` (4), `AwayFlightTests` (4) pass, and the phase-2 `CelebrationQueueTests` / `XPTruthTests` still pass unchanged. Whole kit: `✔ Test run with 715 tests … passed` (705 + 10).

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Rewards/LastSeen.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationQueue.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/WelcomeBackTests.swift
git commit -m "feat(ios-kit): what improved while you were away — per student, flown once, never a dip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Words' "Review today" in the kit (`VocabReview`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabReview.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/VocabReviewTests.swift`

**Interfaces:**
- Consumes: `VocabSection` (its `wordCount`, `progress.mastered`), `VocabHomeworkGroup` / `VocabSetSummary` (`mastery.isMastered`, `masteredModes`, `totalModes`), `VocabSectionDetail.SetRow` (`progress`), `JSONCoding.parseServerDate` — all existing.
- Produces: `public struct VocabReview: Equatable { wordsToMaster: Int; wordsMastered: Int; next: Next; init(sections:homework:) ; static func bestSet(in: VocabSectionDetail) -> VocabSectionDetail.SetRow? }`; `public enum VocabReview.Next: Equatable { case homework(HomeworkSet), section(id: Int, title: String, wordsToMaster: Int), caughtUp, nothingYet }`; `public struct VocabReview.HomeworkSet: Equatable { setId, title, assignmentId, assignmentTitle, dueAt: String?, wordCount, gamesLeft }`.

Why this shape (the honest number): the server has **no spaced repetition and no "learning" bucket** — a word is `new` or `mastered` (`VocabWordStatus`), and nothing is "due today". The one word count the hub already loads that is true is per section: words minus words mastered (the same two numbers the old hub totals added). So the hero says **"N words still to master"** (never "due"), and Start opens ONE existing study page:
1. the word-homework set due soonest that is not mastered (a passed deadline counts as soonest — catch-up first, as on Today; same deadline → the order the server sent);
2. with none, the bank section with the most words still to master — Start reads that section once and opens its set with the most words still to master (`bestSet`); the hub holds no per-set word counts, so this is the only honest way to pick "the set with the most";
3. with nothing left to master, **all caught up** — a state, not an error; and with no words anywhere (nothing published, no homework), **nothing yet**.
The student's own sets are never Start's target: they carry no word progress (`VocabMySet`), and their words are bank words, so they are mastered when the bank's are.

- [ ] **Step 1: Write the failing test**

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/VocabReviewTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct VocabReviewTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    private func section(_ id: Int, words: Int, mastered: Int) -> String {
        #"{"id":\#(id),"title":"Section \#(id)","set_count":2,"word_count":\#(words),"progress":{"new":\#(words - mastered),"mastered":\#(mastered),"total":\#(words)}}"#
    }

    private func set(_ id: Int, mastered: Int, words: Int = 10) -> String {
        let modes = ["flashcard", "matching", "speed", "test"].enumerated()
            .map { #""\#($0.element)":\#($0.offset < mastered)"# }.joined(separator: ",")
        return #"{"id":\#(id),"title":"Set \#(id)","word_count":\#(words),"completed":\#(mastered > 0),"mastery":{"modes":{\#(modes)}}}"#
    }

    private func group(_ id: Int, due: String?, _ sets: [String]) -> String {
        let dueJSON = due.map { #""\#($0)""# } ?? "null"
        return #"{"assignment_id":\#(id),"assignment_title":"Homework \#(id)","classroom_id":1,"classroom_name":"English","due_at":\#(dueJSON),"sets":[\#(sets.joined(separator: ","))]}"#
    }

    @Test("The count is the bank's words still to master — exact, from the sections")
    func count() throws {
        let sections = try decode([VocabSection].self, "[\(section(1, words: 100, mastered: 40)),\(section(2, words: 50, mastered: 50))]")
        let review = VocabReview(sections: sections, homework: [])
        #expect(review.wordsToMaster == 60)
        #expect(review.wordsMastered == 90)
    }

    @Test("Start opens the word homework due soonest that is not mastered — catch-up first")
    func homeworkFirst() throws {
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(10, due: "2026-10-25T18:00:00Z", [set(1, mastered: 4), set(2, mastered: 1, words: 12)])),
         \(group(11, due: "2026-10-19T18:00:00Z", [set(3, mastered: 2)])),
         \(group(12, due: nil, [set(4, mastered: 0)]))]
        """)
        let review = VocabReview(sections: [], homework: homework)
        let expected = VocabReview.HomeworkSet(
            setId: 3, title: "Set 3", assignmentId: 11, assignmentTitle: "Homework 11",
            dueAt: "2026-10-19T18:00:00Z", wordCount: 10, gamesLeft: 2
        )
        #expect(review.next == .homework(expected))
    }

    @Test("A mastered set is never the target; no deadline comes last")
    func skipsMastered() throws {
        let homework = try decode([VocabHomeworkGroup].self, """
        [\(group(12, due: nil, [set(4, mastered: 1)])), \(group(10, due: "2026-10-25T18:00:00Z", [set(1, mastered: 4)]))]
        """)
        guard case .homework(let next) = VocabReview(sections: [], homework: homework).next else {
            Issue.record("expected a homework target")
            return
        }
        #expect(next.setId == 4)
        #expect(next.gamesLeft == 3)
    }

    @Test("No homework owed: the section with the most words still to master")
    func sectionNext() throws {
        let sections = try decode([VocabSection].self, "[\(section(1, words: 100, mastered: 90)),\(section(2, words: 80, mastered: 20)),\(section(3, words: 60, mastered: 0))]")
        let homework = try decode([VocabHomeworkGroup].self, "[\(group(10, due: nil, [set(1, mastered: 4)]))]")
        #expect(VocabReview(sections: sections, homework: homework).next == .section(id: 2, title: "Section 2", wordsToMaster: 60))
    }

    @Test("Everything mastered is all caught up; no words anywhere is nothing yet — neither is an error")
    func endStates() throws {
        let done = try decode([VocabSection].self, "[\(section(1, words: 30, mastered: 30))]")
        #expect(VocabReview(sections: done, homework: []).next == .caughtUp)
        let finishedHomework = try decode([VocabHomeworkGroup].self, "[\(group(10, due: nil, [set(1, mastered: 4)]))]")
        #expect(VocabReview(sections: [], homework: finishedHomework).next == .caughtUp)
        #expect(VocabReview(sections: [], homework: []).next == .nothingYet)
    }

    @Test("Inside a section, the set with the most words still to master; ties keep the server's order")
    func bestSet() throws {
        let detail = try decode(VocabSectionDetail.self, #"""
        {"id":2,"title":"Section 2","sets":[
          {"id":21,"title":"A","order":0,"word_count":10,"progress":{"mastered":10,"total":10}},
          {"id":22,"title":"B","order":1,"word_count":12,"progress":{"mastered":4,"total":12}},
          {"id":23,"title":"C","order":2,"word_count":9,"progress":{"mastered":1,"total":9}}]}
        """#)
        #expect(VocabReview.bestSet(in: detail)?.id == 22)

        let allDone = try decode(VocabSectionDetail.self, #"""
        {"id":2,"title":"S","sets":[{"id":21,"title":"A","word_count":5,"progress":{"mastered":5,"total":5}}]}
        """#)
        #expect(VocabReview.bestSet(in: allDone) == nil)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter VocabReviewTests 2>&1 | tail -5`
Expected: build error `cannot find 'VocabReview' in scope`.

- [ ] **Step 3: Implement `Vocabulary/VocabReview.swift`**

**Create** `ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabReview.swift`:

```swift
import Foundation

/// The Words tab's "Review today": how many words are still to master, and the one set Start
/// opens.
///
/// There is no spaced repetition on the server and no "learning" bucket — a word is new or
/// mastered — so nothing is ever "due". The count is the bank's words not yet mastered (exact,
/// per section, from the hub's own load), and Start opens the most useful set: the word
/// homework due soonest that is not mastered; else the bank section with the most words still
/// to master (Start reads it and opens its set with the most — `bestSet`); else all caught up.
/// The student's own sets are never the target: they carry no word progress, and their words
/// are bank words.
public struct VocabReview: Equatable, Sendable {
    public struct HomeworkSet: Equatable, Sendable {
        public let setId: Int
        public let title: String
        public let assignmentId: Int
        public let assignmentTitle: String
        public let dueAt: String?
        public let wordCount: Int
        /// Games still to play clean — the number the set card shows as "n/4 games".
        public let gamesLeft: Int

        public init(setId: Int, title: String, assignmentId: Int, assignmentTitle: String, dueAt: String?, wordCount: Int, gamesLeft: Int) {
            self.setId = setId
            self.title = title
            self.assignmentId = assignmentId
            self.assignmentTitle = assignmentTitle
            self.dueAt = dueAt
            self.wordCount = wordCount
            self.gamesLeft = gamesLeft
        }
    }

    public enum Next: Equatable, Sendable {
        case homework(HomeworkSet)
        case section(id: Int, title: String, wordsToMaster: Int)
        /// Every word there is to learn is mastered — a state to be proud of, not an error.
        case caughtUp
        /// Nothing published and no word homework: nothing to review yet.
        case nothingYet
    }

    public let wordsToMaster: Int
    public let wordsMastered: Int
    public let next: Next

    public init(sections: [VocabSection], homework: [VocabHomeworkGroup]) {
        var toMaster = 0
        var mastered = 0
        var richest: (id: Int, title: String, left: Int)?
        for section in sections {
            let left = max(0, section.wordCount - section.progress.mastered)
            toMaster += left
            mastered += section.progress.mastered
            if left > 0, left > (richest?.left ?? 0) {
                richest = (section.id, section.title, left)
            }
        }
        wordsToMaster = toMaster
        wordsMastered = mastered

        // Due soonest first; a passed deadline is the soonest of all; no deadline is last; the
        // server's own order breaks ties.
        var owed: [(due: Date, order: Int, set: HomeworkSet)] = []
        for group in homework {
            let due = group.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            for set in group.sets where !set.mastery.isMastered {
                owed.append((due, owed.count, HomeworkSet(
                    setId: set.id,
                    title: set.title,
                    assignmentId: group.assignmentId,
                    assignmentTitle: group.assignmentTitle,
                    dueAt: group.dueAt,
                    wordCount: set.wordCount,
                    gamesLeft: max(0, set.mastery.totalModes - set.mastery.masteredModes)
                )))
            }
        }
        if let first = owed.min(by: { ($0.due, $0.order) < ($1.due, $1.order) }) {
            next = .homework(first.set)
        } else if let richest {
            next = .section(id: richest.id, title: richest.title, wordsToMaster: richest.left)
        } else if mastered > 0 || homework.contains(where: { !$0.sets.isEmpty }) {
            next = .caughtUp
        } else {
            next = .nothingYet
        }
    }

    /// The set in an opened section with the most words still to master; the server's order
    /// breaks ties. Nil when every word in it is mastered.
    public static func bestSet(in detail: VocabSectionDetail) -> VocabSectionDetail.SetRow? {
        var best: (row: VocabSectionDetail.SetRow, left: Int)?
        for row in detail.sets {
            let total = row.progress.total > 0 ? row.progress.total : row.wordCount
            let left = max(0, total - row.progress.mastered)
            if left > 0, left > (best?.left ?? 0) { best = (row, left) }
        }
        return best?.row
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter VocabReviewTests 2>&1 | tail -3`
Expected: `✔ Suite VocabReviewTests passed` (6 tests). Whole kit: `✔ Test run with 721 tests … passed` (715 + 6).

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabReview.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/VocabReviewTests.swift
git commit -m "feat(ios-kit): Review today — words still to master, and the one set Start opens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Two new Lottie files, the byte budget, and look "B" (`coin-burst`, `star-burst`, `ChunkySurface`)

**Files:**
- Modify: `ios/tools/lottie/make-lottie.mjs`
- Create (generated): `ios/MasterSAT/Resources/Lottie/coin-burst.json`, `ios/MasterSAT/Resources/Lottie/star-burst.json`
- Modify: `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift` (`LottieAsset`)
- Create: `ios/MasterSAT/Sources/Support/Chunky.swift`

**Interfaces:**
- Consumes: the generator's helpers (`A`, `S`, `P`, `sh`, `fl`, `st`, `tr`, `gr`, `el`, `star`, `rp`, `tm`, `L`, `anim`, `twinkle`, `POP`, `OUTE`, `LIN`); `Theme`, `Motion`.
- Produces: `LottieAsset.coinBurst` (`coin-burst`, plays once, ends faded out — a shop purchase or a conversion), `LottieAsset.starBurst` (`star-burst`, plays once, ends faded out — behind the trophy when the student moves up a place); the generator refuses any file over **15 000 bytes** (phase 1 kit-polish item); `struct ChunkySurface: ViewModifier`, `extension View { func chunky(_ tint: Color, radius: CGFloat = Theme.Radius.card) -> some View }`, `struct ChunkyButtonStyle: ButtonStyle { init(tint: Color) }`.

Rules for this task: Lottie is generated, never hand-edited (`node ios/tools/lottie/make-lottie.mjs`); the three phase-1 files must regenerate **byte-identical** (`git status` shows them unchanged). Look "B" is ONLY for motivation surfaces — the Rewards hero, the streak and coins cards, the student's own leaderboard row, celebration moments; everything else stays look A (`cardStyle`). Reduce Motion: a B press does not move, it dips in opacity (as `PressFeedback`).

- [ ] **Step 1: Add the two animations and the budget to the generator**

**Edit** `ios/tools/lottie/make-lottie.mjs` — replace:

```js
mkdirSync(OUT, { recursive: true });
for (const data of [FLAME, CHECK, TROPHY]) {
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, data.nm + '.json'), json);
  console.log(data.nm, json.length, 'bytes');
}
```
with:

```js
// Coin burst — plays once, then fades. A coin pops in, flips once, and small coins and sparks
// fly out. Played where a purchase or a conversion was confirmed.
const coin = s => [
  gr([el(s * .5, s * .12), fl('#fff7d6', 70)], tr({ p: S([-s * .12, -s * .26]), r: S(-24) })),
  gr([star(5, s * .1, s * .22), fl('#fff7d6')]),
  gr([el(s * .72, s * .72), st('#f59e0b', s * .07)]),
  gr([el(s, s), fl('#fbbf24')]),
  gr([el(s, s), fl('#d97706')], tr({ p: S([0, s * .07]) })),
];
const flyer = (hex, size, from, to, rot, d) => gr([
  gr([el(size, size), fl(hex)], tr({
    p: A([[d, [0, -from]], [d + 30, [0, -to]]], OUTE),
    s: A([[d, [0, 0]], [d + 6, [100, 100]], [d + 22, [100, 100]], [d + 34, [0, 0]]]),
  })),
  rp(8, 45),
], tr({ r: S(rot) }));
const COIN = anim('coin-burst', 84, [
  L(1, 'coin', coin(84), {
    s: A([[0, [0, 0, 100], POP], [14, [116, 116, 100]], [22, [100, 100, 100]], [34, [100, 100, 100]], [42, [12, 100, 100]], [50, [100, 100, 100]]]),
    o: A([[60, 100], [82, 0]]),
  }),
  L(2, 'coins', [flyer('#fbbf24', 15, 38, 92, 0, 6), flyer('#f59e0b', 9, 32, 70, 22.5, 12)]),
  L(3, 'sparks', [gr([sh(S(P([[0, -48], [0, -66]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false))),
    tm(A([[10, 0], [26, 100]], OUTE), A([[4, 0], [18, 100]], OUTE)), st('#fde68a', 5), rp(8, 45)])], { r: S(22.5) }),
]);

// Star burst — plays once, then fades. A glow swells, rays turn, a ring of stars flies out and
// a few twinkle. Played behind the trophy when the student moves up a place.
const STARS = anim('star-burst', 100, [
  L(1, 'twinkles', [twinkle(-70, -60, 30, '#fbbf24', 11), twinkle(72, -48, 44, '#2a68c0', 9),
    twinkle(60, 66, 58, '#fbbf24', 10), twinkle(-62, 58, 70, '#2a68c0', 8)]),
  L(2, 'stars', [gr([
    gr([star(5, 4, 10), fl('#fbbf24')], tr({
      p: A([[6, [0, -26]], [42, [0, -90]]], OUTE),
      s: A([[6, [0, 0]], [16, [110, 110]], [56, [100, 100]], [78, [0, 0]]]),
      r: A([[6, 0], [70, 120]]),
    })),
    rp(8, 45),
  ])]),
  L(3, 'rays', [gr([sh(S(P([[-7, -34], [7, -34], [0, -98]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]]))), fl('#fbbf24', 34), rp(12, 30)])],
    { r: A([[0, 0], [100, 40]], LIN), s: A([[0, [0, 0, 100], POP], [24, [100, 100, 100]]]), o: A([[70, 100], [98, 0]]) }),
  L(4, 'glow', [gr([el(120, 120), fl('#fde68a', 40)])],
    { s: A([[0, [0, 0, 100], POP], [18, [130, 130, 100]], [40, [100, 100, 100]]]), o: A([[0, 0], [6, 100], [74, 100], [98, 0]]) }),
]);

// Every file is decoded on the main thread when its view appears: keep each one small.
const BUDGET = 15000;
mkdirSync(OUT, { recursive: true });
for (const data of [FLAME, CHECK, TROPHY, COIN, STARS]) {
  const json = JSON.stringify(data);
  if (json.length > BUDGET) throw new Error(`${data.nm} is ${json.length} bytes — over the ${BUDGET}-byte budget`);
  writeFileSync(join(OUT, data.nm + '.json'), json);
  console.log(data.nm, json.length, 'bytes');
}
```

- [ ] **Step 2: Generate, and check the old three did not move**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
node ios/tools/lottie/make-lottie.mjs
git status --short ios/MasterSAT/Resources/Lottie
```
Expected: five lines `<name> <n> bytes`, every n under 15000 (coin-burst ≈ 6.1 KB, star-burst ≈ 6.6 KB); `git status` lists ONLY `?? …/coin-burst.json` and `?? …/star-burst.json` — the phase-1 files regenerate byte-identical. Open each new file in a Lottie previewer only if one is at hand; the simulator check is Task 29.

- [ ] **Step 3: Name them in `LottieAsset`**

**Edit** `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift` — replace:

```swift
    case taskComplete = "task-complete"
    case trophy
}
```
with:

```swift
    case taskComplete = "task-complete"
    case trophy
    /// Plays once and fades: a purchase or a conversion went through.
    case coinBurst = "coin-burst"
    /// Plays once and fades, behind the trophy: the student moved up a place.
    case starBurst = "star-burst"
}
```

- [ ] **Step 4: Create look "B" — `Support/Chunky.swift`**

**Create** `ios/MasterSAT/Sources/Support/Chunky.swift`:

```swift
import SwiftUI

/// Look "B": chunky, with a thick lower edge in the surface's own colour — the owner's
/// "pressable" look. ONLY on motivation surfaces: the Rewards hero, the streak and coins cards,
/// the student's own leaderboard row, celebration moments. Everything else is look A
/// (`cardStyle`), so B keeps meaning "this is yours, and it's worth something".
///
/// The edge is drawn below the face and the bottom padding makes room for it, so a chunky card
/// never overlaps what follows it.
struct ChunkySurface: ViewModifier {
    static let edge: CGFloat = 4

    let tint: Color
    var radius: CGFloat = Theme.Radius.card
    /// Pressed: the face sinks onto its edge.
    var pressed = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(Theme.card, in: shape)
            .overlay(shape.strokeBorder(tint.opacity(0.35), lineWidth: 2))
            .offset(y: pressed ? Self.edge : 0)
            .background(shape.fill(tint.opacity(0.42)).offset(y: Self.edge))
            .padding(.bottom, Self.edge)
    }
}

extension View {
    /// Look "B". See `ChunkySurface` for where it may be used.
    func chunky(_ tint: Color, radius: CGFloat = Theme.Radius.card) -> some View {
        modifier(ChunkySurface(tint: tint, radius: radius))
    }
}

/// A chunky surface that is a button: pressing sinks the face onto its edge instead of the
/// squash every other control does. Under Reduce Motion nothing moves; it dips in opacity.
struct ChunkyButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        Pressable(label: configuration.label, isPressed: configuration.isPressed, tint: tint)
    }

    private struct Pressable<Label: View>: View {
        let label: Label
        let isPressed: Bool
        let tint: Color
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            label
                .modifier(ChunkySurface(tint: tint, pressed: isPressed && !reduceMotion))
                .opacity(reduceMotion && isPressed ? 0.7 : 1)
                .animation(reduceMotion ? .easeOut(duration: 0.12) : Motion.press, value: isPressed)
        }
    }
}
```

- [ ] **Step 5: Build**

Run the build check (top of phase 2). Expected: `exit=0`, `** BUILD SUCCEEDED **`. (`xcodegen generate` picks the two new JSON files up — `Resources/Lottie` is a resources folder.)

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/tools/lottie/make-lottie.mjs \
        ios/MasterSAT/Resources/Lottie/coin-burst.json ios/MasterSAT/Resources/Lottie/star-burst.json \
        ios/MasterSAT/Sources/Support/Motion/LottieClip.swift ios/MasterSAT/Sources/Support/Chunky.swift
git commit -m "feat(ios): coin-burst and star-burst Lottie, a 15 KB budget, and the chunky look for rewards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Celebrations that never dip, never drop, and say where XP came from — plus the coin burst

**Files:**
- Modify: `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift`

**Interfaces:**
- Consumes: `CelebrationQueue.held(xpNow:)`, `Flight.label` (Task 21); `LottieAsset.coinBurst` (Task 23); `RewardsCoinArt` (`Screens/Rewards/RewardsComponents.swift`); `Motion`.
- Produces: `XPFlight.label: String?` (drawn as a caption under "+N XP"); `struct CoinCue: Identifiable { id: UUID; at: CGPoint }`; on `CelebrationCenter`: `coin: CoinCue?`, `coinCount: Int`, `coinBurst(at: CGPoint?)`; `heldXP` now holds a rise a pending entry will claim; `allDone()` waits under a sheet or cover instead of being dropped; the 2.5 s backstop lands animated; `struct CoinBurstBadge: View { init(reduceMotion:) }`.

The three phase-2 hand-off findings this task closes (Phase 2 outcome → Phase 3):
1. **Interleaved refresh dips** — the pill showed a rise from a refresh that beat a task's own read, then dipped when the task resolved, then rose again with the flight. `heldXP` now reads `queue.held(xpNow: rewards?.xp)`: a rise above a pending entry's floor is held from the moment it arrives. Under Reduce Motion nothing is held (no flights), as before.
2. **Unanimated backstop landing** — `settle` gave held XP back outside an animation, so the number jumped. It is now inside `withAnimation(Motion.snappy)`, like `landed`.
3. **`allDone()` dropped under a cover** — it returned when covered. It now waits (`allDoneWaiting`) and plays in `stageCleared()`, after any waiting checks — the same rule every other celebration follows.

Rules (repeat of the binding ones): celebrate once, after the server confirmed, from a one-shot guard — `coinBurst` is called by the page that got the server's yes, once per purchase or conversion; decorative overlays never take a touch (`CelebrationLayer` keeps `.allowsHitTesting(false)`); Reduce Motion: no Lottie burst — a still coin that fades in and out; full-screen covers never read `CelebrationCenter`; Swift 6 — delays are `Task.sleep`, never `DispatchQueue.main.asyncAfter`.

- [ ] **Step 1: A flight carries its caption; a coin cue**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    /// The pill it was aimed at — the only one that pulses when it lands.
    let owner: UUID
}

/// The check that pops where a piece of work was finished.
struct EffortCue: Identifiable, Equatable {
    let id = UUID()
    let work: FinishedWork
    let at: CGPoint
}
```
with:

```swift
    /// The pill it was aimed at — the only one that pulses when it lands.
    let owner: UUID
    /// A caption under the number — what a "while you were away" gain was for.
    let label: String?
}

/// The check that pops where a piece of work was finished.
struct EffortCue: Identifiable, Equatable {
    let id = UUID()
    let work: FinishedWork
    let at: CGPoint
}

/// The coin that bursts where a purchase or a conversion was confirmed.
struct CoinCue: Identifiable, Equatable {
    let id = UUID()
    let at: CGPoint
}
```

- [ ] **Step 2: The center — coin state, the held rise, `allDone` that waits**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    private(set) var landing: XPLanding?
    private var queue = CelebrationQueue()

    // Bookkeeping nothing renders from.
    @ObservationIgnored private var target: PillTarget?
```
with:

```swift
    private(set) var landing: XPLanding?
    /// The coin burst on screen now, if any.
    private(set) var coin: CoinCue?
    /// Bumps once per coin burst — its success haptic's trigger.
    private(set) var coinCount = 0
    private var queue = CelebrationQueue()

    // Bookkeeping nothing renders from.
    @ObservationIgnored private var target: PillTarget?
    /// Everything due this week went in while a sheet or a cover was up: the double confetti
    /// waits for the stage instead of being lost.
    @ObservationIgnored private var allDoneWaiting = false
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    /// XP earned but not landed yet. Every pill shows `xp − heldXP`.
    var heldXP: Int { queue.held }
```
with:

```swift
    /// XP earned but not landed yet — and, while an entry's own read is still out, any rise a
    /// refresh that beat it has already brought (`CelebrationQueue.held(xpNow:)`), so the pill
    /// never shows a gain a flight is about to bring and then dips. Every pill shows
    /// `xp − heldXP`. Under Reduce Motion nothing flies, so nothing is held.
    var heldXP: Int { reduceMotion ? queue.held : queue.held(xpNow: rewards?.xp) }
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    /// Everything due this week is in: double confetti. The hero bounces on its own.
    func allDone() {
        guard !covered else { return }
        confetti(at: CGPoint(x: stage.width * 0.3, y: stage.height * 0.4), size: .everything)
        confetti(at: CGPoint(x: stage.width * 0.7, y: stage.height * 0.4), size: .everything)
        effortCount += 1
        announce("Everything due this week is done.")
    }
```
with:

```swift
    /// Everything due this week is in: double confetti. The hero bounces on its own. Under a
    /// sheet or a cover it waits, and plays the moment the stage is clear.
    func allDone() {
        guard !covered else {
            allDoneWaiting = true
            return
        }
        playAllDone()
    }

    private func playAllDone() {
        confetti(at: CGPoint(x: stage.width * 0.3, y: stage.height * 0.4), size: .everything)
        confetti(at: CGPoint(x: stage.width * 0.7, y: stage.height * 0.4), size: .everything)
        effortCount += 1
        announce("Everything due this week is done.")
    }

    /// A purchase or a conversion went through — the server said so. A coin bursts where it was
    /// confirmed (else mid-screen), with a success haptic. Called once per confirmed purchase or
    /// conversion by the page that made it; the page's own message says what happened, so this
    /// says nothing to VoiceOver. Under a sheet or a cover it is skipped — the overlay sits under
    /// them (the Me sheet pushes Shop and Points too) — and the page's message still lands.
    func coinBurst(at point: CGPoint?) {
        guard !covered else { return }
        let cue = CoinCue(at: point ?? stageCentre)
        coin = cue
        coinCount += 1
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.6))
            if self?.coin?.id == cue.id { self?.coin = nil }
        }
    }
```

- [ ] **Step 3: Play what waited; caption the flight; land the backstop animated**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    private func stageCleared() {
        if queue.hasHiddenEffort {
            for work in queue.takeEfforts(stageVisible: true) { playEffort(work, at: nil) }
        }
        flyIfReady()
    }
```
with:

```swift
    private func stageCleared() {
        if queue.hasHiddenEffort {
            for work in queue.takeEfforts(stageVisible: true) { playEffort(work, at: nil) }
        }
        if allDoneWaiting {
            allDoneWaiting = false
            playAllDone()
        }
        flyIfReady()
    }
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
            to: CGPoint(x: pill.rect.midX, y: pill.rect.midY),
            owner: pill.owner
        ))
```
with:

```swift
            to: CGPoint(x: pill.rect.midX, y: pill.rect.midY),
            owner: pill.owner,
            label: flight.label
        ))
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
        if let index = flights.firstIndex(where: { $0.id == id }) { flights.remove(at: index) }
        if queue.isFlying(id) { queue.land(id) }
    }
```
with:

```swift
        if let index = flights.firstIndex(where: { $0.id == id }) { flights.remove(at: index) }
        // Animated, as `landed` is: the pill rolls up rather than jumping.
        if queue.isFlying(id) { withAnimation(Motion.snappy) { queue.land(id) } }
    }
```

- [ ] **Step 4: Draw the coin, and the caption**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .animation(.easeOut(duration: 0.25), value: center.effort?.id)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { center.setStage($0) }
        .sensoryFeedback(.success, trigger: center.effortCount)
```
with:

```swift
            if let coin = center.coin {
                CoinBurstBadge(reduceMotion: center.reduceMotion)
                    .frame(width: 150, height: 150)
                    .position(coin.at)
                    .id(coin.id)
                    .transition(.opacity)
            }
            ForEach(center.flights) { flight in
                XPFlightView(flight: flight) { center.landed(flight) }
            }
        }
        .animation(.easeOut(duration: 0.25), value: center.effort?.id)
        .animation(.easeOut(duration: 0.25), value: center.coin?.id)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { center.setStage($0) }
        .sensoryFeedback(.success, trigger: center.effortCount)
        .sensoryFeedback(.success, trigger: center.coinCount)
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
struct ConfettiCanvas: View {
```
with:

```swift
/// The coin burst. Under Reduce Motion a still coin, faded in and out by the layer.
struct CoinBurstBadge: View {
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            RewardsCoinArt(kind: .coin, size: 72)
        } else {
            LottieClip(.coinBurst, playback: .once)
        }
    }
}

struct ConfettiCanvas: View {
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    var body: some View {
        Text("+\(flight.amount) XP")
            .font(.system(size: 22, weight: .black, design: .rounded))
            .foregroundStyle(Theme.amber)
            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
            .opacity(phase == 2 ? 0.3 : 1)
            .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
            .task {
                withAnimation(Motion.pop) { phase = 1 }
                do { try await Task.sleep(for: .milliseconds(380)) } catch { return }
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
            }
    }
```
with:

```swift
    var body: some View {
        VStack(spacing: 4) {
            Text("+\(flight.amount) XP")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(Theme.amber)
                .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
            // What it was for, while it hangs in the air; gone before it reaches the pill.
            if let label = flight.label {
                Text(label)
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Theme.card, in: Capsule())
                    .opacity(phase == 1 ? 1 : 0)
            }
        }
        .scaleEffect(phase == 0 ? 0.3 : (phase == 1 ? 1.35 : 0.55))
        .opacity(phase == 2 ? 0.3 : 1)
        .position(phase == 2 ? flight.to : CGPoint(x: flight.from.x - 20, y: flight.from.y - (phase == 0 ? 0 : 54)))
        .task {
            withAnimation(Motion.pop) { phase = 1 }
            do { try await Task.sleep(for: .milliseconds(380)) } catch { return }
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { phase = 2 } completion: { onLand() }
        }
    }
```

- [ ] **Step 5: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Nothing calls `coinBurst` yet (Tasks 26–27), and no flight has a label yet (Task 25) — the behaviour on screen is unchanged except the three hand-off fixes.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Support/Motion/Celebrations.swift
git commit -m "fix(ios): the XP pill never dips, a late landing rolls, all-done waits for the stage; coin burst

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: "While you were away" — the flight, the flame, the trophy card

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift`
- Modify: `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift`
- Create: `ios/MasterSAT/Sources/Support/Motion/RankUpCard.swift`
- Create: `ios/MasterSAT/Sources/Screens/Shell/AwayCheck.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift` (`StrikeChip`)
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift`

**Interfaces:**
- Consumes: `LastSeen`, `LastSeenBook`, `Rise`, `WelcomeBack`, `CelebrationQueue.recordAway` / `resolve(…label:) -> Int` (Task 21); `LeaderboardAPI.board`, `LeaderboardQuery()`, `LeaderboardBoard.standing` (existing); `LottieAsset.starBurst`, `.chunky` (Task 23); `XPFlight.label`, `heldXP` (Task 24); `AppRouter.show(_:)`.
- Produces: `RewardsStore.rank: Int?`, `.newestAwardID: Int?` (bookkeeping, `@ObservationIgnored`), `noteRank(_: Int?)`; on `CelebrationCenter`: `expectAway(xpSeen:) -> Int`, `resolveAway(_:xpAfter:label:)`, `streakRose(_: Rise)`, `streakShown(_: Int?) -> Int?`, `streakHold`, `streakGrowth`, `flameAppeared()`, `flameDisappeared()`, `rankRose(_: Rise)`, `rankUp: Rise?`, `rankNotShown: Rise?`, `dismissRankUp()`; `RankUpOverlay`, `RankUpCard`; `@MainActor final class AwayCheck { init(book:); run(userID:session:rewards:celebrations:) async; remember(userID:rewards:celebrations:) }`.

How it works (read before coding):
- **When:** on launch (`RootTabView.onAppear`, replacing its plain header refresh) AND each time the app comes back to the front (the scene-active refresh becomes the check). iOS keeps a backgrounded app alive for hours, so a student returning after a lesson rarely launches the app — the return IS the moment. A quick app switch costs the one `/rewards/me/` read the header refresh already made, and celebrates nothing unless something changed. One check at a time (`running`).
- **Order inside a check:** (1) read the baseline; (2) `expectAway(xpSeen:)` BEFORE the request, so a rise another refresh brings meanwhile is held, never shown early; (3) `/rewards/me/`; on failure resolve with nil — nothing flies, the baseline is untouched; (4) a longer streak → `streakRose` BEFORE `rewards.apply`, so the flame never shows the new number early; (5) `apply`, then `resolveAway` with the newest-row caption; (6) the default board (global, all time, XP — the owner's choice for the hero) only when `WelcomeBack.readsRank` says the place can have changed; a better place → `rankRose`; (7) write the baseline.
- **The baseline is what the header shows:** `xp − heldXP` (XP still in the air is not seen yet, so a kill before it lands celebrates it next time — once), the flame's number, the rank unless a rank-up is still waiting to be shown, the newest history id. Written after every check and when the scene goes to the background.
- **Where things play:** the XP flight is the queue's — it waits for a visible pill and a clear stage, carries its caption, and lands on the visible pill (phase 2 rules, unchanged). The flame grows and its number rolls on the visible header once nothing covers it, 0.45 s after it is on screen. The trophy card comes after any XP flight has landed, never under a sheet. Under Reduce Motion: no flight (the pill just changes — `heldXP` is 0), no flame growth (the number just changes), the card fades in with a still trophy and no star burst; VoiceOver hears all three.
- **The trophy card is drawn, not a `.sheet`:** a third sheet would fight the router's one-sheet rule and the Me sheet's queue, and a celebration overlay must never become a presented controller. It is a chunky card over a dimmed backdrop at the root, above the tab bar; tapping outside, "Nice!" or "See the board" (→ the Rewards tab at its root, whose hero shows the new place) puts it away.

Rules (repeat): celebrate only what the server confirmed, never a decrease, nothing on the first launch (Task 21's kit rules); a cancellation is never a failure — this check runs in an unstructured `Task`, so nothing cancels it; no `DispatchQueue.main.asyncAfter`; decorative overlays never take a touch (the card's overlay takes touches only while the card is up); guard no-op writes on `@Observable` state.

- [ ] **Step 1: The store remembers the place and the newest earning**

**Edit** `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift` — replace:

```swift
    private(set) var coins: Int?
    @ObservationIgnored private var order = LatestOnly()
```
with:

```swift
    private(set) var coins: Int?
    /// The place on the default board (global, all time, XP) last read — by the Rewards hero or
    /// the welcome-back check. Bookkeeping for "while you were away"; nothing renders from it.
    @ObservationIgnored private(set) var rank: Int?
    /// The newest `/rewards/me/` history row last applied — where the next welcome-back caption
    /// starts counting new earnings.
    @ObservationIgnored private(set) var newestAwardID: Int?
    @ObservationIgnored private var order = LatestOnly()
```

**Edit** `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift` — replace:

```swift
        guard order.accept(ticket) else { return }
        guard xp != me.xp || streak != me.currentStreak || coins != me.coins else { return }
```
with:

```swift
        guard order.accept(ticket) else { return }
        if let newest = me.history.first?.id { newestAwardID = newest }
        guard xp != me.xp || streak != me.currentStreak || coins != me.coins else { return }
```

**Edit** `ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift` — replace:

```swift
            if coins != me.coins { coins = me.coins }
        }
    }
```
with:

```swift
            if coins != me.coins { coins = me.coins }
        }
    }

    /// The default board's standing was read. A student with no XP has none; the last known
    /// place is kept then.
    func noteRank(_ rank: Int?) {
        if let rank { self.rank = rank }
    }
```

- [ ] **Step 2: The center — away XP, the held flame, the waiting trophy**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
            if reduceMotion, !oldValue, queue.held > 0 { queue.releaseHeld() }
```
with:

```swift
            if reduceMotion, !oldValue, queue.held > 0 { queue.releaseHeld() }
            // Nor may the flame grow: show the real streak now.
            if reduceMotion, !oldValue, streakHold != nil { streakHold = nil }
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    /// Bumps once per coin burst — its success haptic's trigger.
    private(set) var coinCount = 0
```
with:

```swift
    /// Bumps once per coin burst — its success haptic's trigger.
    private(set) var coinCount = 0
    /// While a longer streak waits to be shown: the number last seen, which every flame shows
    /// until the rise plays. Released inside an animation, so the number rolls.
    private(set) var streakHold: Int?
    /// Bumps when the flame grows.
    private(set) var streakGrowth = 0
    /// The trophy card on screen: the student moved up the board while away.
    private(set) var rankUp: Rise?
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    @ObservationIgnored private var allDoneWaiting = false
```
with:

```swift
    @ObservationIgnored private var allDoneWaiting = false
    @ObservationIgnored private var rankWaiting: Rise?
    /// Header flames on screen now — the streak rise plays only where one can be seen.
    @ObservationIgnored private var flamesShowing = 0
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    // MARK: - What can be seen
```
with:

```swift
    // MARK: - While you were away

    /// Before the welcome-back read goes out: the XP the header last showed (nil on the first
    /// launch). A rise that lands meanwhile is held at once (`heldXP`). Returns the entry that
    /// `resolveAway` settles.
    func expectAway(xpSeen: Int?) -> Int {
        queue.recordAway(xpSeen: xpSeen)
    }

    /// The read came back — `xpAfter` is nil when it failed, and nothing flies. A gain flies
    /// with `label` as its caption once a pill can catch it, and VoiceOver hears it either way.
    func resolveAway(_ id: Int, xpAfter: Int?, label: String?) {
        let gained = queue.resolve(id, xpAfter: xpAfter, allowsFlights: budget.allowsFlights, label: label)
        if gained > 0 { announce("\(gained) XP earned while you were away.") }
        flyIfReady()
    }

    /// The streak grew while the student was away. Call BEFORE the store takes the new number:
    /// every flame keeps showing what was last seen, then rolls up and grows once one is on
    /// screen and nothing covers it. Under Reduce Motion the number simply changes.
    func streakRose(_ rise: Rise) {
        announce("\(rise.to) lessons in a row — your streak grew.")
        guard !reduceMotion else { return }
        streakHold = rise.from
        playStreakIfReady()
    }

    /// What a flame shows: the held number while a rise waits, else the store's.
    func streakShown(_ streak: Int?) -> Int? { streakHold ?? streak }

    func flameAppeared() {
        flamesShowing += 1
        playStreakIfReady()
    }

    func flameDisappeared() {
        flamesShowing = max(0, flamesShowing - 1)
    }

    /// The student moved up the board while away: the trophy card, once the stage is clear and
    /// any XP flight has landed.
    func rankRose(_ rise: Rise) {
        rankWaiting = rise
        playRankUpIfReady()
    }

    /// A rank-up not shown yet: the baseline keeps its old place until the card has been seen.
    var rankNotShown: Rise? { rankWaiting }

    func dismissRankUp() {
        if rankUp != nil { rankUp = nil }
    }

    private func playStreakIfReady() {
        guard streakHold != nil, flamesShowing > 0, !covered else { return }
        Task { [weak self] in
            // A beat, so the eye has reached the header before the number moves.
            try? await Task.sleep(for: .milliseconds(450))
            guard let self, self.streakHold != nil, self.flamesShowing > 0, !self.covered else { return }
            withAnimation(Motion.pop) { self.streakHold = nil }
            self.streakGrowth += 1
        }
    }

    private func playRankUpIfReady() {
        // A gain that can fly now goes first; the card follows once it has landed.
        let gainCanFly = queue.hasConfirmedGain && target != nil
        guard let rise = rankWaiting, rankUp == nil, !covered, flights.isEmpty, !gainCanFly else { return }
        rankWaiting = nil
        rankUp = rise
        announce("You moved up to number \(rise.to) overall.")
    }

    // MARK: - What can be seen
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
        withAnimation(Motion.snappy) { queue.land(flight.id) }
        landing = XPLanding(count: (landing?.count ?? 0) + 1, owner: flight.owner)
    }
```
with:

```swift
        withAnimation(Motion.snappy) { queue.land(flight.id) }
        landing = XPLanding(count: (landing?.count ?? 0) + 1, owner: flight.owner)
        playRankUpIfReady()
    }
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
        if allDoneWaiting {
            allDoneWaiting = false
            playAllDone()
        }
        flyIfReady()
    }
```
with:

```swift
        if allDoneWaiting {
            allDoneWaiting = false
            playAllDone()
        }
        flyIfReady()
        playStreakIfReady()
        playRankUpIfReady()
    }
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
        if queue.isFlying(id) { withAnimation(Motion.snappy) { queue.land(id) } }
    }
```
with:

```swift
        if queue.isFlying(id) { withAnimation(Motion.snappy) { queue.land(id) } }
        playRankUpIfReady()
    }
```

- [ ] **Step 3: The trophy card**

**Create** `ios/MasterSAT/Sources/Support/Motion/RankUpCard.swift`:

```swift
import SwiftUI
import MasterSATKit

/// The trophy card: the student moved up the board while they were away.
///
/// Drawn by the root above the tabs and the tab bar — not a `.sheet`: a third sheet would fight
/// the router's one-sheet rule and the Me sheet's queue. It appears only once the stage is clear
/// and any XP flight has landed (`CelebrationCenter.rankUp`). A tap outside it, "Nice!" or "See
/// the board" puts it away. Takes touches only while it is up.
struct RankUpOverlay: View {
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(AppRouter.self) private var router

    var body: some View {
        ZStack(alignment: .bottom) {
            if let rise = celebrations.rankUp {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { celebrations.dismissRankUp() }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                RankUpCard(
                    rise: rise,
                    reduceMotion: celebrations.reduceMotion,
                    onBoard: {
                        celebrations.dismissRankUp()
                        router.show(.rewards)
                    },
                    onClose: { celebrations.dismissRankUp() }
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .transition(celebrations.reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(celebrations.reduceMotion ? Motion.focus : Motion.bouncy, value: celebrations.rankUp)
        .sensoryFeedback(trigger: celebrations.rankUp) { _, new in new == nil ? nil : .success }
        .allowsHitTesting(celebrations.rankUp != nil)
    }
}

/// The card itself — look B, the trophy over a star burst. Under Reduce Motion a still trophy
/// and no burst.
struct RankUpCard: View {
    let rise: Rise
    let reduceMotion: Bool
    let onBoard: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                if !reduceMotion {
                    LottieClip(.starBurst, playback: .once).frame(width: 230, height: 230)
                }
                LottieClip(.trophy, playback: reduceMotion ? .still : .once).frame(width: 130, height: 130)
            }
            .frame(height: 150)

            VStack(spacing: 4) {
                // A place is an identifier, not a quantity: never "#1,204".
                Text(verbatim: "You moved up to #\(rise.to)")
                    .font(.system(size: 24, weight: .heavy, design: .rounded))
                Text(verbatim: "Overall · all time · up from #\(rise.from)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button("Nice!", action: onClose)
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                Button("See the board", action: onBoard)
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .chunky(Theme.amber)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}
```

- [ ] **Step 4: The check itself**

**Create** `ios/MasterSAT/Sources/Screens/Shell/AwayCheck.swift`:

```swift
import SwiftUI
import MasterSATKit

/// "While you were away": compares what the header last showed this student (`LastSeenBook`)
/// with the server now, and hands what improved to the celebrations — XP through the queue like
/// any confirmed gain (captioned from the newest history row), a longer streak to the flame, a
/// better place to the trophy card. Nothing on the first launch on this phone; nothing that went
/// down.
///
/// Runs on launch and each time the app comes back to the front: iOS keeps a backgrounded app
/// alive for hours, so a student coming back after a lesson rarely LAUNCHES it — the return is
/// the moment. A quick app switch costs the one `/rewards/me/` read the header refresh already
/// made there, and celebrates nothing unless something changed.
///
/// The baseline is what the header SHOWS (XP still held for a flight is not seen yet), written
/// after every check and when the app leaves the front.
@MainActor
final class AwayCheck {
    private let book: LastSeenBook
    private var running = false

    init(book: LastSeenBook = LastSeenBook()) {
        self.book = book
    }

    func run(userID: Int, session: Session, rewards: RewardsStore, celebrations: CelebrationCenter) async {
        // Launch and the first scene-active can both ask: one check at a time.
        guard !running else { return }
        running = true
        defer { running = false }

        let seen = book.read(userID: userID)
        // Before the read: a rise another refresh brings meanwhile is held, never shown early.
        let away = celebrations.expectAway(xpSeen: seen?.xp)
        let ticket = rewards.ticket()
        guard let me = try? await session.rewards.me() else {
            // Nothing measured, nothing flies, and the baseline stays as it was.
            celebrations.resolveAway(away, xpAfter: nil, label: nil)
            return
        }
        // Before the store takes the new streak, so no flame shows it early.
        if let rise = WelcomeBack.streak(seen: seen, now: me.currentStreak) {
            celebrations.streakRose(rise)
        }
        rewards.apply(me, ticket: ticket)
        celebrations.resolveAway(
            away,
            xpAfter: rewards.xp,
            label: WelcomeBack.label(history: me.history, since: seen?.newestAwardID)
        )

        // The owner's board for the hero: global, all time, XP — the server's default.
        if WelcomeBack.readsRank(seen: seen, xpNow: me.xp),
           let board = try? await LeaderboardAPI(client: session.client).board(LeaderboardQuery()) {
            let now = board.standing?.rank
            if let rise = WelcomeBack.rank(seen: seen?.rank, now: now) {
                celebrations.rankRose(rise)
            }
            rewards.noteRank(now)
        }
        remember(userID: userID, rewards: rewards, celebrations: celebrations)
    }

    /// Writes the baseline as the header shows it now. Before anything has loaded the old one
    /// stays; a number not read this time keeps its old value.
    func remember(userID: Int, rewards: RewardsStore, celebrations: CelebrationCenter) {
        guard let xp = rewards.xp else { return }
        let old = book.read(userID: userID)
        book.write(
            LastSeen(
                xp: max(0, xp - celebrations.heldXP),
                streak: celebrations.streakShown(rewards.streak) ?? old?.streak ?? 0,
                rank: celebrations.rankNotShown?.from ?? rewards.rank ?? old?.rank,
                newestAwardID: rewards.newestAwardID ?? old?.newestAwardID
            ),
            userID: userID
        )
    }
}
```

- [ ] **Step 5: The flame holds, rolls and grows**

**Edit** `ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift` — replace:

```swift
struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards

    var body: some View {
        if let streak = rewards.streak {
            HStack(spacing: 2) {
                LottieClip(.strikeFlame).frame(width: 22, height: 22)
                Text(String(streak))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak)))
            }
            .padding(.leading, 5)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(Theme.card, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(streak == 1 ? "1 lesson in a row" : "\(streak) lessons in a row")
        }
    }
}
```
with:

```swift
private struct FlameGrow { var scale = 1.0 }

struct StrikeChip: View {
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var showing = false
    /// This chip's own growth count: only a chip on screen grows and buzzes.
    @State private var grows = 0

    var body: some View {
        // While a longer streak waits to be shown, the number last seen; it rolls up when the
        // rise plays (`CelebrationCenter.streakRose`).
        if let streak = celebrations.streakShown(rewards.streak) {
            HStack(spacing: 2) {
                LottieClip(.strikeFlame)
                    .frame(width: 22, height: 22)
                    .keyframeAnimator(initialValue: FlameGrow(), trigger: grows) { flame, grow in
                        flame.scaleEffect(grow.scale, anchor: .bottom)
                    } keyframes: { _ in
                        KeyframeTrack(\.scale) {
                            SpringKeyframe(1.7, duration: 0.22, spring: .snappy)
                            SpringKeyframe(1.0, duration: 0.6, spring: .bouncy(duration: 0.6, extraBounce: 0.3))
                        }
                    }
                Text(String(streak))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak)))
            }
            .padding(.leading, 5)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(Theme.card, in: Capsule())
            .sensoryFeedback(.impact(weight: .medium), trigger: grows)
            .onAppear {
                showing = true
                celebrations.flameAppeared()
            }
            .onDisappear {
                showing = false
                celebrations.flameDisappeared()
            }
            .onChange(of: celebrations.streakGrowth) { _, _ in
                if showing { grows += 1 }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(streak == 1 ? "1 lesson in a row" : "\(streak) lessons in a row")
        }
    }
}
```

- [ ] **Step 6: Wire it at the root**

**Edit** `ios/MasterSAT/Sources/Screens/RootView.swift` — replace:

```swift
/// Keeps the header's XP and streak current after launch: a refresh each time the app comes back
/// to the front, and one when the phone comes back online.
///
/// Its own view, so reading `scenePhase` and connectivity rebuilds this empty view and not
/// `RootTabView` — whose body would rebuild the tab view and its navigation stacks with it.
private struct RewardsRefresher: View {
    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: scenePhase) { old, new in
                if new == .active, old != .active { refresh() }
            }
            .onChange(of: session.connectivity.isOnline) { old, new in
                if new, !old { refresh() }
            }
    }

    private func refresh() {
        Task { await rewards.refresh(using: session.rewards) }
    }
}
```
with:

```swift
/// Keeps the header's XP and streak current after launch, and runs "while you were away": the
/// check each time the app comes back to the front (launch runs it from `RootTabView`), the
/// baseline written when it leaves, and a plain refresh when the phone comes back online.
///
/// Its own view, so reading `scenePhase` and connectivity rebuilds this empty view and not
/// `RootTabView` — whose body would rebuild the tab view and its navigation stacks with it.
private struct RewardsRefresher: View {
    let userID: Int
    let away: AwayCheck

    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: scenePhase) { old, new in
                if new == .active, old != .active {
                    Task { await away.run(userID: userID, session: session, rewards: rewards, celebrations: celebrations) }
                }
                if new == .background {
                    away.remember(userID: userID, rewards: rewards, celebrations: celebrations)
                }
            }
            .onChange(of: session.connectivity.isOnline) { old, new in
                if new, !old { Task { await rewards.refresh(using: session.rewards) } }
            }
    }
}
```

**Edit** `ios/MasterSAT/Sources/Screens/RootView.swift` — replace:

```swift
    @State private var celebrations = CelebrationCenter()
    /// The floating bar's measured height, so the room left for it is never a guess.
```
with:

```swift
    @State private var celebrations = CelebrationCenter()
    @State private var away = AwayCheck()
    /// The floating bar's measured height, so the room left for it is never a guess.
```

**Edit** `ios/MasterSAT/Sources/Screens/RootView.swift` — replace:

```swift
        .background {
            RewardsRefresher()
            CelebrationSheetWatcher()
        }
        .overlay { CelebrationLayer().ignoresSafeArea() }
```
with:

```swift
        .background {
            RewardsRefresher(userID: user.id, away: away)
            CelebrationSheetWatcher()
        }
        .overlay { CelebrationLayer().ignoresSafeArea() }
        .overlay { RankUpOverlay() }
```

**Edit** `ios/MasterSAT/Sources/Screens/RootView.swift` — replace:

```swift
            if let link = notifications.consume() { open(link) }
            Task { await rewards.refresh(using: session.rewards) }
        }
```
with:

```swift
            if let link = notifications.consume() { open(link) }
            // The launch's header refresh IS the welcome-back check.
            Task { await away.run(userID: user.id, session: session, rewards: rewards, celebrations: celebrations) }
        }
```

- [ ] **Step 7: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Shell/RewardsStore.swift \
        ios/MasterSAT/Sources/Support/Motion/Celebrations.swift \
        ios/MasterSAT/Sources/Support/Motion/RankUpCard.swift \
        ios/MasterSAT/Sources/Screens/Shell/AwayCheck.swift \
        ios/MasterSAT/Sources/Screens/Shell/AppHeader.swift \
        ios/MasterSAT/Sources/Screens/RootView.swift
git commit -m "feat(ios): while you were away — XP flies in with what it was for, the flame grows, a new place gets its trophy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: The Rewards tab — the trophy hero, streak and coins, the board, where XP came from, the shop

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift`
- Modify (rewrite): `ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` (`RewardsAwardRow` loses `private`)

**Interfaces:**
- Consumes: `LeaderboardMetric`, `LeaderboardQuery(scope:window:metric:)`, `LeaderboardBoard.metric` / `.standing` / `.passTarget` / `.scopeNote`, `LeaderboardPass`, `LeaderboardRow.strikes`, `XPLedger.rows` (Task 20); `RewardsStore.noteRank` (Task 25); `CelebrationCenter.coinBurst(at:)` (Task 24), `.streakShown(_:)` (Task 25); `ChunkyButtonStyle`, `.chunky` (Task 23); `RewardsAPI.me()` / `.rules()` / `.convert(points:)`, `ConversionResult`, `MyRewards.applying`, `RewardsFormat`, `LeaderboardFilters.fallbackWindowLabel` (existing); `TabRootScroll`, `SegmentBar`, `HubCard`, `CardHeading`, `DashedEmpty`, `RewardsErrorState`, `RewardsCoinArt`, `LeaderboardRankBadge`, `LeaderboardAvatar`, `LeaderboardYouTag`, `RewardsPalette`, `AppLinkPage` (existing views).
- Produces: `RankHeroContent { enum State { loading, unranked, ranked(rank:pass:) } }`, `StreakCard`, `CoinsCard`, `RewardsBoardSection`, `RewardsBoardRow`, `XPLedgerCard`, `@MainActor final class FrameBox`; `RewardsAwardRow` is now internal.

What the tab shows, top to bottom (approved design §2, owner's decision of 2026-10-21 for the hero):
1. **Trophy hero (look B, amber)** — the student's place on the **global, all-time XP board** (the server's default, `LeaderboardQuery()`): "#57 · overall · all time", then "121 XP to pass Malika" (`passTarget`). At #1: "You're top of the whole board". When the row above is not in the response (the student is past the page with a gap): "Keep earning XP to climb" — never a guessed number. No XP yet: "Not on the board yet". Failed: an error card with Try again — never "not on the board". Tap → the full leaderboard. The trophy plays once per appearance (still under Reduce Motion); the place it shows is noted for "while you were away" (`noteRank`).
2. **Streak + coins (look B)** — the run of lessons with its best, and the coins to spend. The coins card converts: one confirmed tap spends **Max** (`convert(points: nil)` — every point that buys a whole coin; choosing an amount stays on the Points page). Not idempotent: confirmed first, off while in flight, never retried; the truth is read back either way; a confirmed conversion bursts a coin from the card.
3. **Leaderboard (look A; the student's own row look B)** — XP | Strikes; window chips All time · This month on XP only (the strike board is a run, now: the server forces all time); the top five, then the student's own row if it is not among them; the server's `scope_note` under it; "See the full board" on XP (the full page is XP-only in this phase). Strikes rows read "9 in a row". Reuses the hero's board when it asks the same thing (no second request); a `.task(id:)` loads any other, and a cancelled load stores nothing.
4. **Where your XP came from (look A)** — the five newest earnings that added XP (`XPLedger`), then "All your points" → Points. Shown once `/rewards/me/` has loaded; a failure is said by the error card instead.
5. **Shop (look A)** — a card that opens the shop. (The purchase's coin burst is Task 27.)

Rules (repeat): error ≠ empty, and a cancellation is never a failure (`APIClient` wraps one as `APIError.transport`; guard with `Task.isCancelled`); the root reloads in `.onAppear` and refreshes through `TabRootScroll(onRefresh:)`; value routes only (`NavigationLink(value: AppLink…)`); guard no-op writes on state the root reads; look B only on the hero, the two cards and the student's own row; ≤ 2 looping Lottie on screen (the header flame and the streak card's flame — the trophy plays once); copy is growth-oriented ("to pass", "to your next coin", never "behind").

- [ ] **Step 1: Make the earnings row reusable**

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
/// One line of the points history.
private struct RewardsAwardRow: View {
```
with:

```swift
/// One line of the points history — here and in the Rewards tab's "Where your XP came from".
struct RewardsAwardRow: View {
```

- [ ] **Step 2: The tab's cards**

**Create** `ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift`:

```swift
import SwiftUI
import MasterSATKit

// MARK: - The trophy hero

/// The student's place on the whole learning center's board, all time — the owner's choice for
/// this card (2026-10-21) — and the one student to pass next. Drawn inside a link to the full
/// board, on look B: the one card on the tab that is all about the student.
struct RankHeroContent: View {
    enum State: Equatable {
        case loading
        /// No XP yet, so no place on the board (the server's `my` is null).
        case unranked
        case ranked(rank: Int, pass: LeaderboardPass?)
    }

    let state: State

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 12) {
            LottieClip(.trophy, playback: reduceMotion ? .still : .once)
                .frame(width: 88, height: 88)
            VStack(alignment: .leading, spacing: 4) {
                switch state {
                case .loading:
                    Text(verbatim: "#00")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .redacted(reason: .placeholder)
                    Text("overall · all time")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                case .unranked:
                    Text("Not on the board yet")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                    Text("Your first XP puts you on it — come to a lesson or hand in homework.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                case .ranked(let rank, let pass):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        // A place is an identifier: never "#1,204".
                        Text(verbatim: "#\(rank)")
                            .font(.system(size: 40, weight: .black, design: .rounded))
                            .contentTransition(.numericText(value: Double(rank)))
                        Text("overall · all time")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Label(line(rank: rank, pass: pass), systemImage: rank == 1 ? "crown.fill" : "arrow.up.forward")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(rank == 1 ? RewardsPalette.gold.solid : RewardsPalette.accentText)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textLabel)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityHint("Opens the leaderboard")
    }

    /// The next step, never the distance from the top. Without the row above in the response
    /// there is no honest number, so none is given.
    private func line(rank: Int, pass: LeaderboardPass?) -> String {
        if rank == 1 { return "You're top of the whole board" }
        return pass?.text ?? "Keep earning XP to climb"
    }

    private var spoken: String {
        switch state {
        case .loading: return "Loading your place on the board"
        case .unranked: return "Not on the board yet. Your first XP puts you on it."
        case .ranked(let rank, let pass): return "Number \(rank) overall, all time. \(line(rank: rank, pass: pass))."
        }
    }
}

// MARK: - Streak and coins

/// The run of lessons attended, with the best one. Look B.
struct StreakCard: View {
    let streak: Int?
    let best: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                LottieClip(.strikeFlame).frame(width: 34, height: 34)
                Text(ScoreText.string(streak))
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(Theme.strike)
                    .contentTransition(.numericText(value: Double(streak ?? 0)))
            }
            Text(streak == 1 ? "lesson in a row" : "lessons in a row")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            if let best, best > 0 {
                Text(verbatim: "Best: \(best)")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.textLabel)
            } else if streak == 0 {
                Text("Your next lesson starts one")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.textLabel)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .chunky(Theme.strike)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(streak.map { "\($0) \($0 == 1 ? "lesson" : "lessons") in a row" + ((best ?? 0) > 0 ? ", best \(best ?? 0)" : "") } ?? "Lessons in a row: not loaded")
    }
}

/// Coins to spend, and the one-tap convert. Look B.
struct CoinsCard: View {
    let rewards: MyRewards?
    let converting: Bool
    /// What the last conversion did — or that it did not go through.
    let note: String?
    let onConvert: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                RewardsCoinArt(kind: .coin, size: 30)
                Text(ScoreText.string(rewards?.coins))
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .contentTransition(.numericText(value: Double(rewards?.coins ?? 0)))
            }
            Text(rewards?.coins == 1 ? "coin to spend" : "coins to spend")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
            if let rewards {
                if rewards.convertibleCoins > 0 {
                    Button(action: onConvert) {
                        HStack(spacing: 5) {
                            if converting {
                                ProgressView().controlSize(.mini).tint(.white)
                            } else {
                                Image(systemName: "arrow.left.arrow.right").font(.system(size: 11, weight: .bold))
                            }
                            Text(converting ? "Converting…" : "Convert points")
                        }
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.accent))
                    }
                    .buttonStyle(PressBounce())
                    .disabled(converting)
                    .accessibilityLabel("Convert points into \(RewardsFormat.count(rewards.convertibleCoins, "coin"))")
                } else {
                    Text(verbatim: "\(RewardsFormat.count(rewards.pointsToNextCoin, "point")) to your next coin")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            if let note {
                Text(note)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .chunky(Theme.accent)
        // Contain, not combine: the Convert button must stay its own VoiceOver target.
        .accessibilityElement(children: .contain)
    }
}

/// A measured frame kept out of SwiftUI state: written on every scroll frame, read only when a
/// coin bursts — so measuring never re-renders the tab.
@MainActor
final class FrameBox {
    var rect: CGRect = .zero
}

// MARK: - The board

/// The global board on the tab: XP (all time or this month) or Strikes, the top five and the
/// student's own row. The full page — scopes, filters, podium — is behind "See the full board".
struct RewardsBoardSection: View {
    @Binding var metric: LeaderboardMetric
    @Binding var window: String
    /// Only a board that answers the chosen metric and window; nil while it loads.
    let board: LeaderboardBoard?
    let failed: Bool
    let retry: @MainActor () async -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let topCount = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Leaderboard")
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .accessibilityAddTraits(.isHeader)
            SegmentBar(
                items: [.init(segment: LeaderboardMetric.xp, title: "XP"), .init(segment: LeaderboardMetric.strikes, title: "Strikes")],
                selection: $metric
            )
            // The strike board is a run, now: the server ranks it over all time whatever is asked.
            if metric == .xp { windowChips }
            content
            if metric == .xp {
                NavigationLink(value: AppLink.leaderboard) {
                    HStack(spacing: 4) {
                        Text("See the full board").font(.system(size: 14, weight: .bold))
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundStyle(RewardsPalette.accentText)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var windowChips: some View {
        HStack(spacing: 8) {
            ForEach([LeaderboardQuery.allTime, LeaderboardQuery.thisMonth], id: \.self) { value in
                let active = window == value
                Button {
                    guard !active else { return }
                    withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { window = value }
                } label: {
                    Text(LeaderboardFilters.fallbackWindowLabel(value))
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(active ? Color.white : Theme.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(active ? Theme.accent : Theme.card))
                        .contentShape(Capsule())
                }
                .buttonStyle(PressBounce())
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: window)
    }

    @ViewBuilder private var content: some View {
        if let board {
            let top = Array(board.rows.prefix(Self.topCount))
            let me = board.standing
            if top.isEmpty && me == nil {
                DashedEmpty(
                    title: metric == .strikes ? "No runs yet" : "Nobody on this board yet",
                    hint: metric == .strikes ? "Come to your next lesson and you're on it." : "The first XP of the month puts you at the top."
                )
            } else {
                VStack(spacing: 8) {
                    ForEach(top) { row in
                        RewardsBoardRow(row: row, metric: metric, mine: row.studentId == me?.studentId)
                    }
                    if let me, !top.contains(where: { $0.studentId == me.studentId }) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.textLabel)
                            .accessibilityHidden(true)
                        RewardsBoardRow(row: me, metric: metric, mine: true)
                    }
                }
            }
            if !board.scopeNote.isEmpty {
                Text(board.scopeNote)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if failed {
            RewardsErrorState(
                title: "The leaderboard isn't loading right now.",
                message: "Your XP is safe — only this list failed to load.",
                retry: retry
            )
            .cardStyle(padding: 8)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .accessibilityLabel("Loading the leaderboard")
        }
    }
}

/// One place on the tab's board. The student's own row is look B.
struct RewardsBoardRow: View {
    let row: LeaderboardRow
    let metric: LeaderboardMetric
    let mine: Bool

    private var value: String {
        guard metric == .strikes else { return "\(ScoreText.string(row.xp)) XP" }
        let run = row.strikes ?? 0
        return "\(run) in a row"
    }

    var body: some View {
        let line = HStack(spacing: 10) {
            LeaderboardRankBadge(rank: row.rank, highlight: mine)
            LeaderboardAvatar(row: row, size: 34)
            Text(row.displayName)
                .font(.system(size: 14, weight: mine ? .heavy : .semibold))
                .lineLimit(1)
            if mine { LeaderboardYouTag() }
            Spacer(minLength: 6)
            Text(value)
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(mine ? RewardsPalette.accentText : Theme.textSecondary)
                .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rank \(row.rank), \(row.displayName)\(mine ? ", you" : ""), \(value)")

        if mine {
            line.chunky(Theme.accent, radius: 16)
        } else {
            line.background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

// MARK: - Where your XP came from

struct XPLedgerCard: View {
    let rows: [PointAward]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeading(icon: "bolt.fill", title: "Where your XP came from", subtitle: "Your newest earnings that added XP")
            if rows.isEmpty {
                DashedEmpty(
                    title: "Nothing yet — but everything counts",
                    hint: "Come to a lesson or hand in homework, and it shows up here."
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, award in
                        if index > 0 { Divider().padding(.leading, 52) }
                        RewardsAwardRow(award: award)
                    }
                }
            }
            NavigationLink(value: AppLink.points) {
                HStack(spacing: 4) {
                    Text("All your points").font(.system(size: 14, weight: .bold))
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(RewardsPalette.accentText)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .cardStyle(padding: 18)
    }
}
```

- [ ] **Step 3: Rebuild the tab root**

**Rewrite** `ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift`:

```swift
import SwiftUI
import MasterSATKit

/// The Rewards tab: where the student stands, what they have, where it came from, and what to
/// spend it on — the trophy hero, streak and coins, the board, the XP ledger and the shop.
///
/// A tab root, so it owns its `NavigationStack` and hides the bar; every push is an `AppLink`
/// VALUE resolved at this root (the leaderboard, points and shop pages keep their own bars and
/// Back buttons). It reloads every time the tab appears, so a conversion or a purchase made one
/// level down is on the cards when the student comes back, and refreshes detached
/// (`TabRootScroll(onRefresh:)`).
///
/// Four requests, four outcomes, each said where it lands: `/rewards/me/` (streak, coins, the
/// ledger, the header), the default board (the hero — global, all time, XP), the rules (which
/// earnings add XP) and, when the board section asks something else, its own board.
struct RewardsHubView: View {
    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @Environment(RewardsStore.self) private var rewards
    @Environment(CelebrationCenter.self) private var celebrations

    @State private var mine: MyRewards?
    @State private var meFailed = false
    /// The default board — global, all time, XP: the hero's, and the section's when it asks the same.
    @State private var hero: LeaderboardBoard?
    @State private var heroFailed = false
    /// Which earnings add XP. Without them the ledger keeps every earning (`XPLedger`).
    @State private var rules: [RewardRule]?
    @State private var metric: LeaderboardMetric = .xp
    @State private var window = LeaderboardQuery.allTime
    /// The section's own board, when it asks something the hero's does not answer.
    @State private var other: LeaderboardBoard?
    @State private var otherFailed = false
    @State private var converting = false
    @State private var confirmingConvert = false
    @State private var convertNote: String?
    @State private var coinsSpot = FrameBox()
    @State private var shown = false

    private var sectionQuery: LeaderboardQuery { LeaderboardQuery(scope: .global, window: window, metric: metric) }
    private var sectionIsHero: Bool { sectionQuery == LeaderboardQuery() }

    /// The board the section shows — only one that answers what is chosen, so a strike board
    /// never shows under "XP" while the next one loads.
    private var sectionBoard: LeaderboardBoard? {
        guard let board = sectionIsHero ? hero : other, board.metric == metric else { return nil }
        guard metric == .strikes || board.window == window else { return nil }
        return board
    }

    private var sectionFailed: Bool { sectionIsHero ? heroFailed : otherFailed }

    private var heroState: RankHeroContent.State {
        guard let hero else { return .loading }
        guard let standing = hero.standing else { return .unranked }
        return .ranked(rank: standing.rank, pass: hero.passTarget)
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .rewards, onRefresh: { await load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Rewards").stagger(0, shown: shown)

                    heroCard.stagger(1, shown: shown)

                    if meFailed && mine == nil {
                        RewardsErrorState(
                            title: "Points aren't loading right now.",
                            message: "Nothing has been lost — the page just couldn't fetch your total."
                        ) { await loadMe() }
                        .cardStyle(padding: 8)
                    }

                    HStack(alignment: .top, spacing: 12) {
                        StreakCard(
                            streak: celebrations.streakShown(rewards.streak) ?? mine?.currentStreak,
                            best: mine?.bestStreak
                        )
                        CoinsCard(rewards: mine, converting: converting, note: convertNote) {
                            confirmingConvert = true
                        }
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { coinsSpot.rect = $0 }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .stagger(2, shown: shown)

                    RewardsBoardSection(
                        metric: $metric,
                        window: $window,
                        board: sectionBoard,
                        failed: sectionFailed && sectionBoard == nil
                    ) { await loadSection() }
                    .stagger(3, shown: shown)

                    if let mine {
                        XPLedgerCard(rows: XPLedger.rows(mine.history, rules: rules))
                            .stagger(4, shown: shown)
                    }

                    HubCard(
                        title: "Shop",
                        subtitle: "Spend coins and strikes, then collect it from the desk",
                        icon: "bag.fill",
                        tone: Theme.success,
                        route: AppLink.shop
                    )
                    .stagger(5, shown: shown)
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Rewards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .onAppear {
                if !shown { shown = true }
                Task { await load() }
            }
            // A chip or a segment asked a new board. Cancelled when it changes again, and a
            // cancelled load stores nothing (`loadSection`).
            .task(id: sectionQuery) {
                if otherFailed { otherFailed = false }
                await loadSection()
            }
            .alert(
                Text(verbatim: "Convert \(mine?.maxConvertiblePoints ?? 0) points into \(RewardsFormat.count(mine?.convertibleCoins ?? 0, "coin"))?"),
                isPresented: $confirmingConvert
            ) {
                Button("Convert") { Task { await convert() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Converted points don't come back, and your XP stays where it is. To choose an amount, open Points.")
            }
        }
    }

    // MARK: - The hero

    @ViewBuilder private var heroCard: some View {
        if hero == nil && heroFailed {
            RewardsErrorState(
                title: "Your place isn't loading right now.",
                message: "Your XP is safe — only the board failed to load."
            ) { await loadHero() }
            .chunky(Theme.amber)
        } else {
            NavigationLink(value: AppLink.leaderboard) {
                RankHeroContent(state: heroState)
            }
            .buttonStyle(ChunkyButtonStyle(tint: Theme.amber))
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let me: Void = loadMe()
        async let board: Void = loadHero()
        async let earning: Void = loadRules()
        async let section: Void = loadSection()
        _ = await (me, board, earning, section)
    }

    @MainActor
    private func loadMe() async {
        // Taken before asking, so an answer older than the header's own refresh cannot wind it back.
        let ticket = rewards.ticket()
        do {
            let me = try await session.rewards.me()
            if mine != me { mine = me }
            if meFailed { meFailed = false }
            // The header reads the same answer, so the two never disagree.
            rewards.apply(me, ticket: ticket)
        } catch {
            guard !Task.isCancelled else { return }
            meFailed = true
        }
    }

    @MainActor
    private func loadHero() async {
        do {
            let board = try await LeaderboardAPI(client: session.client).board(LeaderboardQuery())
            if hero != board { hero = board }
            if heroFailed { heroFailed = false }
            // What the student has now seen — "while you were away" measures from it.
            rewards.noteRank(board.standing?.rank)
        } catch {
            guard !Task.isCancelled else { return }
            heroFailed = true
        }
    }

    @MainActor
    private func loadRules() async {
        guard let fresh = try? await session.rewards.rules() else { return }
        if rules != fresh { rules = fresh }
    }

    /// The section's own board — nothing to do when it asks what the hero's already answers.
    @MainActor
    private func loadSection() async {
        let asked = sectionQuery
        guard asked != LeaderboardQuery() else { return }
        do {
            let fresh = try await LeaderboardAPI(client: session.client).board(asked)
            guard !Task.isCancelled, asked == sectionQuery else { return }
            if other != fresh { other = fresh }
            if otherFailed { otherFailed = false }
        } catch {
            guard !Task.isCancelled, asked == sectionQuery else { return }
            otherFailed = true
        }
    }

    // MARK: - Converting

    /// Spends Max — every point that buys a whole coin. Not idempotent (a second call is a second
    /// conversion), so it runs once per confirmation, with the button off while it is in flight,
    /// and is never retried. Either way the truth is read back.
    @MainActor
    private func convert() async {
        guard !converting, let before = mine, before.convertibleCoins > 0 else { return }
        converting = true
        convertNote = nil
        do {
            let result = try await session.rewards.convert(points: nil)
            mine = before.applying(result.balances)
            celebrations.coinBurst(at: coinsSpot.rect.celebrationPoint)
            convertNote = result.detail.isEmpty
                ? "Converted \(result.pointsSpent) points into \(RewardsFormat.count(result.minted, "coin"))."
                : result.detail
        } catch {
            convertNote = "That didn't go through — your points are untouched. Try again."
        }
        converting = false
        await loadMe()
    }
}
```

- [ ] **Step 4: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift \
        ios/MasterSAT/Sources/Screens/Rewards/RewardsHubView.swift \
        ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift
git commit -m "feat(ios): Rewards — your place and who to pass, streak and coins, the board, where XP came from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: A coin burst on every purchase and conversion; the Rewards pages refresh detached

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/LeaderboardView.swift`

**Interfaces:**
- Consumes: `CelebrationCenter.coinBurst(at:)` (Task 24), `FrameBox` (Task 26), `CGRect.celebrationPoint`, `View.detachedRefresh(_:)` (phase 2, `Screens/Shell/TabRootScroll.swift`).
- Produces: `ShopItemCard.onBuy: (CGPoint?) -> Void` (where its Buy button is); `ShopView.buy(_:at:)`. No new types.

Why here: the approved design's "shop purchase (coin burst)" lives on the Shop page, and a conversion on the Points page is the same event as the coins card's (Task 26), so it bursts too. While these three Rewards pages are open, they take the phase-2 refresh fix that phase 2 deferred to phase 5 for every pushed page: `.refreshable { await load() }` cancelled its own requests on device, because the loads write state the page reads; `.detachedRefresh` runs the work on its own task. And their loaders no longer store a cancelled load as a failure (`APIClient` wraps a cancellation as `APIError.transport`).

Rules (repeat): celebrate once, only after the server confirmed — the burst sits on the success path of `buy` / `convert`, which run once per confirmation and are never retried; error ≠ empty; a cancellation is never a failure.

- [ ] **Step 1: The shop — the Buy button says where it is, a confirmed purchase bursts there**

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
    @Environment(\.horizontalSizeClass) private var sizeClass
```
with:

```swift
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(CelebrationCenter.self) private var celebrations
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
    @State private var confirming: ShopItem?
```
with:

```swift
    @State private var confirming: ShopItem?
    /// Where the confirmed item's Buy button is — the coin bursts from there.
    @State private var confirmingPoint: CGPoint?
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
        .task { await load() }
        .refreshable { await load() }
        .alert(
            confirming.map { Text(verbatim: "Buy \($0.name)?") } ?? Text(verbatim: ""),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { item in
            Button("Buy") { Task { await buy(item) } }
```
with:

```swift
        .task { await load() }
        .detachedRefresh { await load() }
        .alert(
            confirming.map { Text(verbatim: "Buy \($0.name)?") } ?? Text(verbatim: ""),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { item in
            Button("Buy") { Task { await buy(item, at: confirmingPoint) } }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
                                buying: purchasingId == item.id
                            ) {
                                confirming = item
                            }
```
with:

```swift
                                buying: purchasingId == item.id
                            ) { point in
                                confirmingPoint = point
                                confirming = item
                            }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
        } catch {
            shopFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            shopFailed = true
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
        } catch {
            ordersFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            ordersFailed = true
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
    @MainActor
    private func buy(_ item: ShopItem) async {
        guard purchasingId == nil else { return }
        purchasingId = item.id
        let api = ShopAPI(client: session.client)
        do {
            let result = try await api.purchase(itemId: item.id)
            toast = RewardsToastMessage(
```
with:

```swift
    @MainActor
    private func buy(_ item: ShopItem, at point: CGPoint?) async {
        guard purchasingId == nil else { return }
        purchasingId = item.id
        let api = ShopAPI(client: session.client)
        do {
            let result = try await api.purchase(itemId: item.id)
            // The server took the order: a coin bursts from the button that bought it.
            celebrations.coinBurst(at: point)
            toast = RewardsToastMessage(
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
    /// This one is the purchase in flight.
    let buying: Bool
    let onBuy: () -> Void
```
with:

```swift
    /// This one is the purchase in flight.
    let buying: Bool
    /// Asked to buy; hands over where the Buy button is, so a confirmed purchase bursts there.
    let onBuy: (CGPoint?) -> Void

    @State private var buySpot = FrameBox()
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
                    Button(action: onBuy) {
```
with:

```swift
                    Button { onBuy(buySpot.rect.celebrationPoint) } label: {
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift` — replace:

```swift
                    .buttonStyle(ShopBuyButtonStyle())
                    .disabled(!item.canBuy || busy)
```
with:

```swift
                    .buttonStyle(ShopBuyButtonStyle())
                    .disabled(!item.canBuy || busy)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { buySpot.rect = $0 }
```

- [ ] **Step 2: Points — a confirmed conversion bursts; refresh detached; no cancelled failure**

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
struct PointsView: View {
    @Environment(Session.self) private var session
```
with:

```swift
struct PointsView: View {
    @Environment(Session.self) private var session
    @Environment(CelebrationCenter.self) private var celebrations
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
        .task { await load() }
        .refreshable { await load() }
```
with:

```swift
        .task { await load() }
        .detachedRefresh { await load() }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
        } catch {
            meFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            meFailed = true
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
        } catch {
            rulesFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            rulesFailed = true
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
        } catch {
            walletFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            walletFailed = true
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift` — replace:

```swift
            let result = try await api.convert(points: conversion.asked)
            rewards = rewards?.applying(result.balances)
```
with:

```swift
            let result = try await api.convert(points: conversion.asked)
            rewards = rewards?.applying(result.balances)
            // Coins were minted — the server said so.
            celebrations.coinBurst(at: nil)
```

- [ ] **Step 3: Leaderboard — refresh detached; no cancelled failure**

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/LeaderboardView.swift` — replace:

```swift
        .refreshable {
            async let board: Void = loadBoard()
            async let extras: Void = loadExtras()
            _ = await (board, extras)
        }
```
with:

```swift
        .detachedRefresh {
            async let board: Void = loadBoard()
            async let extras: Void = loadExtras()
            _ = await (board, extras)
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/LeaderboardView.swift` — replace:

```swift
        } catch {
            filtersFailed = true
        }
```
with:

```swift
        } catch {
            guard !Task.isCancelled else { return }
            filtersFailed = true
        }
```

- [ ] **Step 4: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -n "\.refreshable" ios/MasterSAT/Sources/Screens/Rewards/*.swift` prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Rewards/ShopView.swift \
        ios/MasterSAT/Sources/Screens/Rewards/PointsView.swift \
        ios/MasterSAT/Sources/Screens/Rewards/LeaderboardView.swift
git commit -m "feat(ios): a coin bursts on every purchase and conversion; the Rewards pages refresh without cancelling themselves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Words — "Review today", search, and the lists in look A

**Files:**
- Create: `ios/MasterSAT/Sources/Screens/Vocabulary/WordsTodayCards.swift`
- Modify (rewrite): `ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabComponents.swift` (`VocabSetCard`, `VocabSectionCard`)

**Interfaces:**
- Consumes: `VocabReview`, `VocabReview.Next`, `VocabReview.HomeworkSet`, `VocabReview.bestSet(in:)` (Task 22); `StudentAPI.vocabularySections()`, `.myVocabularySets()`, `.vocabularyHomework()`, `.vocabularySection(id:)`, `.searchVocabularyWords(_:)`, `.deleteVocabularySet(id:)`; `VocabHomeworkGroup.outstanding(in:)`, `DueLabel`, `TabRootScroll`, `SegmentBar`, `IconTile`, `Overline`, `DashedEmpty`, `VocabErrorNotice`, `VocabEmptyState`, `VocabWordRow`, `VocabSetView`, `VocabSectionView`, `CustomSetBuilderView`, `VocabGameGuide`, `VocabDueChip`, `FlowLayout`, `PrimaryButtonStyle` (existing).
- Produces: `ReviewTodayCard { enum State { loading, failed, ready(VocabReview) } }`, `WordSearchField`, `VocabSearchRow`; `VocabularyView.Segment` (`homework`, `bank`, `mine`) replaces `VocabularyView.Tab`; `VocabularyView.Route` is unchanged (the homework card and the set page use it).

What changes for the student:
- **"Review today" (look A, amber tile)** — the bank's words still to master (exact, per section — Task 22), "N mastered so far", and **Next up**: the word homework due soonest that is not mastered ("Unit 3 · Set 2 — English homework · Due Thu · 2 games to go"), or, with none, the section with the most words still to master. **Start** opens it: the homework set bound to its homework (`assignmentId`, so the run is credited to it); for a section, one read of the section, then its set with the most words still to master — and the section page if that read fails (it explains itself). All caught up / nothing yet are states, not errors. The hero needs BOTH the bank and the homework (it chooses between them), so if either has never loaded and failed, it says so with Try again — never "all caught up". A reload that fails keeps the last good answer.
- **Search** the whole bank from the tab (two letters or more, after a 300 ms pause; a newer keystroke cancels the older search). A failed search says so — it is not "no matches". Results show which section a word comes from (the same word is a row in every section that teaches it).
- **Homework · Word bank · My sets** in a `SegmentBar`; the tab opens on Homework when there is any, else on the bank — decided once, and never after the student picked. "New set" moves from the old gradient hero to the top of My sets.
- **Look A:** the set card gets an amber word tile, one quiet meta line ("12 words · 2/4 games") and a compact action capsule; the section card and the homework card take the shared `cardStyle` (the old hairline and top-edge gradient go). The four games guide stays under the lists.

Rules (repeat): tab roots push VALUES only (`path.append(Route…)` / `NavigationLink(value:)`), and a root push is guarded by `path.isEmpty` so a double tap stacks nothing; the root reloads in `.onAppear` and refreshes through `TabRootScroll(onRefresh:)`; error ≠ empty and a cancellation is never a failure (guard with `Task.isCancelled`); guard no-op writes on state the root reads; Words = `Theme.amber`, actions stay brand blue (white on amber fails contrast); English, growth-oriented copy ("still to master", "to go", "Catch up · Tue" via `DueLabel` — never "overdue").

- [ ] **Step 1: The tab's new cards**

**Create** `ios/MasterSAT/Sources/Screens/Vocabulary/WordsTodayCards.swift`:

```swift
import SwiftUI
import MasterSATKit

/// "Review today": the bank's words still to master, and the one set Start opens.
///
/// There is no spaced repetition on the server, so nothing here says "due": the number is the
/// words not yet mastered, and Start opens the most useful set (`VocabReview`). All caught up and
/// nothing yet are states to show, not failures; a failure says so and offers Try again.
struct ReviewTodayCard: View {
    enum State: Equatable {
        case loading
        case failed
        case ready(VocabReview)
    }

    let state: State
    /// Start is reading a section to pick its set.
    let starting: Bool
    let onStart: () -> Void
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                IconTile(systemName: "character.book.closed.fill", tone: Theme.amber, size: 40)
                Overline("Review today")
                Spacer(minLength: 0)
            }
            content
        }
        .cardStyle(padding: 18)
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "000 words still to master")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .redacted(reason: .placeholder)
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: 64)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading today's review")
        case .failed:
            VocabErrorNotice(
                title: "Today's review couldn't load",
                message: "Your words and progress are safe — this card just couldn't work out what's next.",
                retry: retry
            )
        case .ready(let review):
            ready(review)
        }
    }

    @ViewBuilder private func ready(_ review: VocabReview) -> some View {
        switch review.next {
        case .homework(let set):
            count(review)
            nextUp(title: set.title, detail: homeworkDetail(set))
            startButton
        case .section(_, let title, let left):
            count(review)
            nextUp(title: title, detail: "\(left) words to master in this section — Start opens its fullest set")
            startButton
        case .caughtUp:
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Theme.success)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("All caught up")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                    Text("Every word is mastered. Play any set to keep them fresh.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
        case .nothingYet:
            VStack(alignment: .leading, spacing: 3) {
                Text("No words to review yet")
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                Text("When a teacher sets word homework or publishes a list, it lands here.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder private func count(_ review: VocabReview) -> some View {
        if review.wordsToMaster > 0 {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ScoreText.string(review.wordsToMaster))
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .contentTransition(.numericText(value: Double(review.wordsToMaster)))
                    Text(review.wordsToMaster == 1 ? "word still to master" : "words still to master")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                if review.wordsMastered > 0 {
                    Text(verbatim: "\(review.wordsMastered) mastered so far")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func nextUp(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Overline("Next up")
            Text(title)
                .font(.system(size: 16, weight: .heavy))
                .lineLimit(2)
            Text(detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.amberSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func homeworkDetail(_ set: VocabReview.HomeworkSet) -> String {
        let games = "\(set.gamesLeft) \(set.gamesLeft == 1 ? "game" : "games") to go"
        return [set.assignmentTitle, DueLabel.text(set.dueAt)?.text, games]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var startButton: some View {
        Button(action: onStart) {
            HStack(spacing: 8) {
                if starting {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "play.fill").font(.system(size: 13, weight: .bold))
                }
                Text(starting ? "Opening…" : "Start")
            }
        }
        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
        .disabled(starting)
    }
}

/// The bank search on the tab — a field, not the navigation bar's: a tab root hides its bar.
struct WordSearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            TextField("Search words or definitions", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textLabel)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 15, weight: .medium))
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Theme.card, in: Capsule())
    }
}

/// One search result: the word, and the section it comes from — the same word is a separate
/// row in every section that teaches it, and they would otherwise look identical.
struct VocabSearchRow: View {
    let word: VocabWord

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let section = word.sectionTitle, !section.isEmpty {
                Overline("From \(section)")
            }
            VocabWordRow(word: word)
        }
    }
}
```

- [ ] **Step 2: Rebuild the tab root**

**Rewrite** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift`:

```swift
import SwiftUI
import MasterSATKit

/// The Words tab: "Review today" — the words still to master and the one set Start opens — a
/// search of the whole bank, then the three places a set lives: word homework, the bank, and
/// the student's own sets. The four games sit under the lists, because they are how a set from
/// any of the three is studied.
///
/// Each list loads, fails and retries on its own, as the web's do. The hero needs the bank AND
/// the homework — it chooses between them — so it waits for both, and says so when either has
/// never loaded, rather than calling a student "all caught up" on half the facts.
struct VocabularyView: View {
    enum Segment: Hashable { case homework, bank, mine }

    /// Pages this root pushes. Each is a VALUE on `path` — a `NavigationLink { destination }`
    /// never enters the path, so re-tapping the tab (or a link to it) could not pop it. The
    /// title travels with the id: the page shows it while its own load is in flight.
    enum Route: Hashable {
        case section(id: Int, title: String)
        case set(id: Int, title: String, assignmentId: Int? = nil)
    }

    private enum Phase: Equatable { case loading, loaded, failed }
    private enum SearchPhase: Equatable { case idle, searching, done, failed }

    @Binding var path: NavigationPath

    @Environment(Session.self) private var session
    @State private var sections: [VocabSection] = []
    @State private var mySets: [VocabMySet] = []
    @State private var groups: [VocabHomeworkGroup] = []
    @State private var sectionsPhase: Phase = .loading
    @State private var mySetsPhase: Phase = .loading
    @State private var homeworkPhase: Phase = .loading
    /// Loaded at least once in this view's life — a failed reload keeps the last good answer.
    @State private var sectionsKnown = false
    @State private var homeworkKnown = false
    @State private var segment: Segment = .homework
    /// The opening segment is chosen once, from the first homework answer — never after the
    /// student has picked one.
    @State private var segmentPicked = false
    @State private var isBuilding = false
    @State private var pendingDelete: VocabMySet?
    @State private var isDeleting = false
    @State private var deleteError: String?
    @State private var startingReview = false
    @State private var query = ""
    @State private var results: [VocabWord] = []
    @State private var searchPhase: SearchPhase = .idle
    @State private var shown = false

    /// Sets owed on homework: not yet MASTERED, not merely not started. Zero is not shown.
    private var outstanding: Int { VocabHomeworkGroup.outstanding(in: groups) }

    private var searchText: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isSearching: Bool { searchText.count >= 2 }

    private var reviewState: ReviewTodayCard.State {
        if sectionsKnown && homeworkKnown {
            return .ready(VocabReview(sections: sections, homework: groups))
        }
        if sectionsPhase == .failed || homeworkPhase == .failed { return .failed }
        return .loading
    }

    var body: some View {
        NavigationStack(path: $path) {
            TabRootScroll(tab: .words, onRefresh: { await load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    AppHeader(title: "Words").stagger(0, shown: shown)

                    ReviewTodayCard(state: reviewState, starting: startingReview, onStart: startReview) {
                        await load()
                    }
                    .stagger(1, shown: shown)

                    WordSearchField(query: $query).stagger(2, shown: shown)

                    if isSearching {
                        searchResults
                    } else {
                        SegmentBar(
                            items: [
                                .init(segment: Segment.homework, title: outstanding > 0 ? "Homework · \(outstanding)" : "Homework"),
                                .init(segment: Segment.bank, title: "Word bank"),
                                .init(segment: Segment.mine, title: "My sets"),
                            ],
                            selection: $segment
                        )
                        .stagger(3, shown: shown)

                        Group {
                            switch segment {
                            case .homework: homeworkList
                            case .bank: bankList
                            case .mine: mineList
                            }
                        }
                        .stagger(4, shown: shown)

                        VocabGameGuide()
                            .padding(.top, 4)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Words")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .section(let id, let title): VocabSectionView(sectionId: id, title: title)
                case .set(let id, let title, let assignmentId):
                    VocabSetView(setId: id, title: title, assignmentId: assignmentId)
                }
            }
            .navigationDestination(for: AppLink.self) { AppLinkPage(link: $0) }
            .onAppear {
                if !shown { shown = true }
                Task { await load() }
            }
            // A newer keystroke cancels the older search; a cancelled search stores nothing.
            .task(id: searchText) { await search(searchText) }
            .onChange(of: segment) { _, _ in
                if !segmentPicked { segmentPicked = true }
            }
            .sheet(isPresented: $isBuilding) {
                CustomSetBuilderView { saved in
                    isBuilding = false
                    if saved { Task { await load() } }
                }
            }
            .alert(
                "Delete this set?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                presenting: pendingDelete
            ) { set in
                Button("Keep it", role: .cancel) { pendingDelete = nil }
                Button("Delete set", role: .destructive) { Task { await delete(set) } }
            } message: { set in
                Text(verbatim: "“\(set.title)” and its word list will be removed. Your progress on the words themselves is kept.")
            }
            .alert(
                "Couldn't delete that set",
                isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })
            ) {
                Button("OK", role: .cancel) { deleteError = nil }
            } message: {
                Text(verbatim: deleteError ?? "")
            }
        }
    }

    // MARK: - Review today

    /// Start: the homework set bound to its homework, or — for a section — one read of it, then
    /// its set with the most words still to master (the section page if the read fails). A root
    /// push: a second tap while the first is in flight stacks nothing.
    private func startReview() {
        guard case .ready(let review) = reviewState, !startingReview, path.isEmpty else { return }
        switch review.next {
        case .homework(let set):
            path.append(Route.set(id: set.setId, title: set.title, assignmentId: set.assignmentId))
        case .section(let id, let title, _):
            startingReview = true
            Task {
                let detail = try? await session.student.vocabularySection(id: id)
                startingReview = false
                // The student went somewhere else meanwhile: leave them there.
                guard path.isEmpty else { return }
                if let detail, let best = VocabReview.bestSet(in: detail) {
                    path.append(Route.set(id: best.id, title: best.title))
                } else {
                    path.append(Route.section(id: id, title: title))
                }
            }
        case .caughtUp, .nothingYet:
            break
        }
    }

    // MARK: - Search

    @ViewBuilder private var searchResults: some View {
        switch searchPhase {
        case .idle, .searching:
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .accessibilityLabel("Searching")
        case .failed:
            VocabErrorNotice(
                title: "Search didn't go through",
                message: "Check your connection and try again."
            ) { await search(searchText) }
        case .done:
            if results.isEmpty {
                DashedEmpty(title: "No matches for “\(searchText)”", hint: "Try a shorter word, or part of a definition.")
            } else {
                VStack(spacing: 12) {
                    ForEach(results) { VocabSearchRow(word: $0) }
                }
            }
        }
    }

    @MainActor
    private func search(_ text: String) async {
        guard text.count >= 2 else {
            if !results.isEmpty { results = [] }
            if searchPhase != .idle { searchPhase = .idle }
            return
        }
        if searchPhase != .searching { searchPhase = .searching }
        // Wait for a pause in the typing; a newer keystroke cancels this one here.
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
        do {
            let found = try await session.student.searchVocabularyWords(text)
            guard !Task.isCancelled, text == searchText else { return }
            results = found
            searchPhase = .done
        } catch {
            guard !Task.isCancelled, text == searchText else { return }
            searchPhase = .failed
        }
    }

    // MARK: - Homework

    @ViewBuilder
    private var homeworkList: some View {
        switch homeworkPhase {
        case .loading where groups.isEmpty:
            loadingSlot
        case .failed where groups.isEmpty:
            VocabErrorNotice(title: "Couldn't load your homework") { await loadHomework() }
        default:
            if groups.isEmpty {
                VocabEmptyState(
                    icon: "graduationcap",
                    title: "No vocabulary homework right now",
                    message: "When a teacher assigns a word list it lands here with its due date. Until then, pick any set from the word bank."
                )
            } else {
                VStack(spacing: 18) {
                    ForEach(groups) { VocabHomeworkGroupCard(group: $0) }
                }
            }
        }
    }

    // MARK: - Word bank

    @ViewBuilder
    private var bankList: some View {
        switch sectionsPhase {
        case .loading where sections.isEmpty:
            loadingSlot
        case .failed where sections.isEmpty:
            VocabErrorNotice(title: "Couldn't load the word bank") { await loadSections() }
        default:
            if sections.isEmpty {
                VocabEmptyState(
                    icon: "books.vertical",
                    title: "No word lists published yet",
                    message: "Your teachers publish vocabulary sections here. In the meantime you can build a set of your own.",
                    actionTitle: "Build my own set",
                    action: { isBuilding = true }
                )
            } else {
                VStack(spacing: 14) {
                    ForEach(sections) { section in
                        NavigationLink(value: Route.section(id: section.id, title: section.title)) {
                            VocabSectionCard(section: section)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - My sets

    @ViewBuilder
    private var mineList: some View {
        switch mySetsPhase {
        case .loading where mySets.isEmpty:
            loadingSlot
        case .failed where mySets.isEmpty:
            VocabErrorNotice(title: "Couldn't load your sets") { await loadMySets() }
        default:
            if mySets.isEmpty {
                VocabEmptyState(
                    icon: "sparkles",
                    title: "Make a set of the words you keep missing",
                    message: "Pull any words from the word bank into a set of your own, then study it with all four games.",
                    actionTitle: "New set",
                    action: { isBuilding = true }
                )
            } else {
                VStack(spacing: 14) {
                    HStack {
                        Text("Sets you built")
                            .font(.system(size: 15, weight: .heavy))
                        Spacer()
                        Button { isBuilding = true } label: {
                            Label("New set", systemImage: "plus")
                                .font(.system(size: 13, weight: .heavy))
                        }
                        .buttonStyle(PressBounce())
                        .foregroundStyle(Theme.accent)
                    }
                    ForEach(mySets) { set in
                        NavigationLink(value: Route.set(id: set.id, title: set.title)) {
                            VocabSetCard(
                                title: set.title,
                                wordCount: set.wordCount,
                                completed: set.completed,
                                mastery: set.mastery,
                                subtitle: createdLabel(set.createdAt),
                                reservesTrailingControl: true
                            )
                        }
                        .buttonStyle(.plain)
                        // Laid over the link, not inside it: a button inside a link's label
                        // competes with the link for the same tap.
                        .overlay(alignment: .topTrailing) {
                            Button { pendingDelete = set } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textSecondary)
                                    .frame(width: 36, height: 36)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(isDeleting)
                            .accessibilityLabel("Delete \(set.title)")
                            .padding(.top, 10)
                            .padding(.trailing, 8)
                        }
                    }
                }
            }
        }
    }

    private var loadingSlot: some View {
        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
    }

    private func createdLabel(_ iso: String?) -> String? {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return nil }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        return "Created \(f.string(from: date))"
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let bank: Void = loadSections()
        async let mine: Void = loadMySets()
        async let assigned: Void = loadHomework()
        _ = await (bank, mine, assigned)
    }

    @MainActor
    private func loadSections() async {
        if sections.isEmpty, sectionsPhase != .loading { sectionsPhase = .loading }
        do {
            let fresh = try await session.student.vocabularySections()
            if sections != fresh { sections = fresh }
            if sectionsPhase != .loaded { sectionsPhase = .loaded }
            if !sectionsKnown { sectionsKnown = true }
        } catch {
            guard !Task.isCancelled else { return }
            sectionsPhase = .failed
        }
    }

    @MainActor
    private func loadMySets() async {
        if mySets.isEmpty, mySetsPhase != .loading { mySetsPhase = .loading }
        do {
            let fresh = try await session.student.myVocabularySets()
            if mySets != fresh { mySets = fresh }
            if mySetsPhase != .loaded { mySetsPhase = .loaded }
        } catch {
            guard !Task.isCancelled else { return }
            mySetsPhase = .failed
        }
    }

    @MainActor
    private func loadHomework() async {
        if groups.isEmpty, homeworkPhase != .loading { homeworkPhase = .loading }
        do {
            let fresh = try await session.student.vocabularyHomework()
            if groups != fresh { groups = fresh }
            if homeworkPhase != .loaded { homeworkPhase = .loaded }
            if !homeworkKnown { homeworkKnown = true }
            if !segmentPicked {
                segmentPicked = true
                let opening: Segment = fresh.isEmpty ? .bank : .homework
                if segment != opening { segment = opening }
            }
        } catch {
            guard !Task.isCancelled else { return }
            homeworkPhase = .failed
        }
    }

    @MainActor
    private func delete(_ set: VocabMySet) async {
        pendingDelete = nil
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await session.student.deleteVocabularySet(id: set.id)
            mySets.removeAll { $0.id == set.id }
        } catch let error as APIError {
            deleteError = error.errorDescription
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

/// One homework that carries word sets: its title, the class, the deadline, how many of its
/// sets have been started — and the sets themselves, each opened bound to THIS homework.
///
/// The binding is the point. The same set can sit under two homeworks here (two classrooms,
/// or re-assigned for revision), and the two cards then differ only by the assignment they
/// carry; without it the server binds every run to whichever is newest.
struct VocabHomeworkGroupCard: View {
    let group: VocabHomeworkGroup

    private var allDone: Bool { group.isComplete }
    private var late: Bool { DueLabel.text(group.dueAt)?.late ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(
                    systemName: "graduationcap.fill",
                    tone: allDone ? Theme.success : Theme.amber,
                    size: 40
                )
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.assignmentTitle)
                        .font(.system(size: 17, weight: .heavy))
                        .lineLimit(2)
                    FlowLayout(spacing: 6) {
                        if let name = group.classroomName, !name.isEmpty {
                            if let classroomId = group.classroomId {
                                NavigationLink(value: AppLink.classroom(id: classroomId)) {
                                    classroomChip(name)
                                }
                                .buttonStyle(.plain)
                            } else {
                                classroomChip(name)
                            }
                        }
                        VocabDueChip(dueAt: group.dueAt)
                    }
                }
                Spacer(minLength: 0)
                // "Done" is any game finished on the set; the segment's count is mastery.
                if allDone {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.sets.count)) complete",
                         icon: "checkmark.circle.fill", tone: .success)
                } else {
                    Chip(text: "\(ScoreText.string(group.doneCount)) / \(ScoreText.string(group.sets.count)) done",
                         tone: late ? .warning : .neutral)
                }
            }

            ForEach(group.sets) { set in
                NavigationLink(value: VocabularyView.Route.set(id: set.id, title: set.title, assignmentId: group.assignmentId)) {
                    VocabSetCard(
                        title: set.title,
                        wordCount: set.wordCount,
                        completed: set.completed,
                        mastery: set.mastery,
                        subtitle: set.sectionTitle,
                        actionLabel: "Start"
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle(padding: 16)
        .overlay {
            if allDone {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    .allowsHitTesting(false)
            }
        }
    }

    private func classroomChip(_ name: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "person.2.fill").font(.system(size: 10, weight: .bold))
            Text(name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.surface2))
    }
}
```

- [ ] **Step 3: The set card and the section card in look A**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabComponents.swift` — replace:

```swift
struct VocabSetCard: View {
    let title: String
    let wordCount: Int
    /// Any one game finished — only ever "Keep going", never the badge.
    let completed: Bool
    let mastery: VocabSetMastery
    var subtitle: String?
    var actionLabel = "Practice"
    /// Room on the right for a control laid over the card (My sets' delete).
    var reservesTrailingControl = false

    private var mastered: Bool { mastery.isMastered }
    private var chipInk: Color { mastered ? VocabPalette.mastered.ink : Theme.accent }
    private var chipFill: Color { mastered ? VocabPalette.mastered.solid.opacity(0.12) : Theme.accent.opacity(0.10) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(mastered ? Theme.successSoft : Theme.accentSoft)
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: mastered ? "checkmark.circle.fill" : "book")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(mastered ? Theme.success : Theme.accent)
                    )

                VStack(alignment: .leading, spacing: 7) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    FlowLayout(spacing: 6) {
                        VocabMetaChip(
                            icon: "textformat",
                            text: "\(ScoreText.string(wordCount)) \(wordCount == 1 ? "word" : "words")",
                            ink: chipInk,
                            fill: chipFill
                        )
                        VocabMetaChip(
                            icon: "gamecontroller.fill",
                            text: "\(ScoreText.string(mastery.masteredModes))/\(ScoreText.string(mastery.totalModes)) games",
                            ink: chipInk,
                            fill: chipFill
                        )
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Capsule().fill(Theme.surface2))
                        }
                    }
                }
                Spacer(minLength: 0)
                if mastered {
                    Chip(text: "Mastered", icon: "checkmark.circle.fill", tone: .success)
                }
                if reservesTrailingControl {
                    Color.clear.frame(width: 30, height: 30)
                }
            }

            VocabMasteryBar(mastery: mastery)

            HStack(spacing: 7) {
                Image(systemName: "play.fill").font(.system(size: 11, weight: .bold))
                Text(mastered ? "Play again" : (completed ? "Keep going" : actionLabel))
                    .font(.system(size: 14, weight: .bold))
            }
            .foregroundStyle(mastered ? Theme.accent : Color.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(mastered ? Theme.surface2 : Theme.accent)
            )
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(mastered ? Theme.success.opacity(0.4) : Theme.separator.opacity(0.5),
                        lineWidth: mastered ? 1 : 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
    }
}
```
with:

```swift
struct VocabSetCard: View {
    let title: String
    let wordCount: Int
    /// Any one game finished — only ever "Keep going", never the badge.
    let completed: Bool
    let mastery: VocabSetMastery
    var subtitle: String?
    var actionLabel = "Practice"
    /// Room on the right for a control laid over the card (My sets' delete).
    var reservesTrailingControl = false

    private var mastered: Bool { mastery.isMastered }

    /// The two numbers a student acts on, in one quiet line.
    private var meta: String {
        let words = "\(ScoreText.string(wordCount)) \(wordCount == 1 ? "word" : "words")"
        return "\(words) · \(ScoreText.string(mastery.masteredModes))/\(ScoreText.string(mastery.totalModes)) games"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                // Words wear amber; a mastered set wears success.
                IconTile(
                    systemName: mastered ? "checkmark.circle.fill" : "character.book.closed.fill",
                    tone: mastered ? Theme.success : Theme.amber,
                    size: 40
                )
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    Text(meta)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textLabel)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if mastered {
                    Chip(text: "Mastered", icon: "checkmark.circle.fill", tone: .success)
                }
                if reservesTrailingControl {
                    Color.clear.frame(width: 30, height: 30)
                }
            }

            HStack(spacing: 12) {
                VocabMasteryBar(mastery: mastery, height: 8)
                // What the link does, drawn as a capsule — the card is the one target.
                HStack(spacing: 5) {
                    Image(systemName: "play.fill").font(.system(size: 10, weight: .bold))
                    Text(mastered ? "Play again" : (completed ? "Keep going" : actionLabel))
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(mastered ? Theme.accent : Color.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(mastered ? Theme.surface2 : Theme.accent))
                .fixedSize()
            }
        }
        .cardStyle(padding: 16)
        .contentShape(Rectangle())
    }
}
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabComponents.swift` — replace:

```swift
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(alignment: .top) { VocabTopEdge(colour: tone.solid) }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(done ? Theme.success.opacity(0.4) : Theme.separator.opacity(0.5), lineWidth: done ? 1 : 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
    }
}
```
with:

```swift
        // Look A: the shared card. The section's colour stays in its marks — tile, chips, ring,
        // bar — and a finished section keeps its success edge.
        .cardStyle(padding: 18)
        .overlay {
            if done {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    .allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
    }
}
```

- [ ] **Step 4: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. `grep -rn "VocabularyView.Tab" ios/MasterSAT/Sources` prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Vocabulary/WordsTodayCards.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabularyView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabComponents.swift
git commit -m "feat(ios): Words — review today with one Start, search the bank, and the lists in the new look

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: Run it, prove it, open the PR

**Files:** none (verification). Run by the controller, not a subagent.

- [ ] **Step 1: Kit green**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test 2>&1 | tail -2`
Expected: `✔ Test run with 721 tests … passed` (694 + 11 + 10 + 6). Only a literal pass counts.

- [ ] **Step 2: A local backend with phase-3 facts on it**

Migrate and seed exactly as Task 9 Step 2, run Task 19's `/tmp/seed_phase2.py` (the word homework and the "Phase 2" section are Words' fixtures; it is idempotent), and start the `ios-redesign-backend` preview. Then save as `/tmp/seed_phase3.py`:

```python
from django.contrib.auth import get_user_model
from rewards import services
from rewards.models import StudentStrike
from shop.models import ShopItem

U = get_user_model()
owner = U.objects.get(email="uat_owner@mastersat.test")
s1 = U.objects.get(email="uat_s1@mastersat.test")

# Three students well ahead of s1 on the all-time board, named, so the hero has someone to pass
# and the strike board has runs.
for first, last, xp, run in (("Malika", "Karimova", 400, 8), ("Jasur", "Toirov", 300, 6), ("Dilnoza", "Rahimova", 250, 5)):
    u, _ = U.objects.get_or_create(
        email=f"uat_p3_{first.lower()}@mastersat.test",
        defaults={"username": f"uat_p3_{first.lower()}", "first_name": first, "last_name": last})
    services.award(u, "MANUAL", idempotency_key=f"p3-seed-{u.pk}", points=xp, actor=owner, reason="phase 3 demo")
    StudentStrike.objects.update_or_create(student=u, defaults={"current_streak": run, "best_streak": run + 2})

# s1: XP below Dilnoza, a four-lesson run (best nine), points for a few coins.
services.award(s1, "MANUAL", idempotency_key="p3-seed-s1", points=120, actor=owner, reason="phase 3 demo")
StudentStrike.objects.update_or_create(student=s1, defaults={"current_streak": 4, "best_streak": 9, "spent_in_streak": 0})

ShopItem.objects.get_or_create(name="MasterSAT notebook", defaults={
    "description": "Squared paper, 80 pages.", "currency": ShopItem.CURRENCY_COIN, "price": 2,
    "stock": 10, "is_active": True, "created_by": owner})
ShopItem.objects.get_or_create(name="Sticker pack", defaults={
    "currency": ShopItem.CURRENCY_STRIKE, "price": 2, "stock": 10, "is_active": True, "created_by": owner})
print("phase 3 fixtures ready")
```

And `/tmp/seed_phase3_away.py` — what happens "while the student is away" (run it in Step 3, item 7):

```python
from django.contrib.auth import get_user_model
from rewards import services
from rewards.models import StudentStrike

U = get_user_model()
owner = U.objects.get(email="uat_owner@mastersat.test")
s1 = U.objects.get(email="uat_s1@mastersat.test")
services.award(s1, "ATTENDANCE_PRESENT", idempotency_key="p3-away-attendance", actor=owner)
services.award(s1, "CLASSWORK_MANUAL", idempotency_key="p3-away-classwork", points=140, actor=owner, reason="phase 3 demo")
record = StudentStrike.objects.get(student=s1)
record.current_streak += 1
record.best_streak = max(record.best_streak, record.current_streak)
record.save()
print("away changes ready")
```

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/backend
SECRET_KEY=dev-secret DEBUG=True ~/.pyenv/versions/3.12.2/bin/python3 manage.py shell -c "exec(open('/tmp/seed_phase3.py').read())"
git -C .. status --short   # nothing new under backend/ (db.sqlite3 is gitignored)
```
Expected: `phase 3 fixtures ready`.

- [ ] **Step 3: Run on the simulator against it**

Build (the build check), then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
xcrun simctl install booted build/dd/Build/Products/Debug-iphonesimulator/MasterSAT.app
xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"
```
Sign in as `uat_s1@mastersat.test` (password in `seed_classroom_uat.py`). Screenshot each item (`sleep 2; xcrun simctl io booted screenshot <name>.png`):

1. **First launch celebrates nothing:** right after sign-in no XP flies, the flame does not grow, no trophy card (there was no baseline on this phone).
2. **Trophy hero:** Rewards → a chunky amber card: the trophy plays once, "#N" with "overall · all time", and "M XP to pass Dilnoza" where N and M match the seeded board (Dilnoza 250 XP sits directly above s1 unless other local students have more XP than s1 — then it names whoever is directly above). Tap → the full leaderboard opens; Back.
3. **Streak and coins:** "4 lessons in a row", "Best: 9" (flame looping); the coins card shows coins to spend and "Convert points". Convert → the alert names the points and the coins → Convert → a coin bursts from the card, success haptic, the note says what was converted, the coin count rolls; the header's XP does not move.
4. **The board:** XP · All time lists Malika, Jasur, Dilnoza… and s1's own row in the chunky blue style (after "…" if below the top five); This month re-asks (a spinner, then the month's board); Strikes: the window chips disappear, rows read "8 in a row", "6 in a row"…, the server's sentence about runs shows under them; back to XP. Selection haptic on each chip and segment.
5. **Where your XP came from:** the newest earnings, green "+N"; a survey row (points only) is NOT listed; "All your points" opens Points.
6. **Shop:** the Shop card → Buy "MasterSAT notebook" → confirm → a coin bursts from that Buy button, the toast confirms; pull to refresh (a long swipe) → no "isn't loading" error appears.
7. **While you were away:** send the app to the background (`xcrun simctl launch booted com.apple.Preferences`), run `/tmp/seed_phase3_away.py` the same way as the seed, then bring the app back (`xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"`). Expected, on whichever tab is open: the header pill keeps the OLD number (never shows the new total first), "+145 XP" (140 for the classwork + the attendance rule's 5) rises mid-screen with the caption "Classwork awarded by a teacher + 1 more" (or the server's label for those events), lands on the pill, which rolls up and pulses once; the flame grows and its number rolls 4 → 5; after the landing the trophy card slides up — "You moved up to #N" over a star burst, "Overall · all time · up from #N+1" (s1's 120 + 145 = 265 passes Dilnoza's 250). "See the board" → Rewards at its root, the hero shows the new place.
8. **Relaunch celebrates nothing:** kill the app (`xcrun simctl terminate booted uz.mastersat.app`) and launch it → nothing flies or grows (the baseline was written).
9. **Words:** the hero reads "N words still to master", "Next up: Phase 2 set — Phase 2 · five words · Due … · N games to go" (or "Catch up · …" if the seed is older than its deadline); Start → the set page opens bound to that homework; Back. Segments Homework · Word bank · My sets, opening on Homework. Type "bri" → "brisk", captioned "From Phase 2"; stop the backend preview and search "can" → "Search didn't go through" (not "No matches"); start it again.
10. **Reduce Motion** (`xcrun simctl spawn booted defaults write com.apple.Accessibility ReduceMotionEnabled -bool true`, relaunch): background the app, award once more (`services.award(s1, "MANUAL", idempotency_key="p3-away-rm", points=10, actor=owner)` and `current_streak += 1` in a shell), bring it back → no flight, the pill's number just changes, the flame does not grow; VoiceOver (if on) hears "10 XP earned while you were away."; a conversion shows a still coin that fades; the trophy card (if a place was gained) fades in with a still trophy and no star burst. Turn it off (`-bool false`), relaunch.
11. **Under the Me sheet:** avatar → Overview → Shop → buy → no coin burst under the sheet (by design), the toast says it went through.
12. **Dark mode** (`xcrun simctl ui booted appearance dark`): Rewards and Words readable, the chunky edges visible; back to light.
13. **Bottom clearance:** the shop card on Rewards and the four-games guide on Words scroll fully above the floating bar.

Not reproducible locally (say so in the PR): "Keep earning XP to climb" needs a student past the 50-row page with a gap (covered by `LeaderboardPassTests.belowThePage`); "All caught up" needs every bank word mastered (covered by `VocabReviewTests.endStates`).

Record a 45-second walk-through of items 2, 3, 4 and 7 in the background: `xcrun simctl io booted recordVideo --codec h264 /tmp/phase3.mp4` (Ctrl-C to stop).

- [ ] **Step 4: Nothing unexpected in the tree, every commit by Viltrumlik**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git status --short                                   # empty
git log --format='%an <%ae> %s' origin/main..HEAD | grep -v "Viltrumlik <viltrumlik@gmail.com>" || echo "all Viltrumlik"
```

- [ ] **Step 5: Push and open the PR (merge after #305)**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git push origin HEAD:refs/heads/feat/ios-redesign-phase3
gh pr create --base main --head feat/ios-redesign-phase3 \
  --title "iOS redesign — phase 3: Rewards and Words, while you were away (merge after #305)" --body-file /tmp/pr-phase3.md
```
`/tmp/pr-phase3.md` says: **stacked on #305 (itself on #304) — merge those first; until then this diff includes phases 1–2**; what changed (Rewards: trophy hero on the global all-time board with the student to pass, streak and coins cards with convert, the board XP | Strikes, where XP came from, the shop; "while you were away": the XP flight with its caption, the flame, the trophy card; a coin burst on purchases and conversions; Words: Review today with one Start, search, the lists in look A; the phase-2 dip / backstop / all-done fixes); what did not (no backend change; the full leaderboard page is still XP-only; focus zones are phase 4); the Step 3 checklist with results, including what could not be seen locally; and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: iOS 17 / 18**

Run `xcrun simctl list runtimes | grep -E "iOS 1[78]"`. If a runtime is there, create a device on it, install, and repeat items 2, 3, 7 and 9; note the results in the PR. If none is installed, write under "Not verified" that the iOS 17/18 paths are unchecked and leave the ~8 GB runtime download to the owner.

- [ ] **Step 7: Send the owner the demo**

Send the screenshots and `/tmp/phase3.mp4` (SendUserFile), one line per item to look at. Merge only after the owner's "ha", and after #304 and #305.

## Phase 4 — Focus zones

Branch `feat/ios-redesign-phase4` in `/Users/macbook/Projects/dsat-wt-ios-redesign`, built on phase 3 (PR #308, HEAD `72a426c0`). One PR into `main`, merged after #308.

**What the student gets:** the places where a student concentrates move calmly — quickly, without bounce, and never saying right or wrong while they are answering. In the assessment runner the next question comes in from the side it is on, a picked choice fills with a tick, a crossed-out option gets a line drawn through it, the flag bounces, "Saved" appears for a moment after the server took an answer, the answered count rolls, and the question map settles in. Flashcards turn over in a quarter second and can be swiped for the verdict; the test fills its spelling well as the student types; matching pops a found pair and shakes a wrong one; speed's clock pulses with its last ten seconds; every game's end screen rolls its accuracy up. A homework hand-in shows each photo as it is picked and a ring per file with its real upload progress. The review and the midterm report count their score up and settle their rows in; the review's filter turns the card. Sign-in springs its logo in and shakes a wrong password. A score is celebrated — confetti, a success haptic, one sentence for VoiceOver — only when it passed or beat the attempt before it, and only the first time it is shown; handing work in stays celebrated every time, as in phase 2.

**Checked while this plan was written (2026-10-21).** In a throwaway worktree of `72a426c0`, every task below was applied exactly as written — by a script that executes each task's **Create** / **Rewrite** / **Edit** blocks verbatim, in order — and at every task end the kit tests passed (740 → 751 → 756 → 759 after Tasks 30–32) and, for Tasks 33–40, the app built (`** BUILD SUCCEEDED **`, no new warnings in the touched files). The one runtime claim the plan leans on — that `contentMargins(.bottom, 0)` on a cover's content cancels the tab's inherited bar margin — was checked on the iOS 26.3 simulator with a probe app (an inherited 200 pt margin reached a `fullScreenCover`'s `ScrollView`; the inner zero removed it). A failure at execution therefore means the tree has moved since — read the named file before improvising.

**How the code steps are written.** **Create** `path` — a new file, the whole of it. **Rewrite** `path` — the whole file replaced. **Edit** `path` — replace: OLD … with: NEW — OLD occurs exactly once in that file; replace it verbatim. Paths are from the repository root. Every app task ends with the build check of phase 2 ("The build check (used by every app task)").

### Decisions taken where the design left room

- **The focus-zone motion rules, as built** (approved design §3 and the controller's ruling): everything that moves in a focus zone takes at most 250 ms on an ease-out curve (`Motion.focus` 0.2 s, `Motion.focusTap` 0.12 s, entrances staggered by at most three 30 ms beats) and nothing overshoots over content. A spring is allowed only on chrome that never covers content — the runner's flag glyph, the sign-in logo, the games' trophy. Under Reduce Motion every movement becomes a fade or nothing: a turn is a crossfade, the flip a crossfade, a swipe moves without tilting, a shake becomes a red pulse over the refused box, the brand panel holds still, numbers are simply there. The helpers live in one place (`Support/Motion/Motion.swift`, Task 33) and the focus-zone tasks use only them.
- **No answered-count bar in the runner** (controller ruling, the owner's standing "what does it tell the reader that the number does not?"): "N/M" is already on screen. It rolls when it moves instead.
- **Never a hint at right or wrong while answering** — in the runner and the vocabulary test no colour, haptic or motion differs between a right and a wrong answer: every pick, cross-out and flag ticks the same selection haptic, presses look alike (`FocusPress`), the spelling well shows a typed letter the same whether it is right or not. The runner's question map shows answered cells in the selection blue instead of green — green means "correct" on the review. Matching is the one game that speaks while playing, as the approved design lists ("pop on match, shake on miss").
- **"Counts up" means the digits roll once** (`numericText`, one 200 ms beat, `RollingNumber`): ticking through every number would take longer than the focus zones allow.
- **The cross-out is drawn, not typed:** a line is drawn through the whole option, as Bluebook rules one out. The option's own strike-through goes — toggling it re-rendered a rich option's KaTeX web view, a flash and a height jump on every cross-out.
- **A new question opens at its top** (the runner kept the last one's scroll offset), and a typed answer's keyboard closes as the question turns.
- **Flashcards' swipe is a shortcut for the two buttons**, not a new rule: right is "Correct", left "Still learning", past 110 pt a stamp says which (the student's own verdict — flashcards are self-graded), letting go there gives exactly what the button gives, and it is off while a verdict is held. The buttons stay, for VoiceOver and for anyone who does not swipe.
- **Speed's urgency is a pulse per second, not a loop:** the clock beside the word breathed continuously; now it pulses once with each of the last ten seconds.
- **An outcome is celebrated once — the first time it is shown, on this phone** (`OutcomeMemory` per student in `UserDefaults`, Task 30): opening a result again is not an event. A midterm qualifies when the centre marked it passed (a pre-midterm is never judged); an assessment when it beat "the attempt before" — the newest earlier attempt this phone showed on the same set (the homework and the set's title), because the student's lists and the review carry only a homework's newest attempt (the server keeps every attempt, but never hands the phone the one before); a word-game round when the server says it mastered its game. A first review on a new phone therefore proves nothing and celebrates nothing; "Up from 60%" then shows on every opening of the attempt that beat it.
- **The games' end screen parties only on the server's word** (`CelebrationRule.vocabRound`): it used to fire on the phone's own clean sweep — before the round was graded, and once on a save that then failed — and on a set mastered by earlier rounds while this one was not clean.
- **An outcome's confetti is drawn by the page** (`OutcomeConfetti`), not by the root overlay: the midterm report is also opened inside the Me sheet, which the root overlay sits under.
- **"Why this answer works" stays open**, as on the web; it settles in last on each card. Hiding it behind a tap would cost every student a tap on the screen that exists to explain.
- **The upload's rings are real or not there** (the owner's "no decorative progress bars"): one multipart request carries every file, so the kit maps the request's sent bytes onto each file's place in the body (Task 32). A tick means all of that file's bytes have gone; the hand-in is confirmed by the server, which is what the celebration waits for. A ring never runs backwards (a token refresh re-sends the body), and the progress lives in a small `@Observable` read only by the rows, so the page does not re-render with every chunk.
- **Sign-in is `Screens/Auth/`** (`AuthView`'s `SignInForm` and `RegisterForm`, the brand panel in `AuthChrome`). `Screens/Account/AccountSignInView.swift`, named in the brief, is the Me sheet's "Sign-in & password" settings page; its one wrong password — the current one, when changing it — shakes the same way. The "breathing brand panel" is the panel's existing drifting shapes (the web's `dz-float`); they now hold still under Reduce Motion, which they did not.
- **Haptics** follow the approved list: selection for picks, cross-outs, flags, flips, the swipe threshold and the test's and speed's answers; warning for a wrong password and a matching miss; success for an outcome celebrated (the effort haptic is phase 2's). No new sounds, no haptic per keystroke.
- **The review and the midterm report take the phase-2 load rules now** (a refresh runs detached; a cancelled load is not a failure) because this phase rebuilds both pages — as phase 3 did for the Rewards pages. The other pushed pages stay on phase 5's list.

### Earlier phases' hand-off → tasks

| Deferred to phase 4 (Phase 1 / 2 / 3 outcome) | Where |
|---|---|
| Phase 1: `contentMargins` reaches full-screen covers (runner, word games, story viewer, live quiz, ticket) — zero it there | Task 33 (`noBarClearance()` on all eight covers presented from inside a tab; checked with a probe on the simulator) |
| Phase 2: `handInFrame` / `submitFrame` are `@State` written every scroll frame | Task 33 (`submitFrame` → `FrameBox`; `FrameBox` moves to `Celebrations.swift`), Task 38 (`handInFrame` → `handInSpot`) |
| Phase 2: leaving a word game with an unsaved round may save without a celebration | Task 35 (`restart` and `exit` report a finish their flush confirmed, through the cover's one-shot) |
| Phase 2: kit `CelebrationRule` for outcomes (ruled out of phase 2); "outcome celebrations stay in phase 4 with the reviews that own them" | Task 30 (kit: `CelebrationRule`, `OutcomeMemory`, `OutcomeBook`), Task 37 (the games' end screen), Task 39 (the review and the midterm report) |
| Phase 3: a refresh mid-session (xpBefore captured at session start) can drop the pill un-animated at hand-in | Task 30 (`XPDelta.baseline`), Task 33 (`CelebrationCenter.celebrate` measures from it) |
| Owner: check on an iOS 17 / 18 runtime | Task 41 Step 6 |
| Phase 1 "kit polish (any phase)": `AppTab.allCases` order test, confetti seed/budget tests, a test that every `LottieAsset` loads, rename `gravity` | Not here — none touches a focus zone; phase 5's polish and audit take them (the Lottie load test still has no app test target to live in) |
| Phase 5 items touched in passing | Task 39 takes `MidtermReportView`'s plain `.refreshable` and the review's / report's cancelled-load-as-failure; `HomeworkDetailView:105`'s cancelled first load stays on phase 5's list (Task 38 changes only the hand-in card) |

### File structure (phase 4)

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):
- `Motion/CelebrationRule.swift` — **new.** `CelebrationRule`, `OutcomeMemory`, `OutcomeBook`.
- `Models/Assessment.swift` — `AssessmentReviewMeta.assignmentId`, `AssessmentReview.setKey`.
- `Rewards/XPDelta.swift` — `XPDelta.baseline`.
- `Assessment/AssessmentRunner.swift` — `savedCount`.
- `Vocabulary/VocabGames.swift` — `SpellingTile`, `spellingTiles`.
- `Core/MultipartForm.swift` — `fileRanges()`, `UploadProgress`; `Core/APIClient.swift` — `send(_:as:onBodySent:)`, `BodyProgress`; `Student/StudentAPI.swift` — `submitHomework(…, onFileProgress:)`.

Kit tests (`ios/MasterSATKit/Tests/MasterSATKitTests/`): `CelebrationRuleTests.swift`, `FocusZoneTests.swift`, `UploadProgressTests.swift` — **new**; `AssessmentRunnerTests.swift` (one test).

App (`ios/MasterSAT/Sources/`):
- `Support/Motion/Motion.swift` — the focus-zone kit (`FocusTurn`, `.focusTurn`, `FocusPress`, `focusReveal`, `focusEntrance`, `focusShake`, `RollingNumber`).
- `Support/Motion/Celebrations.swift` — `celebrate` measures from hand-in; `OutcomeConfetti`; `FrameBox` (moved from `Screens/Rewards/RewardsTabCards.swift`).
- `Support/PageChrome.swift` — `PillTabs.motion`.
- `Screens/RootView.swift` — `noBarClearance()`; the eight covers in `HomeworkDetailView`, `AssessmentReviewView`, `AssessmentBoardViews`, `VocabSetPage`, `StoriesRail`, `StoryViewer`, `LiveQuizJoinView`, `EventsView` use it.
- `Screens/Assessments/AssessmentRunnerView.swift` — the runner, the map, the choice row.
- `Screens/Vocabulary/VocabStudyView.swift` (flashcards, the finish hand-off), `VocabTestView.swift`, `MatchingView.swift`, `SpeedView.swift`, `StudyShell.swift` (the end screen).
- `Screens/HomeworkDetailView.swift` — the hand-in card; `UploadMeter`, `StagedFileRow`, `UploadRing`.
- `Screens/Assessments/AssessmentReviewView.swift`, `Screens/Midterms/MidtermReportView.swift`.
- `Screens/Auth/AuthChrome.swift`, `Screens/Auth/AuthView.swift`, `Screens/Account/AccountComponents.swift`, `Screens/Account/AccountSignInView.swift`.
- `Screens/Surveys/SurveyFillView.swift` — `submitFrame` boxed.

---

### Task 30: When a score is celebrated, in the kit (`CelebrationRule`, `OutcomeMemory`, `OutcomeBook`, `XPDelta.baseline`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationRule.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift` (`AssessmentReviewMeta.assignmentId`, `AssessmentReview.setKey`)
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPDelta.swift` (`XPDelta.baseline`)
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationRuleTests.swift`

**Interfaces:**
- Consumes: `VocabSessionSummary.modeMastered`, `AssessmentReview`, `AssessmentReviewMeta`, `JSONCoding` (all existing).
- Produces: `public enum CelebrationRule { static func midterm(isGraded: Bool, passed: Bool?) -> Bool; static func assessment(percent: Double, previous: Double?) -> Bool; static func vocabRound(_: VocabSessionSummary?) -> Bool }`; `public struct OutcomeMemory: Codable, Sendable, Equatable` with `mutating func showAssessment(setKey: String, attemptId: Int, percent: Double) -> Double?`, `mutating func celebrate(_ key: String, if qualifies: Bool) -> Bool`, `static func assessmentKey(_: Int) -> String`, `static func midtermKey(_: Int) -> String`; `public struct OutcomeBook` (`read(userID:) -> OutcomeMemory`, `write(_:userID:)`, `static func key(userID:) -> String` = `"outcomes.v1.<id>"`); `AssessmentReviewMeta.assignmentId: Int?` (decoded from the meta's `assignment_id`, which the server already sends); `AssessmentReview.setKey: String?`; `XPDelta.baseline(atStart: Int?, atHandIn: Int?) -> Int?`.

Rules for this task (kit): no backend change — `assignment_id` is already in every review's `meta` (`backend/assessments/helpers.py::_build_hw_meta`); the kit simply stops dropping it. An OUTCOME (a score) is celebrated only when it passed or improved, once, the first time it is shown; effort is celebrated every time already (`FinishedWork`, phase 2) and is not touched here. Every mutating call in a test sits on its own line, never inside `#expect`.

Why `XPDelta.baseline` is here: it is the phase 3 hand-off "a refresh mid-session can drop the pill un-animated at hand-in". A task's gain is measured from the header's XP when the work STARTED; when a return to the app or a reconnect raised the header in between, the task's pending entry held that rise back the moment it was recorded — the pill dropped to the old total, un-animated — and the rise was then claimed as the task's own gain. The server pays a task's XP when it is handed in, so the header's XP AT hand-in is a floor for the baseline. Task 33 makes `CelebrationCenter.celebrate` use it.

- [ ] **Step 1: Write the failing test**

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationRuleTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct CelebrationRuleTests {

    private func summary(_ json: String) throws -> VocabSessionSummary {
        try JSONCoding.decoder.decode(VocabSessionSummary.self, from: Data(json.utf8))
    }

    @Test("A midterm is celebrated when the centre marked it passed — never a pre-midterm, never a miss")
    func midterm() {
        #expect(CelebrationRule.midterm(isGraded: true, passed: true))
        #expect(!CelebrationRule.midterm(isGraded: true, passed: false))
        #expect(!CelebrationRule.midterm(isGraded: true, passed: nil), "no pass mark, no verdict")
        #expect(!CelebrationRule.midterm(isGraded: false, passed: true), "a pre-midterm is scored, never judged")
    }

    @Test("An assessment is celebrated only when it beat the attempt before it")
    func assessment() {
        #expect(CelebrationRule.assessment(percent: 75, previous: 60))
        #expect(!CelebrationRule.assessment(percent: 60, previous: 60), "level is not better")
        #expect(!CelebrationRule.assessment(percent: 40, previous: 60))
        #expect(!CelebrationRule.assessment(percent: 100, previous: nil), "nothing to beat proves nothing")
    }

    @Test("A word-game round is celebrated when the server says it mastered its game")
    func vocabRound() throws {
        let mastered = try summary(#"{"id":1,"correct_count":5,"total_count":5,"set_completed":true,"mode_mastered":true}"#)
        let notMastered = try summary(#"{"id":2,"correct_count":4,"total_count":5,"set_completed":true,"mode_mastered":false}"#)
        let older = try summary(#"{"id":3,"correct_count":5,"total_count":5,"set_completed":true}"#)
        #expect(CelebrationRule.vocabRound(mastered))
        #expect(!CelebrationRule.vocabRound(notMastered))
        #expect(!CelebrationRule.vocabRound(older), "a server that does not say so has not said so")
        #expect(!CelebrationRule.vocabRound(nil), "a round whose save failed has no summary")
    }
}

@Suite struct OutcomeMemoryTests {

    @Test("The first attempt on a set is only remembered; a later, better one improved on it, on every showing")
    func improvement() {
        var memory = OutcomeMemory()
        let first = memory.showAssessment(setKey: "12/Linear equations", attemptId: 40, percent: 60)
        #expect(first == nil)

        let second = memory.showAssessment(setKey: "12/Linear equations", attemptId: 52, percent: 75)
        #expect(second == 60)

        let again = memory.showAssessment(setKey: "12/Linear equations", attemptId: 52, percent: 75)
        #expect(again == 60, "the page can say \"Up from 60%\" every time it opens")
    }

    @Test("Level or lower is no improvement; an older attempt opened later changes nothing")
    func noImprovement() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "s", attemptId: 40, percent: 60)
        let level = memory.showAssessment(setKey: "s", attemptId: 41, percent: 60)
        #expect(level == nil)
        let lower = memory.showAssessment(setKey: "s", attemptId: 42, percent: 30)
        #expect(lower == nil)
        let better = memory.showAssessment(setKey: "s", attemptId: 43, percent: 50)
        #expect(better == 30, "measured against the newest attempt before it, not the best")

        let older = memory.showAssessment(setKey: "s", attemptId: 39, percent: 90)
        #expect(older == nil, "attempt 39 came before 43 — it is not an improvement on it")
        let newest = memory.showAssessment(setKey: "s", attemptId: 44, percent: 55)
        #expect(newest == 50, "the older attempt did not become the one to beat")
    }

    @Test("Each set is compared only with itself")
    func setsApart() {
        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 90)
        let other = memory.showAssessment(setKey: "12/Geometry", attemptId: 41, percent: 50)
        #expect(other == nil)
        let next = memory.showAssessment(setKey: "12/Geometry", attemptId: 42, percent: 60)
        #expect(next == 50)
    }

    @Test("An outcome is celebrated once, and only when it qualifies")
    func once() {
        var memory = OutcomeMemory()
        let notYet = memory.celebrate(OutcomeMemory.midtermKey(7), if: false)
        #expect(!notYet)
        let first = memory.celebrate(OutcomeMemory.midtermKey(7), if: true)
        #expect(first)
        let second = memory.celebrate(OutcomeMemory.midtermKey(7), if: true)
        #expect(!second, "opening the report again is not a new event")
        let other = memory.celebrate(OutcomeMemory.assessmentKey(7), if: true)
        #expect(other, "an assessment and a midterm never share a key")
        #expect(OutcomeMemory.midtermKey(7) == "midterm.7")
        #expect(OutcomeMemory.assessmentKey(7) == "assessment.7")
    }
}

@Suite struct OutcomeBookTests {

    private func scratch() -> (UserDefaults, String) {
        let name = "outcomes-tests-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test("Nothing stored reads as an empty memory; what was written reads back, per student")
    func roundTrip() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        let book = OutcomeBook(defaults: defaults)
        #expect(book.read(userID: 7) == OutcomeMemory())

        var memory = OutcomeMemory()
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 40, percent: 60)
        _ = memory.showAssessment(setKey: "12/Algebra", attemptId: 41, percent: 80)
        _ = memory.celebrate(OutcomeMemory.assessmentKey(41), if: true)
        book.write(memory, userID: 7)

        #expect(book.read(userID: 7) == memory)
        #expect(book.read(userID: 8) == OutcomeMemory(), "another account on the phone starts empty")
        #expect(OutcomeBook.key(userID: 7) == "outcomes.v1.7")
    }

    @Test("A value that will not decode is an empty memory, not a crash")
    func corrupt() {
        let (defaults, name) = scratch()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(Data("not json".utf8), forKey: OutcomeBook.key(userID: 3))
        #expect(OutcomeBook(defaults: defaults).read(userID: 3) == OutcomeMemory())
    }
}

@Suite struct HandInBaselineTests {

    @Test("A task's gain is measured from the start, raised to what the header held at hand-in")
    func baseline() {
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 130) == 130, "a rise in between is not the task's")
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 100) == 100)
        #expect(XPDelta.baseline(atStart: 100, atHandIn: nil) == 100)
        #expect(XPDelta.baseline(atStart: 100, atHandIn: 90) == 100, "a stale read never lowers it")
        #expect(XPDelta.baseline(atStart: nil, atHandIn: 130) == nil, "unknown at the start measures nothing")
    }
}

@Suite struct AssessmentSetKeyTests {

    private func review(_ meta: String) throws -> AssessmentReview {
        try JSONCoding.decoder.decode(AssessmentReview.self, from: Data(#"{"meta":\#(meta),"questions":[]}"#.utf8))
    }

    @Test("A review names its set by homework and title; without the homework it names nothing")
    func setKey() throws {
        let full = try review(#"{"assignment_id":12,"assignment_title":"Week 3","set_title":"Linear equations","question_count":10}"#)
        #expect(full.meta?.assignmentId == 12)
        #expect(full.setKey == "12/Linear equations")

        let untitled = try review(#"{"assignment_id":12,"question_count":10}"#)
        #expect(untitled.setKey == "12/")

        let older = try review(#"{"set_title":"Linear equations","question_count":10}"#)
        #expect(older.meta?.assignmentId == nil)
        #expect(older.setKey == nil)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "CelebrationRuleTests|OutcomeMemoryTests|OutcomeBookTests|HandInBaselineTests|AssessmentSetKeyTests" 2>&1 | tail -5`
Expected: build errors — `cannot find 'CelebrationRule' in scope`, `cannot find 'OutcomeMemory' in scope`, `type 'XPDelta' has no member 'baseline'`, `value of type 'AssessmentReview' has no member 'setKey'`.

- [ ] **Step 3: Create `Motion/CelebrationRule.swift`**

**Create** `ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationRule.swift`:

```swift
import Foundation

/// When a SCORE is celebrated.
///
/// Effort — handing something in — is celebrated every time (`FinishedWork`). An outcome is
/// celebrated only when it is good news the app can prove: a midterm the centre marked passed,
/// an assessment that beat the attempt before it on the same set, a word game the server says
/// this round mastered. Never a score that went down, never one the app only believes, and never
/// twice (`OutcomeMemory`). Its readers are the assessment review, the midterm report and the
/// word games' end screen.
public enum CelebrationRule {
    /// A midterm the centre marked passed. A pre-midterm is scored but never judged
    /// (`is_graded` false), so it is never celebrated, whatever it scored.
    public static func midterm(isGraded: Bool, passed: Bool?) -> Bool {
        isGraded && passed == true
    }

    /// An attempt that scored more than the attempt before it on the same set. With no attempt
    /// before it — or none this phone saw — there is nothing to beat, so nothing is celebrated.
    public static func assessment(percent: Double, previous: Double?) -> Bool {
        guard let previous else { return false }
        return percent > previous
    }

    /// A word-game round the server says mastered its game. The server recomputes
    /// `mode_mastered` from the stored round, so a round whose save failed — no summary — is
    /// never celebrated, and neither is a clean sweep the phone only thinks it saw.
    public static func vocabRound(_ summary: VocabSessionSummary?) -> Bool {
        summary?.modeMastered == true
    }
}

/// What this phone has shown a student of their own scores — so an outcome is celebrated once,
/// and an assessment can be compared with the attempt before it.
///
/// The phone is only ever handed a homework's newest attempt (`my-result`, the lists), so "the
/// attempt before" is the newest earlier one this phone showed for the same set (`AssessmentReview.setKey`).
/// Attempt ids grow in the order attempts are started, so an older attempt opened after a newer
/// one is not "before" it and changes nothing.
public struct OutcomeMemory: Codable, Sendable, Equatable {
    public struct Shown: Codable, Sendable, Equatable {
        public let attemptId: Int
        public let percent: Double

        public init(attemptId: Int, percent: Double) {
            self.attemptId = attemptId
            self.percent = percent
        }
    }

    /// The newest attempt shown, per set.
    public private(set) var lastShown: [String: Shown] = [:]
    /// Per attempt that beat the one before it: the score it beat.
    public private(set) var improvedFrom: [Int: Double] = [:]
    /// Outcomes already celebrated (`assessmentKey`, `midtermKey`).
    public private(set) var celebrated: Set<String> = []

    public init() {}

    /// A marked attempt is on screen. Returns the score it improved on — when it beat the newest
    /// earlier attempt on the same set this phone showed — on every showing, so the page can say
    /// so each time it opens; nil otherwise. Remembers it as the set's newest attempt.
    public mutating func showAssessment(setKey: String, attemptId: Int, percent: Double) -> Double? {
        if let previous = lastShown[setKey] {
            if attemptId > previous.attemptId {
                if CelebrationRule.assessment(percent: percent, previous: previous.percent) {
                    improvedFrom[attemptId] = previous.percent
                }
                lastShown[setKey] = Shown(attemptId: attemptId, percent: percent)
            }
        } else {
            lastShown[setKey] = Shown(attemptId: attemptId, percent: percent)
        }
        return improvedFrom[attemptId]
    }

    /// Whether an outcome's celebration plays now: it qualifies and has never played. Marks it,
    /// so a page opened again does not celebrate again.
    public mutating func celebrate(_ key: String, if qualifies: Bool) -> Bool {
        guard qualifies, !celebrated.contains(key) else { return false }
        celebrated.insert(key)
        return true
    }

    public static func assessmentKey(_ attemptId: Int) -> String { "assessment.\(attemptId)" }
    public static func midtermKey(_ attemptId: Int) -> String { "midterm.\(attemptId)" }
}

/// The memory on the phone, one small JSON value per student in `UserDefaults` — the same home
/// as `LastSeenBook` and Today's seen results. Keyed by user id, so a second account on the
/// phone starts empty; a value that will not decode reads as empty rather than failing.
// @unchecked: the SDK does not mark UserDefaults Sendable, but Apple documents it as thread-safe.
public struct OutcomeBook: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public static func key(userID: Int) -> String { "outcomes.v1.\(userID)" }

    public func read(userID: Int) -> OutcomeMemory {
        guard let data = defaults.data(forKey: Self.key(userID: userID)),
              let memory = try? JSONDecoder().decode(OutcomeMemory.self, from: data)
        else { return OutcomeMemory() }
        return memory
    }

    public func write(_ memory: OutcomeMemory, userID: Int) {
        guard let data = try? JSONEncoder().encode(memory) else { return }
        defaults.set(data, forKey: Self.key(userID: userID))
    }
}
```

- [ ] **Step 4: The review names its set**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift` — replace:

```swift
public struct AssessmentReviewMeta: Decodable, Sendable, Equatable {
    public let assignmentTitle: String?
```
with:

```swift
public struct AssessmentReviewMeta: Decodable, Sendable, Equatable {
    /// The homework the attempt belongs to — with the set's title, what tells one set's attempts
    /// from another's (`AssessmentReview.setKey`).
    public let assignmentId: Int?
    public let assignmentTitle: String?
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift` — replace:

```swift
        case assignmentTitle = "assignment_title"
```
with:

```swift
        case assignmentId = "assignment_id"
        case assignmentTitle = "assignment_title"
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift` — replace:

```swift
        assignmentTitle = try? c.decodeIfPresent(String.self, forKey: .assignmentTitle)
```
with:

```swift
        assignmentId = try? c.decodeIfPresent(Int.self, forKey: .assignmentId)
        assignmentTitle = try? c.decodeIfPresent(String.self, forKey: .assignmentTitle)
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift` — replace:

```swift
    public var missed: [AssessmentReviewQuestion] { questions.filter { $0.isCorrect == false } }
```
with:

```swift
    public var missed: [AssessmentReviewQuestion] { questions.filter { $0.isCorrect == false } }

    /// Which set this is an attempt at, for comparing it with the attempt before: the homework
    /// and the set's title (one homework carries a set once). Nil when the server did not say
    /// which homework — then nothing is compared and nothing is celebrated as improved.
    public var setKey: String? {
        guard let assignmentId = meta?.assignmentId else { return nil }
        return "\(assignmentId)/\(meta?.setTitle ?? "")"
    }
```

- [ ] **Step 5: The baseline a task's gain is measured from**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPDelta.swift` — replace:

```swift
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
    }
}
```
with:

```swift
    public static func gain(before: Int?, after: Int?) -> Int {
        guard let before, let after, after > before else { return 0 }
        return after - before
    }

    /// What a finished task's gain is measured from: the header's total when the work started,
    /// raised to the total it holds when the work is handed in.
    ///
    /// The server pays a task's XP when it is handed in, so a rise the header took in between —
    /// a return to the app, a reconnect — came from somewhere else. Measured from the start, that
    /// rise would be claimed as this task's gain, and the header would hold it back the moment
    /// the task was recorded: the pill would drop to the old total at hand-in. A stale read never
    /// lowers the baseline, and unknown at the start stays unknown — nothing is measured.
    public static func baseline(atStart: Int?, atHandIn: Int?) -> Int? {
        guard let atStart else { return nil }
        return max(atStart, atHandIn ?? atStart)
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "CelebrationRuleTests|OutcomeMemoryTests|OutcomeBookTests|HandInBaselineTests|AssessmentSetKeyTests|AssessmentBundleTests" 2>&1 | tail -4`
Expected: every suite passes — the five new ones (3 + 4 + 2 + 1 + 1 tests) and `AssessmentBundleTests` unchanged. Whole kit: `swift test 2>&1 | tail -2` → `✔ Test run with 751 tests … passed` (740 + 11).

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Motion/CelebrationRule.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Models/Assessment.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Rewards/XPDelta.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/CelebrationRuleTests.swift
git commit -m "feat(ios-kit): a score is celebrated once, when it passed or improved; a task's gain is measured from hand-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 31: What the runner and the spelling well show, in the kit (`AssessmentRunner.savedCount`, `VocabGames.spellingTiles`)

**Files:**
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Assessment/AssessmentRunner.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabGames.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/AssessmentRunnerTests.swift` (one test added), `ios/MasterSATKit/Tests/MasterSATKitTests/FocusZoneTests.swift` (new)

**Interfaces:**
- Consumes: `AssessmentRunner` (its private `push`), `VocabGames.maskWord`'s rule (non-letters are structure).
- Produces: `AssessmentRunner.savedCount: Int` (read-only; +1 per answer write the server confirmed); `VocabGames.SpellingTile { kind: Kind (.given | .typed | .blank | .structure); character: String }` and `VocabGames.spellingTiles(word: String, revealing: Int?, typed: String) -> [SpellingTile]`.

Why: the runner's quiet "Saved" (Task 34) must appear only when the server really took an answer — a counter of confirmations is the one thing the view cannot work out for itself. The spelling question's tiles (Task 36) fill with what the student types; where each typed letter lands is pure logic, and it must never tell a right letter from a wrong one.

Rules (kit): no backend change. "Saved" counts confirmations only — a refused write (it lands in `unsaved`) and a write the server overruled with a newer answer (`conflict`) do not count. The tiles never judge: a typed letter looks the same whether it is right or wrong.

- [ ] **Step 1: Write the failing tests**

**Edit** `ios/MasterSATKit/Tests/MasterSATKitTests/AssessmentRunnerTests.swift` — replace:

```swift
        #expect(!ok)
        #expect(runner.unsaved.contains(30))
        #expect(!server.requests.contains { $0.url?.absoluteString.contains("/attempts/submit/") == true })
    }
}
```
with:

```swift
        #expect(!ok)
        #expect(runner.unsaved.contains(30))
        #expect(!server.requests.contains { $0.url?.absoluteString.contains("/attempts/submit/") == true })
    }

    @Test("Every write the server confirms counts towards \"Saved\"; a refused one does not")
    func savedCountsConfirmations() async throws {
        server.handler = { _ in .json(bundleJSON(answers: [["id": 1, "question_id": 30, "answer": "x", "client_seq": 2]])) }
        let runner = runner()
        await runner.load()
        #expect(runner.savedCount == 0, "answers the server already held are not news")
        server.handler = { _ in .json(["ok": true]) }

        runner.setAnswer(.string("A"), for: 10)
        try await Task.sleep(for: .milliseconds(120))
        #expect(runner.savedCount == 1)

        server.handler = { request in
            request.url?.absoluteString.contains("/attempts/answer/") == true
                ? .json(["detail": "boom"], status: 500)
                : .json(["ok": true])
        }
        runner.setAnswer(.string("B"), for: 10)
        try await Task.sleep(for: .milliseconds(120))
        #expect(runner.savedCount == 1)
        #expect(runner.unsaved.contains(10))
    }
}
```

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/FocusZoneTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct SpellingTilesTests {

    /// `[x]` a given letter, a bare letter a typed one, `_` a blank, anything else structure.
    private func show(_ tiles: [VocabGames.SpellingTile]) -> String {
        tiles.map { tile in
            switch tile.kind {
            case .given: return "[\(tile.character)]"
            case .typed, .structure: return tile.character
            case .blank: return "_"
            }
        }.joined()
    }

    @Test("Nothing typed: the given letter among the wells")
    func nothingTyped() {
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "")) == "__[i]__")
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: nil, typed: "")) == "_____")
    }

    @Test("Typed letters fill the word's letters in order; the given letter keeps its place")
    func filling() {
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "br")) == "br[i]__")
        #expect(show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "brisk")) == "br[i]sk")
        #expect(
            show(VocabGames.spellingTiles(word: "brisk", revealing: 2, typed: "brasks")) == "br[i]sk",
            "the given letter is never written over, and letters past the end are not shown"
        )
    }

    @Test("Shape is never typed into: a hyphen or a space stays, the letters line up around it")
    func structure() {
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "wellbeing")) == "[w]ell-being")
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "well-b")) == "[w]ell-b____")
        #expect(show(VocabGames.spellingTiles(word: "well-being", revealing: 0, typed: "w e")) == "[w]e__-_____")
    }

    @Test("Never a verdict: a wrong letter is a typed letter like any other, as typed")
    func noVerdict() {
        let tiles = VocabGames.spellingTiles(word: "brisk", revealing: nil, typed: "Xq")
        #expect(tiles[0] == VocabGames.SpellingTile(kind: .typed, character: "X"))
        #expect(tiles[1] == VocabGames.SpellingTile(kind: .typed, character: "q"))
        #expect(tiles[2] == VocabGames.SpellingTile(kind: .blank, character: ""))
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "AssessmentRunnerTests|SpellingTilesTests" 2>&1 | tail -5`
Expected: build errors — `value of type 'AssessmentRunner' has no member 'savedCount'`, `type 'VocabGames' has no member 'spellingTiles'`.

- [ ] **Step 3: The runner counts confirmed writes**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Assessment/AssessmentRunner.swift` — replace:

```swift
    public private(set) var unsaved: Set<Int> = []
```
with:

```swift
    public private(set) var unsaved: Set<Int> = []
    /// Answer writes the server has confirmed since the attempt opened — what the runner's quiet
    /// "Saved" listens to. Confirmations, not answers: a refused write (it is in `unsaved`) and a
    /// write the server overruled with a newer answer (`conflict`) do not count.
    public private(set) var savedCount = 0
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Assessment/AssessmentRunner.swift` — replace:

```swift
            unsaved.remove(questionId)
            // Only clean if nothing newer was typed while this write was in flight; if it
            // was, its own scheduled write is still coming.
            if answers[questionId] == value { dirty.remove(questionId) }
```
with:

```swift
            unsaved.remove(questionId)
            savedCount += 1
            // Only clean if nothing newer was typed while this write was in flight; if it
            // was, its own scheduled write is still coming.
            if answers[questionId] == value { dirty.remove(questionId) }
```

- [ ] **Step 4: The spelling well**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabGames.swift` — replace:

```swift
    /// The word as blanks with one position filled in.
    ///
    /// Non-letters — spaces, hyphens, apostrophes — stay visible. They are structure, not
    /// the answer, and hiding them would turn spelling into guessing at the shape too.
    public static func maskWord(_ word: String, revealing index: Int?) -> [String] {
```
with:

```swift
    /// One tile of the spelling question's well.
    public struct SpellingTile: Sendable, Equatable {
        public enum Kind: Sendable, Equatable {
            /// The letter given away (`TestQuestion.revealIndex`) — never written over.
            case given
            /// A letter the student has typed, in its place.
            case typed
            /// A letter still to type.
            case blank
            /// A space, hyphen or apostrophe: shape, not answer — never typed into.
            case structure
        }

        public let kind: Kind
        /// What the tile shows, as typed (the view sets the case); empty for a blank.
        public let character: String

        public init(kind: Kind, character: String) {
            self.kind = kind
            self.character = character
        }
    }

    /// The masked word with what the student has typed so far dropped into it.
    ///
    /// The typed letters fill the word's LETTER positions in order — the n-th typed letter sits
    /// on the n-th letter of the word — so a student who types the whole word sees it line up
    /// with its shape, structure skipped ("wellbeing" fills "well-being"). The given letter keeps
    /// its tile: the typed letter on its position is consumed, not shown. Letters typed past the
    /// end are not shown. Nothing here compares a letter with the answer — a wrong letter is a
    /// typed letter like any other; the test says nothing until its end.
    public static func spellingTiles(word: String, revealing index: Int?, typed: String) -> [SpellingTile] {
        var letters = typed.filter(\.isLetter).makeIterator()
        return Array(word).enumerated().map { offset, character in
            guard character.isLetter else { return SpellingTile(kind: .structure, character: String(character)) }
            let next = letters.next()
            if offset == index { return SpellingTile(kind: .given, character: String(character)) }
            if let next { return SpellingTile(kind: .typed, character: String(next)) }
            return SpellingTile(kind: .blank, character: "")
        }
    }

    /// The word as blanks with one position filled in.
    ///
    /// Non-letters — spaces, hyphens, apostrophes — stay visible. They are structure, not
    /// the answer, and hiding them would turn spelling into guessing at the shape too.
    public static func maskWord(_ word: String, revealing index: Int?) -> [String] {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "AssessmentRunnerTests|SpellingTilesTests|VocabGamesTests" 2>&1 | tail -4`
Expected: every suite passes — `AssessmentRunnerTests` with its new test, `SpellingTilesTests` (4 tests), `VocabGamesTests` unchanged. Whole kit: `swift test 2>&1 | tail -2` → `✔ Test run with 756 tests … passed` (751 + 5).

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Assessment/AssessmentRunner.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Vocabulary/VocabGames.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/AssessmentRunnerTests.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/FocusZoneTests.swift
git commit -m "feat(ios-kit): the runner counts confirmed saves; the spelling well fills as the student types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 32: Real upload progress per file, in the kit (`MultipartForm.fileRanges`, `UploadProgress`, `APIClient.send(_:as:onBodySent:)`)

**Files:**
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Core/MultipartForm.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Student/StudentAPI.swift` (`submitHomework`)
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/UploadProgressTests.swift`

**Interfaces:**
- Consumes: `MultipartForm`, `Endpoint.upload`, `APIClient.sendForData` (private), `StubServer` (tests).
- Produces: `MultipartForm.fileRanges() -> [Range<Int>]` (where each file's bytes sit in `encoded()`, in `files` order; `encoded()` writes byte-for-byte what it wrote before); `public enum UploadProgress { static func perFile(sent: Int64, ranges: [Range<Int>]) -> [Double] }`; `APIClient.send<T>(_ endpoint: Endpoint, as: T.Type = T.self, onBodySent: @escaping @Sendable (Int64) -> Void) async throws -> T`; `StudentAPI.submitHomework(…, onFileProgress: (@Sendable ([Double]) -> Void)? = nil)` — the new parameter is LAST and defaults to nil, so every existing call compiles unchanged.

Why: the approved design gives the homework upload "a per-photo progress ring". The owner's standing rule is no decorative progress bars, so the ring must be the upload's real progress — and a hand-in is ONE multipart request carrying every file. URLSession reports the bytes of the body it has sent (`urlSession(_:task:didSendBodyData:…)`); knowing where each file sits in the body turns that one number into one fraction per file. The pure parts (where the files sit, the fractions) are tested; the delegate plumbing is checked on the simulator in Task 40 (a `URLProtocol` stub does not report body progress).

Rules (kit): no backend change — the request is byte-for-byte the one sent today. A retry after a token refresh sends the body again, so the count starts again from zero (the rings fall back and refill; the app keeps the highest value it has shown, Task 37). No `@MainActor` work in the kit: the closure is called on URLSession's own queue.

- [ ] **Step 1: Write the failing test**

**Create** `ios/MasterSATKit/Tests/MasterSATKitTests/UploadProgressTests.swift`:

```swift
import Foundation
import Testing
@testable import MasterSATKit

@Suite struct UploadProgressTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func form() -> MultipartForm {
        var form = MultipartForm(boundary: "b0undary")
        form.add(file: MultipartForm.File(filename: "page \"1\".jpg", mimeType: "image/jpeg", data: Data(repeating: 0xAB, count: 300), token: "t1"))
        form.add(file: MultipartForm.File(filename: "notes.pdf", mimeType: "application/pdf", data: Data([1, 2, 3]), token: "t2"))
        form.add("file_tokens", "[\"t1\",\"t2\"]")
        form.add("expected_revision", 3)
        return form
    }

    @Test("Each file's range slices exactly its own bytes back out of the body")
    func rangesMatchTheBody() {
        let form = form()
        let body = form.encoded()
        let ranges = form.fileRanges()
        #expect(ranges.count == 2)
        #expect(body.subdata(in: ranges[0]) == form.files[0].data)
        #expect(body.subdata(in: ranges[1]) == form.files[1].data)
        #expect(ranges[0].upperBound < ranges[1].lowerBound, "files go out in order, fields first")
        #expect(ranges[1].upperBound < body.count, "the closing boundary comes after the last file")
    }

    @Test("Per file: nothing of it sent, part of it, all of it — in order")
    func perFile() {
        let ranges = [100..<200, 250..<450]
        #expect(UploadProgress.perFile(sent: 50, ranges: ranges) == [0, 0])
        #expect(UploadProgress.perFile(sent: 150, ranges: ranges) == [0.5, 0])
        #expect(UploadProgress.perFile(sent: 260, ranges: ranges) == [1, 0.05])
        #expect(UploadProgress.perFile(sent: 10_000, ranges: ranges) == [1, 1])
        #expect(UploadProgress.perFile(sent: 5, ranges: [10..<10]) == [0], "an empty file is done once the body passes it")
        #expect(UploadProgress.perFile(sent: 10, ranges: [10..<10]) == [1])
    }

    @Test("A hand-in that reports progress is the same multipart hand-in")
    func handInWithProgress() async throws {
        server.handler = { _ in .json(["id": 5, "revision": 4, "files": []]) }
        let api = StudentAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "a", refresh: "r")),
            session: server.session()
        ))
        let file = MultipartForm.File(filename: "page1.jpg", mimeType: "image/jpeg", data: Data([0xFF, 0xD8]), token: "tok-1")

        let submission = try await api.submitHomework(
            classroomId: 2, assignmentId: 7, files: [file], expectedRevision: 3,
            onFileProgress: { _ in }
        )

        #expect(submission.revision == 4)
        let body = String(decoding: try #require(server.requests.first?.httpBody), as: UTF8.self)
        #expect(body.contains("filename=\"page1.jpg\""))
        #expect(body.contains("tok-1"))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter UploadProgressTests 2>&1 | tail -5`
Expected: build errors — `value of type 'MultipartForm' has no member 'fileRanges'`, `cannot find 'UploadProgress' in scope`, `extra argument 'onFileProgress' in call`.

- [ ] **Step 3: The form says where its files are**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Core/MultipartForm.swift` — replace:

```swift
    public func encoded() -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        for field in fields {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n")
            append("\(field.value)\r\n")
        }
        for file in files {
            append("--\(boundary)\r\n")
            // Quotes in a filename would end the header value early; strip rather than
            // escape, since a filename is cosmetic here and the token is the identity.
            let safeName = file.filename.replacingOccurrences(of: "\"", with: "")
            append("Content-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(safeName)\"\r\n")
            append("Content-Type: \(file.mimeType)\r\n\r\n")
            body.append(file.data)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        return body
    }
}
```
with:

```swift
    public func encoded() -> Data {
        var body = Data()
        for field in fields { body.append(Data(fieldPart(field).utf8)) }
        for file in files {
            body.append(Data(fileHead(file).utf8))
            body.append(file.data)
            body.append(Data(Self.lineEnd.utf8))
        }
        body.append(Data("--\(boundary)--\(Self.lineEnd)".utf8))
        return body
    }

    /// Where each file's bytes sit inside `encoded()`, in `files` order — so the bytes an
    /// upload has sent can be told per file (`UploadProgress`). Counted from the very pieces
    /// `encoded()` writes, without building the body again.
    public func fileRanges() -> [Range<Int>] {
        var offset = fields.reduce(0) { $0 + fieldPart($1).utf8.count }
        return files.map { file in
            offset += fileHead(file).utf8.count
            let range = offset..<(offset + file.data.count)
            offset = range.upperBound + Self.lineEnd.utf8.count
            return range
        }
    }

    private static let lineEnd = "\r\n"

    private func fieldPart(_ field: (name: String, value: String)) -> String {
        "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n\(field.value)\r\n"
    }

    private func fileHead(_ file: File) -> String {
        // Quotes in a filename would end the header value early; strip rather than
        // escape, since a filename is cosmetic here and the token is the identity.
        let safeName = file.filename.replacingOccurrences(of: "\"", with: "")
        return "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(safeName)\"\r\nContent-Type: \(file.mimeType)\r\n\r\n"
    }
}

/// How far each file of a multipart upload has gone, from the bytes the request has sent.
public enum UploadProgress {
    /// 0…1 per file, in `ranges` order (`MultipartForm.fileRanges()`): none of it sent yet, part
    /// of it, all of it. Real numbers only — a per-photo ring that moved on its own would be a
    /// decoration pretending to be progress.
    public static func perFile(sent: Int64, ranges: [Range<Int>]) -> [Double] {
        ranges.map { range in
            guard !range.isEmpty else { return sent >= Int64(range.upperBound) ? 1 : 0 }
            let done = min(max(sent - Int64(range.lowerBound), 0), Int64(range.count))
            return Double(done) / Double(range.count)
        }
    }
}
```

- [ ] **Step 4: The client can report a body going out**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift` — replace:

```swift
    /// Send and ignore the body.
    @discardableResult
    public func send(_ endpoint: Endpoint) async throws -> Data {
        try await sendForData(endpoint)
    }
```
with:

```swift
    /// Send and ignore the body.
    @discardableResult
    public func send(_ endpoint: Endpoint) async throws -> Data {
        try await sendForData(endpoint)
    }

    /// Send and decode, telling `onBodySent` how many bytes of the request body have gone out —
    /// for an upload a student watches. Called on URLSession's own queue, never the main actor.
    /// Everything else is `send`'s: one refresh and one retry — which sends the body again, so
    /// the count starts again from zero.
    public func send<T: Decodable & Sendable>(
        _ endpoint: Endpoint,
        as type: T.Type = T.self,
        onBodySent: @escaping @Sendable (Int64) -> Void
    ) async throws -> T {
        let data = try await sendForData(endpoint, progress: BodyProgress(onBodySent))
        if T.self == Empty.self, let empty = Empty() as? T { return empty }
        do {
            return try JSONCoding.decoder.decode(T.self, from: data)
        } catch {
            let detail = String(describing: error)
            onEvent(.decodingFailed(path: endpoint.path, detail: detail))
            throw APIError.decoding(context: endpoint.path, underlying: detail)
        }
    }
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift` — replace:

```swift
    private func sendForData(_ endpoint: Endpoint, isRetry: Bool = false, codedRefusals: Bool = false) async throws -> Data {
        let request = try buildRequest(endpoint)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
```
with:

```swift
    private func sendForData(
        _ endpoint: Endpoint,
        isRetry: Bool = false,
        codedRefusals: Bool = false,
        progress: BodyProgress? = nil
    ) async throws -> Data {
        let request = try buildRequest(endpoint)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: progress)
        } catch {
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift` — replace:

```swift
            return try await sendForData(endpoint, isRetry: true, codedRefusals: codedRefusals)
```
with:

```swift
            return try await sendForData(endpoint, isRetry: true, codedRefusals: codedRefusals, progress: progress)
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift` — replace:

```swift
/// The single door to the backend.
```
with:

```swift
/// Hands a request's sent-body count to a closure, as URLSession reports it (on its own queue).
// @unchecked: the one stored property is an immutable @Sendable closure.
final class BodyProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let report: @Sendable (Int64) -> Void

    init(_ report: @escaping @Sendable (Int64) -> Void) {
        self.report = report
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        report(totalBytesSent)
    }
}

/// The single door to the backend.
```

- [ ] **Step 5: A hand-in can say how far each file has gone**

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Student/StudentAPI.swift` — replace:

```swift
        expectedRevision: Int?,
        markAsSubmitted: Bool = true
    ) async throws -> Submission {
```
with:

```swift
        expectedRevision: Int?,
        markAsSubmitted: Bool = true,
        onFileProgress: (@Sendable ([Double]) -> Void)? = nil
    ) async throws -> Submission {
```

**Edit** `ios/MasterSATKit/Sources/MasterSATKit/Student/StudentAPI.swift` — replace:

```swift
        form.add("submit", markAsSubmitted ? "true" : "false")

        return try await client.send(
            .upload("/classes/\(classroomId)/assignments/\(assignmentId)/submit/", form: form),
            as: Submission.self
        )
    }
```
with:

```swift
        form.add("submit", markAsSubmitted ? "true" : "false")

        let endpoint = Endpoint.upload("/classes/\(classroomId)/assignments/\(assignmentId)/submit/", form: form)
        guard let onFileProgress else { return try await client.send(endpoint, as: Submission.self) }
        // One request carries every file: how far each one has gone is where the body is.
        let ranges = form.fileRanges()
        return try await client.send(endpoint, as: Submission.self) { sent in
            onFileProgress(UploadProgress.perFile(sent: sent, ranges: ranges))
        }
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test --filter "UploadProgressTests|MultipartFormTests|HomeworkSubmissionTests|APIClientTests" 2>&1 | tail -4`
Expected: every suite passes — `UploadProgressTests` (3 tests) and `MultipartFormTests`, `HomeworkSubmissionTests`, `APIClientTests` unchanged (the body is byte-for-byte the same). Whole kit: `swift test 2>&1 | tail -2` → `✔ Test run with 759 tests … passed` (756 + 3).

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSATKit/Sources/MasterSATKit/Core/MultipartForm.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Core/APIClient.swift \
        ios/MasterSATKit/Sources/MasterSATKit/Student/StudentAPI.swift \
        ios/MasterSATKit/Tests/MasterSATKitTests/UploadProgressTests.swift
git commit -m "feat(ios-kit): a hand-in reports how far each file has gone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 33: The focus-zone motion kit, covers without the bar's room, and the hand-in baseline

**Files:**
- Modify: `ios/MasterSAT/Sources/Support/Motion/Motion.swift` (`Motion.focusTap`, `Motion.focusStep`, `FocusTurn`, `.focusTurn`, `FocusPress`, `focusReveal`, `focusEntrance`, `focusShake`, `RollingNumber`)
- Modify: `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` (`celebrate` measures from hand-in; `OutcomeConfetti`; `FrameBox` moves in)
- Modify: `ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift` (`FrameBox` moves out)
- Modify: `ios/MasterSAT/Sources/Screens/RootView.swift` (`noBarClearance()`)
- Modify (one line each, the cover's content gets `.noBarClearance()`): `Screens/HomeworkDetailView.swift`, `Screens/Assessments/AssessmentReviewView.swift`, `Screens/Assessments/AssessmentBoardViews.swift`, `Screens/Vocabulary/VocabSetPage.swift`, `Screens/Stories/StoriesRail.swift`, `Screens/Stories/StoryViewer.swift`, `Screens/LiveQuiz/LiveQuizJoinView.swift`, `Screens/Events/EventsView.swift` (all under `ios/MasterSAT/Sources/`)
- Modify: `ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift` (`submitFrame` → `FrameBox`)

**Interfaces:**
- Consumes: `XPDelta.baseline` (Task 30), `ConfettiBurst`, `MotionBudget`, `ConfettiCanvas` (phase 1), `FrameBox` (phase 3).
- Produces (app): `Motion.focusTap: Animation` (easeOut 0.12 s); `Motion.focusStep: Double` (0.03); `enum FocusTurn { case forward, back; static func from(_ old: Int, to new: Int) -> FocusTurn }`; `AnyTransition.focusTurn(_ turn: FocusTurn, reduceMotion: Bool) -> AnyTransition`; `struct FocusPress: ButtonStyle`; `View.focusReveal(_ index: Int, shown: Bool)`; `View.focusEntrance(_ index: Int)` (a `focusReveal` that runs on appear); `View.focusShake(_ trigger: Int, cornerRadius: CGFloat)`; `struct RollingNumber: View { let value: Double; var suffix = "" }` (a score that counts up); `View.noBarClearance()`; `struct OutcomeConfetti: View { let trigger: Int }`; `FrameBox` now lives in `Celebrations.swift` (same type, same API).

The focus-zone rules (approved design §3 and the controller's ruling) — every helper here obeys them, and Tasks 34–39 use only these helpers for motion inside focus zones:
- ≤250 ms, ease-out, nothing overshoots over content. A spring is allowed only on chrome that never covers content (a flag glyph, the logo).
- Reduce Motion: every movement becomes a fade or nothing — a turn is a crossfade, a reveal only fades, a shake becomes a red pulse over the refused box, a press only dims.
- Never a hint at right or wrong while answering: nothing here knows about answers.

Hand-off fixes in this task:
- **Phase 1:** `contentMargins` reaches full-screen covers. The tab bar's room is `contentMargins(.bottom, barClearance)` on each tab child; it travels by environment into every cover presented from a tab, where there is no bar — so the runner's and the games' scroll views ended ~80 pt short of the bottom for nothing. Checked while this plan was written, on the iOS 26.3 simulator with a probe app: an inherited `contentMargins(.bottom, 200)` reaches a `fullScreenCover`'s `ScrollView`, and `.contentMargins(.bottom, 0)` on the cover's content cancels it. Every cover presented from inside a tab gets `.noBarClearance()`. (The Me sheet is presented from the root, outside the tab children, so its covers never inherit it.)
- **Phase 3:** a refresh mid-session dropped the pill un-animated at hand-in — `celebrate` now measures from `XPDelta.baseline(atStart:atHandIn:)`.
- **Phase 2:** `submitFrame` was `@State` written every scroll frame — boxed in `FrameBox` (the homework page's `handInFrame` follows in Task 37).

- [ ] **Step 1: The focus-zone motion kit**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Motion.swift` — replace:

```swift
    /// Focus zones: short and without overshoot, so nothing moves over the content.
    static let focus = Animation.easeOut(duration: 0.2)
```
with:

```swift
    /// Focus zones: short and without overshoot, so nothing moves over the content.
    static let focus = Animation.easeOut(duration: 0.2)
    /// Focus zones, the shortest beat: a press, a tick, a pulse.
    static let focusTap = Animation.easeOut(duration: 0.12)
    /// The beat between blocks of a focus-zone entrance (`focusReveal`) — at most three of them,
    /// so the whole entrance is over within 250 ms.
    static let focusStep = 0.03
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Motion.swift` — replace:

```swift
    /// The page that zooms out of its card. A plain push before iOS 18 and under Reduce Motion.
    func zoomDestination(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomDestination(id: id, namespace: namespace))
    }
}
```
with:

```swift
    /// The page that zooms out of its card. A plain push before iOS 18 and under Reduce Motion.
    func zoomDestination(id: some Hashable, in namespace: Namespace.ID) -> some View {
        modifier(ZoomDestination(id: id, namespace: namespace))
    }
}

// MARK: - Focus zones

/// Which way a focus zone turned its page: on to the next question, or back.
enum FocusTurn: Equatable {
    case forward, back

    /// The way from one position to another — a jump from the question map included.
    static func from(_ old: Int, to new: Int) -> FocusTurn { new >= old ? .forward : .back }
}

extension AnyTransition {
    /// A question arriving: it comes 24 pt in from the side it is coming from as it fades in;
    /// the one leaving only fades, in half the time, so two texts never sit over each other for
    /// long. Animate the change with `Motion.focus` — nothing overshoots. Set the turn in the
    /// same update as the change, before it: the arriving view reads it as it is inserted.
    /// Under Reduce Motion, a crossfade.
    static func focusTurn(_ turn: FocusTurn, reduceMotion: Bool) -> AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .offset(x: turn == .forward ? 24 : -24).combined(with: .opacity),
            removal: .opacity.animation(.easeOut(duration: 0.1))
        )
    }
}

/// A press on an answer inside a focus zone: it dips a little and comes straight back — no
/// spring, nothing grows past its size, and every answer presses alike (a press never hints at
/// right or wrong). Under Reduce Motion it only dims.
struct FocusPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(FocusPressEffect(isPressed: configuration.isPressed))
    }
}

private struct FocusPressEffect: ViewModifier {
    let isPressed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(!reduceMotion && isPressed ? 0.98 : 1)
            .opacity(isPressed ? 0.85 : 1)
            .animation(Motion.focusTap, value: isPressed)
    }
}

private struct FocusReveal: ViewModifier {
    let index: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .opacity(shown ? 1 : 0)
                .animation(.easeOut(duration: 0.15), value: shown)
        } else {
            content
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 8)
                .animation(.easeOut(duration: 0.15).delay(Double(min(max(index, 0), 3)) * Motion.focusStep), value: shown)
        }
    }
}

private struct FocusShake: ViewModifier {
    let trigger: Int
    let cornerRadius: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            // Nothing moves: a red pulse over the refused box instead, in and out.
            content.overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Theme.danger.opacity(0.18))
                    .keyframeAnimator(initialValue: 0.0, trigger: trigger) { pulse, value in
                        pulse.opacity(value)
                    } keyframes: { _ in
                        KeyframeTrack {
                            LinearKeyframe(1.0, duration: 0.08)
                            LinearKeyframe(1.0, duration: 0.12)
                            LinearKeyframe(0.0, duration: 0.2)
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        } else {
            content.keyframeAnimator(initialValue: CGFloat(0), trigger: trigger) { view, x in
                view.offset(x: x)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(-8, duration: 0.04)
                    LinearKeyframe(8, duration: 0.06)
                    LinearKeyframe(-6, duration: 0.05)
                    LinearKeyframe(4, duration: 0.05)
                    LinearKeyframe(0, duration: 0.04)
                }
            }
        }
    }
}

extension View {
    /// One block of a focus zone settling in: up 8 pt and in, `index` beats after the first (at
    /// most three beats of `Motion.focusStep`), so the whole entrance is over within 250 ms and
    /// nothing overshoots. Under Reduce Motion it only fades, all at once.
    func focusReveal(_ index: Int, shown: Bool) -> some View {
        modifier(FocusReveal(index: index, shown: shown))
    }

    /// A refusal — a wrong password, a pair that is not one: a 240 ms shake, side to side, that
    /// comes to rest where it started, each time `trigger` changes. Under Reduce Motion nothing
    /// moves: a red pulse over the box (`cornerRadius` is the box's) instead. The caller adds the
    /// warning haptic and says what was refused in words.
    func focusShake(_ trigger: Int, cornerRadius: CGFloat) -> some View {
        modifier(FocusShake(trigger: trigger, cornerRadius: cornerRadius))
    }

    /// `focusReveal` that runs by itself the first time the block appears — for blocks that
    /// arrive with their data (a report's rows) or with a new question (a reviewed card's rows).
    func focusEntrance(_ index: Int) -> some View {
        modifier(FocusEntrance(index: index))
    }
}

private struct FocusEntrance: ViewModifier {
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .focusReveal(index, shown: shown)
            .onAppear { shown = true }
    }
}

/// A score that counts up from 0 when it appears: its digits roll once, in one `Motion.focus`
/// beat — ticking through every number would break the focus zones' 250 ms. A later change rolls
/// the same way. Under Reduce Motion it is simply there; VoiceOver hears the final number.
struct RollingNumber: View {
    let value: Double
    var suffix = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    var body: some View {
        Text("\(ScoreText.string(reduceMotion ? value : shown))\(suffix)")
            .contentTransition(.numericText(value: shown))
            .accessibilityLabel("\(ScoreText.string(value))\(suffix)")
            .onAppear { withAnimation(Motion.focus) { shown = value } }
            .onChange(of: value) { _, new in withAnimation(Motion.focus) { shown = new } }
    }
}
```

- [ ] **Step 2: A task's gain is measured from hand-in; outcome confetti; `FrameBox` moves in**

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
    func celebrate(_ work: FinishedWork, xpBefore: Int?, at point: CGPoint? = nil) {
        let entry = queue.record(work, xpBefore: xpBefore, stageVisible: !covered)
```
with:

```swift
    func celebrate(_ work: FinishedWork, xpBefore: Int?, at point: CGPoint? = nil) {
        // Measured from hand-in at the latest: a rise the header took since the work started (a
        // return to the app, a reconnect) is not this work's, and holding it back now would drop
        // the pill to the old total, un-animated (`XPDelta.baseline`).
        let baseline = XPDelta.baseline(atStart: xpBefore, atHandIn: xpNow)
        let entry = queue.record(work, xpBefore: baseline, stageVisible: !covered)
```

**Edit** `ios/MasterSAT/Sources/Support/Motion/Celebrations.swift` — replace:

```swift
extension CGRect {
    /// The middle of a measured control; nil before it has been measured.
    var celebrationPoint: CGPoint? { self == .zero ? nil : CGPoint(x: midX, y: midY) }
}
```
with:

```swift
extension CGRect {
    /// The middle of a measured control; nil before it has been measured.
    var celebrationPoint: CGPoint? { self == .zero ? nil : CGPoint(x: midX, y: midY) }
}

/// A measured frame kept out of SwiftUI state: written on every scroll frame, read only when
/// something celebrates from it — so measuring never re-renders the page.
@MainActor
final class FrameBox {
    var rect: CGRect = .zero
}

/// The confetti of a good OUTCOME — a midterm passed, an assessment that beat the last one —
/// drawn by the page that shows it, so it is seen wherever that page is: the Me sheet too, which
/// the root overlay sits under. One burst from the top of the page each time `trigger` changes
/// (the page changes it once, from `OutcomeMemory`); none under Reduce Motion, half under Low
/// Power (`MotionBudget`). Never takes a touch, never read by VoiceOver — the page says the news
/// in words.
struct OutcomeConfetti: View {
    let trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bursts: [ConfettiBurst] = []

    var body: some View {
        GeometryReader { box in
            ConfettiCanvas(bursts: bursts)
                .onChange(of: trigger) { _, _ in fire(in: box.size) }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func fire(in size: CGSize) {
        let budget = MotionBudget(reduceMotion: reduceMotion, lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
        let count = budget.confetti(44)
        guard count > 0, size.width > 0 else { return }
        bursts.append(.make(x: size.width / 2, y: size.height * 0.2, count: count))
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(ConfettiBurst.lifetime + 0.2))
            bursts.removeAll { $0.isFinished(at: .now) }
        }
    }
}
```

**Edit** `ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift` — replace:

```swift
/// A measured frame kept out of SwiftUI state: written on every scroll frame, read only when a
/// coin bursts — so measuring never re-renders the tab.
@MainActor
final class FrameBox {
    var rect: CGRect = .zero
}

// MARK: - The board
```
with:

```swift
// MARK: - The board
```

- [ ] **Step 3: Covers drop the tab bar's room**

**Edit** `ios/MasterSAT/Sources/Screens/RootView.swift` — replace:

```swift
    private func sheetDismissed() {
        router.sheetDismissed(baseURL: session.client.config.baseURL) { openURL($0) }
        celebrations.setSheetUp(router.showingMe || router.certificate != nil)
    }
}
```
with:

```swift
    private func sheetDismissed() {
        router.sheetDismissed(baseURL: session.client.config.baseURL) { openURL($0) }
        celebrations.setSheetUp(router.showingMe || router.certificate != nil)
    }
}

extension View {
    /// Put on a full-screen cover's content. The tab bar's room (`contentMargins(.bottom, …)` on
    /// each tab, above) travels by environment into anything presented from inside a tab, and a
    /// cover has no bar under it — its scroll views would end a bar's height short of the bottom.
    /// An inner margin replaces the inherited one (checked on the simulator, 2026-10-21).
    func noBarClearance() -> some View {
        contentMargins(.bottom, 0)
    }
}
```

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
                assessmentAttemptId = nil
                Task { await load() }
            }
            .coversCelebrations(celebrations)
```
with:

```swift
                assessmentAttemptId = nil
                Task { await load() }
            }
            .coversCelebrations(celebrations)
            .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                dismiss()
            }
            .coversCelebrations(celebrations)
```
with:

```swift
                dismiss()
            }
            .coversCelebrations(celebrations)
            .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentBoardViews.swift` — replace:

```swift
                Task { await model.load(session.student) }
            }
            .coversCelebrations(celebrations)
```
with:

```swift
                Task { await model.load(session.student) }
            }
            .coversCelebrations(celebrations)
            .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabSetPage.swift` — replace:

```swift
                    Task { await load() }
                }
                .coversCelebrations(celebrations)
```
with:

```swift
                    Task { await load() }
                }
                .coversCelebrations(celebrations)
                .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Stories/StoriesRail.swift` — replace:

```swift
            StoryViewer(stories: item.stories, startIndex: item.index)
```
with:

```swift
            StoryViewer(stories: item.stories, startIndex: item.index)
                .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Stories/StoryViewer.swift` — replace:

```swift
            CommunitySafariView(url: page.url) { link = nil }
                .ignoresSafeArea()
```
with:

```swift
            CommunitySafariView(url: page.url) { link = nil }
                .ignoresSafeArea()
                .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/LiveQuiz/LiveQuizJoinView.swift` — replace:

```swift
                model.presented = nil
            }
            .environment(session)
```
with:

```swift
                model.presented = nil
            }
            .environment(session)
            .noBarClearance()
```

**Edit** `ios/MasterSAT/Sources/Screens/Events/EventsView.swift` — replace:

```swift
            EventTicketView(ticket: ticket)
```
with:

```swift
            EventTicketView(ticket: ticket)
                .noBarClearance()
```

- [ ] **Step 4: The survey's Submit is measured without re-rendering**

**Edit** `ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift` — replace:

```swift
    /// Where Submit is, so the confetti leaves from it.
    @State private var submitFrame: CGRect = .zero
```
with:

```swift
    /// Where Submit is, so the confetti leaves from it. Boxed: it is written on every scroll frame.
    @State private var submitSpot = FrameBox()
```

**Edit** `ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift` — replace:

```swift
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { submitFrame = $0 }
```
with:

```swift
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { submitSpot.rect = $0 }
```

**Edit** `ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift` — replace:

```swift
                celebrations.celebrate(.survey, xpBefore: xpBefore, at: submitFrame.celebrationPoint)
```
with:

```swift
                celebrations.celebrate(.survey, xpBefore: xpBefore, at: submitSpot.rect.celebrationPoint)
```

- [ ] **Step 5: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT/Sources
grep -rn "\.fullScreenCover(" Screens | grep -v "Account/\|CommunityChrome" | wc -l   # 8
grep -rn "noBarClearance()" Screens | grep -v "func noBarClearance" | wc -l        # 8
grep -rn "submitFrame\|class FrameBox" . | grep -v Celebrations.swift              # nothing
```

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Support/Motion/Motion.swift \
        ios/MasterSAT/Sources/Support/Motion/Celebrations.swift \
        ios/MasterSAT/Sources/Screens/Rewards/RewardsTabCards.swift \
        ios/MasterSAT/Sources/Screens/RootView.swift \
        ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentBoardViews.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabSetPage.swift \
        ios/MasterSAT/Sources/Screens/Stories/StoriesRail.swift \
        ios/MasterSAT/Sources/Screens/Stories/StoryViewer.swift \
        ios/MasterSAT/Sources/Screens/LiveQuiz/LiveQuizJoinView.swift \
        ios/MasterSAT/Sources/Screens/Events/EventsView.swift \
        ios/MasterSAT/Sources/Screens/Surveys/SurveyFillView.swift
git commit -m "feat(ios): focus-zone motion kit; covers drop the tab bar's room; a task's gain is measured from hand-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 34: The assessment runner — the question turns, choices fill, the cross-out is drawn, "Saved"

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` (`AssessmentRunnerView`, `QuestionMapSheet`, `AssessmentChoiceRow`, `AssessmentSubmittedView`'s entrance)

**Interfaces:**
- Consumes: `AssessmentRunner.savedCount` (Task 31); `FocusTurn`, `.focusTurn`, `FocusPress`, `focusReveal`, `Motion.focus` (Task 33); `AssessmentRunner.go(to:)`, `answeredCount`, `unsaved`, `flagged` (existing).
- Produces: nothing new outside the file. `AssessmentRunnerView`'s initializer and `onSubmitted` are unchanged, so its three presenters (homework page, board, review's retry) are untouched.

What the student gets (approved design §3, focus zone): the next question comes in from the right (the previous one from the left, a map jump from its side) in 200 ms and opens at its top; a picked choice fills in 200 ms with a selection tick — the same tick for every choice, flag and cross-out, because the runner never says whether an answer is right; crossing out draws a line through the whole option, left to right; the flag glyph bounces when a question is flagged (chrome — the one spring here); "Saved" appears under the answered count for a moment after the server confirmed an answer; the answered count rolls when it moves; the question map's cells settle in, row by row, within 250 ms. The full celebration stays where phase 2 put it: after the hand-in, once the cover has gone.

Decisions in this task:
- **No answered-count bar** (controller ruling): "N/M" is already on screen, and a bar would restate it. The count rolls instead.
- **The cross-out is drawn, not typed.** A line is drawn across the whole option, as Bluebook rules out an answer; the option's own CSS strike-through goes, because toggling it reloaded the option's KaTeX web view (`RichTextView.updateUIView` re-renders on any change of its signature) — a flash and a height jump on every cross-out.
- **Answered cells on the map are the runner's selection blue, not green.** Green means "correct" on the review; the runner never says correct.
- **A question change resets the scroll to its top** (it kept the last question's offset), and a typed answer's keyboard closes as the question turns — the field belongs to the question that left.

Rules (repeat): never a hint at right or wrong while answering — no colour, no haptic and no motion differs between a right and a wrong choice; ≤250 ms, no overshoot over content, a spring only on chrome; Reduce Motion → fades (the turn is a crossfade, the line simply appears, the map fades in, the flag does not bounce); no announcement per tap ("Saved" is hidden from VoiceOver — the existing "Some answers haven't saved yet" line is what a VoiceOver user needs); new controls keep ≥44 pt targets.

- [ ] **Step 1: State, the haptic, the turn**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
    /// Text scale. Matches the web's 70%–150% range and its 10-point steps.
    @AppStorage("assessmentZoom") private var zoom: Double = 1.0
```
with:

```swift
    /// Text scale. Matches the web's 70%–150% range and its 10-point steps.
    @AppStorage("assessmentZoom") private var zoom: Double = 1.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which way the last question change went — the arriving question comes in from that side.
    @State private var turn: FocusTurn = .forward
    /// One tick per choice picked, option crossed out or question flagged: the selection haptic.
    /// Every pick ticks alike — the runner never says whether an answer is right.
    @State private var picks = 0
    /// Bumped only when a question is flagged (not when the flag comes off): the flag's bounce.
    @State private var flagBounces = 0
    /// "Saved" is showing, for a moment after the server confirmed an answer.
    @State private var showSaved = false
    @State private var savedFade: Task<Void, Never>?

    /// The top of the scrolled page — a new question opens here.
    private static let top = "runner.top"
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
        .background(Theme.background)
        .task {
            if runner == nil {
                let created = AssessmentRunner(attemptId: attemptId, api: session.assessments)
```
with:

```swift
        .background(Theme.background)
        // The hand-in screen fades in rather than cutting.
        .animation(Motion.focus, value: didSubmit)
        .sensoryFeedback(.selection, trigger: picks)
        .task {
            if runner == nil {
                let created = AssessmentRunner(attemptId: attemptId, api: session.assessments)
```

- [ ] **Step 2: The question turns; the page opens at its top; "Saved" listens**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    setHeader(runner)
                    questionCard(runner, question)

                    if !runner.unsaved.isEmpty {
                        // Say it rather than showing a silent tick. A student who loses
                        // signal mid-quiz deserves to know what has not landed.
                        Label("Some answers haven't saved yet — they'll retry.", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.warning)
                    }
                }
                .padding(14)
            }

            footer(runner)
        }
        .sheet(isPresented: $showMap) {
            QuestionMapSheet(runner: runner) { index in
                runner.go(to: index)
                showMap = false
            }
```
with:

```swift
            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        setHeader(runner)
                            .id(Self.top)
                        // A ZStack, so the question leaving and the one arriving overlap for
                        // their 200 ms instead of stacking and pushing the page down.
                        ZStack {
                            questionCard(runner, question)
                                .id(question.id)
                                .transition(.focusTurn(turn, reduceMotion: reduceMotion))
                        }

                        if !runner.unsaved.isEmpty {
                            // Say it rather than showing a silent tick. A student who loses
                            // signal mid-quiz deserves to know what has not landed.
                            Label("Some answers haven't saved yet — they'll retry.", systemImage: "arrow.clockwise")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.warning)
                        }
                    }
                    .padding(14)
                }
                .onChange(of: runner.currentIndex) { _, _ in
                    // A new question opens at its top, not where the last one was left.
                    scroller.scrollTo(Self.top, anchor: .top)
                }
            }

            footer(runner)
        }
        .onChange(of: runner.savedCount) { _, _ in flashSaved() }
        .sheet(isPresented: $showMap) {
            QuestionMapSheet(runner: runner) { index in
                move(to: index, runner)
                showMap = false
            }
```

- [ ] **Step 3: The answered count rolls; "Saved" under it**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
            Spacer(minLength: 0)
            Text("\(ScoreText.string(runner.answeredCount))/\(ScoreText.string(runner.questions.count))")
                .font(.system(size: 14, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
```
with:

```swift
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 3) {
                // The count is the progress: it rolls when it moves, and no bar restates it.
                Text("\(ScoreText.string(runner.answeredCount))/\(ScoreText.string(runner.questions.count))")
                    .font(.system(size: 14, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .contentTransition(reduceMotion ? .identity : .numericText(value: Double(runner.answeredCount)))
                    .animation(Motion.focus, value: runner.answeredCount)
                    .accessibilityLabel("\(runner.answeredCount) of \(runner.questions.count) answered")
                // A quiet word once the server has an answer — never while a write is failing,
                // when the warning under the question says what has not landed.
                Label("Saved", systemImage: "checkmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
                    .opacity(showSaved && runner.unsaved.isEmpty ? 1 : 0)
                    .animation(Motion.focus, value: showSaved)
                    .accessibilityHidden(true)
            }
        }
```

- [ ] **Step 4: The flag bounces when it goes on**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
    private func flagButton(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        Button {
            runner.toggleFlag(question.id)
        } label: {
            let isFlagged = runner.flagged.contains(question.id)
            HStack(spacing: 5) {
                Image(systemName: isFlagged ? "flag.fill" : "flag")
                    .font(.system(size: 12, weight: .bold))
                Text(isFlagged ? "Flagged" : "Flag")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(isFlagged ? Theme.flagged : Theme.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(isFlagged ? Theme.flagged.opacity(0.14) : Theme.background))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
```
with:

```swift
    private func flagButton(_ runner: AssessmentRunner, _ question: AssessmentQuestion) -> some View {
        let isFlagged = runner.flagged.contains(question.id)
        return Button {
            runner.toggleFlag(question.id)
            picks += 1
            if !isFlagged { flagBounces += 1 }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: isFlagged ? "flag.fill" : "flag")
                    .font(.system(size: 12, weight: .bold))
                    // Chrome beside the question, never over it — the one spring the runner
                    // allows. Not under Reduce Motion.
                    .symbolEffect(.bounce, value: reduceMotion ? 0 : flagBounces)
                Text(isFlagged ? "Flagged" : "Flag")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(isFlagged ? Theme.flagged : Theme.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(isFlagged ? Theme.flagged.opacity(0.14) : Theme.background))
            .contentShape(Capsule())
            .animation(Motion.focus, value: isFlagged)
        }
        .buttonStyle(.plain)
    }
```

- [ ] **Step 5: Choices fill and tick; True / False press like them**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                        onTap: {
                            // Tapping the chosen answer again clears it — a student who
                            // changes their mind to "no answer" must be able to say so.
                            let current = runner.answers[question.id]
                            runner.setAnswer(current == .string(choice.id) ? .null : .string(choice.id), for: question.id)
                        },
                        onEliminate: { toggleElimination(choice.id, on: question, runner: runner) }
```
with:

```swift
                        onTap: {
                            // Tapping the chosen answer again clears it — a student who
                            // changes their mind to "no answer" must be able to say so.
                            let current = runner.answers[question.id]
                            runner.setAnswer(current == .string(choice.id) ? .null : .string(choice.id), for: question.id)
                            picks += 1
                        },
                        onEliminate: {
                            toggleElimination(choice.id, on: question, runner: runner)
                            picks += 1
                        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                    Button {
                        runner.setAnswer(.bool(value), for: question.id)
                    } label: {
```
with:

```swift
                    Button {
                        runner.setAnswer(.bool(value), for: question.id)
                        picks += 1
                    } label: {
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                            .foregroundStyle(chosen ? Theme.accent : Color.primary)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
```
with:

```swift
                            .foregroundStyle(chosen ? Theme.accent : Color.primary)
                            .contentShape(Rectangle())
                            .animation(Motion.focus, value: chosen)
                    }
                    .buttonStyle(FocusPress())
```

- [ ] **Step 6: Previous and Next turn the page**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
            Button {
                runner.previous()
            } label: {
                Image(systemName: "chevron.left")
```
with:

```swift
            Button {
                move(to: runner.currentIndex - 1, runner)
            } label: {
                Image(systemName: "chevron.left")
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                Button {
                    runner.next()
                } label: {
```
with:

```swift
                Button {
                    move(to: runner.currentIndex + 1, runner)
                } label: {
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
    @MainActor
    private func submit() {
        // `didSubmit` is the one-shot: the hand-in is announced to the presenter exactly once.
```
with:

```swift
    /// Another question: the arriving one comes in from the side it is on. The turn is set
    /// before the change, in the same update, so the arriving view reads it.
    @MainActor
    private func move(to index: Int, _ runner: AssessmentRunner) {
        guard index != runner.currentIndex, runner.questions.indices.contains(index) else { return }
        turn = FocusTurn.from(runner.currentIndex, to: index)
        withAnimation(Motion.focus) { runner.go(to: index) }
    }

    /// "Saved" for a moment after the server confirmed a write; another confirmation keeps it up.
    @MainActor
    private func flashSaved() {
        showSaved = true
        savedFade?.cancel()
        savedFade = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            showSaved = false
        }
    }

    @MainActor
    private func submit() {
        // `didSubmit` is the one-shot: the hand-in is announced to the presenter exactly once.
```

- [ ] **Step 7: The question map settles in; answered is blue, not green**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)
```
with:

```swift
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 5)
    /// The cells have arrived — they settle in row by row, within 250 ms.
    @State private var shown = false
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                                    Text(ScoreText.string(index + 1))
                                        .font(.system(size: 15, weight: .bold).monospacedDigit())
                                        .foregroundStyle(isCurrent ? .white : (isAnswered ? Theme.success : Color.primary))
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                                .fill(isCurrent ? Theme.accent : (isAnswered ? Theme.successSoft : Theme.surface2))
                                        )
```
with:

```swift
                                    // Answered is the runner's selection blue: green means
                                    // "correct" on the review, and the runner never says so.
                                    Text(ScoreText.string(index + 1))
                                        .font(.system(size: 15, weight: .bold).monospacedDigit())
                                        .foregroundStyle(isCurrent ? .white : (isAnswered ? Theme.accent : Color.primary))
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .background(
                                            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                                .fill(isCurrent ? Theme.accent : (isAnswered ? Theme.accentSoft : Theme.surface2))
                                        )
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    HStack(spacing: 14) {
                        legend("Current", Theme.accent)
                        legend("Answered", Theme.successSoft)
```
with:

```swift
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .focusReveal(index / columns.count, shown: shown)
                            .accessibilityLabel("Question \(index + 1), \(isAnswered ? "answered" : "blank")\(isFlagged ? ", flagged" : "")")
                            .accessibilityAddTraits(isCurrent ? .isSelected : [])
                        }
                    }

                    HStack(spacing: 14) {
                        legend("Current", Theme.accent)
                        legend("Answered", Theme.accentSoft)
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
            .background(Theme.background)
            .navigationTitle("Question navigation")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
```
with:

```swift
            .background(Theme.background)
            .navigationTitle("Question navigation")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { shown = true }
    }
```

- [ ] **Step 8: A choice fills; a cross-out is drawn**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
    let onTap: @MainActor () -> Void
    var onEliminate: (@MainActor () -> Void)?

    private var borderColour: Color {
        isSelected ? Theme.accent : Theme.separator.opacity(0.9)
    }
```
with:

```swift
    let onTap: @MainActor () -> Void
    var onEliminate: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var borderColour: Color {
        isSelected ? Theme.accent : Theme.separator.opacity(0.9)
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                    VStack(alignment: .leading, spacing: 8) {
                        RichText(text: choice.text, scale: scale, struckThrough: isEliminated)
```
with:

```swift
                    VStack(alignment: .leading, spacing: 8) {
                        // Not struck through in the text: toggling that re-rendered a rich
                        // option's web view. The line is drawn over the option instead (below).
                        RichText(text: choice.text, scale: scale)
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
                // A button's label is only hit-testable where it DRAWS, so without this only
                // the glyphs themselves respond to a tap.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isEliminated)
```
with:

```swift
                // A button's label is only hit-testable where it DRAWS, so without this only
                // the glyphs themselves respond to a tap.
                .contentShape(Rectangle())
                .overlay { crossOut }
                .animation(Motion.focus, value: isSelected)
            }
            .buttonStyle(FocusPress())
            .disabled(isEliminated)
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` — replace:

```swift
        .opacity(isEliminated ? 0.55 : 1)
    }
}
```
with:

```swift
        .opacity(isEliminated ? 0.55 : 1)
        .animation(Motion.focus, value: isEliminated)
    }

    /// The line through a ruled-out option, drawn left to right — Bluebook's cross-out. Under
    /// Reduce Motion it is not drawn, it simply appears.
    private var crossOut: some View {
        GeometryReader { box in
            Path { line in
                line.move(to: CGPoint(x: 12, y: box.size.height / 2))
                line.addLine(to: CGPoint(x: max(12, box.size.width - 12), y: box.size.height / 2))
            }
            .trim(from: 0, to: isEliminated || reduceMotion ? 1 : 0)
            .stroke(Theme.textSecondary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .opacity(isEliminated ? 1 : 0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
```

- [ ] **Step 9: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -n "runner.next()\|runner.previous()\|struckThrough: isEliminated\|successSoft" ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift` prints only the `AssessmentSubmittedView` line (`Circle().fill(Theme.successSoft)` — the hand-in is done, green is right there).

- [ ] **Step 10: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Assessments/AssessmentRunnerView.swift
git commit -m "feat(ios): the runner turns questions, fills choices, draws the cross-out and says Saved — calmly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 35: Flashcards — a 250 ms flip, a swipe for the verdict; every finished round is announced

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` (`VocabStudyView.restart`/`exit`, `FlashcardView`, `FlipCard`)

**Interfaces:**
- Consumes: `Motion.focus`, `Motion.focusTap` (Task 33); `VocabStudyRunner.flush(isPartial:)`, `isFinished`, `isStarted` (existing).
- Produces: `FlipCard.onSwipe: (@MainActor (Bool) -> Void)?` (declared BEFORE `onFlip`, default nil — so `FlipCard(word:flipped:) { … }` still compiles); `FlashcardView.flipAnimation` (`easeInOut`, 0.25 s). No other API change.

What the student gets (approved design §3, focus zone "flashcards (3D flip + swipe)"): the card turns over in 250 ms with no wobble (it used a spring that overshot), with a selection tick; dragging it sideways tilts it with the finger, and past 110 pt a stamp says what letting go will do — "Correct" to the right, "Still learning" to the left — with one selection tick as it crosses; letting go there gives that verdict exactly as the buttons do (the card comes back to the middle and shows the definition for the hold); short of it, the card comes back and nothing is given. The buttons stay: they are the way in for VoiceOver and for anyone who does not swipe. Swiping is off while a verdict is held, as the buttons are.

Hand-off fix (phase 2): **leaving a word game with an unsaved round could save without a celebration.** A round's grading call can fail; the round is then graded by a later flush — when the student taps "Study again" (the old runner is flushed after it is let go, and nothing watches it any more) or leaves (the flush runs as the cover closes, and the `onChange` may never fire). Both paths now report a finish the server confirmed. `reportFinish` is the cover's one-shot, so nothing is ever announced twice, and only a flush that left the runner `isFinished` reports — a failed one never does.

Rules (repeat): ≤250 ms and no overshoot over the card (it IS the content); under Reduce Motion the flip is a crossfade (no rotation — and the back face is not mirrored), the drag follows the finger with no tilt; flashcards are self-graded, so the stamp is the student's own verdict, never the app's; celebrate once, only after the server confirmed.

- [ ] **Step 1: A finished round is announced on every path that saves it**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
        // Whatever the last run still holds — a grading call that failed, answers not yet
        // sent — goes out before the run is let go, rather than vanishing with it.
        if let previous, previous.isStarted, !previous.isFinished {
            Task { await previous.flush(isPartial: true) }
        }
        await begin()
    }

    @MainActor
    private func exit() {
        Task {
            await runner?.flush(isPartial: true)
            onClose()
        }
    }
```
with:

```swift
        // Whatever the last run still holds — a grading call that failed, answers not yet
        // sent — goes out before the run is let go, rather than vanishing with it.
        if let previous, previous.isStarted, !previous.isFinished {
            Task {
                await previous.flush(isPartial: true)
                // A finished round whose first grading call failed is graded by this flush, and
                // nothing watches the old runner any more: its finish is reported here.
                if previous.isFinished { reportFinish() }
            }
        }
        await begin()
    }

    @MainActor
    private func exit() {
        Task {
            await runner?.flush(isPartial: true)
            // Leaving can be what grades a finished round; say so before the cover goes — the
            // change may never reach `onChange` once it is closing. A no-op if it was said.
            if runner?.isFinished == true { reportFinish() }
            onClose()
        }
    }
```

- [ ] **Step 2: The flip is quicker and calm; the card can be swiped**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
    /// The hold after a verdict — long enough that the definition is actually read.
    static let holdSeconds = 5
```
with:

```swift
    /// The hold after a verdict — long enough that the definition is actually read.
    static let holdSeconds = 5
    /// The card turning over: 250 ms, eased in and out, no overshoot — the card is the content.
    static let flipAnimation = Animation.easeInOut(duration: 0.25)
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
    /// The throttle itself. Separate from `hold` because two taps can land before the view
    /// re-renders with the buttons disabled.
    @State private var locked = false
```
with:

```swift
    /// The throttle itself. Separate from `hold` because two taps can land before the view
    /// re-renders with the buttons disabled.
    @State private var locked = false
    /// One tick per flip the student asked for — the selection haptic.
    @State private var flips = 0

    /// The swipe gives a verdict exactly as the buttons do, and is off when they are.
    private var swipeVerdict: (@MainActor (Bool) -> Void)? {
        guard hold == nil, !locked else { return nil }
        return { answer($0) }
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
        .task { if deck.isEmpty { deck = set.words } }
        // The mode is left by a button, not a navigation, so nothing else would stop the
        // hold: without this it keeps counting and deals a card in a screen that is gone.
        .onDisappear { holdTask?.cancel() }
    }
```
with:

```swift
        .task { if deck.isEmpty { deck = set.words } }
        // The mode is left by a button, not a navigation, so nothing else would stop the
        // hold: without this it keeps counting and deals a card in a screen that is gone.
        .onDisappear { holdTask?.cancel() }
        .sensoryFeedback(.selection, trigger: flips)
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
                    FlipCard(word: word, flipped: flipped) {
                        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { flipped.toggle() }
                    }
                    .padding(.horizontal, 16)
                }

                if let hold {
                    FlashcardHoldStrip(correct: hold.correct, secondsLeft: hold.secondsLeft, total: Self.holdSeconds)
                        .padding(.horizontal, 16)
                } else {
                    Text("Tap the card to flip it.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(minHeight: 20)
                }
```
with:

```swift
                    FlipCard(word: word, flipped: flipped, onSwipe: swipeVerdict) {
                        withAnimation(Self.flipAnimation) { flipped.toggle() }
                        flips += 1
                    }
                    .padding(.horizontal, 16)
                }

                if let hold {
                    FlashcardHoldStrip(correct: hold.correct, secondsLeft: hold.secondsLeft, total: Self.holdSeconds)
                        .padding(.horizontal, 16)
                } else {
                    Text("Tap to flip — swipe right if you knew it, left to see it again.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 20)
                }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
        // The hold is meant to teach, so the answer has to be on screen for it.
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { flipped = true }
```
with:

```swift
        // The hold is meant to teach, so the answer has to be on screen for it.
        withAnimation(Self.flipAnimation) { flipped = true }
```

- [ ] **Step 3: The card turns, tilts with the finger, and stamps the verdict it would give**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
struct FlipCard: View {
    let word: VocabWord
    let flipped: Bool
    let onFlip: @MainActor () -> Void

    var body: some View {
        ZStack {
            face(back: false).opacity(flipped ? 0 : 1)
            face(back: true)
                .opacity(flipped ? 1 : 0)
                .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .frame(maxWidth: .infinity)
        .frame(height: 360)
        .contentShape(Rectangle())
        .onTapGesture { onFlip() }
    }
```
with:

```swift
struct FlipCard: View {
    let word: VocabWord
    let flipped: Bool
    /// Swiping gives the verdict — right "Correct", left "Still learning" — a shortcut for the
    /// buttons under the card. Nil while a verdict is held: the card only flips then.
    var onSwipe: (@MainActor (Bool) -> Void)? = nil
    let onFlip: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How far the card is being dragged sideways.
    @State private var drag: CGFloat = 0

    /// Past this far, letting go gives the verdict.
    private static let threshold: CGFloat = 110

    /// The verdict letting go would give now — nil until the card has gone far enough.
    private var leaning: Bool? {
        abs(drag) >= Self.threshold ? drag > 0 : nil
    }

    var body: some View {
        ZStack {
            face(back: false).opacity(flipped ? 0 : 1)
            face(back: true)
                .opacity(flipped ? 1 : 0)
                // Under Reduce Motion the card does not turn, so its back is not mirrored either.
                .rotation3DEffect(.degrees(reduceMotion ? 0 : 180), axis: (x: 0, y: 1, z: 0))
        }
        // Under Reduce Motion the faces crossfade instead.
        .rotation3DEffect(.degrees(flipped && !reduceMotion ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .overlay(alignment: .top) { stamp }
        .offset(x: drag)
        // A tilt that follows the finger, about the bottom edge; none under Reduce Motion.
        .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag) / 18), anchor: .bottom)
        .frame(maxWidth: .infinity)
        .frame(height: 360)
        .contentShape(Rectangle())
        .onTapGesture { onFlip() }
        // Simultaneous, so the faces' own up-and-down scrolling still works.
        .simultaneousGesture(swipe)
        .animation(Motion.focusTap, value: leaning)
        .sensoryFeedback(trigger: leaning) { _, now in now == nil ? nil : .selection }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { value in
                // Sideways only: an up-and-down drag is a long definition scrolling.
                guard onSwipe != nil, abs(value.translation.width) > abs(value.translation.height) else { return }
                drag = value.translation.width
            }
            .onEnded { _ in
                let verdict = leaning
                withAnimation(Motion.focus) { drag = 0 }
                if let verdict { onSwipe?(verdict) }
            }
    }

    /// What letting go would do, once the card has gone far enough — the student's own verdict
    /// on themselves (flashcards are self-graded), never the app's.
    @ViewBuilder
    private var stamp: some View {
        if let leaning {
            Label(leaning ? "Correct" : "Still learning", systemImage: leaning ? "checkmark" : "arrow.counterclockwise")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(leaning ? Theme.success : Theme.warning))
                .padding(.top, 16)
                .transition(.opacity)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
```

- [ ] **Step 4: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -n "spring(" ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift
git commit -m "feat(ios): flashcards turn in 250 ms and swipe for the verdict; a round saved on the way out is still celebrated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 36: The test, matching and speed while answering

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift`
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` (`MatchingRound`, `MatchCardTile`)
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift`

**Interfaces:**
- Consumes: `VocabGames.spellingTiles`, `VocabGames.SpellingTile` (Task 31); `FocusPress`, `.focusTurn`, `focusShake`, `Motion.focus`, `Motion.focusTap` (Task 33).
- Produces: `MatchCardTile.misses: Int` (declared after `isWrong`; the one caller is in the same file). Nothing else outside the files.

What the student gets (approved design §3):
- **Test** — every answer presses calmly (`FocusPress`, alike for all) and ticks alike, and the next question comes in from the right in 200 ms; the spelling question's tiles fill with the letters as they are typed, each dropping into its well in 120 ms. Still no right or wrong until the end: no colour, no haptic and no motion differs between a right and a wrong answer — a typed letter looks the same whether it is right or not (`spellingTiles` never compares).
- **Matching** — the game the design lets speak while playing: a found pair pops (up 4% and back, 220 ms) and then fades; a pair that is not one shakes (240 ms, a red pulse under Reduce Motion) with a warning haptic; every other pick ticks.
- **Speed** — under ten seconds the clock pulses once a second, with the second, instead of breathing in a loop beside the word; the 3-2-1 lead-in comes in without overshoot; answers press calmly and tick alike.

Rules (repeat): ≤250 ms, no overshoot over content — the match pop is the one exception the design names, kept to 4% so a tile never reaches its neighbour (10 pt apart); Reduce Motion → fades (the turn is a crossfade, letters fade in, the pop and the clock pulse are off, the shake is a red pulse); haptics: selection for picks, warning for a matching miss; VoiceOver reads the spelling well as one line ("b, r, i, blank, blank"), never "underscore".

- [ ] **Step 1: The test — calm presses, one tick per answer, the question turns**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
    @State private var typed = ""
    @FocusState private var spellingFocused: Bool
```
with:

```swift
    @State private var typed = ""
    @FocusState private var spellingFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
            ScrollView {
                if let question = current {
                    VStack(spacing: 16) {
                        switch question.kind {
                        case .mcq: multipleChoice(question)
                        case .trueFalse: trueFalse(question)
                        case .spelling: spelling(question)
                        }
                    }
                    .padding(16)
                    .id(question.id)
                }
            }
        }
```
with:

```swift
            ScrollView {
                // A ZStack, so the question leaving and the next one overlap for their 200 ms
                // instead of stacking.
                ZStack {
                    if let question = current {
                        VStack(spacing: 16) {
                            switch question.kind {
                            case .mcq: multipleChoice(question)
                            case .trueFalse: trueFalse(question)
                            case .spelling: spelling(question)
                            }
                        }
                        .padding(16)
                        .id(question.id)
                        .transition(.focusTurn(.forward, reduceMotion: reduceMotion))
                    }
                }
            }
            // One tick per answer, the same for every answer: nothing is graded until the end.
            .sensoryFeedback(.selection, trigger: answers.count)
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
```
with:

```swift
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(FocusPress())
                }
            }
        }
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
            .frame(maxWidth: .infinity, minHeight: 88)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
```
with:

```swift
            .frame(maxWidth: .infinity, minHeight: 88)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(FocusPress())
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
        if index + 1 < questions.count {
            index += 1
            return
        }
```
with:

```swift
        if index + 1 < questions.count {
            withAnimation(Motion.focus) { index += 1 }
            return
        }
```

- [ ] **Step 2: The spelling well fills as the student types**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
                // Letter tiles: the given letter is filled, the blanks are dashed wells,
                // punctuation is bare structure rather than something to guess.
                FlowLayout(spacing: 6) {
                    ForEach(Array(VocabGames.maskWord(question.word, revealing: question.revealIndex).enumerated()), id: \.offset) { _, character in
                        letterTile(character)
                    }
                }
```
with:

```swift
                // Letter tiles: the given letter is filled, the blanks are dashed wells that
                // take the typed letters as they come, punctuation is bare structure rather
                // than something to guess. A typed letter looks the same right or wrong.
                let tiles = VocabGames.spellingTiles(word: question.word, revealing: question.revealIndex, typed: typed)
                FlowLayout(spacing: 6) {
                    ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                        letterTile(tile)
                    }
                }
                .animation(Motion.focusTap, value: typed)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.spoken(tiles))
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
    private func letterTile(_ character: String) -> some View {
        let isBlank = character == "_"
        let isStructural = !isBlank && !(character.first?.isLetter ?? false)
        return Text(isStructural ? character : character.uppercased())
            .font(.system(size: 17, weight: .heavy))
            .foregroundStyle(isBlank ? Theme.textLabel : (isStructural ? Theme.textLabel : Theme.success))
            .frame(width: isStructural ? 12 : 34, height: 42)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isStructural ? .clear : (isBlank ? Theme.background : Theme.successSoft))
            )
            .overlay(
                Group {
                    if isBlank {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    } else if !isStructural {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    }
                }
            )
    }
```
with:

```swift
    @ViewBuilder
    private func letterTile(_ tile: VocabGames.SpellingTile) -> some View {
        if tile.kind == .structure {
            Text(tile.character)
                .font(.system(size: 17, weight: .heavy))
                .foregroundStyle(Theme.textLabel)
                .frame(width: 12, height: 42)
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(tile.kind == .given ? Theme.successSoft : (tile.kind == .typed ? Theme.card : Theme.background))
                .overlay {
                    switch tile.kind {
                    case .blank:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    case .given:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.success.opacity(0.4), lineWidth: 1)
                    default:
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.separator, lineWidth: 1)
                    }
                }
                .overlay {
                    if !tile.character.isEmpty {
                        Text(tile.character.uppercased())
                            .font(.system(size: 17, weight: .heavy))
                            .foregroundStyle(tile.kind == .given ? Theme.success : Color.primary)
                            // A new letter is a new view, so it drops into its well.
                            .id(tile.character)
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                    }
                }
                .frame(width: 34, height: 42)
        }
    }

    /// The well as VoiceOver reads it: the letters there so far, "blank" for the rest.
    private static func spoken(_ tiles: [VocabGames.SpellingTile]) -> String {
        tiles.map { tile in
            switch tile.kind {
            case .blank: return "blank"
            case .structure: return tile.character == " " ? "space" : tile.character
            case .given, .typed: return tile.character.lowercased()
            }
        }.joined(separator: ", ")
    }
```

- [ ] **Step 3: Matching — a pop for a pair, a shake for a miss**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
    @State private var wrongPair: Set<String> = []
    @State private var isLocked = false
```
with:

```swift
    @State private var wrongPair: Set<String> = []
    @State private var isLocked = false
    /// One tick per pick that is not a miss — the selection haptic. A miss buzzes a warning
    /// instead, never both at once.
    @State private var taps = 0
    /// Per card, how many wrong pairs it was part of — its shake's trigger.
    @State private var misses: [String: Int] = [:]
    /// Every wrong pair in the round — the warning haptic's trigger.
    @State private var missCount = 0
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
                            isSelected: selected == card.id,
                            isWrong: wrongPair.contains(card.id)
                        ) {
```
with:

```swift
                            isSelected: selected == card.id,
                            isWrong: wrongPair.contains(card.id),
                            misses: misses[card.id] ?? 0
                        ) {
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
        .task { if cards.isEmpty { cards = VocabGames.matchCards(for: words) } }
    }
```
with:

```swift
        .task { if cards.isEmpty { cards = VocabGames.matchCards(for: words) } }
        .sensoryFeedback(.selection, trigger: taps)
        .sensoryFeedback(.warning, trigger: missCount)
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
        guard !isLocked, !matched.contains(card.id) else { return }
        guard let firstId = selected else {
            selected = card.id
            return
        }
        if firstId == card.id {
            selected = nil
            return
        }
        guard let first = cards.first(where: { $0.id == firstId }) else {
            selected = card.id
            return
        }

        if VocabGames.isPair(first, card) {
            onPairFound(card.wordId)
```
with:

```swift
        guard !isLocked, !matched.contains(card.id) else { return }
        guard let firstId = selected else {
            selected = card.id
            taps += 1
            return
        }
        if firstId == card.id {
            selected = nil
            taps += 1
            return
        }
        guard let first = cards.first(where: { $0.id == firstId }) else {
            selected = card.id
            taps += 1
            return
        }

        if VocabGames.isPair(first, card) {
            taps += 1
            onPairFound(card.wordId)
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
        onMistake(first.wordId, card.wordId)
        wrongPair = [first.id, card.id]
```
with:

```swift
        onMistake(first.wordId, card.wordId)
        misses[first.id, default: 0] += 1
        misses[card.id, default: 0] += 1
        missCount += 1
        wrongPair = [first.id, card.id]
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
    let isWrong: Bool
    let onTap: @MainActor () -> Void
```
with:

```swift
    let isWrong: Bool
    /// How many wrong pairs this card was part of — each one shakes it.
    let misses: Int
    let onTap: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
        .buttonStyle(.plain)
        .disabled(isMatched)
        .opacity(isMatched ? 0.25 : 1)
        .scaleEffect(isMatched ? 0.94 : (isSelected ? 1.02 : 1))
        .offset(x: isWrong ? -4 : 0)
        .animation(.spring(response: 0.28, dampingFraction: 0.6), value: isSelected)
        .animation(.easeOut(duration: 0.2), value: isMatched)
        .animation(.default.repeatCount(3, autoreverses: true).speed(6), value: isWrong)
```
with:

```swift
        .buttonStyle(FocusPress())
        .disabled(isMatched)
        // A found pair pops — up 4% and back in 220 ms, never as far as a neighbour 10 pt away —
        // then fades to make room. Not under Reduce Motion.
        .keyframeAnimator(initialValue: 1.0, trigger: reduceMotion ? false : isMatched) { tile, pop in
            tile.scaleEffect(pop)
        } keyframes: { _ in
            KeyframeTrack {
                CubicKeyframe(1.04, duration: 0.1)
                CubicKeyframe(1.0, duration: 0.12)
            }
        }
        .opacity(isMatched ? 0.25 : 1)
        .scaleEffect(isMatched ? 0.94 : (isSelected ? 1.02 : 1))
        // A pair that is not one shakes with its red edge (a red pulse under Reduce Motion).
        .focusShake(misses, cornerRadius: Theme.Radius.card)
        .animation(Motion.focusTap, value: isSelected)
        .animation(.easeOut(duration: 0.2).delay(reduceMotion ? 0 : 0.22), value: isMatched)
        .animation(Motion.focusTap, value: isWrong)
```

- [ ] **Step 4: Speed — the clock pulses with the last ten seconds**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
    @State private var answered = 0
    @State private var correct = 0
```
with:

```swift
    @State private var answered = 0
    @State private var correct = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
        .task { await begin() }
        .onDisappear { clock?.cancel() }
    }
```
with:

```swift
        .task { await begin() }
        .onDisappear { clock?.cancel() }
        // One tick per answer, the same for every answer.
        .sensoryFeedback(.selection, trigger: answered)
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
                    // Re-mounted per tick so the pop replays 3 → 2 → 1.
                    .id(tick)
                    .transition(.scale.combined(with: .opacity))
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.6), value: tick)
```
with:

```swift
                    // Re-mounted per tick, so each number comes in — 3 → 2 → 1 — without
                    // overshoot. Under Reduce Motion they crossfade.
                    .id(tick)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.8).combined(with: .opacity))
            }
            .animation(Motion.focus, value: tick)
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
                    .scaleEffect(isUrgent ? 1.06 : 1)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isUrgent)
```
with:

```swift
                    // Under ten seconds the clock pulses once a second, with the second — not a
                    // loop breathing beside the word. Its red says the rest, and nothing moves
                    // under Reduce Motion.
                    .keyframeAnimator(initialValue: 1.0, trigger: isUrgent && !reduceMotion ? secondsLeft : 0) { pill, scale in
                        pill.scaleEffect(scale)
                    } keyframes: { _ in
                        KeyframeTrack {
                            CubicKeyframe(1.08, duration: 0.1)
                            CubicKeyframe(1.0, duration: 0.15)
                        }
                    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
```
with:

```swift
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(FocusPress())
```

- [ ] **Step 5: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT/Sources/Screens/Vocabulary
grep -n "repeatForever\|repeatCount\|spring(" VocabTestView.swift MatchingView.swift SpeedView.swift   # nothing
grep -n "maskWord" VocabTestView.swift                                                               # nothing
```

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift
git commit -m "feat(ios): the test fills its spelling well and turns calmly; matching pops and shakes; speed's clock pulses with its last seconds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 37: The games' end screen — the accuracy rolls up; confetti only for a round the server says mastered its game

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` (`ModeStat`, `ModeOutcomeView`, new `ModeStatValue`)
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` (`StudyOutcome`, the call to `ModeOutcomeView`, the flashcards' stats)
- Modify: `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift`, `MatchingView.swift`, `SpeedView.swift` (their stats)

**Interfaces:**
- Consumes: `CelebrationRule.vocabRound` (Task 30); `RollingNumber` (Task 33).
- Produces: `ModeStat.percent: Int?` (after `tone`, default nil) and `static func ModeStat.accuracy(_ percent: Int, tone: ModeStat.Tone = .neutral) -> ModeStat`. **Removed:** `StudyOutcome.celebrate` and `ModeOutcomeView.celebrate` — every reader is in this task.

What the student gets: on the end screen of every word game the accuracy's digits roll up from 0 in one 200 ms beat. The confetti (`VocabCelebration`) and the trophy's pop play only when the server says this round mastered its game (`CelebrationRule.vocabRound`) — never on the phone's own belief that the round was clean (the web fires on that; here it played before the server had graded the round, and once on a save that then failed), and not for a set mastered by earlier rounds while this one was not clean. Handing the round in is still celebrated every time, once the cover has gone (phase 2) — this is the outcome on top, never a second effort party.

Rules (repeat): celebrate only after the server confirmed; an outcome only when passed or improved — for a word game, mastered; ≤250 ms in a focus zone, so the accuracy's digits roll once (`numericText`) rather than ticking through every number; under Reduce Motion the number is simply there and the trophy does not pop (`VocabCelebration` already draws nothing under Reduce Motion); VoiceOver reads the final number, never a passing one.

- [ ] **Step 1: A stat can roll up**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` — replace:

```swift
    let label: String
    let value: String
    var tone: Tone = .neutral

    var id: String { label }
}
```
with:

```swift
    let label: String
    let value: String
    var tone: Tone = .neutral
    /// A percentage that rolls up from 0 when the end screen appears; `value` is its text.
    var percent: Int? = nil

    var id: String { label }

    /// The round's accuracy — the number that rolls up.
    static func accuracy(_ percent: Int, tone: Tone = .neutral) -> ModeStat {
        ModeStat(label: "Accuracy", value: "\(ScoreText.string(percent))%", tone: tone, percent: percent)
    }
}

/// A stat's number: an accuracy rolls up from 0 when the end screen appears (`RollingNumber`).
private struct ModeStatValue: View {
    let stat: ModeStat

    var body: some View {
        if let percent = stat.percent {
            RollingNumber(value: Double(percent), suffix: "%")
        } else {
            Text(stat.value)
        }
    }
}
```

- [ ] **Step 2: The end screen parties by the rule**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` — replace:

```swift
    var restartLabel = "Study again"
    /// A clean sweep from the mode's own point of view. Mastering the game or the set
    /// celebrates too, even when this round was not the clean one that did it.
    var celebrate = false
    let onRestart: @MainActor () -> Void
```
with:

```swift
    var restartLabel = "Study again"
    let onRestart: @MainActor () -> Void
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` — replace:

```swift
    @State private var trophyPopped = false

    private var partying: Bool {
        celebrate || summary?.modeMastered == true || summary?.mastery.isMastered == true
    }
```
with:

```swift
    @State private var trophyPopped = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A good outcome by the one rule (`CelebrationRule.vocabRound`): the server says this round
    /// mastered its game. Not the mode's own belief that it was clean (it fired before the round
    /// was graded), and not a set mastered by earlier rounds while this one was not clean. The
    /// hand-in itself is celebrated every time once the cover has gone — this is the outcome on
    /// top of it, never a second effort party.
    private var partying: Bool { CelebrationRule.vocabRound(summary) }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` — replace:

```swift
        .onAppear {
            guard partying else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.5).delay(0.15)) { trophyPopped = true }
        }
        .onChange(of: partying) { _, now in
            if now { withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) { trophyPopped = true } }
        }
```
with:

```swift
        .onAppear {
            // The trophy is chrome on the hero, never over the stats: its spring is allowed —
            // not under Reduce Motion.
            guard partying, !reduceMotion else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.5).delay(0.15)) { trophyPopped = true }
        }
        .onChange(of: partying) { _, now in
            if now, !reduceMotion { withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) { trophyPopped = true } }
        }
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift` — replace:

```swift
                VStack(spacing: 6) {
                    Text(stat.value)
                        .font(.system(size: 25, weight: .heavy).monospacedDigit())
```
with:

```swift
                VStack(spacing: 6) {
                    ModeStatValue(stat: stat)
                        .font(.system(size: 25, weight: .heavy).monospacedDigit())
```

- [ ] **Step 3: The modes hand over their accuracy, and no longer decide to party**

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
    var restartLabel = "Study again"
    /// A clean sweep by the mode's own measure — confetti, as the web fires it.
    var celebrate = false
    /// Extra content between the stats and the actions. Only the test uses it.
```
with:

```swift
    var restartLabel = "Study again"
    /// Extra content between the stats and the actions. Only the test uses it.
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
                        restartLabel: outcome.restartLabel,
                        celebrate: outcome.celebrate,
                        onRestart: { Task { await restart() } },
```
with:

```swift
                        restartLabel: outcome.restartLabel,
                        onRestart: { Task { await restart() } },
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift` — replace:

```swift
                    ModeStat(
                        label: "Accuracy",
                        value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: correct, of: reviewed)))%",
                        tone: .success
                    ),
                ],
                celebrate: correct == reviewed
            ))
```
with:

```swift
                    .accuracy(VocabGames.accuracyPercent(correct: correct, of: reviewed), tone: .success),
                ]
            ))
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift` — replace:

```swift
                ModeStat(label: "Accuracy", value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: right, of: answers.count)))%"),
```
with:

```swift
                .accuracy(VocabGames.accuracyPercent(correct: right, of: answers.count)),
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift` — replace:

```swift
                ModeStat(label: "Accuracy", value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: correct, of: answered)))%"),
```
with:

```swift
                .accuracy(VocabGames.accuracyPercent(correct: correct, of: answered)),
```

**Edit** `ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift` — replace:

```swift
                ModeStat(
                    label: "Clean first try",
                    value: "\(ScoreText.string(cleanFirstTry))/\(ScoreText.string(set.words.count))"
                ),
            ],
            celebrate: mistakes == 0
        ))
```
with:

```swift
                ModeStat(
                    label: "Clean first try",
                    value: "\(ScoreText.string(cleanFirstTry))/\(ScoreText.string(set.words.count))"
                ),
            ]
        ))
```

- [ ] **Step 4: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -rn "celebrate:" ios/MasterSAT/Sources/Screens/Vocabulary/` prints nothing, and `grep -rn "label: \"Accuracy\"" ios/MasterSAT/Sources/Screens/Vocabulary/` prints only `StudyShell.swift` (`ModeStat.accuracy`).

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Vocabulary/StudyShell.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabStudyView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/VocabTestView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/MatchingView.swift \
        ios/MasterSAT/Sources/Screens/Vocabulary/SpeedView.swift
git commit -m "feat(ios): the games' accuracy rolls up; confetti only for a round the server says mastered its game

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 38: Homework upload — thumbnails come in, a ring per file with its real progress, a tick

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` (`HomeworkDetailView`'s hand-in card and `submit`; new `UploadMeter`, `StagedFileRow`, `UploadRing`)

**Interfaces:**
- Consumes: `StudentAPI.submitHomework(…, onFileProgress:)` (Task 32); `FrameBox`, `Motion.focus`, `Motion.focusTap` (Task 33); `CelebrationCenter.celebrate` (phase 2, unchanged call).
- Produces (internal types, in the page's file): `@MainActor @Observable final class UploadMeter { private(set) var sent: [String: Double]; func report(_ fractions: [Double], tokens: [String]); func reset() }`; `struct StagedFileRow: View`; `struct UploadRing: View`.

What the student gets (approved design §3, focus zone "homework upload"): a picked photo's row comes in (scale from 92% and fade, 200 ms) and its thumbnail fades in once it is made (off the main thread — `UIImage.byPreparingThumbnail`); a file shows a document glyph. While the hand-in goes up, each row's remove button becomes a ring that fills with THAT file's share of the upload — real bytes, from Task 32 — and turns into a tick when all of it has gone. When the server confirms, the rows fade out and the hand-in is celebrated once, from the Hand in button, as before ("Send again" included — effort, every time).

Decisions in this task:
- **A ring is real or it is not there** (the owner's "no decorative progress bars"): the fraction is the request's sent bytes over the file's place in the body. A tick means "all of this file's bytes have gone"; the hand-in is confirmed only by the server, which is what the celebration waits for.
- **A ring never runs backwards.** A token refresh re-sends the body from zero; the meter keeps the highest fraction it has shown, so the rings wait full instead of emptying and refilling.
- **The progress lives in its own small `@Observable` (`UploadMeter`), read only by the rows.** URLSession reports every few kilobytes; written to the page's `@State`, every report would re-render the whole homework page.
- **The remove button gets a 44 pt target** without growing the row (negative padding), and rows are removed by token, not by index.

Hand-off fix (phase 2): `handInFrame` was `@State` written on every scroll frame — now a `FrameBox` (`handInSpot`), read only when the hand-in is celebrated.

Rules (repeat): celebrate once per hand-in, only after the server confirmed (the existing two success paths — a lost response whose files are already there counts as in); error ≠ empty; ≤250 ms, no overshoot; Reduce Motion → fades (rows and the tick fade; the ring still fills — it is information, not decoration); VoiceOver: a ring reads "Sending, 40 percent" / "Sent", the thumbnail is hidden (the row's name says what it is), no announcement per chunk.

- [ ] **Step 1: State — the boxed hand-in spot, thumbnails, the meter**

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    /// Where the Hand in button is, so the confetti leaves from it.
    @State private var handInFrame: CGRect = .zero
```
with:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Where the Hand in button is, so the confetti leaves from it. Boxed: it is written on every
    /// scroll frame and read only when the hand-in is celebrated.
    @State private var handInSpot = FrameBox()
    /// A small picture of each staged photo, by file token — made once, off the main thread.
    @State private var thumbnails: [String: UIImage] = [:]
    /// How far each staged file has gone up while the hand-in is sending.
    @State private var meter = UploadMeter()
```

- [ ] **Step 2: Staged rows come in, with their thumbnail and, while sending, their ring**

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
            ForEach(Array(staged.enumerated()), id: \.element.token) { index, file in
                HStack(spacing: 10) {
                    Image(systemName: "doc.badge.plus").foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(file.filename).font(.system(size: 14, weight: .medium))
                        Text(SubmissionLimits.megabytes(file.data.count))
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Button {
                        staged.remove(at: index)
                        actionError = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textLabel)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(file.filename)")
                }
                .cardStyle(padding: 13)
            }
```
with:

```swift
            ForEach(staged, id: \.token) { file in
                StagedFileRow(
                    file: file,
                    thumbnail: thumbnails[file.token],
                    meter: meter,
                    sending: isUploading
                ) {
                    withAnimation(Motion.focus) { staged.removeAll { $0.token == file.token } }
                    thumbnails[file.token] = nil
                    actionError = nil
                }
                .transition(reduceMotion ? .opacity : .scale(scale: 0.92).combined(with: .opacity))
            }
```

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { handInFrame = $0 }
```
with:

```swift
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { handInSpot.rect = $0 }
```

- [ ] **Step 3: Staging animates the row in and makes the thumbnail**

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
        actionError = nil
        staged.append(file)
    }
```
with:

```swift
        actionError = nil
        withAnimation(Motion.focus) { staged.append(file) }
        guard file.mimeType.hasPrefix("image/") else { return }
        // Decoded and shrunk off the main thread: a camera photo is twelve megapixels.
        let token = file.token
        let data = file.data
        Task {
            let small = await UIImage(data: data)?.byPreparingThumbnail(ofSize: CGSize(width: 132, height: 132))
            guard let small, staged.contains(where: { $0.token == token }) else { return }
            withAnimation(Motion.focus) { thumbnails[token] = small }
        }
    }
```

- [ ] **Step 4: Sending reports each file's share; the rows go once the server has them**

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
        let xpBefore = celebrations.xpNow
        isUploading = true
        actionError = nil
        Task {
            defer { isUploading = false }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: a.id,
                    files: staged,
                    expectedRevision: submission?.revision
                )
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
                // Effort, every time — "Send again" included.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInFrame.celebrationPoint)
```
with:

```swift
        let xpBefore = celebrations.xpNow
        isUploading = true
        actionError = nil
        meter.reset()
        // One request carries every file; each row's ring shows its own file's share of it.
        let tokens = staged.map(\.token)
        let progress = meter
        Task {
            defer { isUploading = false }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: a.id,
                    files: staged,
                    expectedRevision: submission?.revision,
                    onFileProgress: { fractions in
                        Task { @MainActor in progress.report(fractions, tokens: tokens) }
                    }
                )
                // Only clear the staged files once the server has them.
                withAnimation(Motion.focus) { staged = [] }
                thumbnails = [:]
                submission = updated
                // Effort, every time — "Send again" included.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInSpot.rect.celebrationPoint)
```

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
                staged = []
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
                // The earlier attempt did land: the work is in.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInFrame.celebrationPoint)
```
with:

```swift
                withAnimation(Motion.focus) { staged = [] }
                thumbnails = [:]
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
                // The earlier attempt did land: the work is in.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInSpot.rect.celebrationPoint)
```

- [ ] **Step 5: The meter, the row and the ring**

**Edit** `ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` — replace:

```swift
struct SubmittedFileRow: View {
    let file: SubmissionFile
```
with:

```swift
/// How far each staged file has gone up, by file token — written as URLSession reports the
/// request's body going out, read only by the rows, so the page around them does not re-render
/// with every chunk.
@MainActor
@Observable
final class UploadMeter {
    private(set) var sent: [String: Double] = [:]

    /// The upload's latest numbers, in the order of `tokens`. Only ever forward: a token refresh
    /// sends the body again from zero, and a ring never runs backwards.
    func report(_ fractions: [Double], tokens: [String]) {
        for (token, fraction) in zip(tokens, fractions) where fraction > (sent[token] ?? 0) {
            sent[token] = fraction
        }
    }

    func reset() {
        if !sent.isEmpty { sent = [:] }
    }
}

/// One file waiting to be handed in: its thumbnail (a photo) or a document glyph, its name and
/// size, and a way to take it off — or, while the hand-in is going up, its own progress ring.
struct StagedFileRow: View {
    let file: MultipartForm.File
    let thumbnail: UIImage?
    let meter: UploadMeter
    let sending: Bool
    let onRemove: @MainActor () -> Void

    var body: some View {
        HStack(spacing: 10) {
            preview
            VStack(alignment: .leading, spacing: 1) {
                Text(file.filename)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(SubmissionLimits.megabytes(file.data.count))
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if sending {
                UploadRing(fraction: meter.sent[file.token] ?? 0)
            } else {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textLabel)
                        // A 44 pt target without growing the row.
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .padding(.vertical, -10)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(file.filename)")
            }
        }
        .cardStyle(padding: 13)
    }

    private var preview: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.accentSoft)
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                Image(systemName: file.mimeType.hasPrefix("image/") ? "photo" : "doc.badge.plus")
                    .foregroundStyle(Theme.accent)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// One file's real upload progress — its bytes sent over its size — then a tick once all of it
/// has gone. The hand-in itself is confirmed by the server, not by the ticks.
struct UploadRing: View {
    let fraction: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var done: Bool { fraction >= 1 }

    var body: some View {
        ZStack {
            Circle().stroke(Theme.surface2, lineWidth: 3)
            Circle()
                .trim(from: 0, to: min(max(fraction, 0), 1))
                .stroke(Theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if done {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.accent)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .frame(width: 26, height: 26)
        .animation(Motion.focusTap, value: fraction)
        .animation(Motion.focus, value: done)
        .accessibilityElement()
        .accessibilityLabel(done ? "Sent" : "Sending, \(Int(fraction * 100)) percent")
    }
}

struct SubmittedFileRow: View {
    let file: SubmissionFile
```

- [ ] **Step 6: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -n "handInFrame" ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift` prints nothing.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/HomeworkDetailView.swift
git commit -m "feat(ios): the hand-in shows each photo, a ring with its real upload progress, and a tick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 39: The review and the midterm report — the score counts up, rows settle in, the filter turns the card; confetti only for passed or improved

**Files:**
- Modify: `ios/MasterSAT/Sources/Support/PageChrome.swift` (`PillTabs.motion`)
- Modify: `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` (`AssessmentReviewView`, `ScoreHero`, `ReviewQuestionCard`)
- Modify: `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift`

**Interfaces:**
- Consumes: `CelebrationRule`, `OutcomeMemory`, `OutcomeBook`, `AssessmentReview.setKey` (Task 30); `RollingNumber`, `focusEntrance`, `FocusTurn`, `.focusTurn`, `OutcomeConfetti`, `Motion.focus` (Task 33); `View.detachedRefresh` (phase 2).
- Produces: `PillTabs.motion: Animation` (after `selection`, default `Motion.snappy` — every existing caller is unchanged); `ScoreHero.improvedFrom: Double?` (after `questions`, default nil).

What the student gets (approved design §3, focus zone "reviews"):
- **Assessment review** — the percentage counts up from 0 in one 200 ms roll, the three counts under it settle in one after another (within 250 ms); the filter's pill slides calmly (`Motion.focus`, not the playful spring) and the card turns the way the chips run — a chip to the right brings its first question in from the right — as Previous and Next turn it back and forward; each card's answer rows settle in and the explanation opens last ("Why this answer works" stays open — the web shows it open, and hiding it behind a tap would cost every student a tap on the screen that exists to explain). An attempt that beat the attempt before it on the same set says "Up from 60%" in the hero every time, and the first time it is shown the page bursts confetti, ticks success and tells VoiceOver "Better than last time — up from 60 percent."
- **Midterm report** — the score counts up; the four numbers, the skills to work on and the skills in the paper settle in; a midterm the centre marked passed bursts confetti, ticks success and says "Passed. Well done." the first time its report is shown. A pre-midterm (never judged) and a midterm still to pass never do.

Decisions in this task:
- **Once, the first time it is shown, on this phone** (`OutcomeMemory` in `UserDefaults`, per student): opening a result again is not a new event. "The attempt before" is the newest earlier attempt this phone showed on the same set — the phone is only ever handed a homework's newest attempt — so a first review on a new phone proves nothing and celebrates nothing.
- **The confetti is the page's own** (`OutcomeConfetti`), not the root overlay's: the midterm report is also reached inside the Me sheet, which the root overlay sits under.
- **The midterm report refreshes detached** and neither page stores a cancelled load as a failure — the phase-2 rules, taken now because this task rebuilds both pages (as phase 3 did for the Rewards pages).

Rules (repeat): an outcome is celebrated only when passed or improved, once, after the server's data says so; effort (handing in) is already celebrated and is not touched; ≤250 ms, no overshoot; Reduce Motion → the numbers are simply there, rows fade in, the turn is a crossfade, no confetti (the words and the haptic stay); growth-oriented copy ("Better than last time", "To improve", "Keep going"); no announcement storm — one sentence, once.

- [ ] **Step 1: `PillTabs` can slide calmly**

**Edit** `ios/MasterSAT/Sources/Support/PageChrome.swift` — replace:

```swift
    let items: [Item]
    @Binding var selection: Tab
    @Namespace private var pill
```
with:

```swift
    let items: [Item]
    @Binding var selection: Tab
    /// How the selected pill slides: the playful spring by default, `Motion.focus` in a focus
    /// zone. A fade under Reduce Motion either way.
    var motion: Animation = Motion.snappy
    @Namespace private var pill
```

**Edit** `ios/MasterSAT/Sources/Support/PageChrome.swift` — replace:

```swift
                        withAnimation(reduceMotion ? Motion.focus : Motion.snappy) { selection = item.tab }
```
with:

```swift
                        withAnimation(reduceMotion ? Motion.focus : motion) { selection = item.tab }
```

- [ ] **Step 2: The review — state, the outcome, the turn**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var xpAtRetry: Int?
```
with:

```swift
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var xpAtRetry: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which way the card last turned — the arriving one comes in from that side.
    @State private var turn: FocusTurn = .forward
    /// The score this attempt beat, when it beat the one before it on the same set.
    @State private var improvedFrom: Double?
    /// Bumped once, the first time a beaten score is shown: the confetti and the success haptic.
    @State private var outcomeTicks = 0
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                        ScoreHero(review: review, questions: questions)
```
with:

```swift
                        ScoreHero(review: review, questions: questions, improvedFrom: improvedFrom)
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                        PillTabs(items: tabs, selection: $filter)

                        if let current {
                            ReviewQuestionCard(
                                question: current,
                                index: shown.firstIndex(where: { $0.id == current.id }) ?? 0,
                                total: shown.count
                            )
                            navigation
```
with:

```swift
                        PillTabs(items: tabs, selection: filterSelection, motion: Motion.focus)

                        if let current {
                            // A ZStack, so the card leaving and the one arriving overlap for their
                            // 200 ms. Keyed by the filter too: the same question under another
                            // filter is another card.
                            ZStack {
                                ReviewQuestionCard(
                                    question: current,
                                    index: shown.firstIndex(where: { $0.id == current.id }) ?? 0,
                                    total: shown.count
                                )
                                .id("\(filter.rawValue).\(current.id)")
                                .transition(.focusTurn(turn, reduceMotion: reduceMotion))
                            }
                            navigation
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: filter) { index = 0 }
```
with:

```swift
        // An outcome's confetti, drawn by the page itself so it is seen wherever the page is.
        .overlay { OutcomeConfetti(trigger: outcomeTicks) }
        .sensoryFeedback(.success, trigger: outcomeTicks)
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
    private var navigation: some View {
        HStack(spacing: 10) {
            Button { index = max(0, index - 1) } label: {
```
with:

```swift
    /// The filter, turning the card the way the chips run: a chip to the right brings its first
    /// question in from the right. The question resets to the first in the same update, so the
    /// card turns once.
    private var filterSelection: Binding<Filter> {
        Binding(
            get: { filter },
            set: { next in
                let order = Filter.allCases
                turn = FocusTurn.from(order.firstIndex(of: filter) ?? 0, to: order.firstIndex(of: next) ?? 0)
                index = 0
                filter = next
            }
        )
    }

    private var navigation: some View {
        HStack(spacing: 10) {
            Button {
                turn = .back
                withAnimation(Motion.focus) { index = max(0, index - 1) }
            } label: {
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
            Button { index = min(shown.count - 1, index + 1) } label: {
```
with:

```swift
            Button {
                turn = .forward
                withAnimation(Motion.focus) { index = min(shown.count - 1, index + 1) }
            } label: {
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
    @MainActor
    private func load() async {
        loadError = nil
        do {
            review = try await session.assessments.review(attemptId: attemptId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}
```
with:

```swift
    @MainActor
    private func load() async {
        loadError = nil
        do {
            let loaded = try await session.assessments.review(attemptId: attemptId)
            review = loaded
            remember(loaded)
        } catch let error as APIError {
            // A cancelled load is not a failure (`APIClient` reports a cancellation as transport).
            guard !Task.isCancelled else { return }
            loadError = error.errorDescription
        } catch {
            guard !Task.isCancelled else { return }
            loadError = error.localizedDescription
        }
    }

    /// The outcome rule (`CelebrationRule.assessment`, by way of `OutcomeMemory`): a marked attempt
    /// that beat the one before it on the same set says so every time it is shown, and is
    /// celebrated once — confetti, a success haptic, one sentence for VoiceOver.
    @MainActor
    private func remember(_ review: AssessmentReview) {
        guard let result = review.result, let setKey = review.setKey,
              case .signedIn(let user) = session.phase else { return }
        let book = OutcomeBook()
        var memory = book.read(userID: user.id)
        let beaten = memory.showAssessment(setKey: setKey, attemptId: attemptId, percent: result.percent)
        let fresh = memory.celebrate(OutcomeMemory.assessmentKey(attemptId), if: beaten != nil)
        book.write(memory, userID: user.id)
        if improvedFrom != beaten { improvedFrom = beaten }
        guard fresh, let beaten else { return }
        outcomeTicks += 1
        AccessibilityNotification.Announcement("Better than last time — up from \(ScoreText.string(beaten)) percent.").post()
    }
}
```

- [ ] **Step 3: The hero counts up, its numbers settle in, and says when it beat the last attempt**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
struct ScoreHero: View {
    let review: AssessmentReview
    let questions: [AssessmentReviewQuestion]
```
with:

```swift
struct ScoreHero: View {
    let review: AssessmentReview
    let questions: [AssessmentReviewQuestion]
    /// The score this attempt beat, when it beat the one before it on the same set.
    var improvedFrom: Double? = nil
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
            if let result = review.result {
                Text("\(ScoreText.string(result.percent))%")
                    .font(.system(size: 56, weight: .black).monospacedDigit())
```
with:

```swift
            if let result = review.result {
                RollingNumber(value: result.percent, suffix: "%")
                    .font(.system(size: 56, weight: .black).monospacedDigit())
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            } else {
```
with:

```swift
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
                if let improvedFrom {
                    Label("Up from \(ScoreText.string(improvedFrom))%", systemImage: "arrow.up.right")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(.white.opacity(0.2)))
                        .padding(.top, 10)
                }
            } else {
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                stat(count(.correct), "Correct")
                stat(count(.incorrect), "To improve")
                stat(count(.unanswered), "Skipped")
```
with:

```swift
                stat(count(.correct), "Correct").focusEntrance(0)
                stat(count(.incorrect), "To improve").focusEntrance(1)
                stat(count(.unanswered), "Skipped").focusEntrance(2)
```

- [ ] **Step 4: A card's answer rows settle in; the explanation opens last**

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                    if question.choices.isEmpty {
                        typedAnswers
                    } else {
                        ForEach(question.choices) { choice in
                            ReviewChoiceRow(
                                choice: choice,
                                isCorrectAnswer: matches(question.correctAnswer, choice.id),
                                isStudentAnswer: matches(question.studentAnswer, choice.id)
                            )
                        }
                    }
```
with:

```swift
                    if question.choices.isEmpty {
                        typedAnswers.focusEntrance(0)
                    } else {
                        ForEach(Array(question.choices.enumerated()), id: \.element.id) { position, choice in
                            ReviewChoiceRow(
                                choice: choice,
                                isCorrectAnswer: matches(question.correctAnswer, choice.id),
                                isStudentAnswer: matches(question.studentAnswer, choice.id)
                            )
                            .focusEntrance(position)
                        }
                    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift` — replace:

```swift
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .stroke(Theme.accent.opacity(0.15), lineWidth: 1)
                    )
                }
```
with:

```swift
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .stroke(Theme.accent.opacity(0.15), lineWidth: 1)
                    )
                    // Open, as the web has it — it settles in last, after the answers.
                    .focusEntrance(max(question.choices.count, 1))
                }
```

- [ ] **Step 5: The midterm report — counts up, settles in, celebrates a pass once**

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
    @State private var isLoading = true
    @State private var pdf: PDFRequest?
```
with:

```swift
    @State private var isLoading = true
    @State private var pdf: PDFRequest?
    /// Bumped once, the first time a passed midterm's report is shown: confetti and the haptic.
    @State private var outcomeTicks = 0
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
```
with:

```swift
        .background(Theme.background)
        // The page's own confetti: this report is also opened inside the Me sheet, which the
        // root overlay sits under.
        .overlay { OutcomeConfetti(trigger: outcomeTicks) }
        .sensoryFeedback(.success, trigger: outcomeTicks)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Detached: `load` writes state this page reads, and that must not cancel its requests.
        .detachedRefresh { await load() }
        .task { await load() }
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(ScoreText.string(score))
                    .font(.system(size: 60, weight: .heavy).monospacedDigit())
```
with:

```swift
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Group {
                    if let score { RollingNumber(value: score) } else { Text(ScoreText.string(score)) }
                }
                    .font(.system(size: 60, weight: .heavy).monospacedDigit())
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
                if report.isGraded, let score = report.score {
                    MidtermStatTile(
                        label: "Score",
                        value: ScoreText.string(score),
                        sub: report.passMark.map { "Pass mark \(ScoreText.string($0))" }
                            ?? report.midterm.scoreCeiling.map { "of \(ScoreText.string($0))" }
                    )
                }
                MidtermStatTile(
                    label: "Correct",
                    value: "\(ScoreText.string(report.correctCount))/\(ScoreText.string(report.totalCount))",
                    sub: "\(report.accuracyPercent)% accuracy"
                )
                MidtermStatTile(label: "To improve", value: ScoreText.string(report.wrongCount), sub: nil)
                MidtermStatTile(
                    label: "Focus \(noun)s",
                    value: ScoreText.string(report.skills.count),
                    sub: report.skills.count == 1 ? "\(noun) to work on" : "\(noun)s to work on"
                )
```
with:

```swift
                if report.isGraded, let score = report.score {
                    MidtermStatTile(
                        label: "Score",
                        value: ScoreText.string(score),
                        sub: report.passMark.map { "Pass mark \(ScoreText.string($0))" }
                            ?? report.midterm.scoreCeiling.map { "of \(ScoreText.string($0))" }
                    )
                    .focusEntrance(0)
                }
                MidtermStatTile(
                    label: "Correct",
                    value: "\(ScoreText.string(report.correctCount))/\(ScoreText.string(report.totalCount))",
                    sub: "\(report.accuracyPercent)% accuracy"
                )
                .focusEntrance(1)
                MidtermStatTile(label: "To improve", value: ScoreText.string(report.wrongCount), sub: nil)
                    .focusEntrance(2)
                MidtermStatTile(
                    label: "Focus \(noun)s",
                    value: ScoreText.string(report.skills.count),
                    sub: report.skills.count == 1 ? "\(noun) to work on" : "\(noun)s to work on"
                )
                .focusEntrance(3)
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
                ForEach(report.skills) { SkillRow(skill: $0) }
```
with:

```swift
                ForEach(Array(report.skills.enumerated()), id: \.element.id) { position, skill in
                    SkillRow(skill: skill).focusEntrance(position)
                }
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
                        if index > 0 { Divider() }
                        CoveredRow(skill: skill)
```
with:

```swift
                        if index > 0 { Divider() }
                        CoveredRow(skill: skill).focusEntrance(index)
```

**Edit** `ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift` — replace:

```swift
        // Held separately on purpose: a missing report must not blank a released score.
        do {
            report = try await breakdown
            reportProblem = nil
        } catch {
            report = nil
            reportProblem = MidtermReportUnavailable(error)
        }

        do {
            result = try await review
        } catch let error as APIError {
            // Only a failure of BOTH is a failure of the screen.
            if report == nil { loadError = error.errorDescription ?? "Result not available yet." }
        } catch {
            if report == nil { loadError = error.localizedDescription }
        }
    }
}
```
with:

```swift
        // Held separately on purpose: a missing report must not blank a released score.
        do {
            report = try await breakdown
            reportProblem = nil
        } catch {
            // A cancelled load is not a failure (`APIClient` reports a cancellation as transport).
            guard !Task.isCancelled else { return }
            report = nil
            reportProblem = MidtermReportUnavailable(error)
        }

        do {
            result = try await review
        } catch let error as APIError {
            guard !Task.isCancelled else { return }
            // Only a failure of BOTH is a failure of the screen.
            if report == nil { loadError = error.errorDescription ?? "Result not available yet." }
        } catch {
            guard !Task.isCancelled else { return }
            if report == nil { loadError = error.localizedDescription }
        }
        if let report { remember(report) }
    }

    /// The outcome rule (`CelebrationRule.midterm`, once by way of `OutcomeMemory`): a midterm the
    /// centre marked passed is celebrated the first time its report is shown — confetti, a
    /// success haptic, one sentence for VoiceOver. A pre-midterm, or one still to pass, never is.
    @MainActor
    private func remember(_ report: MidtermErrorReport) {
        guard case .signedIn(let user) = session.phase else { return }
        let book = OutcomeBook()
        var memory = book.read(userID: user.id)
        let passed = CelebrationRule.midterm(isGraded: report.isGraded, passed: report.passed)
        guard memory.celebrate(OutcomeMemory.midtermKey(attemptId), if: passed) else { return }
        book.write(memory, userID: user.id)
        outcomeTicks += 1
        AccessibilityNotification.Announcement("Passed. Well done.").post()
    }
}
```

- [ ] **Step 6: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT/Sources/Screens
grep -n "\.refreshable" Midterms/MidtermReportView.swift          # nothing
grep -n "onChange(of: filter)" Assessments/AssessmentReviewView.swift   # nothing
```

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Support/PageChrome.swift \
        ios/MasterSAT/Sources/Screens/Assessments/AssessmentReviewView.swift \
        ios/MasterSAT/Sources/Screens/Midterms/MidtermReportView.swift
git commit -m "feat(ios): reviews count up and settle in; confetti once for a passed midterm or a beaten score

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 40: Sign in and register — the logo springs in, the panel breathes (and holds still under Reduce Motion), a wrong password shakes

**Files:**
- Modify: `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` (`BrandLockup`, `FloatingShapes`, `AuthField`, `PasswordField`)
- Modify: `ios/MasterSAT/Sources/Screens/Auth/AuthView.swift` (`SignInForm`)
- Modify: `ios/MasterSAT/Sources/Screens/Account/AccountComponents.swift` (`AccountSecureField`)
- Modify: `ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift` (`AccountPasswordForm`)

**Interfaces:**
- Consumes: `focusShake`, `Motion.pop` (Task 33 / phase 1); `AuthErrorCopy.classify`, `AccountCopy.passwordFailure`, `PasswordChangeCheck.Field.current` (existing).
- Produces: `AuthField.shakes: Int` (after `icon`, default 0); `PasswordField.shakes: Int` (after `field`, default 0); `AccountSecureField.shakes: Int` (after `field`, default 0). Every existing call compiles unchanged.

Which screens: the sign-in screen is `Screens/Auth/AuthView.swift` (`SignInForm`, `RegisterForm`) with its brand panel in `Screens/Auth/AuthChrome.swift`. `Screens/Account/AccountSignInView.swift` — named in the brief — is the Me sheet's "Sign-in & password" settings page; the only wrong password there is the current one when changing it, and it gets the same shake.

What the student gets (approved design §3, focus zone "sign-in"):
- The MasterSAT mark springs in as the brand panel appears (from 70%, `Motion.pop`) — chrome above the form, never over it, so the spring is allowed; it fades in under Reduce Motion. On a phone the panel is the header band; on an iPad it is the left half.
- The panel breathes: its shapes drift slowly (13–16 s, the web's `dz-float` keyframes, already there). Under Reduce Motion they now hold still — they did not.
- A wrong email or password shakes the password box (240 ms) with a warning haptic, and VoiceOver hears the same sentence the alert shows. Under Reduce Motion the box pulses red instead. Being offline, throttled or refused for another reason only says so — no shake: the password was not the problem.
- Changing the password in the Me sheet: when the server says the current password is wrong, its box shakes the same way.

Rules (repeat): ≤250 ms and no overshoot over the form (the shake comes to rest where it started; the spring is on the logo only); Reduce Motion → the logo fades, the shapes hold still, the shake is a red pulse; haptics — warning for a wrong password; English, plain copy (the existing sentences).

- [ ] **Step 1: The logo springs in; the shapes hold still under Reduce Motion**

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
    var body: some View {
        HStack(spacing: 11) {
            BrandMark(height: height)
            Text("MasterSAT")
```
with:

```swift
    var body: some View {
        HStack(spacing: 11) {
            BrandMark(height: height)
                .modifier(LogoArrival())
            Text("MasterSAT")
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
/// The site's `<aside class="authbrand">`.
```
with:

```swift
/// The mark arriving as the panel appears: it springs up from 70% — chrome above the form, never
/// over it, so a spring is allowed. Under Reduce Motion it only fades in.
private struct LogoArrival: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(arrived || reduceMotion ? 1 : 0.7)
            .opacity(arrived ? 1 : 0)
            .onAppear {
                withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.pop.delay(0.1)) { arrived = true }
            }
    }
}

/// The site's `<aside class="authbrand">`.
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
private struct FloatingShapes: View {
    let compact: Bool
    @State private var drifting = false

    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width
            let h = geometry.size.height
            ZStack {
                Circle()
                    .fill(.white.opacity(0.10))
                    .frame(width: 280, height: 280)
                    .position(x: w + 30, y: -20)
                    .offset(y: drifting ? 14 : -14)
                    .animation(.easeInOut(duration: 14).repeatForever(autoreverses: true), value: drifting)

                RoundedRectangle(cornerRadius: 44, style: .continuous)
                    .fill(.white.opacity(0.08))
                    .frame(width: 200, height: 200)
                    .position(x: w - 60, y: h + 40)
                    .offset(x: drifting ? -12 : 12)
                    .animation(.easeInOut(duration: 16).repeatForever(autoreverses: true), value: drifting)

                Circle()
                    .stroke(.white.opacity(0.11), lineWidth: 18)
                    .frame(width: 150, height: 150)
                    .position(x: -20, y: h - 60)
                    .offset(y: drifting ? -16 : 16)
                    .animation(.easeInOut(duration: 13).repeatForever(autoreverses: true), value: drifting)

                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.white.opacity(0.07))
                    .frame(width: 60, height: 60)
                    .position(x: w - (compact ? 70 : 120), y: compact ? 130 : 90)
                    .offset(x: drifting ? 10 : -10, y: drifting ? -8 : 8)
                    .animation(.easeInOut(duration: 15).repeatForever(autoreverses: true), value: drifting)
```
with:

```swift
private struct FloatingShapes: View {
    let compact: Bool
    @State private var drifting = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The panel breathes — unless Reduce Motion is on: then every shape holds still at rest.
    private var breathing: Bool { drifting && !reduceMotion }

    /// One slow drift, `seconds` each way. Under Reduce Motion a short settle to rest instead,
    /// which also replaces a drift already running when it is switched on.
    private func drift(_ seconds: Double) -> Animation {
        reduceMotion ? .easeOut(duration: 0.3) : .easeInOut(duration: seconds).repeatForever(autoreverses: true)
    }

    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width
            let h = geometry.size.height
            ZStack {
                Circle()
                    .fill(.white.opacity(0.10))
                    .frame(width: 280, height: 280)
                    .position(x: w + 30, y: -20)
                    .offset(y: breathing ? 14 : -14)
                    .animation(drift(14), value: breathing)

                RoundedRectangle(cornerRadius: 44, style: .continuous)
                    .fill(.white.opacity(0.08))
                    .frame(width: 200, height: 200)
                    .position(x: w - 60, y: h + 40)
                    .offset(x: breathing ? -12 : 12)
                    .animation(drift(16), value: breathing)

                Circle()
                    .stroke(.white.opacity(0.11), lineWidth: 18)
                    .frame(width: 150, height: 150)
                    .position(x: -20, y: h - 60)
                    .offset(y: breathing ? -16 : 16)
                    .animation(drift(13), value: breathing)

                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.white.opacity(0.07))
                    .frame(width: 60, height: 60)
                    .position(x: w - (compact ? 70 : 120), y: compact ? 130 : 90)
                    .offset(x: breathing ? 10 : -10, y: breathing ? -8 : 8)
                    .animation(drift(15), value: breathing)
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
                        .position(x: 40, y: h * 0.62)
                        .offset(y: drifting ? 12 : -12)
                        .animation(.easeInOut(duration: 11).repeatForever(autoreverses: true), value: drifting)
```
with:

```swift
                        .position(x: 40, y: h * 0.62)
                        .offset(y: breathing ? 12 : -12)
                        .animation(drift(11), value: breathing)
```

- [ ] **Step 2: A field box can shake**

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
struct AuthField<Accessory: View>: View {
    let label: String
    var icon: String?
    @ViewBuilder let content: () -> Accessory
```
with:

```swift
struct AuthField<Accessory: View>: View {
    let label: String
    var icon: String?
    /// Bumped when what was typed here was refused — the box shakes (`focusShake`).
    var shakes: Int = 0
    @ViewBuilder let content: () -> Accessory
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
            .padding(.horizontal, 13)
            .frame(height: 48)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
        }
    }
}
```
with:

```swift
            .padding(.horizontal, 13)
            .frame(height: 48)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
            .focusShake(shakes, cornerRadius: Theme.Radius.control)
        }
    }
}
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` — replace:

```swift
    @FocusState.Binding var focus: AuthFocus?
    let field: AuthFocus
    let onSubmit: () -> Void

    @State private var revealed = false

    var body: some View {
        AuthField(label: label, icon: "lock") {
```
with:

```swift
    @FocusState.Binding var focus: AuthFocus?
    let field: AuthFocus
    /// Bumped when the server refused this password — the box shakes.
    var shakes: Int = 0
    let onSubmit: () -> Void

    @State private var revealed = false

    var body: some View {
        AuthField(label: label, icon: "lock", shakes: shakes) {
```

- [ ] **Step 3: A wrong password shakes the box, buzzes, and is said**

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthView.swift` — replace:

```swift
    @State private var retryable = false
    @State private var forgotOpen = false
    @FocusState private var focus: AuthFocus?
```
with:

```swift
    @State private var retryable = false
    @State private var forgotOpen = false
    @FocusState private var focus: AuthFocus?
    /// Bumped when the server said the email or password is wrong: the password box shakes and
    /// a warning haptic plays. Other failures (offline, throttled) only say so.
    @State private var refusals = 0
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthView.swift` — replace:

```swift
            PasswordField(
                label: "Password",
                text: $password,
                focus: $focus,
                field: .password,
                onSubmit: { if canSubmit { submit() } }
            )

            HStack {
                Spacer()
                Button("Forgot password?") { forgotOpen.toggle() }
```
with:

```swift
            PasswordField(
                label: "Password",
                text: $password,
                focus: $focus,
                field: .password,
                shakes: refusals,
                onSubmit: { if canSubmit { submit() } }
            )

            HStack {
                Spacer()
                Button("Forgot password?") { forgotOpen.toggle() }
```

**Edit** `ios/MasterSAT/Sources/Screens/Auth/AuthView.swift` — replace:

```swift
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }

    private func submit() {
        focus = nil
        error = nil
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } catch {
                let copy = AuthErrorCopy.classify(error)
                self.error = copy.message
                retryable = copy.retryable
            }
        }
    }
```
with:

```swift
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
        .sensoryFeedback(.warning, trigger: refusals)
    }

    private func submit() {
        focus = nil
        error = nil
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } catch {
                let copy = AuthErrorCopy.classify(error)
                self.error = copy.message
                retryable = copy.retryable
                // On this screen a 401 is a wrong email or password (`AuthErrorCopy`).
                if case .unauthorized? = error as? APIError { refusals += 1 }
                // The alert appears where the eye is not; VoiceOver hears it once.
                AccessibilityNotification.Announcement(copy.message).post()
            }
        }
    }
```

- [ ] **Step 4: The current password shakes when the server refuses it**

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountComponents.swift` — replace:

```swift
    let focus: FocusState<Focus?>.Binding
    let field: Focus
    var onSubmit: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            AccountFieldBox(icon: "lock", invalid: error != nil) {
```
with:

```swift
    let focus: FocusState<Focus?>.Binding
    let field: Focus
    /// Bumped when the server refused this password — the box shakes (`focusShake`).
    var shakes: Int = 0
    var onSubmit: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            AccountFieldBox(icon: "lock", invalid: error != nil) {
```

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountComponents.swift` — replace:

```swift
                .accessibilityLabel(revealed ? "Hide passwords" : "Show passwords")
            }
            AccountFieldNote(hint: hint, error: error)
```
with:

```swift
                .accessibilityLabel(revealed ? "Hide passwords" : "Show passwords")
            }
            .focusShake(shakes, cornerRadius: Theme.Radius.control)
            AccountFieldNote(hint: hint, error: error)
```

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift` — replace:

```swift
    @State private var saving = false
    @FocusState private var focus: Field?
```
with:

```swift
    @State private var saving = false
    @FocusState private var focus: Field?
    /// Bumped when the server said the current password is wrong: its box shakes and buzzes.
    @State private var currentRefusals = 0
```

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift` — replace:

```swift
                focus: $focus,
                field: Field.current,
                onSubmit: { focus = .new }
            )
```
with:

```swift
                focus: $focus,
                field: Field.current,
                shakes: currentRefusals,
                onSubmit: { focus = .new }
            )
```

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift` — replace:

```swift
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.accentSoft))
    }
```
with:

```swift
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.accentSoft))
        .sensoryFeedback(.warning, trigger: currentRefusals)
    }
```

**Edit** `ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift` — replace:

```swift
        } catch {
            errors = AccountCopy.passwordFailure(error)
        }
```
with:

```swift
        } catch {
            errors = AccountCopy.passwordFailure(error)
            // The server's refusal of the current password is keyed to its field.
            if errors[PasswordChangeCheck.Field.current.rawValue] != nil { currentRefusals += 1 }
        }
```

- [ ] **Step 5: Build**

Run the build check. Expected: `exit=0`, `** BUILD SUCCEEDED **`. Then `grep -n "drifting ?" ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift` prints nothing (every shape reads `breathing`).

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git add ios/MasterSAT/Sources/Screens/Auth/AuthChrome.swift \
        ios/MasterSAT/Sources/Screens/Auth/AuthView.swift \
        ios/MasterSAT/Sources/Screens/Account/AccountComponents.swift \
        ios/MasterSAT/Sources/Screens/Account/AccountSignInView.swift
git commit -m "feat(ios): sign-in — the logo springs in, the panel holds still under Reduce Motion, a wrong password shakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 41: Run it, prove it, open the PR

**Files:** none (verification). Run by the controller, not a subagent.

- [ ] **Step 1: Kit green**

Run: `cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSATKit && swift test 2>&1 | tail -2`
Expected: `✔ Test run with 759 tests … passed` (740 + 11 + 5 + 3). Only a literal pass counts.

- [ ] **Step 2: A local backend with phase-4 work on it**

Migrate and seed exactly as Task 9 Step 2, run Task 19's `/tmp/seed_phase2.py` (its "Phase 2 set" of five words is every game's fixture; it is idempotent) and Task 29's `/tmp/seed_phase3.py`, and start the `ios-redesign-backend` preview. Then save as `/tmp/seed_phase4.py`:

```python
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from classes.models import Assignment, Classroom
from assessments.models import AssessmentSet, AssessmentQuestion, HomeworkAssignment

U = get_user_model()
owner = U.objects.get(email="uat_owner@mastersat.test")
math = Classroom.objects.get(name="UAT Math Class")

def homework(title, days_ahead):
    assignment, _ = Assignment.objects.get_or_create(
        classroom=math, title=title,
        defaults={"created_by": owner, "category": Assignment.CATEGORY_HOMEWORK,
                  "status": Assignment.STATUS_PUBLISHED, "max_score": 100,
                  "due_at": timezone.now() + timedelta(days=days_ahead)})
    return assignment

# Six questions: four with four choices (the cross-out, the map's two rows), a number, a true/false.
quiz = homework("Phase 4 · the runner", 3)
aset, _ = AssessmentSet.objects.get_or_create(
    title="Phase 4 runner",
    defaults={"subject": "math", "category": "Algebra › Linear equations", "review_status": "approved", "created_by": owner})
choices = [
    ("3x = 12. What is x?", ["2", "3", "4", "6"], "C", "Divide both sides by 3: x = 12 ÷ 3 = 4."),
    ("x + 5 = 9. What is x?", ["4", "5", "9", "14"], "A", "Take 5 from both sides: x = 9 − 5 = 4."),
    ("2x − 1 = 7. What is x?", ["3", "4", "6", "8"], "B", "Add 1, then halve: 2x = 8, so x = 4."),
    ("Which line is steepest?", ["y = x", "y = 2x", "y = 3x", "y = x/2"], "C", "The slope is the number in front of x; 3 is the largest."),
]
for order, (prompt, options, answer, why) in enumerate(choices):
    AssessmentQuestion.objects.get_or_create(
        assessment_set=aset, order=order,
        defaults={"prompt": prompt, "question_type": "multiple_choice",
                  "choices": [{"id": key, "text": text} for key, text in zip("ABCD", options)],
                  "correct_answer": answer, "explanation": why})
AssessmentQuestion.objects.get_or_create(
    assessment_set=aset, order=4,
    defaults={"prompt": "12 ÷ 4 = ?", "question_type": "numeric", "correct_answer": "3",
              "explanation": "Four threes make twelve."})
AssessmentQuestion.objects.get_or_create(
    assessment_set=aset, order=5,
    defaults={"prompt": "7 is a prime number.", "question_type": "boolean", "correct_answer": True,
              "explanation": "Its only divisors are 1 and 7."})
HomeworkAssignment.objects.get_or_create(classroom=math, assessment_set=aset, defaults={"assignment": quiz, "assigned_by": owner})

homework("Phase 4 · photos", 2)
print("phase 4 fixtures ready")
```

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/backend
SECRET_KEY=dev-secret DEBUG=True ~/.pyenv/versions/3.12.2/bin/python3 manage.py shell -c "exec(open('/tmp/seed_phase4.py').read())"
git -C .. status --short   # nothing new under backend/ (db.sqlite3 is gitignored)
```
Expected: `phase 4 fixtures ready`.

- [ ] **Step 3: Run on the simulator against it**

Build (the build check), then:
```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign/ios/MasterSAT
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null
xcrun simctl install booted build/dd/Build/Products/Debug-iphonesimulator/MasterSAT.app
xcrun simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000
xcrun simctl launch booted uz.mastersat.app -apiBaseURL "http://localhost:8000"
```
Sign in as `uat_s1@mastersat.test` (password in `seed_classroom_uat.py`). Screenshot each item (`sleep 2; xcrun simctl io booted screenshot <name>.png`); for motion, a screen recording is the evidence:

1. **The runner turns calmly:** Class → Tasks → To do → "Phase 4 · the runner" → Start. Next → the question comes in from the right in ~200 ms, the old one fades, nothing bounces; Previous → from the left; each question opens at its top. The header reads "0/6"; there is no progress bar.
2. **Choices, never a verdict:** pick C on question 1 → the choice fills in blue in ~200 ms with a selection tick; "0/6" rolls to "1/6"; "Saved" appears under it and fades after about a second. Pick A instead → the same fill, the same tick — no green, no red, nothing different for a right or a wrong choice anywhere in the runner. Tap the chosen one again → it clears, "1/6" rolls back to "0/6".
3. **Cross-out and flag:** tap the minus beside B → a line draws through the whole option, left to right, and it dims; tap again → the line goes. Flag → the glyph bounces once with a tick; unflag → no bounce.
4. **The map:** "1 / 6 ⌃" → the cells settle in row by row within a quarter second; answered cells are light blue (not green), the current one solid blue, the flag shows; the legend says the same. VoiceOver (if on): "Question 2, answered, flagged". Jump to 5 → it comes in from the right; jump to 2 → from the left.
5. **The first hand-in — half right on purpose:** answer questions 1, 2 and 3 wrongly and 4, 5 ("3") and 6 (True) correctly. On question 5 the keyboard opens; Next → it closes as the question turns. Scroll each question to its end: the content stops at the footer — no empty band a tab bar tall (the covers' `noBarClearance`). Hand in → Hand in → "Handed in" fades in → Done → the check and confetti play once the runner has gone; "+N XP" flies only if the header's XP rose.
6. **Review, first attempt:** Class → Tasks → Results → the "Phase 4 · the runner" result (its review) → the percentage rolls up from 0 to 50%, the three counts under it settle in one after another; no confetti, no "Up from" (the first attempt this phone has shown). "To improve" → the pill slides without a bounce and the card comes in from the right; "All" → from the left; Next / Previous turn it forward and back; on each card the answer rows settle in and "Why this answer works" opens last.
7. **Review, improved:** "Retry assessment" → answer all six correctly → Hand in → Done (the review closes, Class reloads). Open the new result → "100%" rolls up, "Up from 50%" sits under it, confetti bursts from the top once, a success haptic; VoiceOver: "Better than last time — up from 50 percent." Back, open it again → "Up from 50%" is still there; no confetti.
8. **Flashcards:** Class → English → "five words" → the set → Flashcards. Tap → the card turns in a quarter second, a tick, no wobble. Drag it right slowly → it tilts with the finger; at about a third of the screen "Correct" stamps on with a tick; let go → it comes back to the middle, shows the definition, the hold strip runs (exactly as the "Correct" button). Drag left a little and let go → it comes back, nothing is given. During a hold, dragging does nothing. Clear the round with every card "Correct" → the end screen's accuracy rolls up to 100%; once "Saving your progress…" has gone: "Game mastered", the confetti and the trophy's pop. Back → the check and confetti play once the cover has gone (effort). Play again with one "Still learning" → no confetti on the end screen.
9. **Test:** Test → every answer dips a little when pressed and ticks alike, the next question comes in from the right. On a spelling question type the word → each letter drops into its well, the given letter stays where it is; a wrong letter looks exactly like a right one. The end: accuracy rolls up; the review lists what to look at again.
10. **Matching:** tap a word, then its meaning → a tick each; the pair pops (a small swell) and fades. Tap a word and a wrong meaning → both shake briefly, red, with a warning haptic.
11. **Speed:** 3-2-1 comes in without overshoot. Answer one, then wait: at 0:10 the clock turns red and from then on pulses once a second, with the second — no continuous breathing. Answers tick alike.
12. **Upload:** Class → "Phase 4 · photos" → Photo → pick three → each row comes in and its thumbnail fades in; × on one → its row fades out. Hand in → each row's × becomes a ring that fills and turns into a tick (on localhost the bytes go almost at once — the recording, frame by frame, shows ring → tick); the rows fade out; the check and confetti leave from the Hand in button once; back on Today, "+15 XP" flies into the pill.
13. **The hand-in baseline (phase 3 hand-off):** note the pill's XP. Results → the newest "Phase 4 · the runner" review → Retry assessment → the runner opens; send the app to the background (`xcrun simctl launch booted com.apple.Preferences`); award `services.award(s1, "MANUAL", idempotency_key="p4-mid-session", points=20, actor=owner, reason="phase 4 demo")` in a shell; bring the app back; hand in → Done. Expected: the pill never shows less than it did before the hand-in; "+20" flies once (the welcome-back caption), and the quiz's own gain — if any — flies on its own, never with the 20 in it.
14. **Sign in:** Me → Sign out. The sign-in screen: the mark springs in from small, the panel's shapes drift slowly. Type a wrong password → Sign in → the password box shakes once, a warning haptic, the alert says "The email or password you entered is incorrect." (VoiceOver hears it). Stop the backend preview → Sign in → "Cannot connect to the server…", no shake; start it again. "Register now" → the panel's mark springs in again, five fields. Sign in correctly.
15. **Change password:** Me → Account → Sign-in & password → Change password → a wrong current password and a valid new one twice → Update → the current box shakes, warning haptic, "That isn't your current password." under it. Cancel.
16. **Reduce Motion** (`xcrun simctl spawn booted defaults write com.apple.Accessibility ReduceMotionEnabled -bool true`, relaunch): the runner's questions crossfade; the cross-out line appears without drawing; the flag does not bounce; the map fades in; the flashcard crossfades (no turn, the back not mirrored) and a drag moves it without tilting; a matching miss pulses red without shaking and a match does not pop; the speed clock does not pulse; the review's numbers are simply there and rows fade in; the sign-in mark fades in and the shapes hold still; a wrong password pulses the box red. No confetti anywhere (an improved review still says "Up from…" and ticks success). Turn it off (`-bool false`), relaunch.
17. **VoiceOver spot checks** (Settings → Accessibility → VoiceOver, or the Accessibility Inspector): the runner's count reads "1 of 6 answered"; a map cell reads "Question 3, blank"; the cross-out button "Cross out option B"; a spelling well reads "b, r, blank, blank, blank"; an upload ring "Sending, 40 percent" then "Sent"; the improved review's sentence is heard once; nothing speaks per tap.
18. **Dark mode** (`xcrun simctl ui booted appearance dark`): the runner (map colours, the cross-out line), the games (the stamp, the tiles), the upload rings, the review and the sign-in screen are readable; back to light.

Not reproducible locally (say so in the PR): a passed midterm's confetti — a released, graded midterm needs a sitting on the web and a teacher's release, and timed sittings stay out of the app (covered by `CelebrationRuleTests.midterm` and `OutcomeMemoryTests.once`; the report's count-up and settle-in show on any midterm report the local database has); a ring filling slowly — localhost uploads finish at once (a device on a slow network, or the Network Link Conditioner, shows it).

Record a 60-second walk-through of items 1–4, 8 and 10 in the background: `xcrun simctl io booted recordVideo --codec h264 /tmp/phase4.mp4` (Ctrl-C to stop).

- [ ] **Step 4: Nothing unexpected in the tree, every commit by Viltrumlik**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git status --short                                   # empty
git log --format='%an <%ae> %s' origin/main..HEAD | grep -v "Viltrumlik <viltrumlik@gmail.com>" || echo "all Viltrumlik"
```

- [ ] **Step 5: Push and open the PR (merge after #308)**

```bash
cd /Users/macbook/Projects/dsat-wt-ios-redesign
git push origin HEAD:refs/heads/feat/ios-redesign-phase4
gh pr create --base main --head feat/ios-redesign-phase4 \
  --title "iOS redesign — phase 4: focus zones (merge after #308)" --body-file /tmp/pr-phase4.md
```
`/tmp/pr-phase4.md` says: **stacked on #308 (itself on #305 and #304) — merge those first; until then this diff includes phases 1–3**; what changed (the focus-zone motion kit and its rules; the runner: turns, fills, the drawn cross-out, the flag, "Saved", the rolling count, the map — and no right/wrong while answering; flashcards: the 250 ms flip and the swipe; test, matching, speed; the games' end screen; the homework upload's thumbnails and real per-file rings; the review and the midterm report; sign-in; outcomes celebrated once, only when passed or improved; the hand-offs: covers without the bar's room, the hand-in baseline, boxed frames, the word game's unsaved round); what did not (no backend change — the kit only reads `assignment_id` the review already sent, and reports a request's sent bytes; Explore, Me and the app-wide polish are phase 5); the Step 3 checklist with results, including what could not be seen locally; and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: iOS 17 / 18**

Run `xcrun simctl list runtimes | grep -E "iOS 1[78]"`. If a runtime is there, create a device on it, install, and repeat items 1, 3, 8 and 14 (`symbolEffect`, `keyframeAnimator` and `sensoryFeedback` are iOS 17 APIs; the turn is a plain transition); note the results in the PR. If none is installed, write under "Not verified" that the iOS 17/18 paths are unchecked and leave the ~8 GB runtime download to the owner.

- [ ] **Step 7: Send the owner the demo**

Send the screenshots and `/tmp/phase4.mp4` (SendUserFile), one line per item to look at. Merge only after the owner's "ha", and after #304, #305 and #308.

## Phase 5 — Explore + Me + polish

Branch `feat/ios-redesign-phase5` in the worktree `/Users/macbook/Projects/DSAT-mock-exam/.claude/worktrees/cranky-tesla-4352b7`, cut from `main` at `95fc244e` (phases 1–4 merged on 2026-10-22). One PR into `main`. This is the last phase of the redesign.

**What the student gets:** Explore stops being four signposts. The Roadmap card names the student's level and the next lesson, Services names their next support hour or the next free one, Events names their ticket or the next event they can join, and Surveys says how many are waiting and what finishing them earns. The Me sheet becomes one short page, as the approved design lists it: who they are, their goal and SAT date, My progress, midterms and certificates, notifications, account and sign out. An empty list now looks empty, and a failure looks like a failure. "All caught up", "Nothing to do", "No words yet", "You're offline" and "Didn't load" each get their own small animation, which plays once and settles. Pages that are loading show the shape of what is coming instead of a spinner. Last comes the audit, which the student never sees as a feature, only as an app that works for them: text grows with the phone's text size, VoiceOver names and announces everything, Reduce Motion is respected everywhere, dark mode has no white-on-white, an iPhone SE fits, and no screen loops more than two animations. Every finding phases 1–4 deliberately carried here is either fixed or listed under "Not done, and why" in the outcome.

**Checked while this plan was written (2026-10-22).** At `95fc244e` the kit passes 786 tests and the app builds (`** BUILD SUCCEEDED **`, 134 warnings, all existing). Three read-only sweeps of the tree produced the facts the tasks below lean on: which data each Explore card can truthfully show, every loading/empty/error state and spinner, and where every carried finding now sits in the code (file:line in the tasks, valid at `95fc244e`).

**How the steps are written — different from phases 1–4.** Phases 1–4 wrote every line of code into the plan. Most of phase 5 is an audit across about 90 files, where the right edit is found by reading the file, so the code is not written here. Each task gives the files, the interfaces, the rules, the kit test cases by name and behaviour, and a checklist of observable results; the implementer writes the code and the reviewer checks the result against the list. Kit tasks are written test-first. Every app task ends with the build check of phase 2, with this worktree's path:

```bash
cd /Users/macbook/Projects/DSAT-mock-exam/.claude/worktrees/cranky-tesla-4352b7/ios/MasterSAT && xcodegen generate
xcodebuild -project MasterSAT.xcodeproj -scheme MasterSAT \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build/dd build > /tmp/ms-build.log 2>&1; echo "exit=$?"
grep -E "error:|BUILD (SUCCEEDED|FAILED)" /tmp/ms-build.log | sort -u | head -20
```

It passes only with `exit=0` and `** BUILD SUCCEEDED **`, and no new warnings in the files the task touched. The kit check is `cd …/ios/MasterSATKit && swift test 2>&1 | tail -3`; it passes only on "Test run with N tests … passed", where N never drops.

### Decisions taken where the design left room

- **The Me sheet is one page, as the approved design lists it** (owner's question 1, see "Owner answers" below). Out: the four figures (XP, strikes, points, homework — the Rewards tab and Today), Homework to do (Today), and the Classes tab (Class tab: chips, People, Telegram). Kept: the hero, Your goal (target, test day, latest results), My progress, a new Midterms & certificates panel, Notifications, the account rows, Finish your profile (only while something is missing), Payments "coming soon" (the owner asked for it), and Sign out. The Me-sheet homework card's wrong count (`ProfileHomework.isTurnedIn` vs `HomeworkProgress.isDone`, phase 2 carry) goes with the card.
- **Surveys pay points, not coins.** The outline said "coins". The server's survey reward is `points_award` (`SurveyBrief.pointsAward`), and coins are bought with points, so the card says "points".
- **Services shows the student's next booked hour, otherwise the next free one, and the next SAT date.** The SAT checklist (`SatChecklistSheet`) keeps no record of progress — its one tick resets every time the sheet opens — so any "3 of 6" would be invented (owner's question 2, see "Owner answers").
- **The Explore cards read on every visit, side by side, detached** (Roadmap 1 request, Services 3, Events 1, Surveys 1). Each card fails on its own. Until a card's first answer arrives, and whenever its read fails with nothing earlier to show, it keeps its fixed one-line description. That line describes the card and never says "nothing", so a failure is never drawn as empty. The page each card opens says what failed. Badges: Events counts what can be signed up for now; Surveys counts what is waiting. Zero shows no badge, as before.
- **Empty and error art are five new one-shot Lottie files** (`all-done`, `no-tasks`, `no-words`, `offline`, `error`). Each plays about 1.2 s and settles on its finished picture, and none loops, so no screen gains a looping animation. Under Reduce Motion the finished picture is shown, still. **At most one state animation per screen**: page-level states get the art, and section-level states inside a page use the compact form without art.
- **Error stays distinct from empty.** An `ErrorState` always says what did not load, that nothing is lost, and offers "Try again". An `EmptyState` never offers a retry. While the phone is offline, a failure shows the offline art and "You're offline" instead of the generic error (the banner at the top already says so). A refresh that fails over good data keeps the data and says so in one line ("Couldn't refresh — showing what last loaded"), as Roadmap and the class page already do.
- **`LoadingSkeleton` breathes, but only outside the focus zones.** It shows grey blocks shaped like what is coming, with opacity easing 1 → 0.55 over 1.1 s, repeating. That is level-3 motion, a pulse with no movement, and static under Reduce Motion. The focus zones (runner, word games) keep their quiet spinner, which never moves anything. One component replaces the five existing skeletons.
- **Text size: every fixed `.font(.system(size:))` scales.** There are 1,074 of them in 94 files, and no scaled font exists in the app today. `appFont(_:weight:design:)` keeps today's size at the default text size, so nothing changes for a student who never touched the setting, and it grows with Dynamic Type. Chrome that cannot grow without covering content — the floating tab bar, the header's chips and pill, the bell — is capped at `.xxxLarge` and shows the Large Content Viewer on a long press, as the system tab bar does. Pages grow to the largest accessibility size, and rows that cannot fit side by side stack.
- **Haptics follow the student's hand, not the code.** A chip, tab or segment buzzes when the student picks it, never when the app sets it (Today's "See all", a reload re-resolving a chip, a deep link).
- **The things that are not phase-5 work stay out**, listed in the outcome: performance items from phase 2, the matching game's accuracy figure, and the strike-shop coin burst (owner's call), plus anything that needs a server change.

### Owner answers

1. **Me sheet — B, plus navigation and a theme** (owner, 2026-10-23, verbatim: "B qiling. ammo navigationni yaxshilang. shuningdek theme yo'q ekan shuni ham hal qiling" — "Do B. But improve the navigation. Also, there is no theme — fix that too.").
   - The answer came after Task 48 had been built as A on a ledgered ruling (the question was open for a day).
   - **Task 57** rebuilds the sheet as B: the website's three tabs and their content, plus Midterms & certificates, the Notifications row, the 44-pt close button, value routes, and a homework count on `HomeworkProgress.isDone`. It also improves the sheet's navigation: pinned tabs, the last tab remembered, back to the same tab and scroll position.
   - **Task 58** adds the theme as an Appearance setting (System / Light / Dark), applied app-wide and remembered per device.
   - The Decisions bullet above that describes the one-page sheet is superseded by these two tasks.
2. Services card: *(not asked — one question at a time while question 1 was open; the recommended "next SAT date" is built, and the PR puts the question to the owner with the tickable-checklist alternative)*.

### Earlier phases' hand-off → tasks

| Carried into phase 5 | Where |
|---|---|
| P1: inherited `contentMargins` in nested horizontal scrollers and sheets | Task 55 |
| P1: tab-bar VoiceOver semantics + Dynamic Type | Task 53 (VoiceOver), Task 54 (text size) |
| P1: Me close button 32 pt; Me panels push with `NavigationLink { }` | Task 48 |
| P1: Explore lost the Events/Surveys badges; `ProfileModel` still fetches the counts; dead `EventsOpenCard` | Task 47 |
| P1: hand-rolled cards with the old hairline / radius 16 | Task 55 |
| P1: `PillTabs` haptic fires on programmatic changes | Task 53 |
| P1: `RewardsPointsPill.swift` holds only the explainers | Task 48 (the explainers' only users, the four figures, leave the Me sheet; the file is deleted) |
| P1 kit polish: `AppTab.allCases` order, confetti tests, every Lottie file loads, the 15 000-byte budget, rename `gravity` | Task 44 (the budget is already enforced by the generator, lines 152–159) |
| P2: ~15 pages on a plain `.refreshable` | Task 49 (16 found) |
| P2: `HomeworkDetailView:105` and `ClassView.load()` read a cancelled first load as a failure | Task 49 |
| P2: the Me sheet's homework card ignores `isClasswork` and `isDone` | Task 48 (the card leaves) |
| P2: Today's fixed 2-h lesson window on Tashkent time vs Class on `room.lessonHours` and the phone calendar; `DueLabel` on the phone calendar | Task 43 |
| P2: accessibility pass (`PillTabs` trait, `LessonsUnavailableRow` icon, 12-pt "Try again", the ring while loading, result rows, Class segment titles and the header at large sizes) | Task 53, Task 54 |
| P2: polish ("on our end" copy, `dismissNudge` and Reduce Motion, stale rows after a failed refresh, the first-run fresh result, the rankings subtitle under All, "In class" drops the date) | Task 46 (copy), Task 49 (stale notice, rankings, "In class"), Task 55 (`dismissNudge`); the first-run fresh result → Task 43 |
| P2: `RoadmapView:136` pushes `ClassesListView`; fold `.classes` and delete `ClassesListView` | Task 49 |
| P2 later/perf: `ClassSourceState` has no test; the three identical `load*` in `ClassSectionsModel`; its refresh stamp set at load start | Task 44 (`ClassSourceState` to the kit), Task 49 (the loads, the stamp); the rest → outcome "Not done" |
| P3: the hub's own load not gated by `whenQuiet`; `whenQuiet` not re-asked; `dismissRankUp` replay | Task 50 |
| P3: VoiceOver (rank-up focus, dimmed search results, coins card focus, `.low` rank line, `VocabEmptySetRow` contrast) | Task 53 |
| P3: Rewards list (duplicate `loadSection`, `loadHero` ordering, shared XP-MONTH/Strikes slot, Points unreachable on failure, own row on Strikes, hero height, nameless "pass Student", silent failed pull, stale "couldn't confirm"), `heroBoard` to the kit | Task 50; `heroBoard` → Task 44 |
| P3: Words hero above search results; `isDone` and an empty word set | Task 50; Task 43 |
| P3: replayed all-done has no hero bounce; burst rest frames hand-synced | Task 50; Task 45 (a `rest` marker written by the generator) |
| P3 tests/docs: `historyWindow` drift, `AwayCheck.remember()` table to the kit, three missing tests, doc nits | Task 44 |
| P4 runner/test, flashcards, spelling, games | Task 51 |
| P4 upload, outcomes, sign-in; P4 device observations | Task 52 (homework page, review, sign-in), Task 43 (the retry rows' data), Task 55 (status-bar material) |
| P4 motion: `Stagger` / `ZoomDestination` branch on Reduce Motion; sheets inherit the bar margin; `OfflineOverlay`'s dead `Group` | Task 55; `OfflineOverlay` → Task 46 |
| P4 `noteSeen` / `wholePercent` to the kit, called from the board and homework loads | Task 44 |
| Owner: iOS 17/18 runtimes, paid Apple account | Task 56 Step 7 (still the owner's) |

### File structure (phase 5)

Kit (`ios/MasterSATKit/Sources/MasterSATKit/`):
- `Explore/ExploreDigest.swift` — **new.** `ExploreLine`, `ExploreDigest.roadmap/services/events/surveys`.
- `Learn/RoadmapRules.swift` — `nextLesson(in:)`.
- `Today/WorkItem.swift`, `Today/TodayPlan.swift` — empty word sets; per-class lesson length.
- `Profile/ProfileRules.swift` — `ProfileHomework.summarise` and its wording deleted with the Me card (and their tests).
- `Rewards/` — `LeaderboardQuery.heroBoard`; `Motion/CelebrationRule.swift` — `OutcomeMemory.noteSeen(in:)`, `ScoreText.wholePercent` → kit; `Rewards/LastSeenRule.swift` — **new**, `AwayCheck.remember()`'s table; `Classroom/ClassSourceState.swift` — **new** (moved).
- `Motion/Confetti.swift` — `gravity` renamed.

Kit tests: `ExploreDigestTests.swift`, `LottieFilesTests.swift`, `LastSeenRuleTests.swift`, `ClassSourceStateTests.swift` — **new**; additions to `TodayPlanTests`, `LinkPlacementTests`, `ConfettiTests`, `CelebrationQueueTests`, `CelebrationRuleTests`, `LeaderboardTests`.

App (`ios/MasterSAT/`):
- `Resources/Lottie/{all-done,no-tasks,no-words,offline,error}.json` — **new**, generated; `ios/tools/lottie/make-lottie.mjs` — the five, `rest` markers.
- `Sources/Support/StateViews.swift` — **new.** `StateArt`, `EmptyState`, `ErrorState`, `LoadingSkeleton`.
- `Sources/Support/AppFont.swift` — **new.** `appFont`.
- `Sources/Support/Motion/LottieClip.swift` — `.settle`, the `rest` marker, the Low Power loop rule.
- `Sources/Screens/Shell/ExploreView.swift`, `ExploreModel.swift` (**new**), `HubCard.swift`.
- `Sources/Screens/ProfileView.swift`, `Screens/Profile/*` — the one-page Me sheet; `ProfileClassesTab.swift`, `Rewards/RewardsPointsPill.swift` — **deleted**; `Profile/MeMidtermsPanel.swift` — **new**.
- `Sources/Screens/Classroom/ClassesListView.swift` — **deleted**; `ClassroomShared.swift` — **new** (`JoinClassSheet`, `Avatar`, `ClassroomErrorState`).
- `Sources/Screens/Community/CommunityHome.swift` — `CommunityCounts`, `EventsOpenCard` deleted.
- Audit edits across `Sources/Screens/**` and `Sources/Support/**`.

---

### Task 42: Explore's live lines in the kit (`ExploreLine`, `ExploreDigest`, `RoadmapRules.nextLesson`)

**Files:**
- Create: `ios/MasterSATKit/Sources/MasterSATKit/Explore/ExploreDigest.swift`
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Learn/RoadmapRules.swift`
- Test: `ios/MasterSATKit/Tests/MasterSATKitTests/ExploreDigestTests.swift`

**Interfaces:**
- Consumes (all existing): `RoadmapResponse`/`RoadmapTrack`/`RoadmapLesson`/`RoadmapLessonState` (`Learn/Roadmap.swift`), `SupportCalendar`/`SupportHour.State`/`SupportAllowance`/`SupportBooking` (`Services/SupportModels.swift`), `SupportSchedule.nextHourSummary(in:now:)`, `ServicesTime.hourLabel(_:now:)`, `ServicesExamDates.earliest(_:)`/`label(for:now:)`, `LearningEvent` (`holdsSeat`, `myRegistration?.ticketCode`, `canSignUp`, `seatsLeft`, `startDate`, `isCancelled`), `EventRules.openForSignUp(_:)`, `SurveyBrief.pointsAward`.
- Produces:
  - `public struct ExploreLine: Equatable, Sendable { public let text: String; public let detail: String?; public let badge: Int? }`. `badge` is nil or > 0; `detail` is a second line or nil.
  - `public enum RoadmapNextLesson: Equatable, Sendable { case open(RoadmapLesson); case upcoming(RoadmapLesson); case levelDone(nextLevel: String?) }` and `RoadmapRules.nextLesson(in track: RoadmapTrack) -> RoadmapNextLesson?` (nil when the track has no own level).
  - `public enum ExploreDigest` with:
    - `static func roadmap(_: RoadmapResponse, when: (Date) -> String) -> ExploreLine`
    - `static func services(bookings: [SupportBooking]?, calendar: SupportCalendar?, examDates: [ExamDateOption]?, now: Date) -> ExploreLine?` (nil only when all three are nil)
    - `static func events(_: [LearningEvent], now: Date, when: (Date) -> String) -> ExploreLine`
    - `static func surveys(_: [SurveyBrief]) -> ExploreLine`

Dates that the app formats on the phone's clock (an event's time, a lesson's day) come in through `when`, so the wording is tested here and the formatting stays in the app's `CommunityFormat`. Support hours are on Tashkent's clock (`ServicesTime`), as the booking page shows them.

**Rules (copy is final; tests pin it):**
- **Roadmap.** Take the tracks that have an own level, at most two, in server order (Math first).
  - No tracks: `"Join a class to start your roadmap"`, with no detail.
  - Tracks exist but none has an own level: `"Your level opens when your class starts"`.
  - Otherwise `text` is the tracks joined by `"  ·  "`, each written `"<Subject> · <ownLevelLabel> · <completed> of <total>"`. Use `"<Subject> · <ownLevelLabel>"` when `totalLessons` is 0 or nil.
  - `detail` comes from the first track's `nextLesson`:
    - `.open` → `"Open now: <title>"`
    - `.upcoming` with a scheduled date → `"Next: <title> · <when(date)>"`, without one → `"Next: <title>"`
    - `.levelDone(next)` → `"Level done — next: <next>"`, or `"Top level — every lesson done"` when `next` is nil.
- **`nextLesson(in:)`.** On the own level: the first lesson whose `state == .available`, otherwise the first `.upcoming`, otherwise `.levelDone(nextLevelLabel)`. A midterm lesson counts like any lesson. (`RoadmapView.currentNodeID` keeps its own scroll logic — not touched here.)
- **Services.** The parts are tried in this order:
  1. The student's own next booked hour (`SupportSchedule.nextHourSummary`): `"Your next hour: <when> with <teacher>"`.
  2. Otherwise, the calendar:
     - `allowance?.isPaused == true` → `"Booking is paused until <pausedUntil as d MMM>"`, or `"Booking is paused for now"` when there is no date.
     - `allowance?.canBook == false` → `"You've booked all the hours you can for now"`.
     - No teachers → `"No support teacher on your classes yet"`.
     - Otherwise the earliest `.open` hour across every teacher and day → `"Next free hour: <ServicesTime.hourLabel>"`.
     - No open hour → `"No free hours in the next few days"`.
  3. `detail` is the earliest exam date → `"Next SAT: <ServicesExamDates.label>"`, or nil.
  - When bookings failed but the calendar answered, step 2 still runs. When only the exam dates answered, `text` falls back to `"Book an hour with a teacher"` and the date is the detail.
- **Events.** Cancelled events are ignored.
  - The first event the student holds a seat on: `text` = `"Your ticket: <title>"`, `detail` = `"<when(start)> · Ticket <code>"`, or `"<when(start)>"` when the code is empty.
  - Else the first event with `canSignUp`: `text` = `"<title>"`, `detail` = `"<when(start)> · <n> seats left"`, or just `"<when(start)>"` when `seatsLeft` is nil.
  - Else the first event: `"<title>"`, with `detail` `"<when(start)>"`.
  - None: `"Nothing coming up right now"`, with no detail.
  - `badge` = `EventRules.openForSignUp`, or nil when it is 0.
  - Server order is soonest first and is kept.
- **Surveys.**
  - None: `"Nothing waiting for you"`, with no badge.
  - n waiting: `"1 survey waiting"` / `"<n> surveys waiting"`.
  - `detail`: `"Finishing it earns you <p> points"` (n = 1) or `"Finishing them earns you <p> points"`, where p is the sum of `pointsAward`; nil when p is 0.
  - `badge` = n.

- [ ] **Step 1: Write the failing tests.** Create `ExploreDigestTests.swift`. Build models by decoding minimal JSON through `JSONCoding.decoder`, copying the shapes the existing tests already use (`RoadmapTests.swift`, `SupportScheduleTests.swift` / `SupportModelsTests.swift`, `EventsTests.swift`, `SurveysTests.swift` — read them first). Tests, one `@Test` each:
  - `roadmapNoTracks`, `roadmapNoOwnLevel`, `roadmapOneTrackOpenLesson`, `roadmapUpcomingWithDate`, `roadmapUpcomingNoDate`, `roadmapLevelDoneNext`, `roadmapTopLevel`, `roadmapTwoTracksJoined`, `roadmapZeroTotalOmitsCount`.
  - `nextLessonPrefersAvailableOverUpcoming`, `nextLessonNilWithoutOwnLevel`.
  - `servicesBookedHourWins`, `servicesPaused`, `servicesPausedNoDate`, `servicesAtLimit`, `servicesNoTeachers`, `servicesEarliestOpenAcrossTeachers`, `servicesNoOpenHours`, `servicesExamDateDetail`, `servicesOnlyExamDates`, `servicesAllNilIsNil`, `servicesBookingsFailedCalendarAnswers`.
  - `eventsTicketWithCode`, `eventsTicketWithoutCode`, `eventsOpenWithSeats`, `eventsOpenNoSeatCount`, `eventsOnlyFull`, `eventsCancelledIgnored`, `eventsNone`, `eventsBadgeZeroIsNil`.
  - `surveysNone`, `surveysOneWithPoints`, `surveysManySummed`, `surveysZeroPointsNoDetail`.
  - Inject a fixed `now` and a `when` closure that returns e.g. `"WHEN"`. Pin Tashkent where a support hour is formatted.
- [ ] **Step 2: Run** `swift test --filter ExploreDigestTests` and confirm it fails to compile (the types do not exist).
- [ ] **Step 3: Implement** `ExploreDigest.swift` and `RoadmapRules.nextLesson(in:)` to the rules above, with doc comments in the kit's style: why, not what.
- [ ] **Step 4: Run the whole kit**; it must pass with 786 + the new tests.
- [ ] **Step 5: Commit** `feat(ios-kit): Explore's live lines — roadmap, services, events, surveys`.

---

### Task 43: Homework truth and one clock in the kit (empty word sets, the retry row, per-class lesson length, Tashkent everywhere)

**Files:**
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Today/WorkItem.swift` (`HomeworkProgress.isDone`)
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Today/TodayPlan.swift` (`todaysLessons` takes each class's lesson length; the first-run fresh result)
- Modify: `ios/MasterSATKit/Sources/MasterSATKit/Profile/ProfileRules.swift` (only if Task 48 removes the homework card: delete `ProfileHomework.summarise`, `Summary`, `rowDetail`, `ProfileWording.homeworkValue/Detail/Empty`, and their tests; keep `isTurnedIn` and `dueLabel`, which other code uses)
- Modify: app `Screens/Today/TodayView.swift` (pass the lesson lengths), `Screens/Class/ClassView.swift` (`ProfileLessons.next/label` on `ServicesTime.calendar`), `Support/PageChrome.swift` (`DueLabel` on `ServicesTime.calendar`)
- Test: `TodayPlanTests.swift` (additions), `ProfileRulesTests` (deletions, if the card goes)

**Rules:**
- **Empty word sets are never owed** (the phase-3 rule for Words, now on Today and Class too):
  - `isDone` ignores a `vocabHomeworks` entry whose `wordCount == 0`, exactly as `VocabHomeworkGroup.isComplete` does.
  - A homework whose ONLY pieces are empty word sets, with nothing to upload and no paper content, is done: nothing is there to do. If the teacher later fills a set, its `wordCount` is no longer 0 and the homework is owed again.
- **The retry row.** Investigate first. Read `AssessmentHomeworkLink.progress` (`AssessmentProgress`), `AssignmentListing.workflowStatus` and `backend/classes/` `my-assignments` serialisation (read only) for any sign that an earlier attempt was already graded while a newer one is in progress.
  - **If the payload carries such a sign:** the row is not owed for XP. No "up to +N XP" on it, because the server pays from the first graded attempt; the row reads "Retry · <n> answered" instead of "Continue"; Class → Results shows "Retry in progress" instead of "No results yet".
  - **If it carries none:** change nothing, and write one paragraph in the commit body and in the outcome's "Not done" list ("needs a server field"). No backend change in this phase.
- **One lesson length.**
  - `TodayPlan.todaysLessons` takes `lessonHours: [Int: Int]` (classroom id → hours) and uses `ProfileLessons.next`'s rule: `max(0.5, hours) ?? 2`. A lesson of a class with no length still gets 2 h.
  - `TodayView` builds the map from the classes it already loads, or loads `/classes/` once if it has none.
  - Test: a 3-h class's lesson started 2.5 h ago is still on Today.
- **One clock.**
  - Class cards' next lesson (`ProfileLessons.next/label`) and `DueLabel` use `ServicesTime.calendar` (Tashkent), as Today does. A student whose phone is set to another time zone then sees one time for the same lesson everywhere.
  - Test: `ProfileLessons.label` with a Tashkent calendar and a phone-zone date crossing midnight.
- **The first-run fresh result.** The first time Today ever loads for a student (no `today.seenResults.<id>` key yet), every result released before that load is marked seen without a card. Only results released later surface as "fresh". Put the rule in `TodayPlan.freshResult(_:seen:firstRun:)` with a test.

- [ ] Write the failing tests:
  - `emptyWordSetNeverOwed`, `onlyEmptyWordSetsIsDone`, `filledSetOwedAgain`
  - `lessonLengthPerClass`, `classWithoutLengthGetsTwoHours`
  - `labelOnTashkentClock`
  - `firstRunMarksEverythingSeen`
  - the retry tests, only if the investigation found a signal.
- [ ] Implement them; the kit passes.
- [ ] Make the app call sites pass the map and the calendar; run the build check.
- [ ] Commit `fix(ios): empty word sets are never owed; one lesson length and one clock everywhere`.

---

### Task 44: Logic moved into the kit, and the test debt paid

**Files:** kit `Rewards/Leaderboard*.swift` (`LeaderboardQuery.heroBoard`), `Motion/CelebrationRule.swift` (`OutcomeMemory.noteSeen(in:userID:)` moved from `AssessmentReviewView.swift:704`; `ScoreText.wholePercent` moved from `AssessmentReviewView.swift:690` — find where `ScoreText` lives in the kit and add it there), `Rewards/LastSeenRule.swift` (**new**), `Classroom/ClassSourceState.swift` (**new**, moved from app `Screens/Class/ClassTasksSegment.swift:10`), `Motion/Confetti.swift`; app callers (`RewardsTabCards.swift:12`, `AwayCheck.swift`, `AssessmentReviewView.swift`, `ClassView.swift`, `ClassTasksSegment.swift`, the board and homework loads). Tests: `LeaderboardTests`, `CelebrationRuleTests`, `LastSeenRuleTests` (**new**), `ClassSourceStateTests` (**new**), `LinkPlacementTests`, `ConfettiTests`, `CelebrationQueueTests`, `LottieFilesTests` (**new**).

**Rules:**
- **Moves keep behaviour exactly.** Each move is: a test pinning today's behaviour first, then the move, then the app calling the kit.
  - `heroBoard` stays `LeaderboardQuery(limit: 200)`.
  - `wholePercent` rounds half to even, as today.
- **`noteSeen` is called from the board and homework loads too** (the phase-4 note: "lists note what they carry"). Today it runs from one place. After the move, `AssessmentsListView`'s board load and `HomeworkDetailView`'s load call it with what they fetched, so an attempt first seen on those pages still counts as "the attempt before".
- **The hero's percent uses `wholePercent`.** Phase 4 noted that the review hero rounds half away from zero while "Up from" rounds half to even, so they disagree at x.5. After this change both say the same.
- **`LastSeenRule`** is the decision table `AwayCheck.remember()` applies today (read `AwayCheck.swift:117`), as a pure function of what the header shows, what is held and what is in flight. `AwayCheck.remember` calls it. Fix the AwayCheck header comment and `Outcome.read`'s doc nits while there.
- **Missing tests** (phase 3/1 lists):
  - `CelebrationQueue`: a decrease that arrives before the resolve.
  - `LastSeen`: a nil round-trip.
  - The merged away + task label.
  - `historyWindow` drift: the kit's 50 against the backend's constant. Read the backend file through `#filePath`; skip with a clear message if the file is not there.
  - `AppTab.allCases` order: `[.today, .classes, .words, .rewards, .explore]`.
  - Confetti: a different seed gives a different burst; combined budgets (Low Power and Reduce Motion together); counts of 0 and 1.
- **Rename** `ConfettiBurst.gravity` to `halfGravity`, because it is the t² coefficient (g/2). Update its doc comment.
- **`LottieFilesTests`.** Through `#filePath`, read every `ios/MasterSAT/Resources/Lottie/*.json`. Each must:
  - parse as JSON with `v`, `fr`, `ip`, `op`, `w`, `h` and a non-empty `layers`;
  - be at most 15 000 bytes;
  - after Task 45, carry a `markers` entry named `rest` (write this assertion now, as `withKnownIssue` until Task 45 lands — or land this test in Task 45; the implementer picks one and says so).
- [ ] Tests first, then the moves; kit and app both pass. Commit `refactor(ios): logic the app owned moves into the kit, with the tests phases 1–3 owed`.

---

### Task 45: Five empty/error animations, a `rest` marker, and the state components

**Files:**
- Modify: `ios/tools/lottie/make-lottie.mjs`; generated `ios/MasterSAT/Resources/Lottie/{all-done,no-tasks,no-words,offline,error}.json` (**new**) plus the five existing files regenerated (markers only)
- Modify: `ios/MasterSAT/Sources/Support/Motion/LottieClip.swift`
- Create: `ios/MasterSAT/Sources/Support/StateViews.swift`
- Modify (thin wrappers, call sites unchanged): `Support/PageChrome.swift` (`RetryNotice`, `DashedEmpty` untouched), `Screens/Classroom/ClassesListView.swift` (`ClassroomErrorState`), `Screens/Rewards/RewardsComponents.swift` (`RewardsErrorState`), `Screens/Vocabulary/VocabComponents.swift` (`VocabErrorNotice`, `VocabEmptyState`), `Screens/Roadmap/LearnMoreSupport.swift` (`LearnMoreErrorCard`, `LearnMoreEmptyCard`, `LearnMoreSkeleton`), `Screens/Community/CommunityChrome.swift` (`CommunityErrorNotice`, `CommunitySkeletonRows`), `Screens/Assessments/AssessmentBoardViews.swift` (`AssessmentLoadError`), `Screens/Services/ServicesComponents.swift` (`ServicesNotice`), `Screens/Profile/ProfileComponents.swift` (`ProfilePlaceholderRows`)

**The animations.** All five use the generator's helpers (`anim`, `L`, `gr`, `el`, `rc`, `P`, `st`, `fl`, `tm`, `A`, the easings), at 200×200 and 60 fps. Each is one-shot, 70–90 frames, and settles: its last frame is its finished picture, and nothing loops. Each stays under 15 000 bytes and uses brand colours only: `#2a68c0` accent, `#f59e0b` amber for words, `#059669` success, `#d97706` warning; neutral grey `#94a3b8` for outlines. Nothing is red; an error is not a danger.
- `all-done`: a ring draws round (trim 0→100), a check strokes in, and three small sparkles pop and settle, in success green. It is calmer than `task-complete`, which is a celebration.
- `no-tasks`: a tray drops in with a soft landing (no overshoot past 4 %), and two paper lines draw inside it in grey and accent.
- `no-words`: a word card turns from the back to the face, a quarter-turn ease-out, with "Aa"-like strokes drawn in amber. Draw the strokes; there are no font glyphs.
- `offline`: a cloud outline draws, then a short slash strokes across it, in grey and warning amber.
- `error`: a rounded square draws, then an exclamation's bar and dot pop in, in warning amber.
- **`rest` markers.** Every asset, old and new, gets `markers: [{ tm: <frame>, cm: "rest", dr: 0 }]`.
  - The five new ones and flame/check/trophy: the last frame.
  - `coin-burst`: frame 54.6. `star-burst`: frame 56 — the frames `restProgress` hard-codes today.
  - The generator computes each burst's rest frame from the same constants its keyframes use, so a changed keyframe moves its marker with it.
  - The generator's budget check stays and covers the new files.

**`LottieClip`.**
- `LottieAsset` gains `.allDone`, `.noTasks`, `.noWords`, `.offline`, `.error`, none of which loops by default.
- The paused picture comes from the `rest` marker (`.paused(at: .marker("rest"))`), and `restProgress` is deleted.
- A new `Playback.settle` plays once and holds the last frame. Under Reduce Motion it shows the `rest` picture, still. This differs from `.once`, which shows nothing under Reduce Motion because bursts end blank.
- In Low Power Mode a `.loop` rests on its `rest` picture, through `MotionBudget.allowsLoopingLottie`, which exists in the kit and is unused today. This keeps the "≤ 2 looping per screen" rule cheap.

**`StateViews.swift`.**
- **`StateArt(_ asset: LottieAsset, size: CGFloat = 96)`**: `LottieClip(asset, playback: .settle)`, framed and hidden from VoiceOver.
- **`EmptyState`**
  - Signature: `EmptyState(art: LottieAsset? = nil, title: String, message: String? = nil, action: (title: String, run: @MainActor () -> Void)? = nil)`.
  - Layout: centred, art on top when given, the title in 16-pt heavy, the message in 13-pt secondary, and a soft accent button.
  - VoiceOver reads the title and message as one element, with the button separate.
  - It never offers a retry.
- **`ErrorState`**
  - Signature: `ErrorState(title: String, message: String = "Nothing is lost — try again in a moment.", style: .page | .inline = .page, retry: @MainActor () async -> Void)`.
  - `.page` shows the `.error` art. While `session.connectivity.isOnline == false` it shows the `.offline` art and the title "You're offline", with the message "This loads again once you're back online." and the retry still offered.
  - `.inline` has no art: a small warning glyph, the text, and a "Try again" button with a 44-pt target.
  - While the retry runs, the button shows a small spinner and is disabled.
  - On appear it posts no announcement; the page's own state change is enough. It reads as one element plus the button.
- **`LoadingSkeleton`**
  - Signature: `LoadingSkeleton(rows: Int = 3, height: CGFloat = 56, style: .rows | .cards = .rows, pulse: Bool = true)`.
  - Blocks are rounded `Theme.surface2` rectangles: rows are full-width bars, cards are card-sized blocks.
  - The breathing is described under Decisions; it is static under Reduce Motion or when `pulse` is false.
  - VoiceOver hears one "Loading" element, and the blocks are hidden.
- **The existing components keep their names and init signatures** and render through these:
  - `RetryNotice`, `ClassroomErrorState`, `RewardsErrorState`, `VocabErrorNotice`, `LearnMoreErrorCard`, `CommunityErrorNotice`, `AssessmentLoadError`, `ServicesNotice` → `ErrorState`.
    - A component used for a whole page gets `.page`, one used inside a section `.inline`; decide per component from its call sites (listed in this plan's research notes in the PR).
    - `RewardsErrorState` keeps its chunky surface around the content.
  - `VocabEmptyState`, `LearnMoreEmptyCard` → `EmptyState`.
  - `ProfilePlaceholderRows`, `LearnMoreSkeleton`, `CommunitySkeletonRows` → `LoadingSkeleton`.
  - `DashedEmpty` stays as it is: the inline "nothing here" slot.
- [ ] Generate (`node ios/tools/lottie/make-lottie.mjs` from the repo root), check the sizes, and make sure the new `LottieFilesTests` (Task 44) passes in the kit.
- [ ] Look at each animation's first, middle and last frames. Render them to PNG with a 20-line Swift script using Lottie's `LottieAnimationView` + `UIGraphicsImageRenderer`, or by a temporary preview in the simulator. Put the three frames of each in the task report.
- [ ] Build check. Commit `feat(ios): five settling state animations, rest markers, and one Empty/Error/Loading vocabulary`.

---

### Task 46: The states, applied — art where a page is empty or failed, skeletons where it loads, offline said once

**Files:** `Screens/Today/TodayView.swift`, `TodayCards.swift` (`AllDoneCard`), `Screens/Class/ClassView.swift`, `ClassTasksSegment.swift`, `Screens/Vocabulary/VocabularyView.swift`, `WordsTodayCards.swift`, `Screens/AccountStateViews.swift` (`UnreachableView`), `Screens/RootView.swift` (`OfflineOverlay`), `Support/Connectivity.swift` (`OfflineBanner`), `Screens/Notifications/NotificationsInboxView.swift`, and every file in the "A" spinner list below.

**Art (page-level, at most one per screen):**
- Today:
  - `AllDoneCard` shows `StateArt(.allDone)` in place of the still check, and keeps its copy.
  - The homework-failed state (`TodayView:196`) becomes `ErrorState(.page)` with the title "Today's work didn't load".
- Class:
  - The "No classes yet" card (`ClassView:146`) → `EmptyState(art: .noTasks, …, action: "Join with a code")`.
  - Tasks → To do empty (`ClassTasksSegment:95`) → `EmptyState(art: .noTasks, title: "Nothing to do here", message: "New work from your teachers shows up here.")`.
  - Done and Results stay `DashedEmpty`: they are second segments, not the page's state.
- Words:
  - `WordsTodayCards` `.nothingYet` → `EmptyState(art: .noWords, …)`, and `.caughtUp` → art `.allDone`. Keep the copy.
  - `VocabularyView:325` ("No vocabulary homework right now") stays the compact form (a second empty on the same screen).
- Offline:
  - `UnreachableView` shows `StateArt(.offline)` above its title.
  - `OfflineBanner`:
    - The black 0.78 fill becomes the `Theme.ink` / `Theme.onInk` pair, so it stands out in dark mode too.
    - It moves in from the top as before, and fades in place under Reduce Motion.
    - It posts one VoiceOver announcement ("You're offline") when it appears, and "Back online" when it goes.
  - `OfflineOverlay`'s `Group { if }` + `.animation(value:)` becomes a stable `ZStack(alignment: .top)` with a full-width frame and the banner's transition inside it (the phase-4 `Group` rule).
- Errors: `NotificationsInboxView:159`'s failure `ContentUnavailableView` → `ErrorState(.page)`.
- Copy: every "on our end" goes (`VocabErrorNotice`'s default message and any other `grep -rn "on our end"`). A failure says what did not load, never whose fault it is.

**Skeletons — the "A" spinners from the research sweep → `LoadingSkeleton`** (rows/cards shaped like the content that replaces them):
- `AccountDetailsView:34`, `AccountDevicesView:49`, `AccountSignInView:35`
- `AssessmentBoardViews:167`, `AssessmentReviewView:124`
- `ClassTasksSegment:83`, `ClassView:136`
- `ClassroomDetailView:56`, `ClassroomSections:52`, `ClassroomTelegramSheet:82`
- `HomeworkDetailView:106`, `:478`
- `MidtermReportView:50`, `MidtermsView:92`
- `LeaderboardView:485`, `PointsView:275`, `:309`, `RewardsTabCards:338`
- `LearnMoreSupport:226`
- `SupportBookingView:153`, `:241`, `SupportSheets:272`
- `TodayView:193`
- `VocabBrowseView:44`, `VocabSetPage:41`, `VocabularyView:435`
- Not `ClassesListView:52` (deleted in Task 49).
- **Kept as spinners:** the focus zones (`AssessmentRunnerView:61`, `:78`; `VocabStudyView:72`, `:109`; `MatchingView:64`; `SpeedView:175`), every "B" button or saving spinner, and the "C" cases (image placeholders, the app's launch, the live quiz's connect step, the certificate PDF).
- [ ] Build check.
- [ ] Simulator screenshots of Today all-done, Class To do empty, Words nothing-yet, `UnreachableView`, and one skeleton (local backend, pinned — see Task 56 Step 1). Put them in the report.
- [ ] Commit `feat(ios): empty, error and offline states with their art; skeletons instead of page spinners`.

---

### Task 47: Explore — four live cards

**Files:** Create `ios/MasterSAT/Sources/Screens/Shell/ExploreModel.swift`; modify `Screens/Shell/ExploreView.swift`, `Screens/Shell/HubCard.swift`, `Screens/Profile/ProfileModel.swift` (drop `openSurveys`, `openEvents`, `loadCounts`), `Screens/Community/CommunityHome.swift` (delete `CommunityCounts` and the dead `EventsOpenCard`; correct the file's header comment — `SurveysWaitingCard` is wired into Today).

**Rules:**
- `ExploreModel` (`@MainActor @Observable`) holds one `ProfileLoad`-style slot per source (roadmap, bookings, support calendar, exam dates, events, surveys) and four computed `ExploreLine?` from `ExploreDigest`.
  - `load(_ session:)` runs all six reads side by side, as unstructured per-request `Task`s (the phase-2 rule P2-R8), so a cancelled view task never stores a failure.
  - A failed read keeps the last good value, and a cancelled one stores nothing.
- `ExploreView`:
  - `.onAppear { Task { await model.load(session) } }`, every return to the tab (a TabView root's `.task` runs once).
  - `TabRootScroll(tab: .explore, onRefresh: { await model.load(session) })`, so a pull and `reloadIfShowing` work.
  - Event dates are formatted with `CommunityFormat.when`, and roadmap dates with `CommunityFormat.dayMonth`.
- `HubCard` gains `detail: String?`, a second line in 13-pt semibold accent-tinted text, beneath the subtitle.
  - `subtitle` becomes the live `text` when a line exists, and stays the fixed description when not.
  - The swap fades with `.contentTransition(.opacity)` and `.animation(Motion.snappy / Motion.focus under Reduce Motion, value:)` on a stable container.
  - The badge keeps its `numericText` roll.
  - VoiceOver reads the card as one button: "Events. Your ticket: Open day. Tue, 28 Oct · Ticket 4K29. 2 open for sign-up." — with the badge spoken as "<n> open for sign-up" for Events and "<n> waiting" for Surveys.
- The card a line came from opens the same page as before (`AppLink.roadmap/services/events/surveys`).
- `ProfileModel` stops fetching the counts (two requests per Me visit, read by nothing).
- [ ] Build check.
- [ ] Simulator screenshot of Explore with live lines, against seeded local data: the roadmap, a free support hour, an event with a ticket, an open survey. Seed with existing management commands only; list them in the report.
- [ ] Commit `feat(ios): Explore's cards say what is behind them — level and next lesson, next hour, ticket, surveys waiting`.

---

### Task 48: The Me sheet — one page, as designed

*(Written for owner answer 1 = A. On B: keep the three tabs, and do only the Midterms & certificates panel, the Notifications row on Overview, the 44-pt close button, value routes for every push from the sheet's root, and the homework card counting with `HomeworkProgress.isDone` and leaving classwork out.)*

**Files:** `Screens/ProfileView.swift` (rewritten body), `Screens/Profile/ProfileOverviewTab.swift` (split: the goal panel and the checklist panel stay as views; the four figures, the homework panel and `ProfileStatTile` go), `Screens/Profile/ProfileModel.swift` (loads only what the page shows), `Screens/Profile/MeMidtermsPanel.swift` (**new**), `Screens/Profile/ProfileSettingsTab.swift` (becomes the account rows, value routes), `Screens/Account/AccountComponents.swift` (`AccountMenuRow` takes a route value), `Screens/RootView.swift` (the close button moves into the page). **Delete:** `Screens/Profile/ProfileClassesTab.swift`, `Screens/Rewards/RewardsPointsPill.swift` (its explainers' only users were the four figures), and the kit's `ProfileHomework.summarise` family with its tests (Task 43).

**The page, top to bottom:**
1. **The hero.** As today: photo, "Profile · Student", name, handle, email/Telegram/phone chips, Edit profile, Copy username. The close button sits at its top-trailing corner: a 32-pt circle inside a 44×44 hit area, labelled "Close". It lives on the root only, so pushed pages keep their own back button and nothing overlaps a toolbar.
2. **Your goal.** Target score + test day (the exam-date menu) + Latest results, unchanged.
3. **My progress.** A row → `AppLink.progress`.
4. **Midterms & certificates** (`MeMidtermsPanel`, new). It reads the midterm list `MidtermsView` reads (same API).
   - It shows up to three newest midterms with a released score: title, score, "Passed" when the centre marked it, and a "Certificate" button where the listing carries a certificate code.
   - "All midterms" pushes `AppLink.midterms` on the Me stack.
   - A row opens `AppLink.midtermResult(attemptId)` on the Me stack.
   - The certificate opens `MidtermCertificateSheet` as a sheet from the Me sheet itself. A nested sheet is fine; this avoids `AppRouter`'s close-Me-then-open, which would drop the student out of Me.
   - States: `LoadingSkeleton(rows: 2)`; `ErrorState(.inline)`; empty → `DashedEmpty("No midterm results yet", hint: "Your scores and certificates show up here once they're released.")`.
5. **Settings rows:** Account (photo, name and phone), Notifications (what reaches you), Sign-in & password (with the "Confirm email" badge), Devices, About. These are value routes: `ProfileView.Route` grows `.notifications`, `.signIn`, `.devices`, `.about` beside `.accountDetails`, all declared at the sheet's root. **No `NavigationLink { }` remains in the Me sheet** — the checklist's actions push `.accountDetails` and `.signIn` too.
6. **Finish your profile.** Only while a step is missing; the "all set" panel is gone, since a finished checklist need not take space.
7. **Payments — coming soon.** As today.
8. **Sign out.** As today, with the confirmation dialog.

**`ProfileModel` after:**
- It loads `account`, `telegramSignIn`, `attempts`, `examDates`, the session's `refreshUser`, and the midterms.
- Gone: `rewards`, `homework`, `classes`, `schedule`, `people`, `groups`, `selectedClassId`, `openSurveys`, `openEvents` and every method that served them, plus `ProfileRetry`'s dead cases.
- Its load rules stay: every panel fails on its own, a refresh is detached, and a load starts on appear.

**Also:**
- The sheet's stagger entrance uses the shared `stagger`.
- The midterm rows reuse the results' row look (combined for VoiceOver).
- [ ] Build check.
- [ ] Simulator screenshots of the Me sheet top and bottom, and of a certificate opening over it.
- [ ] Commit `feat(ios): the Me sheet is one page — who you are, your goal, progress, midterms and certificates, settings`.

---

### Task 49: Navigation and refresh hygiene

**Files:** `Screens/Classroom/ClassesListView.swift` (**delete**; move `JoinClassSheet`, `Avatar`, `ClassroomErrorState` into **new** `Screens/Classroom/ClassroomShared.swift`; `ClassroomCard` goes with the list, its only user), `Screens/Shell/AppLinkPage.swift`, `Screens/Roadmap/RoadmapView.swift`, the 16 plain `.refreshable` pages, `Screens/HomeworkDetailView.swift`, `Screens/Class/ClassView.swift`, `Screens/Class/ClassSectionsModel.swift`, `Screens/Class/ClassPeopleFilesSegments.swift` / `ClassroomSections.swift` (rankings subtitle), `Screens/Shell/WorkRow.swift`.

**Rules:**
- **`AppLinkPage`'s `.classes` case** joins the "Nothing to open" case: `.classes` is a tab placement and no link pushes it.
- **Roadmap's "Go to Classes"** (`RoadmapView:136`) becomes a button calling `router.show(.classes)`. It switches to the Class tab, and Explore's stack stays where it was.
- **The 16 plain `.refreshable`s become `.detachedRefresh { … }`**:
  - `MyProgressView:47`, `RoadmapView:66`, `RoadmapReadingView:51`, `ClassroomDetailView:80`
  - `AssessmentBoardViews:132`, `SurveysListView:34`, `LiveQuizJoinView:143`, `AccountDevicesView:79`
  - `EventsView:52`, `NotificationsInboxView:91`, `MidtermsView:128`
  - `SupportBookingView:52`, `ServicesView:79`, `VocabSetPage:47`, `VocabBrowseView:50`
  - `ClassesListView:93` goes with its file.
  - Afterwards `grep -rn "\.refreshable" ios/MasterSAT/Sources` shows only `TabRootScroll.swift`'s definition.
- **A cancellation is not a failure:**
  - `HomeworkDetailView`'s first load (`:105` area) and `ClassView.load()` check `Task.isCancelled` in their `catch` and store nothing (`APIClient` wraps a cancellation as `.transport`).
  - `ClassView` reads the user id when results are read, not when the load starts (phase-4 outcomes note).
- **Stale rows say they are stale.** When Today's or Class's refresh fails over rows already shown, one line under the list reads "Couldn't refresh — showing what last loaded" in `Theme.textSecondary`. It goes on the next success.
- **`ClassSectionsModel`'s three identical `load*` methods become one**, and its refresh stamp is written on success, not at load start.
- **The rankings subtitle under All** is said once above the per-class groups, not once per class.
- **`WorkRow`'s "In class"** shows the assigned date the class page shows ("In class · Tue 21 Oct").
- [ ] Build check. Commit `fix(ios): one way to the Class tab, refreshes that never cancel themselves, and stale lists that say so`.

---

### Task 50: Rewards, Words and the celebrations — the phase-3 list

**Files:** `Screens/Rewards/RewardsHubView.swift`, `RewardsTabCards.swift`, `PointsView.swift`, `LeaderboardView.swift`, `Support/Motion/Celebrations.swift`, `Support/Motion/RankUpCard.swift`, `Screens/Vocabulary/VocabularyView.swift`, `Screens/Today/TodayView.swift` (hero bounce on a replayed all-done).

**Rules (each from the Phase 3 outcome; read it):**
- **The hub never shows a place before the header has rolled to it.**
  - The hub's own `load()` (tab open, pull, "See the board") reads the hero through `CelebrationCenter.whenQuiet`.
  - `whenQuiet` keeps one action per key (`whenQuiet(_ key: String, _:)`), so the refresher's `reloadIfShowing` and the hub's own read do not replace each other.
  - It is re-asked whenever the stage can become quiet: a resolve in `celebrate`, the Low Power release, a Reduce Motion toggle, a rank-up dismissal.
  - `dismissRankUp` never replays a rise it has already shown: compare the rise's from/to ranks.
- **Rewards hub:**
  - On the first appear `loadSection` runs once: `onAppear` and `.task(id:)` must not both read the section board.
  - `loadHero` drops an answer older than the newest one asked (a ticket, like `LatestOnly`).
  - XP-MONTH and Strikes each keep their own last board, so toggling shows the last one at once, with no spinner, while it reads again.
  - The Points link stays reachable while `/rewards/me/` fails: the coins card's failure state keeps "Points & coins".
  - Strikes gets the own-row line XP has.
  - The hero reserves the pass line's two lines, so it does not grow 12 pt when the line wraps.
  - A nameless row reads "N XP to pass the next student".
  - A failed same-query leaderboard pull shows the inline "Couldn't refresh" line.
  - Points' "couldn't confirm" line clears on the next successful read.
- **Words:** while a search query is non-empty, the "Review today" hero hides (fades, Reduce Motion: instantly), so results start at the top on a small phone with the keyboard up.
- **Today:** a replayed all-done (the double confetti held under a sheet or cover) bounces the hero too.
- [ ] Build check. Commit `fix(ios): the Rewards hub waits for the header, keeps each board, and fails visibly; Words search starts at the top`.

---

### Task 51: The focus zones — runner and word games (the phase-4 list)

**Files:** `Screens/Assessments/AssessmentRunnerView.swift`, `Screens/Vocabulary/VocabStudyView.swift`, `VocabTestView.swift`, `MatchingView.swift`, `SpeedView.swift`, `StudyShell.swift`, and the kit's spelling code (`Vocabulary/VocabGames.swift`) where `spoken()` and `fold` live.

**Rules:**
- **Runner:**
  - A tap during the question turn (≈200 ms) never lands on the arriving question: hit testing is off while the turn runs.
  - The last answer's selection tick is seen before the end screen replaces the view: the end screen waits one `Motion.focusTap` beat.
  - `flagRowHeight` is measured (`onGeometryChange`), not estimated at 24.
  - Toolbar targets are 44×44.
  - Turning Reduce Motion off after a flag gives no stray bounce: the bounce's trigger is the flag change alone.
  - The five icon-only buttons get labels (Task 53 also checks).
- **Flashcards:**
  - The 45° flicker in the flip is found and removed (likely the face switch at the wrong angle, or two faces drawn at once).
  - The drag is bounded: it follows the finger to 160 pt, then rubber-bands.
  - After a verdict, VoiceOver focus moves to the new card (`AccessibilityFocusState`), and a flip announces the side now shown.
- **Spelling:**
  - An IME's marked text never pushes the typed letters past the cap; clamp after the composition commits.
  - `spoken()` names every mark `fold` folds (one list shared by both).
  - `PlainTyping`'s lookup is cached, not rebuilt per keystroke.
- **Games:**
  - `ModeStat.value` is derived from `percent` when one exists (no duplicate).
  - Matching's "Mistakes" tile becomes "Misses" in the neutral tone (growth language — a miss is not a danger).
  - Matching's accuracy figure stays out: owner's call, in the outcome.
- **The review's filter chips** press with `FocusPress`, not the playful spring (focus zone). The turn's direction comes from an explicit order, not `Filter.allCases`' declaration order.
- [ ] Kit tests for the `spoken()`/`fold` agreement first. Build check. Commit `fix(ios): focus zones — no tap lands on the next question, a calmer flip, spelling that counts every mark`.

---

### Task 52: The homework page, the review and sign-in (the phase-4 list and device observations)

**Files:** `Screens/HomeworkDetailView.swift`, `Screens/Assessments/AssessmentReviewView.swift`, `Screens/Auth/AuthView.swift`, `AuthChrome.swift`, `Screens/Account/AccountSignInView.swift`, `Session` code (`App/MasterSATApp.swift` or wherever sign-in's `/me` follows the token).

**Rules:**
- **Upload:**
  - Delete the unreachable cancellation `catch`, and the stale hand-in rect when leaving mid-upload.
  - A 0 % ring draws no cap dot.
  - Trash is disabled while an upload runs.
  - Thumbnail decoding runs at most 3 at a time and is cancelled when its file is removed.
  - The three copies of the empty/decode block become one helper.
- **After a hand-in:**
  - The page re-reads the homework when the cover closes, so "What to do" stops saying "Continue · 1 answered" for a graded attempt.
  - The status keeps its last known value until that read lands (no 0.3-s "Not started").
  - A word homework's status comes from its word sets' state, so after three games it is not "Not started".
- **The review's pinned filter chips** stay below the navigation bar when scrolled: pin them inside the safe area, with a `.bar` material behind them.
- **Sign-in:**
  - A `/me` that answers 401 right after a successful token exchange says "You're signed in, but your account didn't load — try again", not "wrong password".
  - Switching to Register clears any pending announcement.
  - Register's alert is announced.
  - The password eye button is 44×44.
- **Me → Sign-in & password:** the email row never wraps "Emai / l" beside the "Confirmed" badge. The label keeps `fixedSize`, and the badge moves under the address when it does not fit.
- [ ] Build check. Commit `fix(ios): homework page tells the truth after a hand-in; review chips stay put; sign-in failures say what failed`.

---

### Task 53: VoiceOver — labels, traits, focus and announcements; haptics only for the student's hand

**Files:** `Support/PageChrome.swift` (`PillTabs`), `Screens/Shell/FloatingTabBar.swift`, `AppHeader.swift`, `Screens/Shell/SegmentBar.swift`, `Screens/LessonCalendar.swift`, `Screens/Assessments/AssessmentRunnerView.swift`, `Support/DesmosView.swift`, `Screens/Today/TodayCards.swift`, `Screens/Rewards/RewardsTabCards.swift`, `Support/Motion/RankUpCard.swift`, `Screens/Vocabulary/VocabularyView.swift`, `VocabComponents.swift`, `Screens/Services/ServicesComponents.swift`, `Screens/Class/ClassTasksSegment.swift`, and any row found by the sweep below.

**Rules:**
- **`PillTabs`:**
  - Each tab carries `.isSelected` when chosen, and a label that includes its count ("Done, 3").
  - The selection haptic fires only from the tap: a local `tapped` counter is the `sensoryFeedback` trigger, never the binding.
- **`FloatingTabBar`:**
  - The bar is one container with `.accessibilityAddTraits(.isTabBar)` (`.accessibilityElement(children: .contain)`).
  - The selected tab's hint is "Double-tap to go back to the top".
  - The haptic comes from the tap only, the same way: deep links, "See all" and `showFresh` stay silent.
- **`SegmentBar`:** the same tap-only haptic.
- **Icon-only buttons get labels:**
  - `LessonCalendar:163/167` ("Previous month" / "Next month")
  - `AssessmentRunnerView:196` ("Calculator"), `:207/:213` ("Smaller text" / "Larger text"), `:476` ("Previous question")
  - `DesmosView:149` ("Close calculator").
- **Today:**
  - `LessonsUnavailableRow`'s icon is hidden from VoiceOver.
  - Its "Try again" has a 44-pt target.
  - While loading, the ring is labelled "This week's homework, loading".
- **Class:** result rows read as one element: "Linear equations, 80 percent, Tue 21 Oct".
- **Rewards:**
  - The rank-up card takes VoiceOver focus when it appears and announces "You moved up to #N". The card's own text is the announcement.
  - After a convert, focus returns to the coins card.
  - The rank line's `.low` announcement priority is checked in the Accessibility Inspector, or left with a note if the simulator cannot show it.
- **Words:**
  - Dimmed search results announce "Not a match" as their value.
  - `VocabEmptySetRow`'s subtitle uses `Theme.textSecondary`, not `textLabel`, to meet the 4.5:1 contrast ratio.
- **Services:** the checklist's checkbox style exposes its state (`.isSelected` / value "ticked").
- **Sweep:**
  - `grep -n "Button {" -A3` for icon-only labels across `Screens/`, and a pass for decorative images that VoiceOver reads (an `Image(systemName:)` beside text in the same row → `.accessibilityHidden(true)`, or the row combined).
  - Fix what is found; list it in the report.
- [ ] Build check. Commit `fix(ios): VoiceOver names, selects and announces; haptics answer taps, not code`.

---

### Task 54: Dynamic Type at the largest sizes, and the iPhone SE

**Files:** Create `ios/MasterSAT/Sources/Support/AppFont.swift`; mechanical edits across `ios/MasterSAT/Sources/**`; layout edits where the device check finds breakage.

**Rules:**
- **`appFont`.** `struct ScaledFont: ViewModifier` holds `@ScaledMetric(relativeTo:) var size` (initialised from the base size) and applies `.font(.system(size: size, weight:, design:))`. `View.appFont(_ size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default)` picks the text style from the size:
  - ≥ 28 → `.title`
  - ≥ 22 → `.title2`
  - ≥ 20 → `.title3`
  - ≥ 17 → `.body`
  - ≥ 15 → `.subheadline`
  - ≥ 13 → `.footnote`
  - ≥ 12 → `.caption`
  - else `.caption2`
  At the default text size it returns exactly `size`.
- **The conversion is mechanical**, by a script kept in the PR description, not committed:
  - `.font(.system(size: N))`, `.font(.system(size: N, weight: .W))`, `.font(.system(size: N, design: .D))` and `.font(.system(size: N, weight: .W, design: .D))` → `.appFont(N, …)`.
  - The same with a trailing `.monospacedDigit()` inside the `.font(…)` → `.appFont(N, …).monospacedDigit()` (the View modifier).
  - A line the compiler rejects (a `Text + Text` concatenation needs a `Font`) is put back by hand, and those lines are listed in the report.
  - After it, `grep -c "\.font(\.system(size:" -r ios/MasterSAT/Sources` drops from 1,074 to the hand-kept few.
- **Caps on the chrome only:** `FloatingTabBar`, `AppHeader`'s `StrikeChip`, `XPPill`, the avatar initials and `NotificationBell` get `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)` and `.accessibilityShowsLargeContentViewer()` with their label. Pages are not capped.
- **Rows that stack at accessibility sizes** (`dynamicTypeSize.isAccessibilitySize`, or `ViewThatFits`):
  - `HubCard` (badge and chevron under the text)
  - `WorkRow` (due chip under the title)
  - the Class cards
  - the Rewards streak/coins pair (one above the other)
  - the Me goal panel's two wells
  - `PillTabs` (scrolls already; check the pill height grows)
  - the header (title above the chips)
  - the runner's toolbar (wraps to two rows)
  Extend this list from the device check; nothing is clipped or truncated to "…" in a title at AX5 on the tab roots, the Me sheet, the homework page and the runner chrome.
- **iPhone SE (3rd generation), 375×667.** Create the simulator (`xcrun simctl create "iPhone SE (3rd generation)" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation com.apple.CoreSimulator.SimRuntime.iOS-26-3`; if the runtime refuses the device type, use the smallest one it accepts and say so).
  - Check the five tab roots, the Me sheet, the homework page, the runner and a word game at the default size and at `xxxLarge`.
  - Fix truncation and overlap: the floating bar's labels, the header's chips, Today's hero, the Rewards hero.
- **How to check text size in the simulator:** `xcrun simctl ui booted content_size accessibility-extra-extra-extra-large` (and `large` to reset). Screenshots at AX5 of each tab root and the Me sheet go in the report.
- [ ] Build check. Commit `feat(ios): text grows with the phone's setting, chrome stays put, and the iPhone SE fits`.

---

### Task 55: Reduce Motion everywhere, dark mode, the looping budget, one card look, and the bar's margin

**Files:** `Support/Motion/Motion.swift` (`Stagger`, `ZoomDestination`), `Screens/Today/TodayView.swift` (`dismissNudge`), the hand-rolled cards (`AssessmentBoardViews.swift:413`, `:660`; `AssessmentReviewView.swift:531`; `RewardsTabCards.swift:386`; `VocabStudyView.swift:551`; the runner's `:266`/`:322` only if they are cards, not the question surface), the sheets and horizontal scrollers listed below, `Screens/Shell/TabRootScroll.swift` (status-bar material), the dark-mode fills.

**Rules:**
- **Reduce Motion never restructures the tree** (P4-R7):
  - `Stagger` keeps one modifier chain and picks the values (offset 0, scale 1, a 0.2-s fade under Reduce Motion).
  - `ZoomDestination` applies `.navigationTransition(.zoom)` without an `if reduceMotion`. The system turns the zoom into a cross-fade under Reduce Motion; check that on the simulator with Reduce Motion on (`xcrun simctl spawn booted defaults write com.apple.Accessibility ReduceMotionEnabled -bool true`, then relaunch). If it does not, keep one tree by choosing the source id instead (nil source → automatic).
  - `dismissNudge` animates with `Motion.focus` under Reduce Motion.
  - Sweep: `grep -rn "if reduceMotion" ios/MasterSAT/Sources` — every hit that swaps views (not values) is converted or justified in the report.
- **Dark mode:**
  - Every fill of `Color.primary` / `.black` / `.white` that carries text becomes the `Theme.ink` / `Theme.onInk` pair (the offline banner already, in Task 46).
  - The coloured heroes keep their white-on-colour.
  - Check every tab root, the Me sheet, Explore's cards, the state art (the grey `#94a3b8` must read on dark — lighten it in the generator if not) and the runner with `xcrun simctl ui booted appearance dark`. Screenshots go in the report.
- **≤ 2 looping Lottie per screen:**
  - Today: the header flame.
  - Rewards: the header flame and `StreakCard`.
  - Nothing else loops: the state art settles, and bursts are one-shot.
  - Write the rule in `LottieClip`'s doc comment, with the per-screen count.
  - Low Power rests the loops (Task 45).
- **One card look.** Hand-rolled cards use `cardStyle()` (radius 18, `cardEdge` hairline only in dark, the soft shadow), or `cardStyle(padding:)` with the tone bar overlaid and clipped, as `ProfileHeroCard` does. Inner tiles and chips keep their own radii. Focus-zone surfaces (the question card) stay plain.
- **The bar's room never reaches what has no bar under it:**
  - The sheets presented from inside a tab with scrolling content get `.noBarClearance()` on their content:
    - `LeaderboardFiltersSheet`, `ClassroomTelegramSheet` (both presenters), `NotificationsInboxSheet`, `SatChecklistSheet`
    - the four support sheets (`SupportSheets`)
    - `CustomSetBuilderView` (both presenters)
  - Horizontal scrollers (`PillTabs`, `StoriesRail`, the support day strip, the leaderboard scope tabs) get `.contentMargins(.bottom, 0, for: .scrollContent)` — harmless if it was adding nothing, correct if it was.
- **The status bar on tab roots.** Content scrolled under the status bar gets a `.bar` material strip the height of the top safe area. It fades in once the content has scrolled 8 pt, and is instant under Reduce Motion. Measure with a top-anchor geometry preference, since iOS 17 has no `onScrollGeometryChange`.
- [ ] Build check.
- [ ] Simulator checks: Reduce Motion on; dark mode on each tab root and the Me sheet.
- [ ] Commit `fix(ios): Reduce Motion never rebuilds a screen; dark mode, one card look, and the bar's margin only where the bar is`.

---

### Task 57: The Me sheet as B — the website's three tabs, with midterms, notifications and clearer navigation

*(Owner answer 1, 2026-10-23. Supersedes Task 48's one-page sheet, commits 5f31d2a7 and 489a4d71; the kit's midterm rules from 305c9884 stay.)*

**Files:**
- `Screens/ProfileView.swift`, `Screens/Profile/*`, `Screens/Account/AccountComponents.swift`, `Screens/RootView.swift`.
- Kit: `Profile/ProfileRules.swift` (restore `ProfileHomework.summarise` and its wording, on `isDone`) and its tests.
- Recover the deleted code from git (`git show 489a4d71^:<path>`, `git show 5f31d2a7^:<path>`) rather than rewriting it; then apply this task's changes on top.

**The sheet, as the website's profile (B):**
- **Hero**: as before Task 48, with the close button moved into it as Task 48 did — a 32-pt circle in a 44×44 hit area, root only.
- **Pinned tabs**: Overview · Classes · Settings (`PillTabs`) directly under the hero. They stay pinned under the top edge while the page scrolls, so switching is always one tap away.
- **Overview**:
  - the four figures (XP, Strikes, Points, Homework);
  - Your goal (target, test day, latest results);
  - Homework to do;
  - Midterms & certificates (Task 48's `MeMidtermsPanel`, kept);
  - Finish your profile, or the "all set" panel;
  - Payments "coming soon".
- **Classes**: as before Task 48 (each class's next lesson, teacher and Telegram group, then classmates), on the Tashkent calendar (Task 43).
- **Settings**: Account, Notifications, Sign-in & password, Devices, About, Appearance (Task 58).
- **Under the tabs, on every tab**: My progress, then Sign out.
- **The homework count** (the phase-2 carry): `ProfileHomework.summarise` counts with `HomeworkProgress.isDone` and leaves classwork out, so a finished word-set homework leaves it as it leaves Today. Kit tests, test-first:
  - a played word-set homework is not to do;
  - classwork is never counted;
  - a quiz homework with a second open quiz is to do;
  - an empty word set is never owed.

**Navigation (owner: "improve the navigation"):**
- Every push from the sheet is a value declared at its root (`ProfileView.Route` + `AppLink`): the four figures' pages, Homework to do rows, "All homework", the checklist's actions, the Classes rows (the class page), and the settings rows. No `NavigationLink { destination }` remains in the sheet.
- Back returns to the tab and scroll position the student left.
- The sheet reopens on the tab last open in this launch: the tab lives in `AppRouter` (`meTab`), not in the view's `@State`.
- A link into Me selects its tab: `AppLink.profile` → Overview, `.progress` → pushed over the current tab.

**States:** every panel keeps its own load and failure; use the phase's `ErrorState` / `LoadingSkeleton` / `DashedEmpty`. Error ≠ empty.

- [ ] Kit tests first, then restore and adapt; build check; commit `feat(ios): the Me sheet keeps the website's three tabs — with midterms, notifications and navigation that holds its place`.

---

### Task 58: Appearance — System, Light or Dark, for the whole app

*(Owner answer 1, 2026-10-23: "theme yo'q ekan shuni ham hal qiling" — the app has no theme setting.)*

**Files:**
- Create: `ios/MasterSAT/Sources/Support/Appearance.swift`, `ios/MasterSAT/Sources/Screens/Account/AppearanceView.swift`.
- Modify: `App/MasterSATApp.swift` or `Screens/RootView.swift`, and the Settings rows (Task 57).

**Rules:**
- `enum AppAppearance: String, CaseIterable { case system, light, dark }`, stored per device in `UserDefaults` (`@AppStorage("appearance")`), default `.system`.
- Applied once at the root with `.preferredColorScheme(nil / .light / .dark)`. It reaches every tab, sheet and cover; check the Me sheet, the certificate sheet and a full-screen cover.
  - *(As built, 2026-10-23: `preferredColorScheme(nil)` left an open sheet dark after switching back to System (device finding D10). The setting now writes the scene windows' `overrideUserInterfaceStyle` (`.unspecified` / `.light` / `.dark`) at launch and on change, with one writer; `preferredColorScheme` is not used. Built second, right after Task 57's Account rows, not last.)*
- Settings → **Appearance** row (tile `circle.lefthalf.filled`, hint "System, light or dark") pushes `AppearanceView`. That page offers three choices with a preview swatch each, the current one ticked.
  - The change applies at once, with no animation of the colour swap under Reduce Motion.
  - VoiceOver: each choice is selected or not, and named "Use the phone's setting" / "Light" / "Dark".
- The theme is a device setting, not an account setting: no server call, no backend change.
- [ ] Build check; commit `feat(ios): Appearance — follow the phone, or always light, or always dark`.

---

### Task 56: Run it, prove it, open the PR

**Files:** the plan's "Phase 5 outcome" section; the PR body (scratchpad); screenshots on the orphan branch `pr-assets/ios-redesign-phase5`.

- [ ] **Step 1: The local rig — before any launch.**
  - Start the preview config `ios-redesign-backend` (SQLite in `dsat-wt-ios-redesign/backend`, `seed_classroom_uat`; test login `uat_s1@mastersat.test`).
  - Then run `xcrun simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000` on EVERY simulator used (iPhone 17 Pro and the SE).
  - Before tapping any sign-in form, take a screenshot and confirm in `preview_logs` that the request reached localhost.
  - Never `simctl terminate` with the panel attached and assume the next launch has its arguments.
- [ ] **Step 2: Seed** with existing management commands only, and list them:
  - a roadmap level with lessons
  - a support teacher with a free hour, and one booking
  - an event with a ticket
  - an open survey with points
  - a released midterm with a certificate
  - a student with nothing to do (for the empty states)
  - one word set with no words.
- [ ] **Step 3: Device checks** (iPhone 17 Pro, iOS 26.3), each with a screenshot:
  1. Explore's four live lines and badges.
  2. A pull on Explore re-reads.
  3. The Me sheet top to bottom; Midterms & certificates; a certificate over the sheet; the close button; each settings row pushes and pops.
  4. Today all-done art; Class To do empty art; Words nothing-yet art.
  5. Offline: airplane mode via the Network Link Conditioner, or stop the backend → the banner, then a page's offline `ErrorState`; back online → the banner goes.
  6. A skeleton on a slow page.
  7. A refresh that fails over good data → the stale line.
  8. Roadmap "Go to Classes" → the Class tab.
  9. Haptics/selection: "See all" from Today buzzes once (the tap), not three times.
  10. Text size AX5 on each tab root and the Me sheet.
  11. Reduce Motion: stagger, zoom, state art still, loops resting.
  12. Dark mode on each tab root, the Me sheet and the state art.
  13. The iPhone SE: each tab root at default and `xxxLarge`.
  14. The homework page after a hand-in (status, "What to do").
  15. The review's chips pinned under the bar.
- [ ] **Step 4: The demo video.** Run `xcrun simctl io booted recordVideo --codec h264 /tmp/phase5.mp4`, covering items 1, 3, 4, 5 and 11. Check its frames with an `AVAssetImageGenerator` script (the display can freeze in recordings — re-record if so).
- [ ] **Step 5: The outcome.** Write "Phase 5 outcome (date) and what it leaves" in this plan:
  - decisions taken (P5-R…)
  - what was verified on device and what was not
  - "Not done, and why" — every carried item not fixed, with its reason
  - the owner's list: iOS 17/18 runtimes, the paid Apple account for TestFlight, matching accuracy, the strike-shop burst.
  Commit it.
- [ ] **Step 6: Screenshots** go on the orphan branch `pr-assets/ios-redesign-phase5` (`git worktree add --orphan`, push the branch only). The PR body links them by raw URL.
- [ ] **Step 7: The PR** into `main`:
  - title `iOS redesign phase 5 — Explore + Me + polish`
  - body: the summary, owner answers, rulings, device checks with screenshots, not verified, not done, the font-conversion script, test counts.
  Ends with the attribution line. Bind it with the `ccd_pr` tools. **No merge without the owner's "ha".**
- [ ] **Step 8:** Send the owner the screenshots and the video (SendUserFile), one line per thing to look at.

---

## Phase 1 outcome (2026-10-20) and what it hands to later phases

Done on `feat/ios-redesign` (13 task commits + 1 final-review fix wave), kit 649 tests, every task reviewed, final whole-branch review "with fixes" → fixed and re-reviewed. Device-checked on the iOS 26.3 simulator against a local backend.

Decisions taken during phase 1 that later phases build on:
- **Value pushes only at tab roots.** Every push from Today / Class / Words / Rewards / Me root views is a value (`AppLink`, a per-root `Route`, or the model value) declared at that stack's root, so re-tapping a tab and tab-placement links pop them. A `NavigationLink { destination }` from a root view is a regression.
- **Bottom clearance** is `contentMargins(.bottom, barClearance)` on each tab child (not `safeAreaInset`, which never reached the tab pages); the bar is a full-size bottom-aligned overlay that ignores the keyboard safe area.
- **One sheet at a time:** `AppRouter` queues a link that needs the other sheet; both sheets call `sheetDismissed(baseURL:openURL:)` on dismiss.
- **Reduce Motion** is centralised: `pressFeedback`, `Stagger`, `PillTabs`, the tab bar, `LottieClip`, `MotionBudget` → `CelebrationCenter.reduceMotion`.
- **Header numbers** (`RewardsStore`) refresh at launch, on scene `.active`, on reconnect, and whenever the Rewards hub loads `/rewards/me/` (`apply(_:)`).
- `isFinished` compares Dates (float round-trip); `landed` is idempotent; a flight never lands after its view is gone; the XP target is the pill on the visible tab.

Carried into later phases (found in phase 1 reviews, deliberately deferred):
- **Phase 2:** decide where "+XP" flies from a PUSHED page (the pill lives only in tab-root headers that scroll — pin it or add a nav-bar pill); apply XP independently of a landing (`flyXP` drops silently under Reduce Motion / no target); `RewardsStore` writes outside an animation transaction (numbers don't roll) and is last-write-wins (guard stale responses before `XPDelta`); only the visible pill should pulse/haptic on a landing; re-tap at a tab root should scroll to top; delete the DEBUG long-press on `XPPill`; Today `path.append(assignment)` double-tap guard; give one-shot `LottieClip`s an explicit frame (Reduce Motion collapses them).
- **Phase 4:** `contentMargins` reaches full-screen covers (assessment runner, vocab games, story viewer, live quiz, ticket) — zero it there.
- **Phase 5:** audit inherited `contentMargins` in nested horizontal scrollers and sheets (StoriesRail, SupportBookingView, goal sheet, ClassesListView sheet); tab-bar VoiceOver semantics + Dynamic Type; Me close button is 32 pt (make 44); Me panels still push with `NavigationLink { }`; Explore cards lost the Events/Surveys open-count badges; `ProfileModel` still fetches those counts; hand-rolled cards keep the old hairline / radius 16 (HomePulse, LessonCalendar, AssessmentBoardViews, LeaderboardView, AssessmentRunnerView…); `PillTabs` selection haptic also fires on programmatic changes; `RewardsPointsPill.swift` holds only the explainers now; dead `EventsOpenCard`.
- **Kit polish (any phase):** test `AppTab.allCases` order; confetti tests for seed sensitivity, combined budgets and edge counts; a test that every `LottieAsset` loads; enforce the 15 000-byte Lottie budget in the generator; rename `gravity` (it is the t² coefficient).
- **Owner, before merge or in phase 2:** check the shell once on an iOS 18 (and ideally 17) simulator runtime — only iOS 26.3 is installed on this Mac (~8 GB download).

## Phase 2 outcome (2026-10-21) and what it hands to later phases

Done on `feat/ios-redesign-phase2` (PR #305, merge after #304): 9 task commits plus their fix rounds, one final-review fix wave (7 commits) and one device fix (See all scrolls Class to the top). Kit 694 tests. Every task was reviewed, then the whole branch (opus) said "with fixes" → fixed and re-reviewed clean. Device-checked on the iOS 26.3 simulator against a local backend with synthetic data.

Decisions taken during phase 2 that later phases build on:
- **Classwork is never owed** (P2-R5): it never counts in Today's ring or Up next, never reads "Catch up" (`WorkRow` shows "In class"), never gets reminders, and the To do badge uses `ClassTasks.owedCount`. The server's `my-assignments` is homework-only anyway (`tests_classwork_separation`), so these rules are defensive.
- **"up to +N XP"** sits on every homework not yet due, never on catch-up rows (P2-R3).
- **Error ≠ empty, and a cancellation is never a failure.** Today's hero, the lessons row, and Class's `ClassSourceState` (pending / loaded / failed; a failed reload keeps the last good data) only say "nothing" after a load that worked.
- **Refreshes run detached.** The plan's `.refreshable { refreshTick += 1; await load() }` cancelled its own requests on device (state written during the refresh re-installs the action). Tab roots pass `onRefresh:` to `TabRootScroll`; other pages use `.detachedRefresh` (`await Task { @MainActor in … }.value`). Use it for every new `.refreshable`.
- **Celebrate once, after the server confirmed, from a one-shot guard**; full-screen covers carry `.coversCelebrations` and never read `CelebrationCenter`. The vocab game celebrates on the runner's server-confirmed `isFinished`, not in `finish(_:)` (P2-R7). "+XP" flies only for a measured server delta and lands on the visible pill — from a pushed page it waits and flies when the tab root's pill appears.
- **People/Files requests run as unstructured per-request Tasks** (`ClassSectionsModel.fetched`, P2-R8) so a `.task(id:)` cancel never stores a failure nothing retries.
- **`ProfileLessons.Next.isOnNow`** (`live && hasTime`) is what says "on now"; `live` alone still keeps today's lesson in `next()`.
- **"See all"** goes through `AppRouter.showClassToDo()` (Tasks → To do, at the top), applied once.

Carried into later phases (found in phase 2 reviews, deliberately deferred):
- **Phase 3:** the "while you were away" rework of interleaved refresh dips and the unanimated backstop landing; `allDone()` is dropped (not held) while a cover is up.
- **Phase 4:** `handInFrame` / `submitFrame` are `@State` written every scroll frame (box them if the upload rework shows jank); leaving a word game with an unsaved round may save without a celebration (never doubles, never celebrates a failure).
- **Phase 5:**
  - Move the ~15 pushed pages that still use a plain `.refreshable` (ClassroomDetailView, Points, Shop, Leaderboard, Midterms, Events, NotificationsInbox…) to `.detachedRefresh`.
  - `HomeworkDetailView:105` and `ClassView.load()` still read a cancelled FIRST load as a failure.
  - The Me sheet's homework card (`ProfileHomework.summarise`, `ProfileOverviewTab:353`, `ProfileRules:92`) ignores `isClasswork` and `HomeworkProgress.isDone`.
  - Today uses a fixed 2-h lesson window on Tashkent time while Class cards use `room.lessonHours` on the phone calendar; `DueLabel` uses the phone calendar.
  - Accessibility pass: `PillTabs` `.isSelected` trait, `LessonsUnavailableRow` icon, 12-pt "Try again", ring label while loading, result rows combined for VoiceOver, large Dynamic Type for the four Class segment titles and the header.
  - Polish: "on our end" error copy; `dismissNudge` ignores Reduce Motion; stale rows after a failed refresh carry no notice; first-run "fresh" result has no baseline; the rankings subtitle repeats per class under All; `WorkRow` "In class" drops the assigned date `ClassroomSections` shows.
  - `RoadmapView:136` pushes `ClassesListView` ("Go to Classes") — switch it to `router.show(.classes)`.
- **Later / perf:** `TodayPlan` rebuilt several times per render and ~7 requests per return to Today; 2N sequential People requests under All; the three identical `load*` methods in `ClassSectionsModel`; its refresh stamp is set at load start; the Schedule segment's state resets per switch and a cancel without a restart would leave its spinner; same-name class tie-break, `isMath` trim, `LatestOnly` never-issued tickets, `ClassSourceState` has no test (move it to the kit).
- **Owner:** check phases 1–2 once on an iOS 18 (zoom transition) and ideally iOS 17 simulator runtime — only iOS 26.3 is installed (~8 GB download). TestFlight needs a paid Apple Developer account.

## Phase 3 outcome (2026-10-21) and what it hands to later phases

Done on `feat/ios-redesign-phase3` (PR "merge after #305"): Tasks 20–28 with their fix rounds, one final-review fix wave (5 commits). Kit 740 tests. Every task was reviewed; the whole branch (opus) said "with fixes" → fixed and re-reviewed clean. Device-checked on the iOS 26.3 simulator against a local backend with synthetic data, including Reduce Motion and a purchase inside the Me sheet.

Decisions taken during phase 3 that later phases build on (rulings P3-R1..R14 in the PR):
- **The Rewards hero is the global, all-time rank** (owner, 2026-10-21) from `LeaderboardQuery.heroBoard` (`limit=200`); "N XP to pass <name>" only when every student ahead is in the response; the welcome-back check reads the same board.
- **Points ≠ XP.** `XPLedger` decides per event like the server's `_rule_grants_xp` (a rule's flag when one exists, else XP unless SURVEY); the welcome-back caption uses the same rule and the loaded rules.
- **Every recorded celebration entry is resolved** (`record`/`recordAway` are not discardable); a pending entry holds the pill (`held(xpNow:)`), so the header never shows a total before its flight.
- **A return plays flight → flame → card, and only then does the Rewards hub read again** (`AwayCheck.run` → `.read`, `CelebrationCenter.whenQuiet`); a failed or skipped check never reloads it. A rank-up that could not be read or shown stays `rankUnread` across launches.
- **Lottie bursts end blank**: `.still` and Reduce Motion use each asset's `restProgress`; bursts never loop by default.
- **Look B is `ChunkySurface`** (no clip, no full width) — motivation surfaces only.
- **Words counts words still to master across the bank** (no "due" exists server-side); zero-word sets are never owed, never Start's target, never a Start card; `VocabReview` is built only from two successful loads.
- **A strike-shop purchase gets no coin burst** (toast + haptic) — spending strikes isn't a coin moment (owner may revisit).
- **The DEBUG simulator build must be pinned to the local backend** (`simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000`): a relaunch without the launch argument reaches production with whatever session the keychain holds.

Carried into later phases (found in phase 3 reviews, deliberately deferred):
- **Phase 4:** a refresh mid-session (xpBefore captured at session start) can still drop the pill un-animated at hand-in.
- **Phase 5:**
  - The hub's own `load()` (tab open, pull, "See the board") is not gated by `whenQuiet` — opening Rewards mid-flight can still show the new place early; `whenQuiet` is not re-asked from `celebrate`'s resolve, the Low-Power release or a Reduce-Motion toggle (the hub then waits for the next open); `dismissRankUp` may replay an identical rise from an overlapping check.
  - A hub read that finds an XP rise with no check pending rolls the pill without a flight (phase-1 behaviour).
  - VoiceOver: no focus move to the rank-up card; dimmed search results announce nothing; the coins card's focus after a convert; `.low` priority of the rank line unverified on device; `VocabEmptySetRow` contrast.
  - Rewards: duplicate `loadSection` on re-appear; `loadHero` has no ordering guard; XP-MONTH and Strikes share one slot (spinner on every toggle); Points unreachable from the tab while `/rewards/me/` fails; no own-row line on Strikes; the hero grows ~12 pt when the pass line wraps; "N XP to pass Student" for a nameless row; a failed same-query leaderboard pull is silent; Points' "couldn't confirm" line outlives a successful pull; move `heroBoard` to the kit with a test.
  - Words: the hero stays above search results (small phones with the keyboard up); Today's `HomeworkProgress.isDone` still treats an empty word set as unfinished (goes with the Me-sheet `isDone` item).
  - Celebrations: a replayed all-done has no hero bounce; burst rest frames are hand-synced to the generator keyframes.
  - Tests/docs: `historyWindow` (50) mirrors the backend without a drift test; `AwayCheck.remember()`'s decision table lives in the app target (move to the kit); missing kit tests listed in the phase 3 reviews (decrease-before-resolve, LastSeen nil round-trip, merged away+task label); the AwayCheck header and `Outcome.read` doc nits.
- **Owner:** check phases 1–3 once on an iOS 18 and ideally iOS 17 simulator runtime (only iOS 26.3 is installed, ~8 GB); TestFlight needs a paid Apple Developer account.

## Phase 4 outcome (2026-10-22) and what it hands to later phases

Done on `feat/ios-redesign-phase4` (PR "merge after #308"): Tasks 30–40 with their fix rounds, one device fix found in Task 41 (an improved review's confetti), one final-review fix wave. Kit 786 tests. Every task was reviewed; the whole branch (opus) said "with fixes" → fixed and re-reviewed. Device-checked on the iOS 26.3 simulator against a local backend with synthetic data (Task 41 items 1–13, 16, 18), frame by frame from screen recordings.

Decisions taken during phase 4 that later phases build on (rulings P4-R1..R11 in the PR):
- **Focus motion is its own vocabulary** (`Motion.focus`, `focusTap`, `focusStep`, `FocusTurn`, `focusReveal`, `focusEntrance`, `focusShake`, `RollingNumber`): ≤ 250 ms, no overshoot over content, springs only on chrome (flag, logo, trophy). Reduce Motion never restructures the tree — both tracks always exist and the setting only picks which one is seen (P4-R7), so a live toggle keeps focus, scroll and descendant state.
- **Never a right/wrong signal while answering**: the runner and the vocab test fill and tick every choice alike, answered map cells are blue, a spelling well mirrors what was typed (P4-R5); the grade is decided only at submit (`fold` both sides, P4-R10).
- **Outcomes celebrate once, only when passed or improved** (`CelebrationRule`, `OutcomeMemory` per student): "the attempt before" is the newest earlier attempt this phone knew of the same set — the student's lists and the review carry only a homework's newest attempt, never the one before it — compared in whole percents rounded half-to-even (P4-R6); lists note what they carry (`noteSeen`) so an attempt taken on the web still counts as "before". Old passed midterms get one burst the first time they are opened after the update (P4-R11).
- **"+XP" from a hand-in is measured from the hand-in** (`XPDelta.baseline`): a refresh or a welcome-back award during the session never makes the pill dip or folds into the task's own gain (device item 13: 435 held through the cover, "+20 Manual adjustment" flew once, then 455).
- **Upload progress is real**: `APIClient.send(onBodySent:)` reports sent bytes (`BodyProgress` never runs backwards), `MultipartForm.fileRanges()` maps them to files, `UploadRelay` coalesces onto the main actor; rings fill per file and turn into ticks.
- **Covers carry `.noBarClearance()`**: the tab bar's `contentMargins` travels into everything presented from a tab; a full-screen cover zeroes it.
- **Trigger-driven modifiers never sit on a `Group { if … }` whose branch flips in the same update** (`.animation(_:value:)`, `keyframeAnimator(trigger:)`, `.overlay` with an `onChange`): the Group hands them to each branch and the new one is born past its trigger. Use a stable container (`ZStack` + full frame) or animate at the write site. `.onChange` / `.task` on a Group survive the flip. Found on device: the improved review's confetti never played (60bf40e9); the runner's "Handed in" never faded (fix wave).
- **The DEBUG simulator stays pinned to the local backend** (`simctl spawn booted defaults write uz.mastersat.app apiBaseURL http://localhost:8000`).

Carried into later phases (found in phase 4 reviews and on device, deliberately deferred):
- **Phase 5 (code):**
  - Runner/test: a very fast second tap can land on the arriving question (pre-existing); the last answer's selection tick is lost when the end screen replaces the view; `flagRowHeight` 24 is estimated (Dynamic Type audit); toolbar targets 34×30; turning Reduce Motion off after a flag gives one stray bounce.
  - Flashcards: 45° split flicker; unbounded drag; VoiceOver focus after a verdict and re-reading on flip.
  - Spelling: IME tail over the cap; `spoken()` names fewer marks than `fold` folds; `PlainTyping` one-shot lookup.
  - Games: Matching has no accuracy stat (owner's call); `ModeStat.value` duplicates `percent`; the "Mistakes" tile in danger red (copy pass).
  - Upload: unreachable cancellation catch / stale rect when leaving mid-upload; the 0% ring dot; trash enabled mid-upload; unbounded thumbnail tasks; a third copy of the Empty/decode block.
  - Outcomes: move `noteSeen(in:)` / `wholePercent` to the kit and call `noteSeen` from the board and homework loads; `ClassView` captures the user id at load start; the hero rounds half away from zero while "Up from" rounds half to even (differs at x.5); the review's turn direction depends on `Filter.allCases` matching the tab order; the filter chips' press bounce is a spring in a focus zone.
  - Sign-in: a `/me` 401 after a good login reads as a wrong password; a stale announcement after switching to Register; the Register alert is not announced; the 30-pt eye button.
  - Motion: `Stagger` / `ZoomDestination` still branch on Reduce Motion; sheets inherit the bar margin; `RootView`'s `OfflineOverlay` has the same dead `Group` + `.animation(value:)`.
- **Phase 5 (device observations, pre-existing):** right after a hand-in the homework page's "What to do" row can still read "Continue · 1 answered" though the attempt is graded (the row comes from the list payload, re-read later); the review's pinned filter chips slide under the back button when scrolled; HomeworkDetail shows a stale "Not started" for ~0.3 s after a cover closes and still says "Not started" for a word homework after three games; tab roots scroll content under the status bar with no material; a reviewed quiz homework still offers "Start"/"Continue" and "up to +15 XP" during a retry (pay comes from the first attempt); Results reads "No results yet" while a retry is in progress (lists carry the newest started attempt); Today once came up scrolled ~55 pt after a hand-in (not reproduced); Me → Sign-in & password wraps "Emai / l" beside the Confirmed badge.
- **Not verified on device:** the sign-in and change-password shakes (Task 41 items 14–15; the simulator panel stopped focusing text fields mid-check) and VoiceOver (item 17; the simulator has no VoiceOver). Both read correct in the final review.
- **Owner:** iOS 17/18 are unchecked (only the iOS 26.3 runtime is installed, ~8 GB); TestFlight needs a paid Apple Developer account. `seed_phase4`'s "Phase 4 · photos" needs `allow_file_upload=True` to pay XP locally.

## Phase 5 outcome (2026-10-23) and what it leaves

Done on `feat/ios-redesign-phase5`, cut from `main` at `95fc244e`. The work:
- Tasks 42–55, each with its own fix rounds.
- A device check (Task 56) on the iOS 26.3 simulator, pinned to the local backend, with seeded data. Four passes found D1–D13; every one is fixed and re-checked on the device.
- One opus whole-branch review ("with fixes", 0 Critical / 10 Important / 15 Minor), then one fix wave of 22 items, re-reviewed clean.
- The owner's answer to question 1 added two tasks:
  - Task 57, the Me sheet as B: four fix rounds, the last two for D12 and D13.
  - Task 58, Appearance: one fix round, for D10.
  - Each task was re-reviewed clean after its last round.
- Order: Appearance was built second, right after the Account rows it hangs from. The plan lists it last.

The kit went from 786 to 953 tests (all green; the last two commits touch only the app). The app clean-builds under Swift 6; all 130 distinct warnings are in the kit, none in the app's own sources.

Decisions taken during phase 5 that later work builds on (the full list of rulings, each with its cost if wrong, is in the PR):
- **P5-R1 Explore reads its four lines live on every visit.**
  - The requests run side by side and detached (6 requests).
  - Each card fails on its own and keeps its fixed one-line description. A card never says "nothing" for a failure.
  - Surveys pay **points**, not coins.
  - Services shows the next booked hour, otherwise the next free one (always after now), and the next SAT **date** ("Next SAT: December 20").
- **P5-R2 The Me sheet is the website's three tabs (owner, B).**
  - Overview · Classes · Settings sit under a hero that carries the 44-pt close button.
  - While scrolled, an overlay copy of the tabs stays pinned. Each tab's page is at least one screen tall, so a switch while pinned always lands on content (D12). While pinned, the page swap is not animated (`.transaction(value:)` on the scroll view), so the switch lands on the tabs from any tab (D13); unpinned, the pill still slides.
  - The tab lives in `AppRouter.meTab`: the avatar reopens the last tab, `/profile` opens Overview.
  - Every push from the sheet is a value route.
  - Overview adds Midterms & certificates:
    - a "Passed" tag only when the centre marked it;
    - a certificate opens as a nested sheet;
    - re-sits keep their result.
  - The homework figure uses `HomeworkProgress.isDone` and leaves out classwork and empty-set homework. "Nothing set" is a dashed empty slot, never an achievement.
- **P5-R3 Appearance is a device setting** (System / Light / Dark, default System).
  - It sets the scene windows' `overrideUserInterfaceStyle`, with one writer.
  - `preferredColorScheme` is gone: going back to System left an open sheet dark (D10).
- **P5-R4 One state vocabulary.**
  - `StateArt`: five one-shot Lotties that settle, with `rest` markers written by the generator.
  - `EmptyState`.
  - `ErrorState`: `.page` with art and offline wording, or `.inline`.
  - `LoadingSkeleton`: breathes outside the focus zones, static under Reduce Motion.
  - `StaleNote`.
  - At most one state animation per screen. Error ≠ empty everywhere.
- **P5-R5 Text follows the phone's text size.**
  - `appFont` uses `@ScaledMetric`, is exact at the default size, and takes `monospacedDigits:`. 1,013 fixed fonts were converted.
  - Chrome is capped at xxxLarge, with the Large Content Viewer.
  - Rows stack through `AdaptiveStack`/`AnyLayout`, which keeps their identity. The segment bar stands in a column at the accessibility sizes (D11).
  - `HeaderLayout` is one instance of the header's pills and bell in every arrangement.
  - `SlotStack` drops the spacing of empty slots (D6).
- **P5-R6 Haptics answer taps, not code.** The tab bar, pills and segments are driven by a tap counter. VoiceOver gets:
  - labels and `.isSelected`;
  - the tab-bar trait;
  - the title read first;
  - the rank-up card read once, after the XP line;
  - Appearance announcing its choice.
- **P5-R7 A homework of only empty word sets has nothing to do yet.**
  - It is never owed and is not counted (Today's ring included).
  - It reads "Nothing to do yet", in neutral, and is never "Catch up".
- **P5-R8 Implementers never launch the app**: an unpinned launch once reached production. The controller runs one pinned rig.

Verified on the device (build `2c4bdcb2` and earlier, iPhone 17 Pro, iOS 26.3): see the PR's checklist. It covers:
- Explore, Me B with all three tabs, the certificate over Me, and Appearance Light / Dark / System with the sheet open;
- the empty states, the error art, the stale line, and Go to Classes;
- the tab roots at AX5, xxxLarge, dark mode, and the Reduce Motion skeleton and push;
- D1–D13, each re-checked after its fix.

A drag down on the pinned tab strip neither scrolls the page nor closes the sheet; that is accepted.

Not verified on a device:
- the iPhone SE tab roots: the simulator panel's access request went unanswered, so only the SE sign-in screen was checked;
- VoiceOver (the simulator has none), including whether focus survives the pin releasing after a tab switch;
- the pill row's scroll position at AX3+ when the pin releases;
- haptics;
- true offline (NWPathMonitor);
- the zoom fallback under Reduce Motion on iOS 18;
- iOS 17/18 runtimes.

Not done, and why:
- the retry row ("Retry · n answered", no XP on a retry): it needs a server field;
- whole-page failures on pushed pages are still the inline form (no art);
- ~35 hand-rolled hairline cards outside the plan's list;
- the sub-44-pt clear, info, trash and remove buttons, and the leftover " · " readings (listed in the Task 53 report);
- `ServicesExamDates.earliest` keeps a past date if the admin list is stale;
- empty-set-only homework is still listed under Class → Done (it reads "Nothing to do yet");
- phase-2 performance items (TodayPlan rebuilds, sequential People requests);
- the kit's now-unused `ClassroomSubjectFilter` / `cardScheduleLine`;
- the deferred minors listed in the PR.

Owner's list:
- question 2: the Services card's second line, either the next SAT date ★ (built) or a checklist ticked on this phone;
- the sign-in copy "You're signed in, but your account didn't load". Proposed: "Your password is right, but your account didn't load — try again";
- Matching's accuracy figure;
- the strike-shop coin burst;
- iOS 17/18 runtimes (~8 GB);
- a paid Apple Developer account for TestFlight.
