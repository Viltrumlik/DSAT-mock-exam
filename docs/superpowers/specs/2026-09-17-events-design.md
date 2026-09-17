# Events — design

**Date:** 2026-09-17. **Status:** design approved in brainstorming with the owner. This spec is awaiting the owner's review.

**Owner's brief:** *"event create qilinayotkanda available seats qo'shiladi. masalan bitta eventga 30 kishi yozilishi mumkin … kelganlarni qo'lda attendance qilolasizmi?"* — an event is created with a number of seats (for example 30), students sign up, and the people who came are marked by hand.

## 1. Decisions

| Question | Decision |
|---|---|
| Who can sign up | Students with an account. **No outside guests** (the owner corrected an earlier answer). |
| Who creates events and marks attendance | Ops/admin only, in the ops console. Teachers do not. |
| When the seats are full | Sign-up closes and the event reads "Full". A cancellation reopens the seat. No waitlist, no over-limit adds. |
| Sign-up window | Open until the event starts. |
| Cancellation window | Until **2 hours** before the start. After that the student cannot cancel. There is no penalty for not coming; it is recorded as Missed. |
| Attendance list | Registered students only (not cancelled). Each is marked **Attended** or **Missed** individually. No "all attended" button. No walk-ins. |
| Reward | Attending pays XP and points. One amount for every event, set in the rewards rule table (default 10). |
| Notifications | On publish, all active students get a bell notification and a push. When the time or place changes, or the event is cancelled, registered students get the same. **No reminder before the event.** |
| Where students see events | Like surveys: an invitation dialog after sign-in (with a Sign up button), and a top-bar button while events are open. Unlike surveys, also a dashboard card for the nearest event. `/events` is not in the sidebar. |
| Approach | A separate `events` Django app. Rejected: reusing support booking (it would tangle two systems) and hanging sign-up off stories (attendance, rewards and deadlines would be bolted on). |

## 2. Data model — backend app `events`

**`Event`**

| Field | Notes |
|---|---|
| `title` | `CharField(160)` |
| `description` | `TextField(blank=True)` |
| `cover_image` | `ImageField(upload_to="events/", null=True, blank=True)`: plain multipart, like `stories.Story.image` and `shop.ShopItem.image`. Validated like the profile photo (image content type, 5 MB cap). |
| `starts_at`, `ends_at` | `DateTimeField`. Shown in Asia/Tashkent. Constraint: `ends_at > starts_at`. |
| `location` | `CharField(200)`, e.g. "Fergana city branch, room 3" |
| `seats` | `PositiveIntegerField`, at least 1 |
| `status` | `DRAFT` / `PUBLISHED` / `CANCELLED` |
| `published_at`, `cancelled_at` | nullable |
| `created_by` | FK to the user, `SET_NULL` |
| `created_at`, `updated_at` | |

Derived fields (no columns):
- `registered_count` counts REGISTERED rows; `seats_left` is `seats - registered_count`.
- `has_started` means `starts_at <= now`; `is_past` means `ends_at < now`.

**`EventRegistration`**, unique on `(event, student)`:

| Field | Notes |
|---|---|
| `event`, `student` | FKs |
| `status` | `REGISTERED` / `CANCELLED` |
| `cancel_reason` | `""` / `STUDENT` / `EVENT_CANCELLED` |
| `registered_at`, `cancelled_at` | |
| `attendance` | `NULL` (not marked) / `ATTENDED` / `MISSED` |
| `marked_by`, `marked_at` | nullable |

A student who cancelled and signs up again reuses the same row, back to REGISTERED.

## 3. Rules — `events/services.py`

The server enforces every rule. A hidden button is not a rule. `CANCEL_CUTOFF = timedelta(hours=2)`.

- **`sign_up(event, student)`** runs in a transaction with `Event.objects.select_for_update()`, the lock support booking already uses.
  - **Requires:** the event is PUBLISHED, `now < starts_at`, and the student is an active, non-frozen student.
  - **Already REGISTERED:** returns the row (idempotent; a double tap does nothing).
  - **No seats left:** refused with `full`. Otherwise it creates or reactivates the row.
- **`cancel_registration(registration)`** requires REGISTERED and `now < starts_at - CANCEL_CUTOFF`. Otherwise it is refused with `cancel_window_closed`.
- **`publish(event)`:** DRAFT → PUBLISHED, sets `published_at`, and notifies all active students **once** (see §5).
- **`update(event, fields)`:**
  - Refused on a CANCELLED event.
  - `seats` may not go below `registered_count`, and `ends_at > starts_at` must hold.
  - On a PUBLISHED event, a change to `starts_at`, `ends_at` or `location` notifies registered students.
