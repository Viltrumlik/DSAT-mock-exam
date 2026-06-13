# MasterSAT UI Rebuild — Final QA & Consistency Report

> Branch `feat/ui-rebuild`. Audit + fixes only (no new pages/features).
> Scope audited: rebuilt surfaces (Auth, Student Dashboard, Student Analytics,
> AppShell, component library, theme, charts, teacher Dashboard/Analytics/
> Students/Homework/Grading/Gradebook). Legacy/deferred surfaces noted in §3.

## 1. Issues found

**Navigation / cross-linking (Phase 1, 10)**
- Dead nav destinations with no route: student **`/settings`**, teacher **`/teacher/classes`**, and the notifications bell's **"View all → `/notifications`"**.
- Dead-end insight tiles: Teacher Dashboard "students needing support" and "lagging submissions" were non-interactive; Homework cards didn't lead to grading.

**Visual consistency (Phase 2, 4)**
- Gradebook used a punishing **red** band (<50) — inconsistent with the growth-oriented, positive/neutral language used everywhere else.
- Teacher Dashboard severity dots used red/amber, out of step with the gradebook ramp.

**Honesty / data (Phase 8, 9)**
- Several teacher hooks degrade a *fetch failure* into an "empty" state (looks like "no data" rather than "couldn't load") — see debt §3.

## 2. Fixes applied (this pass — commit `94f23b2`)
| Area | Fix |
|---|---|
| Dead links | Removed `/settings`, `/teacher/classes`, and the bell "View all" link (all routeless). Documented as future work. |
| Cross-linking | Teacher Dashboard at-risk students → `/teacher/students`; lagging submissions → `/teacher/homework`; Homework cards → `/teacher/grading`. |
| Color semantics | Gradebook ramp is now positive/neutral only (Strong 80+ / On track 60–79 / Needs attention <60); legend reworded; dashboard dots recolored to match. |
| Earlier in-pass | Grading: Prev/Next + ↑↓/j-k keyboard nav + localStorage draft-feedback recovery (commit `329a167`). |

## 3. Verified clean (no change needed)
- **Action-first ordering** — Student & Teacher dashboards lead with actions, charts are secondary.
- **Design tokens (Phase 3)** — no stray hex in rebuilt files; charts use CSS-var tokens; the only literal `bg-white` is the indigo brand-panel overlay and the Google GSI button wrapper (both intentional, theme-safe).
- **Responsive (Phase 5)** — 320px shows **no horizontal overflow** on dashboard and auth; sidebar collapses to a hamburger; hero/cards stack; gradebook heatmap scrolls inside its own container (`overflow-x-auto`), page never breaks.
- **Dark mode (Phase 4)** — every rebuilt token has a dark value; verified at 320px dark and desktop dark (auth, dashboard, homework). Parity with light.
- **Accessibility (Phase 6)** — shared `.ds-ring` focus style on all interactive elements; `aria-label` on icon buttons; Grading is fully keyboard-driven (⌘↵ / ↑↓); overlays (Modal/Drawer) trap Escape + lock scroll; reduced-motion honored globally.
- **Empty states (Phase 8)** — every rebuilt page has an explain-why + what-next empty state; charts have skeleton + empty variants.

## 4. Remaining technical debt (honest)
1. **Legacy `(main)` pages not rebuilt (deferred):** Classes, Assessments, Vocabulary, Profile, Pastpapers, Practice-tests, Midterm. They now render inside the **new AppShell** but keep **old internal styling** → the biggest remaining visual inconsistency. Functionality intact; redesign deferred per product decision.
2. **Test Experience / Exam Runner:** the standalone runner (`features/testing-simulation`, routes `/exam`, `/mock`, `/review`) predates this branch and runs in its **own shell**, not the new `AppShell`/token system. Not re-audited here.
3. **Unbuilt pages (links removed):** student **Settings** & **Notifications** inbox; teacher **Classes** page. The notification **bell drawer** works (empty state) but has no full inbox behind it.
4. **Error vs empty states (Phase 9):** teacher/analytics/dashboard hooks catch fetch errors and fall back to *empty* states. A genuine network/permission failure currently reads as "no data." No distinct error UI yet.
5. **Per-student score trend & class-level SAT strands:** not exposed by current APIs → shown as honest "insufficient data" everywhere (never estimated). Would need a small read-only backend aggregate to light up.
6. **Performance (Phase 7):** charts are not yet `next/dynamic` lazy-loaded; teacher Grading/Gradebook fan out N submission calls (capped + concurrency-limited, but not cached across navigation via react-query). Aggregations are memoized within hooks.

## 5. Recommended future enhancements
- Migrate the deferred `(main)` pages onto the design system (highest visual-consistency win).
- Add a shared **`<ErrorState>`** + thread real error/permission states through the data hooks (distinct from empty).
- Build **Settings**, **Notifications inbox**, and a dedicated teacher **Classes** page (slots reserved in IA).
- Small read-only backend aggregate to enable **class-level SAT strand** analytics + **per-student score trend** (unlocks the radar and "improving students").
- Lazy-load charts via `next/dynamic` and move teacher fan-out reads into react-query for caching/dedup.
- Bring the Exam Runner onto the shared token system for full visual unity.

## 6. Review screenshots
Captured live from the running app (preview routes with representative data):
- **Student Dashboard** — light/dark + 320px mobile (action-first; readiness ring, projected/goal, countdown).
- **Student Analytics** — real SAT-strand radar, recommendations, subject analysis, score history.
- **Teacher Dashboard** — class health, students-needing-support (now clickable), charts, honest strand empty state.
- **Grading** — queue + side-by-side workspace, ⌘↵/↑↓, draft recovery.
- **Gradebook** — positive/neutral heatmap, distribution, trends.
- **Exam Runner** — pre-existing surface (not rebuilt on this branch); no rebuilt screenshot provided (honest).
