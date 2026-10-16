# Class Telegram Bot (sign-in, groups menu, payment messages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students sign in to `@Mastersatsbot` with their MasterSAT login and password. They see their class groups as buttons and get a one-time invite from the bot. An unpaid month takes them out of every group, with an Uzbek message. A payment and an unfreeze are announced, and admins get a Telegram tab on `/ops/classrooms/<id>` to remove old members by hand.

**Architecture:** This builds on the class-Telegram-group feature that has been live since 2026-09-05 (`classes/telegram_group.py`: one-time tickets, freeze → kick, the sweep, three safety rules), which is still switched off (0 of 30 classes have a chat id). A new `classes/telegram_bot.py` holds the private-chat conversation, reached through the existing webhook (`views_telegram.py`). Conversation state and lockouts live in the cache (Redis on prod). All bot wording sits in `classes/telegram_texts.py`, in Uzbek. Payment messages ride a new stage of the lc-up sync. Two additive nullable fields are added (`ClassroomTelegramMember.identified_at`, `LcupPayment.bot_notified_at`). Everything new sits behind two settings that default to off.

**Tech Stack:** Django 6 + DRF, Celery (`shared_task`, `_dispatch` on-commit helper), Telegram Bot API through the never-raising wrapper `classes/telegram_group_api.py`, Next.js + TanStack Query + vitest.

**Spec:** No spec file (owner rule: design approved in chat → plan → code). The approved design is in **Decisions** below, which this plan argues from. History is in memory `classroom-telegram-groups.md` and `lcup-finance-part3.md`.

## Decisions (approved in chat, 2026-10-16, one question at a time)

1. **The lock is the whole account, for now.** The existing lc-up debt freeze applies: from day 6, a balance below zero freezes the account, and the student leaves every class group. Every group button shows 🔒. The user first asked for a per-group lock. A measurement showed lc-up has **no per-group balance**: `/groups/{id}/students .balance` is the overall balance repeated, and payment `month` equals the payment date's month. So the decision became "A now, B when lc-up adds a per-group balance". Nothing in this plan computes per-group debt.
2. **Sign-in is login + password, asked by the bot in the chat** (the user chose this over a Mini App form and over a `/start` token alone). The bot deletes the password message at once. After **5 wrong tries it locks for 15 minutes**, per Telegram account **and** per login. Only a real password works: the lc-up first-time "last 4 digits" code does not.
3. **Old members.** Members who were in a group before the bot are **not** removed automatically, old debtors included. An admin removes them by hand, once. Every group gets a "sign in to the bot" announcement. A member who signs in and is found in the group becomes **identified**, and from then on the bot manages them. A member who is frozen at that moment is left for the admin.
4. **Approach 1:** extend the existing bot and webhook. There is one bot, `@Mastersatsbot`, with one webhook.
5. **Messages.** The freeze message is in Uzbek, worded by reason (debt or admin), with one combined message for all groups. A new lc-up payment is announced as "✅ {class} uchun {amount} so'm to'lov qabul qilindi", followed by "Qarzingiz qolmadi" or "Qolgan qarz: X so'm". It goes out only for payments created after switch-on, once per payment, never for refunds. When a freeze lifts, the bot sends "🔓 …" with a ➕ button per group.
6. **Ops.** The class page gets a **Telegram** tab with health, counts (Telegram's head count against people known here), and the members with managed/frozen flags. A **Remove** button lets the bot remove that person; this is forced past rules 1 and 3, and never past rule 2 (chat admins).

## Global Constraints

- **Language:** bot text is Uzbek (Latin), all of it in `classes/telegram_texts.py`. Site UI text stays English (owner's 2026-10-14 rule for the student side).
- **The password is never logged, stored, put in an exception message or written to the audit trail.** Webhook logs carry outcome tags only, never message text.
- **Flags, default off:**
  - `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=False`. Off means the old `/start` reply and the old join dialog.
  - `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM=""`. Empty means no payment messages. A value is an ISO date-time, and only payments lc-up created after it are announced.
- **Lockout:** `MAX_FAILURES = 5`, `LOCK_SECONDS = 15 * 60`, `STATE_SECONDS = 10 * 60`.
- **Safety rules from 2026-09-05 stay:** never remove a chat admin (rule 2, even when forced). Automatic removals act only on rows that are managed (`observed_arrival_at` or `identified_at` set).
- **Migrations:** additive and nullable only: `classes/0056`, `lcup/0007`. Each must apply on a throwaway Postgres before merge (memory `postgres-like-index-double-create`).
- **Backend test command (no venv; run from `backend/`):**
  `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <labels> --settings=config.settings_test_nomigrations -v 1`
  Only a literal `OK` counts as green. Never use `--parallel` for `classes`.
- **Frontend checks (from `frontend/`):** `npx vitest run <paths>`. For types, run `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json`; without the `rm`, tsc can report a false green.
- **Commits:** author `Viltrumlik <viltrumlik@gmail.com>` (verify `git config user.email`). End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Worktree:** `/Users/macbook/Projects/dsat-wt-tg-bot`, branch `feat/classroom-telegram-bot` off `origin/main` `59c5a452`. Never touch the primary checkout.

## File Structure

| File | Responsibility |
|---|---|
| `backend/classes/telegram_group_api.py` (modify) | `send_message(..., reply_markup=)`, new `delete_message`, `answer_callback_query` |
| `backend/classes/telegram_texts.py` (create) | Every Uzbek line the bot sends; `som()`, `group_list()` |
| `backend/classes/models_telegram.py` (modify) | `identified_at`, `is_managed` |
| `backend/classes/migrations/0056_classroomtelegrammember_identified_at.py` (create, generated) | the field |
| `backend/classes/telegram_group.py` (modify) | `is_managed` in the rules, `remove_member(force=)`, `issue_invite(send_dm=)`, `bot_login_enabled`, `bot_start_url`, `student_classrooms`, `identify_memberships`, Uzbek removal DMs, one combined freeze DM |
| `backend/classes/telegram_bot.py` (create) | The private conversation: sign-in, lockouts, menu, `/guruhlar`, `/chiqish`, button presses, the unfreeze menu |
| `backend/classes/views_telegram.py` (modify) | Update dedupe, private messages → `telegram_bot`, `callback_query` |
| `backend/classes/management/commands/set_classroom_bot_webhook.py` (modify) | `callback_query` in `ALLOWED_UPDATES` |
| `backend/classes/telegram_group_hooks.py` (modify) | Unfreeze → `notify_telegram_unfrozen` |
| `backend/classes/tasks.py` (modify) | `notify_telegram_unfrozen`, `send_telegram_payment_messages` |
| `backend/classes/telegram_payments.py` (create) | `notify_new_payments` |
| `backend/lcup/models.py` + `lcup/migrations/0007_lcuppayment_bot_notified_at.py` | `bot_notified_at` |
| `backend/lcup/sync.py` (modify) | The `payment_messages` stage |
| `backend/classes/ops_classrooms.py`, `views_ops_classrooms.py`, `urls.py` (modify) | The `telegram` part, the remove endpoint |
| `backend/classes/management/commands/announce_classroom_bot.py` (create) | The one-off group announcement |
| `backend/config/settings.py` (modify) | The two flags |
| `backend/classes/tests_telegram_group.py` (modify) | `FakeTelegram` grows `delete_message`, `answer_callback_query`, markups, `send_should_fail` |
| `backend/classes/tests_telegram_bot.py` (create) | API additions, texts, managed rows, identification, sign-in, menu, freeze/unfreeze messages |
| `backend/classes/tests_telegram_payments.py` (create) | Payment messages + the sync stage |
| `backend/classes/tests_telegram_ops.py` (create) | Ops part + remove + announce command |
| `frontend/src/features/classroom/telegramApi.ts` (modify) | `bot_url` |
| `frontend/src/features/classroom/shell/TelegramHeaderButton.tsx` (create) | The header button (bot link / old dialog / legacy link) |
| `frontend/src/features/classroom/shell/ClassroomShell.tsx` (modify) | Uses the button |
| `frontend/src/features/ops/classrooms/classroomsApi.ts` (modify) | Types, part name, `removeTelegramMember` |
| `frontend/src/features/ops/classrooms/sections/TelegramSection.tsx` (create) | The ops tab |
| `frontend/src/features/ops/classrooms/ClassroomPage.tsx` (modify) | The tab |
| `docs/CLASSROOM_TELEGRAM_GROUPS.md` (modify) | The bot sign-in section |

---

### Task 1: Bot API additions, the Uzbek texts, and the test fake

**Files:**
- Modify: `backend/classes/telegram_group_api.py` (the `send_message` function at the end of the file; new functions after it)
- Create: `backend/classes/telegram_texts.py`
- Modify: `backend/classes/tests_telegram_group.py` (class `FakeTelegram`, lines ~37–104)
- Create: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Produces:
  - `api.send_message(chat_id, text, *, reply_markup: dict | None = None) -> TgResult`
  - `api.delete_message(chat_id, message_id) -> TgResult`
  - `api.answer_callback_query(callback_query_id: str, text: str = "") -> TgResult`
  - `telegram_texts.<CONSTANTS>`, `som(amount) -> str`, `group_list(names) -> str`
  - Additions to `FakeTelegram`:
    - `.deleted: list[tuple[str,int]]`
    - `.answered: list[str]`
    - `.markups: list[dict|None]` (parallel to `.messages`)
    - `.delete_should_fail`, `.send_should_fail`

- [ ] **Step 1: Write the failing tests**

Create `backend/classes/tests_telegram_bot.py`:

```python
"""The class bot's own conversation (plan 2026-10-16): sign-in, the groups menu, the freeze and
unfreeze messages, and the rows the bot may act on.

Reuses the stand-in group from ``tests_telegram_group``: every Bot API call lands on
:class:`FakeTelegram`, so a test reads what the chat now holds — what was sent, what was
deleted — rather than which function was called with what.
"""

from __future__ import annotations

import json
from unittest import mock

from django.test import SimpleTestCase

from classes import telegram_group_api as api
from classes import telegram_texts as T


class BotApiTests(SimpleTestCase):
    def test_a_keyboard_is_sent_as_json(self):
        keyboard = {"inline_keyboard": [[{"text": "A", "callback_data": "g:1"}]]}
        with mock.patch.object(api, "_call", return_value=api.TgResult(True, {})) as call:
            api.send_message(5, "hi", reply_markup=keyboard)
        method, params = call.call_args[0]
        self.assertEqual(method, "sendMessage")
        self.assertEqual(json.loads(params["reply_markup"]), keyboard)

    def test_no_keyboard_sends_no_markup(self):
        with mock.patch.object(api, "_call", return_value=api.TgResult(True, {})) as call:
            api.send_message(5, "hi")
        self.assertIsNone(call.call_args[0][1]["reply_markup"])

    def test_delete_and_answer_call_the_right_methods(self):
        with mock.patch.object(api, "_call", return_value=api.TgResult(True, True)) as call:
            api.delete_message(5, 77)
            api.answer_callback_query("cq1")
        self.assertEqual(call.call_args_list[0][0], ("deleteMessage", {"chat_id": 5, "message_id": 77}))
        self.assertEqual(call.call_args_list[1][0][0], "answerCallbackQuery")
        self.assertEqual(call.call_args_list[1][0][1]["callback_query_id"], "cq1")


class TextsTests(SimpleTestCase):
    def test_som_groups_thousands_with_spaces(self):
        self.assertEqual(T.som(500000), "500 000")
        self.assertEqual(T.som(1250000), "1 250 000")
        self.assertEqual(T.som(0), "0")

    def test_group_list_escapes_and_bullets(self):
        self.assertEqual(T.group_list(["A & B", "C"]), "• A &amp; B\n• C")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR, `ModuleNotFoundError: No module named 'classes.telegram_texts'`

- [ ] **Step 3: Implement the API additions**

In `backend/classes/telegram_group_api.py`, replace the whole `send_message` function with:

```python
def send_message(chat_id: str | int, text: str, *, reply_markup: dict | None = None) -> TgResult:
    """Best effort by nature: a bot may only message someone who has messaged it first.

    Most students never will have, so a failure here is the normal case rather than an
    incident. ``reply_markup`` carries the groups menu's inline buttons (plan 2026-10-16);
    Telegram wants it as a JSON string inside the form body.
    """
    return _call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
            "reply_markup": json.dumps(reply_markup) if reply_markup else None,
        },
    )


def delete_message(chat_id: str | int, message_id) -> TgResult:
    """Take a message out of a chat. In a private chat a bot may delete what the person sent it
    — which is how a typed password leaves the chat the moment it arrives."""
    return _call("deleteMessage", {"chat_id": chat_id, "message_id": message_id})


