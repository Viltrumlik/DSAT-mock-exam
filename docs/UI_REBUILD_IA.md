# MasterSAT — Information Architecture & Sitemap (Approval Deliverable)

> **Gate:** This is the pre-implementation IA approval document. No code until approved.
> Companion to `docs/UI_REBUILD_AUDIT.md` (audit + design-system proposal).
> **Language rule applied throughout:** growth-oriented status labels only — no "Overdue / Failed / Behind / Weak." Use "Needs attention / Focus area / Practice recommended / On track / Building momentum / Almost there / Goal reached."

---

## 1. Existing Pages Inventory

### Student `(main)` — REBUILD
| Route | Purpose | Primary API |
|---|---|---|
| `/` | Dashboard / home | me, attempts, results, assignments |
| `/assessments` | Assigned assessment workspace | assessments hooks, assessmentsStudent |
| `/assessments/[assignmentId]` | Assessment intro/launch | assessments |
| `/assessments/attempt/[attemptId]` | Take assessment | assessments |
| `/assessments/result/[assignmentId]` | Assessment results | assessments |
| `/assessments/review/[attemptId]` | Review answers | assessments |
| `/classes` | My classes | classesApi.list |
| `/classes/[classId]` | Class detail (stream, leaderboard, people) | classesApi.get/stream/leaderboard/people |
| `/classes/[classId]/assignments/[assignmentId]` | Class assignment + submission | classesApi assignments/submissions |
| `/midterm` | Midterm landing | examsPublicApi (midterm) |
| `/mock-exam` | Timed mock landing | examsPublicApi.getMockExams |
| `/pastpapers` + `/[packId]` | Past-paper packs | examsPublicApi pastpaper packs |
| `/practice-tests` + `/[packId]` | Practice-test packs | examsPublicApi practice packs |
| `/practice-test/[id]` | Single practice test detail | examsPublicApi.getPracticeTest |
| `/profile` | Profile + account (overloaded) | usersApi, authApi sessions |
| `/vocabulary` `/daily` `/words` | Vocabulary trainer | vocabularyApi |

### Test runners (standalone) — REBUILD (reskin only)
| Route | Purpose | Note |
|---|---|---|
| `/exam/[attemptId]` | Assessment runner shell | wraps `features/testing-simulation` — **preserve logic** |
| `/mock/[id]` `/break` `/results` | Mock exam runner + break + results | engine autosave/recovery — **preserve logic** |
| `/review/[attemptId]` | Post-exam review | preserve logic |
| `/frozen` | Account/attempt frozen state | gating UX |

### Auth — REBUILD
`/login` · `/register`

### Teacher `(teacher)` — REBUILD + EXPAND
| Route | Purpose | Primary API |
|---|---|---|
| `/teacher` | Teacher ops dashboard | classesApi + lifecycle |
| `/teacher/homework` | Homework hub | classesApi assignments |
| `/teacher/homework/grading` + `/[classId]/[assignmentId]` | Grading views | listSubmissions, gradeSubmission |
| `/teacher/students` | Student roster | classesApi.people |

### Untouched (documented, not rebuilt)
`(admin)` `/admin`, assessments/assign · `(ops)` full console · `(builder)` Question Bank + authoring.

---

## 2. Missing Pages Inventory

### Build now (core set — existing APIs, clear journey, immediate value)
| Page | Route | Why | Data source |
|---|---|---|---|
| Student Analytics | `/analytics` | No home for deep performance insight / charts | results, review, attempts |
| Student Progress Reports | `/analytics/report` (or `/progress`) | Shareable period summary of growth | results over time |
| Notifications Center | `/notifications` | Top-bar bell is a hardcoded stub | derived: assignments + grades |
| Resource Library | `/library` | Unified discovery across pastpapers / practice / mock / midterm | examsPublicApi packs |
| Student Settings | `/settings` | Profile is overloaded; split profile vs. preferences/security/sessions | usersApi, authApi sessions |
| Teacher Grading Center | `/teacher/grading` | First-class cross-class grading queue | listSubmissions, gradeSubmission |
| Teacher Gradebook | `/teacher/gradebook` | Students × assignments score matrix | classes + submissions |
| Teacher Analytics | `/teacher/analytics` | Class-level performance insight | leaderboard, submissions, results |

### Deferred (later phase)
Planner, Calendar, Achievements, Activity Timeline, gamification extras, Parent Portal, Teacher Journal *(unless an API/data source already exists — none found today)*.

