import json
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from lcup.client import LcupUnavailable
from lcup.models import (
    AccountClaim,
    GroupLinkStatus,
    LcupGroupLink,
    LcupMembership,
    LcupState,
    LcupStudentLink,
    LcupSyncRun,
    LcupTeacherLink,
    LinkStatus,
)
from lcup.sync import run_sync
from lcup.tasks import sync as sync_task
from lcup.testing import FakeLcupClient
from users.models import User

API = "/api/external/v1"


def member(student_id, name, phone, status="active", left_at=None):
    return {
        "student_id": student_id,
        "name": name,
        "phone": phone,
        "status": status,
        "start_date": "2026-09-01",
        "joined_at": "2026-08-28 12:00:00",
        "left_at": left_at,
    }


def lcup_data():
    return {
        f"{API}/filials": [{"id": 588, "name": "Master SAT", "status": "main"}],
        f"{API}/teachers": [
            {"id": 2001, "name": "Aliyev Vali", "phone": "998901111111", "group_ids": [10, 13]},
            {"id": 2002, "name": "Karimova Sayyora", "phone": "998902222222", "group_ids": [11]},
        ],
        f"{API}/groups": [
            {
                "id": 10, "name": "Junior G21 | Math | Vali", "filial_id": 588,
                "course": {"id": 301, "name": "Junior Math"}, "days": [1, 3, 5],
                "start_time": "18:00:00", "finish_time": "19:30:00", "teachers": [{"id": 2001, "name": "Aliyev Vali"}],
                "deleted_at": None,
            },
            {
                "id": 11, "name": "Senior G1 | English | Sayyora", "filial_id": 588,
                "course": {"id": 302, "name": "Senior English"}, "days": [2, 4, 6],
                "start_time": "16:00:00", "finish_time": "17:30:00", "teachers": [{"id": 2002, "name": "Karimova Sayyora"}],
                "deleted_at": None,
            },
            {
                "id": 12, "name": "Junior G9 | Math | Old", "filial_id": 588,
                "course": {"id": 301, "name": "Junior Math"}, "days": [1, 3, 5],
                "start_time": "10:00:00", "finish_time": "11:30:00", "teachers": [],
                "deleted_at": "2026-09-01 10:00:00",
            },
            {
                "id": 13, "name": "Senior G3 | English | Vali", "filial_id": 588,
                "course": {"id": 302, "name": "Senior English"}, "days": [2, 4, 6],
                "start_time": "14:00:00", "finish_time": "15:30:00", "teachers": [{"id": 2001, "name": "Aliyev Vali"}],
                "deleted_at": None,
            },
        ],
        f"{API}/students": [
            {"id": 101, "name": "Karimova Malika", "phone": "998901234567", "filial_id": 588},
            {"id": 102, "name": "Tursunov Aziz", "phone": "998903333333", "filial_id": 588},
            {"id": 103, "name": "Ergasheva Dilnoza", "phone": "998904444444", "filial_id": 588},
            {"id": 104, "name": "Ergashev Bobur", "phone": "998904444444", "filial_id": 588},
            {"id": 105, "name": "Qodirov Sardor", "phone": "998905555555", "filial_id": 588},
        ],
        f"{API}/groups/10/students": [
            member(101, "Karimova Malika", "998901234567"),
            member(102, "Tursunov Aziz", "998903333333", status="trial"),
            member(103, "Ergasheva Dilnoza", "998904444444"),
            member(104, "Ergashev Bobur", "998904444444", status="frozen"),
            member(105, "Qodirov Sardor", "998905555555", left_at="2026-10-01 09:00:00"),
        ],
        f"{API}/groups/11/students": [member(102, "Tursunov Aziz", "998903333333")],
    }


class SyncTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.t1 = User.objects.create_user(
            None, password=None, username="t1", role="teacher", subject="math", phone_number="+998 90 111 11 11",
            first_name="Vali", last_name="Aliyev",
        )
        self.s1 = User.objects.create_user(
            None, password=None, username="malika", role="student", phone_number="998901234567",
            first_name="Malika", last_name="Karimova",
        )
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", level="junior", lesson_days="ODD", lesson_time="18:00",
            created_by=self.t1, teacher=self.t1,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.t1, role=ClassroomMembership.ROLE_ADMIN)

    def run_sync(self, data=None, **kw):
        return run_sync(FakeLcupClient(data or lcup_data()), now=self.now, **kw)

    def confirm_g21(self):
        LcupGroupLink.objects.filter(lcup_group_id=10).update(classroom=self.room, status=GroupLinkStatus.CONFIRMED)

    def active_students(self, room=None):
        return set(
            ClassroomMembership.objects.filter(
                classroom=room or self.room, role="STUDENT", status=ClassroomMembership.STATUS_ACTIVE
            ).values_list("user_id", flat=True)
        )

    def test_first_run_links_and_suggests_but_changes_no_class(self):
        run = self.run_sync()
        self.assertTrue(run.ok, run.errors)

        t1, t2 = LcupTeacherLink.objects.get(lcup_teacher_id=2001), LcupTeacherLink.objects.get(lcup_teacher_id=2002)
        self.assertEqual((t1.status, t1.user_id), (LinkStatus.AUTO, self.t1.pk))
        self.assertEqual(t2.status, LinkStatus.UNMATCHED)

        g21 = LcupGroupLink.objects.get(lcup_group_id=10)
        self.assertEqual((g21.status, g21.suggestion_id, g21.classroom_id), (GroupLinkStatus.SUGGESTED, self.room.pk, None))
        self.assertEqual(LcupGroupLink.objects.get(lcup_group_id=11).status, GroupLinkStatus.NEEDS_TEACHER)
        self.assertIsNotNone(LcupGroupLink.objects.get(lcup_group_id=12).deleted_in_lcup_at)
        self.assertIn("lc-up group deleted: Junior G9 | Math | Old", run.alerts)
        # A group with a linked teacher but no candidate waits for the initial review.
        self.assertIsNone(LcupGroupLink.objects.get(lcup_group_id=13).classroom_id)

        s = {link.lcup_student_id: link for link in LcupStudentLink.objects.all()}
        self.assertEqual((s[101].status, s[101].user_id), (LinkStatus.AUTO, self.s1.pk))
        self.assertEqual(s[102].status, LinkStatus.UNMATCHED)
        self.assertEqual((s[103].status, s[104].status), (LinkStatus.NEEDS_REVIEW, LinkStatus.NEEDS_REVIEW))

        self.assertFalse(User.objects.filter(username="998903333333").exists())
        self.assertEqual(self.active_students(), set())
        self.assertEqual(LcupMembership.objects.filter(group__lcup_group_id=10).count(), 5)

    def test_a_confirmed_group_gets_its_roster(self):
        self.run_sync()
        self.confirm_g21()
        run = self.run_sync()
        self.assertEqual(self.active_students(), {self.s1.pk})
        self.assertEqual(run.counts["added"], 1)

    def test_after_the_review_accounts_and_missing_classes_are_created(self):
        self.run_sync()
        self.confirm_g21()
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})
        run = self.run_sync()
        self.assertTrue(run.ok, run.errors)

        aziz = User.objects.get(username="998903333333")
        self.assertTrue(AccountClaim.objects.filter(user=aziz).exists())
        self.assertEqual(self.active_students(), {self.s1.pk, aziz.pk})  # trial counts as a member
        self.assertEqual(run.counts["accounts_created"], 1)

        g13 = LcupGroupLink.objects.get(lcup_group_id=13)
        self.assertEqual(g13.status, GroupLinkStatus.CONFIRMED)
        self.assertEqual((g13.classroom.subject, g13.classroom.lesson_days), ("ENGLISH", "EVEN"))
        # Siblings sharing a phone are never auto-created; they wait for the admin.
        self.assertFalse(User.objects.filter(username="998904444444").exists())

    def test_a_failed_member_fetch_leaves_that_class_alone(self):
        self.run_sync()
        self.confirm_g21()
        ClassroomMembership.objects.create(classroom=self.room, user=self.s1, role="STUDENT")
        data = lcup_data()
        data[f"{API}/groups/10/students"] = LcupUnavailable("lc-up answered 503")
        run = self.run_sync(data)
        self.assertFalse(run.ok)
        self.assertIn("members:10", [e["stage"] for e in run.errors])
        self.assertEqual(self.active_students(), {self.s1.pk})

    def test_an_empty_member_list_for_a_group_with_members_is_not_believed(self):
        self.run_sync()
        data = lcup_data()
        data[f"{API}/groups/10/students"] = []
        run = self.run_sync(data)
        self.assertEqual(LcupMembership.objects.filter(group__lcup_group_id=10, left_at__isnull=True).count(), 4)
        self.assertTrue(any("no members" in a for a in run.alerts))

    def test_a_student_who_left_is_removed(self):
        sardor = User.objects.create_user(None, password=None, username="sardor", role="student")
        self.run_sync()
        self.confirm_g21()
        LcupStudentLink.objects.filter(lcup_student_id=105).update(user=sardor, status=LinkStatus.CONFIRMED)
        ClassroomMembership.objects.create(classroom=self.room, user=sardor, role="STUDENT")
        run = self.run_sync()
        self.assertNotIn(sardor.pk, self.active_students())
        self.assertEqual(run.counts["removed"], 1)

    def test_the_run_wide_removal_cap_holds_removals(self):
        sardor = User.objects.create_user(None, password=None, username="sardor", role="student")
        self.run_sync()
        self.confirm_g21()
        LcupStudentLink.objects.filter(lcup_student_id=105).update(user=sardor, status=LinkStatus.CONFIRMED)
        ClassroomMembership.objects.create(classroom=self.room, user=sardor, role="STUDENT")
        with mock.patch("lcup.sync.MAX_REMOVALS_PER_RUN", 0):
            run = self.run_sync()
        self.assertIn(sardor.pk, self.active_students())
        self.assertTrue(any(a.startswith("removals held") for a in run.alerts))

    def test_a_dry_run_writes_nothing_but_records_the_run(self):
        run = self.run_sync(dry_run=True)
        self.assertEqual(LcupTeacherLink.objects.count(), 0)
        self.assertEqual(LcupGroupLink.objects.count(), 0)
        self.assertEqual(LcupStudentLink.objects.count(), 0)
        self.assertTrue(LcupSyncRun.objects.filter(pk=run.pk, dry_run=True).exists())
        self.assertEqual(run.counts["groups"], 4)


class TaskAndCommandTests(TestCase):
    @override_settings(LCUP_ENABLED=False)
    def test_the_task_does_nothing_while_disabled(self):
        self.assertEqual(sync_task(), {"skipped": "disabled"})

    @override_settings(LCUP_ENABLED=True)
    def test_the_task_runs_while_enabled(self):
        with mock.patch("lcup.tasks.default_client", return_value=FakeLcupClient(lcup_data())):
            counts = sync_task()
        self.assertEqual(counts["groups"], 4)

    @override_settings(LCUP_ENABLED=False)
    def test_the_command_dry_run_works_even_while_disabled(self):
        out = StringIO()
        with mock.patch("lcup.management.commands.lcup_sync.default_client", return_value=FakeLcupClient(lcup_data())):
            call_command("lcup_sync", "--dry-run", stdout=out)
        report = json.loads(out.getvalue())
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["counts"]["groups"], 4)
        self.assertEqual(LcupGroupLink.objects.count(), 0)

    @override_settings(LCUP_ENABLED=False)
    def test_a_real_command_run_refuses_while_disabled(self):
        with self.assertRaises(CommandError):
            call_command("lcup_sync", stdout=StringIO())