def answer_callback_query(callback_query_id: str, text: str = "") -> TgResult:
    """Stop the spinner on a pressed inline button. Telegram shows it until this is called."""
    return _call("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text or None})
```

- [ ] **Step 4: Create the texts module**

Create `backend/classes/telegram_texts.py`:

```python
"""What the class bot says, in Uzbek (plan 2026-10-16).

One place for every line the bot sends, so the conversation reads as one voice and a wording
change is one edit. The site itself stays in English (the owner's 2026-10-14 rule for the
student side); only the bot speaks Uzbek. Anything dynamic is passed through ``esc`` by the
caller — every message goes out as HTML, and Telegram drops a whole message whose markup does
not parse. Inline BUTTON labels are plain text and are not escaped.
"""

from __future__ import annotations

from .telegram_group_api import esc

# ── Signing in ───────────────────────────────────────────────────────────────
ASK_LOGIN = (
    "👋 Assalomu alaykum! Bu MasterSAT guruhlar boti.\n\n"
    "MasterSAT <b>loginingizni</b> yozing: telefon raqam, username yoki email."
)
ASK_PASSWORD = "Endi <b>parolingizni</b> yozing. Xabaringizni darhol o'chirib yuboraman."
WRONG = "❌ Login yoki parol noto'g'ri ({n}/{max}).\n\nLoginingizni qaytadan yozing."
LOCKED = "⛔ Juda ko'p noto'g'ri urinish. {minutes} daqiqadan keyin qayta urinib ko'ring."
NO_PASSWORD_YET = (
    "Bu akkauntga hali parol o'rnatilmagan. Avval mastersat.uz saytiga kirib parol o'rnating, "
    "keyin shu yerga qayting va /start bosing."
)
NOT_A_STUDENT = "Bu bot faqat MasterSAT o'quvchilari uchun."
TG_TAKEN = "Bu Telegram boshqa MasterSAT akkauntiga ulangan. Avval /chiqish buyrug'ini yuboring."
DELETE_FAILED = "⚠️ Parolli xabaringizni o'chira olmadim. Iltimos, uni o'zingiz o'chiring."
WELCOME = "✅ Xush kelibsiz, {name}! Telegramingiz MasterSAT akkauntingizga ulandi."
NOT_BOUND = "Avval MasterSAT akkauntingiz bilan kiring: /start"
LOGGED_OUT = "Telegramingiz MasterSAT akkauntidan uzildi. Qayta kirish uchun: /start"

# ── The groups menu ──────────────────────────────────────────────────────────
MENU_TITLE = "📚 <b>Guruhlaringiz</b>\n\nGuruhga kirish uchun tugmani bosing."
MENU_EMPTY = "Sizning classlaringizda hozircha Telegram guruh yo'q."
NOT_YOUR_GROUP = "Bu guruh sizning classlaringiz orasida yo'q. Ro'yxat: /guruhlar"
ALREADY_IN = "✅ Siz <b>{group}</b> guruhidasiz."
INVITE = (
    "🔗 <b>{group}</b> guruhiga bir martalik link:\n{link}\n\n"
    "Faqat siz uchun, bir marta ishlaydi va {minutes} daqiqada eskiradi."
)
INVITE_FAILED = "Hozir link chiqarib bo'lmadi. Birozdan keyin qayta urinib ko'ring."
LOCKED_GROUP_DEBT = (
    "🔒 <b>{group}</b>: oylik to'lov qilinmagani uchun guruh yopiq.\n\n"
    "To'lov qilinganidan keyin shu bot orqali qayta qo'shilishingiz mumkin."
)
LOCKED_GROUP_ADMIN = "🔒 <b>{group}</b>: akkauntingiz muzlatilgan. Administratorga murojaat qiling."

# ── Coming out of a group, and back ──────────────────────────────────────────
REMOVED_DEBT = (
    "❗ Oylik to'lov qilinmaganligi sababli siz quyidagi guruhlardan chiqarildingiz:\n{groups}\n\n"
    "To'lov qilinganidan keyin shu bot orqali qayta qo'shilishingiz mumkin."
)
REMOVED_FROZEN = (
    "Akkauntingiz muzlatildi, shuning uchun quyidagi guruhlardan chiqarildingiz:\n{groups}\n\n"
    "Administratorga murojaat qiling."
)
REMOVED_NOT_IN_CLASS = "Classdan chiqqaningiz uchun uning Telegram guruhidan ham chiqarildingiz:\n{groups}"
REMOVED_MISMATCH = (
    "Bir martalik linkingizni boshqa odam ochdi, u guruhdan chiqarildi. "
    "Yangi link uchun: /guruhlar. Linkni hech kimga bermang."
)
REMOVED_MANUAL = "Administrator sizni quyidagi guruhdan chiqardi:\n{groups}"
UNFROZEN = "🔓 Akkauntingiz faollashdi! Guruhlaringizga qaytishingiz mumkin:"

# ── Payments ─────────────────────────────────────────────────────────────────
PAYMENT = "✅ <b>{group}</b> uchun {amount} so'm to'lov qabul qilindi."
PAYMENT_NO_GROUP = "✅ {amount} so'm to'lov qabul qilindi."
PAYMENT_NO_DEBT = "Qarzingiz qolmadi."
PAYMENT_DEBT_LEFT = "Qolgan qarz: {debt} so'm."

# ── The one-off note posted into every class group ───────────────────────────
ANNOUNCE = (
    "📢 <b>Guruh a'zolari!</b>\n\n"
    "MasterSAT botiga kiring va MasterSAT login/parolingiz bilan ro'yxatdan o'ting. "
    "Guruhlaringiz, to'lov xabarlari va yangi linklar shu botda bo'ladi."
)
ANNOUNCE_BUTTON = "🤖 Botga kirish"


def som(amount) -> str:
    """500000 → "500 000": so'm the way a receipt writes it."""
    return f"{int(amount):,}".replace(",", " ")


def group_list(names) -> str:
    """One bullet per class, escaped for the HTML message it lands in."""
    return "\n".join(f"• {esc(name)}" for name in names)
```

- [ ] **Step 5: Grow the test fake**

In `backend/classes/tests_telegram_group.py`, class `FakeTelegram`:

At the end of `__init__`, add:

```python
        self.deleted: list[tuple[str, int]] = []
        self.answered: list[str] = []
        #: Parallel to ``messages``: the inline keyboard each one carried, or None.
        self.markups: list = []
        self.delete_should_fail = False
        self.send_should_fail = False
```

Replace `send_message` with the version below, and add the two new methods after it:

```python
    def send_message(self, chat_id, text, reply_markup=None):
        if self.send_should_fail:
            # A network failure: no error_code, as `_call` reports a timeout.
            return tg.api.TgResult(False, description="URLError: timed out")
        self.messages.append((str(chat_id), text))
        self.markups.append(reply_markup)
        return tg.api.TgResult(True, {})

    def delete_message(self, chat_id, message_id):
        if self.delete_should_fail:
            return tg.api.TgResult(False, error_code=400, description="message can't be deleted")
        self.deleted.append((str(chat_id), int(message_id)))
        return tg.api.TgResult(True, True)

    def answer_callback_query(self, callback_query_id, text=""):
        self.answered.append(str(callback_query_id))
        return tg.api.TgResult(True, True)
```

In `patches()`, add the two new names to the `mock.patch.multiple(...)` call:

```python
            delete_message=self.delete_message,
            answer_callback_query=self.answer_callback_query,
```

- [ ] **Step 6: Run the new tests and the existing suite**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK` (the 5 new tests plus the 72 existing ones)

- [ ] **Step 7: Commit**

```bash
git add backend/classes/telegram_group_api.py backend/classes/telegram_texts.py backend/classes/tests_telegram_group.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): inline keyboards, deleteMessage, answerCallbackQuery and the bot's Uzbek texts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Identified rows are managed; an admin's removal is forced

**Files:**
- Modify: `backend/classes/models_telegram.py` (`ClassroomTelegramMember`: field after `observed_arrival_at`, property after `is_watched`)
- Create (generated): `backend/classes/migrations/0056_classroomtelegrammember_identified_at.py`
- Modify: `backend/classes/telegram_group.py` (`may_remove`, `remove_member`)
- Test: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Consumes: `FakeTelegram`, `TelegramGroupBase`, `CHAT` from `classes.tests_telegram_group`
- Produces:
  - `ClassroomTelegramMember.identified_at: DateTimeField(null=True)`
  - `ClassroomTelegramMember.is_managed -> bool`
  - `tg.remove_member(row, *, reason, notify_student=True, chat_status=None, force=False) -> bool`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_bot.py` (add the imports to the top of the file):

```python
from django.utils import timezone

from classes import telegram_group as tg
from classes.models_telegram import ClassroomTelegramMember
from classes.tests_telegram_group import CHAT, TelegramGroupBase

JOINED = ClassroomTelegramMember.STATUS_JOINED
MANUAL = ClassroomTelegramMember.REASON_MANUAL


class ManagedRowTests(TelegramGroupBase):
    """Rule 3 now has two ways in: an arrival the bot watched, or a sign-in that found the
    student already inside (decision 3). An admin's removal is forced past rules 1 and 3."""

    def member(self, user, tg_id, *, identified=False, status="member"):
        self.tg.join(tg_id, status=status)
        return ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=user, telegram_user_id=tg_id, status=JOINED,
            joined_at=timezone.now(), identified_at=timezone.now() if identified else None,
        )

    def freeze(self, user):
        with self.captureOnCommitCallbacks(execute=True):
            user.is_frozen = True
            user.save(update_fields=["is_frozen"])

    def test_an_identified_member_comes_out_on_freeze(self):
        self.member(self.student, 1001, identified=True)
        self.freeze(self.student)
        self.assertIn((CHAT, 1001), self.tg.kicked)
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_REMOVED)

    def test_an_unidentified_old_member_still_stays(self):
        self.member(self.student, 1001)
        self.freeze(self.student)
        self.assertEqual(self.tg.kicked, [])

    def test_force_removes_an_old_member(self):
        row = self.member(self.student, 1001)
        self.assertTrue(tg.remove_member(row, reason=MANUAL, force=True))
        self.assertIn((CHAT, 1001), self.tg.kicked)

    def test_force_removes_an_account_matching_nobody(self):
        self.tg.join(4242)
        row = ClassroomTelegramMember.objects.create(
            classroom=self.classroom, telegram_user_id=4242, status=JOINED
        )
        self.assertTrue(tg.remove_member(row, reason=MANUAL, force=True))
        self.assertIn((CHAT, 4242), self.tg.kicked)

    def test_force_never_removes_a_chat_admin(self):
        row = self.member(self.student, 1001, status="administrator")
        self.assertFalse(tg.remove_member(row, reason=MANUAL, force=True))
        self.assertEqual(self.tg.kicked, [])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot.ManagedRowTests --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR, `TypeError: ClassroomTelegramMember() got unexpected keyword arguments: 'identified_at'`

- [ ] **Step 3: Add the field and the property**

In `backend/classes/models_telegram.py`, directly after the `observed_arrival_at` field:

```python
    #: When the student signed in to the bot and the bot found them already inside the group —
    #: the second way somebody comes under the bot's management (the first is an arrival it
    #: watched). The owner's decision of 2026-10-16: members from before the bot are asked to
    #: sign in, and that identifies them. Never set for somebody frozen at that moment: an old
    #: debtor is the admin's to remove by hand, once.
    identified_at = models.DateTimeField(null=True, blank=True)
```

Directly after the `is_watched` property:

```python
    @property
    def is_managed(self) -> bool:
        """May the bot act on this row on its own? Watched arriving, or identified by signing in."""
        return self.observed_arrival_at is not None or self.identified_at is not None
```

- [ ] **Step 4: Generate the migration**

Run (from `backend/`): `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py makemigrations classes -n classroomtelegrammember_identified_at`
Expected: `classes/migrations/0056_classroomtelegrammember_identified_at.py` with one `AddField` (`null=True, blank=True`) and nothing else. If it contains any other operation, stop and investigate. It must not.

- [ ] **Step 5: Use `is_managed` and add `force`**

In `backend/classes/telegram_group.py`:

In `may_remove`, replace

```python
    if not row.is_watched:
        return False
```

with

```python
    if not row.is_managed:
        return False
```

In `remove_member`, change the signature to

```python
def remove_member(
    row: ClassroomTelegramMember,
    *,
    reason: str,
    notify_student: bool = True,
    chat_status: Optional[str] = None,
    force: bool = False,
) -> bool:
```

and add to its docstring: `` ``force`` is an admin removing somebody by hand from /ops: it skips rules 1 and 3 (unknown accounts, people from before the bot), never rule 2 (chat admins). ``

Replace `    if not row.is_watched:` (the rule-3 block) with `    if not force and not row.is_managed:`.

Replace `    if not may_enforce_against(row.user, chat_status):` with:

```python
    if chat_status in api.CHAT_ADMIN_STATUSES or (
        not force and not may_enforce_against(row.user, chat_status)
    ):
```

- [ ] **Step 6: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/classes/models_telegram.py backend/classes/migrations/0056_classroomtelegrammember_identified_at.py backend/classes/telegram_group.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): a member identified by signing in is managed; an admin's removal is forced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Flags, the student's classes, identification, and the bot link on the class page

**Files:**
- Modify: `backend/config/settings.py` (after `CLASSROOM_TELEGRAM_AUDIT_BATCH`, ~line 146)
- Modify: `backend/classes/telegram_group.py` (new functions after `start_link`; `issue_invite`; `student_state`)
- Test: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Consumes: `is_managed`, `identified_at` (Task 2)
- Produces:
  - `tg.bot_login_enabled() -> bool`
  - `tg.bot_start_url() -> str`
  - `tg.student_classrooms(user) -> list[Classroom]`
  - `tg.GROUP_IN = "in"`, `tg.GROUP_OUT = "out"`
  - `tg.identify_memberships(user) -> dict[int, str]` (classroom pk → GROUP_IN/GROUP_OUT)
  - `tg.issue_invite(*, user, classroom, send_dm=True)`
  - `student_state(...)["bot_url"]`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_bot.py` (add `from django.contrib.auth import get_user_model`, `from django.test import override_settings`, `from classes.models import Classroom, ClassroomMembership`, `from classes.models_telegram import ClassroomTelegramEvent`, and `User = get_user_model()` at the top):

```python
class IdentifyTests(TelegramGroupBase):
    def test_a_student_found_in_the_group_is_identified(self):
        self.tg.join(1001)
        self.assertEqual(tg.identify_memberships(self.student), {self.classroom.pk: tg.GROUP_IN})
        row = self.row(self.student)
        self.assertEqual(row.status, JOINED)
        self.assertIsNotNone(row.identified_at)
        self.assertTrue(row.is_managed)

    def test_a_frozen_student_is_found_but_left_for_the_admin(self):
        self.tg.join(1001)
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.student.refresh_from_db()
        self.assertEqual(tg.identify_memberships(self.student), {self.classroom.pk: tg.GROUP_IN})
        self.assertIsNone(self.row(self.student).identified_at)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(user=self.student, detail__contains="frozen").exists()
        )

    def test_a_student_outside_the_group_is_out_and_gets_no_row(self):
        self.assertEqual(tg.identify_memberships(self.student), {self.classroom.pk: tg.GROUP_OUT})
        self.assertIsNone(self.row(self.student))

    def test_only_active_student_seats_in_classes_with_a_group_count(self):
        no_group = Classroom.objects.create(
            name="No group", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(classroom=no_group, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        left = Classroom.objects.create(
            name="Left", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin, telegram_chat_id="-100777",
        )
        ClassroomMembership.objects.create(
            classroom=left, user=self.student, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.assertEqual([c.pk for c in tg.student_classrooms(self.student)], [self.classroom.pk])
        self.assertEqual(tg.student_classrooms(self.teacher), [])

    @override_settings(CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=True)
    def test_the_class_page_gets_the_bot_link_when_switched_on(self):
        state = tg.student_state(user=self.student, classroom=self.classroom)
        self.assertEqual(state["bot_url"], "https://t.me/MasterSATTestBot?start=login")

    def test_switched_off_the_class_page_has_no_bot_link(self):
        self.assertEqual(tg.student_state(user=self.student, classroom=self.classroom)["bot_url"], "")

    def test_an_invite_can_be_minted_without_the_english_courtesy_copy(self):
        tg.issue_invite(user=self.student, classroom=self.classroom, send_dm=False)
        self.assertEqual(len(self.tg.links), 1)
        self.assertEqual(self.tg.messages, [])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot.IdentifyTests --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR, `AttributeError: module 'classes.telegram_group' has no attribute 'identify_memberships'`

- [ ] **Step 3: Add the settings**

In `backend/config/settings.py`, after the `CLASSROOM_TELEGRAM_AUDIT_BATCH` line:

```python
# The class bot's own sign-in (login + password in the chat) and its groups menu (plan
# 2026-10-16). Off: the bot keeps its old /start reply and the class page keeps the join dialog.
CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED = os.getenv('CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED', 'False').lower() == 'true'
# From when lc-up payments are announced in the bot (ISO date-time, e.g.
# 2026-10-20T00:00:00+05:00). Empty = off. Only payments lc-up created after this moment are
# announced, so switching it on never replays the history.
CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM = os.getenv('CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM', '').strip()
```

- [ ] **Step 4: Add the functions**

In `backend/classes/telegram_group.py`, directly after `start_link`:

```python
# ── The bot's own sign-in (plan 2026-10-16) ──────────────────────────────────


def bot_login_enabled() -> bool:
    """The bot's sign-in, groups menu and unfreeze note. Off keeps the 2026-09 flow untouched."""
    return bool(getattr(settings, "CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED", False)) and api.is_configured()


def bot_start_url() -> str:
    """Where the class page sends a student: the bot, which then asks for their login. Empty
    when the bot cannot be reached — the caller shows no button rather than a broken one."""
    username = api.bot_username()
    return f"https://t.me/{username}?start=login" if username else ""


def student_classrooms(user) -> list[Classroom]:
    """The active classes this person sits in as a student, whose group the bot runs."""
    ids = list(
        ClassroomMembership.objects.filter(user=user, role=ClassroomMembership.ROLE_STUDENT)
        .exclude(status=ClassroomMembership.STATUS_REMOVED)
        .values_list("classroom_id", flat=True)
    )
    return list(
        Classroom.objects.filter(pk__in=ids, is_active=True)
        .exclude(telegram_chat_id="")
        .exclude(telegram_chat_id=None)
        .order_by("name", "pk")
    )


GROUP_IN = "in"
GROUP_OUT = "out"


def identify_memberships(user) -> dict[int, str]:
    """Which of this student's class groups are they inside right now? Asked of Telegram, one
    ``getChatMember`` per class.

    Finding them inside is decision 3's door into management: a member from before the bot
    who signs in becomes ``identified_at`` and is the bot's from then on. Except somebody frozen
    at that moment — an old debtor stays the admin's to remove by hand, and is written down so
    the admin can see them.
    """
    telegram_id = bot_id_for(user)
    found: dict[int, str] = {}
    if not telegram_id:
        return found
    now = timezone.now()
    frozen = bool(getattr(user, "is_frozen", False))
    for classroom in student_classrooms(user):
        probe = api.get_chat_member(chat_id_for(classroom), int(telegram_id))
        status = str((probe.result or {}).get("status") or "") if probe.ok else ""
        if status not in api.IN_CHAT_STATUSES:
            found[classroom.pk] = GROUP_OUT
            continue
        found[classroom.pk] = GROUP_IN
        row = _row_for_user(classroom, user)
        first_sighting = row.status != ClassroomTelegramMember.STATUS_JOINED
        newly_identified = row.identified_at is None and not frozen
        row.status = ClassroomTelegramMember.STATUS_JOINED
        row.joined_at = row.joined_at or now
        row.last_checked_at = now
        if newly_identified:
            row.identified_at = now
        row.save()
        if newly_identified or (first_sighting and frozen):
            log_event(
                classroom=classroom,
                action=ClassroomTelegramEvent.ACTION_RECONCILED,
                user=user,
                telegram_user_id=int(telegram_id),
                detail=(
                    "identified by signing in to the bot"
                    if newly_identified
                    else "in the group while frozen; left for an admin to remove"
                ),
            )
    return found
```

In `issue_invite`, change the signature to `def issue_invite(*, user, classroom: Classroom, send_dm: bool = True) -> dict:`. Wrap the final `api.send_message(...)` courtesy copy (just before `return {"already_member": False, ...}`) in `if send_dm:`, and put this comment above it: `# The bot's own button sends its Uzbek message instead (plan 2026-10-16).`

In `student_state`, add to the returned dict:

```python
        # The bot's sign-in link (plan 2026-10-16): the class page's button opens the bot, which
        # asks for the login. Empty while that is switched off — the page keeps the join dialog.
        "bot_url": bot_start_url() if bot_login_enabled() and is_managed(classroom) else "",
```

- [ ] **Step 5: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/config/settings.py backend/classes/telegram_group.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): identify old members by sign-in; bot link on the class page behind a flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The sign-in conversation and the groups menu

