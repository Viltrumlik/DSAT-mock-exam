# Teacher panel — foundation and the new Dashboard (design)

The teacher panel is being rebuilt, design and functions both. This spec covers only the
**first delivery**: a real component kit in the look the owner chose, proven by rebuilding
one screen — the Dashboard. Every other teacher page keeps its current look until its own
turn.

The owner runs MasterSAT, a SAT-prep learning center in Uzbekistan. Eleven teachers and one
support teacher work in this panel; twenty-eight classes are live.

## 1. Why this, and why first

Two teachers answered the feedback letter of 2026-09-14. Their answers and a read-only prod
census (30 days to 2026-09-19) agree:

| What | Evidence |
| --- | --- |
| Attendance is the daily core | 228 sessions, 1,977 marks by 11 different people |
| Homework is the second core | 201 assignments created by 8 teachers |
| Mock sittings and question analysis are dead | 30 and 63 API calls in 7 days; both teachers named them as never used |
| Human grading is near-dead | 32 grades by 2 people; 188 turned-in submissions unchecked |
| Materials are unused | 3 uploads |
| Teachers work on a laptop | 82% of requests desktop, 18% phone |
| The phone is for the Dashboard | 1,947 of 3,632 phone requests land on `/teacher` |

Both teachers, asked what they want to see on opening, named the same thing: **today's
lessons with their times, and who has not uploaded homework**. Today's Dashboard shows
neither. It shows class averages, completion percentages and charts that neither teacher
mentioned, and it is the panel's heaviest page — it fans out two requests per class.

## 2. Decisions

Recorded from the owner on 2026-09-20 (D1–D4 answered directly):

- **D1. The foundation comes first**, before the three defects the teachers reported (the
  assignment edit form that cannot publish, the second attachment that overwrites the first,
  and past papers being unreachable on the teacher host). Those are specified separately and
  can be pulled forward at any time on the owner's word.
- **D2. The panel wears the student dashboard look** — the `.dzboard` scope: Plus Jakarta
  Sans, filled cards, a coloured spine, colour used freely. Not the classroom kit.
- **D3. The first delivery is the kit plus the Dashboard.** Not the kit alone, and not a
  third screen with it.
- **D4. The old Dashboard's charts and averages are removed**, not demoted. The owner's
  reason accepted here: no teacher asked for them, and one teacher already distrusts the
  platform's numbers.
- **D5 (ruling).** The sidebar keeps its items, their order, their labels and their routes.
  Only the look changes. This panel's sidebar shape has been restored by the owner once
  before; its contents are a separate decision, taken after this delivery.
- **D6 (ruling).** No student-facing file changes in this delivery. The `.dzboard` scope is
  read as tokens only; nothing under `app/(main)` is edited.

## 3. The look is not a kit today — that is the work

`.dzboard` (`frontend/src/app/globals.css:1011`) is a **token scope**, not a component
library: fourteen colour tokens, the Plus Jakarta face, and a set of animation and hover
classes. A page wears it by wrapping itself in `<div className="dzboard">` and then writing
every card, button and row as inline styles over `--dz-*`. `.dark .dzboard`
(`globals.css:1033`) redefines the same tokens, so dark mode arrives for free.

That is workable for one hand-built page and it does not survive twenty. The student
mock/practice pages already hand-copy this palette as raw hex, which is exactly the drift
this rebuild exists to end.

**So the foundation is: turn the look into components.** Nothing else in this delivery is
new design work.

### 3.1 The kit

New directory `frontend/src/features/teacher/ui/`, exported through one `index.ts`. Every
component styles itself from `--dz-*` tokens. None of them import from
`features/classroom/ui` or from `components/ui`.

