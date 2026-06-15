# MasterSAT — Frontend Rebuild: Audit, Gap Analysis, IA & Design System Proposal

> **Status:** Phases 0–3 deliverable. **Awaiting approval before any page rebuild (Phase 4+).**
> **Branch plan:** rebuild lands on a fresh `feat/ui-rebuild` cut from `main` (not the current `feat/access-engine-v2`, which has 59 uncommitted files of in-flight access-engine work).
> **Out of scope (do not touch):** Admin Panel `(admin)`, Ops console `(ops)`, Question Bank + Builder/authoring `(builder)`, and all backend/business logic. We consume existing APIs only.

---

## Phase 0 — Repository Audit

### Stack
- **Next.js 16.1.6** (App Router) · **React 19.2** · **Tailwind CSS v4** (CSS-first `@theme`) · TypeScript
- **TanStack Query v5** (server state) · **Zustand** (client state) · **react-hook-form + zod**
- **next-themes** (light/dark) · **lucide-react** (icons) · **katex** (math) · **dompurify** (SafeHtml)
- **No charting library installed** — only a hand-rolled `MiniBarChart` + `ProgressRing` (SVG).

### Route inventory (user-facing groups)

| Group | Status | Routes |
|---|---|---|
| `(main)` student | **REBUILD** | `/` dashboard · `/assessments` (+`[assignmentId]`, `/attempt/[attemptId]`, `/result/[assignmentId]`, `/review/[attemptId]`) · `/classes` (+`[classId]`, `assignments/[assignmentId]`) · `/midterm` · `/mock-exam` · `/pastpapers` (+`[packId]`) · `/practice-tests` (+`[packId]`) · `/practice-test/[id]` · `/profile` · `/vocabulary` (+`/daily`, `/words`) |
| Test runners | **REBUILD** | `/exam/[attemptId]` · `/mock/[id]` (+`/break`, `/results`) · `/review/[attemptId]` · `/frozen` |
| Auth | **REBUILD** | `/login` · `/register` |
| `(teacher)` | **REBUILD + EXPAND** | `/teacher` · `/teacher/homework` (+`grading/...`) · `/teacher/students` |
| `(ops)` console | **DO NOT TOUCH** | ops users/classrooms/assignments/midterms/audit/scoring-issues/access |
| `(builder)` | **DO NOT TOUCH** | Question Bank, imports, triage, sets, mock-exams, pastpapers authoring |
| `(admin)` | **DO NOT TOUCH** | `/admin`, assessments/assign |

Total ~23,500 lines across page files. Heaviest student pages: class assignment detail (1,018), assessment result (777), profile (742), assessment review (724).

### API / data layer (what we consume — unchanged)
Centralized in `lib/api.ts` + `lib/*Contract.ts` + feature `api.ts`/`hooks.ts`:
- **`usersApi`** — `getMe`, `patchMe`, Telegram link, `listExamDates`
- **`authApi`** — csrf, register, login, google/telegram auth, logout, refresh, sessions
- **`examsPublicApi`** — mock exams, practice tests, attempts, `startTest/startModule`, engine `start/resume/pause`, `submitModule`, `saveAttempt`, results, review, pastpaper + practice packs
- **`classesApi`** — list/get/create/join, people, leaderboard, stream, workspace, comments, posts, assignments CRUD, submissions, **`gradeSubmission`**
- **`vocabularyApi`** — listWords, getDaily, review
- **`assessmentsStudent` / `assessments` hooks** — assignment-based assessments
- (admin/builder APIs exist but are out of scope)

**Implication:** every screen we rebuild already has a typed data source. No backend work required for the core rebuild.

### Critical infrastructure to preserve
- `AuthGuard` (+ `adminOnly`), `useMe`, `useAuthCriticalGate` — auth gating & resilience
- `features/testing-simulation/*` — exam runner with **autosave, multi-tab, submit-recovery** (hard-won P0 fixes). Logic preserved; **only presentation is reskinned.**
- `MathText` / `SafeHtml` / KaTeX — math + sanitized HTML rendering (must keep wrappers)
- Idempotency keys on mutating exam endpoints

---

## The core problem (why a rebuild, not a patch)

**Four competing, overlapping component systems** — the root of the design debt:

| System | Has | Notes |
|---|---|---|
| `components/ui/*` | Badge, IconButton, Tooltip, DropdownMenu, EmptyState, StatCard, ProgressRing, PageHeader, MiniBarChart, ActivityItem | The "intended" library — but **no Button, Input, Modal, Tabs, Table, Toast** |
| `components/classroom/*` | **Button**, **Card**, **Modal**, **Tabs**, **Skeleton**, EmptyState, PageHeader, Field, Alert, inputStyles | A second, parallel library |
| `components/studio/*` | primitives, StudioEmptyState, StudioSpinner | A third |
| `components/ops/ui.tsx` | ops-local primitives | A fourth |

Plus one-off overlays: `CreateAssignmentModal`, `GoalScoreModal`, `ops/AssignmentDrawer` — **Modal reimplemented ≥3 times.**

