# Telegram Group Posts (event posts, reminders, scheduled posts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The class bot posts into the class Telegram groups on its own:
- an event's announcement when the event is published;
- the event's reminder the evening before it starts;
- any post an admin writes in a new `/ops/telegram-posts` page, sent now, once at a set time, or every week. The Sunday-mock reminder is a weekly Saturday post.

**Architecture:** A new Django app, `telegram_posts`, holds one engine for every kind of post, with two tables:
- `GroupPost`: what to say, to which groups, and when.
- `GroupPostDelivery`: one message in one group on one day. It is the log, the claim, and the Telegram message id that makes "delete from groups" possible.

A Celery beat sweep runs every minute. It works out which posts are due, claims each run with a conditional UPDATE, writes one delivery row per group, and sends through the existing never-raising Bot API wrapper (`classes/telegram_group_api.py`). The wrapper gains `send_photo` and `retry_after`. Publishing an event creates two posts automatically: the announcement and the reminder. The ops console gets a list page and a detail page, plus a "Post to Telegram groups" choice on the event form. Everything sits behind one flag that defaults to off.

**Tech Stack:** Django 6 + DRF, Celery (`shared_task`, the `_dispatch` on-commit helper in `classes/telegram_group_hooks.py`), Telegram Bot API (HTML parse mode), Next.js + TanStack Query + vitest (createRoot + act, no testing-library).

**Spec:** No spec file. The owner's rule is: design approved in chat → plan → code. The approved design is in **Decisions** below, and this plan argues from it. The bot it builds on is in memory `classroom-telegram-groups.md` and plan `2026-10-16-classroom-telegram-bot.md`.

## Decisions (approved in chat, 2026-10-17, one question at a time)

**Facts from prod (2026-10-17) behind the decisions:**
- There is one event so far, Admission Workshop: 30 seats, 30 registered, **6 came**.
- The site's mocks app is unused (0 mocks, 0 sessions), so the Sunday mock is announced by hand.
- 26 groups are connected: 15 Math and 11 English (foundation 1, junior 9, middle 8, senior 8).
- 5 students have signed in to the bot so far.

1. **An event goes to the groups automatically when it is published.** The event form has "Post to Telegram groups" (on by default) and the same audience choice as a post: every group by default, or narrowed by subject and/or level. The admin can switch it off for one event.
2. **Admin posts live on a new `/ops/telegram-posts` page.**
   - **Content:** text, an optional picture, an optional link button (label + URL).
   - **Audience:** subjects × levels (empty = all), or a list of specific groups.
   - **When:** *Now*, *Once at* a date and time, or *Every week* on chosen days at HH:MM (Tashkent time).
   - **Pause / resume.** The Sunday mock reminder is simply a weekly post on Saturday at 18:00.
3. **The only automatic follow-up is the day-before reminder in the groups.** It goes at 18:00 Tashkent on the day before the start.
   - There are no DMs to registered students and no "cancelled/moved" posts; the owner ticked only this one.
   - A cancelled event gets no reminder.
   - An event published after that evening gets no reminder.
   - A moved start moves the reminder, because it is computed from the event at send time.
4. **Approach A: one posts engine.** The event announcement and reminder are ordinary posts that Publish creates. There is one log, one retry and one "delete from groups" for all of them.
5. **Message formats (part 1):**
   - **Announcement:** picture (if the event has a cover) with this caption:
     - `📢 <b>{title}</b>`, a blank line, `🗓 {Shanba, 25-oktabr, 12:30–14:00}`, `📍 {location}` (only when set), `👥 {seats} ta joy`;
     - then a blank line and the description;
     - a button `📝 Ro'yxatdan o'tish` → `https://mastersat.uz/events`;
     - the title and description stay as the admin typed them; the frame is Uzbek;
     - over the limit (1024 with a picture, 4096 without), the description is cut and ends `… to'liq matn saytda`.
   - **Reminder:** text only:
     - `⏰ <b>Ertaga: {title}</b>`, the date line, the place line;
     - then `✅ {n} ta joy qoldi` with the button, or `🎟 Joylar to'ldi — ro'yxatdan o'tganlar, sizni kutamiz!` with no button.
   - **Admin post:** the admin's text, escaped, with optional picture and button.
   - **Shared chats:** two classes sharing one chat get one message.
6. **Ops (part 2):**
   - **List:** first line, kind, next send time, audience, state (Scheduled / Sending / Sent n/m / n failed / Missed / Paused / Deleted).
   - **Form:** character counter, audience picker, when-picker and a preview. Every send or schedule asks first and names the group count.
   - **Detail page:** per-group rows per run, with Retry failed, Send missed now, Delete from groups (48 h, asks first), Pause/Resume, and Edit (future sends only).
   - **Event page:** the checkbox and audience in the form, the group count in the Publish confirm, and a "Telegram 26/26" link on the row.
   - **Who:** the same staff as Events (`_is_reward_staff`: admin, super admin, superuser).
7. **Engine (part 3):**
   - The sweep runs every minute. A "Now" post is dispatched on commit as well.
   - **Late runs:** a run more than **60 min** late is recorded **Missed** and never sent. The admin can "Send missed now".
   - **Retries:** a 429 waits `retry_after` (capped at 30 s). A network error or 5xx is tried 3 times. A 400 or 403 fails at once with the reason shown.
   - **Pictures:** uploaded once; every later group reuses the returned `file_id`.
   - **Delete:** "Delete from groups" uses `deleteMessage` within 48 h; anything older is reported "too old".
   - **Flag:** `TELEGRAM_GROUP_POSTS_ENABLED`, default off.
   - **Rollout:** zero-downtime deploy → flag on → first post to the `test` group only → owner checks → the real weekly mock post.

## Global Constraints

- **Language:** group messages are Uzbek (Latin), every fixed line in `backend/telegram_posts/texts.py`. `/ops` UI text is English.
- **HTML:** every message goes out with `parse_mode=HTML`. Every dynamic value (titles, places, descriptions, admin text, group names) goes through `classes.telegram_group_api.esc`. Telegram rejects the whole message if the markup does not parse.
- **Flag:** `TELEGRAM_GROUP_POSTS_ENABLED=False` by default (env var). Off means:
  - the sweep, "send now" and retries do nothing;
  - Publish creates no posts;
  - the ops pages show a warning.
- **Constants (exact):**
  - `CAPTION_MAX = 1024`, `TEXT_MAX = 4096` (visible characters, after HTML is parsed);
  - `LATE_LIMIT = timedelta(minutes=60)`, `REMINDER_TIME = time(18, 0)` (Asia/Tashkent);
  - `DELETE_WINDOW = timedelta(hours=48)`;
  - `MAX_TRIES = 3`, `RETRY_AFTER_CAP = 30` (seconds), `INTERRUPTED_AFTER = timedelta(minutes=10)`;
  - the sweep runs `crontab()` (every minute).
- **Targets:** only `Classroom.is_active=True` with a non-empty `telegram_chat_id`. One message per distinct chat id.
- **Staff gate:** `rewards.views._is_reward_staff`.
- **API:** the namespace `/api/telegram-posts/` must be allowed on the admin console host (`access/host_guard.py`) and tested with `HTTP_HOST="admin.mastersat.uz"`.
- **Migrations:** additive only: `telegram_posts/0001_initial`, `events/0003_event_telegram_post_event_telegram_audience`. Apply both on a throwaway Postgres before merge (memory `postgres-like-index-double-create`).
- **Backend test command** (no venv; run from `backend/`):
  `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <labels> --settings=config.settings_test_nomigrations -v 1`
  Only a literal `OK` counts as green. Never use `--parallel`.
- **Frontend checks** (from `frontend/`):
  - `npx vitest run <paths>`;
  - types: `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` (without the `rm`, tsc can report a false green);
  - `npx eslint <paths>`, `npx knip`, `npm run check:api-layer`.
- **Commits:** author `Viltrumlik <viltrumlik@gmail.com>` (verify `git config user.email`). End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Worktree:** `/Users/macbook/Projects/dsat-wt-tg-posts`, branch `feat/telegram-group-posts` off `origin/main` `21a93e2c`. Never touch the primary checkout. Never `pkill -f next-server`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/telegram_posts/__init__.py`, `apps.py` (create) | The app |
| `backend/telegram_posts/models.py` (create) | `GroupPost`, `GroupPostDelivery` |
| `backend/telegram_posts/migrations/0001_initial.py` (create, generated) | The two tables |
| `backend/telegram_posts/texts.py` (create) | Every Uzbek line, weekday and month name |
| `backend/telegram_posts/audience.py` (create) | Which chats a post reaches, its label, the picker rows, `normalize` |
| `backend/telegram_posts/render.py` (create) | The message text, picture and button for a post; the length cut |
| `backend/telegram_posts/schedule.py` (create) | When a post is due (`due`) and when it next goes out (`next_at`) |
| `backend/telegram_posts/sender.py` (create) | Claim, open a run, send with retries, the sweep |
| `backend/telegram_posts/services.py` (create) | What the console does: create, edit, pause, resume, retry, send missed, delete from groups, counts, runs, state; the event hooks |
| `backend/telegram_posts/tasks.py` (create) | Celery tasks |
| `backend/telegram_posts/serializers.py`, `views.py`, `urls.py` (create) | The ops API |
| `backend/telegram_posts/testkit.py` (create) | Test helpers: `FakeApi`, `fake_api()`, `make_room`, `make_event`, `at`, `PNG_1PX` |
| `backend/telegram_posts/tests_*.py` (create) | Tests per module |
| `backend/classes/telegram_group_api.py` (modify) | `TgResult.retry_after`, `_send`, `_call_multipart`, `send_photo`, `largest_photo_file_id` |
| `backend/config/settings.py` (modify) | The app, the flag, the beat entry |
| `backend/config/urls.py` (modify) | `api/telegram-posts/` |
| `backend/access/host_guard.py` (modify) | Admin console allowlist entry |
| `backend/events/models.py` + `migrations/0003_…` (modify/create) | `telegram_post`, `telegram_audience` |
| `backend/events/serializers.py`, `views.py`, `services.py` (modify) | The form fields, the ops payload's `telegram` part, the publish hook |
| `backend/events/tests_telegram.py` (create) | The event side |
| `frontend/src/lib/datetimeLocal.ts` (create) | `toLocalInput` / `fromLocalInput`, moved out of the events page |
| `frontend/src/features/ops/telegram-posts/telegramPostsApi.ts` (create) | Types and calls |
| `frontend/src/features/ops/telegram-posts/telegramPostsHooks.ts` (create) | Queries and mutations |
| `frontend/src/features/ops/telegram-posts/audience.ts` (create) | Pure helpers: target count, labels, state badge, first line |
| `frontend/src/features/ops/telegram-posts/AudiencePicker.tsx` (create) | Subjects × levels, or specific groups, with the group count |
| `frontend/src/features/ops/telegram-posts/PostForm.tsx` (create) | The new/edit modal |
| `frontend/src/features/ops/telegram-posts/TelegramPostsPage.tsx` (create) | The list |
| `frontend/src/features/ops/telegram-posts/TelegramPostPage.tsx` (create) | The detail page |
| `frontend/src/app/(ops)/ops/telegram-posts/page.tsx`, `[id]/page.tsx` (create) | Routes |
| `frontend/src/features/ops/shell/opsNav.ts`, `adminScope.ts`, `__tests__/opsNav.test.ts` (modify) | The nav entry |
| `frontend/src/features/events/eventsApi.ts`, `src/app/(ops)/ops/events/page.tsx`, `__tests__/OpsEventsPage.test.tsx` (modify) | The event form, Publish confirm, row link |
| `docs/CLASSROOM_TELEGRAM_GROUPS.md` (modify) | The group posts section |

---

### Task 1: The app, its two tables, and the flag

**Files:**
- Create: `backend/telegram_posts/__init__.py` (empty), `backend/telegram_posts/apps.py`, `backend/telegram_posts/models.py`, `backend/telegram_posts/migrations/__init__.py` (empty), `backend/telegram_posts/migrations/0001_initial.py` (generated)
- Modify: `backend/config/settings.py` (INSTALLED_APPS after `'events.apps.EventsConfig',`; the flag after `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM`)
- Test: `backend/telegram_posts/tests_models.py`

**Interfaces:**
- Produces:
  - `GroupPost`, with constants:
    - `KIND_MANUAL`, `KIND_EVENT_ANNOUNCE`, `KIND_EVENT_REMINDER`;
    - `WHEN_NOW`, `WHEN_ONCE`, `WHEN_WEEKLY`, `WHEN_EVENT`;
    - fields `kind, text, image, image_file_id, button_text, button_url, subjects, levels, classroom_ids, when, send_at, weekdays, time_of_day, active_from, last_run_on, is_paused, deleted_at, event, created_by, created_at, updated_at`;
    - property `is_event_post`.
  - `GroupPostDelivery`, with:
    - `STATUS_PENDING / SENDING / SENT / FAILED / MISSED / DELETED`;
    - fields `post, run_on, chat_id, group_names, status, message_id, attempts, error, sent_at, deleted_at, created_at, updated_at`.
  - `settings.TELEGRAM_GROUP_POSTS_ENABLED: bool`.

- [ ] **Step 1: Write the failing test** — `backend/telegram_posts/tests_models.py`:

```python
"""The two tables' own guarantees: one delivery per post, day and chat; one post per event and kind."""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from events.models import Event
from telegram_posts.models import GroupPost, GroupPostDelivery


def _event():
    now = timezone.now()
    return Event.objects.create(
        title="Admission Workshop", starts_at=now + timedelta(days=3),
        ends_at=now + timedelta(days=3, hours=2), seats=30,
    )


class ModelTests(TestCase):
    def test_the_flag_defaults_to_off(self):
        self.assertFalse(settings.TELEGRAM_GROUP_POSTS_ENABLED)

    def test_one_delivery_per_post_day_and_chat(self):
        post = GroupPost.objects.create(text="Ertaga mock!")
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        with self.assertRaises(IntegrityError), transaction.atomic():
            GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        # The next week is a run of its own.
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 31), chat_id="-1001")

    def test_one_post_per_event_and_kind(self):
        event = _event()
        GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)
        GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, event=event, when=GroupPost.WHEN_EVENT
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)

    def test_manual_posts_are_not_limited(self):
        GroupPost.objects.create(text="a")
        GroupPost.objects.create(text="b")
        self.assertEqual(GroupPost.objects.count(), 2)

    def test_defaults(self):
        before = timezone.now()
        post = GroupPost.objects.create(text="a")
        self.assertGreaterEqual(post.active_from, before)
        self.assertEqual((post.kind, post.when), (GroupPost.KIND_MANUAL, GroupPost.WHEN_NOW))
        self.assertEqual((post.subjects, post.levels, post.classroom_ids, post.weekdays), ([], [], [], []))
        self.assertFalse(post.is_event_post)
        self.assertTrue(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER).is_event_post)
```

- [ ] **Step 2: Run it to see it fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test telegram_posts.tests_models --settings=config.settings_test_nomigrations -v 1`
Expected: an error, `ModuleNotFoundError: No module named 'telegram_posts'`.

- [ ] **Step 3: Write the app**

`backend/telegram_posts/apps.py`:

```python
from django.apps import AppConfig


class TelegramPostsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "telegram_posts"
    verbose_name = "Telegram group posts"
```

`backend/telegram_posts/models.py`:

```python
"""Posts the class bot makes into class Telegram groups (plan 2026-10-17).

Two tables and no more. ``GroupPost`` is what to say, to which groups, and when — an admin's
post, or one of the two an event's Publish creates. ``GroupPostDelivery`` is one message in one
group on one day. It is the log the console shows, the claim that stops a second worker sending
the same post into the same group twice, and the Telegram message id that makes "delete from
groups" possible. Nothing is ever recalled by any other route: a message in 26 groups has been
read by the time anyone notices a typo.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class GroupPost(models.Model):
    KIND_MANUAL = "MANUAL"
    KIND_EVENT_ANNOUNCE = "EVENT_ANNOUNCE"
    KIND_EVENT_REMINDER = "EVENT_REMINDER"
    KIND_CHOICES = [
        (KIND_MANUAL, "Written in the console"),
        (KIND_EVENT_ANNOUNCE, "Event announcement"),
        (KIND_EVENT_REMINDER, "Event reminder"),
    ]

    WHEN_NOW = "NOW"
    WHEN_ONCE = "ONCE"
    WHEN_WEEKLY = "WEEKLY"
    #: An event reminder: the evening before the event, read from the event at sweep time, so
    #: a moved start moves the reminder with it. See `schedule.reminder_at`.
    WHEN_EVENT = "EVENT"
    WHEN_CHOICES = [
        (WHEN_NOW, "Now"),
        (WHEN_ONCE, "Once, at a set time"),
        (WHEN_WEEKLY, "Every week"),
        (WHEN_EVENT, "The evening before the event"),
    ]

    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_MANUAL, db_index=True)
    #: The admin's own words, plain text. Event posts leave it empty: their text is built from
    #: the event when they are sent (`render`).
    text = models.TextField(blank=True, default="")
    image = models.ImageField(upload_to="telegram_posts/", null=True, blank=True)
    #: What Telegram calls the picture once it has it. The first group gets the bytes; every
    #: later group gets this, so a post to 26 groups uploads its picture once.
    image_file_id = models.CharField(max_length=200, blank=True, default="")
    button_text = models.CharField(max_length=64, blank=True, default="")
    button_url = models.URLField(max_length=500, blank=True, default="")

    #: Audience. Empty lists mean "every subject" / "every level". A non-empty
    #: `classroom_ids` means exactly those classes and the other two are ignored.
    subjects = models.JSONField(default=list, blank=True)
    levels = models.JSONField(default=list, blank=True)
    classroom_ids = models.JSONField(default=list, blank=True)

    when = models.CharField(max_length=10, choices=WHEN_CHOICES, default=WHEN_NOW)
    send_at = models.DateTimeField(null=True, blank=True)
    #: 0 = Monday … 6 = Sunday, as `date.weekday()` counts.
    weekdays = models.JSONField(default=list, blank=True)
    #: Wall-clock time in TIME_ZONE (Asia/Tashkent).
    time_of_day = models.TimeField(null=True, blank=True)
    #: No run scheduled before this moment is ever due. Set on create, on a schedule edit and
    #: on resume, so a weekly post made at 18:30 on its own Saturday waits a week, and a pause
    #: never ends in a burst of everything it covered.
    active_from = models.DateTimeField(default=timezone.now)
    #: The local date of the last run claimed. The claim itself (`sender.claim_run`).
    last_run_on = models.DateField(null=True, blank=True)
    is_paused = models.BooleanField(default=False)
    #: Deleted from the groups (or stopped before it ever ran). Never sends again.
    deleted_at = models.DateTimeField(null=True, blank=True)

    event = models.ForeignKey(
        "events.Event", on_delete=models.CASCADE, null=True, blank=True,
        related_name="telegram_posts",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "telegram_group_posts"
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "kind"], condition=Q(event__isnull=False),
                name="uniq_telegram_post_per_event_kind",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} #{self.pk}"

    @property
    def is_event_post(self) -> bool:
        return self.kind != self.KIND_MANUAL


class GroupPostDelivery(models.Model):
    STATUS_PENDING = "PENDING"
    STATUS_SENDING = "SENDING"
    STATUS_SENT = "SENT"
    STATUS_FAILED = "FAILED"
    #: The run was more than LATE_LIMIT behind its time (the server was down): never sent on
    #: its own, because "tomorrow's mock" posted at 23:00 is worse than nothing.
    STATUS_MISSED = "MISSED"
    STATUS_DELETED = "DELETED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENDING, "Sending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
        (STATUS_MISSED, "Missed"),
        (STATUS_DELETED, "Deleted"),
    ]

    post = models.ForeignKey(GroupPost, on_delete=models.CASCADE, related_name="deliveries")
    #: The run's local date — a weekly post gets a new run every week.
    run_on = models.DateField()
    chat_id = models.CharField(max_length=100)
    #: The classes sharing that chat, as they were named when the run opened.
    group_names = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    message_id = models.BigIntegerField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.CharField(max_length=400, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "telegram_group_post_deliveries"
        ordering = ["run_on", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["post", "run_on", "chat_id"], name="uniq_telegram_post_delivery"
            ),
        ]
        indexes = [models.Index(fields=["post", "run_on"])]

    def __str__(self) -> str:
        return f"{self.post_id} → {self.chat_id} @ {self.run_on}: {self.status}"
```

In `backend/config/settings.py`, add after the `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` line:

```python
# Posts the class bot makes into the class Telegram groups: event announcements, the evening-
# before reminder, and the posts written in /ops/telegram-posts (plan 2026-10-17). Off: nothing
# is sent and publishing an event creates no posts.
TELEGRAM_GROUP_POSTS_ENABLED = os.getenv('TELEGRAM_GROUP_POSTS_ENABLED', 'False').lower() == 'true'
```

and in `INSTALLED_APPS`, after `'events.apps.EventsConfig',`:

```python
    'telegram_posts.apps.TelegramPostsConfig',
```

- [ ] **Step 4: Generate the migration**

Run (from `backend/`): `SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations telegram_posts`
Expected: `telegram_posts/migrations/0001_initial.py` with `CreateModel GroupPost`, `CreateModel GroupPostDelivery`, an index and two constraints, and a dependency on `events` (`0002_ticket_code`). Open it and confirm there is nothing else in it.

- [ ] **Step 5: Run the test to see it pass**

Run: the Step 2 command. Expected: `Ran 5 tests … OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/telegram_posts backend/config/settings.py
git commit -m "feat(telegram_posts): the app, its two tables and the flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bot API additions — a picture upload, its file id, and `retry_after`

**Files:**
- Modify: `backend/classes/telegram_group_api.py` (`TgResult`, `_call`, new `_send`, `_retry_after`, `_call_multipart`, `send_photo`, `largest_photo_file_id`)
- Test: `backend/telegram_posts/tests_api_client.py`

**Interfaces:**
- Consumes: nothing new.
- Produces (all in `classes.telegram_group_api`):
  - `TgResult.retry_after: Optional[int]` (seconds, from Telegram's `parameters.retry_after`; `None` otherwise);
  - `send_photo(chat_id, *, caption: str, photo: bytes | None = None, filename: str = "photo.jpg", content_type: str = "image/jpeg", file_id: str = "", reply_markup: dict | None = None) -> TgResult`;
  - `largest_photo_file_id(result) -> str`.

- [ ] **Step 1: Write the failing test** — `backend/telegram_posts/tests_api_client.py`:

```python
"""The Bot API wrapper's new half: a picture upload, its file_id, and Telegram's retry_after."""

from __future__ import annotations

import io
import json
import urllib.error
from unittest import mock

from django.test import SimpleTestCase, override_settings

from classes import telegram_group_api as api

TOKEN = "777:TESTTOKEN"


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _capture(payload=None):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append(req)
        return _Resp(payload or {"ok": True, "result": {"message_id": 5, "photo": []}})

    return seen, mock.patch.object(api.urllib.request, "urlopen", side_effect=fake_urlopen)


