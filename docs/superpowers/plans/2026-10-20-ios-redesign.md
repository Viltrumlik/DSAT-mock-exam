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
   1. Foundation + shell (this plan, in full).
   2. Today + Class.
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

## Phase 2 — Today + Class (outline; detailed tasks are written into this file before the phase starts)

- Kit `Today/TodayPlan.swift` + tests: build "Up next" from `assignments()` (undone homework; open assessments via `AssessmentBoard.todo()`; word homework) and today's lessons from the schedule; order: work to catch up first ("Catch up · Tue" via `DueLabel`), then by due date, then lessons by time; progress = done ÷ (done + due this week).
- Kit `Class/ClassFilter.swift` + tests: chips from `classrooms()` labelled by subject; two classes of one subject → class names; one class → no chips; filter assignments by classroom.
- Kit `Rewards/XPDelta.swift` + tests: `MyRewards` before/after an action → the real gain (0 → no flight); last-seen XP / streak / rank stored per user (used by phase 3's "while you were away").
- Kit `Motion/CelebrationRule.swift` + tests: effort always; outcome only if passed or improved (midterm passed; assessment percent vs the previous attempt).
- Today rebuilt per the approved design; goal sliders + target scores + exam date move to the Me sheet; the full calendar moves to Class → Schedule.
- Class tab replaces `ClassHubView`: chips, next-lesson cards, Tasks (To do / Done / Results) · Schedule · People · Files, Telegram button, Live quiz Join; rows push homework / assessment pages, with the zoom transition on iOS 18+.
- Celebration triggers: homework submitted, assessment submitted, vocab session finished, survey submitted → `LottieClip(.taskComplete, loops: false)` at the row + `confetti(at:)` + success haptic + VoiceOver announcement; then refresh `RewardsStore` and `flyXP` only for a positive `XPDelta`.
- Delete the DEBUG long-press on `XPPill`.
- Verify on the simulator; PR; demo.

## Phase 3 — Rewards + Words (outline)

- Kit: `LeaderboardQuery` gains `metric` (`XP` | `STRIKES`) → `?metric=STRIKES`; tests.
- Rewards: trophy hero with rank + "N XP to pass <name>" (from the board row above the student), streak + coins cards (B chunky style), convert-to-coins on the coins card, leaderboard XP | Strikes with window chips, "Where your XP came from" (`MyRewards.history`), shop with a coin burst on purchase (new Lottie `coin-burst`).
- "While you were away": on launch compare stored last-seen XP / streak / rank → XP flight labelled from the history row; streak up → flame grows + number rolls; rank up → trophy sheet (new Lottie `star-burst`).
- Words: "Review today" hero (still-learning count) + Start; sets, sections, search, my sets restyled.
- Verify, PR, demo.

## Phase 4 — Focus zones (outline)

- Assessment runner: direction-aware question slide (`Motion.focus`), choice fill + selection haptic, drawn cross-out, flag bounce, answered-count progress bar, "Saved" fade, question-map grid animation; full celebration only after hand-in.
- Vocabulary: flashcards 3D flip + swipe (tilt, haptic); test — press + spelling tiles, no right/wrong until the end; matching — pop on match, shake on miss; speed — <10 s pulse; the ending accuracy counts up, celebration only if good.
- Homework upload: thumbnails pop in, per-photo progress ring, tick; celebration on submit.
- Reviews and midterm report: score counts up, rows stagger, "To improve" filter slides, explanation springs open; confetti only for passed/improved.
- Sign in / register: logo spring, breathing brand panel, field shake + warning haptic on a wrong password.
- Verify, PR, demo.

## Phase 5 — Explore + Me + polish (outline)

- Explore live cards: Roadmap current level + next lesson; Services next free support slot + checklist progress; Events next event + ticket; Surveys open count + coins.
- Me sheet: profile hero, target scores + exam date (moved from Today), My progress, midterm history + certificates, notification settings, account, sign out.
- Lottie empty/error states: all-done, no-tasks, no-words, offline, error; `LoadingSkeleton` replaces spinners; `ErrorState` stays distinct from empty.
- Audit: Dynamic Type (largest sizes), VoiceOver labels and announcements, Reduce Motion everywhere, dark mode, iPhone SE (3rd gen) layout, ≤2 looping Lottie per screen.
- Verify, PR, demo. Open item for the owner: a paid Apple Developer account (TestFlight) to put the app on students' phones.

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
