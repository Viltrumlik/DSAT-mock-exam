"""Duplicate accounts choose their own main account by typing their phone (owner, 2026-10-14).

"duplicate ism familiyali o'quvchilarga forma jo'nating ular qaysi accountidan kirib o'shandan
o'zlarini nomerlarini yozsa shu account ularning main accounti bo'ladi qolgan o'quvchiga tegmay
qo'yavering." The account the number is typed on gets the lc-up link; the groups and lc-up's
attendance then follow it (``tasks.follow_student``).
"""

from __future__ import annotations

from datetime import timedelta
from io import StringIO
import json
from unittest import mock

from celery.exceptions import Retry
from django.core.cache import cache
from django.core.management import call_command
from django.db.models import Sum
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models import ClassroomMembership
from lcup import phone_confirm, tasks
from lcup.attendance import apply_day, plan_day
from lcup.client import ATTENDANCE_PATH
from lcup.models import LcupGroupLink, LcupMembership, LcupPhonePrompt, LcupStudentLink, LinkStatus
from lcup.testing import FakeLcupClient
from lcup.tests_attendance_reconcile import DAY, R, ReconcileFixture, row
from rewards.models import PointAward
from users.models import SecurityAuditEvent, User
from users.profile_completeness import missing_profile_fields

PHONE = "998901234567"
URL = "/api/lcup/claim/phone/"
P = LcupPhonePrompt


def student(username, first, last, *, role="student", **extra):
    return User.objects.create_user(
        None, password=None, username=username, role=role, first_name=first, last_name=last, **extra
    )


class DuplicateFixture(TestCase):
    def setUp(self):
        self.used = student("aziz_used", "Aziz", "Tursunov")  # the account the student actually uses
        self.linked = student(PHONE, "Tursunov", "Aziz")  # the one the sync linked
        self.link = LcupStudentLink.objects.create(
            lcup_student_id=501, name="Tursunov Aziz", phone=PHONE, user=self.linked, status=LinkStatus.AUTO
        )

    def prompts(self):
        return dict(P.objects.values_list("user_id", "state"))