@override_settings(CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN)
class SendPhotoTests(SimpleTestCase):
    def test_a_known_file_id_is_sent_as_a_form_field(self):
        seen, patch = _capture()
        with patch:
            result = api.send_photo("-1001", caption="<b>Hi</b>", file_id="FILE123")
        self.assertTrue(result.ok)
        body = seen[0].data.decode()
        self.assertIn("photo=FILE123", body)
        self.assertIn("parse_mode=HTML", body)
        self.assertTrue(seen[0].full_url.endswith("/sendPhoto"))

    def test_bytes_are_uploaded_as_multipart(self):
        seen, patch = _capture()
        markup = {"inline_keyboard": [[{"text": "Go", "url": "https://mastersat.uz/events"}]]}
        with patch:
            api.send_photo(
                "-1001", caption="Hi", photo=b"\x89PNGDATA", filename='co"ver.png',
                content_type="image/png", reply_markup=markup,
            )
        req = seen[0]
        self.assertTrue(req.get_header("Content-type").startswith("multipart/form-data; boundary="))
        self.assertIn(b"\x89PNGDATA", req.data)
        self.assertIn(b'name="caption"', req.data)
        # A quote in a file name would end the header early; it is replaced, never sent.
        self.assertIn(b'filename="co_ver.png"', req.data)
        self.assertIn(b"inline_keyboard", req.data)

    def test_nothing_to_send_is_a_refusal_not_a_call(self):
        seen, patch = _capture()
        with patch:
            result = api.send_photo("-1001", caption="Hi")
        self.assertFalse(result.ok)
        self.assertEqual(seen, [])


@override_settings(CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN)
class RetryAfterTests(SimpleTestCase):
    def test_a_429_carries_telegrams_retry_after(self):
        body = json.dumps({
            "ok": False, "error_code": 429, "description": "Too Many Requests: retry after 7",
            "parameters": {"retry_after": 7},
        }).encode()
        err = urllib.error.HTTPError(
            "https://api.telegram.org", 429, "Too Many Requests", hdrs=None, fp=io.BytesIO(body)
        )
        with mock.patch.object(api.urllib.request, "urlopen", side_effect=err):
            result = api.send_message("-1001", "hi")
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, 429)
        self.assertEqual(result.retry_after, 7)

    def test_other_failures_have_none(self):
        with mock.patch.object(api.urllib.request, "urlopen", side_effect=TimeoutError("timed out")):
            result = api.send_message("-1001", "hi")
        self.assertIsNone(result.retry_after)
        self.assertIsNone(result.error_code)


class LargestPhotoTests(SimpleTestCase):
    def test_the_biggest_size_wins(self):
        result = {"photo": [
            {"file_id": "s", "file_size": 100, "width": 90},
            {"file_id": "l", "file_size": 9000, "width": 1280},
            {"file_id": "m", "file_size": 900, "width": 320},
        ]}
        self.assertEqual(api.largest_photo_file_id(result), "l")

    def test_no_photo_is_empty(self):
        self.assertEqual(api.largest_photo_file_id({"message_id": 1}), "")
        self.assertEqual(api.largest_photo_file_id(None), "")
```

- [ ] **Step 2: Run it to see it fail**

Run: `… manage.py test telegram_posts.tests_api_client --settings=config.settings_test_nomigrations -v 1` (full command in Global Constraints)
Expected: errors, `AttributeError: module 'classes.telegram_group_api' has no attribute 'send_photo'`.

- [ ] **Step 3: Implement**

In `backend/classes/telegram_group_api.py`:

1. Add `import re` and `import uuid` to the imports.

2. Add one field to `TgResult`, after `description`:

```python
    #: Seconds Telegram asked us to wait (a 429's ``parameters.retry_after``), else None.
    retry_after: Optional[int] = None
```

3. Replace the whole `_call` function with `_call` + `_send` + `_retry_after` + `_call_multipart`. The HTTPError comment moves with the code:

```python
def _call(method: str, params: dict, *, token: str = "") -> TgResult:
    tok = token or bot_token()
    if not tok:
        return TgResult(False, description="Telegram bot token is not configured.")

    url = f"https://api.telegram.org/bot{tok}/{method}"
    data = urllib.parse.urlencode(
        {k: v for k, v in params.items() if v is not None}
    ).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    return _send(req, method)


def _send(req: urllib.request.Request, method: str) -> TgResult:
    try:
        with urllib.request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Every *interesting* Telegram failure arrives here, not as a network error: a 400
        # for a bad chat id, a 403 for a demoted bot. The description is in the body, so
        # reading it is the difference between a diagnosis and "something went wrong".
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            return TgResult(False, error_code=exc.code, description=f"HTTP {exc.code}")
        return TgResult(
            False,
            error_code=int(body.get("error_code") or exc.code),
            description=str(body.get("description") or "")[:400],
            retry_after=_retry_after(body),
        )
    except Exception as exc:  # timeouts, DNS, TLS
        logger.warning("telegram %s failed: %s", method, exc)
        return TgResult(False, description=f"{type(exc).__name__}: {exc}"[:400])

    if not isinstance(body, dict) or not body.get("ok"):
        desc = str((body or {}).get("description") or "")[:400]
        return TgResult(
            False, error_code=(body or {}).get("error_code"), description=desc,
            retry_after=_retry_after(body),
        )
    return TgResult(True, result=body.get("result"))


def _retry_after(body) -> Optional[int]:
    """A 429's wait, in seconds. Telegram puts it in ``parameters``, not in a header."""
    params = body.get("parameters") if isinstance(body, dict) else None
    try:
        value = int((params or {}).get("retry_after"))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _call_multipart(
    method: str, fields: dict, files: dict[str, tuple[str, bytes, str]], *, token: str = ""
) -> TgResult:
    """Like `_call`, for a method that takes a file: a picture leaves as bytes, not a URL.

    Media is in a private bucket, so a URL handed to Telegram would be either unsigned (404)
    or signed for an hour and then dead in any retry. The bytes always work.
    """
    tok = token or bot_token()
    if not tok:
        return TgResult(False, description="Telegram bot token is not configured.")

    boundary = f"----mastersat{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        if value is None:
            continue
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += str(value).encode("utf-8") + b"\r\n"
    for name, (filename, content, content_type) in files.items():
        # Anything outside this set could end the header early (a quote) or break it (a CRLF).
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "file") or "file"
        body += (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{safe}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"https://api.telegram.org/bot{tok}/{method}",
        data=bytes(body),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    return _send(req, method)
```

4. After `send_message`, add:

```python
def send_photo(
    chat_id: str | int,
    *,
    caption: str,
    photo: bytes | None = None,
    filename: str = "photo.jpg",
    content_type: str = "image/jpeg",
    file_id: str = "",
    reply_markup: dict | None = None,
) -> TgResult:
    """A picture with an HTML caption (plan 2026-10-17, group posts).

    The first group gets the bytes; every later group gets the ``file_id`` Telegram gave back
    (`largest_photo_file_id`), so a post to 26 groups uploads its picture once.
    """
    fields = {
        "chat_id": chat_id,
        "caption": caption,
        "parse_mode": "HTML",
        "reply_markup": json.dumps(reply_markup) if reply_markup else None,
    }
    if file_id:
        return _call("sendPhoto", {**fields, "photo": file_id})
    if not photo:
        return TgResult(False, description="No picture to send.")
    return _call_multipart("sendPhoto", fields, {"photo": (filename, photo, content_type)})


def largest_photo_file_id(result) -> str:
    """The id of the biggest size in a sent photo — the one worth reusing."""
    sizes = result.get("photo") if isinstance(result, dict) else None
    if not sizes:
        return ""
    best = max(sizes, key=lambda s: (int(s.get("file_size") or 0), int(s.get("width") or 0)))
    return str(best.get("file_id") or "")
```

- [ ] **Step 4: Run the new tests and the bot's existing tests**

Run: `… manage.py test telegram_posts.tests_api_client classes.tests_telegram_group classes.tests_telegram_bot classes.tests_telegram_payments classes.tests_telegram_ops --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`. The existing suites prove that the `_call` → `_send` split changed nothing they rely on.

- [ ] **Step 5: Commit**

```bash
git add backend/classes/telegram_group_api.py backend/telegram_posts/tests_api_client.py
git commit -m "feat(telegram): send_photo with a one-time upload, and Telegram's retry_after

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Who a post reaches, and what it says

**Files:**
- Create: `backend/telegram_posts/texts.py`, `backend/telegram_posts/audience.py`, `backend/telegram_posts/render.py`, `backend/telegram_posts/testkit.py`
- Test: `backend/telegram_posts/tests_audience.py`, `backend/telegram_posts/tests_render.py`

**Interfaces:**
- Consumes:
  - `Classroom` (`subject`, `level`, `is_active`, `telegram_chat_id`, `name`);
  - `classes.telegram_group.chat_id_for`;
  - `classes.telegram_group_api.esc`;
  - `events.models.Event` (`title, description, cover_image, starts_at, ends_at, location, seats, seats_left, status`);
  - `GroupPost` (Task 1).
- Produces:
  - in `audience`:
    - `SUBJECTS: tuple[str, ...]` (`"MATH", "ENGLISH"`);
    - `LEVELS: tuple[str, ...]` (`"foundation", "junior", "middle", "senior"`);
    - `Target(chat_id: str, names: str)`;
    - `resolve(*, subjects=(), levels=(), classroom_ids=()) -> list[Target]`;
    - `for_post(post) -> list[Target]`;
    - `label(*, subjects=(), levels=(), classroom_ids=()) -> str`;
    - `picker_rows() -> list[dict]` (`id, name, subject, level, chat_id`).
  - in `render`:
    - `CAPTION_MAX`, `TEXT_MAX`;
    - `Rendered(text: str, image, button: tuple[str, str] | None)`;
    - `when_uz(starts_at, ends_at=None) -> str`;
    - `visible_len(markup) -> int`;
    - `events_url() -> str`;
    - `event_announcement(event) -> Rendered`;
    - `event_reminder(event) -> Rendered | None`;
    - `manual(post) -> Rendered`;
    - `render(post) -> Rendered | None`.
  - in `testkit`: `at(y, m, d, h=0, mi=0)`, `staff()`, `make_room(name, *, subject="MATH", level="senior", chat="-1001", active=True)`, `make_event(**kw)`, `PNG_1PX`, `TOKEN`. Task 5 adds `FakeApi` and `fake_api()`.

- [ ] **Step 1: Write the test helpers** — `backend/telegram_posts/testkit.py`. The name keeps it out of test discovery.

```python
"""Helpers shared by this app's tests. Named so test discovery (``test*.py``) skips it."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta

from django.utils import timezone

from access import constants as C
from classes.models import Classroom
from events.models import Event
from users.models import User

TOKEN = "777:TESTTOKEN"

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def at(y, m, d, h=0, mi=0):
    """A Tashkent wall-clock moment. 2026-10-24 is a Saturday."""
    return timezone.make_aware(datetime(y, m, d, h, mi))


def staff():
    user = User.objects.filter(email="tp_admin@t.com").first()
    return user or User.objects.create_user("tp_admin@t.com", "x", role=C.ROLE_ADMIN)


def make_room(name, *, subject=Classroom.SUBJECT_MATH, level="senior", chat="-1001", active=True):
    return Classroom.objects.create(
        name=name, subject=subject, level=level, lesson_days=Classroom.DAYS_ODD,
        created_by=staff(), telegram_chat_id=chat, is_active=active,
    )


def make_event(**kw):
    start = kw.pop("starts_at", at(2026, 10, 25, 12, 30))
    kw.setdefault("title", "Admission Workshop")
    kw.setdefault("description", "")
    kw.setdefault("ends_at", start + timedelta(hours=1, minutes=30))
    kw.setdefault("location", "MasterSAT, Room 2")
    kw.setdefault("seats", 30)
    kw.setdefault("status", Event.STATUS_PUBLISHED)
    kw.setdefault("published_at", at(2026, 10, 20, 9))
    kw.setdefault("created_by", staff())
    return Event.objects.create(starts_at=start, **kw)
```

- [ ] **Step 2: Write the failing tests**

`backend/telegram_posts/tests_audience.py`:

```python
"""Which groups a post reaches: active classes with a chat, one message per chat."""

from __future__ import annotations

from django.test import TestCase

from classes.models import Classroom
from telegram_posts import audience
from telegram_posts.testkit import make_room

MATH, ENGLISH = Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH


class ResolveTests(TestCase):
    def setUp(self):
        self.m_sen = make_room("Senior G1 Math", subject=MATH, level="senior", chat="-1001")
        self.m_jun = make_room("Junior G2 Math", subject=MATH, level="junior", chat="-1002")
        self.e_sen = make_room("Senior G3 English", subject=ENGLISH, level="senior", chat="-1003")
        self.shared = make_room("Senior G4 English", subject=ENGLISH, level="senior", chat="-1003")
        make_room("No group yet", chat="")
        make_room("Closed class", chat="-1009", active=False)

    def chats(self, **kw):
        return [t.chat_id for t in audience.resolve(**kw)]

    def test_every_connected_active_class_by_default(self):
        self.assertEqual(self.chats(), ["-1001", "-1002", "-1003"])

    def test_two_classes_in_one_chat_are_one_target(self):
        target = [t for t in audience.resolve() if t.chat_id == "-1003"][0]
        self.assertEqual(target.names, "Senior G3 English, Senior G4 English")

    def test_by_subject(self):
        self.assertEqual(self.chats(subjects=[MATH]), ["-1001", "-1002"])

    def test_by_level(self):
        self.assertEqual(self.chats(levels=["senior"]), ["-1001", "-1003"])

    def test_subject_and_level_together(self):
        self.assertEqual(self.chats(subjects=[ENGLISH], levels=["junior"]), [])

    def test_chosen_classes_win_over_the_filters(self):
        self.assertEqual(self.chats(classroom_ids=[self.m_jun.pk], subjects=[ENGLISH]), ["-1002"])

    def test_picker_rows_list_only_connected_active_classes(self):
        rows = audience.picker_rows()
        self.assertEqual(
            [r["id"] for r in rows], [self.m_sen.pk, self.m_jun.pk, self.e_sen.pk, self.shared.pk]
        )
        self.assertEqual(
            rows[0],
            {"id": self.m_sen.pk, "name": "Senior G1 Math", "subject": MATH, "level": "senior", "chat_id": "-1001"},
        )


class LabelTests(TestCase):
    def test_labels(self):
        self.assertEqual(audience.label(), "All groups")
        self.assertEqual(audience.label(subjects=[MATH]), "Math · all levels")
        self.assertEqual(audience.label(levels=["senior", "middle"]), "All subjects · senior, middle")
        self.assertEqual(audience.label(subjects=[MATH, ENGLISH], levels=["junior"]), "Math + English · junior")
        self.assertEqual(audience.label(classroom_ids=[4, 9]), "2 chosen groups")
        self.assertEqual(audience.label(classroom_ids=[4]), "1 chosen group")
```

`backend/telegram_posts/tests_render.py`:

```python
"""What a post says: the Uzbek frame, the admin's words escaped, and the length cut."""

from __future__ import annotations

import re

from django.test import SimpleTestCase, TestCase, override_settings

from events.models import Event, EventRegistration
from telegram_posts import render
from telegram_posts import texts as T
from telegram_posts.models import GroupPost
from telegram_posts.testkit import at, make_event
from users.models import User


class WhenTests(SimpleTestCase):
    def test_same_day(self):
        self.assertEqual(
            render.when_uz(at(2026, 10, 25, 12, 30), at(2026, 10, 25, 14, 0)),
            "Yakshanba, 25-oktabr, 12:30–14:00",
        )

    def test_start_only(self):
        self.assertEqual(render.when_uz(at(2026, 10, 24, 18, 0)), "Shanba, 24-oktabr, 18:00")

    def test_across_days(self):
        self.assertEqual(
            render.when_uz(at(2026, 10, 24, 18, 0), at(2026, 10, 25, 10, 0)),
            "Shanba, 24-oktabr, 18:00 – 25-oktabr, 10:00",
        )


@override_settings(EMAIL_SITE_URL="https://mastersat.uz")
class EventTextTests(TestCase):
    def test_the_announcement_lines(self):
        event = make_event(title="Admission <Workshop> & Q&A", description="Bring your questions.")
        result = render.event_announcement(event)
        self.assertEqual(
            result.text,
            "📢 <b>Admission &lt;Workshop&gt; &amp; Q&amp;A</b>\n\n"
            "🗓 Yakshanba, 25-oktabr, 12:30–14:00\n"
            "📍 MasterSAT, Room 2\n"
            "👥 30 ta joy\n\n"
            "Bring your questions.",
        )
        self.assertEqual(result.button, ("📝 Ro'yxatdan o'tish", "https://mastersat.uz/events"))
        self.assertIsNone(result.image)

    def test_no_place_no_place_line(self):
        self.assertNotIn("📍", render.event_announcement(make_event(location="")).text)

    def test_a_long_description_is_cut_to_the_caption_limit_with_a_picture(self):
        event = make_event(description="x" * 3000)
        event.cover_image = "events/cover.png"  # a name is enough: nothing is read here
        result = render.event_announcement(event)
        self.assertEqual(result.image.name, "events/cover.png")
        self.assertLessEqual(render.visible_len(result.text), render.CAPTION_MAX)
        self.assertTrue(result.text.endswith(T.MORE_ON_SITE))

    def test_without_a_picture_the_limit_is_4096(self):
        self.assertNotIn(T.MORE_ON_SITE, render.event_announcement(make_event(description="x" * 3000)).text)
        long = render.event_announcement(make_event(description="x" * 5000)).text
        self.assertLessEqual(render.visible_len(long), render.TEXT_MAX)
        self.assertTrue(long.endswith(T.MORE_ON_SITE))

    def test_a_cut_never_splits_an_escape(self):
        event = make_event(description="&" * 3000)
        event.cover_image = "events/cover.png"
        text = render.event_announcement(event).text
        self.assertIsNone(re.search(r"&(?!amp;|lt;|gt;)", text))

    def test_the_reminder_with_seats_left(self):
        result = render.event_reminder(make_event(seats=10))
        self.assertTrue(result.text.startswith("⏰ <b>Ertaga: Admission Workshop</b>\n\n🗓 Yakshanba, 25-oktabr"))
        self.assertIn(T.SEATS_LEFT.format(n=10), result.text)
        self.assertIsNotNone(result.button)

    def test_the_reminder_when_full_has_no_button(self):
        event = make_event(seats=1)
        EventRegistration.objects.create(event=event, student=User.objects.create_user("rs@t.com", "x"))
        result = render.event_reminder(event)
        self.assertIn(T.SEATS_FULL, result.text)
        self.assertIsNone(result.button)

    def test_no_reminder_for_a_cancelled_event(self):
        self.assertIsNone(render.event_reminder(make_event(status=Event.STATUS_CANCELLED)))

    def test_render_picks_by_kind(self):
        event = make_event()
        self.assertTrue(render.render(GroupPost(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)).text.startswith("📢"))
        self.assertTrue(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)).text.startswith("⏰"))
        event.status = Event.STATUS_CANCELLED
        self.assertIsNone(render.render(GroupPost(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)))


class ManualTextTests(SimpleTestCase):
    def test_text_is_escaped(self):
        self.assertEqual(
            render.manual(GroupPost(text="  Mock <ertaga> & keling  ")).text,
            "Mock &lt;ertaga&gt; &amp; keling",
        )

    def test_the_button_needs_both_halves(self):
        self.assertIsNone(render.manual(GroupPost(text="a", button_text="Ro'yxat", button_url="")).button)
        self.assertEqual(
            render.manual(GroupPost(text="a", button_text="Go", button_url="https://t.me/x")).button,
            ("Go", "https://t.me/x"),
        )

    def test_a_picture_post_obeys_the_caption_limit(self):
        post = GroupPost(text="y" * 2000)
        post.image = "telegram_posts/p.png"
        self.assertLessEqual(render.visible_len(render.manual(post).text), render.CAPTION_MAX)
```

- [ ] **Step 3: Run them to see them fail**

Run: `… manage.py test telegram_posts.tests_audience telegram_posts.tests_render --settings=config.settings_test_nomigrations -v 1`
Expected: errors, `ImportError: cannot import name 'audience' from 'telegram_posts'`.

- [ ] **Step 4: Implement**

`backend/telegram_posts/texts.py`:

```python
"""Every fixed line the bot puts in a group post, in Uzbek (Latin). Dynamic values are escaped
by the caller (`render`), never here."""

WEEKDAYS = ("Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba")
MONTHS = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
)

ANNOUNCE_HEAD = "📢 <b>{title}</b>"
REMINDER_HEAD = "⏰ <b>Ertaga: {title}</b>"
WHEN_LINE = "🗓 {when}"
PLACE_LINE = "📍 {place}"
SEATS_LINE = "👥 {seats} ta joy"
SEATS_LEFT = "✅ {n} ta joy qoldi"
SEATS_FULL = "🎟 Joylar to'ldi — ro'yxatdan o'tganlar, sizni kutamiz!"
SIGN_UP_BUTTON = "📝 Ro'yxatdan o'tish"
#: Ends a description cut to Telegram's limit. HTML, so `render` counts it as it will show.
MORE_ON_SITE = "… <i>to'liq matn saytda</i>"
```

`backend/telegram_posts/audience.py`:

```python
"""Which class groups a post reaches.

Only active classes with a chat id, and one target per chat: two classes that share a group get
one message there, not two — the same rule as `announce_classroom_bot`.
"""

from __future__ import annotations

from dataclasses import dataclass

from classes.models import Classroom
from classes.telegram_group import chat_id_for

SUBJECTS = (Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH)
LEVELS = tuple(code for code, _label in Classroom.LEVEL_CHOICES)


@dataclass(frozen=True)
class Target:
    chat_id: str
    #: The classes in that chat, comma-separated, for the console's per-group rows.
    names: str


def _rooms():
    return (
        Classroom.objects.filter(is_active=True)
        .exclude(telegram_chat_id="")
        .order_by("pk")
    )


def resolve(*, subjects=(), levels=(), classroom_ids=()) -> list[Target]:
    rooms = _rooms()
    if classroom_ids:
        rooms = rooms.filter(pk__in=list(classroom_ids))
    else:
        if subjects:
            rooms = rooms.filter(subject__in=list(subjects))
        if levels:
            rooms = rooms.filter(level__in=list(levels))
    by_chat: dict[str, list[str]] = {}
    for room in rooms:
        chat = chat_id_for(room)
        if chat:
            by_chat.setdefault(chat, []).append(room.name)
    return [Target(chat, ", ".join(names)[:300]) for chat, names in by_chat.items()]


def for_post(post) -> list[Target]:
    return resolve(
        subjects=post.subjects or (), levels=post.levels or (), classroom_ids=post.classroom_ids or ()
    )


def label(*, subjects=(), levels=(), classroom_ids=()) -> str:
    """The audience in a few words, for the console's list."""
    if classroom_ids:
        n = len(classroom_ids)
        return f"{n} chosen group{'' if n == 1 else 's'}"
    if not subjects and not levels:
        return "All groups"
    who = " + ".join(s.title() for s in subjects) if subjects else "All subjects"
    tier = ", ".join(levels) if levels else "all levels"
    return f"{who} · {tier}"


def picker_rows() -> list[dict]:
    """Every class a post can reach, for the console's audience picker and its group count."""
    return [
        {"id": r.pk, "name": r.name, "subject": r.subject, "level": r.level, "chat_id": chat_id_for(r)}
        for r in _rooms()
    ]
```

`backend/telegram_posts/render.py`:

```python
"""What a post says when it is sent: text (HTML), picture, button.

Built at send time, never stored, so an event's reminder carries the event as it is that
evening — its current time, place and seats — not as it was when it was published.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any, Optional

from django.conf import settings
from django.utils import timezone

from classes.telegram_group_api import esc
from events.models import Event

from . import texts as T
from .models import GroupPost

#: Telegram's limits, in characters as the reader sees them (entities parsed).
CAPTION_MAX = 1024
TEXT_MAX = 4096


@dataclass(frozen=True)
class Rendered:
    text: str
    #: A FieldFile, or None for a text message.
    image: Any = None
    button: Optional[tuple[str, str]] = None


def when_uz(starts_at, ends_at=None) -> str:
    """"Shanba, 25-oktabr, 12:30–14:00" in Tashkent time."""
    start = timezone.localtime(starts_at)
    out = f"{T.WEEKDAYS[start.weekday()]}, {start.day}-{T.MONTHS[start.month - 1]}, {start:%H:%M}"
    if ends_at:
        end = timezone.localtime(ends_at)
        if end.date() == start.date():
            out += f"–{end:%H:%M}"
        else:
            out += f" – {end.day}-{T.MONTHS[end.month - 1]}, {end:%H:%M}"
    return out


def visible_len(markup: str) -> int:
    """How long Telegram counts this: tags dropped, entities as one character each."""
    return len(html.unescape(re.sub(r"<[^>]+>", "", markup)))


def _fit(head: str, body: str, limit: int) -> str:
    """``head + esc(body)``, with `body` cut so the whole fits `limit`.

    The cut is made on the RAW text, before escaping: cutting the escaped text could split
    "&amp;" into "&am", and Telegram rejects the whole message over one broken entity.
    """
    whole = head + esc(body)
    if visible_len(whole) <= limit:
        return whole
    budget = limit - visible_len(head) - visible_len(T.MORE_ON_SITE)
    return head + esc(body[: max(0, budget)].rstrip()) + T.MORE_ON_SITE


def events_url() -> str:
    site = str(getattr(settings, "EMAIL_SITE_URL", "https://mastersat.uz")).rstrip("/")
    return f"{site}/events"


def _when_and_place(event) -> list[str]:
    lines = [T.WHEN_LINE.format(when=when_uz(event.starts_at, event.ends_at))]
    if event.location:
        lines.append(T.PLACE_LINE.format(place=esc(event.location)))
    return lines


def event_announcement(event) -> Rendered:
    image = event.cover_image if event.cover_image else None
    head = "\n".join(
        [T.ANNOUNCE_HEAD.format(title=esc(event.title)), ""]
        + _when_and_place(event)
        + [T.SEATS_LINE.format(seats=event.seats)]
    )
    description = (event.description or "").strip()
    limit = CAPTION_MAX if image else TEXT_MAX
    text = _fit(head + "\n\n", description, limit) if description else head
    return Rendered(text=text, image=image, button=(T.SIGN_UP_BUTTON, events_url()))


def event_reminder(event) -> Optional[Rendered]:
    if event.status != Event.STATUS_PUBLISHED:
        return None
    left = event.seats_left
    lines = [T.REMINDER_HEAD.format(title=esc(event.title)), ""] + _when_and_place(event)
    lines.append(T.SEATS_LEFT.format(n=left) if left > 0 else T.SEATS_FULL)
    # A full event's button would open a page that says "full": the line says it already.
    button = (T.SIGN_UP_BUTTON, events_url()) if left > 0 else None
    return Rendered(text="\n".join(lines), button=button)


def manual(post) -> Rendered:
    image = post.image if post.image else None
    text = _fit("", (post.text or "").strip(), CAPTION_MAX if image else TEXT_MAX)
    button = (post.button_text, post.button_url) if post.button_text and post.button_url else None
    return Rendered(text=text, image=image, button=button)


def render(post) -> Optional[Rendered]:
    """None means there is nothing true left to say (the event behind it is not published)."""
    if post.kind == GroupPost.KIND_EVENT_ANNOUNCE:
        event = post.event if post.event_id else None
        if event is None or event.status != Event.STATUS_PUBLISHED:
            return None
        return event_announcement(event)
    if post.kind == GroupPost.KIND_EVENT_REMINDER:
        return event_reminder(post.event) if post.event_id else None
    return manual(post)
```

- [ ] **Step 5: Run them to see them pass**

Run: the Step 3 command. Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/telegram_posts/texts.py backend/telegram_posts/audience.py backend/telegram_posts/render.py backend/telegram_posts/testkit.py backend/telegram_posts/tests_audience.py backend/telegram_posts/tests_render.py
git commit -m "feat(telegram_posts): which groups a post reaches, and what it says

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: When a post is due

**Files:**
- Create: `backend/telegram_posts/schedule.py`
- Test: `backend/telegram_posts/tests_schedule.py`

**Interfaces:**
- Consumes: `GroupPost` (Task 1), `Event`.
- Produces (in `schedule`):
  - `LATE_LIMIT`, `REMINDER_TIME`;
  - `Due(run_on: date, scheduled_at: datetime, late: bool)`;
  - `reminder_at(event) -> datetime`;
  - `due(post, now) -> Due | None`: the run open at `now`, not yet claimed;
  - `next_at(post, now) -> datetime | None`: for the console.

Rules (Decisions 3 and 7):
- Nothing is due while the post is paused or deleted, or before `active_from`.
- Each local date runs at most once (`last_run_on`).
- A weekly post looks only at **today**. Yesterday's never-run slot would be stale ("tomorrow's mock" when the mock is today), so it is not resurrected.
- A run more than `LATE_LIMIT` behind is still returned, with `late=True`, so the sender can record it Missed.

- [ ] **Step 1: Write the failing test** — `backend/telegram_posts/tests_schedule.py`:

```python
"""When a post goes out. 2026-10-24 is a Saturday; every time is Tashkent wall-clock."""

from __future__ import annotations

from datetime import date, time

from django.test import SimpleTestCase

from events.models import Event
from telegram_posts import schedule
from telegram_posts.models import GroupPost
from telegram_posts.testkit import at

SAT, FRI = 5, 4


def once(send_at, **kw):
    kw.setdefault("active_from", at(2026, 10, 1))
    return GroupPost(when=GroupPost.WHEN_ONCE, send_at=send_at, **kw)


def weekly(**kw):
    kw.setdefault("weekdays", [SAT])
    kw.setdefault("time_of_day", time(18, 0))
    kw.setdefault("active_from", at(2026, 10, 1))
    return GroupPost(when=GroupPost.WHEN_WEEKLY, **kw)


class OnceTests(SimpleTestCase):
    def test_not_before_its_time(self):
        self.assertIsNone(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 17, 59)))

    def test_on_time(self):
        d = schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 18, 0))
        self.assertEqual((d.run_on, d.late), (date(2026, 10, 24), False))

    def test_an_hour_late_is_still_on_time_and_a_minute_more_is_missed(self):
        self.assertFalse(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 19, 0)).late)
        self.assertTrue(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 19, 1)).late)

    def test_only_once(self):
        post = once(at(2026, 10, 24, 18), last_run_on=date(2026, 10, 24))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 5)))
        self.assertIsNone(schedule.next_at(post, at(2026, 10, 24, 18, 5)))

    def test_paused_or_deleted_is_never_due(self):
        self.assertIsNone(schedule.due(once(at(2026, 10, 24, 18), is_paused=True), at(2026, 10, 24, 18)))
        self.assertIsNone(
            schedule.due(once(at(2026, 10, 24, 18), deleted_at=at(2026, 10, 23)), at(2026, 10, 24, 18))
        )

    def test_now_posts_behave_like_once(self):
        post = GroupPost(when=GroupPost.WHEN_NOW, send_at=at(2026, 10, 24, 10), active_from=at(2026, 10, 24, 10))
        self.assertEqual(schedule.due(post, at(2026, 10, 24, 10)).run_on, date(2026, 10, 24))


class WeeklyTests(SimpleTestCase):
    def test_its_day_and_hour(self):
        self.assertEqual(schedule.due(weekly(), at(2026, 10, 24, 18, 0)).run_on, date(2026, 10, 24))

    def test_not_before_the_hour_nor_on_other_days(self):
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 24, 17, 59)))
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 23, 18, 30)))  # Friday
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 25, 18, 30)))  # Sunday

    def test_once_a_week(self):
        post = weekly(last_run_on=date(2026, 10, 24))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 30)))
        self.assertEqual(schedule.due(post, at(2026, 10, 31, 18, 0)).run_on, date(2026, 10, 31))

    def test_a_post_made_after_its_hour_waits_a_week(self):
        post = weekly(active_from=at(2026, 10, 24, 18, 30))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 31)))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 24, 18, 31)), at(2026, 10, 31, 18, 0))

    def test_several_days(self):
        post = weekly(weekdays=[FRI, SAT])
        self.assertEqual(schedule.due(post, at(2026, 10, 23, 18, 0)).run_on, date(2026, 10, 23))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 21, 12)), at(2026, 10, 23, 18, 0))

    def test_next_at(self):
        self.assertEqual(schedule.next_at(weekly(), at(2026, 10, 21, 12)), at(2026, 10, 24, 18, 0))
        sent = weekly(last_run_on=date(2026, 10, 24))
        self.assertEqual(schedule.next_at(sent, at(2026, 10, 24, 18, 5)), at(2026, 10, 31, 18, 0))
        # Today's slot is more than an hour gone: the next one is next week.
        self.assertEqual(schedule.next_at(weekly(), at(2026, 10, 24, 19, 30)), at(2026, 10, 31, 18, 0))

    def test_no_days_means_never(self):
        self.assertIsNone(schedule.next_at(weekly(weekdays=[]), at(2026, 10, 21)))


class EventReminderTests(SimpleTestCase):
    def event(self, **kw):
        kw.setdefault("status", Event.STATUS_PUBLISHED)
        kw.setdefault("starts_at", at(2026, 10, 25, 10))
        return Event(title="Workshop", ends_at=at(2026, 10, 25, 12), seats=30, **kw)

    def post(self, event, **kw):
        kw.setdefault("active_from", at(2026, 10, 20, 9))
        return GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event, **kw)

    def test_the_evening_before(self):
        event = self.event()
        self.assertEqual(schedule.reminder_at(event), at(2026, 10, 24, 18, 0))
        self.assertEqual(schedule.due(self.post(event), at(2026, 10, 24, 18, 0)).run_on, date(2026, 10, 24))

    def test_published_after_that_evening_gets_none(self):
        post = self.post(self.event(), active_from=at(2026, 10, 24, 19))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 19, 5)))
        self.assertIsNone(schedule.next_at(post, at(2026, 10, 24, 19, 5)))

    def test_a_cancelled_event_gets_none(self):
        self.assertIsNone(schedule.due(self.post(self.event(status=Event.STATUS_CANCELLED)), at(2026, 10, 24, 18)))

    def test_a_moved_start_moves_it(self):
        post = self.post(self.event(starts_at=at(2026, 10, 26, 10)), last_run_on=date(2026, 10, 24))
        self.assertEqual(schedule.due(post, at(2026, 10, 25, 18, 0)).run_on, date(2026, 10, 25))

    def test_next_at(self):
        self.assertEqual(schedule.next_at(self.post(self.event()), at(2026, 10, 21)), at(2026, 10, 24, 18, 0))
```

- [ ] **Step 2: Run it to see it fail**

Run: `… manage.py test telegram_posts.tests_schedule --settings=config.settings_test_nomigrations -v 1`
Expected: `ImportError: cannot import name 'schedule'`.

- [ ] **Step 3: Implement** — `backend/telegram_posts/schedule.py`:

```python
"""When a post goes out. Pure functions of the post, its event and `now` — no queries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional

from django.utils import timezone

from events.models import Event

from .models import GroupPost

#: A run further behind than this (the server was down) is recorded Missed and never sent on
#: its own: "tomorrow's mock" at 23:00 is worse than no message.
LATE_LIMIT = timedelta(minutes=60)
#: The event reminder goes out at this Tashkent wall-clock time, the day before the start.
REMINDER_TIME = time(18, 0)


@dataclass(frozen=True)
class Due:
    run_on: date
    scheduled_at: datetime
    late: bool


def _at(day: date, at: time) -> datetime:
    return timezone.make_aware(datetime.combine(day, at))


def reminder_at(event) -> datetime:
    return _at(timezone.localtime(event.starts_at).date() - timedelta(days=1), REMINDER_TIME)


def _live_event(post, now) -> Optional[Event]:
    event = post.event
    if event is None or event.status != Event.STATUS_PUBLISHED or event.starts_at <= now:
        return None
    return event


def _moment(post, now) -> Optional[datetime]:
    """The one scheduled moment that could be due at `now`."""
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE):
        return post.send_at
    if post.when == GroupPost.WHEN_WEEKLY:
        today = timezone.localtime(now).date()
        if post.time_of_day is None or today.weekday() not in (post.weekdays or []):
            return None
        return _at(today, post.time_of_day)
    if post.when == GroupPost.WHEN_EVENT:
        event = _live_event(post, now)
        return reminder_at(event) if event else None
    return None


def due(post, now) -> Optional[Due]:
    if post.deleted_at or post.is_paused:
        return None
    moment = _moment(post, now)
    if moment is None or moment > now or moment < post.active_from:
        return None
    run_on = timezone.localtime(moment).date()
    if post.last_run_on and post.last_run_on >= run_on:
        return None
    return Due(run_on=run_on, scheduled_at=moment, late=now - moment > LATE_LIMIT)


def next_at(post, now) -> Optional[datetime]:
    """When it next goes out, for the console. None when nothing more is scheduled."""
    if post.deleted_at or post.is_paused:
        return None
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE):
        return post.send_at if post.last_run_on is None else None
    if post.when == GroupPost.WHEN_WEEKLY:
        if post.time_of_day is None or not post.weekdays:
            return None
        today = timezone.localtime(now).date()
        for offset in range(8):
            day = today + timedelta(days=offset)
            if day.weekday() not in post.weekdays:
                continue
            moment = _at(day, post.time_of_day)
            if moment < post.active_from or (post.last_run_on and post.last_run_on >= day):
                continue
            if now - moment > LATE_LIMIT:
                continue
            return moment
        return None
    if post.when == GroupPost.WHEN_EVENT:
        event = _live_event(post, now)
        if event is None:
            return None
        moment = reminder_at(event)
        if moment < post.active_from or now - moment > LATE_LIMIT:
            return None
        if post.last_run_on and post.last_run_on >= timezone.localtime(moment).date():
            return None
        return moment
    return None
```

- [ ] **Step 4: Run it to see it pass**

Run: the Step 2 command. Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/telegram_posts/schedule.py backend/telegram_posts/tests_schedule.py
git commit -m "feat(telegram_posts): when a post is due — once, weekly, the evening before an event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sending — the claim, one row per group, retries, the sweep

**Files:**
- Create: `backend/telegram_posts/sender.py`, `backend/telegram_posts/tasks.py`
- Modify: `backend/telegram_posts/testkit.py` (append `FakeApi`, `fake_api`), `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`: add after `"events-send-due-reminders"`)
- Test: `backend/telegram_posts/tests_sender.py`

