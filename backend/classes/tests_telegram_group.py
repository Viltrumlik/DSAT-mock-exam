"""The class Telegram group: who gets in, who gets taken out, and who must never be touched.

The Bot API is replaced by :class:`FakeTelegram`, which is a model of a group rather than a
pile of return values: it holds who is in the chat, which links exist, and who has been
kicked, so a test can assert on the *state of the group* after a webhook update rather than
on which function was called with what.
"""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import telegram_group as tg
from classes.models import Classroom, ClassroomMembership
from classes.models_telegram import (
    ClassroomTelegramEvent,
    ClassroomTelegramMember,
    TelegramStartToken,
)
from notifications.models import Notification

User = get_user_model()

CHAT = "-1001234567890"
BOT_ID = 777
BOT_USERNAME = "MasterSATTestBot"
TOKEN = f"{BOT_ID}:TESTTOKEN"


class FakeTelegram:
    """A stand-in group. Every Bot API function the feature calls is bound onto it."""

    def __init__(self):
        #: (chat_id, telegram_user_id) -> status string
        self.members: dict[tuple[str, int], str] = {(CHAT, BOT_ID): "administrator"}
        self.bot_rights = {"can_invite_users": True, "can_restrict_members": True}
        self.links: list[str] = []
        self.revoked: list[str] = []
        self.kicked: list[tuple[str, int]] = []
        self.messages: list[tuple[str, str]] = []
        self.create_should_fail = False
        self._n = 0

    # ── reads ────────────────────────────────────────────────────────────────
    def get_chat_member(self, chat_id, user_id):
        status = self.members.get((str(chat_id), int(user_id)))
        if status is None:
            return tg.api.TgResult(True, {"status": "left"})
        payload = {"status": status}
        if int(user_id) == BOT_ID:
            payload.update(self.bot_rights)
        return tg.api.TgResult(True, payload)

    def get_chat(self, chat_id):
        return tg.api.TgResult(True, {"title": "Junior G15 English"})

    def get_me(self):
        return tg.api.TgResult(True, {"id": BOT_ID, "is_bot": True, "username": BOT_USERNAME})

    def get_chat_member_count(self, chat_id):
        return tg.api.TgResult(True, len([k for k in self.members if k[0] == str(chat_id)]))

    # ── writes ───────────────────────────────────────────────────────────────
    def create_one_time_invite_link(self, chat_id, *, name, expire_unix, member_limit=1):
        if self.create_should_fail:
            return tg.api.TgResult(False, error_code=400, description="not enough rights")
        self._n += 1
        url = f"https://t.me/+fake{self._n}"
        self.links.append(url)
        return tg.api.TgResult(True, {"invite_link": url, "name": name})

    def revoke_invite_link(self, chat_id, invite_link):
        self.revoked.append(invite_link)
        return tg.api.TgResult(True, {})

    def kick_chat_member(self, chat_id, user_id):
        self.kicked.append((str(chat_id), int(user_id)))
        self.members.pop((str(chat_id), int(user_id)), None)
        return tg.api.TgResult(True, {})

    def send_message(self, chat_id, text):
        self.messages.append((str(chat_id), text))
        return tg.api.TgResult(True, {})

    # ── helpers ──────────────────────────────────────────────────────────────
    def join(self, telegram_user_id, status="member"):
        self.members[(CHAT, int(telegram_user_id))] = status

    def patches(self):
        return mock.patch.multiple(
            "classes.telegram_group_api",
            get_chat_member=self.get_chat_member,
            get_chat=self.get_chat,
            get_me=self.get_me,
            get_chat_member_count=self.get_chat_member_count,
            create_one_time_invite_link=self.create_one_time_invite_link,
            revoke_invite_link=self.revoke_invite_link,
            kick_chat_member=self.kick_chat_member,
            send_message=self.send_message,
        )


def chat_member_update(*, telegram_user, old="left", new="member", invite_link=None):
    """The shape Telegram POSTs for a ``chat_member`` update."""
    payload = {
        "chat": {"id": int(CHAT), "type": "supergroup", "title": "Junior G15 English"},
        "old_chat_member": {"user": telegram_user, "status": old},
        "new_chat_member": {"user": telegram_user, "status": new},
    }
    if invite_link:
        payload["invite_link"] = {"invite_link": invite_link, "member_limit": 1}
    return payload


@override_settings(
    CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CLASSROOM_TELEGRAM_WEBHOOK_SECRET="s3cr3t",
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_BROKER_URL="",
)
class TelegramGroupBase(TestCase):
    def setUp(self):
        # The join throttle counts through the shared cache, which outlives a test. Without
        # this the third test in a class starts already rate-limited.
        cache.clear()
        # `bot_username()` memoises per token and the token is the same in every test here,
        # so one run's fake @name would outlive it.
        tg.api._username_cache.clear()
        self.tg = FakeTelegram()
        self._patch = self.tg.patches()
        self._patch.start()
        self.addCleanup(self._patch.stop)

        self.client = APIClient()
        self.admin = User.objects.create_user("tg_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "tg_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_ENGLISH
        )
        self.student = User.objects.create_user("tg_s1@t.com", "secret123", telegram_bot_user_id=1001)
        self.other = User.objects.create_user("tg_s2@t.com", "secret123", telegram_bot_user_id=1002)

        self.classroom = Classroom.objects.create(
            name="Junior G15 English",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
            teacher=self.teacher,
            telegram_chat_id=CHAT,
        )
        for user, role in (
            (self.teacher, ClassroomMembership.ROLE_TEACHER),
            (self.student, ClassroomMembership.ROLE_STUDENT),
            (self.other, ClassroomMembership.ROLE_STUDENT),
        ):
            ClassroomMembership.objects.create(classroom=self.classroom, user=user, role=role)

    def join_url(self):
        return f"/api/classes/{self.classroom.pk}/telegram/join/"

    def issue_for(self, user) -> str:
        self.client.force_authenticate(user=user)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["invite_link"]

    def row(self, user):
        return ClassroomTelegramMember.objects.filter(
            classroom=self.classroom, user=user
        ).first()