class PromptListTests(DuplicateFixture):
    def test_every_account_of_a_linked_duplicate_is_asked(self):
        report = phone_confirm.create_prompts()
        self.assertEqual(self.prompts(), {self.used.pk: P.PENDING, self.linked.pk: P.PENDING})
        self.assertEqual(set(P.objects.values_list("student_id", flat=True)), {self.link.pk})
        self.assertEqual((report["groups"], report["accounts"], report["created"]), (1, 2, 2))

    def test_the_report_alone_creates_nothing(self):
        report = phone_confirm.create_prompts(dry_run=True)
        self.assertEqual((report["groups"], report["accounts"], report["created"]), (1, 2, 0))
        self.assertFalse(P.objects.exists())

    def test_a_second_run_asks_nobody_twice(self):
        phone_confirm.create_prompts()
        self.assertEqual(phone_confirm.create_prompts()["created"], 0)
        self.assertEqual(P.objects.count(), 2)

    def test_everyone_else_is_left_alone(self):
        alone = student("malika", "Malika", "Karimova")
        LcupStudentLink.objects.create(lcup_student_id=502, name="Karimova Malika", phone="998907654321", user=alone)
        student("bobur1", "Bobur", "Aliyev")  # namesakes with no lc-up link
        student("bobur2", "Bobur", "Aliyev")
        student("aziz_closed", "Aziz", "Tursunov", is_active=False)
        student("aziz_teacher", "Aziz", "Tursunov", role="teacher", subject="math")
        phone_confirm.create_prompts()
        self.assertEqual(set(self.prompts()), {self.used.pk, self.linked.pk})

    def test_two_linked_namesakes_are_left_to_the_admin(self):
        LcupStudentLink.objects.create(lcup_student_id=503, name="Aziz Tursunov", phone="998907777777", user=self.used)
        report = phone_confirm.create_prompts()
        self.assertFalse(P.objects.exists())
        self.assertEqual(report["skipped"], 1)

    def test_an_lcup_student_with_no_phone_is_left_to_the_admin(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(phone="")
        self.assertEqual(phone_confirm.create_prompts()["skipped"], 1)
        self.assertFalse(P.objects.exists())

    def test_the_command_reports_first_and_applies_on_request(self):
        out = StringIO()
        call_command("lcup_phone_prompts", stdout=out)
        report = json.loads(out.getvalue())
        self.assertEqual((report["accounts"], report["created"]), (2, 0))
        self.assertEqual(report["detail"][0]["lcup_student_id"], 501)
        self.assertFalse(P.objects.exists())
        call_command("lcup_phone_prompts", "--apply", stdout=StringIO())
        self.assertEqual(P.objects.count(), 2)
        out = StringIO()
        call_command("lcup_phone_prompts", "--status", stdout=out)
        self.assertEqual(json.loads(out.getvalue()), {"pending": 2})


class RequirementTests(DuplicateFixture):
    def setUp(self):
        super().setUp()
        phone_confirm.create_prompts()

    def test_a_pending_prompt_asks_for_the_phone(self):
        self.assertIn("lcup_phone", missing_profile_fields(self.used))
        api = APIClient()
        api.force_authenticate(self.used)
        self.assertIn("lcup_phone", api.get("/api/users/me/").data["missing_fields"])

    def test_an_answered_prompt_asks_nothing(self):
        P.objects.filter(user=self.used).update(state=P.NOT_ME)
        self.assertNotIn("lcup_phone", missing_profile_fields(self.used))

    def test_an_account_that_is_no_longer_a_student_is_not_asked(self):
        User.objects.filter(pk=self.used.pk).update(role="teacher")
        self.used.refresh_from_db()
        self.assertNotIn("lcup_phone", missing_profile_fields(self.used))

    def test_an_account_without_a_prompt_is_not_asked(self):
        self.assertNotIn("lcup_phone", missing_profile_fields(student("x", "Some", "One")))


@mock.patch("lcup.tasks.follow_student.delay")
class ConfirmTests(DuplicateFixture):
    def setUp(self):
        super().setUp()
        phone_confirm.create_prompts()
        self.api = APIClient()
        self.api.force_authenticate(self.used)

    def post(self, **body):
        return self.api.post(URL, body, format="json")

    def test_the_account_the_number_is_typed_on_becomes_the_main_one(self, follow):
        with self.captureOnCommitCallbacks(execute=True):
            res = self.post(phone="+998 90 123-45-67")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["moved"])
        self.link.refresh_from_db()
        self.assertEqual((self.link.user_id, self.link.status), (self.used.pk, LinkStatus.CONFIRMED))
        # The student's other account is not asked any more.
        self.assertEqual(self.prompts(), {self.used.pk: P.CONFIRMED, self.linked.pk: P.SUPERSEDED})
        self.assertNotIn("lcup_phone", missing_profile_fields(self.linked))
        follow.assert_called_once_with(self.link.pk)
        self.assertTrue(SecurityAuditEvent.objects.filter(user=self.used, event_type="lcup_phone_confirmed").exists())

    def test_confirming_on_the_linked_account_moves_nothing(self, follow):
        self.api.force_authenticate(self.linked)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.post(phone="901234567")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["moved"])
        self.link.refresh_from_db()
        self.assertEqual((self.link.user_id, self.link.status), (self.linked.pk, LinkStatus.CONFIRMED))
        self.assertEqual(self.prompts(), {self.used.pk: P.SUPERSEDED, self.linked.pk: P.CONFIRMED})
        follow.assert_not_called()

    def test_a_wrong_number_gets_a_hint_and_moves_nothing(self, follow):
        res = self.post(phone="+998 99 000 00 00")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["hint"], "67")
        self.assertIn("67", res.data["phone"][0])
        self.link.refresh_from_db()
        self.assertEqual(self.link.user_id, self.linked.pk)
        self.assertEqual(P.objects.get(user=self.used).failed_attempts, 1)
        self.assertEqual(P.objects.get(user=self.used).state, P.PENDING)
        follow.assert_not_called()

    def test_ten_wrong_numbers_send_the_student_to_the_administrator(self, follow):
        for _ in range(phone_confirm.MAX_PHONE_ATTEMPTS):
            self.assertEqual(self.post(phone="998990000000").status_code, 400)
        res = self.post(phone=PHONE)
        self.assertEqual(res.status_code, 429)
        self.link.refresh_from_db()
        self.assertEqual(self.link.user_id, self.linked.pk)

    def test_something_that_is_not_a_phone_is_refused_without_counting(self, follow):
        self.assertEqual(self.post(phone="hello").status_code, 400)
        self.assertEqual(self.post().status_code, 400)
        self.assertEqual(P.objects.get(user=self.used).failed_attempts, 0)

    def test_a_namesake_says_it_is_not_them(self, follow):
        res = self.post(not_me=True)
        self.assertEqual(res.status_code, 204)
        self.assertEqual(self.prompts(), {self.used.pk: P.NOT_ME, self.linked.pk: P.PENDING})
        self.assertNotIn("lcup_phone", missing_profile_fields(self.used))
        self.link.refresh_from_db()
        self.assertEqual(self.link.user_id, self.linked.pk)

    def test_an_account_with_nothing_to_confirm_is_refused(self, follow):
        self.api.force_authenticate(student("x", "Some", "One"))
        self.assertEqual(self.post(phone=PHONE).status_code, 403)
        self.assertEqual(self.post(not_me=True).status_code, 403)

    def test_an_account_holding_another_lcup_student_cannot_take_a_second(self, follow):
        LcupStudentLink.objects.create(lcup_student_id=504, name="Someone Else", phone="998905555555", user=self.used)
        self.assertEqual(self.post(phone=PHONE).status_code, 409)
        self.link.refresh_from_db()
        self.assertEqual(self.link.user_id, self.linked.pk)


