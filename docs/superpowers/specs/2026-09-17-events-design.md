# Events — design

**Date:** 2026-09-17. **Status:** design approved in brainstorming with the owner, then revised the same day after the owner's review: events are announced by email, and registered students get an email reminder a day before. The revision is awaiting the owner's review.

**Owner's brief:** *"event create qilinayotkanda available seats qo'shiladi. masalan bitta eventga 30 kishi yozilishi mumkin … kelganlarni qo'lda attendance qilolasizmi?"* — an event is created with a number of seats (for example 30), students sign up, and the people who came are marked by hand.

**Owner's review:** *"rasm yuklanadi, description yoziladi. sana, vaqt belgilanadi. oshandan 1 kun oldin gmaildan sobsheniya boradi. keyin o'quvchi bu eventga yozilishi kerak bo'ladi, bookga o'xshagan. agar kelsa xp oladi"* — an image and a description go up, a date and time are set, an email goes out a day before, students book a seat, and coming pays XP. Asked who gets email and when, the owner chose: every student when the event is published, and a reminder to registered students a day before.

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
| Notifications | **On publish:** every active student gets an email, a bell notification and a push. **A day before the start:** registered students get a reminder the same three ways. **When the time or place changes, or the event is cancelled:** registered students get the same. |
| Why email | On prod (2026-09-17), 370 of 392 active students have an email address and 41 have push set up on a device. A bell notification waits until the student opens the site. |
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
| `reminder_sent_at` | nullable. The claim for the day-before reminder (§3, §5). |
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

The server enforces every rule. A hidden button is not a rule. `CANCEL_CUTOFF = timedelta(hours=2)`, `REMINDER_LEAD = timedelta(hours=24)`.

- **`sign_up(event, student)`** runs in a transaction with `Event.objects.select_for_update()`, the lock support booking already uses.
  - **Requires:** the event is PUBLISHED, `now < starts_at`, and the student is an active, non-frozen student.
  - **Already REGISTERED:** returns the row (idempotent; a double tap does nothing).
  - **No seats left:** refused with `full`. Otherwise it creates or reactivates the row.
- **`cancel_registration(registration)`** requires REGISTERED and `now < starts_at - CANCEL_CUTOFF`. Otherwise it is refused with `cancel_window_closed`.
- **`publish(event)`:** DRAFT → PUBLISHED with a conditional UPDATE (`filter(status=DRAFT)`) that sets `published_at`.
  - The UPDATE is the claim. A second publish changes no row and sends nothing.
  - Refused with `started` when `starts_at` has passed: nobody could sign up, and every student would be emailed about it.
  - Then it notifies all active students **once** and queues the announcement email on commit (§5).
- **`update(event, fields)`:**
  - Refused on a CANCELLED event.
  - `seats` may not go below `registered_count`, and `ends_at > starts_at` must hold.
  - On a PUBLISHED event, a change to `starts_at`, `ends_at` or `location` notifies registered students, by email as well (§5).
  - **A moved start re-arms the reminder.** New start more than `REMINDER_LEAD` away: `reminder_sent_at` is cleared, so the reminder goes again before the new time. New start within `REMINDER_LEAD`: `reminder_sent_at` is set to now, because the change message has just told them.
- **`cancel(event)`** is allowed only before `starts_at`. PUBLISHED → CANCELLED, every REGISTERED row → CANCELLED with reason `EVENT_CANCELLED`, and those students are notified, by email as well.
  - A started event cannot be cancelled, because attendance may already have paid.
  - A draft (which can have no registrations) is deleted instead.
- **`mark_attendance(registration, value, actor)`** requires a PUBLISHED event, `now >= starts_at`, and a REGISTERED row.
  - `ATTENDED` calls `rewards.services.award(student, EVENT_ATTENDED, idempotency_key=event_attendance_key(registration.id))` with `classroom=None`. Events belong to no class: the award counts toward the student's balance and the global board, not a class board.
  - `MISSED` or cleared calls `rewards.services.revoke(key)`. A withdrawn fact takes its XP back, the same rule lesson attendance follows.
  - Corrections are allowed at any time after the start.
