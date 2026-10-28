# iOS — Class tab merged with Roadmap (owner's "Class page mastersat" design)

Owner, 2026-10-28: "class page va roadmapni shu mockup kabi birlashtiring qolgan narsalarni ham shu
tariqa qilib shu mockupga moslang" — then: apply the given design to the REAL app (not mockups).

Design source (ready, owner's): `Class Tab.dc.html`, `Class Detail v4.dc.html` (+ `Today Home v5`,
unchanged from "Master SAT Home (animated)"). Copies + renders: primary checkout
`ios-redesign/mockups/ref/class-v2/` (`class-tab-body.txt`, `class-detail-body.txt` = the markup and
the JS that computes every colour/state). Visual details are taken from there, not re-invented.

## What the design is

**Class tab**
- Blue band, title "Class" (Archivo-style heavy, 32), bell + avatar (the existing header actions).
- Per subject, one horizontal pager of level cards over the band's lower edge:
  - Math: Foundation · Junior · Middle · Senior.
  - Reading & Writing: Junior · Middle · Senior.
- Each card:
  - a gradient from the level palette and a huge faint subject icon;
  - a pill: Completed ✓ / Current ◉ / Locked 🔒;
  - the level name, "X / Y lessons covered", a bar and a %;
  - a locked card instead says "N lessons · Unlocks after <previous>".
  - Pages snap; the pager opens on the current level; dots show the level.
  - Tapping the current or a completed card opens that class page.
- A semicircle SAT SCORE gauge: 400–1600, the score counts up, and a ring marks the target with "Target N".
- The page background is a lavender→peach gradient.

**Class page** (one per class = subject + level)
- A dark page tinted from the level palette (the reference's `mix()` formulas), with a dot texture.
- A glass top strip with a back button.
- A glass class card: subject icon, class name, days · time, room, teacher.
- Sessions (= the level's lessons) stacked bottom-up as glass cards, numbered top-down from the
  highest. Each card holds:
  - "Session N" and a badge: Completed / In progress / Locked;
  - an "x/3 done" bar and a reward pill;
  - a winding 3-node trail, bottom to top: **Topic** (the roadmap reading) → **Classwork** →
    **Homework**.
- Node states: done (check), now (a white disc with a pulsing ring and a white popover with a
  gradient "Resume" button), to-do, locked.
- A glowing connector between cards. Opening the page scrolls to the current session.
- A dark glass tab bar with a white selected pill.

## Data (what exists — research on origin/main `bd61fbef`)

| Design element | Source | Status |
|---|---|---|
| Levels per subject, lessons per level, covered/total | `GET /classes/roadmap/` tracks → levels → lessons (`backend/classes/roadmap.py`) | exists |
| Session list, date, homework, topic read | the roadmap lessons: `lesson_number`, `state`, `assignment_id`, `scheduled_for`, `delivery_id`, `has_roadmap`, `roadmap_read`, `is_midterm` | exists |
| Classwork step per session | `ClassroomLesson.classwork_assignment` exists, but is **not in the payload** | server addition |
| Class name, days/time, room, teacher | `GET /classes/` (`lesson_days`, `lesson_time`, `room_number`, `teacher_details`) | exists |
| Target score | `User.target_score` (`GoalSheet`) | exists |
| Current SAT score | no single field; the closest is `GET /mocks/mine/` → `total_score` | owner question 1 |
| "+30 coins" per session | nothing pays per session; coins only come from converting points | owner question 2 |

## Decisions (★ = recommended, owner answers one at a time)
- **Q1 SAT score on the gauge — ANSWERED (2026-10-28).** The owner: "har bir levelga o'tganda score
  o'zgaradi levellarga qarab qancha score olishi aytiladi". The gauge shows the score the student's
  current levels stand for, not a test result.
  - Ladder (owner picked): **Math Foundation 450 · Junior 550 · Middle 650 · Senior 750; English
    Junior 550 · Middle 650 · Senior 750**.
  - Gauge = the current Math level + the current English level (Junior + Junior = 1100). The target
    ring is `User.target_score`.
  - A student with one subject only sees that section on a 200–800 gauge ("MATH SCORE").
  - The ladder is a kit constant: there is no server field, and a server setting can come later.
  - Each level card may also say the score that level stands for.
- **Q2 reward pill on a session — ANSWERED: "Up to +20 XP".**
  - It is computed from `/rewards/rules/`: attendance-present + homework max (5 + 15 by default).
    Classwork is not added, because it is teacher-picked per carrier.
  - It is an XP pill (bolt), not a coin pill. A locked session shows it dimmed.
  - No server change.
- Everything else follows the design. The old Class segments go where the design puts them:
  - **Tasks** — the to-do stays on Today; "See all" opens the class page at the current session.
  - **Schedule** — per-session dates on the trail, plus the days/time on the class card.
  - **People / Files / Telegram group** — a "Class info" sheet from the class card.
  - **Midterms** — the roadmap's midterm markers (every 12th lesson) become a midterm card in the
    trail that opens the midterm.
- Explore loses its Roadmap card. Roadmap links (`/roadmap`, `/roadmap/<delivery>`) open Class / the
  topic.

## Tasks
- **S1 (backend)** — the roadmap lesson payload adds `classwork_assignment_id` (released deliveries
  only) and `classwork_done` (the student has a submission on it, or a classwork award on that
  delivery). Add tests. Backwards compatible: the web ignores the new keys.
- **K1 (kit)** — decode the new keys. Add the `ClassLevelCard` model (track/level → completed /
  current / locked, covered/total/pct, unlocks-after) and the `SessionTrail` model (lesson → 3 steps,
  each done/now/todo/lock; the session state; x/3; midterm marker). The "now" step is the first
  step not done in the first session not done. Tests.
- **K2 (kit)** — score source per Q1 plus the gauge maths (clamp 400–1600, angle, target marker).
  Tests.
- **K3 (kit/app)** — the level palette (7 gradients from the design) and the derived dark theme
  (`mix` with dark/white, exactly as the design computes it). Tests on the colour maths.
- **A1** — Class tab: band header, two level pagers with dots, the gauge, and loading / error /
  empty states (no classes; one subject only).
- **A2** — Class page: themed background, glass header and class card, the session list with the
  trail (Path), node states, the Resume popover, auto-scroll to now, and the glass tab bar.
  Routes: Topic → `RoadmapReadingView(delivery)`, Classwork → the classwork assignment, Homework →
  `HomeworkDetailView`, Midterm → the midterm.
- **A3** — Class info sheet: schedule, teacher, room, People, Files, Telegram group (existing views,
  restyled).
- **A4** — routing and cleanup: AppLink classroom/roadmap targets; Today's lesson cards and "See
  all"; the Explore Roadmap card; delete the now-unused segments.
- **A5** — Reduce Motion (no count-up, no pulse, no path drawing), dark mode, Dynamic Type up to
  AX5, VoiceOver labels on the nodes.
- **V** — kit tests, app build, simulator check on local data (seed with sessions in every state),
  screenshots, PR.

## Not in this PR (next, same design language)
- **Today** to "Master SAT Home (animated)": logo band, 4 stat cards, Services, Shop rail. The Daily
  Challenge and the daily goal need the server first.
- The other tabs, adapted to fit (my earlier mockups in `ios-redesign/mockups/` are the guide).