class IssueInviteTests(TelegramGroupBase):
    def test_join_mints_a_single_use_link(self):
        link = self.issue_for(self.student)
        self.assertIn("t.me", link)
        row = self.row(self.student)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_PENDING)
        self.assertEqual(row.invite_link, link)
        self.assertEqual(row.invite_issued_count, 1)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_LINK_ISSUED, user=self.student
            ).exists()
        )

    def test_unlinked_telegram_is_refused_before_any_api_call(self):
        self.student.telegram_bot_user_id = None
        self.student.save(update_fields=["telegram_bot_user_id"])
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "telegram_not_linked")
        self.assertEqual(self.tg.links, [])

    def test_class_without_a_chat_id_says_so(self):
        self.classroom.telegram_chat_id = ""
        self.classroom.save(update_fields=["telegram_chat_id"])
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "no_group")

    def test_a_second_link_revokes_the_first(self):
        first = self.issue_for(self.student)
        second = self.issue_for(self.student)
        self.assertNotEqual(first, second)
        self.assertIn(first, self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, second)

    def test_already_in_the_group_mints_nothing(self):
        self.tg.join(1001)
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["already_member"])
        self.assertEqual(self.tg.links, [])
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_JOINED)

    def test_a_frozen_student_cannot_reach_the_endpoint(self):
        self.student.is_frozen = True
        self.student.save(update_fields=["is_frozen"])
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.tg.links, [])

    def test_a_non_member_cannot_get_a_link(self):
        outsider = User.objects.create_user("tg_out@t.com", "secret123", telegram_bot_user_id=1009)
        self.client.force_authenticate(user=outsider)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertIn(r.status_code, (403, 404))
        self.assertEqual(self.tg.links, [])

    def test_a_telegram_failure_is_reported_not_swallowed(self):
        self.tg.create_should_fail = True
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertIn("administrator", r.json()["detail"])
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR
            ).exists()
        )

    def test_state_endpoint_describes_the_rules(self):
        self.client.force_authenticate(user=self.student)
        r = self.client.get(f"/api/classes/{self.classroom.pk}/telegram/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["managed"])
        self.assertTrue(body["telegram_linked"])
        self.assertEqual(body["status"], "NONE")
        self.assertTrue(any("frozen" in rule.lower() for rule in body["rules"]))

    def test_an_expired_ticket_is_not_offered_back(self):
        self.issue_for(self.student)
        row = self.row(self.student)
        row.invite_expires_at = timezone.now() - timedelta(minutes=1)
        row.save(update_fields=["invite_expires_at"])
        self.client.force_authenticate(user=self.student)
        body = self.client.get(f"/api/classes/{self.classroom.pk}/telegram/").json()
        self.assertEqual(body["invite_link"], "")


class JoinVerificationTests(TelegramGroupBase):
    def test_the_right_account_is_let_in(self):
        link = self.issue_for(self.student)
        self.tg.join(1001)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001, "first_name": "Aziz"}, invite_link=link)
        )
        self.assertEqual(outcome, "joined")
        row = self.row(self.student)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertEqual(row.telegram_user_id, 1001)
        self.assertEqual(row.invite_link, "")
        self.assertEqual(self.tg.kicked, [])

    def test_somebody_elses_account_on_the_link_is_removed(self):
        link = self.issue_for(self.student)
        self.tg.join(1002)  # `other`, using a link cut for `student`
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1002, "first_name": "Not Aziz"}, invite_link=link)
        )
        self.assertEqual(outcome, "rejected_identity_mismatch")
        self.assertEqual(self.tg.kicked, [(CHAT, 1002)])
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_JOIN_REJECTED,
                reason=ClassroomTelegramMember.REASON_IDENTITY_MISMATCH,
            ).exists()
        )
        # The ticket is spent either way, so its owner has to come back for another.
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_a_stranger_on_the_link_is_removed_too(self):
        """Unknown-account safety does NOT extend to somebody using a stolen ticket."""
        link = self.issue_for(self.student)
        self.tg.join(9999)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 9999, "first_name": "Nobody"}, invite_link=link)
        )
        self.assertEqual(self.tg.kicked, [(CHAT, 9999)])

    def test_a_classmate_who_joined_by_other_means_is_adopted(self):
        self.tg.join(1002)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1002, "first_name": "Dilnoza"})
        )
        self.assertEqual(outcome, "adopted")
        self.assertEqual(self.row(self.other).status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertEqual(self.tg.kicked, [])

    def test_an_unrecognised_account_is_recorded_never_kicked(self):
        self.tg.join(555000)
        outcome = tg.handle_chat_member_update(
            chat_member_update(
                telegram_user={"id": 555000, "first_name": "Parent", "username": "someone"}
            )
        )
        self.assertEqual(outcome, "unmanaged")
        self.assertEqual(self.tg.kicked, [])
        row = ClassroomTelegramMember.objects.get(
            classroom=self.classroom, telegram_user_id=555000
        )
        self.assertIsNone(row.user_id)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_UNMANAGED_JOIN
            ).exists()
        )

    def test_a_removed_student_who_walks_back_in_is_removed_again(self):
        membership = ClassroomMembership.objects.get(classroom=self.classroom, user=self.other)
        membership.status = ClassroomMembership.STATUS_REMOVED
        membership.save(update_fields=["status"])
        self.tg.join(1002)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1002, "first_name": "Dilnoza"})
        )
        self.assertEqual(outcome, "removed_ineligible")
        self.assertEqual(self.tg.kicked, [(CHAT, 1002)])

    def test_a_teacher_is_never_removed(self):
        """Even a teacher who is in no class group row and holds no ticket."""
        self.teacher.telegram_bot_user_id = 2001
        self.teacher.save(update_fields=["telegram_bot_user_id"])
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.teacher
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.tg.join(2001, status="administrator")
        tg.handle_chat_member_update(
            chat_member_update(
                telegram_user={"id": 2001, "first_name": "Teacher"},
                new="administrator",
            )
        )
        self.assertEqual(self.tg.kicked, [])

    def test_leaving_is_recorded(self):
        link = self.issue_for(self.student)
        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, invite_link=link)
        )
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, old="member", new="left")
        )
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_LEFT)

    def test_an_update_for_an_unknown_chat_is_ignored(self):
        payload = chat_member_update(telegram_user={"id": 1001})
        payload["chat"]["id"] = -100999
        self.assertEqual(tg.handle_chat_member_update(payload), "unknown_chat")