- **`send_due_reminders(now)`**, called by the beat sweep (§5), picks PUBLISHED events with `reminder_sent_at` NULL, `now < starts_at <= now + REMINDER_LEAD`, and `published_at <= starts_at - REMINDER_LEAD`.
  - Each event is claimed with a conditional UPDATE on `reminder_sent_at` before anything is sent, so two overlapping runs cannot both remind.
  - Recipients are the registered students at claim time. A student who signs up after that gets no reminder: they have just signed up.
  - An event published less than a day before its start gets no reminder. Its announcement is that recent.

## 4. Rewards

- **New event code:** `EVENT_ATTENDED = "EVENT_ATTENDED"`, labelled "Attended an event". A data migration adds its `RewardRule` row: 10 points, `grants_xp=True`. The amount is changed in the rewards rule table, never in code.
- **Key:** `event_attendance_key(registration_id)` → `"event:<registration_id>"`.
- **Frontend:** the `RewardEvent` union and the `EVENT_ICON` map get the new code first. The union is closed, so an unknown event renders without an icon.

## 5. Notifications and email

| When | Who | Bell and push | Email |
|---|---|---|---|
| Published | All active students | `EVENT_PUBLISHED` | Yes, except students who muted Events |
| A day before the start | Registered students | `EVENT_REMINDER` | Yes |
| Time or place changed | Registered students | `EVENT_CHANGED` | Yes |
| Cancelled | Students registered when it was cancelled | `EVENT_CANCELLED` | Yes |

- **All active students:** `role=student`, `is_active=True`, `is_frozen=False`.
- **Registered students:** REGISTERED rows whose student is still active and not frozen.

**Bell and push**
- **New category:** `EVENTS`, "Events". Students can mute it under Settings → Notifications; it needs a `HINTS`/`LOOK` entry in `NotificationPreferencesCard`, with the CalendarDays icon. The hint says what the switch covers: "New events. Messages about an event you signed up for still arrive by email."
- **New event codes, all push:** `EVENT_PUBLISHED`, `EVENT_REMINDER`, `EVENT_CHANGED`, `EVENT_CANCELLED`, added to `PUSH_EVENTS`.
- **Delivery:** `notifications.services.notify_many`, a fixed number of queries whatever the recipient count, which honours muted categories. Not gated on `EMAIL_SENDING_ENABLED`. Dedupe keys:
  - `event-published:<id>`: a double publish cannot broadcast twice.
  - `event-reminder:<id>:<starts_at>`: a reminder re-armed by a moved start is not swallowed by the first one's key.
  - `event-changed:<id>:<updated_at>`
  - `event-cancelled:<id>`
- **Link:** `/events`.
- **Migration:** adding choices to `Notification.category` and `Notification.event` produces an `AlterField` migration in `notifications`.

**Email** — `events/mail.py`, in the shape of `classes/mail_homework.py` and `classes/mail_midterm.py`:
- **Per message:** a pure context builder, a plain-text body built from the same context, and an HTML template extending `email/base.html` through `core.mail.brand_context`. English, like every other email.
- **Sending:** a Celery task per message, queued with Celery when a broker is configured, else on a daemon thread scheduled on commit (`enqueue_homework_assigned_emails` is the model). The task re-reads the event first and sends nothing when the message no longer applies, e.g. an announcement or a reminder for an event cancelled since.
- **Gates:** the task on `EMAIL_SENDING_ENABLED`, each recipient on `is_deliverable_email`. With email off (every environment but prod) the claims are still taken and the bell still rings.
- **One message per address**, never a shared To or Bcc. Each send is isolated, so one bad address never costs the rest. The announcement goes to about 370 addresses and the worker runs `--concurrency 2`, so the task reuses one SMTP connection (`get_connection()`) for the whole fan-out rather than opening one per message.
- **Muting:** the announcement email skips students who muted Events. The reminder, change and cancellation emails always go: they are about a seat the student holds.