**Files:**
- Create: `backend/classes/telegram_bot.py`
- Modify: `backend/classes/views_telegram.py` (`post`, `_handle_message`)
- Test: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Consumes:
  - `tg.bot_login_enabled`, `tg.student_classrooms`, `tg.identify_memberships`, `tg.GROUP_IN` (Task 3)
  - `api.delete_message`, `send_message(reply_markup=)`, all of `T` (Task 1)
  - `users.backends.EmailOrUsernameModelBackend`, `users.backends._phone_username`, `users.models.SecurityAuditEvent`
- Produces:
  - `telegram_bot.handle_private_message(message: dict) -> str` (outcome tag)
  - `telegram_bot.menu_markup(user) -> dict | None`
  - `telegram_bot.send_menu(chat_id, user) -> None`
  - `MAX_FAILURES`, `LOCK_SECONDS`, `STATE_SECONDS`
  - Cache keys: `tgbot:state:<tg>`, `tgbot:fail:tg:<tg>`, `tgbot:fail:login:<login>`, `tgbot:lock:tg:<tg>`, `tgbot:lock:login:<login>`, `tgbot:update:<update_id>`
  - Audit `event_type`s: `telegram_bot_login`, `telegram_bot_login_failed`, `telegram_bot_login_locked`, `telegram_bot_logout`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_bot.py` (add `from django.core.cache import cache` and `from users.models import SecurityAuditEvent` to the imports):

```python
@override_settings(CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=True)
class BotBase(TelegramGroupBase):
    URL = "/api/classes/telegram/webhook/"
    NEW_TG = 5005
    PASSWORD = "Pa55word!x"

    def setUp(self):
        super().setUp()
        self.newbie = User.objects.create_user(
            "newbie@t.com", self.PASSWORD, username="newbie", first_name="Nodir"
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.newbie, role=ClassroomMembership.ROLE_STUDENT
        )
        self._update = 0
        self._message = 100

    def post(self, update: dict) -> None:
        self._update += 1
        update.setdefault("update_id", self._update)
        self.client.force_authenticate(user=None)
        r = self.client.post(
            self.URL, update, format="json", HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t"
        )
        self.assertEqual(r.status_code, 200)

    def say(self, text: str, tg_id: int = NEW_TG) -> int:
        self._message += 1
        self.post({"message": {
            "message_id": self._message,
            "chat": {"id": tg_id, "type": "private"},
            "from": {"id": tg_id, "first_name": "N"},
            "text": text,
        }})
        return self._message

    def sign_in(self, login="newbie@t.com", password=None, tg_id: int = NEW_TG) -> int:
        self.say("/start", tg_id)
        self.say(login, tg_id)
        return self.say(password or self.PASSWORD, tg_id)

    def last(self, tg_id: int = NEW_TG) -> str:
        sent = [body for chat, body in self.tg.messages if chat == str(tg_id)]
        return sent[-1] if sent else ""


class SignInTests(BotBase):
    def test_start_asks_for_the_login(self):
        self.say("/start")
        self.assertEqual(self.last(), T.ASK_LOGIN)

    def test_the_right_password_connects_the_account_and_opens_the_menu(self):
        password_message = self.sign_in()
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)
        self.assertIn((str(self.NEW_TG), password_message), self.tg.deleted)
        keyboard = [m for m in self.tg.markups if m][-1]["inline_keyboard"]
        self.assertEqual(keyboard[0][0]["text"], "➕ Junior G15 English")
        self.assertEqual(keyboard[0][0]["callback_data"], f"g:{self.classroom.pk}")
        self.assertTrue(
            SecurityAuditEvent.objects.filter(user=self.newbie, event_type="telegram_bot_login").exists()
        )

    def test_a_phone_login_finds_the_account_named_after_it(self):
        phone = User.objects.create_user("p@t.com", self.PASSWORD, username="998901234567")
        self.sign_in(login="+998 90 123 45 67")
        phone.refresh_from_db()
        self.assertEqual(phone.telegram_bot_user_id, self.NEW_TG)

    def test_a_wrong_password_is_counted_and_the_login_asked_again(self):
        self.sign_in(password="nope")
        self.assertEqual(self.last(), T.WRONG.format(n=1, max=5))
        self.newbie.refresh_from_db()
        self.assertIsNone(self.newbie.telegram_bot_user_id)
        self.say("newbie@t.com")
        self.assertEqual(self.last(), T.ASK_PASSWORD)

    def test_the_password_is_deleted_even_when_wrong(self):
        message_id = self.sign_in(password="nope")
        self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)

    def test_five_wrong_passwords_lock_for_fifteen_minutes(self):
        for _ in range(5):
            self.sign_in(password="nope")
        self.assertEqual(self.last(), T.LOCKED.format(minutes=15))
        self.sign_in()  # the right one, too soon
        self.assertEqual(self.last(), T.LOCKED.format(minutes=15))
        self.newbie.refresh_from_db()
        self.assertIsNone(self.newbie.telegram_bot_user_id)
        # The lock is a cache key that lives 15 minutes; its lapse is the key going away.
        cache.delete_many([f"tgbot:lock:tg:{self.NEW_TG}", "tgbot:lock:login:newbie@t.com"])
        self.sign_in()
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)

    def test_the_lock_follows_the_login_to_another_telegram(self):
        for _ in range(5):
            self.sign_in(password="nope")
        self.sign_in(tg_id=6006)
        self.assertEqual(self.last(6006), T.LOCKED.format(minutes=15))

    def test_an_account_with_no_password_yet_is_sent_to_the_site(self):
        self.newbie.set_unusable_password()
        self.newbie.save()
        self.sign_in()
        self.assertEqual(self.last(), T.NO_PASSWORD_YET)

    def test_a_teacher_is_turned_away(self):
        self.sign_in(login="tg_teacher@t.com", password="secret123")
        self.assertEqual(self.last(), T.NOT_A_STUDENT)
        self.teacher.refresh_from_db()
        self.assertIsNone(self.teacher.telegram_bot_user_id)

    def test_a_failed_delete_asks_the_student_to_delete_it(self):
        self.tg.delete_should_fail = True
        self.sign_in()
        self.assertIn(T.DELETE_FAILED, [body for _, body in self.tg.messages])

    def test_the_password_never_reaches_a_log_or_the_audit_trail(self):
        with self.assertLogs("classes", level="DEBUG") as logs:
            self.sign_in(password="nope-wrong-1")
            self.sign_in()
        joined = "\n".join(logs.output)
        self.assertNotIn(self.PASSWORD, joined)
        self.assertNotIn("nope-wrong-1", joined)
        for event in SecurityAuditEvent.objects.filter(user=self.newbie):
            self.assertNotIn(self.PASSWORD, json.dumps(event.detail))
            self.assertNotIn("nope-wrong-1", json.dumps(event.detail))

    def test_a_repeated_update_is_handled_once(self):
        self.say("/start")
        self.say("newbie@t.com")
        update = {"update_id": 9000, "message": {
            "message_id": 1, "chat": {"id": self.NEW_TG, "type": "private"},
            "from": {"id": self.NEW_TG}, "text": "nope",
        }}
        self.post(dict(update))
        self.post(dict(update))
        self.assertEqual(cache.get(f"tgbot:fail:tg:{self.NEW_TG}"), 1)

    def test_a_signed_in_student_gets_the_menu_on_start(self):
        self.say("/start", tg_id=1001)  # self.student already holds 1001
        self.assertIsNotNone(self.tg.markups[-1])
        self.assertEqual(self.tg.messages[-1][1], T.MENU_TITLE)

    def test_logout_disconnects_the_telegram(self):
        self.say("/chiqish", tg_id=1001)
        self.student.refresh_from_db()
        self.assertIsNone(self.student.telegram_bot_user_id)
        self.assertEqual(self.last(1001), T.LOGGED_OUT)

    @override_settings(CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=False)
    def test_switched_off_the_bot_keeps_its_old_reply(self):
        self.say("/start")
        self.assertIn("MasterSAT class bot", self.last())
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot.SignInTests --settings=config.settings_test_nomigrations -v 1`
Expected: FAIL. `test_start_asks_for_the_login` fails because the old English `/start` reply comes back.

- [ ] **Step 3: Create the conversation module**

Create `backend/classes/telegram_bot.py`:

```python
"""The class bot's private chat (plan 2026-10-16): sign in with the MasterSAT login and
password, then a menu of the student's class groups, one button each.

The owner chose the password in the chat over a sign-in form. So the password message is
deleted the instant it arrives, it is never logged or stored, and five wrong tries lock both
the Telegram account and the login for fifteen minutes. Only a real password works: the
first-time "last 4 digits" code is guessable by anyone who knows the phone, and that backend
(``lcup.auth_backend``) is never consulted here.

Conversation state and the lockouts live in the cache, which is Redis in production. A
restart losing a half-typed sign-in costs the student one /start.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q

from access import constants as acc_const
from users.backends import EmailOrUsernameModelBackend, _phone_username
from users.models import SecurityAuditEvent

from . import telegram_group as tg
from . import telegram_texts as T

logger = logging.getLogger("classes.telegram_bot")

User = get_user_model()

MAX_FAILURES = 5
LOCK_SECONDS = 15 * 60
#: How long the bot waits for the next answer in a sign-in. Long enough to find the password.
STATE_SECONDS = 10 * 60

STEP_LOGIN = "login"
STEP_PASSWORD = "password"


# ── Cache keys ───────────────────────────────────────────────────────────────


def _state_key(tg_id: int) -> str:
    return f"tgbot:state:{tg_id}"


def _fail_key(kind: str, value) -> str:
    return f"tgbot:fail:{kind}:{value}"


def _lock_key(kind: str, value) -> str:
    return f"tgbot:lock:{kind}:{value}"


def _login_key(login: str) -> str:
    """One spelling per account, so "+998 90…" and "99890…" share a lock."""
    return (_phone_username(login) or login).strip().lower()[:150]


# ── Lockouts ─────────────────────────────────────────────────────────────────


def _locked(tg_id: int, login_key: str) -> bool:
    return bool(cache.get(_lock_key("tg", tg_id)) or (login_key and cache.get(_lock_key("login", login_key))))


def _count_failure(tg_id: int, login_key: str) -> int:
    """Count one wrong try against the Telegram account and the login; lock either at five.
    Returns this Telegram account's count, which is the number the student is shown."""
    shown = 0
    for kind, value in (("tg", tg_id), ("login", login_key)):
        if not value:
            continue
        key = _fail_key(kind, value)
        cache.add(key, 0, timeout=LOCK_SECONDS)
        try:
            count = cache.incr(key)
        except ValueError:  # expired between add and incr
            cache.set(key, 1, timeout=LOCK_SECONDS)
            count = 1
        if count >= MAX_FAILURES:
            cache.set(_lock_key(kind, value), 1, timeout=LOCK_SECONDS)
            cache.delete(key)
        if kind == "tg":
            shown = count
    return shown


