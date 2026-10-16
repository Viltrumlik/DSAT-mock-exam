"""The class bot's own conversation (plan 2026-10-16): sign-in, the groups menu, the freeze and
unfreeze messages, and the rows the bot may act on.

Reuses the stand-in group from ``tests_telegram_group``: every Bot API call lands on
:class:`FakeTelegram`, so a test reads what the chat now holds — what was sent, what was
deleted — rather than which function was called with what.
"""

from __future__ import annotations

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from classes import telegram_group as tg
from classes import telegram_group_api as api
from classes import telegram_texts as T
from classes.models import Classroom, ClassroomMembership
from classes.models_telegram import ClassroomTelegramEvent, ClassroomTelegramMember
from classes.tests_telegram_group import CHAT, TelegramGroupBase

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