| Email | Subject | Body | Button |
|---|---|---|---|
| Announcement | `New event: <title>` | cover image, date and time (Asia/Tashkent), place, number of seats, "Attending earns +N XP" with N read from the `EVENT_ATTENDED` rule at send time, description | Sign up → `/events` |
| Reminder | `Reminder: <title>, <Wed 18 Sep> at <15:00>` | date and time, place, "Can't come? Cancel by <Wed 18 Sep, 13:00> so someone else can take your seat" (the start minus `CANCEL_CUTOFF`, with its day, which is not always the event's) | View event → `/events` |
| Changed | `Event updated: <title>` | the new date, time and place | View event → `/events` |
| Cancelled | `Event cancelled: <title>` | the date it was planned for, "Your registration has been closed." | Browse events → `/events` |

**The cover image in an email.** Prod stores uploads in a private R2 bucket, and every `.url` is signed for one hour. A signed URL in an email would break an hour after sending. The email points at `GET /api/events/<id>/cover/` instead (§6), which redirects to a freshly signed URL each time the image is loaded.

**Reminder sweep:**
- `events.tasks.send_due_event_reminders` calls `send_due_reminders(now)` (§3).
- Beat entry `events-send-due-reminders`, `crontab(minute="*/10")`, next to `rewards-settle-due-homework`.
- The reminder lands up to 10 minutes after the 24-hour mark.

## 6. API — `/api/events/`

**Student** (`IsAuthenticated` plus the student role for writes):
- `GET /api/events/`: published events not yet ended. Each item: `id, title, description, cover_image_url, starts_at, ends_at, location, seats, seats_left, my_registration {status, attendance} | null, can_sign_up, can_cancel`.
- `GET /api/events/mine/`: the student's registrations, past ones included, with `attendance` and the points awarded.
- `POST /api/events/<id>/sign-up/`: 201 with the registration, or 409 `{"code": "full"}`, or 400 `{"code": "started" | "not_open"}`.
- `POST /api/events/<id>/cancel/`: 200, or 400 `{"code": "cancel_window_closed"}`.

**Public:**
- `GET /api/events/<id>/cover/`: `AllowAny`, because an email client loads images without a session.
  - A PUBLISHED event with an image: 302 to a freshly signed URL, cacheable for 10 minutes, well inside the URL's hour.
  - A draft, a cancelled event, or no image: 404, so an unpublished poster never leaks.

**Ops.** Staff gate `rewards.views._is_reward_staff`, the gate the stories admin uses. Plain `APIView`s only, never hand-routed `.as_view({...})`:
- `GET, POST /api/events/admin/`
- `GET, PATCH, DELETE /api/events/admin/<id>/` (DELETE for drafts only)
- `POST /api/events/admin/<id>/publish/`: 200, including for an event already published (nothing is sent again), or 400 `{"code": "started"}`.
- `POST /api/events/admin/<id>/cancel/`
- `GET /api/events/admin/<id>/registrations/`: name, phone, registered_at, status, attendance
- `POST /api/events/admin/registrations/<rid>/attendance/` with body `{"attendance": "ATTENDED" | "MISSED" | null}`

**Host guard:** `access/host_guard.py` must allow `/api/events/` on the admin console, as it does `/api/stories/` and `/api/shop/`. Without it `/ops/events` answers 403. The apex needs no entry; email links and the cover image use the apex (`EMAIL_SITE_URL`).

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
- **Publish confirms first:** "Publish and email every student? This can't be undone." Publishing is the send; there is no test send.
- **Event view:**
  - Counters: "Registered 18 · Attended 15 · Missed 2 · Not marked 1".
  - Registrations list: name, phone, registered at.
  - Attended/Missed per row, enabled from the start time.
  - Cancel event, with a confirmation dialog that says registered students will be emailed.

## 8. Edge cases

1. **Race for the last seat:** two students take it at once. The row lock admits one, and the other gets `full`.
2. **Double tap on Sign up:** idempotent, one row.
3. **Late requests:** sign-up after the start, and cancel within 2 hours, are refused by the server with a reason the page shows.
4. **Seats below registrations:** validation error, the form keeps the input.
5. **Cancelling a started event:** refused, because attendance may have paid.
6. **Attendance before the start:** refused.
7. **Attended → Missed:** XP and points are revoked, and the audit row records it.
8. **Student frozen or removed after signing up:** the registration stays, and ops can still mark it. They get no further messages about it.
9. **Publishing twice** (double click, retry): the conditional UPDATE and the dedupe key stop a second broadcast and a second email.
10. **Failed loads:** error states everywhere, never an empty state (the house rule).
11. **Cancelled while the announcement is sending:** the task checks the event before it starts. Messages already out are not recalled; the cancellation email goes only to registered students.
12. **Start moved:** to more than a day away, the reminder goes again before the new time; to within a day, the change message stands in for it.
13. **Published less than a day before the start:** no reminder.
14. **Student without an email address** (22 of 392 active students today): no email. The bell, the push, the invitation dialog and the dashboard card still reach them.
15. **Email switched off** (`EMAIL_SENDING_ENABLED` false): claims are taken and bells ring; nothing is mailed, then or later when it is switched back on.
16. **One address fails:** logged, and the rest of the fan-out continues.

## 9. Testing

- **Backend** (`events/tests_*`):
  - seat limit, including the last seat
  - sign-up and cancel windows under a frozen clock
  - idempotent sign-up
  - attendance → award, and revoke on correction
  - publish notifies once, and muted students are skipped; publishing a started event is refused
  - update and cancel notifications go to registered students only
  - **Email**, with `EMAIL_SENDING_ENABLED=True` and the locmem backend:
    - publish mails every active student with an address, once, one message per address; students with no address, muted Events, frozen accounts and non-students are skipped
    - a second publish mails nothing
    - the reminder sweep under a frozen clock: nothing just before the 24-hour mark; registered students only, once, inside it; a second run sends nothing; none for an event published less than a day ahead
    - a start moved more than a day away reminds again; one moved within a day does not
    - change and cancellation emails go to registered students only, those who muted Events included
    - a queued announcement or reminder for an event cancelled since sends nothing
    - with `EMAIL_SENDING_ENABLED=False` the bell rows are written and the outbox stays empty
    - one failing address does not stop the rest
  - the cover redirect: 302 for a published event without a session, 404 for a draft, a cancelled event and no image
  - permissions: a student cannot reach ops endpoints, and staff pass the gate
  - host guard allows `/api/events/` on the admin host
  - Only a literal `OK` counts.
- **Frontend** (vitest):
  - card states: Full, signed up, cancel window closed, Attended/Missed
  - the invitation dialog: order with push and survey, once per sign-in, not on `/events`, failed fetch silent
  - the top-bar button
  - the dashboard card, including its error state
  - ops attendance toggles, enabled only after the start
  - ops Publish asks for confirmation before it calls the API
  - Also run: tsc with a deliberate-error probe, eslint, `check:api-layer`.
- **Before the PR:** screenshots with fictional data (desktop, mobile, dark), the four emails included.

## 10. Out of scope

- Outside guests.
- A waitlist, or over-limit adds by admin.
- Walk-ins.
- No-show penalties.
- More than one reminder (for example another 3 hours before).
- A confirmation email on sign-up or cancel: the page confirms on screen.
- Emails in Uzbek or Russian: every email the platform sends is in English today.
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
- **Email templates:** `email/event_announcement.html`, `email/event_reminder.html`, `email/event_changed.html`, `email/event_cancelled.html`.
- **Beat:** `sat-celery-beat` reads the `events-send-due-reminders` entry when it restarts, which the deploy does. After the deploy, check its log for the entry.
- **After deploy:** the ops console shows Events, and the student side stays quiet until the first event is published.
- **The first publish** sends about 370 emails at once. For scale: over the last two weeks the worker logged up to about 230 emails a day, with 3 failures in all.