@mock.patch("lcup.tasks.follow_student.delay")
@override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
class AdminRelinkTests(DuplicateFixture):
    def test_an_admin_relink_settles_the_prompts_and_the_groups_follow(self, follow):
        phone_confirm.create_prompts()
        api = APIClient()
        api.force_authenticate(User.objects.create_user(None, password=None, username="boss", role="admin"))
        with self.captureOnCommitCallbacks(execute=True):
            res = api.post(
                f"/api/lcup/students/{self.link.pk}/link/", {"user_id": self.used.pk}, format="json",
                HTTP_HOST="admin.mastersat.uz",
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.prompts(), {self.used.pk: P.SUPERSEDED, self.linked.pk: P.SUPERSEDED})
        follow.assert_called_once_with(self.link.pk)


@override_settings(LCUP_ENABLED=True, LCUP_ATTENDANCE_PULL_ENABLED=True)
class FollowTests(ReconcileFixture):
    """After the move, the groups follow, and then lc-up's attendance with its XP."""

    def setUp(self):
        super().setUp()  # s1 (lc-up 101) and s2 (lc-up 102) sit in group 10's class
        LcupGroupLink.objects.filter(pk=self.link.pk).update(snapshot={"course_start_date": "2026-10-05"})
        self.s1_link = LcupStudentLink.objects.get(lcup_student_id=101)
        for lcup_student in LcupStudentLink.objects.all():
            LcupMembership.objects.create(group=self.link, student=lcup_student, lcup_status="active")
        self.other = self.learner("s1_other", seat=False)  # s1's second account, not in the class
        apply_day(plan_day(self.link, DAY, [row(101), row(102)], gap_fill=False))
        self.rows = [row(101), row(102)]

    def seat(self, user):
        return ClassroomMembership.objects.filter(classroom=self.room, user=user).values_list("status", flat=True).first()

    def xp(self, user):
        return PointAward.objects.filter(student=user, source_type="attendance_record").aggregate(t=Sum("xp"))["t"] or 0

    def move_link_to_other(self):
        self.s1_link.user = self.other
        self.s1_link.save(update_fields=["user"])

    def test_the_new_main_account_gets_the_seat_the_marks_and_the_xp(self):
        self.assertEqual(self.xp(self.s1), 5)
        self.move_link_to_other()
        counts = phone_confirm.follow_link(FakeLcupClient({ATTENDANCE_PATH: self.rows}), self.s1_link, until=DAY)
        self.assertEqual(self.seat(self.other), ClassroomMembership.STATUS_ACTIVE)
        self.assertEqual(self.seat(self.s1), ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(self.marks(), {self.other.pk: (R.STATUS_PRESENT, None), self.s2.pk: (R.STATUS_PRESENT, None)})
        self.assertEqual((self.xp(self.other), self.xp(self.s1)), (5, 0))
        self.assertEqual(counts["added"], 1)

    def test_lcup_is_asked_only_about_this_students_groups(self):
        LcupGroupLink.objects.create(lcup_group_id=99, name="Another group", status="confirmed")
        self.move_link_to_other()
        lcup = FakeLcupClient({ATTENDANCE_PATH: self.rows})
        phone_confirm.follow_link(lcup, self.s1_link, until=DAY)
        self.assertEqual({p.get("group_id") for _, p in lcup.calls}, {10})

    @override_settings(LCUP_ATTENDANCE_PULL_ENABLED=False)
    def test_with_the_pull_off_only_the_groups_follow(self):
        self.move_link_to_other()
        lcup = FakeLcupClient({ATTENDANCE_PATH: self.rows})
        phone_confirm.follow_link(lcup, self.s1_link, until=DAY)
        self.assertEqual(self.seat(self.other), ClassroomMembership.STATUS_ACTIVE)
        self.assertEqual(lcup.calls, [])

    def test_the_task_waits_for_a_running_sync(self):
        cache.add(tasks.RUNNING_KEY, "1", timeout=60)
        try:
            with self.assertRaises(Retry):
                tasks.follow_student(self.s1_link.pk)
        finally:
            cache.delete(tasks.RUNNING_KEY)

    def test_the_task_follows_with_the_real_client_and_lets_the_sync_run_again(self):
        self.move_link_to_other()
        with mock.patch("lcup.tasks.default_client", return_value=FakeLcupClient({ATTENDANCE_PATH: self.rows})):
            tasks.follow_student(self.s1_link.pk)
        self.assertEqual(self.seat(self.other), ClassroomMembership.STATUS_ACTIVE)
        self.assertTrue(cache.add(tasks.RUNNING_KEY, "1", timeout=1))
        cache.delete(tasks.RUNNING_KEY)

    def test_a_day_after_until_is_left_to_the_regular_pull(self):
        self.move_link_to_other()
        phone_confirm.follow_link(FakeLcupClient({ATTENDANCE_PATH: self.rows}), self.s1_link, until=DAY - timedelta(days=1))
        self.assertEqual(self.marks()[self.s1.pk], (R.STATUS_PRESENT, None))

    @override_settings(LCUP_ATTENDANCE_PUSH_ENABLED=True, LCUP_ATTENDANCE_PUSH_FROM=DAY.isoformat())
    def test_days_from_the_push_cutover_are_never_copied_over(self):
        # From the cutover a mark only we have is the push's to send; this copy must not delete it.
        R.objects.filter(session=self.session(), student=self.s2).update(status=R.STATUS_LATE)  # differs from lc-up's
        self.move_link_to_other()
        phone_confirm.follow_link(FakeLcupClient({ATTENDANCE_PATH: self.rows}), self.s1_link, until=DAY)
        self.assertEqual(self.marks()[self.s2.pk], (R.STATUS_LATE, None))
        self.assertEqual(self.seat(self.other), ClassroomMembership.STATUS_ACTIVE)