class FreezeTests(TelegramGroupBase):
    def _put_in_group(self, user, telegram_id):
        link = self.issue_for(user)
        self.tg.join(telegram_id)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": telegram_id}, invite_link=link)
        )
        return link

    def test_freezing_removes_from_the_group_but_not_from_the_class(self):
        self._put_in_group(self.student, 1001)

        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])

        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        row = self.row(self.student)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_REMOVED)
        self.assertEqual(row.removed_reason, ClassroomTelegramMember.REASON_FROZEN)
        # The half the school was explicit about: they stay in the class here.
        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.student
        )
        self.assertEqual(membership.status, ClassroomMembership.STATUS_ACTIVE)

    def test_freezing_revokes_a_link_that_was_never_used(self):
        link = self.issue_for(self.student)
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        self.assertIn(link, self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_the_student_is_told_why(self):
        self._put_in_group(self.student, 1001)
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        note = Notification.objects.filter(
            recipient=self.student, event="TELEGRAM_GROUP"
        ).first()
        self.assertIsNotNone(note)
        self.assertIn("frozen", note.body.lower())
        self.assertIn(f"/classes/{self.classroom.pk}", note.link_url)

    def test_unfreezing_does_not_put_them_back(self):
        self._put_in_group(self.student, 1001)
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        self.tg.links.clear()

        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = False
            self.student.save(update_fields=["is_frozen"])

        # Nothing automatic — no link, no re-invite. The student comes back and presses.
        self.assertEqual(self.tg.links, [])
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_REMOVED)

        link = self.issue_for(self.student)
        self.assertTrue(link)
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_PENDING)

    def test_an_ordinary_save_does_not_touch_the_group(self):
        self._put_in_group(self.student, 1001)
        with self.captureOnCommitCallbacks(execute=True):
            self.student.first_name = "Aziz"
            self.student.save()
        self.assertEqual(self.tg.kicked, [])

    def test_freezing_a_teacher_removes_nobody(self):
        """Rule 2 again, at the freeze end: only students are ever taken out."""
        self.teacher.telegram_bot_user_id = 2001
        self.teacher.save(update_fields=["telegram_bot_user_id"])
        ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=self.teacher, telegram_user_id=2001,
            status=ClassroomTelegramMember.STATUS_JOINED,
            # Watched in, so rule 3 lets this get as far as rule 2 — otherwise the test
            # passes whether or not the rule it is named after still exists.
            observed_arrival_at=timezone.now(),
        )
        self.tg.join(2001)
        with self.captureOnCommitCallbacks(execute=True):
            self.teacher.is_frozen = True
            self.teacher.save(update_fields=["is_frozen"])
        self.assertEqual(self.tg.kicked, [])

    def test_removal_from_the_class_removes_from_the_group(self):
        self._put_in_group(self.student, 1001)
        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.student
        )
        with self.captureOnCommitCallbacks(execute=True):
            membership.status = ClassroomMembership.STATUS_REMOVED
            membership.save(update_fields=["status"])
        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        self.assertEqual(
            self.row(self.student).removed_reason,
            ClassroomTelegramMember.REASON_NOT_IN_CLASS,
        )