def _clear_failures(tg_id: int, login_key: str) -> None:
    cache.delete_many([_fail_key("tg", tg_id), _fail_key("login", login_key)])


# ── Accounts ─────────────────────────────────────────────────────────────────


def _account_for(login: str):
    """The account a login names, the way the site's own sign-in finds it — used only to tell
    "no password set yet" apart from "wrong password", and to put a failure on the right
    account's audit trail."""
    login = login.strip()
    if not login:
        return None
    user = User.objects.filter(Q(username__iexact=login) | Q(email__iexact=login)).order_by("id").first()
    if user is None:
        phone = _phone_username(login)
        if phone:
            user = User.objects.filter(username=phone).first()
    return user


def _audit(user, event_type: str, tg_id: int, *, severity: str = SecurityAuditEvent.SEVERITY_INFO) -> None:
    if user is None:
        return
    try:
        SecurityAuditEvent.objects.create(
            user=user, event_type=event_type, severity=severity,
            detail={"telegram_user_id": tg_id, "via": "class_bot"},
        )
    except Exception:
        logger.exception("telegram_bot audit failed event=%s", event_type)


def _send(chat_id, text: str, markup: dict | None = None) -> None:
    tg.api.send_message(chat_id, text, reply_markup=markup)


# ── The menu ─────────────────────────────────────────────────────────────────


def menu_markup(user) -> dict | None:
    """One button per class group: ✅ inside, ➕ not yet, 🔒 frozen. None when there are none.

    Building it asks Telegram where the student is, which is also what identifies an old
    member (``identify_memberships``) — every time they open the menu, not only at sign-in.
    """
    classrooms = tg.student_classrooms(user)
    if not classrooms:
        return None
    where = tg.identify_memberships(user)
    frozen = bool(getattr(user, "is_frozen", False))
    rows = []
    for classroom in classrooms:
        if frozen:
            mark = "🔒"
        elif where.get(classroom.pk) == tg.GROUP_IN:
            mark = "✅"
        else:
            mark = "➕"
        # Button text is plain text, not HTML: no escaping. Telegram caps it at 64 bytes-ish.
        rows.append([{"text": f"{mark} {classroom.name}"[:60], "callback_data": f"g:{classroom.pk}"}])
    return {"inline_keyboard": rows}


def send_menu(chat_id, user) -> None:
    markup = menu_markup(user)
    if markup is None:
        _send(chat_id, T.MENU_EMPTY)
        return
    _send(chat_id, T.MENU_TITLE, markup)


# ── The conversation ─────────────────────────────────────────────────────────


def handle_private_message(message: dict) -> str:
    """One message in a private chat with the bot. Returns an outcome tag for the log — the
    tag, never the text: in the sign-in step the text is a password."""
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    frm = message.get("from") if isinstance(message.get("from"), dict) else {}
    chat_id = chat.get("id")
    try:
        tg_id = int(frm.get("id") or 0)
    except (TypeError, ValueError):
        tg_id = 0
    if chat_id is None or not tg_id or frm.get("is_bot"):
        return "ignored"

    text = str(message.get("text") or "").strip()
    command = text.split()[0].lower().split("@", 1)[0] if text.startswith("/") else ""
    user = User.objects.filter(telegram_bot_user_id=tg_id).first()

    if command == "/start":
        if user is not None:
            send_menu(chat_id, user)
            return "menu"
        cache.set(_state_key(tg_id), {"step": STEP_LOGIN}, STATE_SECONDS)
        _send(chat_id, T.ASK_LOGIN)
        return "ask_login"

    if command == "/chiqish":
        cache.delete(_state_key(tg_id))
        if user is not None:
            user.telegram_bot_user_id = None
            user.save(update_fields=["telegram_bot_user_id"])
            _audit(user, "telegram_bot_logout", tg_id)
        _send(chat_id, T.LOGGED_OUT)
        return "logged_out"

    if command:  # /guruhlar, or anything else that looks like a command
        if user is None:
            _send(chat_id, T.NOT_BOUND)
            return "not_bound"
        send_menu(chat_id, user)
        return "menu"

    state = cache.get(_state_key(tg_id)) or {}
    if state.get("step") == STEP_PASSWORD:
        return _check_password(chat_id, tg_id, message, str(state.get("login") or ""))
    if state.get("step") == STEP_LOGIN:
        if not text:
            return "ignored"
        cache.set(_state_key(tg_id), {"step": STEP_PASSWORD, "login": text[:150]}, STATE_SECONDS)
        _send(chat_id, T.ASK_PASSWORD)
        return "ask_password"

    if user is not None:
        send_menu(chat_id, user)
        return "menu"
    _send(chat_id, T.NOT_BOUND)
    return "not_bound"