**Token debt:** `globals.css` has a clean modern token set *layered on top of* legacy `--ds-*` tokens, **all of which have been collapsed to the same blue** (`--ds-gold: #2563eb`, `--ds-secondary: #2563eb`, `--ds-accent: #2563eb`). The "design system" no longer has secondary/accent/semantic color distinction — everything is one blue. There are 13 ad-hoc `.ds-*/.ui-*/.app-*` utility classes carrying styling that should be component-owned.

**Net effect:** inconsistent spacing/radii/shadows, no shared semantic color scale, duplicated logic, and no charting capability — exactly the fragmentation described.

---

## Phase 1 — Product Gap Analysis

Comparing against premium SAT/LMS products (Khan Academy, Duolingo, Stripe-grade dashboards), these journeys are missing or dead-ended.

### Student gaps
| Page / module | Why needed | Belongs at | Data source |
|---|---|---|---|
| **Analytics / Performance** | No dedicated analytics route; dashboard can't carry deep insight. Charts (score progression, section breakdown, skill radar) have nowhere to live. | `/analytics` | attempts, results, review data (exists) |
| **Notifications Center** | Top-bar bell is a hardcoded "all caught up" stub. | `/notifications` | derive from assignments + grades (client) initially |
| **Learning Goals** | `GoalScoreModal` exists but no goals home; no milestones surface. | `/goals` | local + target score (me) |
| **Achievements / Milestones** | Engagement loop (Duolingo-style) referenced but no page. | `/achievements` | derived client-side from activity |
| **Study Planner / Calendar** | No way to plan toward an exam date (`listExamDates` exists, unused for planning). | `/planner` | examDates + assignments |
| **Activity Timeline** | No unified history of attempts/submissions. | `/activity` | attempts + submissions |
| **Resource Library** | Resource discovery is scattered across pastpapers/practice/mock with no unified browse/filter. | `/library` | packs + practice + mock |
| **Settings** | Account settings are crammed into `/profile`; no separation of profile vs. preferences/sessions/security. | `/settings` | usersApi + authApi sessions |

### Teacher gaps (today only Dashboard / Homework / Students exist)
| Page / module | Why needed | Belongs at | Data source |
|---|---|---|---|
| **Gradebook** | No matrix view of students × assignments with scores. | `/teacher/gradebook` | classes + submissions |
| **Grading Center** | Grading exists buried under homework; needs a first-class queue across classes. | `/teacher/grading` | listSubmissions + gradeSubmission |
| **Class Insights / Analytics** | No class-level performance analytics for teachers. | `/teacher/analytics` | leaderboard + submissions + results |
| **Assignments manager** | Assignment CRUD is per-class only; no cross-class assignment view. | `/teacher/assignments` | assignments API |
| **Journal / Feedback Center** | No place for ongoing student feedback/notes. | `/teacher/journal` | comments/posts (exists); may need light backend later |
| **Attendance** | Listed as expected LMS capability; **no backend model today** → propose as design + stub, flag backend need. | `/teacher/attendance` | ⚠ needs backend (out of current scope) |
| **Reports** | No exportable class/student reports. | `/teacher/reports` | composed from above |

### Parent (future)
**Parent Reports** require a parent role + backend relationships that don't exist. **Recommendation: design the IA slot, defer implementation**, flag as backend-dependent.

> **Rule applied:** pages backed by existing APIs → build now. Pages needing new backend (Attendance, Parent, persistent Journal) → design + clearly flag the backend dependency, don't fabricate.

---

## Phase 2 — Information Architecture & Navigation

### Student nav (rebuilt — grouped by intent)
```
LEARN
  Dashboard        /
  Analytics        /analytics          ← NEW
  Goals            /goals              ← NEW
  Classes          /classes
  Assessments      /assessments

PRACTICE
  Library          /library            ← NEW (hub for the four below)
  Past papers      /pastpapers
  Practice tests   /practice-tests
  Timed mock       /mock-exam
  Midterm          /midterm

GROW
  Vocabulary       /vocabulary
  Achievements     /achievements       ← NEW
  Planner          /planner            ← NEW

ACCOUNT
  Profile          /profile
  Settings         /settings           ← NEW
  Notifications    /notifications      ← NEW (also top-bar)
```

### Teacher nav (rebuilt + expanded)
```
OVERVIEW   Dashboard /teacher · Analytics /teacher/analytics ←NEW
TEACH      Classes · Students · Assignments ←NEW
ASSESS     Homework · Grading /teacher/grading ←NEW · Gradebook ←NEW
RECORDS    Journal ←NEW(partial) · Attendance ←NEW(⚠backend) · Reports ←NEW
```

### Role architecture
Student (default) · Teacher (`adminOnly` gate today — staff flag) · Admin/Ops (untouched) · Parent (**designed, deferred**). Keep current gating; no role-model changes.

---

## Phase 3 — Design System Proposal

A single, authoritative system replacing all four legacy ones. Tailwind v4 `@theme` tokens + one component library at `components/ui/*`. Legacy `ds-*`/`classroom/*`/`studio/*` get deleted as pages migrate.

### Brand direction
**"Quiet luxury academic."** Stripe/Linear restraint + Khan Academy clarity. Generous whitespace, one confident accent, strong type hierarchy, soft depth (no heavy shadows), motion that confirms rather than decorates.