class MembersFromBeforeTheBotTests(TelegramGroupBase):
    """Rule 3: a class group is switched on with people already in it, and those people are
    not the bot's to remove.

    It never watched them arrive; the Bot API cannot even list them. The one way across the
    line is the one a person takes on their own — leave, and come back.
    """

    def _already_inside(self, user, telegram_id):
        """In the group since before the bot: no ``chat_member`` update ever mentioned them.

        They then press Join on the site, which is what gives the site a row at all — a
        ``getChatMember`` probe says they are inside, and that is precisely the evidence
        rule 3 refuses to act on.
        """
        self.tg.join(telegram_id)
        self.client.force_authenticate(user=user)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["already_member"])
        row = self.row(user)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertFalse(row.is_watched)
        return row

    def test_freezing_leaves_a_member_from_before_where_they_are(self):
        self._already_inside(self.student, 1001)

        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])

        self.assertEqual(self.tg.kicked, [])
        # And the row still says what is true: they are in the group.
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_RECONCILED,
                user=self.student,
                detail__contains="before the bot began watching",
            ).exists()
        )

    def test_they_are_not_told_they_were_removed(self):
        """The freeze notification says "you are out of the group". Sending it to somebody
        who is still in it would be a lie the student can see through in one tap."""
        self._already_inside(self.student, 1001)
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        self.assertFalse(
            Notification.objects.filter(recipient=self.student, event="TELEGRAM_GROUP").exists()
        )

    def test_an_outstanding_ticket_is_still_burned(self):
        """The half of "remove" that does not depend on having watched them arrive. They
        walked in unseen while a link of theirs was still live; the link must not stay live.
        """
        link = self.issue_for(self.student)
        self.tg.join(1001)  # in, with no update to say so

        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])

        self.assertEqual(self.tg.kicked, [])
        self.assertIn(link, self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_leaving_the_class_does_not_pull_them_out_of_the_group(self):
        self._already_inside(self.student, 1001)
        membership = ClassroomMembership.objects.get(
            classroom=self.classroom, user=self.student
        )
        with self.captureOnCommitCallbacks(execute=True):
            membership.status = ClassroomMembership.STATUS_REMOVED
            membership.save(update_fields=["status"])
        self.assertEqual(self.tg.kicked, [])

    def test_the_sweep_walks_past_them_without_a_word(self):
        self._already_inside(self.student, 1001)
        self.student.is_frozen = True
        # Straight to the column: the freeze hook has its own test above, and this one is
        # about what the half-hourly pass does with a row it finds already ineligible.
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        before = ClassroomTelegramEvent.objects.count()

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 0)
        self.assertEqual(self.tg.kicked, [])
        # Forty-eight passes a day: a rule that logged every time it declined would bury the
        # events somebody actually needs to read.
        self.assertEqual(ClassroomTelegramEvent.objects.count(), before)

    def test_leaving_and_coming_back_puts_them_under_the_bot(self):
        """The one crossing there is. They go out of the door themselves, and the way back
        in is the door everybody else uses — which the bot is watching."""
        self._already_inside(self.student, 1001)

        # Out, of their own accord.
        self.tg.members.pop((CHAT, 1001), None)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, old="member", new="left")
        )
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_LEFT)

        # And back in, on a ticket.
        link = self.issue_for(self.student)
        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, invite_link=link)
        )
        row = self.row(self.student)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertTrue(row.is_watched)

        # From here they are managed like anybody else.
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_REMOVED)

    def test_coming_back_through_the_old_static_link_counts_too(self):
        """Watched is watched. The bot saw the arrival; how they were let in is a different
        question, and the adopted path already answers it."""
        self._already_inside(self.other, 1002)
        self.tg.members.pop((CHAT, 1002), None)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1002}, old="member", new="left")
        )
        self.tg.join(1002)
        tg.handle_chat_member_update(chat_member_update(telegram_user={"id": 1002}))

        row = self.row(self.other)
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertTrue(row.is_watched)

    def test_staff_can_see_who_the_bot_will_not_act_on(self):
        self._already_inside(self.student, 1001)
        self.client.force_authenticate(user=self.teacher)
        body = self.client.get(f"/api/classes/{self.classroom.pk}/telegram/members/").json()
        mine = next(r for r in body["members"] if r["user_id"] == self.student.pk)
        self.assertFalse(mine["watched"])
        self.assertFalse(mine["unmanaged"])  # known account — just not one the bot let in


class AuditSweepTests(TelegramGroupBase):
    def _put_in_group(self, user, telegram_id):
        link = self.issue_for(user)
        self.tg.join(telegram_id)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": telegram_id}, invite_link=link)
        )

    def test_a_frozen_student_the_webhook_missed_is_swept_out(self):
        self._put_in_group(self.student, 1001)
        # Freeze without the hook, standing in for a worker that was down at the time.
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 1)
        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        self.assertEqual(
            self.row(self.student).removed_reason, ClassroomTelegramMember.REASON_FROZEN
        )

    def test_a_student_who_quietly_left_is_reconciled(self):
        self._put_in_group(self.student, 1001)
        self.tg.members.pop((CHAT, 1001))

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["reconciled"], 1)
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_LEFT)
        self.assertEqual(self.tg.kicked, [])

    def test_a_present_and_eligible_student_is_left_alone(self):
        self._put_in_group(self.student, 1001)
        result = tg.audit_classroom(self.classroom, sleep=0)
        self.assertEqual(result["removed"], 0)
        self.assertEqual(self.tg.kicked, [])
        self.assertIsNotNone(self.row(self.student).last_checked_at)

    def test_a_demoted_bot_stops_the_sweep_rather_than_guessing(self):
        self._put_in_group(self.student, 1001)
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        self.tg.members[(CHAT, BOT_ID)] = "member"  # no longer an admin

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertIn("administrator", result["problem"])
        self.assertEqual(self.tg.kicked, [])
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR
            ).exists()
        )

    def test_a_bot_that_cannot_remove_members_is_a_reported_problem(self):
        self.tg.bot_rights["can_restrict_members"] = False
        health = tg.group_health(self.classroom)
        self.assertFalse(health.ok)
        self.assertIn("remove members", health.problem)

    def test_expired_tickets_are_cleared(self):
        link = self.issue_for(self.student)
        row = self.row(self.student)
        row.invite_expires_at = timezone.now() - timedelta(minutes=1)
        row.save(update_fields=["invite_expires_at"])

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["tickets_expired"], 1)
        self.assertIn(link, self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_audit_all_skips_classes_with_no_group(self):
        Classroom.objects.create(
            name="No group", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_EVEN, created_by=self.admin,
        )
        totals = tg.audit_all(sleep=0)
        self.assertEqual(totals["classrooms"], 1)


class WebhookEndpointTests(TelegramGroupBase):
    URL = "/api/classes/telegram/webhook/"

    def test_wrong_secret_is_refused(self):
        r = self.client.post(
            self.URL, {"chat_member": {}}, format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="wrong",
        )
        self.assertEqual(r.status_code, 403)

    @override_settings(CLASSROOM_TELEGRAM_WEBHOOK_SECRET="")
    def test_no_configured_secret_fails_closed(self):
        r = self.client.post(
            self.URL, {"chat_member": {}}, format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="anything",
        )
        self.assertEqual(r.status_code, 503)

    def test_a_join_arrives_through_the_endpoint(self):
        link = self.issue_for(self.student)
        self.tg.join(1001)
        self.client.force_authenticate(user=None)
        r = self.client.post(
            self.URL,
            {"chat_member": chat_member_update(telegram_user={"id": 1001}, invite_link=link)},
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_JOINED)

    def test_a_malformed_update_is_acknowledged_not_retried_forever(self):
        r = self.client.post(
            self.URL, {"chat_member": {"chat": None}}, format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )
        self.assertEqual(r.status_code, 200)

    def test_chatid_command_answers_with_the_group_id(self):
        self.client.post(
            self.URL,
            {"message": {"chat": {"id": -100555, "type": "supergroup", "title": "G"}, "text": "/chatid"}},
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )
        self.assertTrue(self.tg.messages)
        self.assertIn("-100555", self.tg.messages[-1][1])


class StaffViewTests(TelegramGroupBase):
    def url(self):
        return f"/api/classes/{self.classroom.pk}/telegram/members/"

    def test_a_teacher_sees_the_health_and_the_roster(self):
        self.issue_for(self.student)
        self.client.force_authenticate(user=self.teacher)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["health"]["ok"])
        self.assertEqual(body["health"]["chat_id"], CHAT)
        self.assertEqual(len(body["members"]), 1)

    def test_a_student_may_not_read_it(self):
        self.client.force_authenticate(user=self.student)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 403)