### Backend-dependent (design-only slot, flagged)
Attendance, Parent Reports/Portal, persistent Teacher Journal — require new models/roles. IA reserves the slot; implementation deferred.

---

## 3. Missing Features Inventory (cross-cutting)
- **Unified component library** — replace 4 overlapping systems with one `components/ui/*`.
- **Charts** — none today; add Recharts abstraction (see §below).
- **Real semantic color scale** — restore primary/accent/success/warning/danger/info (currently all one blue).
- **Notifications** — real feed instead of "you're all caught up" stub.
- **Settings/security surface** — session management exists in API (`getSessions/revokeSession`) but no dedicated UI.
- **Skeleton loaders + premium empty states** — inconsistent today.
- **Light/dark parity** — present but uneven; make every token first-class in both.
- **Analytics/insight layer** — score progression, section breakdown, skill radar — no surface today.
- **Growth-oriented status system** — replace any punishing labels.
- **Accessibility baseline** — consistent focus-visible, ARIA on overlays/tabs, reduced-motion.

---

### IA refinements (post-foundation review)
Four hierarchy decisions, now reflected below and in `components/shell/navConfig.ts`:
1. **Dashboard + Analytics are top-level** (not buried in a category) — Dashboard is the home, Analytics the flagship insight surface.
2. **Analytics ≠ Progress Report.** One exploration surface (`/analytics`); the Progress Report is a *generated, shareable snapshot* reached via an "Export report" action inside Analytics (`/analytics/report`). Not a separate nav item. Dashboard remains the at-a-glance home. (See §8/§9.)
3. **Notifications is not a sidebar item** — top-bar bell → popover (recent + quick actions) with "View all →" to the `/notifications` inbox (history/filtering).
4. **Practice split from Simulation** — self-paced study (Library hub, Past papers, Practice tests, Vocabulary) vs. full-length timed runs (Timed mock, Midterm). This retires the orphan single-item "Grow" section by moving Vocabulary into Practice.

## 4. Student Navigation Map
```
Dashboard           /                       (top-level)
Analytics           /analytics              (top-level) ← NEW
                      └ Progress report      /analytics/report  (export action, not nav)

LEARN
  Classes           /classes
  Assessments       /assessments

PRACTICE
  Library           /library                ← NEW (browse-all hub)
  Past papers       /pastpapers
  Practice tests    /practice-tests
  Vocabulary        /vocabulary

SIMULATION
  Timed mock        /mock-exam
  Midterm           /midterm

ACCOUNT
  Profile           /profile
  Settings          /settings               ← NEW
```
Top bar: command search · **notifications bell → popover → /notifications** · theme toggle · profile/avatar.
Deferred slots (not shown until built): Goals, Achievements, Planner, Activity.

## 5. Teacher Navigation Map
```
Dashboard           /teacher                (top-level)
Analytics           /teacher/analytics      (top-level) ← NEW

CLASSROOM
  Classes           /teacher/classes
  Students          /teacher/students

GRADING
  Homework          /teacher/homework
  Grading           /teacher/grading        ← NEW
  Gradebook         /teacher/gradebook      ← NEW

(Deferred: Journal, Attendance, Reports — design-only / backend-dependent)
```
Keeps the "Admin console" back-link for staff who also access `(ops)`.

---

## 6. Role Architecture Validation
| Role | Surface | Gate today | Change |
|---|---|---|---|
| Student | `(main)` + runners | `AuthGuard` | none |
| Teacher | `(teacher)` | `AuthGuard adminOnly` (staff flag) | none — reuse existing gate |
| Admin / Ops | `(admin)`, `(ops)` | existing | untouched |
| Parent | — | none | **designed slot only; needs backend role + relations — deferred** |

No role-model or backend permission changes in this rebuild.

---

## 7. Dashboard KPI Definition
Grounded in available data (me.target_score, attempts, results: percent/correctCount/totalQuestions/scaled score, assignments: due_at/submissions_count). All framed positively.