| Component | What it is |
| --- | --- |
| `TeacherPage` | Page frame: wraps children in `.dzboard`, caps width at 1280, renders the title row and optional actions |
| `Card` | The dz card: radius, shadow, optional coloured spine, optional header row |
| `Stat` | One number with a label and optional tone |
| `DataTable` | **New to this look.** A dense table: sticky header, 40px rows, no per-row shadow. Lists are what teachers read all day and the dz card idiom is too heavy for them |
| `Pill` | Status chip, tones neutral/info/success/warning/danger |
| `Button` | primary / ghost / danger, with a busy state |
| `Field` | Label, control, hint, error |
| `EmptyState` | Nothing to show, with an optional action |
| `ErrorState` | A request failed, with a retry. Never looks like `EmptyState` |
| `Skeleton` | Loading placeholder sized to the block it replaces |
| `Dialog` | Modal with a confirm/cancel footer |

Toasts are **not** rebuilt: the panel already has `pushGlobalToast` via `@/lib/toastBus` and
a provider in the root layout. The kit uses it as-is.

`DataTable` is the only component whose visual language does not exist yet. It stays inside
the dz palette and face, and differs only in weight: hairline row separators instead of
cards, one tone of ink for figures, no hover lift.

### 3.2 The shell — corrected during the build

The plan here was for `TeacherAppShell` to wear the scope and for the sidebar, top bar and
mobile drawer to be restyled from the same tokens. They are not, and deliberately:
`components/shell/AppShell.tsx` is **one 730-line component shared by the student shell and
the teacher shell**, so restyling it would change what students see, against D6.

Instead `TeacherPage` — the kit's page frame — carries the `.dzboard` scope, and a page wears
the look by wearing the frame. The chrome around it stays as it is. That is also the truer
reading of D2: on the student side the dashboard's look sits inside this same chrome, so a
teacher page in the same look and the same chrome matches the screen the owner pointed at.

Forking the chrome for teachers, or giving `AppShell` a skin flag, is a decision for the
sub-project that takes on the sidebar's contents (D5), not for this one.

## 4. The Dashboard

Route `/teacher`, component `features/teacher/TeacherDashboard.tsx` — rebuilt in place, same
route. Four blocks, top to bottom.

### 4.1 Today's lessons

The block both teachers asked for. One row per class that has a lesson today, in time order:

- class name, subject and lesson time;
- how many students are in the class;
- for the homework due at that lesson: how many have turned it in, and how many have not;
- the names of those who have not, revealed by expanding the row — not a separate page.

A teacher whose classes have no lesson today sees a quiet line naming their next lesson day.
That is an empty state, not an error, and the block still renders.

Lesson days are `Classroom.lesson_days` (ODD = Mon/Wed/Fri, EVEN = Tue/Thu/Sat, Sunday
belongs to neither) and `Classroom.lesson_time`. The parsing already exists on both sides —
`backend/classes/lesson_schedule.py` and `frontend/src/lib/classroomSchedule.ts` — and must
not be reimplemented. 27 of 28 live classes carry a parseable time; a class whose time cannot
be parsed is listed under the timed ones with "Time not set", never dropped.

### 4.2 Waiting to be checked

One row per class with a count of submissions turned in and not yet reviewed, newest first,
linking to that class's grading view. Auto-graded homework never appears here: it is reviewed
on completion and never enters the queue.

This block is the one number that says out loud what the census found — 188 pieces of work
waiting. It is deliberately not dressed up as a warning; it is a count and a link.

### 4.3 Upcoming midterms

Scheduled midterms for the teacher's classes within the next 14 days: title, class, date and
the pass mark. The date is `MidtermSchedule.starts_at`; a schedule with no `starts_at` is not
upcoming and is left out. The pass mark is shown because the teachers asked to see pass and
fail as green and red; this is the first place that number appears in the teacher panel.
Colouring students green and red belongs to the midterm screens, not here.

### 4.4 Students needing attention

Kept as it works today: students with overdue homework, long inactivity, or a falling score.
**Ruling:** this block keeps using the existing per-class `interventions` endpoint, loaded
below the fold, one request per class. The logic behind that endpoint is 150 lines inside a
ViewSet action (`backend/classes/views.py:1627`) and extracting it into a service belongs to
the sub-project that rebuilds the students and progress screens, not to this one. Cost if
wrong: this block stays on the old fan-out one delivery longer than the rest of the page.