class SharedGroupTests(TelegramGroupBase):
    """One Telegram group, two classes — ``telegram_chat_id`` is not unique and never was.

    A teacher who takes two classes may well run a single group for both. Reading the chat as
    one classroom checks each arrival against the wrong roster, and removes students who
    belong there.
    """

    def setUp(self):
        super().setUp()
        self.second = Classroom.objects.create(
            name="Middle G20 English",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_EVEN,
            created_by=self.admin,
            teacher=self.teacher,
            telegram_chat_id=CHAT,  # the same group
        )
        self.second_student = User.objects.create_user(
            "tg_s3@t.com", "secret123", telegram_bot_user_id=1003
        )
        ClassroomMembership.objects.create(
            classroom=self.second, user=self.second_student,
            role=ClassroomMembership.ROLE_STUDENT,
        )

    def test_a_student_of_the_other_class_is_not_thrown_out(self):
        self.tg.join(1003)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1003, "first_name": "Sardor"})
        )
        self.assertEqual(outcome, "adopted")
        self.assertEqual(self.tg.kicked, [])
        row = ClassroomTelegramMember.objects.get(
            classroom=self.second, user=self.second_student
        )
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)

    def test_a_ticket_is_honoured_whichever_class_it_came_from(self):
        self.client.force_authenticate(user=self.second_student)
        r = self.client.post(f"/api/classes/{self.second.pk}/telegram/join/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        link = r.json()["invite_link"]

        self.tg.join(1003)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1003}, invite_link=link)
        )
        self.assertEqual(outcome, "joined")
        self.assertEqual(self.tg.kicked, [])

    def test_leaving_the_group_leaves_both_classes(self):
        for user, tg_id, classroom in (
            (self.student, 1001, self.classroom),
            (self.second_student, 1003, self.second),
        ):
            ClassroomTelegramMember.objects.update_or_create(
                classroom=classroom, user=user,
                defaults={
                    "telegram_user_id": tg_id,
                    "status": ClassroomTelegramMember.STATUS_JOINED,
                },
            )
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1003}, old="member", new="left")
        )
        self.assertEqual(
            ClassroomTelegramMember.objects.get(
                classroom=self.second, user=self.second_student
            ).status,
            ClassroomTelegramMember.STATUS_LEFT,
        )


class AdoptionTicketTests(TelegramGroupBase):
    def test_joining_another_way_retires_the_outstanding_link(self):
        """They hold a live single-use link and walk in some other way.

        The link is still a working credential for a group they are now inside, so it has to
        be revoked — otherwise the one person it could still admit is somebody it was not cut
        for, who would then be removed for it.
        """
        link = self.issue_for(self.student)
        self.tg.join(1001)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001, "first_name": "Aziz"})
        )
        self.assertEqual(outcome, "adopted")
        self.assertIn(link, self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_a_teacher_who_walks_in_is_recorded_as_known_not_a_stranger(self):
        self.teacher.telegram_bot_user_id = 2001
        self.teacher.save(update_fields=["telegram_bot_user_id"])
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.teacher
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.tg.join(2001, status="administrator")
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 2001}, new="administrator")
        )
        self.assertEqual(outcome, "left_in_place")
        self.assertFalse(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_UNMANAGED_JOIN
            ).exists()
        )