| KPI | Definition | Source | Visual |
|---|---|---|---|
| Predicted score | Latest/blended scaled total (R&W + Math, 400–1600) | results | hero display + trend delta |
| Score trend | Δ vs. previous attempts | results series | line sparkline + arrow |
| Target progress | Predicted vs. `me.target_score` | me + results | progress ring "Almost there / Goal reached" |
| Section balance | R&W vs. Math scaled | results | dual bars |
| Accuracy | correctCount / totalQuestions across recent | results | percent + ring |
| Practice volume | Attempts in last 7/30 days | attempts | bar (weekly activity) |
| Active assignments | Open assignments + soonest due | assignments | list w/ "Needs attention / Due soon" |
| Focus areas | Lowest-mastery SAT domains | review × taxonomy | up to 3 "Focus area" chips → Analytics |
| Streak (light) | Consecutive active days | attempts dates | flame stat (motivational, never punishing) |
| Next best action | Recommended pack/test from weakest domain | derived | CTA card |

## 8. Analytics Requirements
Each chart is a `Chart*` wrapper consuming tokens, light/dark, with skeleton + empty states. No raw tables where a chart communicates better.

| Insight | Chart | Data |
|---|---|---|
| Score progression over time | LineChart | results ordered by date (total + per-section lines) |
| Practice history / weekly activity | BarChart | attempts grouped by week |
| Section performance | StackedBarChart / BarChart | R&W vs. Math correct/total per attempt |
| Question distribution | DonutChart | correct / incorrect / skipped (current attempt) |
| Skill analysis (strengths vs. focus areas) | RadarChart | accuracy per SAT domain via `assessmentSatTaxonomy` |
| Learning progress | AreaChart | cumulative mastery / accuracy trend |
| Domain breakdown table (fallback) | sortable Table | per-subdomain accuracy when detail needed |

Recommendations panel: top "Focus areas" (lowest domains) → deep-link to matching practice packs. Strictly growth-framed.

## 9. New Recommended Modules (summary)
**Now:** Student Analytics (with Progress Report as an export mode at `/analytics/report`, not a separate nav item), Notifications (inbox reached via top-bar bell), Resource Library, Student Settings, Teacher Grading, Teacher Gradebook, Teacher Analytics.
**Design system modules:** unified `components/ui/*` (~30 components) + chart abstraction (`ChartCard`, `LineChart`, `AreaChart`, `BarChart`, `StackedBarChart`, `DonutChart`, `RadarChart`, `ChartEmptyState`, `ChartSkeleton`).
**Deferred:** Planner, Calendar, Achievements, Activity Timeline, gamification, Parent Portal, Teacher Journal, Attendance.

---

## Final Sitemap (approval view)
```
PUBLIC
  /login  /register

STUDENT  (StudentShell · AuthGuard)
  /                      Dashboard            [top-level]
  /analytics             Analytics            NEW [top-level]
    /analytics/report    Progress report      NEW (export action, not nav)
  Learn:       /classes  /classes/[id]  /classes/[id]/assignments/[id]
               /assessments  …/[assignmentId]  …/attempt/[id]  …/result/[id]  …/review/[id]
  Practice:    /library NEW  ·  /pastpapers /pastpapers/[packId]
               /practice-tests /practice-tests/[packId] /practice-test/[id]  ·  /vocabulary …/daily …/words
  Simulation:  /mock-exam   /midterm
  Account:     /profile   /settings NEW
  /notifications  NEW (inbox — reached from top-bar bell, not sidebar)

TEST RUNNERS  (focus mode · reskin, logic preserved)
  /exam/[attemptId]
  /mock/[id]  /mock/[id]/break  /mock/[id]/results
  /review/[attemptId]
  /frozen

TEACHER  (TeacherShell · AuthGuard adminOnly)
  /teacher               Dashboard
  /teacher/analytics     NEW
  /teacher/students
  /teacher/homework  …/grading  …/grading/[classId]/[assignmentId]
  /teacher/grading       NEW
  /teacher/gradebook     NEW

UNTOUCHED
  (admin) · (ops) console · (builder) Question Bank + authoring
```

---

## Build order
1. **Foundation** ✅ — tokens, ~30-component `components/ui/*`, chart abstraction, theme, motion, a11y base, navigation shell. (Build-verified; committed checkpoint.)
2. **Phase 5 — Dashboard** — flagship analytics-grade home (KPIs §7).
3. **Phase 6 — Authentication** — login/register.
4. **Student core** — classes, assessments, vocabulary, profile/settings, library, notifications, analytics (+ progress-report export).
5. **Test experiences** — practice/mock/midterm/pastpapers/review (reskin, runner logic preserved).
6. **Teacher** — dashboard, classes, students, homework, grading, gradebook, analytics.
7. **QA** — responsive (mobile→ultrawide), a11y (AA), perf (code-split, lazy charts, virtualized tables, memoization). Delete legacy component systems per area as migrated.
