# MasterSAT LMS — Frontend Rebuild Final Release Report

> **Branch:** `feat/ui-rebuild` (cut fresh from `main`)
> **Worktree:** `/Users/macbook/Projects/DSAT-ui-rebuild`
> **Status at writing:** rebuild complete for all in-scope student + teacher surfaces; bundle optimization landed. Not yet merged to `main`.
> **HEAD:** `5b02f28` — `perf(charts): dynamic-import Recharts; drop from ui barrel`

This document is the single onboarding reference for an engineer picking up the
rebuild. It states exactly what was rebuilt, what was deliberately left alone,
what remains, and how to back the work out if needed.

---

## 1. Rebuild Scope

### Goal
Replace the legacy student- and teacher-facing frontend with one premium design
system (Stripe / Linear / Notion / Vercel / Khan-Academy quality bar), retiring
four competing component libraries and a flattened token set.

### What was replaced
- **Four competing UI libraries** — `components/ui`, `components/classroom`,
  `components/studio`, `components/ops/ui.tsx` — collapsed to a **single design
  system** under `components/ui` (+ `components/ui/charts`).
- **Token mess** — the flattened `--ds-*` tokens (all collapsed to one blue)
  replaced by a semantic, CSS-first Tailwind v4 `@theme` token system: full
  `primary / accent / success / warning / danger / info` scales with
  `-soft` / `-foreground` pairings, a surface ladder, a 6-stop chart ramp, and
  light + dark parity. Utility layer: `.ds-app`, `.ds-h1..h4`, `.ds-overline`,
  `.ds-ring`, `.ds-num`.
- **Navigation shell** — new `AppShell` + `navConfig`, with `StudentAppShell`
  and `TeacherAppShell` wrappers (AuthGuard + role gating + bell→Drawer).

### Hard scope boundaries — DELIBERATELY NOT TOUCHED
These were explicitly out of scope and remain on their original code/styling:
- **Admin Panel** (`/admin`)
- **Ops console** (`(ops)` — `/ops/*`)
- **Question Bank / Builder / authoring** (`(builder)` — `/builder/*`)
- **All Question APIs, backend logic, DB models, business/scoring logic.**

The rebuild **consumes existing APIs only** (`lib/api.ts`, feature `api.ts`
modules). Exactly **one** read-only backend line was approved and added:
`_build_hw_meta` now exposes the already-existing `AssessmentSet.subject` as
`set_subject` — no calculation, DB, or logic change.

### Tech stack
Next.js 16.1.6 (App Router, `output: standalone`), React 19.2, Tailwind CSS v4,
TypeScript, TanStack Query v5, Zustand, next-themes, lucide-react, katex,
dompurify, recharts 2.15.4.

### Process
Approval-gated phases (Phase 0 audit → 4 foundation → 5 dashboard → 6 auth →
7 analytics → 8–9 teacher → 10 legacy elimination → QA → bundle opt). Design /
data docs live alongside this file in `docs/`.

---

## 2. Routes Rebuilt

All routes below run on the **new AppShell + design tokens + component library**.
Business logic, data hooks, API calls, and exam-start flows were preserved
verbatim — only the presentation layer was rebuilt.

### Student — `(main)`
| Route | Surface |
|---|---|
| `/` | Student Dashboard (action-first: next actions + SAT countdown above charts) |
| `/analytics` | Performance intelligence center (Skills Radar at set-`category` granularity, real data only) |
| `/analytics/report` | Progress Report (export mode of Analytics) |
| `/assessments` | Assessments workspace (list, filters, derived state) |
| `/assessments/[assignmentId]` | Assessment intro / start |
| `/assessments/result/[assignmentId]` | Assessment result (tiers, insights, pacing) |
| `/assessments/review/[attemptId]` | Pedagogical review (math + highlight rendering, teacher feedback) |
| `/practice-tests`, `/practice-tests/[packId]`, `/practice-test/[id]` | Practice tests landing + pack detail + runner entry |
| `/pastpapers`, `/pastpapers/[packId]` | Past papers landing + section detail (combined-score banner) |
| `/mock-exam`, `/midterm` | Simulation entry points (shared `MockExamsList`) |
| `/vocabulary`, `/vocabulary/daily`, `/vocabulary/words` | Vocabulary hub, daily SRS practice, word browser |
| `/profile` | Student profile |

### Authentication
| Route | Surface |
|---|---|
| `/login` | Premium split-screen; all flows preserved (login / register / Google / Telegram, GSI ref, missing-fields, retry) |
| `/register` | Premium split-screen register |

### Teacher — `(teacher)` (admin-gated)
| Route | Surface |
|---|---|
| `/teacher` | Teacher Dashboard (action-first: students-needing-support, completion, class trend) |
| `/teacher/analytics` | Class analytics (shared `useTeacherAnalytics` model) |
| `/teacher/students` | Students (cards + filters + detail Drawer) |
| `/teacher/homework` | Homework (consumes same analytics model; links to grading) |
| `/teacher/grading` | Cross-class grading queue + side-by-side workspace (Save&Next, Prev/Next, ⌘↵ + j/k keyboard, localStorage draft recovery) |
| `/teacher/gradebook` | People × assignments heatmap (positive/neutral colors, no red) |