class FailedRemovalTests(TelegramGroupBase):
    """A kick that Telegram refuses must stay visible to the next sweep."""

    def setUp(self):
        super().setUp()
        link = self.issue_for(self.student)
        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, invite_link=link)
        )

    def _refuse_kicks(self):
        def refuse(chat_id, user_id):
            return tg.api.TgResult(False, error_code=400, description="not enough rights")

        return mock.patch("classes.telegram_group_api.kick_chat_member", refuse)

    def test_a_refused_kick_leaves_the_row_joined(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        with self._refuse_kicks():
            result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 0)
        row = self.row(self.student)
        # Still JOINED, because they still ARE in the group. Marking them removed would take
        # the row out of the sweep's sight and strand them there for ever.
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR
            ).exists()
        )

    def test_the_next_sweep_tries_again_and_succeeds(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        with self._refuse_kicks():
            tg.audit_classroom(self.classroom, sleep=0)

        result = tg.audit_classroom(self.classroom, sleep=0)
        self.assertEqual(result["removed"], 1)
        self.assertEqual(self.tg.kicked, [(CHAT, 1001)])
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_REMOVED)

    def test_the_link_is_burned_even_when_the_kick_fails(self):
        # The row is put into this state by hand because no ordinary path produces it — the
        # invariant being proved is precisely that a removal burns the credential before it
        # tries the kick, so the two cannot come apart if one of them fails.
        row = self.row(self.student)
        row.invite_link = "https://t.me/+leftover"
        row.invite_expires_at = timezone.now() + timedelta(minutes=10)
        row.save(update_fields=["invite_link", "invite_expires_at"])

        with self._refuse_kicks():
            removed = tg.remove_member(
                self.row(self.student), reason=ClassroomTelegramMember.REASON_FROZEN
            )

        self.assertFalse(removed)
        self.assertIn("https://t.me/+leftover", self.tg.revoked)
        self.assertEqual(self.row(self.student).invite_link, "")

    def test_the_student_is_not_told_they_are_out_when_they_are_not(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        with self._refuse_kicks():
            tg.audit_classroom(self.classroom, sleep=0)
        self.assertFalse(
            Notification.objects.filter(
                recipient=self.student, event="TELEGRAM_GROUP"
            ).exists()
        )


class BotDeepLinkTests(TelegramGroupBase):
    """How the site learns a person's Bot API id, which is the only identity that counts at
    the group door.

    It cannot be looked up. ``User.telegram_id`` holds the subject of an
    ``oauth.telegram.org`` sign-in — a different number for the same human, 17-19 digits
    against 9-11 — and comparing the two rejected every genuine join the feature ever saw.
    So the student is handed a single-use ``/start`` link, and pressing Start in Telegram is
    the introduction: that one update carries the token and the Bot API id together.
    """

    def bot_link_url(self):
        return f"/api/classes/{self.classroom.pk}/telegram/bot-link/"

    def mint_link(self, user):
        self.client.force_authenticate(user=user)
        r = self.client.post(self.bot_link_url(), {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["bot_link"]

    def start(self, telegram_id, payload="", first_name="Aziz"):
        text = f"/start {payload}".strip()
        return self.client.post(
            "/api/classes/telegram/webhook/",
            {
                "message": {
                    "chat": {"id": telegram_id, "type": "private"},
                    "from": {"id": telegram_id, "first_name": first_name},
                    "text": text,
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )

    def unbound(self):
        """A student the bot has never met — the state every real student starts in."""
        self.student.telegram_bot_user_id = None
        self.student.save(update_fields=["telegram_bot_user_id"])

    def test_the_link_points_at_this_bot_and_carries_a_token(self):
        self.unbound()
        url = self.mint_link(self.student)
        self.assertTrue(url.startswith(f"https://t.me/{BOT_USERNAME}?start="))
        token = url.split("start=")[1]
        # Telegram truncates a /start payload past 64 characters, silently.
        self.assertLessEqual(len(token), 64)
        row = TelegramStartToken.objects.get(token=token)
        self.assertEqual(row.user_id, self.student.pk)
        self.assertEqual(row.classroom_id, self.classroom.pk)
        self.assertTrue(row.is_open())

    def test_pressing_start_binds_the_account_and_sends_the_invite(self):
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]

        self.start(1001, payload=token)

        self.student.refresh_from_db()
        self.assertEqual(self.student.telegram_bot_user_id, 1001)
        self.assertIsNotNone(TelegramStartToken.objects.get(token=token).used_at)
        # One invite, sent to the chat that just identified itself.
        self.assertEqual(len(self.tg.links), 1)
        sent = " ".join(body for chat, body in self.tg.messages if chat == "1001")
        self.assertIn(self.tg.links[0], sent)

    def test_and_then_the_door_opens(self):
        """End to end: the bug that started all this. Bind, take the ticket, walk in."""
        self.unbound()
        # A Telegram sign-in has also happened, leaving an OIDC subject on the account. It
        # must have no bearing on the check at the door.
        self.student.telegram_id = 2717500225591788993
        self.student.save(update_fields=["telegram_id"])

        token = self.mint_link(self.student).split("start=")[1]
        self.start(1001, payload=token)
        link = self.tg.links[0]

        self.tg.join(1001)
        outcome = tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, invite_link=link)
        )

        self.assertEqual(outcome, "joined")
        self.assertEqual(self.tg.kicked, [])
        self.assertEqual(self.row(self.student).status, ClassroomTelegramMember.STATUS_JOINED)

    def test_a_token_works_once(self):
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]
        self.start(1001, payload=token)
        self.tg.messages.clear()

        self.start(9999, payload=token)

        self.student.refresh_from_db()
        self.assertEqual(self.student.telegram_bot_user_id, 1001)  # unmoved
        self.assertIn("already been used", self.tg.messages[-1][1])

    def test_minting_a_second_link_kills_the_first(self):
        """Two live tokens means two accounts can bind, and only one is holding the screen."""
        self.unbound()
        first = self.mint_link(self.student).split("start=")[1]
        self.mint_link(self.student)

        self.start(9999, payload=first)

        self.student.refresh_from_db()
        self.assertIsNone(self.student.telegram_bot_user_id)
        self.assertIn("already been used", self.tg.messages[-1][1])

    def test_an_expired_token_is_refused(self):
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]
        TelegramStartToken.objects.filter(token=token).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )
        self.start(1001, payload=token)
        self.student.refresh_from_db()
        self.assertIsNone(self.student.telegram_bot_user_id)
        self.assertIn("expired", self.tg.messages[-1][1])

    def test_a_telegram_account_already_bound_elsewhere_is_refused(self):
        """`telegram_bot_user_id` is unique, so the alternative to refusing is a 500 — and
        the honest reading is that somebody is holding the wrong phone."""
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]

        self.start(1002, payload=token)  # 1002 is self.other's account

        self.student.refresh_from_db()
        self.other.refresh_from_db()
        self.assertIsNone(self.student.telegram_bot_user_id)
        self.assertEqual(self.other.telegram_bot_user_id, 1002)
        self.assertIn("different MasterSAT account", self.tg.messages[-1][1])
        self.assertEqual(self.tg.links, [])

    def test_a_frozen_student_is_bound_but_gets_no_link(self):
        """The binding is about identity; the invite is about eligibility. Refusing the
        first would leave them unreachable by the message explaining the second."""
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)

        self.start(1001, payload=token)

        self.student.refresh_from_db()
        self.assertEqual(self.student.telegram_bot_user_id, 1001)
        self.assertEqual(self.tg.links, [])
        self.assertIn("frozen", self.tg.messages[-1][1].lower())

    def test_a_student_already_in_the_group_is_told_so(self):
        self.unbound()
        token = self.mint_link(self.student).split("start=")[1]
        self.tg.join(1001)

        self.start(1001, payload=token)

        self.assertEqual(self.tg.links, [])
        self.assertIn("already in the", self.tg.messages[-1][1])

    def test_a_frozen_student_cannot_even_mint_the_link(self):
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        # Straight to the column above, so the freeze hook stays out of this test — but the
        # request is then authenticated with an object that predates the write, and the
        # permission class reads `request.user`. Refresh or the test proves nothing.
        self.student.refresh_from_db()
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.bot_link_url(), {}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(TelegramStartToken.objects.count(), 0)

    def test_a_class_with_no_group_offers_no_link(self):
        self.classroom.telegram_chat_id = ""
        self.classroom.save(update_fields=["telegram_chat_id"])
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.bot_link_url(), {}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["code"], "no_group")