**Interfaces:**
- Consumes:
  - `schedule.due` / `Due`;
  - `audience.for_post`;
  - `render.render` / `Rendered`;
  - `api.send_message`, `api.send_photo`, `api.largest_photo_file_id`, `api.is_configured`, `api.TgResult`.
- Produces (in `sender`):
  - `api` (module attribute; tests patch `telegram_posts.sender.api`, and `services` calls Telegram only through it);
  - `_sleep`;
  - `MAX_TRIES`, `RETRY_AFTER_CAP`, `INTERRUPTED_AFTER`;
  - `enabled() -> bool`;
  - `claim_run(post, due) -> bool`;
  - `open_run(post, due) -> int`;
  - `send_pending(post, run_on) -> dict` (`sent`, `failed`, `skipped`);
  - `sweep(*, now=None) -> dict` (`runs`, `sent`, `failed`, `missed`);
  - `send_post_now(post_id) -> dict`.
- Produces (in `tasks`): `sweep_group_posts` (`"telegram_posts.sweep"`), `send_group_post_now(post_id)` (`"telegram_posts.send_now"`).

- [ ] **Step 1: Append the fake Bot API to `backend/telegram_posts/testkit.py`**

Add `from contextlib import contextmanager` and `from unittest import mock` to its imports, plus `from classes import telegram_group_api as real_api`. Then append:

```python
class FakeApi:
    """Stands in for `classes.telegram_group_api` inside `telegram_posts.sender`.

    Every call succeeds unless `script` holds answers for that chat: a list of TgResults
    returned in order before the calls start succeeding. ``script["delete:<chat>"]`` does the
    same for `delete_message`.
    """

    TgResult = real_api.TgResult
    largest_photo_file_id = staticmethod(real_api.largest_photo_file_id)

    def __init__(self):
        self.messages: list[tuple[str, str, dict | None]] = []
        self.photos: list[tuple[str, str, str, dict | None]] = []  # (chat, caption, "upload"|file_id, markup)
        self.deleted: list[tuple[str, int]] = []
        self.script: dict[str, list] = {}
        self._next_id = 100

    def is_configured(self):
        return True

    def _answer(self, key, payload):
        queue = self.script.get(key)
        if queue:
            return queue.pop(0)
        self._next_id += 1
        return real_api.TgResult(True, {"message_id": self._next_id, **payload})

    def send_message(self, chat_id, text, *, reply_markup=None):
        result = self._answer(str(chat_id), {})
        if result.ok:
            self.messages.append((str(chat_id), text, reply_markup))
        return result

    def send_photo(self, chat_id, *, caption, photo=None, filename="photo.jpg",
                   content_type="image/jpeg", file_id="", reply_markup=None):
        sizes = {"photo": [{"file_id": "FID-small", "file_size": 10}, {"file_id": "FID-big", "file_size": 999}]}
        result = self._answer(str(chat_id), sizes)
        if result.ok:
            self.photos.append((str(chat_id), caption, file_id or "upload", reply_markup))
        return result

    def delete_message(self, chat_id, message_id):
        result = self._answer(f"delete:{chat_id}", {})
        if result.ok:
            self.deleted.append((str(chat_id), int(message_id)))
        return result


@contextmanager
def fake_api():
    fake = FakeApi()
    with mock.patch("telegram_posts.sender.api", fake):
        yield fake
```

- [ ] **Step 2: Write the failing test** — `backend/telegram_posts/tests_sender.py`:

```python
"""Sending: each group once, late runs never, retries only where they can help."""

from __future__ import annotations

import tempfile
from datetime import date, time, timedelta
from unittest import mock

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from classes.telegram_group_api import TgResult
from events.models import Event
from telegram_posts import sender
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import PNG_1PX, TOKEN, at, fake_api, make_event, make_room

SENT = GroupPostDelivery.STATUS_SENT
FAILED = GroupPostDelivery.STATUS_FAILED
MISSED = GroupPostDelivery.STATUS_MISSED
SENDING = GroupPostDelivery.STATUS_SENDING


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN, MEDIA_ROOT=tempfile.mkdtemp(),
)
class SweepTests(TestCase):
    def setUp(self):
        self.sleeps: list = []
        patch = mock.patch("telegram_posts.sender._sleep", side_effect=self.sleeps.append)
        patch.start()
        self.addCleanup(patch.stop)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 Math", level="junior", chat="-1002")
        self.now = at(2026, 10, 24, 18, 0)

    def post(self, **kw):
        kw.setdefault("text", "Ertaga yakshanba soat 10:00 da mock!")
        kw.setdefault("when", GroupPost.WHEN_ONCE)
        kw.setdefault("send_at", self.now)
        kw.setdefault("active_from", at(2026, 10, 20))
        return GroupPost.objects.create(**kw)

    def rows(self, post):
        return {r.chat_id: r for r in post.deliveries.all()}

    def test_nothing_goes_out_with_the_flag_off(self):
        self.post()
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(tg.messages, [])

    def test_a_due_post_reaches_every_group_once(self):
        post = self.post()
        with fake_api() as tg:
            sender.sweep(now=self.now)
            sender.sweep(now=self.now + timedelta(minutes=1))
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])
        rows = self.rows(post)
        self.assertEqual({r.status for r in rows.values()}, {SENT})
        self.assertTrue(all(r.message_id and r.sent_at and r.attempts == 1 for r in rows.values()))

    def test_two_classes_in_one_group_get_one_message(self):
        make_room("Senior G5 Math", chat="-1001")
        post = self.post()
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(len(tg.messages), 2)
        self.assertEqual(self.rows(post)["-1001"].group_names, "Senior G1 Math, Senior G5 Math")

    def test_more_than_an_hour_late_is_missed_not_sent(self):
        post = self.post()
        with fake_api() as tg:
            stats = sender.sweep(now=self.now + timedelta(minutes=61))
        self.assertEqual(tg.messages, [])
        self.assertEqual({r.status for r in self.rows(post).values()}, {MISSED})
        self.assertEqual(stats["missed"], 2)

    def test_a_429_waits_as_told_and_tries_again(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=429, description="Too Many Requests", retry_after=3)]
            sender.sweep(now=self.now)
        self.assertEqual(self.sleeps, [3])
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (SENT, 2))

    def test_a_long_wait_is_capped(self):
        self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=429, description="Too Many Requests", retry_after=300)]
            sender.sweep(now=self.now)
        self.assertEqual(self.sleeps, [sender.RETRY_AFTER_CAP])

    def test_a_403_is_not_retried_and_the_other_groups_still_get_it(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=403, description="Forbidden: bot was kicked from the supergroup chat")]
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 1))
        self.assertIn("kicked", row.error)
        self.assertEqual([m[0] for m in tg.messages], ["-1002"])

    def test_a_network_failure_is_tried_three_times(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, description="URLError: timed out")] * 3
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 3))
        self.assertEqual(self.sleeps, [1, 2])

    def test_the_picture_is_uploaded_once(self):
        post = self.post(image=SimpleUploadedFile("mock.png", PNG_1PX, content_type="image/png"))
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual([p[2] for p in tg.photos], ["upload", "FID-big"])
        post.refresh_from_db()
        self.assertEqual(post.image_file_id, "FID-big")

    def test_the_button_rides_along(self):
        self.post(button_text="Ro'yxat", button_url="https://mastersat.uz/events")
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(
            tg.messages[0][2],
            {"inline_keyboard": [[{"text": "Ro'yxat", "url": "https://mastersat.uz/events"}]]},
        )

    def test_an_interrupted_send_is_marked_failed_and_not_resent(self):
        post = self.post(last_run_on=date(2026, 10, 24))
        row = GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=SENDING)
        GroupPostDelivery.objects.filter(pk=row.pk).update(updated_at=self.now - timedelta(minutes=11))
        with fake_api() as tg:
            sender.sweep(now=self.now)
        row.refresh_from_db()
        self.assertEqual(row.status, FAILED)
        self.assertIn("Interrupted", row.error)
        self.assertEqual(tg.messages, [])

    def test_a_weekly_post_goes_each_week(self):
        post = self.post(when=GroupPost.WHEN_WEEKLY, send_at=None, weekdays=[5], time_of_day=time(18, 0))
        with fake_api() as tg:
            sender.sweep(now=self.now)
            sender.sweep(now=self.now + timedelta(days=7))
        self.assertEqual(len(tg.messages), 4)
        self.assertEqual(
            sorted({r.run_on for r in post.deliveries.all()}), [date(2026, 10, 24), date(2026, 10, 31)]
        )

    def test_send_now_sends_a_now_post_at_once(self):
        # The real clock: send_post_now reads timezone.now(), not the sweep's `now`.
        now = timezone.now()
        post = GroupPost.objects.create(text="Hozir!", when=GroupPost.WHEN_NOW, send_at=now, active_from=now)
        with fake_api() as tg:
            sender.send_post_now(post.pk)
            sender.send_post_now(post.pk)  # a second dispatch finds the run claimed
        self.assertEqual(len(tg.messages), 2)

    def test_a_reminder_for_an_event_cancelled_mid_run_is_not_sent(self):
        event = make_event()
        post = GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event,
            last_run_on=date(2026, 10, 24),
        )
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        Event.objects.filter(pk=event.pk).update(status=Event.STATUS_CANCELLED)
        with fake_api() as tg:
            stats = sender.send_pending(GroupPost.objects.get(pk=post.pk), date(2026, 10, 24))
        self.assertEqual(tg.messages, [])
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(post.deliveries.get().status, MISSED)


class WiringTests(SimpleTestCase):
    def test_the_tasks_and_the_beat_entry(self):
        from telegram_posts import tasks

        self.assertEqual(tasks.sweep_group_posts.name, "telegram_posts.sweep")
        self.assertEqual(tasks.send_group_post_now.name, "telegram_posts.send_now")
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["telegram-posts-sweep"]["task"], "telegram_posts.sweep")
```