### Internal review surface
| Route | Surface |
|---|---|
| `/ui-catalog` + `/ui-catalog/*` | Auth-free design-system catalog + feature-page mirrors (dashboard, analytics, teacher, teacher-analytics, students, homework, grading, gradebook). **Primary QA/verification path.** |

---

## 3. Routes Deferred / Not Rebuilt

### Protected execution engines — reskin/extract later, NOT rewritten
These hold live, stateful student work; a careless rewrite risks data loss. They
were treated as protected and left on their existing implementation:
- `/assessments/attempt/[attemptId]` — thin shell over
  **`StudentAttemptRunnerContainer.tsx`** (~2,215 lines; live answering runner with
  autosave, submit, version-conflict). Modernization is **proposed, not
  implemented** — see [`ASSESSMENT_RUNNER_MODERNIZATION.md`](ASSESSMENT_RUNNER_MODERNIZATION.md).
- `/exam/[attemptId]`, `/mock` — the SAT testing-simulation runner
  (`features/testing-simulation`). Preserve its P0 protections (autosave,
  multi-tab, submit-recovery). Same characterize → extract → flagged-swap → canary
  playbook applies independently.
- `/review/[attemptId]` — exam review (linked from past-paper sections).

### Deferred product surfaces (not yet built)
| Surface | Reason |
|---|---|
| `/classes` (+ class detail ×3) | Excluded from rebuild success criteria; **still functional on legacy styling** inside the new shell. |
| Settings (`/settings`) | Page not built; dead nav link removed in QA. |
| Notifications (`/notifications`) | Reached via top-bar bell→Drawer today; standalone page not built. |
| Teacher → Classes | Not built (dead link removed). |
| `/teacher/homework/grading` | Pre-existing legacy teacher grading route, not part of the new teacher grading workspace. |

### Deferred by design (need product/backend work first)
Planner, Calendar, Achievements, Activity Timeline, gamification, Parent Portal,
Teacher Journal, Attendance. Attendance + Parent Portal need backend support →
design-only when revisited.

---

## 4. Bundle Optimization Results

**Commit `5b02f28`.** Recharts was being pulled into the **first-load JS of every
page** because the `@/components/ui` barrel re-exported `./charts` and the chart
wrappers imported recharts statically.

### Fix (A / B / C)
- **A** — Chart wrappers (`Line/Area/Bar/Donut/Radar`) now load recharts via
  `next/dynamic(() => import("./XImpl"), { ssr: false, loading: ChartSkeleton })`.
  The recharts render bodies moved **verbatim** into `*Impl.tsx`; wrappers are thin
  dynamic boundaries. `StackedBarChart` rides the now-dynamic `BarChart`.
- **B** — Removed the chart re-export block from `components/ui/index.ts`. The 6
  consumers import from `@/components/ui/charts`. Non-chart pages no longer pull
  recharts at all.
- **C** — Recharts is now **one shared async core chunk** + small per-chart-type
  chunks. The previously **duplicated** 461K gradebook copy is eliminated.

### Results (first-load JS, uncompressed; gzip ≈ ÷3)
| Metric | Before | After |
|---|---|---|
| Routes shipping recharts in first-load | **27** | **0** |
| Chart routes (`/`, `/analytics`, `/teacher`, `/teacher/analytics`, `/teacher/gradebook`) | ~1.43–1.45 MB | **~1.02 MB** (**−~0.42 MB, ~29%**) |
| Non-chart pages (`/login`, `/register`, `/profile`, `/assessments`, `/mock-exam`, `/midterm`, `/pastpapers`, `/practice-tests`, `/vocabulary/*`) | ~1.42–1.45 MB | **~0.99–1.02 MB** (**−~0.42 MB**) |
| Recharts chunk topology | 2 × **full 461K copies** (one a pure duplicate) | 1 shared **356K core** + 5 per-type slices (28–40K) |
| Recharts bytes on disk | 922 KB (duplicated) | 516 KB |

Per-chart-type splitting means a page downloads only the chart types it renders;
recharts load now begins **after mount** (covered by the existing
`ChartSkeleton`). No visual / API / behavior / routing change.

**Reusable tool:** [`frontend/scripts/bundle-audit.mjs`](../frontend/scripts/bundle-audit.mjs)
— Next 16 emits no size table / `app-build-manifest.json`, so this parses
`.next/server/app/*.html` for chunk refs, sizes them on disk, computes the shared
baseline + per-route first-load, and fingerprints recharts chunks. Run after any
production build: `node scripts/bundle-audit.mjs`.

---

## 5. QA Results

### Build & type health
- `tsc --noEmit`: **clean.**
- Production `next build`: **clean** (all routes compile + prerender).

### Functional verification (preview MCP, `/ui-catalog` mirrors)
All five chart surfaces render charts with **0 stuck skeletons, 0 console errors**:

| Surface | Chart surfaces painted |
|---|---|
| Dashboard | 3 |
| Analytics | 3 |
| Teacher Dashboard | 2 |
| Teacher Analytics | 3 |
| Gradebook | 1 |