- **`cancel(event)`** is allowed only before `starts_at`. PUBLISHED → CANCELLED, every REGISTERED row → CANCELLED with reason `EVENT_CANCELLED`, and registered students are notified.
  - A started event cannot be cancelled, because attendance may already have paid.
  - A draft (which can have no registrations) is deleted instead.
- **`mark_attendance(registration, value, actor)`** requires a PUBLISHED event, `now >= starts_at`, and a REGISTERED row.
  - `ATTENDED` calls `rewards.services.award(student, EVENT_ATTENDED, idempotency_key=event_attendance_key(registration.id))` with `classroom=None`. Events belong to no class: the award counts toward the student's balance and the global board, not a class board.
  - `MISSED` or cleared calls `rewards.services.revoke(key)`. A withdrawn fact takes its XP back, the same rule lesson attendance follows.
  - Corrections are allowed at any time after the start.

## 4. Rewards

- **New event code:** `EVENT_ATTENDED = "EVENT_ATTENDED"`, labelled "Attended an event". A data migration adds its `RewardRule` row: 10 points, `grants_xp=True`. The amount is changed in the rewards rule table, never in code.
- **Key:** `event_attendance_key(registration_id)` → `"event:<registration_id>"`.
- **Frontend:** the `RewardEvent` union and the `EVENT_ICON` map get the new code first. The union is closed, so an unknown event renders without an icon.

## 5. Notifications

- **New category:** `EVENTS`, "Events". Students can mute it under Settings → Notifications; it needs a `HINTS`/`LOOK` entry in `NotificationPreferencesCard`, with the CalendarDays icon.
- **New event codes, all push:** `EVENT_PUBLISHED`, `EVENT_CHANGED`, `EVENT_CANCELLED`, added to `PUSH_EVENTS`.
- **Delivery:** `notifications.services.notify_many`, a fixed number of queries whatever the recipient count, which honours muted categories. Dedupe keys:
  - `event-published:<id>`: a double publish cannot broadcast twice.
  - `event-changed:<id>:<updated_at>`
  - `event-cancelled:<id>`
- **Recipients of the publish broadcast:** "all active students" means `role=student`, `is_active=True`, `is_frozen=False`.
- **Link:** `/events`.
- **Migration:** adding choices to `Notification.category` and `Notification.event` produces an `AlterField` migration in `notifications`.

## 6. API — `/api/events/`

**Student** (`IsAuthenticated` plus the student role for writes):
- `GET /api/events/`: published events not yet ended. Each item: `id, title, description, cover_image_url, starts_at, ends_at, location, seats, seats_left, my_registration {status, attendance} | null, can_sign_up, can_cancel`.
- `GET /api/events/mine/`: the student's registrations, past ones included, with `attendance` and the points awarded.
- `POST /api/events/<id>/sign-up/`: 201 with the registration, or 409 `{"code": "full"}`, or 400 `{"code": "started" | "not_open"}`.
- `POST /api/events/<id>/cancel/`: 200, or 400 `{"code": "cancel_window_closed"}`.

**Ops.** Staff gate `rewards.views._is_reward_staff`, the gate the stories admin uses. Plain `APIView`s only, never hand-routed `.as_view({...})`:
- `GET, POST /api/events/admin/`
- `GET, PATCH, DELETE /api/events/admin/<id>/` (DELETE for drafts only)
- `POST /api/events/admin/<id>/publish/`
- `POST /api/events/admin/<id>/cancel/`
- `GET /api/events/admin/<id>/registrations/`: name, phone, registered_at, status, attendance
- `POST /api/events/admin/registrations/<rid>/attendance/` with body `{"attendance": "ATTENDED" | "MISSED" | null}`

**Host guard:** `access/host_guard.py` must allow `/api/events/` on the admin console, as it does `/api/stories/` and `/api/shop/`. Without it `/ops/events` answers 403. The apex needs no entry.

## 7. Frontend

**Student** (English copy, growth-oriented: "Missed", never "Absent"):
- **`/events`** (`app/(main)/events/page.tsx` → `features/events/EventsPage.tsx`):
  - **Upcoming** cards show the image, title, date and time, place, and "N seats left" or "Full".
  - **Card actions:** Sign up / Cancel / "You're signed up · can't cancel within 2 hours".
  - **My events:** upcoming and past, with "Attended · +10 XP" or "Missed". The XP is read from the award itself, never written into the copy.