- [ ] **Step 3: Run it to see it fail**

Run: `… manage.py test telegram_posts.tests_sender --settings=config.settings_test_nomigrations -v 1`
Expected: `ImportError: cannot import name 'sender'`.

- [ ] **Step 4: Implement**

`backend/telegram_posts/sender.py`:

```python
"""Sending: claim a run, open one row per group, send each with retries — and the sweep.

The run's claim is a conditional UPDATE on ``GroupPost.last_run_on`` (the events reminder's
pattern), so two overlapping beats, or a beat and a "send now", open a run once between them.
Each row is then claimed PENDING → SENDING before its message goes, so a retry racing the sweep
cannot send one group the same post twice. A row found still SENDING long after is marked
Failed, never re-sent: the message may well have arrived, and only a person can look.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import time
from datetime import date, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from classes import telegram_group_api as api

from . import audience, render, schedule
from .models import GroupPost, GroupPostDelivery

logger = logging.getLogger("telegram_posts")

MAX_TRIES = 3
#: Telegram's 429 says how long to wait; past this it is better to fail the row and let a
#: person press Retry than to hold a worker for minutes.
RETRY_AFTER_CAP = 30
INTERRUPTED_AFTER = timedelta(minutes=10)
INTERRUPTED = "Interrupted while sending — it may or may not have arrived. Check the group before retrying."
LATE = "More than an hour late — not sent on its own."

_sleep = time.sleep  # tests replace it


def enabled() -> bool:
    return bool(getattr(settings, "TELEGRAM_GROUP_POSTS_ENABLED", False)) and api.is_configured()


def claim_run(post, due) -> bool:
    claimed = (
        GroupPost.objects.filter(pk=post.pk)
        .filter(Q(last_run_on__isnull=True) | Q(last_run_on__lt=due.run_on))
        .update(last_run_on=due.run_on)
    )
    if claimed:
        post.last_run_on = due.run_on
    return bool(claimed)


def open_run(post, due) -> int:
    """One row per target group for a claimed run. A late run's rows are born Missed."""
    status = GroupPostDelivery.STATUS_MISSED if due.late else GroupPostDelivery.STATUS_PENDING
    made = 0
    for target in audience.for_post(post):
        _row, created = GroupPostDelivery.objects.get_or_create(
            post=post, run_on=due.run_on, chat_id=target.chat_id,
            defaults={"group_names": target.names, "status": status, "error": LATE if due.late else ""},
        )
        made += int(created)
    return made


def send_pending(post, run_on: date) -> dict:
    stats = {"sent": 0, "failed": 0, "skipped": 0}
    rows = list(
        GroupPostDelivery.objects.filter(
            post=post, run_on=run_on, status=GroupPostDelivery.STATUS_PENDING
        ).order_by("id")
    )
    if not rows:
        return stats
    rendered = render.render(post)
    if rendered is None:
        # The event behind it stopped being published after the run opened.
        GroupPostDelivery.objects.filter(
            pk__in=[r.pk for r in rows], status=GroupPostDelivery.STATUS_PENDING
        ).update(
            status=GroupPostDelivery.STATUS_MISSED,
            error="Nothing to send: the event is no longer published.",
            updated_at=timezone.now(),
        )
        stats["skipped"] = len(rows)
        return stats

    markup = _markup(rendered)
    for row in rows:
        took = GroupPostDelivery.objects.filter(
            pk=row.pk, status=GroupPostDelivery.STATUS_PENDING
        ).update(status=GroupPostDelivery.STATUS_SENDING, updated_at=timezone.now())
        if not took:
            continue
        result, tries = _deliver(post, rendered, markup, row.chat_id)
        if result.ok:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_SENT, message_id=_message_id(result),
                attempts=tries, sent_at=timezone.now(), error="", updated_at=timezone.now(),
            )
            stats["sent"] += 1
        else:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_FAILED, attempts=tries, error=_reason(result),
                updated_at=timezone.now(),
            )
            stats["failed"] += 1
    return stats


def _markup(rendered):
    if not rendered.button:
        return None
    label, url = rendered.button
    return {"inline_keyboard": [[{"text": label, "url": url}]]}


def _deliver(post, rendered, markup, chat_id):
    result = None
    for attempt in range(1, MAX_TRIES + 1):
        result = _send_once(post, rendered, markup, chat_id)
        if result.ok or not _worth_retrying(result) or attempt == MAX_TRIES:
            return result, attempt
        _sleep(min(result.retry_after or attempt, RETRY_AFTER_CAP))
    return result, MAX_TRIES


def _worth_retrying(result) -> bool:
    """A 429, a 5xx, or no answer at all. A 400/403 will say the same thing next time."""
    code = result.error_code
    return code is None or code == 429 or code >= 500


def _send_once(post, rendered, markup, chat_id):
    if rendered.image is None:
        return api.send_message(chat_id, rendered.text, reply_markup=markup)
    if post.image_file_id:
        return api.send_photo(
            chat_id, caption=rendered.text, file_id=post.image_file_id, reply_markup=markup
        )
    data, name, content_type = _image_bytes(rendered.image)
    if not data:
        return api.TgResult(False, error_code=400, description="The picture could not be read from storage.")
    result = api.send_photo(
        chat_id, caption=rendered.text, photo=data, filename=name,
        content_type=content_type, reply_markup=markup,
    )
    if result.ok:
        file_id = api.largest_photo_file_id(result.result)
        if file_id:
            GroupPost.objects.filter(pk=post.pk).update(image_file_id=file_id)
            post.image_file_id = file_id
    return result


def _image_bytes(field) -> tuple[bytes, str, str]:
    try:
        field.open("rb")
        try:
            data = field.read()
        finally:
            field.close()
    except Exception:
        logger.exception("telegram post picture unreadable: %s", getattr(field, "name", ""))
        return b"", "", ""
    name = os.path.basename(field.name or "") or "photo.jpg"
    return data, name, mimetypes.guess_type(name)[0] or "image/jpeg"


def _message_id(result):
    try:
        return int((result.result or {}).get("message_id"))
    except (TypeError, ValueError, AttributeError):
        return None


def _reason(result) -> str:
    prefix = "The bot is not in this group any more, or may not post. " if result.error_code == 403 else ""
    code = f"{result.error_code}: " if result.error_code else ""
    return (prefix + code + (result.description or "Telegram did not answer."))[:400]


def _fail_interrupted(now) -> int:
    return GroupPostDelivery.objects.filter(
        status=GroupPostDelivery.STATUS_SENDING, updated_at__lt=now - INTERRUPTED_AFTER
    ).update(status=GroupPostDelivery.STATUS_FAILED, error=INTERRUPTED, updated_at=now)


def sweep(*, now=None) -> dict:
    stats = {"runs": 0, "sent": 0, "failed": 0, "missed": 0}
    if not enabled():
        return stats
    now = now or timezone.now()
    _fail_interrupted(now)
    posts = (
        GroupPost.objects.filter(deleted_at__isnull=True, is_paused=False)
        # A once/now post that has run is finished; only repeating posts stay in the scan.
        .filter(Q(when__in=[GroupPost.WHEN_WEEKLY, GroupPost.WHEN_EVENT]) | Q(last_run_on__isnull=True))
        .select_related("event")
    )
    for post in posts:
        due = schedule.due(post, now)
        if due is None or not claim_run(post, due):
            continue
        stats["runs"] += 1
        open_run(post, due)
        if due.late:
            stats["missed"] += post.deliveries.filter(
                run_on=due.run_on, status=GroupPostDelivery.STATUS_MISSED
            ).count()
            continue
        result = send_pending(post, due.run_on)
        stats["sent"] += result["sent"]
        stats["failed"] += result["failed"]
    if stats["runs"]:
        logger.info("telegram_posts sweep %s", stats)
    return stats


def send_post_now(post_id: int) -> dict:
    """A "Now" post or an event's announcement, dispatched on commit: nobody waits a minute."""
    if not enabled():
        return {}
    post = GroupPost.objects.select_related("event").filter(pk=post_id).first()
    if post is None:
        return {}
    due = schedule.due(post, timezone.now())
    if due is None or not claim_run(post, due):
        return {}
    open_run(post, due)
    return {} if due.late else send_pending(post, due.run_on)
```

`backend/telegram_posts/tasks.py`:

```python
"""Every task this app owns. ``app.autodiscover_tasks()`` imports exactly this module."""

from __future__ import annotations

from celery import shared_task


@shared_task(name="telegram_posts.sweep")
def sweep_group_posts() -> dict:
    from . import sender

    return sender.sweep()


@shared_task(name="telegram_posts.send_now")
def send_group_post_now(post_id: int) -> dict:
    from . import sender

    return sender.send_post_now(post_id)
```

In `backend/config/settings.py`, inside `CELERY_BEAT_SCHEDULE`, after the `"events-send-due-reminders"` entry:

```python
    # Telegram group posts (plan 2026-10-17): whatever is due, every minute. A no-op while
    # TELEGRAM_GROUP_POSTS_ENABLED is off.
    "telegram-posts-sweep": {
        "task": "telegram_posts.sweep",
        "schedule": crontab(),
    },
```

- [ ] **Step 5: Run it to see it pass**

Run: the Step 3 command. Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/telegram_posts/sender.py backend/telegram_posts/tasks.py backend/telegram_posts/testkit.py backend/telegram_posts/tests_sender.py backend/config/settings.py
git commit -m "feat(telegram_posts): send each group once, never late, retry only where it helps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: What the console does to a post

**Files:**
- Create: `backend/telegram_posts/services.py`
- Modify: `backend/telegram_posts/sender.py` (append `send_run`), `backend/telegram_posts/tasks.py` (append `send_group_post_run`)
- Test: `backend/telegram_posts/tests_services.py`

**Interfaces:**
- Consumes:
  - `sender.*` (Task 5);
  - `schedule.next_at`;
  - `classes.telegram_group_hooks._dispatch(task, *args)`, which runs on commit (eager inline, or `.delay`, or a thread).
- Produces (in `services`):
  - `DELETE_WINDOW`;
  - `PostRefused(code, message)`;
  - `ensure_editable(post)`;
  - `create_post(*, data, user, now=None) -> GroupPost`;
  - `update_post(post, data, *, now=None) -> GroupPost`;
  - `pause(post)`, `resume(post, *, now=None)`;
  - `retry_failed(post) -> {"queued": int}`;
  - `send_missed_now(post, *, now=None) -> {"queued": int}`;
  - `delete_from_groups(post, *, now=None) -> {"deleted", "too_old", "failed"}`;
  - `delivery_counts(post_ids) -> {post_id: {run_on: Counter}}`;
  - `last_run(post, counts) -> dict | None` (`run_on, total, sent, failed, missed, pending, deleted`);
  - `post_state(post, last, now) -> str`, one of `scheduled | sending | sent | failed | missed | paused | deleted | done | event_cancelled`;
  - `runs(post, *, limit=12) -> list[{"run_on": date, "deliveries": [GroupPostDelivery]}]`.
- Produces in `sender`: `send_run(post_id, run_on) -> dict`. In `tasks`: `send_group_post_run(post_id, run_on: str)` (`"telegram_posts.send_run"`).

Refusal codes:
- `event_post`: edit the event instead;
- `deleted`;
- `already_sent`: a once/now post that has run;
- `off`: the flag is off, so nothing can be queued;
- `too_late`: a reminder after its event started.

- [ ] **Step 1: Write the failing test** — `backend/telegram_posts/tests_services.py`:

```python
"""The console's verbs: create, edit, pause, resume, retry, send missed, delete from groups."""

from __future__ import annotations

from datetime import date, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from classes.telegram_group_api import TgResult
from telegram_posts import schedule, sender, services
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import TOKEN, at, fake_api, make_event, make_room, staff

D = GroupPostDelivery


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class ServiceTests(TestCase):
    def setUp(self):
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 Math", level="junior", chat="-1002")
        self.user = staff()

    def sent_post(self, **kw):
        kw.setdefault("text", "Mock!")
        kw.setdefault("when", GroupPost.WHEN_ONCE)
        kw.setdefault("send_at", at(2026, 10, 24, 18))
        kw.setdefault("last_run_on", date(2026, 10, 24))
        return GroupPost.objects.create(**kw)

    # ── create / edit ──────────────────────────────────────────────────────
    def test_a_now_post_goes_out_on_commit(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            post = services.create_post(data={"text": "Salom", "when": GroupPost.WHEN_NOW}, user=self.user)
        self.assertEqual(len(tg.messages), 2)
        post.refresh_from_db()
        self.assertEqual(post.last_run_on, timezone.localdate())
        self.assertEqual(post.created_by, self.user)

    def test_a_scheduled_post_waits(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            services.create_post(
                data={"text": "Keyin", "when": GroupPost.WHEN_ONCE, "send_at": timezone.now() + timedelta(days=1)},
                user=self.user,
            )
        self.assertEqual(tg.messages, [])

    def test_an_event_post_is_edited_through_its_event(self):
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=make_event())
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(post, {"text": "x"})
        self.assertEqual(caught.exception.code, "event_post")

    def test_a_post_that_has_gone_out_is_not_edited(self):
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(self.sent_post(), {"text": "x"})
        self.assertEqual(caught.exception.code, "already_sent")

    def test_a_schedule_edit_restarts_the_clock_and_a_new_picture_forgets_its_file_id(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            active_from=at(2026, 10, 1), image_file_id="OLD",
        )
        now = at(2026, 10, 24, 18, 30)
        services.update_post(post, {"weekdays": [4, 5], "image": None}, now=now)
        post.refresh_from_db()
        self.assertEqual(post.active_from, now)
        self.assertEqual(post.image_file_id, "")

    def test_resume_skips_what_the_pause_covered(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        services.pause(post)
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 0)))
        services.resume(post, now=at(2026, 10, 24, 18, 30))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 31)))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 24, 18, 31)), at(2026, 10, 31, 18, 0))

    # ── retry / missed ─────────────────────────────────────────────────────
    def test_retry_requeues_only_the_failed_rows_of_the_last_run(self):
        post = self.sent_post(when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT, message_id=5)
        old = D.objects.create(post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_FAILED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            result = services.retry_failed(post)
        self.assertEqual(result, {"queued": 1})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])
        old.refresh_from_db()
        self.assertEqual(old.status, D.STATUS_FAILED)

    def test_send_missed_now(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_MISSED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(services.send_missed_now(post), {"queued": 1})
        self.assertEqual(len(tg.messages), 1)

    def test_nothing_is_queued_with_the_flag_off(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), self.assertRaises(services.PostRefused) as caught:
            services.retry_failed(post)
        self.assertEqual(caught.exception.code, "off")

    def test_a_reminder_is_not_sent_after_its_event_started(self):
        event = make_event(starts_at=timezone.now() - timedelta(hours=1))
        post = GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event, last_run_on=date(2026, 10, 24),
        )
        with self.assertRaises(services.PostRefused) as caught:
            services.send_missed_now(post)
        self.assertEqual(caught.exception.code, "too_late")

    # ── delete from groups ─────────────────────────────────────────────────
    def test_delete_from_groups(self):
        now = at(2026, 10, 24, 20)
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT, message_id=11, sent_at=now - timedelta(hours=1))
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT, message_id=12, sent_at=now - timedelta(hours=49))
        never = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1003", status=D.STATUS_FAILED)
        with fake_api() as tg:
            stats = services.delete_from_groups(post, now=now)
        self.assertEqual(stats, {"deleted": 1, "too_old": 1, "failed": 0})
        self.assertEqual(tg.deleted, [("-1001", 11)])
        post.refresh_from_db()
        self.assertEqual(post.deleted_at, now)
        never.refresh_from_db()
        self.assertEqual(never.status, D.STATUS_DELETED)
        self.assertEqual(post.deliveries.get(chat_id="-1002").status, D.STATUS_SENT)

    def test_a_message_already_gone_counts_as_deleted(self):
        now = at(2026, 10, 24, 20)
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT, message_id=11, sent_at=now)
        with fake_api() as tg:
            tg.script["delete:-1001"] = [TgResult(False, error_code=400, description="Bad Request: message to delete not found")]
            stats = services.delete_from_groups(post, now=now)
        self.assertEqual(stats["deleted"], 1)

    def test_a_deleted_weekly_post_never_sends_again(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with fake_api() as tg:
            services.delete_from_groups(post, now=at(2026, 10, 20))
            sender.sweep(now=at(2026, 10, 24, 18))
        self.assertEqual(tg.messages, [])

    # ── what the console shows ─────────────────────────────────────────────
    def test_counts_last_run_and_state(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_FAILED)
        counts = services.delivery_counts([post.pk])
        last = services.last_run(post, counts)
        self.assertEqual(
            last,
            {"run_on": date(2026, 10, 24), "total": 2, "sent": 1, "failed": 1, "missed": 0, "pending": 0, "deleted": 0},
        )
        self.assertEqual(services.post_state(post, last, at(2026, 10, 24, 19)), "failed")
        weekly = GroupPost.objects.create(text="w", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1))
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "scheduled")
        weekly.is_paused = True
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "paused")

    def test_runs_newest_first(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT)
        runs = services.runs(post)
        self.assertEqual([r["run_on"] for r in runs], [date(2026, 10, 24), date(2026, 10, 17)])
        self.assertEqual([d.chat_id for d in runs[0]["deliveries"]], ["-1001", "-1002"])
```

- [ ] **Step 2: Run it to see it fail**

Run: `… manage.py test telegram_posts.tests_services --settings=config.settings_test_nomigrations -v 1`
Expected: `ImportError: cannot import name 'services'`.

- [ ] **Step 3: Implement**

Append to `backend/telegram_posts/sender.py`:

```python
def send_run(post_id: int, run_on: date) -> dict:
    """Send what a retry or "send missed now" put back to Pending."""
    if not enabled():
        return {}
    post = GroupPost.objects.select_related("event").filter(pk=post_id, deleted_at__isnull=True).first()
    return send_pending(post, run_on) if post else {}
```

Append to `backend/telegram_posts/tasks.py`:

```python
@shared_task(name="telegram_posts.send_run")
def send_group_post_run(post_id: int, run_on: str) -> dict:
    from datetime import date

    from . import sender

    return sender.send_run(post_id, date.fromisoformat(run_on))
```

`backend/telegram_posts/services.py`:

```python
"""What the console does to a post. The rules live here, not in the views: the ops page, the
Django shell and the event hooks all come through these functions."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from events.models import Event

from . import schedule, sender
from .models import GroupPost, GroupPostDelivery

logger = logging.getLogger("telegram_posts")

#: Telegram lets a bot delete its own group messages for this long.
DELETE_WINDOW = timedelta(hours=48)
SCHEDULE_FIELDS = {"when", "send_at", "weekdays", "time_of_day"}


class PostRefused(Exception):
    """A refusal with a code the page can branch on and a sentence it can show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _dispatch_now(post) -> None:
    from classes.telegram_group_hooks import _dispatch

    from .tasks import send_group_post_now

    _dispatch(send_group_post_now, post.pk)


def _dispatch_run(post, run_on) -> None:
    from classes.telegram_group_hooks import _dispatch

    from .tasks import send_group_post_run

    _dispatch(send_group_post_run, post.pk, run_on.isoformat())


# ── create / edit ────────────────────────────────────────────────────────────


def create_post(*, data: dict, user, now=None) -> GroupPost:
    now = now or timezone.now()
    post = GroupPost(kind=GroupPost.KIND_MANUAL, created_by=user, active_from=now, **data)
    if post.when == GroupPost.WHEN_NOW:
        post.send_at = now
    post.save()
    if post.when == GroupPost.WHEN_NOW:
        _dispatch_now(post)
    return post


def ensure_editable(post) -> None:
    if post.is_event_post:
        raise PostRefused("event_post", "This post comes from an event — edit the event instead.")
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE) and post.last_run_on:
        raise PostRefused("already_sent", "This post has already gone out. Write a new one instead.")


def update_post(post, data: dict, *, now=None) -> GroupPost:
    """Edits change future sends only. A message already in a group is never rewritten."""
    now = now or timezone.now()
    ensure_editable(post)
    for field, value in data.items():
        setattr(post, field, value)
    if "image" in data:
        post.image_file_id = ""
    if SCHEDULE_FIELDS & set(data):
        post.active_from = now
    if post.when == GroupPost.WHEN_NOW:
        post.send_at = now
    post.save()
    if post.when == GroupPost.WHEN_NOW:
        _dispatch_now(post)
    return post


def pause(post) -> None:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    post.is_paused = True
    post.save(update_fields=["is_paused", "updated_at"])


def resume(post, *, now=None) -> None:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    post.is_paused = False
    # What the pause covered stays skipped: resuming is not a burst of everything missed.
    post.active_from = now or timezone.now()
    post.save(update_fields=["is_paused", "active_from", "updated_at"])


# ── retry / missed ───────────────────────────────────────────────────────────


def _requeue(post, status: str) -> int:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    if not sender.enabled():
        raise PostRefused("off", "Posting to Telegram groups is switched off on this server.")
    if not post.last_run_on:
        return 0
    queued = GroupPostDelivery.objects.filter(
        post=post, run_on=post.last_run_on, status=status
    ).update(status=GroupPostDelivery.STATUS_PENDING, error="", updated_at=timezone.now())
    if queued:
        _dispatch_run(post, post.last_run_on)
    return queued


def retry_failed(post) -> dict:
    return {"queued": _requeue(post, GroupPostDelivery.STATUS_FAILED)}


def send_missed_now(post, *, now=None) -> dict:
    now = now or timezone.now()
    if post.kind == GroupPost.KIND_EVENT_REMINDER and (post.event is None or post.event.starts_at <= now):
        raise PostRefused("too_late", "The event has started — its reminder would be wrong now.")
    return {"queued": _requeue(post, GroupPostDelivery.STATUS_MISSED)}


# ── delete from groups ───────────────────────────────────────────────────────


def delete_from_groups(post, *, now=None) -> dict:
    """Take the post out of every group the bot can, and stop it for good.

    Works with the flag off as well: taking a wrong message down is the one thing that must
    never wait for a setting.
    """
    now = now or timezone.now()
    stats = {"deleted": 0, "too_old": 0, "failed": 0}
    GroupPost.objects.filter(pk=post.pk, deleted_at__isnull=True).update(deleted_at=now, updated_at=now)
    post.deleted_at = post.deleted_at or now
    # Never sent: nothing to take down, and nothing will send them now.
    GroupPostDelivery.objects.filter(
        post=post,
        status__in=[GroupPostDelivery.STATUS_PENDING, GroupPostDelivery.STATUS_MISSED, GroupPostDelivery.STATUS_FAILED],
    ).update(status=GroupPostDelivery.STATUS_DELETED, deleted_at=now, updated_at=now)

    for row in GroupPostDelivery.objects.filter(post=post, status=GroupPostDelivery.STATUS_SENT).order_by("id"):
        if not row.message_id or (row.sent_at and now - row.sent_at > DELETE_WINDOW):
            stats["too_old"] += 1
            continue
        result = sender.api.delete_message(row.chat_id, row.message_id)
        if result.ok or "message to delete not found" in (result.description or "").lower():
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_DELETED, deleted_at=now, updated_at=now
            )
            stats["deleted"] += 1
        else:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                error=f"Delete failed: {result.description}"[:400], updated_at=now
            )
            stats["failed"] += 1
    logger.info("telegram_post_deleted post=%s %s", post.pk, stats)
    return stats


# ── what the console shows ───────────────────────────────────────────────────


def delivery_counts(post_ids) -> dict:
    out: dict = defaultdict(lambda: defaultdict(Counter))
    rows = (
        GroupPostDelivery.objects.filter(post_id__in=list(post_ids))
        .order_by()
        .values("post_id", "run_on", "status")
        .annotate(n=Count("id"))
    )
    for row in rows:
        out[row["post_id"]][row["run_on"]][row["status"]] += row["n"]
    return out


def last_run(post, counts) -> dict | None:
    if not post.last_run_on:
        return None
    c = counts.get(post.pk, {}).get(post.last_run_on) or Counter()
    return {
        "run_on": post.last_run_on,
        "total": sum(c.values()),
        "sent": c[GroupPostDelivery.STATUS_SENT],
        "failed": c[GroupPostDelivery.STATUS_FAILED],
        "missed": c[GroupPostDelivery.STATUS_MISSED],
        "pending": c[GroupPostDelivery.STATUS_PENDING] + c[GroupPostDelivery.STATUS_SENDING],
        "deleted": c[GroupPostDelivery.STATUS_DELETED],
    }


def post_state(post, last, now) -> str:
    if post.deleted_at:
        return "deleted"
    if post.event_id and post.event.status == Event.STATUS_CANCELLED:
        return "event_cancelled"
    if post.is_paused:
        return "paused"
    if last:
        if last["pending"]:
            return "sending"
        if last["failed"]:
            return "failed"
        if last["missed"]:
            return "missed"
    if schedule.next_at(post, now):
        return "scheduled"
    return "sent" if last else "done"


def runs(post, *, limit: int = 12) -> list[dict]:
    days = list(
        GroupPostDelivery.objects.filter(post=post)
        .order_by("-run_on")
        .values_list("run_on", flat=True)
        .distinct()[:limit]
    )
    grouped: dict = {day: [] for day in days}
    for row in GroupPostDelivery.objects.filter(post=post, run_on__in=days).order_by("-run_on", "id"):
        grouped[row.run_on].append(row)
    return [{"run_on": day, "deliveries": grouped[day]} for day in days]
```

- [ ] **Step 4: Run the app's tests to see them pass**

Run: `… manage.py test telegram_posts --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/telegram_posts/services.py backend/telegram_posts/sender.py backend/telegram_posts/tasks.py backend/telegram_posts/tests_services.py
git commit -m "feat(telegram_posts): edit, pause, retry, send missed, delete from groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The ops API

**Files:**
- Create: `backend/telegram_posts/serializers.py`, `backend/telegram_posts/views.py`, `backend/telegram_posts/urls.py`
- Modify:
  - `backend/config/urls.py`: after `path('api/events/', include('events.urls')),`;
  - `backend/access/host_guard.py`: in the admin console block, right after the `/api/events/` entry.
- Test: `backend/telegram_posts/tests_api.py`

**Interfaces:**
- Consumes: `services.*` (Task 6), `sender.enabled`, `audience.label`, `audience.picker_rows`, `render.render`, `schedule.next_at`, `rewards.views._is_reward_staff`.
- Produces HTTP (all staff-only; 401 signed out, 403 for anyone else):
  - `GET /api/telegram-posts/admin/` → `{"enabled": bool, "posts": [Post]}` (newest 200);
  - `POST /api/telegram-posts/admin/` (JSON or multipart; lists may be JSON strings) → `201 PostDetail`;
  - `GET /api/telegram-posts/admin/<id>/` → `PostDetail`;
  - `PATCH /api/telegram-posts/admin/<id>/` → `PostDetail`, or `400 {"code","detail"}`;
  - `POST /api/telegram-posts/admin/<id>/<action>/`, where action is `pause | resume | retry | send-missed | delete-from-groups` → `{"result": {...}, "post": PostDetail}`; any other action is 404;
  - `GET /api/telegram-posts/admin/groups/` → `{"enabled": bool, "groups": [{"id","name","subject","level","chat_id"}]}`.
- `Post` fields: `id, kind, text, preview, image_url, button_text, button_url, subjects, levels, classroom_ids, when, send_at, weekdays, time_of_day, is_paused, deleted_at, event_id, event_title, created_at, audience_label, next_send_at, last_run, state`. `time_of_day` is `"HH:MM:SS"`. `last_run` is `{"run_on","total","sent","failed","missed","pending","deleted"} | null`.
- `PostDetail` = `Post` + `runs: [{"run_on": "YYYY-MM-DD", "deliveries": [{"id","chat_id","group_names","status","error","sent_at","attempts"}]}]`.

- [ ] **Step 1: Write the failing test** — `backend/telegram_posts/tests_api.py`:

```python
"""The ops console's API for group posts: who may use it, and what it does."""

from __future__ import annotations

import json
import tempfile
from datetime import date, time, timedelta
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import PNG_1PX, TOKEN, fake_api, make_event, make_room, staff
from users.models import User

URL = "/api/telegram-posts/admin/"
_ADMIN_HOST = "admin.mastersat.uz"


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="", MEDIA_ROOT=tempfile.mkdtemp(),
)
class ApiFixture(TestCase):
    def setUp(self):
        self.admin = staff()
        self.teacher = User.objects.create_user("tp_teacher@t.com", "x", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = User.objects.create_user("tp_student@t.com", "x", role=C.ROLE_STUDENT)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 English", subject=Classroom.SUBJECT_ENGLISH, level="junior", chat="-1002")
        self.client = APIClient()
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client


class AccessTests(ApiFixture):
    def test_students_and_teachers_are_refused(self):
        self.assertEqual(self.as_(self.student).get(URL).status_code, 403)
        self.assertEqual(self.as_(self.teacher).get(URL).status_code, 403)

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)

    def test_an_admin_is_let_in(self):
        self.assertEqual(self.as_(self.admin).get(URL).status_code, 200)

    @override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver", _ADMIN_HOST])
    def test_the_admin_console_host_is_not_refused_by_the_host_guard(self):
        """access.host_guard allowlists paths per console; a forgotten entry 403s before the
        view is reached, which a same-host test would never notice."""
        response = self.as_(self.admin).get(URL, HTTP_HOST=_ADMIN_HOST)
        self.assertEqual(response.status_code, 200)


class CreateTests(ApiFixture):
    def test_a_now_post_goes_out(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, {"text": "Ertaga mock!", "when": "NOW"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])

    def test_multipart_with_a_picture_and_json_string_lists(self):
        body = {
            "text": "Mock", "when": "NOW", "subjects": json.dumps(["MATH"]), "levels": "[]",
            "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png"),
        }
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, body, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["subjects"], ["MATH"])
        self.assertEqual([(p[0], p[2]) for p in tg.photos], [("-1001", "upload")])

    def test_the_rules(self):
        cases = [
            ({"text": "  ", "when": "NOW"}, "text"),
            ({"text": "x" * 4097, "when": "NOW"}, "text"),
            ({"text": "a", "when": "NOW", "button_text": "Go"}, "button_url"),
            ({"text": "a", "when": "NOW", "button_text": "Go", "button_url": "http://x.uz"}, "button_url"),
            ({"text": "a", "when": "WEEKLY", "time_of_day": "18:00"}, "weekdays"),
            ({"text": "a", "when": "WEEKLY", "weekdays": [5]}, "time_of_day"),
            ({"text": "a", "when": "ONCE", "send_at": (timezone.now() - timedelta(hours=1)).isoformat()}, "send_at"),
            ({"text": "a", "when": "NOW", "classroom_ids": [99999]}, "classroom_ids"),
            ({"text": "a", "when": "NOW", "subjects": ["PHYSICS"]}, "subjects"),
        ]
        for body, field in cases:
            with self.subTest(field=field, body=body):
                response = self.as_(self.admin).post(URL, body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_a_caption_is_held_to_1024(self):
        body = {"text": "x" * 1025, "when": "NOW", "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png")}
        response = self.as_(self.admin).post(URL, body, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("text", response.json())

    @override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False)
    def test_with_the_flag_off_it_is_saved_but_not_sent(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, {"text": "a", "when": "NOW"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(tg.messages, [])
        self.assertFalse(self.as_(self.admin).get(URL).json()["enabled"])


class ReadTests(ApiFixture):
    def test_the_list(self):
        GroupPost.objects.create(
            text="Ertaga yakshanba mock!", when=GroupPost.WHEN_WEEKLY, weekdays=[5],
            time_of_day=time(18, 0), created_by=self.admin,
        )
        payload = self.as_(self.admin).get(URL).json()
        self.assertTrue(payload["enabled"])
        row = payload["posts"][0]
        self.assertEqual(row["audience_label"], "All groups")
        self.assertEqual(row["state"], "scheduled")
        self.assertEqual(row["preview"], "Ertaga yakshanba mock!")
        self.assertIsNotNone(row["next_send_at"])
        self.assertIsNone(row["last_run"])

    def test_the_detail_has_runs(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=date(2026, 10, 24))
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status="SENT", group_names="Senior G1 Math")
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status="FAILED", error="403: Forbidden")
        payload = self.as_(self.admin).get(f"{URL}{post.pk}/").json()
        self.assertEqual(payload["runs"][0]["run_on"], "2026-10-24")
        self.assertEqual([d["status"] for d in payload["runs"][0]["deliveries"]], ["SENT", "FAILED"])
        self.assertEqual(payload["last_run"]["failed"], 1)
        self.assertEqual(payload["state"], "failed")

    def test_the_groups(self):
        payload = self.as_(self.admin).get(f"{URL}groups/").json()
        self.assertTrue(payload["enabled"])
        self.assertEqual([g["chat_id"] for g in payload["groups"]], ["-1001", "-1002"])

    def test_an_event_post_shows_the_event(self):
        event = make_event(title="Admission Workshop")
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event)
        row = self.as_(self.admin).get(f"{URL}{post.pk}/").json()
        self.assertEqual((row["event_id"], row["event_title"]), (event.pk, "Admission Workshop"))
        self.assertTrue(row["preview"].startswith("⏰"))


class EditAndActionTests(ApiFixture):
    def test_an_event_post_is_edited_through_its_event(self):
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=make_event())
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "x"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "event_post"))

    def test_a_sent_post_is_not_edited(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=date(2026, 10, 24))
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "x"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "already_sent"))

    def test_editing_a_weekly_post(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "Yangi matn"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["text"], "Yangi matn")

    def test_pause_and_resume(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/pause/").json()["post"]["state"], "paused")
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/resume/").json()["post"]["state"], "scheduled")

    def test_delete_from_groups(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=timezone.localdate())
        GroupPostDelivery.objects.create(post=post, run_on=timezone.localdate(), chat_id="-1001", status="SENT", message_id=11, sent_at=timezone.now())
        with fake_api() as tg:
            payload = self.as_(self.admin).post(f"{URL}{post.pk}/delete-from-groups/").json()
        self.assertEqual(payload["result"], {"deleted": 1, "too_old": 0, "failed": 0})
        self.assertEqual(payload["post"]["state"], "deleted")
        self.assertEqual(tg.deleted, [("-1001", 11)])

    def test_retry(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=timezone.localdate())
        GroupPostDelivery.objects.create(post=post, run_on=timezone.localdate(), chat_id="-1001", status="FAILED")
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            payload = self.as_(self.admin).post(f"{URL}{post.pk}/retry/").json()
        self.assertEqual(payload["result"], {"queued": 1})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])

    def test_an_unknown_action_is_404(self):
        post = GroupPost.objects.create(text="a")
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/explode/").status_code, 404)
```

- [ ] **Step 2: Run it to see it fail**

Run: `… manage.py test telegram_posts.tests_api --settings=config.settings_test_nomigrations -v 1`
Expected: failures, with 404 where 200/201 is asserted (no route yet).

- [ ] **Step 3: Implement**

`backend/telegram_posts/serializers.py`:

```python
"""Ops payloads for group posts."""

from __future__ import annotations

import json

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from rest_framework.utils import html

from . import audience, render, schedule, services
from .models import GroupPost, GroupPostDelivery


def _signed(field):
    """Signed URL for a picture, or None. `.url` raises on an unset field — the house guard."""
    if not field:
        return None
    try:
        return field.url
    except ValueError:
        return None


class JsonListField(serializers.ListField):
    """A list that may also arrive as a JSON string: a multipart form can only carry strings,
    and a picture makes the form multipart."""

    def get_value(self, dictionary):
        if html.is_html_input(dictionary) and self.field_name in dictionary:
            raw = dictionary.get(self.field_name)
            if isinstance(raw, str):
                if not raw.strip():
                    return []
                try:
                    return json.loads(raw)
                except ValueError:
                    return raw  # to_internal_value refuses it with ListField's own message
        return super().get_value(dictionary)


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupPostDelivery
        fields = ["id", "chat_id", "group_names", "status", "error", "sent_at", "attempts"]


class PostSerializer(serializers.ModelSerializer):
    preview = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()
    event_title = serializers.SerializerMethodField()
    audience_label = serializers.SerializerMethodField()
    next_send_at = serializers.SerializerMethodField()
    last_run = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()

    class Meta:
        model = GroupPost
        fields = [
            "id", "kind", "text", "preview", "image_url", "button_text", "button_url",
            "subjects", "levels", "classroom_ids", "when", "send_at", "weekdays", "time_of_day",
            "is_paused", "deleted_at", "event_id", "event_title", "created_at",
            "audience_label", "next_send_at", "last_run", "state",
        ]

    def _now(self):
        return self.context.get("now") or timezone.now()

    def _last(self, obj):
        return services.last_run(obj, self.context.get("counts") or {})

    def get_preview(self, obj):
        rendered = render.render(obj)
        return rendered.text if rendered else ""

    def get_image_url(self, obj):
        if obj.image:
            return _signed(obj.image)
        if obj.kind == GroupPost.KIND_EVENT_ANNOUNCE and obj.event_id:
            return _signed(obj.event.cover_image)
        return None

    def get_event_id(self, obj):
        return obj.event_id

    def get_event_title(self, obj):
        return obj.event.title if obj.event_id else ""

    def get_audience_label(self, obj):
        return audience.label(
            subjects=obj.subjects or (), levels=obj.levels or (), classroom_ids=obj.classroom_ids or ()
        )

    def get_next_send_at(self, obj):
        moment = schedule.next_at(obj, self._now())
        return moment.isoformat() if moment else None

    def get_last_run(self, obj):
        last = self._last(obj)
        return {**last, "run_on": last["run_on"].isoformat()} if last else None

    def get_state(self, obj):
        return services.post_state(obj, self._last(obj), self._now())


class PostWriteSerializer(serializers.ModelSerializer):
    image = serializers.ImageField(required=False, allow_null=True)
    subjects = JsonListField(child=serializers.ChoiceField(choices=audience.SUBJECTS), required=False)
    levels = JsonListField(child=serializers.ChoiceField(choices=audience.LEVELS), required=False)
    classroom_ids = JsonListField(child=serializers.IntegerField(min_value=1), required=False)
    weekdays = JsonListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False)
    when = serializers.ChoiceField(
        choices=[GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE, GroupPost.WHEN_WEEKLY], required=False
    )

    class Meta:
        model = GroupPost
        fields = [
            "text", "image", "button_text", "button_url", "subjects", "levels", "classroom_ids",
            "when", "send_at", "weekdays", "time_of_day",
        ]

    def validate_image(self, value):
        if value is None:
            return value
        max_b = int(getattr(settings, "TELEGRAM_POST_MAX_IMAGE_BYTES", 5 * 1024 * 1024))
        if int(getattr(value, "size", 0) or 0) > max_b:
            raise serializers.ValidationError(f"That picture is too large. Maximum is {max_b} bytes.")
        content_type = str(getattr(value, "content_type", "") or "").lower()
        if content_type and not content_type.startswith("image/"):
            raise serializers.ValidationError("That file isn't an image.")
        return value

    def validate(self, attrs):
        inst = self.instance

        def current(field, default=None):
            if field in attrs:
                return attrs[field]
            return getattr(inst, field, default) if inst is not None else default

        text = (current("text") or "").strip()
        if not text:
            raise serializers.ValidationError({"text": "Write the message — it is all the groups will see."})
        if "text" in attrs:
            attrs["text"] = text
        has_image = bool(attrs["image"]) if "image" in attrs else bool(inst is not None and inst.image)
        limit = render.CAPTION_MAX if has_image else render.TEXT_MAX
        if len(text) > limit:
            where = " under a picture" if has_image else ""
            raise serializers.ValidationError(
                {"text": f"Telegram takes {limit} characters{where}; this is {len(text)}."}
            )

        label = (current("button_text") or "").strip()
        link = (current("button_url") or "").strip()
        if bool(label) != bool(link):
            raise serializers.ValidationError({"button_url": "A button needs both a label and a link."})
        if link and not link.startswith("https://"):
            raise serializers.ValidationError({"button_url": "The link must start with https://."})

        ids = current("classroom_ids") or []
        if ids:
            known = {row["id"] for row in audience.picker_rows()}
            if set(ids) - known:
                raise serializers.ValidationError(
                    {"classroom_ids": "Some of those classes are not connected to Telegram any more."}
                )

        when = current("when", GroupPost.WHEN_NOW)
        if when == GroupPost.WHEN_ONCE:
            send_at = current("send_at")
            if not send_at or send_at <= timezone.now():
                raise serializers.ValidationError({"send_at": "Pick a time in the future."})
        if when == GroupPost.WHEN_WEEKLY:
            if not (current("weekdays") or []):
                raise serializers.ValidationError({"weekdays": "Pick at least one day."})
            if current("time_of_day") is None:
                raise serializers.ValidationError({"time_of_day": "Pick the time it goes out."})
            if "weekdays" in attrs:
                attrs["weekdays"] = sorted(set(attrs["weekdays"]))
        return attrs
```

`backend/telegram_posts/views.py`:

```python
"""Group post endpoints for the ops console.

Plain `APIView`s, never `.as_view({...})` — that form silently drops `permission_classes` in
this codebase and is how an admin endpoint once shipped as AllowAny.
"""

from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rewards.views import _is_reward_staff

from . import audience, sender, services
from .models import GroupPost
from .serializers import DeliverySerializer, PostSerializer, PostWriteSerializer

ACTIONS = {"pause", "resume", "retry", "send-missed", "delete-from-groups"}


def _refused(exc: services.PostRefused) -> Response:
    return Response({"code": exc.code, "detail": exc.message}, status=http.HTTP_400_BAD_REQUEST)


def _detail(post, request) -> dict:
    data = PostSerializer(
        post, context={"request": request, "counts": services.delivery_counts([post.pk])}
    ).data
    data["runs"] = [
        {
            "run_on": run["run_on"].isoformat(),
            "deliveries": DeliverySerializer(run["deliveries"], many=True).data,
        }
        for run in services.runs(post)
    ]
    return data