(`/ui-catalog` itself renders all 6 chart types — Line/Area/Bar/StackedBar/Donut/Radar — with token colors, tooltip, legend, gradients intact.)

### Consistency pass (see [`QA_REPORT.md`](QA_REPORT.md))
- Dead nav links removed (`/settings`, `/teacher/classes`, bell→routeless target).
- Cross-links wired (teacher dashboard insights → homework → grading).
- Gradebook + dashboard use **positive/neutral colors only** (growth-oriented
  language rule: no Overdue/Failed/Weak, no punishing red).
- Tokens verified clean; **320 px** no horizontal overflow; dark-mode parity;
  a11y focus rings present.

### Honesty-of-data guardrails (no fabricated metrics)
- Per-question SAT skill tags **do not exist** → Skills Radar bucketed at set
  `category` (strand) granularity; data from `assessmentSatTaxonomy` + per-attempt
  review fan-out. See [`ANALYTICS_DATA.md`](ANALYTICS_DATA.md).
- Class-level SAT strands and per-student score trend are **not available** →
  honest "insufficient data" empty states, never invented numbers.
  See [`TEACHER_DATA.md`](TEACHER_DATA.md).
- Predicted score / timeline are explicitly labeled client-side projections.

---

## 6. Remaining Technical Debt

1. **Protected runners untouched.** `/assessments/attempt` (StudentAttemptRunner)
   and `/exam` `/mock` still run on their original shells. Modernization plan
   exists but is unimplemented (`ASSESSMENT_RUNNER_MODERNIZATION.md`).
2. **Legacy `/classes` (×3)** still on old styling within the new shell.
3. **Unbuilt pages:** Settings, standalone Notifications, Teacher → Classes.
4. **Backend-blocked analytics:** per-student score **trend** and **class SAT
   strand** breakdowns require backend support; currently honest empty states.
5. **Error vs empty states** not fully differentiated on every data surface.
6. **Chart first-load skeleton flash:** `next/dynamic`'s `loading` fallback uses
   the default-height `ChartSkeleton` (no props), so the first chart on a page can
   briefly show a 280px skeleton during the one-time recharts chunk download
   before the height-correct in-`Impl` skeleton/chart takes over. Subsequent
   charts (chunk cached) have no flash. Cosmetic, one-time, per session.
7. **Two checkouts in play:** main checkout (`/Users/macbook/Projects/DSAT-mock-exam`)
   sits on `feat/access-engine-v2` with unrelated uncommitted work; the rebuild
   lives only in the worktree. `.claude/launch.json` (preview config) was created
   in the main checkout and left **untracked** — local dev convenience only.

---

## 7. Future Roadmap

1. **Merge `feat/ui-rebuild` → `main`** behind the rollback plan below.
2. **Assessment Runner Modernization** — execute the proposal: land
   characterization tests → extract headless `useAttemptEngine` + `attemptModel.ts`
   (behavior-identical) → build `StudentAttemptRunnerView` on the design system
   behind a flag → canary → 100% → delete legacy view. Apply the same playbook to
   the SAT testing-simulation runner independently.
3. **Build deferred core pages:** Settings, standalone Notifications, Teacher →
   Classes; rebuild legacy `/classes`.
4. **Unlock backend-blocked analytics** (per-student trend, class SAT strands) once
   the data exists; replace honest empty states with real charts.
5. **Differentiate error vs empty** states across all data surfaces.
6. **Polish:** height-aware chart loading fallback (pass intended height to the
   dynamic `loading`), error-vs-empty differentiation, optional Planner/Calendar/
   Achievements once product-prioritized.

---

## 8. Rollback Plan

The rebuild is **isolated and additive** — it lives on its own branch/worktree and
consumes existing APIs, so reverting carries no data risk.

### Pre-merge (current state)
Nothing is in production. To abandon: simply do not merge `feat/ui-rebuild`. The
worktree can be removed (`git worktree remove`) with zero impact on `main`.

### Post-merge — full revert
The branch is a clean linear chain of reviewable commits
(`9a29caf` foundation → … → `5b02f28` bundle opt). To back out entirely:
`git revert` the merge commit (or reset `main` to the pre-merge SHA). No DB
migrations, no API contract changes, and the one backend addition
(`set_subject`) is a read-only field that is safe to leave or revert
independently.

### Partial rollback — bundle optimization only
To revert just the chart optimization while keeping the rebuilt UI:
`git revert 5b02f28`. This restores the chart wrappers' static recharts imports
and the `@/components/ui` chart re-exports. Consumers importing from
`@/components/ui/charts` keep working (that entry point predates the change).
Cost: recharts returns to first-load JS; no functional regression.

### Per-surface rollback
Because each surface is a self-contained route + feature module that calls the
same APIs as the legacy page it replaced, an individual route can be pointed back
at its legacy implementation without touching the rest of the rebuild.

### Runner safety (when modernization proceeds)
The runner migration is **flag-gated by design** (`NEXT_PUBLIC_NEW_ATTEMPT_RUNNER`
or per-user rollout). Flag off instantly reverts to the legacy view with the engine
untouched — zero data risk on a bad canary.