- **`navConfig`:** `{ href: "/events", label: "Events", icon: CalendarDays, hiddenInSidebar: true }`, the same as `/surveys`. The command palette and the mobile title know the page; the sidebar does not.
- **Invitation dialog** (`features/events/EventInviteDialog.tsx`, mounted in `components/shell/StudentPrompts.tsx`):
  - Order: push opt-in → survey invite → event invite. Only one dialog at a time.
  - Shows one published event, open for sign-up, that the student has not signed up for: name, time, place, seats left, the XP it pays. **Sign up** signs up in place; **Later** closes it.
  - Once per sign-in per event (sessionStorage, like `lib/surveyInvitePrompt`), cleared on logout. Never on `/events`. Students only. A failed fetch shows nothing.
- **Top-bar button** (`components/shell/StudentHeaderExtras.tsx`): while at least one event is open for sign-up, "N upcoming events" links to `/events`. A failed fetch keeps a neutral button rather than vanishing, like the survey button.
- **Dashboard card** (`features/dashboard/DashboardEvents.tsx`, in the `.dzboard` style, under the stories rail): the nearest upcoming published event.
  - **Signed up:** "You're signed up · <day, time>".
  - **Not signed up:** seats left and a Sign up button.
  - **Full:** reads "Full".
  - **No upcoming event:** hidden.
  - **Failed load:** a one-line error with Try again, never "nothing here".

**Ops console** (`app/(ops)/ops/events/page.tsx`, plus an ops nav entry in `app/(ops)/layout.tsx` next to Stories/Surveys, in the ops console's own dialect):
- **Tabs:** Upcoming / Drafts / Past / Cancelled. Each row shows title, date and time, place, "18/30", status.
- **Create/edit form:** title, description, image, start, end, place, seats. Buttons: Save draft / Publish.
- **Event view:**
  - Counters: "Registered 18 · Attended 15 · Missed 2 · Not marked 1".
  - Registrations list: name, phone, registered at.
  - Attended/Missed per row, enabled from the start time.
  - Cancel event, with a confirmation dialog.

## 8. Edge cases

1. **Race for the last seat:** two students take it at once. The row lock admits one, and the other gets `full`.
2. **Double tap on Sign up:** idempotent, one row.
3. **Late requests:** sign-up after the start, and cancel within 2 hours, are refused by the server with a reason the page shows.
4. **Seats below registrations:** validation error, the form keeps the input.
5. **Cancelling a started event:** refused, because attendance may have paid.
6. **Attendance before the start:** refused.
7. **Attended → Missed:** XP and points are revoked, and the audit row records it.
8. **Student frozen or removed after signing up:** the registration stays, and ops can still mark it.
9. **Publishing twice** (double click, retry): the dedupe key stops a second broadcast.
10. **Failed loads:** error states everywhere, never an empty state (the house rule).

## 9. Testing

- **Backend** (`events/tests_*`):
  - seat limit, including the last seat
  - sign-up and cancel windows under a frozen clock
  - idempotent sign-up
  - attendance → award, and revoke on correction
  - publish notifies once, and muted students are skipped
  - update and cancel notifications go to registered students only
  - permissions: a student cannot reach ops endpoints, and staff pass the gate
  - host guard allows `/api/events/` on the admin host
  - Only a literal `OK` counts.
- **Frontend** (vitest):
  - card states: Full, signed up, cancel window closed, Attended/Missed
  - the invitation dialog: order with push and survey, once per sign-in, not on `/events`, failed fetch silent
  - the top-bar button
  - the dashboard card, including its error state
  - ops attendance toggles, enabled only after the start
  - Also run: tsc with a deliberate-error probe, eslint, `check:api-layer`.
- **Before the PR:** screenshots with fictional data (desktop, mobile, dark).

## 10. Out of scope

- Outside guests.
- A waitlist, or over-limit adds by admin.
- Walk-ins.
- No-show penalties.
- Reminders before an event.
- Paid events.
- Teacher-created events.
- Showing events in the dashboard calendar.
- A different reward per event.

## 11. Rollout

- **Branch:** one PR from `feat/events` (backend and frontend), with its own worktree.
- **Migrations:**
  - `events.0001`
  - a `rewards` data migration (the `EVENT_ATTENDED` rule)
  - a `notifications` AlterField (choices)
- **After deploy:** the ops console shows Events, and the student side stays quiet until the first event is published.