## 5. The API

One new read-only endpoint carries blocks 4.1 to 4.3.

`GET /api/classes/teacher/today/`

- Staff only, and scoped to classes the caller is a member of — the same membership scoping
  every other classroom endpoint uses. An admin sees the classes they are a member of, not
  all twenty-eight.
- Timezone is the platform's `Asia/Tashkent`; "today" is the caller's local date.
- Response:

```json
{
  "date": "2026-09-20",
  "lessons": [
    {
      "classroom_id": 12,
      "name": "Math Junior 3",
      "subject": "MATH",
      "lesson_time": "18:00",
      "student_count": 14,
      "homework": {
        "assignment_id": 55,
        "title": "Linear functions, set 4",
        "turned_in": 9,
        "missing": 5,
        "missing_students": [{ "id": 81, "name": "Student Name" }]
      }
    }
  ],
  "waiting_to_check": [{ "classroom_id": 12, "name": "Math Junior 3", "count": 7 }],
  "upcoming_midterms": [
    { "midterm_id": 3, "title": "September midterm", "classroom_id": 12,
      "name": "Math Junior 3", "starts_at": "2026-09-24T10:00:00+05:00", "pass_mark": 60 }
  ]
}
```

- `homework` is `null` when no published homework is due at that lesson. `missing_students`
  is the whole list, not a sample — classes here run to about twenty students — and it
  carries an id and a display name, never an email, an avatar or a score.
- Turned in means what the interventions endpoint already means by it, so two screens cannot
  disagree: a submission the student sent, including one sent back for revision.
- The whole payload is built in a service module, `backend/classes/teacher_today.py`, so the
  view stays thin and the service is testable without HTTP.

## 6. Copy

- "learning center", never "school".
- Growth-oriented: "Missed", never "Absent"; "Not turned in", never "Failed to submit".
- "class list", never "roster" — the owner has asked twice.
- Numbers carry their unit in the label, not a bare figure with a colour.

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| A request fails | `ErrorState` with a retry, inside that block. The rest of the page still renders. A failed request never renders as "nothing here" |
| The teacher has no classes | One empty state for the page, naming what to do next |
| No lesson today | 4.1 renders a line naming the next lesson day |
| `lesson_time` unparseable | Listed after the timed classes as "Time not set" |
| A class has two lessons in a day | Not possible: `lesson_days` gives one lesson per day |
| Phone width | All four blocks stack; today's lessons stay expandable; no horizontal scroll at 360px |
| Dark mode | Inherited from `.dark .dzboard`; every kit component is checked in both |

## 8. Testing

- **Kit:** one vitest per component covering its states, including `ErrorState` rendering a
  retry and `EmptyState` rendering none.
- **Dashboard:** vitest over the four blocks — today's lessons with and without homework, the
  no-lesson day, a failed request per block, and the phone layout. Tests assert list content,
  not just that something rendered.
- **Backend:** targeted tests for `teacher_today` only — membership scoping (a non-member sees
  nothing), the ODD/EVEN day mapping, an unparseable time, homework counted the way
  interventions counts it, and a class with no homework. Run only these labels; the full suite
  takes about thirty minutes.
- No screenshots are fabricated. Any that are shown come from a real render.

## 9. Out of scope

Named so the next sub-project can pick them up: the sidebar's contents; the three reported
defects; attendance, homework, midterm and grading screens; the classroom workspace, which is
shared with students and must be split before it is touched; the ranking tie rule; the coin
shop, the homework streak and lesson notifications, all three of which are student-facing and
were raised as teacher priorities.

## 10. Rollout

One PR. Until the following sub-projects land, the Dashboard wears the new look and the rest
of the panel wears the old one. The owner accepted this when choosing the kit-plus-Dashboard
delivery; it is the cost of shipping in slices rather than in one switch.

No migration is added. The endpoint is read-only. Rollback is the release symlink.