class _StaffView(APIView):
    """The events console's gate, copied rather than imported (see events/views.py)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


class AdminPostsView(_StaffView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        posts = list(GroupPost.objects.select_related("event").order_by("-created_at", "-id")[:200])
        counts = services.delivery_counts([p.pk for p in posts])
        return Response({
            "enabled": sender.enabled(),
            "posts": PostSerializer(posts, many=True, context={"request": request, "counts": counts}).data,
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = PostWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = services.create_post(data=dict(serializer.validated_data), user=request.user)
        return Response(_detail(post, request), status=http.HTTP_201_CREATED)


class AdminPostDetailView(_StaffView):
    def get(self, request, post_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        return Response(_detail(post, request))

    def patch(self, request, post_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        try:
            # Before validation: "already sent" is the real answer for a sent post, not
            # "pick a time in the future" about its old send time.
            services.ensure_editable(post)
            serializer = PostWriteSerializer(post, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            post = services.update_post(post, dict(serializer.validated_data))
        except services.PostRefused as exc:
            return _refused(exc)
        return Response(_detail(post, request))


class AdminPostActionView(_StaffView):
    def post(self, request, post_id: int, action: str):
        denied = self._guard(request)
        if denied:
            return denied
        if action not in ACTIONS:
            raise Http404
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        try:
            if action == "pause":
                services.pause(post)
                result = {}
            elif action == "resume":
                services.resume(post)
                result = {}
            elif action == "retry":
                result = services.retry_failed(post)
            elif action == "send-missed":
                result = services.send_missed_now(post)
            else:
                result = services.delete_from_groups(post)
        except services.PostRefused as exc:
            return _refused(exc)
        post.refresh_from_db()
        return Response({"result": result, "post": _detail(post, request)})


class AdminGroupsView(_StaffView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        return Response({"enabled": sender.enabled(), "groups": audience.picker_rows()})
```

`backend/telegram_posts/urls.py`:

```python
"""Group post routes — all under `admin/`; the fixed `groups/` route sits above the converters."""

from django.urls import path

from .views import AdminGroupsView, AdminPostActionView, AdminPostDetailView, AdminPostsView

urlpatterns = [
    path("admin/", AdminPostsView.as_view(), name="telegram-posts-admin-list"),
    path("admin/groups/", AdminGroupsView.as_view(), name="telegram-posts-admin-groups"),
    path("admin/<int:post_id>/", AdminPostDetailView.as_view(), name="telegram-posts-admin-detail"),
    path(
        "admin/<int:post_id>/<slug:action>/",
        AdminPostActionView.as_view(),
        name="telegram-posts-admin-action",
    ),
]
```

`backend/access/host_guard.py`, right after the `/api/events/` block in the admin console section:

```python
            # Telegram group posts: written, scheduled and taken down from the admin console
            # (plan 2026-10-17). Staff-only in the view; there is no student surface.
            if path.startswith("/api/telegram-posts/"):
                return self.get_response(request)
```

`backend/config/urls.py`, after the events line:

```python
    path('api/telegram-posts/', include('telegram_posts.urls')),
```

- [ ] **Step 4: Run the app's tests and the public-surface pin**

Run: `… manage.py test telegram_posts users.tests.test_public_student_surfaces --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`. The public-surface test proves the new prefix opened nothing to public learners.

- [ ] **Step 5: Commit**

```bash
git add backend/telegram_posts/serializers.py backend/telegram_posts/views.py backend/telegram_posts/urls.py backend/telegram_posts/tests_api.py backend/config/urls.py backend/access/host_guard.py
git commit -m "feat(telegram_posts): the ops API — list, write, actions, groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Events publish into the groups

**Files:**
- Modify:
  - `backend/events/models.py`: two fields;
  - `backend/events/serializers.py`: `EventWriteSerializer`;
  - `backend/events/views.py`: `_ops_payload`, `AdminEventsView.get`;
  - `backend/events/services.py`: `publish_and_announce`;
  - `backend/telegram_posts/audience.py`: `normalize`;
  - `backend/telegram_posts/services.py`: `on_event_published`, `event_summaries`.
- Create: `backend/events/migrations/0003_event_telegram_post_event_telegram_audience.py` (generated)
- Test: `backend/events/tests_telegram.py`

**Interfaces:**
- Consumes: `services._dispatch_now`, `sender.enabled` (Tasks 5–6).
- Produces:
  - `Event.telegram_post: bool` (default True) and `Event.telegram_audience: dict` (`{"subjects": [...], "levels": [...]}`, default `{}`);
  - `audience.normalize(value) -> {"subjects": [...], "levels": [...]}`, which raises `ValueError` with the bad value named;
  - `telegram_posts.services.on_event_published(event, *, now=None) -> GroupPost | None`;
  - `telegram_posts.services.event_summaries(event_ids) -> {event_id: {"post_id", "sent", "failed", "total"}}`;
  - the ops event payload gains `telegram_post`, `telegram_audience`, and `telegram` (`summary | null`). The student payload is unchanged.

- [ ] **Step 1: Write the failing test** — `backend/events/tests_telegram.py`:

```python
"""An event's Telegram half (plan 2026-10-17): the form's choice, the posts Publish creates,
and the summary the ops row shows. Students never see any of it."""

from __future__ import annotations

import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom
from events.models import Event
from telegram_posts.models import GroupPost
from telegram_posts.testkit import TOKEN, fake_api, make_room, staff
from users.models import User


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class EventTelegramTests(TestCase):
    def setUp(self):
        self.admin = staff()
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 English", subject=Classroom.SUBJECT_ENGLISH, level="junior", chat="-1002")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.now = timezone.now()
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)

    def body(self, **over):
        body = {
            "title": "Admission Workshop", "description": "Bring questions.",
            "starts_at": (self.now + timedelta(days=3)).isoformat(),
            "ends_at": (self.now + timedelta(days=3, hours=2)).isoformat(),
            "location": "MasterSAT, Room 2", "seats": 30,
        }
        body.update(over)
        return body

    def draft(self, **kw):
        return Event.objects.create(
            title="Admission Workshop", starts_at=self.now + timedelta(days=3),
            ends_at=self.now + timedelta(days=3, hours=2), seats=30, created_by=self.admin, **kw,
        )

    def publish(self, event):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/admin/{event.pk}/publish/")
        return response, tg

    # ── the form ───────────────────────────────────────────────────────────
    def test_the_form_takes_the_telegram_choice(self):
        response = self.client.post(
            "/api/events/admin/",
            self.body(telegram_post=False, telegram_audience={"subjects": ["MATH"], "levels": []}),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        event = Event.objects.get(pk=response.json()["id"])
        self.assertEqual((event.telegram_post, event.telegram_audience), (False, {"subjects": ["MATH"], "levels": []}))

    def test_multipart_carries_the_audience_as_a_json_string(self):
        response = self.client.post(
            "/api/events/admin/",
            self.body(telegram_post="true", telegram_audience=json.dumps({"subjects": [], "levels": ["senior"]})),
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            Event.objects.get(pk=response.json()["id"]).telegram_audience, {"subjects": [], "levels": ["senior"]}
        )

    def test_a_multipart_form_without_the_box_still_posts(self):
        # DRF reads a missing multipart boolean as False unless the field has a default.
        response = self.client.post("/api/events/admin/", self.body(), format="multipart")
        self.assertTrue(Event.objects.get(pk=response.json()["id"]).telegram_post)

    def test_an_unknown_subject_is_refused(self):
        response = self.client.post(
            "/api/events/admin/", self.body(telegram_audience={"subjects": ["PHYSICS"]}), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("telegram_audience", response.json())

    # ── publishing ─────────────────────────────────────────────────────────
    def test_publishing_posts_to_the_groups_and_plans_the_reminder(self):
        event = self.draft(telegram_audience={"subjects": ["MATH"], "levels": []})
        response, tg = self.publish(event)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])
        self.assertTrue(tg.messages[0][1].startswith("📢 <b>Admission Workshop</b>"))
        reminder = GroupPost.objects.get(event=event, kind=GroupPost.KIND_EVENT_REMINDER)
        self.assertEqual((reminder.when, reminder.subjects), (GroupPost.WHEN_EVENT, ["MATH"]))

    def test_publishing_twice_posts_once(self):
        event = self.draft()
        self.publish(event)
        _response, tg = self.publish(event)
        self.assertEqual(tg.messages, [])
        self.assertEqual(GroupPost.objects.filter(event=event).count(), 2)

    def test_no_posts_when_the_box_is_unticked(self):
        _response, tg = self.publish(self.draft(telegram_post=False))
        self.assertEqual((tg.messages, GroupPost.objects.count()), ([], 0))

    @override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False)
    def test_no_posts_with_the_flag_off(self):
        _response, tg = self.publish(self.draft())
        self.assertEqual((tg.messages, GroupPost.objects.count()), ([], 0))

    def test_a_telegram_failure_never_breaks_publishing(self):
        event = self.draft()
        with mock.patch("telegram_posts.services.on_event_published", side_effect=RuntimeError("boom")):
            response = self.client.post(f"/api/events/admin/{event.pk}/publish/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["announced"])

    # ── what the ops row shows ─────────────────────────────────────────────
    def test_the_ops_payload_carries_the_summary(self):
        event = self.draft()
        self.publish(event)
        row = self.client.get("/api/events/admin/").json()["events"][0]
        summary = row["telegram"]
        self.assertEqual((summary["sent"], summary["failed"], summary["total"]), (2, 0, 2))
        self.assertEqual(row["telegram_audience"], {"subjects": [], "levels": []})
        self.assertTrue(row["telegram_post"])
        detail = self.client.get(f"/api/events/admin/{event.pk}/").json()
        self.assertEqual(detail["telegram"]["post_id"], summary["post_id"])

    def test_students_never_see_it(self):
        self.publish(self.draft())
        student = User.objects.create_user("ev_tg_student@t.com", "x", role=C.ROLE_STUDENT)
        self.client.force_authenticate(student)
        rows = self.client.get("/api/events/").json()["events"]
        self.assertTrue(rows)
        for key in ("telegram", "telegram_post", "telegram_audience"):
            self.assertNotIn(key, rows[0])
```

- [ ] **Step 2: Run it to see it fail**

Run: `… manage.py test events.tests_telegram --settings=config.settings_test_nomigrations -v 1`
Expected: errors, `TypeError: Event() got unexpected keyword arguments: 'telegram_audience'` (and failures).

- [ ] **Step 3: Implement**

`backend/events/models.py`, inside `Event` after `reminder_sent_at`:

```python
    #: Post it into the class Telegram groups when it is published (plan 2026-10-17).
    telegram_post = models.BooleanField(default=True)
    #: Which groups: {"subjects": [...], "levels": [...]}; empty lists mean every group.
    telegram_audience = models.JSONField(default=dict, blank=True)
```

Generate the migration (from `backend/`): `SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations events --name event_telegram_post_event_telegram_audience`. Expected: one file with two `AddField`s and nothing else.

`backend/telegram_posts/audience.py`, add `import json` at the top and append:

```python
def normalize(value) -> dict:
    """{"subjects": [...], "levels": [...]} from what a form sent (a dict, or a JSON string).

    Raises ValueError naming the bad value. Sorted in a fixed order, so the same choice is
    always stored the same way.
    """
    if value in (None, ""):
        return {"subjects": [], "levels": []}
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError('Expected {"subjects": [...], "levels": [...]}.')
    subjects = [str(s) for s in value.get("subjects") or []]
    levels = [str(level) for level in value.get("levels") or []]
    bad = [s for s in subjects if s not in SUBJECTS] + [lv for lv in levels if lv not in LEVELS]
    if bad:
        raise ValueError(f"Unknown subject or level: {', '.join(bad)}.")
    return {
        "subjects": sorted(set(subjects), key=SUBJECTS.index),
        "levels": sorted(set(levels), key=LEVELS.index),
    }
```

`backend/events/serializers.py`, in `EventWriteSerializer`:
- add two declared fields next to `cover_image`;
- add both names to `Meta.fields`;
- add the validator.

```python
    #: `default=True` matters on multipart: DRF reads a missing multipart boolean as False
    #: unless the field has a default, which would silently untick the box.
    telegram_post = serializers.BooleanField(required=False, default=True)
    telegram_audience = serializers.JSONField(required=False)
```

```python
        fields = [
            "title", "description", "cover_image", "starts_at", "ends_at", "location", "seats",
            "telegram_post", "telegram_audience",
        ]
```

```python
    def validate_telegram_audience(self, value):
        from telegram_posts.audience import normalize

        try:
            return normalize(value)
        except (ValueError, TypeError) as exc:
            raise serializers.ValidationError(str(exc)) from exc
```

`backend/events/views.py`: replace `_ops_payload` and the list in `AdminEventsView.get`:

```python
def _telegram_part(event, summaries=None) -> dict:
    """The console's view of an event's group posts. Never in a student's payload."""
    from telegram_posts import services as telegram_posts

    summaries = summaries if summaries is not None else telegram_posts.event_summaries([event.pk])
    chosen = event.telegram_audience or {}
    return {
        "telegram_post": event.telegram_post,
        "telegram_audience": {"subjects": chosen.get("subjects", []), "levels": chosen.get("levels", [])},
        "telegram": summaries.get(event.pk),
    }


def _ops_payload(event, request, summaries=None):
    data = EventSerializer(event, context={"request": request, "my_rows": {}}).data
    return {**data, **_telegram_part(event, summaries)}
```

```python
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        from telegram_posts import services as telegram_posts

        events = list(_with_counts(Event.objects.all()).order_by("-starts_at"))
        summaries = telegram_posts.event_summaries([e.pk for e in events])
        return Response({"events": [_ops_payload(e, request, summaries) for e in events]})
```

`backend/events/services.py`, in `publish_and_announce`, after `event_mail.enqueue_event_announcement(event.pk)` and before `return True`:

```python
    try:
        from telegram_posts import services as telegram_posts

        telegram_posts.on_event_published(event, now=now)
    except Exception:
        # The bell, the push and the emails have gone. A Telegram failure must not turn a
        # published event into a 500; /ops/telegram-posts shows what did and did not go out.
        logger.exception("event_telegram_posts_failed event=%s", event.pk)
```

`backend/telegram_posts/services.py`: add `from django.db import transaction` and `from . import audience` to the imports. Then append:

```python
# ── events ───────────────────────────────────────────────────────────────────


def on_event_published(event, *, now=None):
    """Publish's two posts: the announcement, sent now, and the evening-before reminder.

    Idempotent through the (event, kind) constraint: a second Publish finds both and sends
    nothing. Nothing at all while the flag is off or the event's box is unticked — and an event
    published then stays unposted when the flag comes on; the switch is not retroactive.
    """
    if not sender.enabled() or not getattr(event, "telegram_post", False):
        return None
    now = now or timezone.now()
    chosen = audience.normalize(event.telegram_audience)
    common = {
        "subjects": chosen["subjects"], "levels": chosen["levels"],
        "active_from": now, "created_by": event.created_by,
    }
    # A savepoint: a failure here must not poison the caller's transaction.
    with transaction.atomic():
        announce, created = GroupPost.objects.get_or_create(
            event=event, kind=GroupPost.KIND_EVENT_ANNOUNCE,
            defaults={**common, "when": GroupPost.WHEN_NOW, "send_at": now},
        )
        GroupPost.objects.get_or_create(
            event=event, kind=GroupPost.KIND_EVENT_REMINDER,
            defaults={**common, "when": GroupPost.WHEN_EVENT},
        )
    if created:
        _dispatch_now(announce)
    return announce


def event_summaries(event_ids) -> dict:
    posts = dict(
        GroupPost.objects.filter(event_id__in=list(event_ids), kind=GroupPost.KIND_EVENT_ANNOUNCE)
        .values_list("pk", "event_id")
    )
    out = {
        event_id: {"post_id": post_id, "sent": 0, "failed": 0, "total": 0}
        for post_id, event_id in posts.items()
    }
    rows = (
        GroupPostDelivery.objects.filter(post_id__in=list(posts))
        .order_by()
        .values("post_id", "status")
        .annotate(n=Count("id"))
    )
    for row in rows:
        summary = out[posts[row["post_id"]]]
        summary["total"] += row["n"]
        if row["status"] == GroupPostDelivery.STATUS_SENT:
            summary["sent"] += row["n"]
        elif row["status"] == GroupPostDelivery.STATUS_FAILED:
            summary["failed"] += row["n"]
    return out
```

- [ ] **Step 4: Run the events suite and the app suite**

Run: `… manage.py test events telegram_posts --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`. The existing events tests must stay green: their publish runs with the flag off and creates no posts.

- [ ] **Step 5: Commit**

```bash
git add backend/events backend/telegram_posts/audience.py backend/telegram_posts/services.py
git commit -m "feat(events): publishing posts the event into the class Telegram groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend — the API layer, the helpers, the list page, the nav entry

**Files:**
- Create:
  - `frontend/src/features/ops/telegram-posts/telegramPostsApi.ts`
  - `frontend/src/features/ops/telegram-posts/telegramPostsHooks.ts`
  - `frontend/src/features/ops/telegram-posts/audience.ts`
  - `frontend/src/features/ops/telegram-posts/TelegramPostsPage.tsx`
  - `frontend/src/app/(ops)/ops/telegram-posts/page.tsx`
- Modify: `frontend/src/features/ops/shell/opsNav.ts`, `frontend/src/features/ops/adminScope.ts`, `frontend/src/features/ops/shell/__tests__/opsNav.test.ts`
- Test: `frontend/src/features/ops/telegram-posts/__tests__/audience.test.ts`, `frontend/src/features/ops/telegram-posts/__tests__/TelegramPostsPage.test.tsx`

**Interfaces:**
- Consumes: the Task 7 HTTP API.
- Produces:
  - Types: `PostKind`, `PostWhen`, `PostState`, `DeliveryStatus`, `PostAction`, `RunCounts`, `GroupPost`, `Delivery`, `GroupPostDetail`, `TelegramGroup`, `Audience`.
  - `telegramPostsApi.{list, detail, create, update, action, groups}`.
  - Hooks: `useTelegramPosts()`, `useTelegramPost(id)`, `useTelegramGroups()`, `useSavePost()` (mutate `{id?, body}`), `usePostAction(id)` (mutate `action`).
  - `audience.ts`: `SUBJECTS`, `LEVELS`, `WEEKDAYS`, `targetChats(groups, audience)`, `STATE_BADGE`, `kindLabel(post)`, `scheduleLabel(post)`, `plainText(markup)`, `firstLine(markup)`, `sentLabel(post)`.
  - `TelegramPostsPage`.

The nav item has no role gate, just like Events. Teachers see it and get a 403 from the API; a scoped admin sees it because it is added to `ADMIN_OPS_SECTIONS`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/ops/telegram-posts/__tests__/audience.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstLine, kindLabel, scheduleLabel, sentLabel, targetChats } from "../audience";
import type { TelegramGroup } from "../telegramPostsApi";