def _check_password(chat_id, tg_id: int, message: dict, login: str) -> str:
    # First, before anything that could fail: the password leaves the chat.
    deleted = tg.api.delete_message(chat_id, message.get("message_id"))
    cache.delete(_state_key(tg_id))
    if not deleted.ok:
        _send(chat_id, T.DELETE_FAILED)

    key = _login_key(login)
    if _locked(tg_id, key):
        _send(chat_id, T.LOCKED.format(minutes=LOCK_SECONDS // 60))
        return "locked"

    user = EmailOrUsernameModelBackend().authenticate(
        None, username=login, password=str(message.get("text") or "")
    )
    if user is None:
        known = _account_for(login)
        count = _count_failure(tg_id, key)
        if known is not None and not known.has_usable_password():
            _send(chat_id, T.NO_PASSWORD_YET)
            return "no_password"
        _audit(known, "telegram_bot_login_failed", tg_id, severity=SecurityAuditEvent.SEVERITY_WARNING)
        if _locked(tg_id, key):
            _audit(known, "telegram_bot_login_locked", tg_id, severity=SecurityAuditEvent.SEVERITY_WARNING)
            _send(chat_id, T.LOCKED.format(minutes=LOCK_SECONDS // 60))
            return "locked"
        cache.set(_state_key(tg_id), {"step": STEP_LOGIN}, STATE_SECONDS)
        _send(chat_id, T.WRONG.format(n=count, max=MAX_FAILURES))
        return "wrong"

    if str(getattr(user, "role", "") or "").strip().lower() not in acc_const.LEARNER_ROLES:
        _send(chat_id, T.NOT_A_STUDENT)
        return "not_student"
    if User.objects.filter(telegram_bot_user_id=tg_id).exclude(pk=user.pk).exists():
        _send(chat_id, T.TG_TAKEN)
        return "taken"

    _clear_failures(tg_id, key)
    user.telegram_bot_user_id = tg_id
    user.save(update_fields=["telegram_bot_user_id"])
    _audit(user, "telegram_bot_login", tg_id)
    name = (f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username or "")
    _send(chat_id, T.WELCOME.format(name=tg.api.esc(name)))
    send_menu(chat_id, user)
    return "logged_in"
```

- [ ] **Step 4: Wire it into the webhook**

In `backend/classes/views_telegram.py`:

Add to the imports: `from django.core.cache import cache` and `from . import telegram_bot`.

Under the imports, add:

```python
#: Telegram re-sends an update it thinks we missed. A sign-in step handled twice would count
#: one wrong password as two, so each update is handled once.
UPDATE_SEEN_SECONDS = 24 * 3600
```

In `ClassroomTelegramWebhookView.post`, directly after `payload = request.data if ...`:

```python
        update_id = payload.get("update_id")
        if update_id is not None and not cache.add(
            f"tgbot:update:{update_id}", 1, timeout=UPDATE_SEEN_SECONDS
        ):
            return Response({"ok": True}, status=http.HTTP_200_OK)
```

In `_handle_message`, directly after `chat_id = chat.get("id")`:

```python
        if str(chat.get("type") or "") == "private" and tg.bot_login_enabled():
            # The tag only, never the text: in the sign-in step the text is a password.
            logger.info("telegram_bot message -> %s", telegram_bot.handle_private_message(message))
            return
```

- [ ] **Step 5: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/classes/telegram_bot.py backend/classes/views_telegram.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): sign in to the class bot with login + password; groups menu

The password message is deleted on arrival and never logged; 5 wrong tries lock the
Telegram account and the login for 15 minutes. Behind CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Button presses, the unfreeze menu, and the webhook's update list

**Files:**
- Modify: `backend/classes/telegram_bot.py` (append)
- Modify: `backend/classes/views_telegram.py` (`_dispatch`)
- Modify: `backend/classes/management/commands/set_classroom_bot_webhook.py` (`ALLOWED_UPDATES`)
- Test: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Consumes:
  - `menu_markup`, `_send` (Task 4)
  - `tg.issue_invite(send_dm=False)`, `tg.invite_ttl_minutes()`, `tg.TelegramGroupError` (Task 3)
  - `api.answer_callback_query` (Task 1)
- Produces:
  - `telegram_bot.handle_callback_query(callback: dict) -> str`
  - `telegram_bot.send_unfrozen_menu(user) -> bool`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_bot.py`:

```python
class MenuTests(BotBase):
    def press(self, data: str, tg_id: int = 1001) -> None:
        self.post({"callback_query": {
            "id": f"cq{self._update + 1}",
            "from": {"id": tg_id},
            "data": data,
            "message": {"message_id": 1, "chat": {"id": tg_id, "type": "private"}},
        }})

    def test_pressing_a_group_sends_a_one_time_link(self):
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(len(self.tg.links), 1)
        self.assertEqual(
            self.last(1001),
            T.INVITE.format(group="Junior G15 English", link=self.tg.links[0], minutes=30),
        )
        # One message, in Uzbek: the 2026-09 English courtesy copy is not sent as well.
        self.assertEqual(len([c for c, _ in self.tg.messages if c == "1001"]), 1)
        self.assertTrue(self.tg.answered)
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_PENDING)

    def test_pressing_a_group_you_are_in_mints_nothing(self):
        self.tg.join(1001)
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(self.tg.links, [])
        self.assertEqual(self.last(1001), T.ALREADY_IN.format(group="Junior G15 English"))

    def test_a_student_frozen_for_debt_sees_the_lock(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(self.tg.links, [])
        self.assertEqual(self.last(1001), T.LOCKED_GROUP_DEBT.format(group="Junior G15 English"))

    def test_an_admin_freeze_says_to_ask_the_admin(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="")
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(self.last(1001), T.LOCKED_GROUP_ADMIN.format(group="Junior G15 English"))

    def test_a_class_you_are_not_in_is_refused(self):
        other = Classroom.objects.create(
            name="Other", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin, telegram_chat_id="-100999",
        )
        self.press(f"g:{other.pk}")
        self.assertEqual(self.tg.links, [])
        self.assertEqual(self.last(1001), T.NOT_YOUR_GROUP)

    def test_an_unknown_telegram_is_asked_to_sign_in(self):
        self.press(f"g:{self.classroom.pk}", tg_id=7777)
        self.assertEqual(self.last(7777), T.NOT_BOUND)

    def test_the_menu_marks_each_group(self):
        self.tg.join(1001)
        self.say("/guruhlar", tg_id=1001)
        self.assertEqual(self.tg.markups[-1]["inline_keyboard"][0][0]["text"], "✅ Junior G15 English")

    def test_a_frozen_menu_shows_locks(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.say("/guruhlar", tg_id=1001)
        self.assertEqual(self.tg.markups[-1]["inline_keyboard"][0][0]["text"], "🔒 Junior G15 English")

    def test_the_unfrozen_menu_offers_every_group(self):
        from classes import telegram_bot

        self.assertTrue(telegram_bot.send_unfrozen_menu(self.student))
        self.assertEqual(self.last(1001), T.UNFROZEN)
        self.assertEqual(self.tg.markups[-1]["inline_keyboard"][0][0]["text"], "➕ Junior G15 English")

    def test_the_webhook_asks_telegram_for_button_presses(self):
        from classes.management.commands.set_classroom_bot_webhook import ALLOWED_UPDATES

        self.assertIn("callback_query", ALLOWED_UPDATES)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot.MenuTests --settings=config.settings_test_nomigrations -v 1`
Expected: FAIL/ERROR. Presses produce no message, and `send_unfrozen_menu` does not exist.

- [ ] **Step 3: Append the handlers to `telegram_bot.py`**

```python
# ── Button presses ───────────────────────────────────────────────────────────


def handle_callback_query(callback: dict) -> str:
    """A press on a menu button: ``g:<classroom pk>`` → this student's one-time invite."""
    frm = callback.get("from") if isinstance(callback.get("from"), dict) else {}
    try:
        tg_id = int(frm.get("id") or 0)
    except (TypeError, ValueError):
        tg_id = 0
    message = callback.get("message") if isinstance(callback.get("message"), dict) else {}
    chat_id = (message.get("chat") or {}).get("id") or tg_id
    data = str(callback.get("data") or "")
    # Always, and first: Telegram spins the button until this arrives.
    tg.api.answer_callback_query(str(callback.get("id") or ""))
    if not tg_id:
        return "ignored"

    user = User.objects.filter(telegram_bot_user_id=tg_id).first()
    if user is None:
        _send(chat_id, T.NOT_BOUND)
        return "not_bound"
    if not data.startswith("g:") or not data[2:].isdigit():
        return "ignored"
    classroom = next((c for c in tg.student_classrooms(user) if c.pk == int(data[2:])), None)
    if classroom is None:
        _send(chat_id, T.NOT_YOUR_GROUP)
        return "not_member"

    group = tg.api.esc(classroom.name)
    if getattr(user, "is_frozen", False):
        from users.audience import FROZEN_LCUP_DEBT

        debt = str(getattr(user, "frozen_reason", "") or "") == FROZEN_LCUP_DEBT
        _send(chat_id, (T.LOCKED_GROUP_DEBT if debt else T.LOCKED_GROUP_ADMIN).format(group=group))
        return "locked"
    try:
        issued = tg.issue_invite(user=user, classroom=classroom, send_dm=False)
    except tg.TelegramGroupError:
        _send(chat_id, T.INVITE_FAILED)
        return "error"
    if issued["already_member"]:
        _send(chat_id, T.ALREADY_IN.format(group=group))
        return "already_in"
    _send(chat_id, T.INVITE.format(group=group, link=issued["invite_link"], minutes=tg.invite_ttl_minutes()))
    return "invite"


def send_unfrozen_menu(user) -> bool:
    """A freeze lifted: offer every group back, one ➕ each. True if it was sent."""
    telegram_id = tg.bot_id_for(user)
    if not tg.bot_login_enabled() or not telegram_id:
        return False
    markup = menu_markup(user)
    if markup is None:
        return False
    return bool(tg.api.send_message(int(telegram_id), T.UNFROZEN, reply_markup=markup).ok)
```

- [ ] **Step 4: Route `callback_query`, and ask Telegram for it**

In `views_telegram.py` `_dispatch`, add before the `message = payload.get("message")` block:

```python
        callback = payload.get("callback_query")
        if isinstance(callback, dict):
            if tg.bot_login_enabled():
                logger.info("telegram_bot callback -> %s", telegram_bot.handle_callback_query(callback))
            return
```

In `set_classroom_bot_webhook.py`, replace the `ALLOWED_UPDATES` line and its comment with:

```python
#: ``message`` carries /chatid and the bot's sign-in chat; ``my_chat_member`` tells us the bot
#: itself was added, promoted or removed; ``callback_query`` is a press on a groups-menu button
#: (plan 2026-10-16). Everything else is noise we would only have to discard.
ALLOWED_UPDATES = ["message", "chat_member", "my_chat_member", "callback_query"]
```

- [ ] **Step 5: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/classes/telegram_bot.py backend/classes/views_telegram.py backend/classes/management/commands/set_classroom_bot_webhook.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): group buttons mint the invite in the bot; unfreeze menu; callback_query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Freeze and unfreeze messages

**Files:**
- Modify: `backend/classes/telegram_group.py` (`_notify_removed`, new `_removal_dm`, `enforce_for_user`)
- Modify: `backend/classes/telegram_group_hooks.py` (`_on_freeze_change`)
- Modify: `backend/classes/tasks.py` (new task after `enforce_telegram_group_for_user`)
- Test: `backend/classes/tests_telegram_bot.py`

**Interfaces:**
- Consumes: `T.REMOVED_*`, `T.group_list` (Task 1); `telegram_bot.send_unfrozen_menu` (Task 5)
- Produces:
  - `tg._removal_dm(user, names: list[str], reason: str) -> str`
  - `tg._notify_removed(user, classroom, reason, *, dm=True)`
  - Celery `classes.tasks.notify_telegram_unfrozen(user_id)`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_bot.py` (add `from notifications import constants as note_const` and `from notifications.models import Notification` to the imports):

```python
CHAT2 = "-1009876543210"


class FreezeMessageTests(BotBase):
    def setUp(self):
        super().setUp()
        self.math = Classroom.objects.create(
            name="Junior G15 Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin, telegram_chat_id=CHAT2,
        )
        ClassroomMembership.objects.create(classroom=self.math, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        for room, chat in ((self.classroom, CHAT), (self.math, CHAT2)):
            self.tg.members[(chat, 1001)] = "member"
            ClassroomTelegramMember.objects.create(
                classroom=room, user=self.student, telegram_user_id=1001, status=JOINED,
                identified_at=timezone.now(),
            )
        self.tg.messages.clear()
        self.tg.markups.clear()

    def freeze(self, reason: str):
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.frozen_reason = reason
            self.student.save(update_fields=["is_frozen", "frozen_reason"])

    def dms(self):
        return [body for chat, body in self.tg.messages if chat == "1001"]

    def test_a_debt_freeze_sends_one_message_naming_every_group(self):
        self.freeze("lcup_debt")
        self.assertEqual(
            self.dms(),
            [T.REMOVED_DEBT.format(groups=T.group_list(["Junior G15 English", "Junior G15 Math"]))],
        )

    def test_an_admin_freeze_says_to_ask_the_admin(self):
        self.freeze("")
        self.assertEqual(
            self.dms(),
            [T.REMOVED_FROZEN.format(groups=T.group_list(["Junior G15 English", "Junior G15 Math"]))],
        )

    def test_the_site_still_says_it_once_per_class(self):
        self.freeze("lcup_debt")
        # Only the group notices: other freeze hooks may write notifications of their own.
        self.assertEqual(
            Notification.objects.filter(user=self.student, event=note_const.EVENT_TELEGRAM_GROUP).count(), 2
        )

    def test_unfreezing_offers_the_groups_back(self):
        self.freeze("lcup_debt")
        self.tg.messages.clear()
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = False
            self.student.frozen_reason = ""
            self.student.save(update_fields=["is_frozen", "frozen_reason"])
        self.assertEqual(self.dms(), [T.UNFROZEN])

    @override_settings(CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=False)
    def test_unfreezing_with_the_bot_off_sends_nothing(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        self.student.refresh_from_db()
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = False
            self.student.save(update_fields=["is_frozen"])
        self.assertEqual(self.dms(), [])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot.FreezeMessageTests --settings=config.settings_test_nomigrations -v 1`
Expected: FAIL. Two English DMs arrive where one Uzbek DM is expected, and unfreezing sends nothing.

- [ ] **Step 3: Uzbek removal DMs, one per freeze**

In `backend/classes/telegram_group.py`, add `from . import telegram_texts as T` to the imports and replace `_notify_removed` with:

```python
def _removal_dm(user, names: list[str], reason: str) -> str:
    """The bot's Uzbek note for coming out of one or more groups (plan 2026-10-16)."""
    groups = T.group_list(names)
    if reason == ClassroomTelegramMember.REASON_FROZEN:
        from users.audience import FROZEN_LCUP_DEBT

        debt = str(getattr(user, "frozen_reason", "") or "") == FROZEN_LCUP_DEBT
        return (T.REMOVED_DEBT if debt else T.REMOVED_FROZEN).format(groups=groups)
    if reason == ClassroomTelegramMember.REASON_NOT_IN_CLASS:
        return T.REMOVED_NOT_IN_CLASS.format(groups=groups)
    if reason == ClassroomTelegramMember.REASON_IDENTITY_MISMATCH:
        return T.REMOVED_MISMATCH
    return T.REMOVED_MANUAL.format(groups=groups)


def _notify_removed(user, classroom: Classroom, reason: str, *, dm: bool = True) -> None:
    """The site's notification (English, one per class) and, unless ``dm`` is off, the bot's."""
    if user is None:
        return
    if reason == ClassroomTelegramMember.REASON_FROZEN:
        body = (
            "While your account is frozen you are out of the class Telegram group. You are "
            "still in the class here — your homework, points and results are exactly where "
            "you left them. As soon as your account is active again, open the class and "
            "press Join Telegram group for a new link."
        )
    elif reason == ClassroomTelegramMember.REASON_NOT_IN_CLASS:
        body = "You have moved out of this class, so you have come out of its Telegram group too."
    elif reason == ClassroomTelegramMember.REASON_IDENTITY_MISMATCH:
        body = (
            "Someone else opened your one-time invite link, so it was used up and they were "
            "removed from the group. Open the class and press Join Telegram group for a new "
            "link — and keep this one to yourself."
        )
    else:
        body = "You were removed from the class Telegram group."

    notify(
        user,
        event=note_const.EVENT_TELEGRAM_GROUP,
        title=f"{classroom.name}: Telegram group",
        body=body,
        link_url=f"/classes/{classroom.pk}",
        dedupe_key=f"tg-group:{classroom.pk}:{user.pk}:{reason}",
    )
    telegram_id = bot_id_for(user)
    if dm and telegram_id:
        api.send_message(int(telegram_id), _removal_dm(user, [classroom.name], reason))
```

Replace the loop and the return in `enforce_for_user` with:

```python
    removed_from: list[Classroom] = []
    for row in rows:
        if not chat_id_for(row.classroom):
            continue
        if row.invite_link:
            revoked += 1
        # The student hears it once, naming every group — not once per group.
        if remove_member(row, reason=reason, notify_student=False):
            removed += 1
            removed_from.append(row.classroom)
    if removed_from:
        for classroom in removed_from:
            _notify_removed(user, classroom, reason, dm=False)
        telegram_id = bot_id_for(user)
        if telegram_id:
            api.send_message(
                int(telegram_id),
                _removal_dm(user, sorted(c.name for c in removed_from), reason),
            )
    return {"removed": removed, "tickets_revoked": revoked}
```

- [ ] **Step 4: The unfreeze hook and task**

In `backend/classes/telegram_group_hooks.py` `_on_freeze_change`, replace

```python
        if bool(previous) or not bool(instance.is_frozen):
            return  # not a False → True transition
```

with

```python
        if bool(previous) and not bool(instance.is_frozen):
            # True → False: the bot offers the groups back (plan 2026-10-16).
            from .tasks import notify_telegram_unfrozen

            _dispatch(notify_telegram_unfrozen, instance.pk)
            return
        if bool(previous) or not bool(instance.is_frozen):
            return  # not a False → True transition
```

In `backend/classes/tasks.py`, after `enforce_telegram_group_for_user`:

```python
@shared_task(name="classes.tasks.notify_telegram_unfrozen")
def notify_telegram_unfrozen(user_id: int) -> dict:
    """A freeze lifted: the class bot offers the student's groups back (plan 2026-10-16)."""
    from django.contrib.auth import get_user_model

    from . import telegram_bot

    user = get_user_model().objects.filter(pk=user_id).first()
    if user is None or user.is_frozen:
        return {"status": "noop", "user_id": user_id}
    return {"status": "ok", "user_id": user_id, "sent": telegram_bot.send_unfrozen_menu(user)}
```

- [ ] **Step 5: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_bot classes.tests_telegram_group --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`. `HtmlEscapingTests.test_a_removal_notice_escapes_the_class_name` must still pass, because `group_list` escapes.

- [ ] **Step 6: Commit**

```bash
git add backend/classes/telegram_group.py backend/classes/telegram_group_hooks.py backend/classes/tasks.py backend/classes/tests_telegram_bot.py
git commit -m "feat(telegram): one Uzbek message per freeze (debt vs admin); unfreeze offers the groups back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Payment messages from the lc-up sync

**Files:**
- Modify: `backend/lcup/models.py` (`LcupPayment`, after `synced_at`)
- Create (generated): `backend/lcup/migrations/0007_lcuppayment_bot_notified_at.py`
- Create: `backend/classes/telegram_payments.py`
- Modify: `backend/classes/tasks.py` (new task)
- Modify: `backend/lcup/sync.py` (`_run_stages`, new `_queue_payment_messages`)
- Test: `backend/classes/tests_telegram_payments.py`

**Interfaces:**
- Consumes: `T.PAYMENT*`, `T.som` (Task 1); `tg.bot_id_for`, `tg.api.send_message`; `classes.telegram_group_hooks._dispatch`
- Produces:
  - `LcupPayment.bot_notified_at`
  - `telegram_payments.payment_messages_since() -> datetime | None`
  - `telegram_payments.payment_text(payment) -> str`
  - `telegram_payments.notify_new_payments(now=None) -> dict`
  - Celery `classes.tasks.send_telegram_payment_messages()`
  - `lcup.sync._queue_payment_messages(run) -> None`

- [ ] **Step 1: Write the failing tests**

Create `backend/classes/tests_telegram_payments.py`:

```python
"""lc-up payments announced in the class bot (plan 2026-10-16): new payments only, once each,
never a refund, never before the switch-on moment, and never from a dry-run sync."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from access import constants as C
from classes import telegram_texts as T
from classes.models import Classroom
from classes.telegram_payments import notify_new_payments
from classes.tests_telegram_group import CHAT, TOKEN, FakeTelegram
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupPayment, LcupStudentLink, LinkStatus
from users.models import User


def at(day, hour=9):
    return timezone.make_aware(datetime(2026, 10, day, hour, 0))


@override_settings(
    CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM="2026-10-15T00:00:00+05:00",
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_BROKER_URL="",
)
class PaymentMessageTests(TestCase):
    def setUp(self):
        cache.clear()
        self.tg = FakeTelegram()
        patch = self.tg.patches()
        patch.start()
        self.addCleanup(patch.stop)
        admin = User.objects.create_user("pm_admin@t.com", "x", role=C.ROLE_ADMIN)
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=admin, telegram_chat_id=CHAT,
        )
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=10, name="Junior G21 | Math | Vali", status=GroupLinkStatus.CONFIRMED,
            snapshot={}, classroom=self.room,
        )
        self.user = User.objects.create_user("pm_s@t.com", "x", telegram_bot_user_id=1001)
        self.link = LcupStudentLink.objects.create(
            lcup_student_id=101, name="Testov Aziz", user=self.user, status=LinkStatus.CONFIRMED,
            balance=Decimal(0),
        )

    def payment(self, pid, *, amount=500000, kind="payment", created=None, paid_on=date(2026, 10, 16)):
        created = created or at(16)
        return LcupPayment.objects.create(
            lcup_payment_id=pid, student=self.link, lcup_student_id=101, group=self.group,
            lcup_group_id=10, kind=kind, amount=amount, paid_on=paid_on, month="2026-10",
            created_in_lcup=created, synced_at=created,
        )

    def test_a_new_payment_is_announced_with_no_debt_left(self):
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        self.assertEqual(
            self.tg.messages,
            [("1001", T.PAYMENT.format(group="Junior G21 Math", amount="500 000") + "\n" + T.PAYMENT_NO_DEBT)],
        )

    def test_the_debt_left_is_named(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=Decimal(-250000))
        self.payment(1, amount=250000)
        notify_new_payments(now=at(16, 12))
        self.assertTrue(self.tg.messages[-1][1].endswith(T.PAYMENT_DEBT_LEFT.format(debt="250 000")))

    def test_each_payment_is_announced_once(self):
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        notify_new_payments(now=at(16, 13))
        self.assertEqual(len(self.tg.messages), 1)
        self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)

    def test_payments_from_before_the_switch_are_never_announced(self):
        self.payment(1, created=at(14))
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])

    def test_a_refund_is_not_announced(self):
        self.payment(1, kind="refund")
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])

    def test_a_student_without_the_bot_is_marked_and_skipped(self):
        User.objects.filter(pk=self.user.pk).update(telegram_bot_user_id=None)
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])
        self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)

    def test_a_network_failure_is_tried_again_next_time(self):
        self.payment(1)
        self.tg.send_should_fail = True
        notify_new_payments(now=at(16, 12))
        self.assertIsNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)
        self.tg.send_should_fail = False
        notify_new_payments(now=at(16, 13))
        self.assertEqual(len(self.tg.messages), 1)

    @override_settings(CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM="")
    def test_switched_off_nothing_is_sent(self):
        self.payment(1)
        self.assertEqual(notify_new_payments(now=at(16, 12))["status"], "off")
        self.assertEqual(self.tg.messages, [])


class SyncStageTests(TestCase):
    def test_a_dry_run_never_queues_the_messages(self):
        from lcup.sync import _queue_payment_messages

        run = mock.Mock(dry_run=True)
        with mock.patch("classes.telegram_group_hooks._dispatch") as dispatch:
            _queue_payment_messages(run)
        dispatch.assert_not_called()

    def test_a_real_run_queues_them(self):
        from classes.tasks import send_telegram_payment_messages
        from lcup.sync import _queue_payment_messages

        run = mock.Mock(dry_run=False)
        with mock.patch("classes.telegram_group_hooks._dispatch") as dispatch:
            _queue_payment_messages(run)
        dispatch.assert_called_once_with(send_telegram_payment_messages)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_payments --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR, `ModuleNotFoundError: No module named 'classes.telegram_payments'`

- [ ] **Step 3: The field and its migration**

In `backend/lcup/models.py`, `LcupPayment`, after `synced_at`:

```python
    #: When the class bot told the student about this payment, or found it could not (no
    #: Telegram on the account) — plan 2026-10-16. Null = not yet. Set once, so a payment that
    #: every sync re-reads is announced once.
    bot_notified_at = models.DateTimeField(null=True, blank=True)
```

Run (from `backend/`): `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py makemigrations lcup -n lcuppayment_bot_notified_at`
Expected: `lcup/migrations/0007_lcuppayment_bot_notified_at.py` containing exactly one `AddField`.

- [ ] **Step 4: The notifier**

Create `backend/classes/telegram_payments.py`:

```python
"""lc-up payments, announced in the class bot (plan 2026-10-16).

"✅ <class> uchun 500 000 so'm to'lov qabul qilindi." and then either "Qarzingiz qolmadi." or
"Qolgan qarz: X so'm." The class comes from the payment's own lc-up group (every payment has
one); the debt is lc-up's overall balance, which the same sync refreshed a stage earlier —
lc-up keeps no balance per group (measured 2026-10-16), so the message does not pretend to.

Only payments lc-up created after ``CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM``: the copy holds
every payment since January, and switching this on must not replay them. A refund is not
announced. A student with no bot connection is marked done and skipped. A send that failed
in transit is left for the next run, while one Telegram refused (the student blocked the bot)
is not retried for ever.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from lcup.models import LcupPayment

from . import telegram_group as tg
from . import telegram_texts as T

logger = logging.getLogger("classes.telegram_payments")

#: A payment older than this is history, not news, whatever its creation stamp says.
RECENT_DAYS = 7


def payment_messages_since():
    raw = str(getattr(settings, "CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM", "") or "").strip()
    parsed = parse_datetime(raw) if raw else None
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def payment_text(payment: LcupPayment) -> str:
    group = payment.group
    name = ""
    if group is not None:
        name = group.classroom.name if group.classroom_id else group.name
    amount = T.som(payment.amount)
    head = (
        T.PAYMENT.format(group=tg.api.esc(name), amount=amount)
        if name
        else T.PAYMENT_NO_GROUP.format(amount=amount)
    )
    balance = payment.student.balance if payment.student_id else None
    if balance is None:
        return head
    if balance >= 0:
        return f"{head}\n{T.PAYMENT_NO_DEBT}"
    return f"{head}\n{T.PAYMENT_DEBT_LEFT.format(debt=T.som(-balance))}"


def notify_new_payments(now=None) -> dict:
    since = payment_messages_since()
    if since is None or not tg.api.is_configured():
        return {"status": "off"}
    now = now or timezone.now()
    rows = (
        LcupPayment.objects.filter(
            kind="payment",
            bot_notified_at__isnull=True,
            created_in_lcup__gte=since,
            paid_on__gte=timezone.localdate(now) - timedelta(days=RECENT_DAYS),
        )
        .select_related("student__user", "group__classroom")
        .order_by("created_in_lcup", "pk")
    )
    sent = skipped = failed = 0
    for payment in rows:
        user = payment.student.user if payment.student_id and payment.student.user_id else None
        telegram_id = tg.bot_id_for(user) if user is not None else None
        if not telegram_id:
            skipped += 1
        else:
            result = tg.api.send_message(int(telegram_id), payment_text(payment))
            if not result.ok and not result.error_code:
                failed += 1  # in transit: the next run tries again
                continue
            sent += int(result.ok)
        LcupPayment.objects.filter(pk=payment.pk).update(bot_notified_at=now)
    if sent or failed:
        logger.info("telegram payments sent=%s skipped=%s failed=%s", sent, skipped, failed)
    return {"status": "ok", "sent": sent, "skipped": skipped, "failed": failed}
```

- [ ] **Step 5: The task and the sync stage**

In `backend/classes/tasks.py`, after `notify_telegram_unfrozen`:

```python
@shared_task(name="classes.tasks.send_telegram_payment_messages")
def send_telegram_payment_messages() -> dict:
    """Queued by every real lc-up sync: announce its new payments in the class bot."""
    from .telegram_payments import notify_new_payments

    return notify_new_payments()
```

In `backend/lcup/sync.py`, in `_run_stages`, add directly before `_stage(run, "debt_freeze", ...)`:

```python
    # Before the freeze stage, so "paid" reaches the student before "your groups are open
    # again". The balance it quotes was refreshed by the students stage.
    _stage(run, "payment_messages", lambda: _queue_payment_messages(run))
```

and add, near the other stage helpers (above `_run_stages`):

```python
def _queue_payment_messages(run: _Run) -> None:
    """Announce this run's new payments in the class bot, once the run has committed. A dry run
    is rolled back and must never message anybody, so it queues nothing."""
    if run.dry_run:
        return
    from classes.tasks import send_telegram_payment_messages
    from classes.telegram_group_hooks import _dispatch

    _dispatch(send_telegram_payment_messages)
```

- [ ] **Step 6: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_payments lcup.tests_finance lcup.tests_sync --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/lcup/models.py backend/lcup/migrations/0007_lcuppayment_bot_notified_at.py backend/lcup/sync.py backend/classes/telegram_payments.py backend/classes/tasks.py backend/classes/tests_telegram_payments.py
git commit -m "feat(telegram): announce new lc-up payments in the class bot, once each

Behind CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM; a dry-run sync never sends.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The ops Telegram part and the admin's Remove

**Files:**
- Modify: `backend/classes/ops_classrooms.py` (new `class_telegram_part`, `CLASS_PARTS`)
- Modify: `backend/classes/views_ops_classrooms.py` (new `ClassroomTelegramRemoveView`)
- Modify: `backend/classes/urls.py` (import + path after `ops-classroom-part`)
- Test: `backend/classes/tests_telegram_ops.py`

**Interfaces:**
- Consumes: `is_managed`, `remove_member(force=True)` (Task 2); `tg.group_health`
- Produces:
  - `GET /api/classes/admin/classrooms/<pk>/telegram/` → `{configured, health{ok,title,member_count,problem}|null, counts{in_group,known,managed,frozen_in_group}, members[{id,user_id,name,telegram_user_id,telegram_username,telegram_display_name,status,managed,frozen,frozen_for_debt,joined_at}]}`
  - `POST /api/classes/admin/classrooms/<pk>/telegram/remove/` `{member_id}`. Returns 200 `{removed: true}`, 403, 404 or 409.

- [ ] **Step 1: Write the failing tests**

Create `backend/classes/tests_telegram_ops.py`:

```python
"""/ops: the class Telegram group for admins — who is in it, who the bot looks after, and the
Remove button for the people it never will (decision 3, 2026-10-16)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.utils import timezone

from classes.models_telegram import ClassroomTelegramMember
from classes.tests_telegram_group import CHAT, TelegramGroupBase

User = get_user_model()
JOINED = ClassroomTelegramMember.STATUS_JOINED


class OpsTelegramPartTests(TelegramGroupBase):
    def url(self, tail=""):
        return f"/api/classes/admin/classrooms/{self.classroom.pk}/telegram/{tail}"

    def member(self, user, tg_id, *, identified=False, status="member"):
        self.tg.join(tg_id, status=status)
        return ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=user, telegram_user_id=tg_id, status=JOINED,
            joined_at=timezone.now(), identified_at=timezone.now() if identified else None,
        )

    def test_the_part_lists_who_is_in_and_who_the_bot_looks_after(self):
        self.member(self.student, 1001, identified=True)
        self.member(self.other, 1002)
        User.objects.filter(pk=self.other.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertTrue(body["configured"])
        by_tg = {m["telegram_user_id"]: m for m in body["members"]}
        self.assertTrue(by_tg[1001]["managed"])
        self.assertFalse(by_tg[1002]["managed"])
        self.assertTrue(by_tg[1002]["frozen_for_debt"])
        self.assertEqual(body["counts"]["known"], 2)
        self.assertEqual(body["counts"]["managed"], 1)
        self.assertEqual(body["counts"]["frozen_in_group"], 1)
        self.assertIsNotNone(body["counts"]["in_group"])

    def test_a_class_without_a_group_says_so(self):
        self.classroom.telegram_chat_id = ""
        self.classroom.save(update_fields=["telegram_chat_id"])
        self.client.force_authenticate(user=self.admin)
        self.assertFalse(self.client.get(self.url()).json()["configured"])

    def test_teachers_cannot_read_it(self):
        self.client.force_authenticate(user=self.teacher)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_an_admin_removes_an_old_member_by_hand(self):
        row = self.member(self.other, 1002)
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn((CHAT, 1002), self.tg.kicked)
        row.refresh_from_db()
        self.assertEqual(row.removed_reason, ClassroomTelegramMember.REASON_MANUAL)

    def test_a_chat_admin_is_never_removed(self):
        row = self.member(self.other, 1002, status="administrator")
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.tg.kicked, [])

    def test_only_admins_may_remove(self):
        row = self.member(self.other, 1002)
        self.client.force_authenticate(user=self.teacher)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.tg.kicked, [])

    def test_another_classes_row_is_not_found(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": 999999}, format="json")
        self.assertEqual(r.status_code, 404)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_ops --settings=config.settings_test_nomigrations -v 1`
Expected: FAIL. The GET returns 404 (unknown part) and the POST returns 404/405.

- [ ] **Step 3: The part**

In `backend/classes/ops_classrooms.py`, above `CLASS_PARTS`:

```python
def class_telegram_part(room, request=None) -> dict:
    """The class Telegram group for /ops (plan 2026-10-16): the bot's health in it, who the site
    knows is inside, which of them the bot looks after, and who is frozen — the admin's list
    for removing old members by hand. Telegram gives a head count, never a list, so "in_group"
    and "known" differ until everybody has signed in."""
    from users.audience import FROZEN_LCUP_DEBT

    from . import telegram_group as tg
    from .models_telegram import ClassroomTelegramMember

    if not tg.chat_id_for(room):
        return {
            "configured": False,
            "health": None,
            "counts": {"in_group": None, "known": 0, "managed": 0, "frozen_in_group": 0},
            "members": [],
        }
    health = tg.group_health(room)
    rows = (
        ClassroomTelegramMember.objects.filter(classroom=room)
        .select_related("user")
        .order_by("status", "-updated_at")[:500]
    )
    members = []
    for r in rows:
        u = r.user
        members.append({
            "id": r.pk,
            "user_id": r.user_id,
            "name": display_name(u),
            "telegram_user_id": r.telegram_user_id,
            "telegram_username": r.telegram_username,
            "telegram_display_name": r.telegram_display_name,
            "status": r.status,
            "managed": r.is_managed,
            "frozen": bool(u and u.is_frozen),
            "frozen_for_debt": bool(u and u.is_frozen and u.frozen_reason == FROZEN_LCUP_DEBT),
            "joined_at": iso(r.joined_at) if r.joined_at else None,
        })
    inside = [m for m in members if m["status"] == ClassroomTelegramMember.STATUS_JOINED]
    return {
        "configured": True,
        "health": {
            "ok": health.ok, "title": health.title,
            "member_count": health.member_count, "problem": health.problem,
        },
        "counts": {
            "in_group": health.member_count,
            "known": len(inside),
            "managed": sum(1 for m in inside if m["managed"]),
            "frozen_in_group": sum(1 for m in inside if m["frozen"]),
        },
        "members": members,
    }
```

Add `"telegram": class_telegram_part,` to `CLASS_PARTS`.

- [ ] **Step 4: The remove endpoint**

In `backend/classes/views_ops_classrooms.py`, at the end:

```python
class ClassroomTelegramRemoveView(APIView):
    """``POST /api/classes/admin/classrooms/<pk>/telegram/remove/`` {member_id} — an admin takes one
    person out of the class Telegram group by hand. Forced: the bot's own rules keep it away
    from members it never watched arrive and from accounts it cannot place, and this is the
    admin deciding about exactly those (decision 3). A chat administrator is never removed."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        from . import telegram_group as tg
        from .models_telegram import ClassroomTelegramMember

        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        try:
            member_id = int(request.data.get("member_id"))
        except (TypeError, ValueError):
            return Response({"detail": "member_id is required."}, status=400)
        row = (
            ClassroomTelegramMember.objects.select_related("classroom", "user")
            .filter(classroom_id=pk, pk=member_id)
            .first()
        )
        if row is None:
            return Response({"detail": "Not found."}, status=404)
        if not tg.remove_member(row, reason=ClassroomTelegramMember.REASON_MANUAL, force=True):
            return Response(
                {"detail": "Telegram did not remove them: they may have left already, or be an admin of the group."},
                status=409,
            )
        return Response({"removed": True})
```

In `backend/classes/urls.py`, extend the import on line ~103 to include `ClassroomTelegramRemoveView`, and add after the `ops-classroom-part` path:

```python
    path(
        "admin/classrooms/<int:pk>/telegram/remove/",
        ClassroomTelegramRemoveView.as_view(),
        name="ops-classroom-telegram-remove",
    ),
```

- [ ] **Step 5: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_ops classes.tests_classroom_details --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/classes/ops_classrooms.py backend/classes/views_ops_classrooms.py backend/classes/urls.py backend/classes/tests_telegram_ops.py
git commit -m "feat(ops): the class Telegram group part and the admin's Remove

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The one-off group announcement command

**Files:**
- Create: `backend/classes/management/commands/announce_classroom_bot.py`
- Test: `backend/classes/tests_telegram_ops.py` (append)

**Interfaces:**
- Consumes: `tg.bot_start_url`, `tg.chat_id_for`, `api.send_message(reply_markup=)`, `T.ANNOUNCE`, `T.ANNOUNCE_BUTTON`
- Produces: `python manage.py announce_classroom_bot [--send]`

- [ ] **Step 1: Write the failing tests**

Append to `backend/classes/tests_telegram_ops.py`:

```python
from io import StringIO

from django.core.management import call_command

from classes import telegram_texts as T
from classes.models import Classroom


class AnnounceCommandTests(TelegramGroupBase):
    def test_a_dry_run_posts_nothing(self):
        out = StringIO()
        call_command("announce_classroom_bot", stdout=out)
        self.assertEqual(self.tg.messages, [])
        self.assertIn("dry run", out.getvalue())

    def test_send_posts_once_per_group_with_the_bot_button(self):
        # A second class meeting in the same group: one post, not two.
        Classroom.objects.create(
            name="Junior G15 Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin, telegram_chat_id=CHAT,
        )
        call_command("announce_classroom_bot", "--send", stdout=StringIO())
        self.assertEqual(self.tg.messages, [(CHAT, T.ANNOUNCE)])
        button = self.tg.markups[-1]["inline_keyboard"][0][0]
        self.assertEqual(button, {"text": T.ANNOUNCE_BUTTON, "url": "https://t.me/MasterSATTestBot?start=login"})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_ops.AnnounceCommandTests --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR, `CommandError: Unknown command: 'announce_classroom_bot'`

- [ ] **Step 3: The command**

Create `backend/classes/management/commands/announce_classroom_bot.py`:

```python
"""Post the "sign in to the bot" note into every class Telegram group, once (plan 2026-10-16).

Members from before the bot are untouchable until they are identified, and signing in is how
they are identified — so every group is asked, with a button that opens the bot.

    python manage.py announce_classroom_bot          # dry run: lists the groups
    python manage.py announce_classroom_bot --send   # posts it

Run --send only with the owner's go-ahead: it speaks in every class group at once.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from classes import telegram_group as tg
from classes import telegram_texts as T
from classes.models import Classroom


class Command(BaseCommand):
    help = "Post the class-bot sign-in note into every class Telegram group (dry run unless --send)."

    def add_arguments(self, parser):
        parser.add_argument("--send", action="store_true", help="Actually post. Without it, only list.")

    def handle(self, *args, **options):
        url = tg.bot_start_url()
        if not url:
            raise CommandError("The bot is not reachable (no token, or getMe failed).")
        chats: dict[str, list[str]] = {}
        rooms = (
            Classroom.objects.filter(is_active=True)
            .exclude(telegram_chat_id="")
            .exclude(telegram_chat_id=None)
            .order_by("pk")
        )
        for room in rooms:
            chats.setdefault(tg.chat_id_for(room), []).append(room.name)
        markup = {"inline_keyboard": [[{"text": T.ANNOUNCE_BUTTON, "url": url}]]}
        posted = 0
        for chat, names in chats.items():
            if not options["send"]:
                self.stdout.write(f"would post to {chat}: {', '.join(names)}")
                continue
            result = tg.api.send_message(chat, T.ANNOUNCE, reply_markup=markup)
            posted += int(result.ok)
            self.stdout.write(
                f"{'posted' if result.ok else 'FAILED'} {chat}: {', '.join(names)} {result.description}".rstrip()
            )
        tail = f"posted {posted}" if options["send"] else "dry run — nothing posted"
        self.stdout.write(f"{len(chats)} group(s); {tail}")
```

- [ ] **Step 4: Run the tests**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_ops --settings=config.settings_test_nomigrations -v 1`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/classes/management/commands/announce_classroom_bot.py backend/classes/tests_telegram_ops.py
git commit -m "feat(telegram): one-off command asking every class group to sign in to the bot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The class page button opens the bot

**Files:**
- Modify: `frontend/src/features/classroom/telegramApi.ts` (`TelegramGroupState`)
- Create: `frontend/src/features/classroom/shell/TelegramHeaderButton.tsx`
- Modify: `frontend/src/features/classroom/shell/ClassroomShell.tsx` (lines ~98–162)
- Test: `frontend/src/features/classroom/__tests__/TelegramHeaderButton.test.tsx`

**Interfaces:**
- Consumes: `student_state.bot_url` (Task 3), `useTelegramGroup`
- Produces: `<TelegramHeaderButton classId legacyUrl onOpenDialog />`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/classroom/__tests__/TelegramHeaderButton.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let state: Record<string, unknown> | undefined;
vi.mock("../telegramHooks", () => ({ useTelegramGroup: () => ({ data: state }) }));

import { TelegramHeaderButton } from "../shell/TelegramHeaderButton";

let host: HTMLElement;
let root: Root;
const open = vi.fn();

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  open.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(legacyUrl = "") {
  act(() => root.render(<TelegramHeaderButton classId={7} legacyUrl={legacyUrl} onOpenDialog={open} />));
}

describe("TelegramHeaderButton", () => {
  it("links straight to the bot when the bot sign-in is on", () => {
    state = { managed: true, bot_url: "https://t.me/Bot?start=login", status: "NONE" };
    render();
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://t.me/Bot?start=login");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the join dialog while the bot sign-in is off", () => {
    state = { managed: true, bot_url: "", status: "NONE" };
    render();
    act(() => host.querySelector("button")?.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("falls back to the old static link for a class the bot does not run", () => {
    state = { managed: false, bot_url: "", status: "NONE" };
    render("https://t.me/+static");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://t.me/+static");
  });

  it("shows nothing with neither", () => {
    state = { managed: false, bot_url: "", status: "NONE" };
    render("");
    expect(host.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/classroom/__tests__/TelegramHeaderButton.test.tsx`
Expected: FAIL, `Failed to resolve import "../shell/TelegramHeaderButton"`

- [ ] **Step 3: Add `bot_url` to the state type**

In `frontend/src/features/classroom/telegramApi.ts`, inside `TelegramGroupState`, after `group_url`:

```ts
  /**
   * The bot's sign-in link (`t.me/<bot>?start=login`), set when the bot's own sign-in is switched
   * on for a class it runs (plan 2026-10-16). The header button then opens the bot instead of the
   * join dialog. Empty while that is off.
   */
  bot_url: string;
```

- [ ] **Step 4: The button component**

Create `frontend/src/features/classroom/shell/TelegramHeaderButton.tsx`:

```tsx
"use client";

import { Send } from "lucide-react";

import { useTelegramGroup } from "../telegramHooks";

const BUTTON =
  "ds-ring mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#2AABEE] px-3 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90";

/**
 * The class header's Telegram button, in order of preference:
 * 1. the bot's sign-in link, when the bot's own sign-in is on (plan 2026-10-16) — the bot asks
 *    for the login and hands out the invite there;
 * 2. the 2026-09 join dialog, for a class the bot runs while that is off;
 * 3. the old static link, for a class nobody has set up — so nothing regresses.
 */
export function TelegramHeaderButton({
  classId,
  legacyUrl,
  onOpenDialog,
}: {
  classId: number;
  legacyUrl: string;
  onOpenDialog: () => void;
}) {
  const { data } = useTelegramGroup(classId);
  const label = data?.status === "JOINED" ? "Telegram group" : "Join Telegram group";

  if (data?.managed && data.bot_url) {
    return (
      // `noopener` keeps the new tab from reaching back into this app; `noreferrer` is its pair.
      <a href={data.bot_url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
        <Send className="h-[15px] w-[15px]" aria-hidden /> {label}
      </a>
    );
  }
  if (data?.managed) {
    return (
      <button type="button" onClick={onOpenDialog} className={BUTTON}>
        <Send className="h-[15px] w-[15px]" aria-hidden /> {label}
      </button>
    );
  }
  const url = legacyUrl.trim();
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
      <Send className="h-[15px] w-[15px]" aria-hidden /> Join Telegram group
    </a>
  );
}
```

- [ ] **Step 5: Use it in the shell**

In `ClassroomShell.tsx`:
- Remove the lines `const telegram = (classroom.telegram_group_url || "").trim();`, `const { data: tgState } = useTelegramGroup(classId);` and `const tgManaged = Boolean(tgState?.managed);`, together with their comment block. Keep `const [tgOpen, setTgOpen] = useState(false);`.
- Replace the whole `{tgManaged ? (<button …>…</button>) : (telegram && (<a …>…</a>))}` expression with:

```tsx
            <TelegramHeaderButton
              classId={classId}
              legacyUrl={classroom.telegram_group_url || ""}
              onOpenDialog={() => setTgOpen(true)}
            />
```

- Replace `import { useTelegramGroup } from "../telegramHooks";` with `import { TelegramHeaderButton } from "./TelegramHeaderButton";`. If `Send` is no longer used anywhere in the shell, drop it from the `lucide-react` import too.

- [ ] **Step 6: Run the tests and the type check**

Run (from `frontend/`): `npx vitest run src/features/classroom`
Expected: all pass, including `OverviewSeam.test.tsx`.
Run: `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/classroom/telegramApi.ts frontend/src/features/classroom/shell/TelegramHeaderButton.tsx frontend/src/features/classroom/shell/ClassroomShell.tsx frontend/src/features/classroom/__tests__/TelegramHeaderButton.test.tsx
git commit -m "feat(classroom): the Telegram button opens the class bot when its sign-in is on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The ops Telegram tab

**Files:**
- Modify: `frontend/src/features/ops/classrooms/classroomsApi.ts`
- Create: `frontend/src/features/ops/classrooms/sections/TelegramSection.tsx`
- Modify: `frontend/src/features/ops/classrooms/ClassroomPage.tsx` (`ClassTab`, `TABS`, the tab panel)
- Modify: `frontend/src/features/ops/classrooms/__tests__/ClassroomPage.test.tsx` (`PARTS`)
- Test: `frontend/src/features/ops/classrooms/__tests__/TelegramSection.test.tsx`

**Interfaces:**
- Consumes: the Task 8 endpoints
- Produces:
  - `type ClassroomTelegram`, `type ClassroomTelegramMember`
  - `removeTelegramMember(id, memberId)`
  - `<TelegramSection id />`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/ops/classrooms/__tests__/TelegramSection.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const toast = vi.fn();
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));

import { TelegramSection } from "../sections/TelegramSection";

const PART = {
  configured: true,
  health: { ok: true, title: "G15", member_count: 23, problem: "" },
  counts: { in_group: 23, known: 2, managed: 1, frozen_in_group: 1 },
  members: [
    { id: 1, user_id: 10, name: "Aziz Testov", telegram_user_id: 1001, telegram_username: "aziz", telegram_display_name: "Aziz", status: "JOINED", managed: true, frozen: false, frozen_for_debt: false, joined_at: null },
    { id: 2, user_id: 11, name: "Malika Testova", telegram_user_id: 1002, telegram_username: "", telegram_display_name: "Malika", status: "JOINED", managed: false, frozen: true, frozen_for_debt: true, joined_at: null },
  ],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: PART });
  post.mockReset().mockResolvedValue({ data: { removed: true } });
  toast.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><TelegramSection id={45} /></QueryClientProvider>));
  await settle();
}

describe("TelegramSection", () => {
  it("shows the counts and marks the unpaid member the bot will not remove", async () => {
    await render();
    expect(get).toHaveBeenCalledWith("/classes/admin/classrooms/45/telegram/");
    expect(host.textContent).toContain("23 in the group");
    expect(host.textContent).toContain("Frozen — unpaid");
    expect(host.textContent).toContain("bot will not remove");
  });

  it("removes a member by hand and reloads the part", async () => {
    await render();
    const removeButtons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Remove");
    await act(async () => removeButtons[1].click());
    await settle();
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/telegram/remove/", { member_id: 2 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("explains a class with no group", async () => {
    get.mockResolvedValue({ data: { ...PART, configured: false, health: null, members: [] } });
    await render();
    expect(host.textContent).toContain("No Telegram group is set for this class");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/ops/classrooms/__tests__/TelegramSection.test.tsx`
Expected: FAIL, `Failed to resolve import "../sections/TelegramSection"`

- [ ] **Step 3: API types and call**

In `frontend/src/features/ops/classrooms/classroomsApi.ts`, after `ClassroomHistory`:

```ts
export type ClassroomTelegramMember = {
  id: number;
  user_id: number | null;
  name: string;
  telegram_user_id: number | null;
  telegram_username: string;
  telegram_display_name: string;
  status: "PENDING" | "JOINED" | "LEFT" | "REMOVED";
  /** The bot acts on them by itself: it watched them arrive, or they signed in to the bot. */
  managed: boolean;
  frozen: boolean;
  frozen_for_debt: boolean;
  joined_at: string | null;
};

export type ClassroomTelegram = {
  configured: boolean;
  health: { ok: boolean; title: string; member_count: number | null; problem: string } | null;
  /** `in_group` is Telegram's own head count (bot and admins included); the rest are people known here. */
  counts: { in_group: number | null; known: number; managed: number; frozen_in_group: number };
  members: ClassroomTelegramMember[];
};
```

Change `ClassroomPartName` to `"roster" | "attendance" | "homework" | "history" | "telegram"`, and at the end of the file add:

```ts
/** An admin takes one person out of the class Telegram group (forced past the bot's own rules). */
export async function removeTelegramMember(id: number, memberId: number): Promise<{ removed: boolean }> {
  return (await api.post(`/classes/admin/classrooms/${id}/telegram/remove/`, { member_id: memberId })).data;
}
```

- [ ] **Step 4: The section**

Create `frontend/src/features/ops/classrooms/sections/TelegramSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, Table, Td, TONE_TEXT, WIDE_ONLY } from "@/features/ops/people/Fieldset";
import {
  classroomKeys,
  removeTelegramMember,
  serverReason,
  useClassroomPart,
  type ClassroomTelegram,
  type ClassroomTelegramMember,
} from "../classroomsApi";

const STATUS: Record<ClassroomTelegramMember["status"], { label: string; variant: "success" | "info" | "neutral" }> = {
  JOINED: { label: "In the group", variant: "success" },
  PENDING: { label: "Invite sent", variant: "info" },
  LEFT: { label: "Left", variant: "neutral" },
  REMOVED: { label: "Removed", variant: "neutral" },
};

/**
 * The class Telegram group (plan 2026-10-16): who is in it, which of them the bot looks after by
 * itself, who is frozen — and a Remove for the people the bot never will (members from before it
 * who have not signed in, accounts it cannot place). The owner's decision: those are the admin's
 * to remove by hand, once.
 */
export function TelegramSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomTelegram>(id, "telegram");
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const remove = async (m: ClassroomTelegramMember) => {
    setBusy(m.id);
    try {
      await removeTelegramMember(id, m.id);
      push({ tone: "success", message: `Removed ${m.name || m.telegram_display_name || "them"} from the Telegram group.` });
      await qc.invalidateQueries({ queryKey: classroomKeys.part(id, "telegram") });
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Telegram did not remove them.") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Fieldset title="Telegram" icon={Send} description="The class group: who is in it and who the bot looks after">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) =>
          !d.configured ? (
            <p className="text-sm text-muted-foreground">
              No Telegram group is set for this class. Add the bot to the group as an admin (Invite users + Ban
              users), send /chatid there, and paste the id into the class form.
            </p>
          ) : (
            <>
              {d.health?.problem ? (
                <p className={cn("mb-4 text-sm font-medium", TONE_TEXT.danger)}>{d.health.problem}</p>
              ) : null}
              <p className="mb-4 text-sm text-muted-foreground">
                {d.counts.in_group ?? "?"} in the group (bot and admins included) · {d.counts.known} known here ·{" "}
                {d.counts.managed} looked after by the bot · {d.counts.frozen_in_group} frozen
              </p>
              <Table head={["Person", { label: "Telegram", className: WIDE_ONLY }, "Status", ""]}>
                {d.members.map((m) => (
                  <tr key={m.id}>
                    <Td wrap className="font-medium">
                      {m.name || <span className="text-muted-foreground">Not a MasterSAT account</span>}
                      {m.frozen ? (
                        <Badge variant={m.frozen_for_debt ? "danger" : "warning"} className="ml-2">
                          {m.frozen_for_debt ? "Frozen — unpaid" : "Frozen"}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className={WIDE_ONLY}>
                      {m.telegram_username ? `@${m.telegram_username}` : m.telegram_display_name || "—"}
                    </Td>
                    <Td>
                      <Badge variant={STATUS[m.status].variant}>{STATUS[m.status].label}</Badge>
                      {m.status === "JOINED" && !m.managed ? (
                        <span className="ml-2 text-xs text-muted-foreground">bot will not remove</span>
                      ) : null}
                    </Td>
                    <Td>
                      {m.status === "JOINED" ? (
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => remove(m)}
                          className={cn("text-sm font-medium hover:underline disabled:opacity-50", TONE_TEXT.danger)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            </>
          )
        }
      />
    </Fieldset>
  );
}
```

- [ ] **Step 5: The tab**

In `ClassroomPage.tsx`:
- Change `type ClassTab` to add `| "telegram"`.
- Append `{ key: "telegram", label: "Telegram", icon: Send },` to `TABS` and add `Send` to the `lucide-react` import.
- Import `import { TelegramSection } from "./sections/TelegramSection";`.
- After the history panel line, add `{tab === "telegram" ? <TelegramSection id={id} /> : null}`.

In `__tests__/ClassroomPage.test.tsx`, add to `PARTS`:

```ts
  telegram: { configured: false, health: null, counts: { in_group: null, known: 0, managed: 0, frozen_in_group: 0 }, members: [] },
```

- [ ] **Step 6: Run the tests and the type check**

Run (from `frontend/`): `npx vitest run src/features/ops/classrooms`
Expected: all pass.
Run: `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/ops/classrooms
git commit -m "feat(ops): Telegram tab on the class page with the admin's Remove

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, full verification, PR

**Files:**
- Modify: `docs/CLASSROOM_TELEGRAM_GROUPS.md` (append a section)

- [ ] **Step 1: Document it**

Append to `docs/CLASSROOM_TELEGRAM_GROUPS.md`:

```markdown
## The bot's own sign-in (plan 2026-10-16)

Switched by `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED` (default off). On:

- The class page's Telegram button opens `t.me/<bot>?start=login`. The bot asks for the MasterSAT
  login, then the password, deletes the password message at once, and connects that Telegram
  account (`User.telegram_bot_user_id`). 5 wrong tries lock the Telegram account and the login
  for 15 minutes. The lc-up "last 4 digits" first-time code is not accepted here.
- `/guruhlar` (and `/start` once connected) shows one button per class group: ✅ inside, ➕ not yet
  (press → a one-time invite in the chat), 🔒 frozen. `/chiqish` disconnects.
- Opening the menu asks Telegram where the student is. A member from before the bot who is found
  inside becomes `identified_at` and is managed from then on — unless frozen at that moment, in
  which case the admin removes them from /ops → class → Telegram (forced removal, never a chat admin).
- A freeze sends one Uzbek message naming every group (debt vs admin wording); a lifted freeze
  sends "🔓" with a ➕ per group.

Payments: `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` (ISO date-time, empty = off). Each real
lc-up sync queues `send_telegram_payment_messages`; only `payment` rows lc-up created after that
moment and paid in the last 7 days are announced, once each (`LcupPayment.bot_notified_at`).

Switch-on order: deploy → `set_classroom_bot_webhook` (adds `callback_query`) → test in one
group → bot admin in every group + `/chatid` → flags → `announce_classroom_bot --send`.
```

- [ ] **Step 2: Run the whole backend surface**

Run: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test classes.tests_telegram_group classes.tests_telegram_bot classes.tests_telegram_payments classes.tests_telegram_ops classes.tests_classroom_details lcup.tests_finance lcup.tests_sync lcup.tests_audience users --settings=config.settings_test_nomigrations -v 1`
Expected: a literal `OK` on the last line. Anything else, including a crash summary, is red. Fix it before going on.

- [ ] **Step 3: Apply both migrations on a throwaway Postgres**

```bash
SP=/private/tmp/claude-501/-Users-macbook-Projects-DSAT-mock-exam/c639ac94-b76c-4247-af30-d56350758c9a/scratchpad
LC_ALL=C LANG=C initdb -D "$SP/pgdata" -U dsat_probe --auth=trust -E UTF8 --no-locale
LC_ALL=C LANG=C pg_ctl -D "$SP/pgdata" -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$SP/pg.log" -w start
cd backend && SECRET_KEY=test-secret DEBUG=True DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres python3 manage.py migrate classes 0056 && SECRET_KEY=test-secret DEBUG=True DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres python3 manage.py migrate lcup 0007
pg_ctl -D "$SP/pgdata" stop -m fast
```

Expected: both `migrate` runs end with `Applying classes.0056_… OK` / `Applying lcup.0007_… OK`.

Use a Python that has `psycopg2`: check with `python3 -c 'import psycopg2'`, and if that fails use `backend/.venv/bin/python` (memory `local-postgres-verify-orm-sql`). If the dependency chain stops on the known local `exams` duplicate `option_a_image` migration (memory `local-backend-test-command`), that is not this PR's problem. In that case, prove these two instead:
- `python3 manage.py sqlmigrate classes 0056` and `sqlmigrate lcup 0007` each print exactly one `ALTER TABLE … ADD COLUMN … NULL`, with no index and no `_like`;
- apply both statements by hand with `psql` to an empty table of the same name.

- [ ] **Step 4: Run the whole frontend surface**

Run (from `frontend/`): `npx vitest run src/features/classroom src/features/ops/classrooms`, then `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json`
Expected: all green; tsc exits 0.

- [ ] **Step 5: Refresh the graph and commit**

```bash
graphify update .
git add docs/CLASSROOM_TELEGRAM_GROUPS.md
git commit -m "docs(telegram): the class bot's sign-in, menu, messages and switch-on order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push origin HEAD:refs/heads/feat/classroom-telegram-bot
gh pr create --base main --head feat/classroom-telegram-bot --title "Class Telegram bot: sign-in, groups menu, payment messages, ops Telegram tab" --body-file /private/tmp/claude-501/-Users-macbook-Projects-DSAT-mock-exam/c639ac94-b76c-4247-af30-d56350758c9a/scratchpad/pr-classroom-telegram-bot.md
```

Write that body file first.

The PR body should cover:
- the six decisions;
- that both flags default to off;
- the two migrations;
- the test counts with their literal `OK`;
- the switch-on order from the docs section.

It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## After merge (owner-gated, not part of this plan's execution)

1. Zero-downtime release with a backup first. The migrations are additive and nullable, so migrate-first is safe (memory `zero-downtime-full-release-switch`).
2. Run `python manage.py set_classroom_bot_webhook --base-url https://mastersat.uz`, then `--show` must list `callback_query`.
3. Test in one group with one test student, end to end: sign in, ➕, join, freeze, removal message, unfreeze, menu.
4. **Admin:** make the bot an admin in each of the 24 groups (Invite users + Ban users), send `/chatid` in each group, and paste the id into /ops.
5. Turn on `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=True`. With the owner's go-ahead, run `announce_classroom_bot` (dry run), then `--send`.
6. Set `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` to the switch-on moment.
7. Separately: ask lc-up for a per-group balance (the message text is in the 2026-10-16 conversation). When it exists, decision 1's per-group lock becomes a rule change.