### Color tokens (full semantic scale, light + dark)
Restores the scales the legacy system flattened to one blue.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | `#4338ca` indigo-700 | `#818cf8` | brand, primary actions |
| `--accent` | `#0ea5e9` sky | `#38bdf8` | highlights, focus, links |
| `--success` | `#059669` | `#34d399` | correct, passed, on-track |
| `--warning` | `#d97706` | `#fbbf24` | due-soon, caution |
| `--danger` | `#dc2626` | `#f87171` | overdue, errors, wrong |
| `--info` | `#0284c7` | `#38bdf8` | neutral info |
| surfaces | `bg #ffffff` → `surface-1 #f8fafc` → `surface-2 #f1f5f9` | `#0b1120` → `#111827` → `#1e293b` | elevation ladder |
| text | `#0f172a / #475569 / #94a3b8` | `#f1f5f9 / #cbd5e1 / #94a3b8` | primary/secondary/muted |

Each semantic color also gets a `-soft` (tinted bg) and `-foreground` pairing for badges/banners. Charts use a dedicated 6-color categorical ramp derived from these.

### Typography
Display face (e.g. fluid `clamp` for hero numbers) + `--font-sans` UI + `--font-serif` for long-form reading passages (already present).

| Token | Size / weight | Use |
|---|---|---|
| display | `clamp(2.5rem,5vw,3.5rem)` / 800 | dashboard hero score |
| h1 | 1.875rem / 700 | page titles |
| h2 | 1.5rem / 700 | sections |
| h3 | 1.25rem / 600 | cards |
| h4 | 1.0625rem / 600 | sub-cards |
| body | 0.9375rem / 400 | default |
| small | 0.8125rem / 500 | meta |
| caption | 0.6875rem / 600 uppercase tracking | labels |

### Shape, depth, motion
- Radius: `sm .5rem · md .75rem · lg 1rem · xl 1.25rem · 2xl 1.5rem · full`
- Shadow: 4-step soft ladder (`xs→lg`) tuned per theme; glass (`backdrop-blur`) reserved for sticky bars/overlays only.
- Motion: 120/180/240ms, `cubic-bezier(.2,.8,.2,1)`; respect `prefers-reduced-motion`.

### Component library (single source — `components/ui/*`)
Foundations: **Button** (variants: primary/secondary/ghost/danger/outline + sizes + loading), **Input, Textarea, Select, MultiSelect, Checkbox/Radio/Switch, Field/Label**.
Layout & surface: **Card, PageHeader, Section, Separator, Tabs, Accordion**.
Overlays: **Modal, Drawer, Tooltip, Popover, DropdownMenu, Toast** (consolidate the 3+ modal impls into one).
Data display: **Table** (sortable/sticky), **Pagination, Badge, Avatar, Progress, ProgressRing, Stat/StatCard, Skeleton, EmptyState**.
Feedback: **Alert/Banner, Spinner, Toast**.
**Charts wrapper** — see below.

### Charting (decision needed — see questions)
No library installed. Options: **(A) Recharts** (fastest, declarative, React-19-ready, ~heavier bundle) · **(B) lightweight SVG primitives we own** (line/area/bar/donut/radar — zero deps, full control, more code) · **(C) visx** (powerful, more boilerplate). All chart usage goes behind a `Chart*` wrapper so the underlying lib is swappable. **Recommendation: Recharts**, wrapped, with our token-driven color ramp + skeleton/empty states baked in.

### Theming & a11y
Both themes are first-class (every token has a dark value). WCAG 2.1 AA contrast on all text/interactive pairs; visible `:focus-visible` rings; full keyboard nav; reduced-motion honored; semantic ARIA on overlays/tabs/menus.

---

## Proposed rebuild sequence (Phases 4–10, post-approval)
4. **Foundation** — tokens + component library + chart wrapper + theme (the bar-setter).
5. **Auth** — login/register.
6. **Dashboard** — flagship analytics-grade home.
7. **Student** — classes, assessments, vocabulary, profile/settings, + new Analytics/Goals/Library/Notifications.
8. **Test experiences** — practice/mock/midterm/pastpapers/review (reskin, preserve runner logic).
9. **Teacher** — dashboard, classes, students, homework, + new Grading/Gradebook/Analytics/Assignments (Journal/Attendance designed, backend flagged).
10. **Newly proposed pages** finalize · **QA** — responsiveness, a11y, perf (code-split, lazy charts, memoization, virtualized tables).

Each page gets an independent UX pass — no single template reused blindly.

---

## Open decisions for approval
1. **Chart library:** Recharts (recommended) vs. own-SVG vs. visx.
2. **New-page depth:** build all API-backed new pages now, or core set first (Analytics, Notifications, Library, Settings, Teacher Grading/Gradebook) then the rest?
3. **Backend-dependent pages** (Attendance, Parent, persistent Journal): design-only placeholders now, implement later — confirm OK.
4. **Migration cadence:** delete legacy component systems as each area migrates (keeps both alive briefly) vs. big-bang removal at the end.