class BotDirectMessageTests(TelegramGroupBase):
    """`/start` is what opens the DM channel — a bot may not message anyone first."""

    URL = "/api/classes/telegram/webhook/"

    def _start(self, telegram_id, chat_type="private"):
        return self.client.post(
            self.URL,
            {
                "message": {
                    "chat": {"id": telegram_id, "type": chat_type},
                    "from": {"id": telegram_id, "first_name": "Aziz"},
                    "text": "/start",
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )

    def test_a_connected_student_is_greeted_by_name(self):
        self.student.first_name = "Aziz"
        self.student.save(update_fields=["first_name"])
        self._start(1001)
        self.assertTrue(self.tg.messages)
        body = self.tg.messages[-1][1]
        self.assertIn("Aziz", body)
        self.assertIn("Join Telegram group", body)

    def test_an_unknown_account_is_told_to_connect_first(self):
        self._start(987654)
        self.assertIn("Join Telegram", self.tg.messages[-1][1])

    def test_the_bot_never_hands_out_a_link_over_dm(self):
        """Joining is decided on the classroom page, where the checks are."""
        self._start(1001)
        self.assertNotIn("t.me/+", self.tg.messages[-1][1])
        self.assertEqual(self.tg.links, [])

    def test_start_in_a_group_is_ignored(self):
        self._start(int(CHAT), chat_type="supergroup")
        self.assertEqual(self.tg.messages, [])


class HtmlEscapingTests(TelegramGroupBase):
    """Every DM goes out with parse_mode=HTML, and Telegram rejects the WHOLE message when
    the markup does not parse. Nothing checks the result of a courtesy message, so an
    unescaped ampersand does not fail loudly — it just stops that person's DMs for ever."""

    def test_a_class_name_with_markup_characters_is_escaped(self):
        self.classroom.name = "Junior <G15> & Math"
        self.classroom.save(update_fields=["name"])
        self.issue_for(self.student)
        body = self.tg.messages[-1][1]
        self.assertIn("Junior &lt;G15&gt; &amp; Math", body)
        self.assertNotIn("<G15>", body)

    def test_a_removal_notice_escapes_the_class_name(self):
        self.classroom.name = "R&W <Senior>"
        self.classroom.save(update_fields=["name"])
        link = self.issue_for(self.student)
        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001}, invite_link=link)
        )
        with self.captureOnCommitCallbacks(execute=True):
            self.student.is_frozen = True
            self.student.save(update_fields=["is_frozen"])
        body = self.tg.messages[-1][1]
        self.assertIn("R&amp;W &lt;Senior&gt;", body)

    def test_a_students_name_is_escaped_in_the_greeting(self):
        self.student.first_name = "A<b>z</b>iz & Co"
        self.student.save(update_fields=["first_name"])
        self.client.post(
            "/api/classes/telegram/webhook/",
            {
                "message": {
                    "chat": {"id": 1001, "type": "private"},
                    "from": {"id": 1001},
                    "text": "/start",
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )
        body = self.tg.messages[-1][1]
        self.assertIn("A&lt;b&gt;z&lt;/b&gt;iz &amp; Co", body)

    def test_a_group_title_is_escaped_in_the_chatid_reply(self):
        self.client.post(
            "/api/classes/telegram/webhook/",
            {
                "message": {
                    "chat": {"id": -100555, "type": "supergroup", "title": "G15 <eng> & math"},
                    "text": "/chatid",
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cr3t",
        )
        self.assertIn("G15 &lt;eng&gt; &amp; math", self.tg.messages[-1][1])


class DeletedAccountTests(TelegramGroupBase):
    """Deleting an account does not delete the person out of the Telegram group."""

    def test_the_group_record_outlives_the_account(self):
        link = self.issue_for(self.student)
        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(
                telegram_user={"id": 1001, "username": "aziz_t"}, invite_link=link
            )
        )
        self.student.delete()

        row = ClassroomTelegramMember.objects.get(
            classroom=self.classroom, telegram_user_id=1001
        )
        self.assertIsNone(row.user_id)
        self.assertEqual(row.telegram_username, "aziz_t")
        # Rule 1: after the delete the bot genuinely cannot account for them, so it reports
        # rather than removes. The handle is what lets a person do it by hand.
        self.assertEqual(self.tg.kicked, [])

    def test_the_sweep_leaves_an_orphaned_row_alone_and_quietly(self):
        ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=None, telegram_user_id=4242,
            status=ClassroomTelegramMember.STATUS_JOINED,
        )
        self.tg.join(4242)
        before = ClassroomTelegramEvent.objects.count()

        result = tg.audit_classroom(self.classroom, sleep=0)

        self.assertEqual(result["removed"], 0)
        self.assertEqual(self.tg.kicked, [])
        # And no event per pass: a half-hourly sweep that logged one of these for ever would
        # bury the events that matter.
        self.assertEqual(ClassroomTelegramEvent.objects.count(), before)

    def test_staff_see_the_orphan_as_unmanaged(self):
        ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=None, telegram_user_id=4242,
            telegram_username="ghost", status=ClassroomTelegramMember.STATUS_JOINED,
        )
        self.client.force_authenticate(user=self.teacher)
        rows = self.client.get(f"/api/classes/{self.classroom.pk}/telegram/members/").json()
        ghost = next(r for r in rows["members"] if r["telegram_user_id"] == 4242)
        self.assertTrue(ghost["unmanaged"])
        self.assertEqual(ghost["telegram_username"], "ghost")


class SplitIdentityTests(TelegramGroupBase):
    """One person, two rows — the ordinary path when a class is switched to a managed group
    while students are still walking in through the old static link.

    The site ends up holding an anonymous sighting (Telegram id, no user) and the student's
    own row (user, no Telegram id). Putting the Telegram id on the second collides with the
    first under `uniq_classroom_telegram_member_tg`, and the join endpoint 500s.
    """

    def _sighting(self, telegram_id=1001, username="aziz_t"):
        """A join the bot saw before it could match the account to anybody."""
        ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=None, telegram_user_id=telegram_id,
            telegram_username=username, status=ClassroomTelegramMember.STATUS_JOINED,
            joined_at=timezone.now(), observed_arrival_at=timezone.now(),
        )
        self.tg.join(telegram_id)

    def test_pressing_join_after_an_anonymous_sighting_does_not_crash(self):
        self._sighting()
        self.client.force_authenticate(user=self.student)
        r = self.client.post(self.join_url(), {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["already_member"])

    def test_the_two_rows_become_one(self):
        self._sighting()
        self.client.force_authenticate(user=self.student)
        self.client.post(self.join_url(), {}, format="json")

        rows = ClassroomTelegramMember.objects.filter(classroom=self.classroom)
        self.assertEqual(rows.count(), 1)
        row = rows.first()
        self.assertEqual(row.user_id, self.student.pk)
        self.assertEqual(row.telegram_user_id, 1001)
        # The observation survives the merge — it is the half the site could not have known.
        self.assertEqual(row.telegram_username, "aziz_t")
        self.assertEqual(row.status, ClassroomTelegramMember.STATUS_JOINED)

    def test_a_ticket_stamps_the_telegram_id_so_the_split_cannot_form(self):
        """The other half of the fix: the row claims the account the moment a link is cut,
        so a later sighting finds that row instead of starting a rival one."""
        self.issue_for(self.student)
        self.assertEqual(self.row(self.student).telegram_user_id, 1001)

        self.tg.join(1001)
        tg.handle_chat_member_update(
            chat_member_update(telegram_user={"id": 1001, "username": "aziz_t"})
        )
        self.assertEqual(
            ClassroomTelegramMember.objects.filter(classroom=self.classroom).count(), 1
        )

    def test_two_standing_rows_are_folded_together(self):
        """`_claim_row` directly: no code path can still produce this pair, but a row written
        before the stamping fix can, and the constraints make it unwritable until merged."""
        sighting = ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=None, telegram_user_id=1001,
            telegram_username="aziz_t", status=ClassroomTelegramMember.STATUS_JOINED,
            joined_at=timezone.now(),
        )
        own = ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=self.student,
            status=ClassroomTelegramMember.STATUS_PENDING,
        )

        merged = tg._claim_row(self.classroom, user=self.student, telegram_user_id=1001)

        self.assertEqual(merged.pk, own.pk)
        self.assertEqual(merged.telegram_user_id, 1001)
        self.assertEqual(merged.telegram_username, "aziz_t")
        self.assertEqual(merged.status, ClassroomTelegramMember.STATUS_JOINED)
        self.assertFalse(ClassroomTelegramMember.objects.filter(pk=sighting.pk).exists())
        self.assertTrue(
            ClassroomTelegramEvent.objects.filter(
                action=ClassroomTelegramEvent.ACTION_RECONCILED, user=self.student
            ).exists()
        )