const groups: TelegramGroup[] = [
  { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
  { id: 2, name: "Junior G2 Math", subject: "MATH", level: "junior", chat_id: "-1002" },
  { id: 3, name: "Senior G3 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
  { id: 4, name: "Senior G4 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
];

describe("targetChats", () => {
  it("counts every chat once by default", () => {
    expect(targetChats(groups, { subjects: [], levels: [] })).toEqual(["-1001", "-1002", "-1003"]);
  });

  it("filters by subject and by level", () => {
    expect(targetChats(groups, { subjects: ["MATH"], levels: [] })).toEqual(["-1001", "-1002"]);
    expect(targetChats(groups, { subjects: [], levels: ["senior"] })).toEqual(["-1001", "-1003"]);
  });

  it("lets chosen classes win over the filters", () => {
    expect(targetChats(groups, { subjects: ["ENGLISH"], levels: [], classroom_ids: [2] })).toEqual(["-1002"]);
  });
});

describe("labels", () => {
  it("reads a post's kind and schedule", () => {
    expect(kindLabel({ kind: "MANUAL", when: "WEEKLY" })).toBe("Weekly");
    expect(kindLabel({ kind: "EVENT_REMINDER", when: "EVENT" })).toBe("Event reminder");
    expect(scheduleLabel({ when: "WEEKLY", weekdays: [5], time_of_day: "18:00:00", send_at: null })).toBe("Every Sat at 18:00");
    expect(scheduleLabel({ when: "EVENT", weekdays: [], time_of_day: null, send_at: null })).toBe("The evening before, 18:00");
  });

  it("shows the first line as plain text", () => {
    expect(firstLine("📢 <b>A &amp; B</b>\n\nmore")).toBe("📢 A & B");
  });

  it("sums up the last run", () => {
    expect(
      sentLabel({ last_run: { run_on: "2026-10-24", total: 26, sent: 24, failed: 2, missed: 0, pending: 0, deleted: 0 } }),
    ).toBe("Sent 24/26 · 2 failed");
    expect(sentLabel({ last_run: null })).toBe("");
  });
});
```

`frontend/src/features/ops/telegram-posts/__tests__/TelegramPostsPage.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** The posts list: what each post is, where it goes, and how its last run went. */

const useTelegramPosts = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramPosts: () => useTelegramPosts(),
  useTelegramGroups: () => ({ data: { enabled: true, groups: [] } }),
  useSavePost: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { TelegramPostsPage } = await import("@/features/ops/telegram-posts/TelegramPostsPage");

function post(over: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga yakshanba soat 10:00 da mock!", preview: "Ertaga yakshanba soat 10:00 da mock!",
    image_url: null, button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00",
    last_run: { run_on: "2026-10-17", total: 26, sent: 25, failed: 1, missed: 0, pending: 0, deleted: 0 },
    state: "failed",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TelegramPostsPage />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useTelegramPosts.mockReturnValue({ data: { enabled: true, posts: [post()] }, isPending: false, isError: false, refetch: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("TelegramPostsPage", () => {
  it("lists each post with its state, schedule, audience and last run", async () => {
    await render();
    expect(text()).toContain("Ertaga yakshanba soat 10:00 da mock!");
    expect(text()).toContain("Some failed");
    expect(text()).toContain("Every Sat at 18:00");
    expect(text()).toContain("All groups");
    expect(text()).toContain("Sent 25/26 · 1 failed");
    expect(document.querySelector('a[href="/ops/telegram-posts/7"]')).not.toBeNull();
  });

  it("warns when posting is switched off on the server", async () => {
    useTelegramPosts.mockReturnValue({ data: { enabled: false, posts: [] }, isPending: false, isError: false, refetch: vi.fn() });
    await render();
    expect(text()).toContain("Posting is switched off");
    expect(text()).toContain("No posts yet");
  });

  it("offers a retry when the list fails", async () => {
    useTelegramPosts.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render();
    expect(text()).toContain("The posts didn't load.");
  });
});
```

Update `frontend/src/features/ops/shell/__tests__/opsNav.test.ts`. In the scoped-admin test the expected list gains `"/ops/telegram-posts"` right after `"/ops/events"`. The comment becomes `// Content keeps Events and Telegram posts; System is gone.`

- [ ] **Step 2: Run them to see them fail**

Run (from `frontend/`): `npx vitest run src/features/ops/telegram-posts src/features/ops/shell/__tests__/opsNav.test.ts`
Expected: FAIL. The modules are not found, and the nav list is missing `/ops/telegram-posts`.

- [ ] **Step 3: Implement**

`frontend/src/features/ops/telegram-posts/telegramPostsApi.ts`:

```ts
import api from "@/lib/api";

/**
 * Posts the class bot makes into the class Telegram groups (plan 2026-10-17).
 *
 * Paths are root-relative to the axios instance, whose baseURL already ends in the API prefix
 * (see eventsApi.ts) — writing the prefix again would double it and trip `check:api-layer`.
 */
export type PostKind = "MANUAL" | "EVENT_ANNOUNCE" | "EVENT_REMINDER";
export type PostWhen = "NOW" | "ONCE" | "WEEKLY" | "EVENT";
export type PostState =
  | "scheduled" | "sending" | "sent" | "failed" | "missed" | "paused" | "deleted" | "done" | "event_cancelled";
export type DeliveryStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "MISSED" | "DELETED";
export type PostAction = "pause" | "resume" | "retry" | "send-missed" | "delete-from-groups";

export interface RunCounts {
  run_on: string;
  total: number;
  sent: number;
  failed: number;
  missed: number;
  pending: number;
  deleted: number;
}

export interface GroupPost {
  id: number;
  kind: PostKind;
  text: string;
  /** The message as it is sent (HTML), built by the server — event posts have no `text`. */
  preview: string;
  image_url: string | null;
  button_text: string;
  button_url: string;
  subjects: string[];
  levels: string[];
  classroom_ids: number[];
  when: PostWhen;
  send_at: string | null;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  /** "HH:MM:SS", Tashkent time. */
  time_of_day: string | null;
  is_paused: boolean;
  deleted_at: string | null;
  event_id: number | null;
  event_title: string;
  created_at: string;
  audience_label: string;
  next_send_at: string | null;
  last_run: RunCounts | null;
  /** Server-computed. The page never re-derives it. */
  state: PostState;
}

export interface Delivery {
  id: number;
  chat_id: string;
  group_names: string;
  status: DeliveryStatus;
  error: string;
  sent_at: string | null;
  attempts: number;
}

export interface GroupPostDetail extends GroupPost {
  runs: { run_on: string; deliveries: Delivery[] }[];
}

export interface TelegramGroup {
  id: number;
  name: string;
  subject: string;
  level: string;
  chat_id: string;
}

/** Empty lists mean "all". A non-empty `classroom_ids` means exactly those classes. */
export interface Audience {
  subjects: string[];
  levels: string[];
  classroom_ids?: number[];
}

export const telegramPostsApi = {
  async list(): Promise<{ enabled: boolean; posts: GroupPost[] }> {
    const { data } = await api.get<{ enabled: boolean; posts: GroupPost[] }>("/telegram-posts/admin/");
    return { enabled: Boolean(data?.enabled), posts: data?.posts ?? [] };
  },
  async detail(id: number): Promise<GroupPostDetail> {
    const { data } = await api.get<GroupPostDetail>(`/telegram-posts/admin/${id}/`);
    return data;
  },
  /** `body` is FormData when a picture is attached — axios must own the boundary. */
  async create(body: FormData | Record<string, unknown>): Promise<GroupPostDetail> {
    const { data } = await api.post<GroupPostDetail>("/telegram-posts/admin/", body);
    return data;
  },
  async update(id: number, body: FormData | Record<string, unknown>): Promise<GroupPostDetail> {
    const { data } = await api.patch<GroupPostDetail>(`/telegram-posts/admin/${id}/`, body);
    return data;
  },
  async action(id: number, action: PostAction): Promise<{ result: Record<string, number>; post: GroupPostDetail }> {
    const { data } = await api.post<{ result: Record<string, number>; post: GroupPostDetail }>(
      `/telegram-posts/admin/${id}/${action}/`,
    );
    return data;
  },
  async groups(): Promise<{ enabled: boolean; groups: TelegramGroup[] }> {
    const { data } = await api.get<{ enabled: boolean; groups: TelegramGroup[] }>("/telegram-posts/admin/groups/");
    return { enabled: Boolean(data?.enabled), groups: data?.groups ?? [] };
  },
};
```

`frontend/src/features/ops/telegram-posts/telegramPostsHooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegramPostsApi, type PostAction } from "./telegramPostsApi";

const keys = {
  all: ["telegram-posts"] as const,
  list: ["telegram-posts", "list"] as const,
  detail: (id: number) => ["telegram-posts", "detail", id] as const,
  groups: ["telegram-posts", "groups"] as const,
};

export function useTelegramPosts() {
  return useQuery({ queryKey: keys.list, queryFn: () => telegramPostsApi.list() });
}

export function useTelegramPost(id: number) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () => telegramPostsApi.detail(id),
    // A disabled v5 query reports "pending" forever; only a real id is fetched.
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useTelegramGroups() {
  return useQuery({ queryKey: keys.groups, queryFn: () => telegramPostsApi.groups(), staleTime: 60_000 });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: FormData | Record<string, unknown> }) =>
      id ? telegramPostsApi.update(id, body) : telegramPostsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function usePostAction(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: PostAction) => telegramPostsApi.action(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
```

`frontend/src/features/ops/telegram-posts/audience.ts`:

```ts
import type { BadgeVariant } from "@/components/ui";
import type { Audience, GroupPost, PostState, TelegramGroup } from "./telegramPostsApi";

export const SUBJECTS = [
  { value: "MATH", label: "Math" },
  { value: "ENGLISH", label: "English" },
] as const;

export const LEVELS = [
  { value: "foundation", label: "Foundation" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior" },
] as const;

/** `date.weekday()` order: 0 = Monday. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The distinct chats an audience reaches — the server's rule (telegram_posts/audience.py),
 * repeated only so a confirm can name the number before anything is sent.
 */
export function targetChats(groups: TelegramGroup[], audience: Audience): string[] {
  const ids = audience.classroom_ids ?? [];
  const chosen = ids.length
    ? groups.filter((g) => ids.includes(g.id))
    : groups.filter(
        (g) =>
          (audience.subjects.length === 0 || audience.subjects.includes(g.subject)) &&
          (audience.levels.length === 0 || audience.levels.includes(g.level)),
      );
  return Array.from(new Set(chosen.map((g) => g.chat_id).filter(Boolean)));
}

export const STATE_BADGE: Record<PostState, { variant: BadgeVariant; label: string }> = {
  scheduled: { variant: "info", label: "Scheduled" },
  sending: { variant: "warning", label: "Sending" },
  sent: { variant: "success", label: "Sent" },
  failed: { variant: "danger", label: "Some failed" },
  missed: { variant: "warning", label: "Missed" },
  paused: { variant: "neutral", label: "Paused" },
  deleted: { variant: "neutral", label: "Deleted" },
  done: { variant: "neutral", label: "Nothing to send" },
  event_cancelled: { variant: "neutral", label: "Event cancelled" },
};

export function kindLabel(post: Pick<GroupPost, "kind" | "when">): string {
  if (post.kind === "EVENT_ANNOUNCE") return "Event announcement";
  if (post.kind === "EVENT_REMINDER") return "Event reminder";
  if (post.when === "WEEKLY") return "Weekly";
  return post.when === "ONCE" ? "Once" : "Now";
}

export function scheduleLabel(post: Pick<GroupPost, "when" | "weekdays" | "time_of_day" | "send_at">): string {
  if (post.when === "WEEKLY") {
    const days = post.weekdays.map((d) => WEEKDAYS[d]).join(", ");
    return `Every ${days} at ${(post.time_of_day ?? "").slice(0, 5)}`;
  }
  if (post.when === "EVENT") return "The evening before, 18:00";
  return post.send_at ? new Date(post.send_at).toLocaleString() : "";
}

/** The message as plain text: tags dropped, the entities the server's `esc` writes decoded. */
export function plainText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function firstLine(markup: string): string {
  const line = plainText(markup).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function sentLabel(post: Pick<GroupPost, "last_run">): string {
  const run = post.last_run;
  if (!run) return "";
  const parts = [`Sent ${run.sent}/${run.total}`];
  if (run.failed) parts.push(`${run.failed} failed`);
  if (run.missed) parts.push(`${run.missed} missed`);
  return parts.join(" · ");
}
```

`frontend/src/features/ops/telegram-posts/TelegramPostsPage.tsx`:

```tsx
"use client";

/**
 * /ops/telegram-posts — what the class bot posts into the class Telegram groups (plan
 * 2026-10-17): the announcement and reminder an event's Publish creates, and the posts written
 * here. A message in 26 groups cannot be unread, so every send asks first (PostForm) and the
 * detail page can take a post back down for 48 hours.
 */

import Link from "next/link";
import { Send } from "lucide-react";

import { Alert, Badge } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { STATE_BADGE, firstLine, kindLabel, scheduleLabel, sentLabel } from "./audience";
import { useTelegramPosts } from "./telegramPostsHooks";

export function TelegramPostsPage() {
  const posts = useTelegramPosts();
  const rows = posts.data?.posts ?? [];

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Telegram posts"
        title="Telegram posts"
        description="What the bot posts into the class Telegram groups — event posts and the posts written here."
      />

      {posts.data && !posts.data.enabled ? (
        <Alert tone="warning">
          Posting is switched off on this server (TELEGRAM_GROUP_POSTS_ENABLED). Posts are saved, but
          nothing is sent until it is on.
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">All posts</p>
        </div>

        {posts.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-4 w-48 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : posts.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">The posts didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => void posts.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="font-semibold text-foreground">No posts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Publishing an event posts it here too. Write a post for anything else.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((post) => {
              const state = STATE_BADGE[post.state];
              const sent = sentLabel(post);
              return (
                <li key={post.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/ops/telegram-posts/${post.id}`}
                      className="block truncate text-sm font-bold hover:underline"
                    >
                      {firstLine(post.preview || post.text) || "(no text)"}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-muted-foreground">
                      <Badge variant={state.variant}>{state.label}</Badge>
                      <span>{kindLabel(post)}</span>
                      <span>{scheduleLabel(post)}</span>
                      <span>{post.audience_label}</span>
                      {post.next_send_at ? <span>Next: {new Date(post.next_send_at).toLocaleString()}</span> : null}
                      {sent ? <span>{sent}</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

`frontend/src/app/(ops)/ops/telegram-posts/page.tsx`:

```tsx
"use client";

import { TelegramPostsPage } from "@/features/ops/telegram-posts/TelegramPostsPage";

export default function OpsTelegramPostsPage() {
  return <TelegramPostsPage />;
}
```

`frontend/src/features/ops/shell/opsNav.ts`: add `Send` to the lucide import list (alphabetical, after `School`). Then, in the `content` group, after the Events item:

```ts
      // What the class bot posts into the class Telegram groups: event posts and written ones.
      { href: "/ops/telegram-posts", label: "Telegram posts", icon: Send },
```

`frontend/src/features/ops/adminScope.ts`, after `"/ops/events",`:

```ts
  // The class bot's group posts (plan 2026-10-17): the same desk that publishes events.
  "/ops/telegram-posts",
```

Also update that file's header comment: the list sentence becomes "… Users and Events (with its Telegram posts) …".

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/features/ops/telegram-posts src/features/ops/shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ops/telegram-posts frontend/src/app/\(ops\)/ops/telegram-posts frontend/src/features/ops/shell frontend/src/features/ops/adminScope.ts
git commit -m "feat(ops): the Telegram posts list and its nav entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend — the post form and the audience picker

**Files:**
- Create: `frontend/src/lib/datetimeLocal.ts`, `frontend/src/features/ops/telegram-posts/AudiencePicker.tsx`, `frontend/src/features/ops/telegram-posts/PostForm.tsx`
- Modify: `frontend/src/features/ops/telegram-posts/audience.ts` (the draft helpers), `frontend/src/features/ops/telegram-posts/TelegramPostsPage.tsx` (the New post button)
- Test: `frontend/src/features/ops/telegram-posts/__tests__/PostForm.test.tsx`, plus additions to `__tests__/audience.test.ts`

**Interfaces:**
- Consumes: Task 9's hooks and helpers.
- Produces:
  - `toLocalInput(iso)`, `fromLocalInput(value)` in `@/lib/datetimeLocal`. They move out of the events page in Task 12.
  - In `audience.ts`: `AudienceDraft` (`Audience & { mode: "filter" | "groups" }`), `draftFrom(a?)`, `draftChats(groups, draft)`, `draftToFields(draft)`.
  - `<AudiencePicker groups value onChange allowSpecific? />`.
  - `<PostForm post={GroupPostDetail | null} onClose />`.

A draft keeps the picker's mode. "Specific groups" with nothing ticked reaches **no** group; it never falls back to all of them. The plain `Audience` cannot express that, which is why the draft exists.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/audience.test.ts`:

```ts
import { draftChats, draftFrom, draftToFields } from "../audience";

describe("audience drafts", () => {
  it("starts in the mode the saved audience implies", () => {
    expect(draftFrom(undefined)).toEqual({ mode: "filter", subjects: [], levels: [], classroom_ids: [] });
    expect(draftFrom({ subjects: [], levels: [], classroom_ids: [3] }).mode).toBe("groups");
  });

  it("reaches no group when specific groups is chosen and none is ticked", () => {
    expect(draftChats(groups, { mode: "groups", subjects: [], levels: [], classroom_ids: [] })).toEqual([]);
    expect(draftChats(groups, { mode: "filter", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual(["-1001", "-1002"]);
  });

  it("sends only the half of the draft its mode uses", () => {
    expect(draftToFields({ mode: "groups", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual({
      subjects: [], levels: [], classroom_ids: [3],
    });
    expect(draftToFields({ mode: "filter", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual({
      subjects: ["MATH"], levels: [], classroom_ids: [],
    });
  });
});
```

(Merge the import into the file's existing import line, so it is not imported twice.)

`frontend/src/features/ops/telegram-posts/__tests__/PostForm.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The post form. What is worth pinning: it counts against the limit Telegram will apply, it
 * asks first and names how many groups, and a picture turns the body into a multipart form.
 */

const save = vi.fn();
const confirmSpy = vi.fn();

vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useSavePost: () => ({ mutate: save, isPending: false }),
  useTelegramGroups: () => ({
    data: {
      enabled: true,
      groups: [
        { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
        { id: 2, name: "Junior G2 Math", subject: "MATH", level: "junior", chat_id: "-1002" },
        { id: 3, name: "Senior G3 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
        { id: 4, name: "Senior G4 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
      ],
    },
  }),
}));

const { PostForm } = await import("@/features/ops/telegram-posts/PostForm");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
const radio = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === label)!.querySelector("input")!;

async function typeMessage(value: string) {
  const area = document.body.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choosePicture() {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["png"], "mock.png", { type: "image/png" });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return file;
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PostForm post={null} onClose={vi.fn()} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PostForm", () => {
  it("counts against 4096, and against 1024 once a picture is chosen", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    expect(text()).toContain("12/4096 characters");
    await choosePicture();
    expect(text()).toContain("12/1024 characters");
  });

  it("asks first, naming how many groups — one per chat", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => button("Post now").click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Post this to 3 Telegram groups now?");
    const body = save.mock.calls[0][0].body;
    expect(body).toMatchObject({ text: "Ertaga mock!", when: "NOW", subjects: [], levels: [], classroom_ids: [] });
  });

  it("sends nothing when the confirm is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => button("Post now").click());
    expect(save).not.toHaveBeenCalled();
  });

  it("will not schedule a weekly post with no day", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    await act(async () => radio("Every week").click());
    await act(async () => button("Schedule").click());
    expect(text()).toContain("Pick at least one day.");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("sends a picture as multipart, with the lists as JSON strings", async () => {
    await render();
    await typeMessage("Ertaga mock!");
    const file = await choosePicture();
    await act(async () => button("Post now").click());
    const body = save.mock.calls[0][0].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("subjects")).toBe("[]");
    expect(body.get("image")).toBe(file);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/ops/telegram-posts`
Expected: FAIL (`PostForm` and the draft helpers do not exist).

- [ ] **Step 3: Implement**

`frontend/src/lib/datetimeLocal.ts`:

```ts
/** `datetime-local` speaks local wall-clock with no zone; the API speaks ISO with one. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
```

Append to `frontend/src/features/ops/telegram-posts/audience.ts`:

```ts
/** The picker's state: an audience plus which half of it is in use. */
export interface AudienceDraft extends Audience {
  mode: "filter" | "groups";
}

export function draftFrom(saved: Partial<Audience> | undefined): AudienceDraft {
  const ids = saved?.classroom_ids ?? [];
  return { mode: ids.length ? "groups" : "filter", subjects: saved?.subjects ?? [], levels: saved?.levels ?? [], classroom_ids: ids };
}

export function draftChats(groups: TelegramGroup[], draft: AudienceDraft): string[] {
  if (draft.mode === "groups") {
    return (draft.classroom_ids ?? []).length ? targetChats(groups, draft) : [];
  }
  return targetChats(groups, { subjects: draft.subjects, levels: draft.levels });
}

export function draftToFields(draft: AudienceDraft): Required<Audience> {
  return draft.mode === "groups"
    ? { subjects: [], levels: [], classroom_ids: draft.classroom_ids ?? [] }
    : { subjects: draft.subjects, levels: draft.levels, classroom_ids: [] };
}
```

`frontend/src/features/ops/telegram-posts/AudiencePicker.tsx`:

```tsx
"use client";

import { Checkbox } from "@/components/ui";
import { LEVELS, SUBJECTS, draftChats, type AudienceDraft } from "./audience";
import type { TelegramGroup } from "./telegramPostsApi";

/**
 * Toggle one value in an "empty means all" list. Unticking the last one is refused, not
 * turned into an empty list, because an empty list reads back as "all" again.
 */
function toggle(list: string[], value: string, all: readonly string[]): string[] {
  const current = list.length === 0 ? [...all] : list;
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  if (next.length === 0) return list;
  return next.length === all.length ? [] : next;
}

const SUBJECT_VALUES = SUBJECTS.map((s) => s.value);
const LEVEL_VALUES = LEVELS.map((l) => l.value);

export function AudiencePicker({
  groups,
  value,
  onChange,
  allowSpecific = true,
}: {
  groups: TelegramGroup[];
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  /** Events store subjects × levels only, so their form hides the specific-groups half. */
  allowSpecific?: boolean;
}) {
  const count = draftChats(groups, value).length;
  const ids = value.classroom_ids ?? [];

  return (
    <div className="space-y-2">
      {allowSpecific ? (
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={value.mode === "filter"} onChange={() => onChange({ ...value, mode: "filter" })} />
            By subject and level
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={value.mode === "groups"} onChange={() => onChange({ ...value, mode: "groups" })} />
            Specific groups
          </label>
        </div>
      ) : null}

      {value.mode === "filter" ? (
        <>
          <div className="flex flex-wrap gap-4">
            {SUBJECTS.map((s) => (
              <Checkbox
                key={s.value}
                label={s.label}
                checked={value.subjects.length === 0 || value.subjects.includes(s.value)}
                onChange={() => onChange({ ...value, subjects: toggle(value.subjects, s.value, SUBJECT_VALUES) })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {LEVELS.map((l) => (
              <Checkbox
                key={l.value}
                label={l.label}
                checked={value.levels.length === 0 || value.levels.includes(l.value)}
                onChange={() => onChange({ ...value, levels: toggle(value.levels, l.value, LEVEL_VALUES) })}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {groups.map((g) => (
            <Checkbox
              key={g.id}
              label={g.name}
              checked={ids.includes(g.id)}
              onChange={() =>
                onChange({ ...value, classroom_ids: ids.includes(g.id) ? ids.filter((i) => i !== g.id) : [...ids, g.id] })
              }
            />
          ))}
        </div>
      )}

      <p className="text-xs font-semibold text-muted-foreground">
        Goes to {count} Telegram group{count === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
```

`frontend/src/features/ops/telegram-posts/PostForm.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

import { Alert, Button, Checkbox, Field, Input, Modal, Textarea } from "@/components/ui";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { AudiencePicker } from "./AudiencePicker";
import { WEEKDAYS, draftChats, draftFrom, draftToFields, type AudienceDraft } from "./audience";
import type { GroupPostDetail, PostWhen } from "./telegramPostsApi";
import { useSavePost, useTelegramGroups } from "./telegramPostsHooks";

/** Telegram's limits, as the server checks them (telegram_posts/render.py). */
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;

type When = Exclude<PostWhen, "EVENT">;
const WHEN_LABEL: Record<When, string> = { NOW: "Now", ONCE: "Once, at a set time", WEEKLY: "Every week" };

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (typeof data?.detail === "string") return data.detail;
  return data ? Object.values(data).flat().join(" ") : "Couldn't save that. Try again.";
}

export function PostForm({ post, onClose }: { post: GroupPostDetail | null; onClose: () => void }) {
  const save = useSavePost();
  const groups = useTelegramGroups();
  const [text, setText] = useState(post?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [buttonText, setButtonText] = useState(post?.button_text ?? "");
  const [buttonUrl, setButtonUrl] = useState(post?.button_url ?? "");
  const [audience, setAudience] = useState<AudienceDraft>(draftFrom(post ?? undefined));
  const [when, setWhen] = useState<When>(post && post.when !== "EVENT" ? post.when : "NOW");
  const [sendAt, setSendAt] = useState(toLocalInput(post?.send_at ?? null));
  const [weekdays, setWeekdays] = useState<number[]>(post?.weekdays ?? []);
  const [timeOfDay, setTimeOfDay] = useState((post?.time_of_day ?? "18:00").slice(0, 5));
  const [error, setError] = useState<string | null>(null);

  const hasPicture = Boolean(file || post?.image_url);
  const limit = hasPicture ? CAPTION_MAX : TEXT_MAX;
  const length = text.trim().length;
  const chats = useMemo(() => draftChats(groups.data?.groups ?? [], audience), [groups.data, audience]);

  const submit = () => {
    setError(null);
    if (!length) return setError("Write the message first.");
    if (length > limit) {
      return setError(`Telegram takes ${limit} characters${hasPicture ? " under a picture" : ""}; this is ${length}.`);
    }
    if (when === "ONCE" && !fromLocalInput(sendAt)) return setError("Pick when it goes out.");
    if (when === "WEEKLY" && weekdays.length === 0) return setError("Pick at least one day.");
    if (chats.length === 0) return setError("No connected group matches — pick at least one.");

    const n = chats.length;
    const groupsWord = `${n} Telegram group${n === 1 ? "" : "s"}`;
    const question =
      when === "NOW"
        ? `Post this to ${groupsWord} now? The bot can delete it from the groups for 48 hours.`
        : `Schedule this for ${groupsWord}?`;
    if (!window.confirm(question)) return;

    const fields: Record<string, unknown> = {
      text: text.trim(),
      button_text: buttonText.trim(),
      button_url: buttonUrl.trim(),
      ...draftToFields(audience),
      when,
      send_at: when === "ONCE" ? fromLocalInput(sendAt) : null,
      weekdays: when === "WEEKLY" ? weekdays : [],
      time_of_day: when === "WEEKLY" ? timeOfDay : null,
    };
    let body: FormData | Record<string, unknown> = fields;
    if (file) {
      // A multipart form carries strings only: the lists travel as JSON (JsonListField).
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => {
        if (v === null) return;
        fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
      });
      fd.append("image", file);
      body = fd;
    }
    save.mutate({ id: post?.id, body }, { onSuccess: onClose, onError: (e) => setError(errorText(e)) });
  };

  return (
    <Modal open onClose={onClose} title={post ? "Edit post" : "New post"}>
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Message" hint={`${length}/${limit} characters`}>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ertaga yakshanba soat 10:00 da mock! …"
          />
        </Field>
        <Field
          label="Picture"
          hint={post?.image_url && !file ? "The current picture is kept." : "Optional. Under a picture Telegram takes 1024 characters."}
        >
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Button label" hint="Optional.">
            <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Ro'yxatdan o'tish" />
          </Field>
          <Field label="Button link" hint="https://…">
            <Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} />
          </Field>
        </div>
        <Field label="To">
          <AudiencePicker groups={groups.data?.groups ?? []} value={audience} onChange={setAudience} />
        </Field>
        <Field label="When">
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
              <label key={w} className="inline-flex items-center gap-1.5">
                <input type="radio" checked={when === w} onChange={() => setWhen(w)} />
                {WHEN_LABEL[w]}
              </label>
            ))}
          </div>
        </Field>
        {when === "ONCE" ? (
          <Field label="Goes out at">
            <Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
          </Field>
        ) : null}
        {when === "WEEKLY" ? (
          <Field label="Every week on" hint="Tashkent time.">
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day, i) => (
                <Checkbox
                  key={day}
                  label={day}
                  checked={weekdays.includes(i)}
                  onChange={() =>
                    setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i].sort((a, b) => a - b))
                  }
                />
              ))}
            </div>
            <Input type="time" aria-label="Time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="mt-2 w-32" />
          </Field>
        ) : null}
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Preview</p>
          <div className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-3 text-sm">
            {text.trim() || "…"}
            {buttonText.trim() && buttonUrl.trim() ? (
              <span className="mt-2 block rounded-lg border border-border px-3 py-1.5 text-center text-xs font-bold">
                {buttonText.trim()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={save.isPending}>{when === "NOW" ? "Post now" : "Schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

`TelegramPostsPage.tsx`:
- add `import { useState } from "react";`, `import { Button } from "@/components/ui";` (merge into the existing ui import) and `import { PostForm } from "./PostForm";`;
- inside the component, `const [creating, setCreating] = useState(false);`;
- give the `OpsPageHeader` this `actions` prop:

```tsx
        actions={
          <Button onClick={() => setCreating(true)}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            New post
          </Button>
        }
```

and render `{creating ? <PostForm post={null} onClose={() => setCreating(false)} /> : null}` as the last child of the page's outer `div`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/features/ops/telegram-posts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/datetimeLocal.ts frontend/src/features/ops/telegram-posts
git commit -m "feat(ops): write a Telegram post — audience, schedule, preview, a confirm that counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend — a post's own page

**Files:**
- Create: `frontend/src/features/ops/telegram-posts/TelegramPostPage.tsx`, `frontend/src/app/(ops)/ops/telegram-posts/[id]/page.tsx`
- Test: `frontend/src/features/ops/telegram-posts/__tests__/TelegramPostPage.test.tsx`

**Interfaces:**
- Consumes: `useTelegramPost`, `usePostAction`, `PostForm`, the helpers.
- Produces: `<TelegramPostPage id />`.

Which actions show:
- **Edit:** only for a live manual post, and a once/now post only before it has run (the server refuses otherwise).
- **Pause / Resume:** for a live weekly post or event reminder.
- **Retry failed:** when the last run has failures.
- **Send missed now:** when the last run has missed rows.
- **Delete from groups:** while live. It asks first, names the group count, and reports what was too old.

- [ ] **Step 1: Write the failing test** — `__tests__/TelegramPostPage.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** A post's page: who got it, what failed, and the buttons that act on exactly that. */

const useTelegramPost = vi.fn();
const act_ = vi.fn();
const confirmSpy = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramPost: (id: number) => useTelegramPost(id),
  usePostAction: () => ({ mutate: act_, isPending: false }),
  useSavePost: () => ({ mutate: vi.fn(), isPending: false }),
  useTelegramGroups: () => ({ data: { enabled: true, groups: [] } }),
}));

const { TelegramPostPage } = await import("@/features/ops/telegram-posts/TelegramPostPage");

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga mock!", preview: "Ertaga mock!", image_url: null,
    button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00",
    last_run: { run_on: "2026-10-17", total: 2, sent: 1, failed: 1, missed: 0, pending: 0, deleted: 0 },
    state: "failed",
    runs: [{
      run_on: "2026-10-17",
      deliveries: [
        { id: 1, chat_id: "-1001", group_names: "Senior G1 Math", status: "SENT", error: "", sent_at: "2026-10-17T18:00:05+05:00", attempts: 1 },
        { id: 2, chat_id: "-1002", group_names: "Junior G2 Math", status: "FAILED", error: "403: Forbidden: bot was kicked", sent_at: null, attempts: 1 },
      ],
    }],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TelegramPostPage id={7} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  useTelegramPost.mockReturnValue({ data: detail(), isPending: false, isError: false, refetch: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TelegramPostPage", () => {
  it("lists every group of the run, with the reason a send failed", async () => {
    await render();
    expect(text()).toContain("Senior G1 Math");
    expect(text()).toContain("Junior G2 Math");
    expect(text()).toContain("403: Forbidden: bot was kicked");
  });

  it("retries only when something failed", async () => {
    await render();
    await act(async () => button("Retry failed")!.click());
    expect(act_.mock.calls[0][0]).toBe("retry");
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: { run_on: "2026-10-17", total: 2, sent: 2, failed: 0, missed: 0, pending: 0, deleted: 0 }, state: "scheduled" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await act(async () => root.render(<TelegramPostPage id={7} />));
    expect(button("Retry failed")).toBeUndefined();
  });

  it("asks before deleting from the groups, and says what was too old", async () => {
    act_.mockImplementation((_action: string, opts: { onSuccess: (d: unknown) => void }) =>
      opts.onSuccess({ result: { deleted: 1, too_old: 1, failed: 0 }, post: detail() }),
    );
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Delete this post from 1 Telegram group");
    expect(act_.mock.calls[0][0]).toBe("delete-from-groups");
    expect(text()).toContain("1 too old — remove it by hand.");
  });

  it("does nothing when the delete is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(act_).not.toHaveBeenCalled();
  });

  it("sends an event's post back to its event for edits", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ kind: "EVENT_REMINDER", when: "EVENT", event_id: 3, event_title: "Admission Workshop" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(button("Edit")).toBeUndefined();
    expect(text()).toContain("Admission Workshop");
    expect(button("Pause")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/ops/telegram-posts/__tests__/TelegramPostPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`frontend/src/features/ops/telegram-posts/TelegramPostPage.tsx`:

```tsx
"use client";

/**
 * /ops/telegram-posts/<id> — one post: what it says, who got it on each run, and the buttons
 * that act on exactly what the rows show. Deleting is the only way back from a wrong post, and
 * Telegram allows it for 48 hours, so the page says plainly what it could not take down.
 */

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Alert, Badge, Button } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { PostForm } from "./PostForm";
import { STATE_BADGE, firstLine, kindLabel, plainText, scheduleLabel } from "./audience";
import type { DeliveryStatus, PostAction } from "./telegramPostsApi";
import { usePostAction, useTelegramPost } from "./telegramPostsHooks";

const DELIVERY_BADGE: Record<DeliveryStatus, { variant: BadgeVariant; label: string }> = {
  PENDING: { variant: "neutral", label: "Pending" },
  SENDING: { variant: "warning", label: "Sending" },
  SENT: { variant: "success", label: "Sent" },
  FAILED: { variant: "danger", label: "Failed" },
  MISSED: { variant: "warning", label: "Missed" },
  DELETED: { variant: "neutral", label: "Deleted" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  return typeof data?.detail === "string" ? data.detail : "That didn't work. Try again.";
}

export function TelegramPostPage({ id }: { id: number }) {
  const post = useTelegramPost(id);
  const action = usePostAction(id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (post.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (post.isError || !post.data) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">The post didn&apos;t load.</p>
        <button type="button" onClick={() => void post.refetch()} className="mt-1 text-sm font-bold text-primary underline">
          Try again
        </button>
      </div>
    );
  }

  const p = post.data;
  const state = STATE_BADGE[p.state];
  const last = p.last_run;
  const live = !p.deleted_at;
  const repeats = p.when === "WEEKLY" || p.when === "EVENT";
  const editable = live && p.kind === "MANUAL" && (p.when === "WEEKLY" || !last);

  const perform = (verb: PostAction, describe: (result: Record<string, number>) => string) => {
    setError(null);
    setNotice(null);
    action.mutate(verb, {
      onSuccess: (data) => setNotice(describe(data.result)),
      onError: (e) => setError(errorText(e)),
    });
  };

  const deleteFromGroups = () => {
    const sent = last?.sent ?? 0;
    const question =
      `Delete this post from ${plural(sent, "Telegram group")}${repeats ? " and stop it for good" : ""}? ` +
      "The bot can only delete what it sent in the last 48 hours.";
    if (!window.confirm(question)) return;
    perform("delete-from-groups", (r) =>
      [
        `Deleted from ${plural(r.deleted ?? 0, "group")}.`,
        r.too_old ? `${r.too_old} too old — remove it by hand.` : "",
        r.failed ? `${r.failed} could not be deleted.` : "",
      ].filter(Boolean).join(" "),
    );
  };

  return (
    <div className="space-y-5">
      <Link href="/ops/telegram-posts" className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Telegram posts
      </Link>

      <OpsPageHeader
        section="Telegram posts"
        title={firstLine(p.preview || p.text) || "Post"}
        description={`${kindLabel(p)} · ${scheduleLabel(p)} · ${p.audience_label}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button> : null}
            {live && repeats ? (
              p.is_paused ? (
                <Button size="sm" variant="secondary" onClick={() => perform("resume", () => "Resumed. What the pause covered stays skipped.")}>
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => perform("pause", () => "Paused.")}>Pause</Button>
              )
            ) : null}
            {live && last?.failed ? (
              <Button size="sm" onClick={() => perform("retry", (r) => `Sending again to ${plural(r.queued ?? 0, "group")}.`)}>
                Retry failed
              </Button>
            ) : null}
            {live && last?.missed ? (
              <Button size="sm" onClick={() => perform("send-missed", (r) => `Sending to ${plural(r.queued ?? 0, "group")} now.`)}>
                Send missed now
              </Button>
            ) : null}
            {live ? <Button size="sm" variant="danger" onClick={deleteFromGroups}>Delete from groups</Button> : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Badge variant={state.variant}>{state.label}</Badge>
        {p.event_id ? <Link href="/ops/events" className="underline">Event: {p.event_title}</Link> : null}
        {p.next_send_at ? <span>Next: {new Date(p.next_send_at).toLocaleString()}</span> : null}
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">The message</p>
        {p.image_url ? (
          // A signed, expiring R2 URL — not a host next/image is configured for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" className="mb-3 max-h-64 rounded-xl" />
        ) : null}
        <p className="whitespace-pre-wrap text-sm">{plainText(p.preview || p.text)}</p>
      </div>

      {p.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
      ) : (
        p.runs.map((run) => (
          <section key={run.run_on} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border bg-surface-2 px-5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{run.run_on}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-semibold">Group</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Sent</th>
                  <th className="px-5 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {run.deliveries.map((d) => {
                  const badge = DELIVERY_BADGE[d.status];
                  return (
                    <tr key={d.id}>
                      <td className="px-5 py-2 font-semibold">{d.group_names || d.chat_id}</td>
                      <td className="px-2 py-2"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                      <td className="px-2 py-2 text-xs">{d.sent_at ? new Date(d.sent_at).toLocaleTimeString() : ""}</td>
                      <td className="px-5 py-2 text-xs text-muted-foreground">{d.error}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}

      {editing ? <PostForm post={p} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
```

`frontend/src/app/(ops)/ops/telegram-posts/[id]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import { TelegramPostPage } from "@/features/ops/telegram-posts/TelegramPostPage";

export default function OpsTelegramPostPage() {
  const { id } = useParams<{ id: string }>();
  return <TelegramPostPage id={Number(id)} />;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/features/ops/telegram-posts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ops/telegram-posts frontend/src/app/\(ops\)/ops/telegram-posts
git commit -m "feat(ops): a Telegram post's page — per-group rows, retry, pause, delete from groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Frontend — the event form, the Publish confirm, the row link

**Files:**
- Modify: `frontend/src/features/events/eventsApi.ts`, `frontend/src/app/(ops)/ops/events/page.tsx`
- Test: `frontend/src/features/events/__tests__/OpsEventsPage.test.tsx`

**Interfaces:**
- Consumes: `AudiencePicker`, `draftFrom`, `draftChats`, `useTelegramGroups` (Tasks 9–10), `@/lib/datetimeLocal`, and the Task 8 payload fields.
- Produces: `LearningEvent.telegram_post?`, `telegram_audience?`, `telegram?`. These are ops-only and absent from a student's payload.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/events/__tests__/OpsEventsPage.test.tsx`:

1. Add the mocks next to the existing `vi.mock("@/features/events/eventsHooks", …)`:

```tsx
const useTelegramGroups = vi.fn();
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramGroups: () => useTelegramGroups(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
```

2. In `beforeEach`, add:

```tsx
  useTelegramGroups.mockReturnValue({
    data: {
      enabled: true,
      groups: [
        { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
        { id: 2, name: "Junior G2 English", subject: "ENGLISH", level: "junior", chat_id: "-1002" },
      ],
    },
  });
```

3. Add these cases inside `describe("OpsEventsPage", …)`:

```tsx
  it("names the Telegram groups in the Publish confirm", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ telegram_post: true, telegram_audience: { subjects: ["MATH"], levels: [] }, telegram: null })],
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => buttonLabelled("Publish")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("post to 1 Telegram group");
  });

  it("leaves Telegram out of the confirm when the box is unticked", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ telegram_post: false, telegram_audience: { subjects: [], levels: [] }, telegram: null })],
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => buttonLabelled("Publish")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).not.toContain("Telegram");
  });

  it("links a published event to its Telegram post", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ status: "PUBLISHED", telegram: { post_id: 9, sent: 25, failed: 1, total: 26 } })],
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    const link = document.querySelector<HTMLAnchorElement>('a[href="/ops/telegram-posts/9"]');
    expect(link?.textContent).toBe("Telegram 25/26 · 1 failed");
  });

  it("offers the Telegram choice in the form", async () => {
    await render();
    await act(async () => buttonLabelled("Add an event")!.click());
    expect(text()).toContain("Post to Telegram groups");
    expect(text()).toContain("Goes to 2 Telegram groups.");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/events/__tests__/OpsEventsPage.test.tsx`
Expected: FAIL on the four new cases. The existing cases still pass, with the new mocks inert.

- [ ] **Step 3: Implement**

`frontend/src/features/events/eventsApi.ts`, add to `LearningEvent` after `can_cancel`:

```ts
  /** Ops payload only (plan 2026-10-17): whether Publish posts it into the class Telegram groups. */
  telegram_post?: boolean;
  /** Ops payload only: which groups — empty lists mean every group. */
  telegram_audience?: { subjects: string[]; levels: string[] };
  /** Ops payload only: how the announcement went, once it exists. */
  telegram?: { post_id: number; sent: number; failed: number; total: number } | null;
```

`frontend/src/app/(ops)/ops/events/page.tsx`:

1. Delete the local `toLocalInput` and `fromLocalInput` functions and their doc comment. Import them instead, and add the Telegram imports:

```tsx
import Link from "next/link";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { AudiencePicker } from "@/features/ops/telegram-posts/AudiencePicker";
import { draftChats, draftFrom, type AudienceDraft } from "@/features/ops/telegram-posts/audience";
import { useTelegramGroups } from "@/features/ops/telegram-posts/telegramPostsHooks";
```

Also add `Checkbox` to the `@/components/ui` import.

2. In `EventForm`, after the `file` state:

```tsx
  const groups = useTelegramGroups();
  const telegramOn = groups.data?.enabled === true;
  const [telegramPost, setTelegramPost] = useState(event?.telegram_post ?? true);
  const [audience, setAudience] = useState<AudienceDraft>(draftFrom(event?.telegram_audience));
```

3. In `submit`, add to `fields` after `ends_at`:

```tsx
      telegram_post: telegramPost,
      // Events store subjects × levels only (the picker hides "specific groups" here).
      telegram_audience: { subjects: audience.subjects, levels: audience.levels },
```

In the FormData branch, objects must travel as JSON. Replace the `Object.entries(fields).forEach(...)` line with:

```tsx
      Object.entries(fields).forEach(([k, v]) =>
        fd.append(k, v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)),
      );
```

4. In the form JSX, between the Seats `Field` and the buttons row:

```tsx
        {telegramOn ? (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <Checkbox
              label="Post to Telegram groups"
              checked={telegramPost}
              onChange={(e) => setTelegramPost(e.target.checked)}
            />
            {telegramPost ? (
              <AudiencePicker
                groups={groups.data?.groups ?? []}
                value={audience}
                onChange={setAudience}
                allowSpecific={false}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Posted when you publish, with a reminder the evening before at 18:00.
            </p>
          </div>
        ) : null}
```

5. In `OpsEventsPage`, after the existing hooks:

```tsx
  const telegramGroups = useTelegramGroups();
```

Replace the Publish `onClick` body with:

```tsx
                        onClick={() => {
                          // Publishing IS the send — about 370 emails and, when ticked, a post
                          // in every chosen class group. There is no test send and no undo.
                          const tg = telegramGroups.data;
                          const n =
                            tg?.enabled && event.telegram_post !== false
                              ? draftChats(tg.groups, draftFrom(event.telegram_audience)).length
                              : 0;
                          const question = n
                            ? `Publish “${event.title}”, email every student and post to ${n} Telegram group${n === 1 ? "" : "s"}? This can't be undone.`
                            : `Publish “${event.title}” and email every student? This can't be undone.`;
                          if (window.confirm(question)) publish.mutate(event.id);
                        }}
```

In the row's meta `<p>`, after the seats `<span>`:

```tsx
                      {event.telegram ? (
                        <Link href={`/ops/telegram-posts/${event.telegram.post_id}`} className="underline">
                          Telegram {event.telegram.sent}/{event.telegram.total}
                          {event.telegram.failed ? ` · ${event.telegram.failed} failed` : ""}
                        </Link>
                      ) : null}
```

Update the page description to `"Workshops, talks and open days. Publishing one emails every student and, when ticked, posts it into the class Telegram groups."`.

- [ ] **Step 4: Run the events tests and the posts tests**

Run: `npx vitest run src/features/events src/features/ops/telegram-posts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/events frontend/src/app/\(ops\)/ops/events/page.tsx
git commit -m "feat(ops/events): post to Telegram groups on Publish — the choice, the count, the link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, full verification, PR

**Files:**
- Modify: `docs/CLASSROOM_TELEGRAM_GROUPS.md` (append a section)

- [ ] **Step 1: Write the docs section.** Append to `docs/CLASSROOM_TELEGRAM_GROUPS.md`:

```markdown
## Group posts (2026-10-17)

The bot also posts *into* the class groups: an event's announcement when it is published, its
reminder the evening before (18:00 Tashkent), and the posts written in `/ops/telegram-posts`
(now, once at a time, or every week — the Saturday 18:00 "ertaga mock" post is one of these).

- Flag: `TELEGRAM_GROUP_POSTS_ENABLED` (default off). Off: nothing is sent, Publish creates no
  posts, the pages say so. Turning it on is not retroactive.
- Who gets it: active classes with a chat id, by subject × level or chosen classes; one message
  per chat. The confirm names the count.
- Late: a run more than 60 min behind (server down) is recorded *Missed* and never sent on its
  own; "Send missed now" is the admin's call.
- Retries: 429 waits Telegram's `retry_after` (≤ 30 s); network/5xx up to 3 tries; 400/403 fail
  at once with the reason on the post's page. "Retry failed" re-queues only the failed groups.
- Taking it back: "Delete from groups" removes the bot's message wherever it is under 48 h old
  and stops the post for good; older ones are listed as "too old — remove by hand".
- Tables: `telegram_group_posts`, `telegram_group_post_deliveries`. Beat: `telegram-posts-sweep`
  every minute (worker AND beat must be restarted when this ships — new tasks, new schedule).

Switch-on:
1. Deploy (migrate-first: `telegram_posts.0001`, `events.0003`, both additive).
2. Append `TELEGRAM_GROUP_POSTS_ENABLED=True` to `shared/backend.env`; reload gunicorn
   (TTIN×3/TTOU×3) and restart celery worker + beat outside the quarter-hour sync slot.
3. In `/ops/telegram-posts`, a *Now* post to the `test` group only (Specific groups → test).
4. Owner checks it in Telegram; then the real weekly post (Sat 18:00, all groups).
```

- [ ] **Step 2: Full backend run.** From `backend/`:

`SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test telegram_posts events classes.tests_telegram_group classes.tests_telegram_bot classes.tests_telegram_payments classes.tests_telegram_ops users.tests.test_public_student_surfaces --settings=config.settings_test_nomigrations -v 1`

Expected: a literal `OK`.

Then: `SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations --check --dry-run`. Expected: `No changes detected`.

- [ ] **Step 3: Migrations on a throwaway Postgres.** Follow memory `local-postgres-verify-orm-sql`: start the local Postgres, create a throwaway database, then:
  1. `migrate` up to `events 0002` / before `telegram_posts`;
  2. `migrate telegram_posts`, then `migrate events`;
  3. `migrate events 0002` (reverse), then forward again.

Expected: every step applies cleanly. In particular there must be no duplicate `_like` index (memory `postgres-like-index-double-create`).

- [ ] **Step 4: Full frontend run.** From `frontend/`:
  - `npx vitest run` → all pass;
  - `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` → no output;
  - `npx eslint src/features/ops/telegram-posts src/app/\(ops\)/ops/telegram-posts src/app/\(ops\)/ops/events src/lib/datetimeLocal.ts src/features/events` → clean;
  - `npx knip` → no new unused exports or files (remove any it names);
  - `npm run check:api-layer` → pass.

- [ ] **Step 5: Graph + commit + PR**

```bash
graphify update .
git add docs/CLASSROOM_TELEGRAM_GROUPS.md
git commit -m "docs(telegram): group posts — flag, rules, switch-on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD:refs/heads/feat/telegram-group-posts
gh pr create --base main --head feat/telegram-group-posts --title "Telegram group posts: events, the evening-before reminder, scheduled posts" --body "<summary of Decisions 1–7, the flag, the switch-on steps, and the test runs with their literal OK / pass lines>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Nothing is merged, deployed or switched on in this plan. Each of those is the owner's word.

---

## Self-review (done while writing)

- **Coverage:**
  - Decision 1: Task 8 (backend) + Task 12 (form, confirm, link).
  - Decision 2: Tasks 6, 7, 9, 10, 11.
  - Decision 3: Task 4 (`reminder_at`, `active_from`, cancelled) + Task 3 (`event_reminder`) + Task 8 (the reminder post).
  - Decision 5: Task 3.
  - Decision 6: Tasks 9–12.
  - Decision 7: Tasks 2, 5, 6.
  - Rollout: Task 13.
- **Names checked across tasks:**
  - `sender.api` is the one patch point, and `services` calls `sender.api.delete_message`;
  - `services.last_run` / `post_state` / `delivery_counts` / `runs` are used by Task 7 exactly as Task 6 defines them;
  - `audience.normalize` is added in Task 8 and used by the events serializer and `on_event_published`;
  - `draftFrom` / `draftChats` / `draftToFields` are added in Task 10 and used in Tasks 10 and 12;
  - `toLocalInput` / `fromLocalInput` move in Task 10, and Task 12 deletes the page's copies.
- **Known limits, by design:**
  - A weekly slot missed on a past day is not resurrected.
  - Sent messages are never edited, only deleted (within 48 h).
  - Teachers see the nav item and get a 403, the same as Events today.
