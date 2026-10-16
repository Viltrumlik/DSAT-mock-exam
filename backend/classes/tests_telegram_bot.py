"""The class bot's own conversation (plan 2026-10-16): sign-in, the groups menu, the freeze and
unfreeze messages, and the rows the bot may act on.

Reuses the stand-in group from ``tests_telegram_group``: every Bot API call lands on
:class:`FakeTelegram`, so a test reads what the chat now holds — what was sent, what was
deleted — rather than which function was called with what.
"""

from __future__ import annotations

import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from classes import telegram_group as tg
from classes import telegram_group_api as api
from classes import telegram_texts as T
from classes.models import Classroom, ClassroomMembership
from classes.models_telegram import ClassroomTelegramEvent, ClassroomTelegramMember
from classes.tests_telegram_group import CHAT, TelegramGroupBase
from notifications import constants as note_const
from notifications.models import Notification
from users.models import SecurityAuditEvent

User = get_user_model()

JOINED = ClassroomTelegramMember.STATUS_JOINED
MANUAL = ClassroomTelegramMember.REASON_MANUAL


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

    def test_force_leaves_somebody_in_place_when_their_status_cannot_be_read(self):
        # A failed probe leaves the status empty, and an empty status matches no chat-admin
        # check. Forced past rules 1 and 3, an unprobed teacher's second account would go.
        row = self.member(self.student, 1001, status="administrator")
        row.invite_link = "https://t.me/+stale"
        row.save(update_fields=["invite_link"])
        self.tg.probe_should_fail = True

        self.assertFalse(tg.remove_member(row, reason=MANUAL, force=True))

        self.assertEqual(self.tg.kicked, [])
        row.refresh_from_db()
        self.assertEqual(row.status, JOINED)
        self.assertEqual(row.invite_link, "")
        self.assertIn("https://t.me/+stale", self.tg.revoked)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                classroom=self.classroom,
                action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR,
                telegram_user_id=1001,
            ).exists()
        )

    def test_the_sweep_removes_an_identified_frozen_member(self):
        self.member(self.student, 1001, identified=True)
        # Frozen without the hook, as when a worker was down at the time.
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 1)
        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        self.assertEqual(
            self.row(self.student).removed_reason, ClassroomTelegramMember.REASON_FROZEN
        )

    def test_the_sweep_leaves_an_unidentified_frozen_member_alone(self):
        self.member(self.student, 1001)
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 0)
        self.assertEqual(self.tg.kicked, [])


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

    def test_a_group_telegram_cannot_be_read_is_unknown_not_out(self):
        # A timeout, a 403 or a bad chat id says nothing about whether they are inside.
        self.tg.join(1001)
        self.tg.probe_should_fail = True
        self.assertEqual(tg.identify_memberships(self.student), {self.classroom.pk: tg.GROUP_UNKNOWN})
        self.assertIsNone(self.row(self.student))
        self.assertFalse(ClassroomTelegramEvent.objects.filter(user=self.student).exists())

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
        cache.delete_many([f"tgbot:lock:tg:{self.NEW_TG}", f"tgbot:lock:login:user:{self.newbie.pk}"])
        self.sign_in()
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)

    def test_the_lock_follows_the_login_to_another_telegram(self):
        for _ in range(5):
            self.sign_in(password="nope")
        self.sign_in(tg_id=6006)
        self.assertEqual(self.last(6006), T.LOCKED.format(minutes=15))

    def test_the_lock_is_the_accounts_not_the_spellings(self):
        # Four tries by the email and one by the username are five tries on ONE account. Each
        # try comes from its own Telegram, so only the account's own counter can reach five.
        for n in range(4):
            self.sign_in(login="newbie@t.com", password="nope", tg_id=7000 + n)
        self.sign_in(login="newbie", password="nope", tg_id=7004)
        self.assertEqual(self.last(7004), T.LOCKED.format(minutes=15))
        # The right password, from fresh Telegrams, by either spelling: still refused.
        self.sign_in(login="newbie@t.com", tg_id=7005)
        self.assertEqual(self.last(7005), T.LOCKED.format(minutes=15))
        self.sign_in(login="NewBie", tg_id=7006)
        self.assertEqual(self.last(7006), T.LOCKED.format(minutes=15))
        self.newbie.refresh_from_db()
        self.assertIsNone(self.newbie.telegram_bot_user_id)

    def test_every_phone_spelling_and_the_email_share_one_lock(self):
        phone = User.objects.create_user("p@t.com", self.PASSWORD, username="998901234567")
        spellings = ["p@t.com", "+998 90 123 45 67", "998901234567", "90-123-45-67", "P@T.com"]
        for n, login in enumerate(spellings):
            self.sign_in(login=login, password="nope", tg_id=7100 + n)
        self.sign_in(login="998901234567", tg_id=7200)
        self.assertEqual(self.last(7200), T.LOCKED.format(minutes=15))
        phone.refresh_from_db()
        self.assertIsNone(phone.telegram_bot_user_id)

    def test_a_login_naming_no_account_is_still_locked_by_its_spelling(self):
        for n in range(5):
            self.sign_in(login="Nobody@T.com", password="nope", tg_id=7300 + n)
        self.assertEqual(self.last(7304), T.LOCKED.format(minutes=15))
        self.sign_in(login="nobody@t.com", password="nope", tg_id=7400)
        self.assertEqual(self.last(7400), T.LOCKED.format(minutes=15))

    def test_signing_in_to_your_own_account_does_not_reset_the_telegrams_count(self):
        # Password spraying: four wrong tries against other people's logins, one real sign-in
        # to the attacker's own account (which used to wipe the Telegram's count), /chiqish,
        # and the count would start again from zero for ever. The Telegram's count only
        # expires on its own, so the fifth wrong try — however it is interleaved — locks.
        for login in ("tg_s1@t.com", "tg_s2@t.com", "tg_teacher@t.com", "nobody@t.com"):
            self.sign_in(login=login, password="nope")
        self.assertEqual(self.last(), T.WRONG.format(n=4, max=5))
        self.sign_in()  # newbie's own account, the right password
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)
        self.say("/chiqish")
        self.sign_in(login="tg_s1@t.com", password="nope")
        self.assertEqual(self.last(), T.LOCKED.format(minutes=15))

    def test_signing_in_does_clear_that_accounts_own_count(self):
        # The account's counter is the one a success settles: four wrong tries by its owner
        # from four phones, then the owner signs in, and the next stranger starts from one.
        for n in range(4):
            self.sign_in(password="nope", tg_id=7600 + n)
        self.assertIsNotNone(cache.get(f"tgbot:fail:login:user:{self.newbie.pk}"))
        self.sign_in()
        self.assertIsNone(cache.get(f"tgbot:fail:login:user:{self.newbie.pk}"))
        self.say("/chiqish")
        self.sign_in(password="nope", tg_id=7700)
        self.assertEqual(cache.get(f"tgbot:fail:login:user:{self.newbie.pk}"), 1)

    def test_a_login_typed_as_an_account_key_counts_against_nobody(self):
        # "user:<pk>" names no account, so it must not land on the key of account <pk>.
        for n in range(5):
            self.sign_in(login=f"user:{self.newbie.pk}", password="nope", tg_id=7500 + n)
        self.assertEqual(self.last(7504), T.LOCKED.format(minutes=15))
        self.assertIsNone(cache.get(f"tgbot:lock:login:user:{self.newbie.pk}"))
        self.sign_in()
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)

    def test_an_unknown_logins_key_is_a_hash_of_its_normalised_spelling(self):
        import hashlib

        from classes import telegram_bot

        digest = hashlib.sha256(b"nobody@t.com").hexdigest()
        self.assertEqual(telegram_bot._login_key("Nobody@T.com", None), f"name:{digest}")
        phone = hashlib.sha256(b"998901234567").hexdigest()
        self.assertEqual(telegram_bot._login_key("+998 90 123 45 67", None), f"name:{phone}")
        self.assertEqual(telegram_bot._login_key("anything", self.newbie), f"user:{self.newbie.pk}")

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

    def test_a_password_that_starts_with_a_slash_is_still_a_password(self):
        # Read as a command, it would be answered with the menu and left sitting in the chat.
        slashed = "/Pa55word!x"
        self.newbie.set_password(slashed)
        self.newbie.save()
        message_id = self.sign_in(password=slashed)
        self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)

    def test_a_wrong_password_that_starts_with_a_slash_is_deleted_and_counted(self):
        message_id = self.sign_in(password="/nope")
        self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)
        self.assertEqual(self.last(), T.WRONG.format(n=1, max=5))

    def test_a_password_that_only_begins_like_a_command_is_a_password(self):
        # "/start@2024" and "/guruhlar 1" are not the bot's commands, they are what a
        # student typed as a password: deleted, checked, counted.
        for password in ("/start@2024", "/guruhlar 1"):
            cache.clear()
            self.tg.deleted.clear()
            message_id = self.sign_in(password=password)
            self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)
            self.assertEqual(self.last(), T.WRONG.format(n=1, max=5))

    def test_such_a_password_signs_in_when_it_is_the_right_one(self):
        self.newbie.set_password("/start@2024")
        self.newbie.save()
        message_id = self.sign_in(password="/start@2024")
        self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)
        self.newbie.refresh_from_db()
        self.assertEqual(self.newbie.telegram_bot_user_id, self.NEW_TG)

    def test_the_command_addressed_to_this_bot_still_works_at_the_password_step(self):
        self.say("/start")
        self.say("newbie@t.com")
        self.say("/START@MasterSATTestBot")
        self.assertEqual(self.last(), T.ASK_LOGIN)
        self.assertEqual(self.tg.deleted, [])

    def test_a_command_addressed_to_another_bot_is_a_password_at_that_step(self):
        self.say("/start")
        self.say("newbie@t.com")
        message_id = self.say("/start@SomeOtherBot")
        self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted)

    def test_the_bots_own_commands_still_work_at_the_password_step(self):
        self.say("/start")
        self.say("newbie@t.com")
        self.say("/start")
        self.assertEqual(self.last(), T.ASK_LOGIN)
        self.assertEqual(self.tg.deleted, [])

    def test_the_bots_own_deep_link_at_the_password_step_restarts_the_sign_in(self):
        # The "open the bot" button sends "/start login". Pressed mid-sign-in it is the
        # student starting over, not a password: no wrong try, nothing deleted.
        self.say("/start")
        self.say("newbie@t.com")
        self.say("/start login")
        self.assertEqual(self.last(), T.ASK_LOGIN)
        self.assertEqual(self.tg.deleted, [])
        self.assertIsNone(cache.get(f"tgbot:fail:tg:{self.NEW_TG}"))
        self.assertIsNone(cache.get(f"tgbot:fail:login:user:{self.newbie.pk}"))
        self.say("newbie@t.com")
        self.assertEqual(self.last(), T.ASK_PASSWORD)

    def test_the_deep_link_in_any_case_or_addressed_to_this_bot_restarts_too(self):
        for text in ("  /START LOGIN ", "/start@MasterSATTestBot login", "/Start@mastersattestbot LOGIN"):
            cache.clear()
            self.tg.deleted.clear()
            self.say("/start")
            self.say("newbie@t.com")
            self.say(text)
            self.assertEqual(self.last(), T.ASK_LOGIN, text)
            self.assertEqual(self.tg.deleted, [], text)
            self.assertIsNone(cache.get(f"tgbot:fail:tg:{self.NEW_TG}"), text)

    def test_other_start_text_at_the_password_step_is_still_a_password(self):
        # Only the exact deep link is a command. A payload for another bot, an extra word or
        # a different payload is what a student typed as a password.
        for text in ("/start@SomeOtherBot login", "/start login now", "/start other", "/start  login"):
            cache.clear()
            self.tg.deleted.clear()
            self.say("/start")
            self.say("newbie@t.com")
            message_id = self.say(text)
            self.assertIn((str(self.NEW_TG), message_id), self.tg.deleted, text)
            self.assertEqual(self.last(), T.WRONG.format(n=1, max=5), text)

    def test_a_redis_error_in_the_update_dedupe_does_not_fail_the_webhook(self):
        from classes import views_telegram

        with mock.patch.object(views_telegram.cache, "add", side_effect=RuntimeError("redis down")):
            with self.assertLogs("classes.telegram_group", level="WARNING") as logged:
                self.say("/start")  # `post` asserts the webhook answered 200
        self.assertEqual(self.last(), T.ASK_LOGIN)
        self.assertIn("RuntimeError", "\n".join(logged.output))
        self.assertNotIn("/start", "\n".join(logged.output))  # the update itself is not logged

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

    def test_pressing_twice_resends_the_same_link_and_revokes_nothing(self):
        # A second tap used to mint a new link and revoke the one the first tap had just sent.
        self.press(f"g:{self.classroom.pk}")
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(len(self.tg.links), 1)
        self.assertEqual(self.tg.revoked, [])
        link = self.tg.links[0]
        sent = [body for chat, body in self.tg.messages if chat == "1001"]
        self.assertEqual(len(sent), 2)
        self.assertTrue(all(link in body for body in sent), sent)
        self.assertEqual(sent[1], T.INVITE.format(group="Junior G15 English", link=link, minutes=30))
        row = self.row(self.student)
        self.assertEqual(row.invite_link, link)
        self.assertEqual(row.invite_issued_count, 1)

    def test_the_minutes_left_are_rounded_up_and_never_below_one(self):
        self.press(f"g:{self.classroom.pk}")
        link = self.tg.links[0]
        for seconds, minutes in ((90, 2), (3000, 50), (5, 1)):
            ClassroomTelegramMember.objects.filter(classroom=self.classroom, user=self.student).update(
                invite_expires_at=timezone.now() + timedelta(seconds=seconds)
            )
            self.press(f"g:{self.classroom.pk}")
            self.assertEqual(
                self.last(1001),
                T.INVITE.format(group="Junior G15 English", link=link, minutes=minutes),
                seconds,
            )
        self.assertEqual(len(self.tg.links), 1)

    def test_an_expired_link_is_replaced_by_the_next_press(self):
        self.press(f"g:{self.classroom.pk}")
        first = self.tg.links[0]
        ClassroomTelegramMember.objects.filter(classroom=self.classroom, user=self.student).update(
            invite_expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.press(f"g:{self.classroom.pk}")
        self.assertEqual(len(self.tg.links), 2)
        second = self.tg.links[1]
        self.assertNotEqual(first, second)
        self.assertIn(first, self.tg.revoked)
        self.assertIn(second, self.last(1001))
        self.assertEqual(self.row(self.student).invite_link, second)

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
            Notification.objects.filter(recipient=self.student, event=note_const.EVENT_TELEGRAM_GROUP).count(), 2
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
