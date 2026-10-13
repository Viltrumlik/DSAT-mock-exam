"""A paired class follows its lc-up group (owner, 2026-10-13): what lc-up changes reaches the class
— details, teachers — and a deleted group archives its class.

It follows CHANGES, never the state: a class that already differed from lc-up when it was paired
(another name, a teacher of ours lc-up does not list) is left exactly as it is until lc-up itself
changes something.
"""

from __future__ import annotations

from django.test import TestCase, override_settings
from django.utils import timezone

from access.models import UserAccess
from classes.models import Branch, Classroom, ClassroomMembership, Region
from lcup.guards import is_lcup_managed
from lcup.models import GroupLinkStatus, LcupGroupLink
from lcup.sync import run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import API, lcup_data
from users.models import User

M = ClassroomMembership


class FollowFixture(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.vali = User.objects.create_user(
            None, password=None, username="vali", role="teacher", subject="math", phone_number="998901111111",
            first_name="Vali", last_name="Aliyev",
        )
        self.sayyora = User.objects.create_user(
            None, password=None, username="sayyora", role="teacher", subject="math", phone_number="998902222222",
            first_name="Sayyora", last_name="Karimova",
        )
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", level="junior", lesson_days="ODD", lesson_time="18:00",
            lesson_hours=2, created_by=self.vali, teacher=self.vali,
        )
        M.objects.create(classroom=self.room, user=self.vali, role=M.ROLE_ADMIN)
        # The pairing as it stands on prod: the first sync records lc-up's group, the admin confirms.
        self.sync()
        LcupGroupLink.objects.filter(lcup_group_id=10).update(classroom=self.room, status=GroupLinkStatus.CONFIRMED)

    def sync(self, data=None):
        return run_sync(FakeLcupClient(data or lcup_data()), now=self.now)

    def g21(self, data):
        return next(row for row in data[f"{API}/groups"] if row["id"] == 10)

    def row(self, user):
        return M.objects.filter(classroom=self.room, user=user).first()

    def fresh_room(self):
        return Classroom.objects.get(pk=self.room.pk)


class DetailsFollowTests(FollowFixture):
    def test_a_rename_in_lcup_renames_the_class(self):
        data = lcup_data()
        self.g21(data)["name"] = "Junior G22 | Math | Vali"
        run = self.sync(data)
        self.assertEqual(self.fresh_room().name, "Junior G22 | Math | Vali")
        self.assertEqual(run.counts["classes_updated"], 1)
        self.assertIn("class Junior G22 | Math | Vali updated from lc-up: name", run.alerts)

    def test_days_time_and_level_changes_reach_the_class(self):
        data = lcup_data()
        g = self.g21(data)
        g.update(days=[2, 4, 6], start_time="16:00:00", finish_time="18:30:00", course={"id": 303, "name": "Middle Math"})
        self.sync(data)
        room = self.fresh_room()
        self.assertEqual(
            (room.lesson_days, room.lesson_time, room.lesson_hours, room.level), ("EVEN", "16:00", 3, "middle")
        )
        self.assertEqual(room.name, "Junior G21 Math")  # the name did not change in lc-up

    def test_a_filial_change_moves_the_class(self):
        chilonzor = Branch.objects.create(region=Region.objects.create(name="Tashkent"), name="Chilonzor")
        data = lcup_data()
        data[f"{API}/filials"].append({"id": 589, "name": "Chilonzor"})
        self.g21(data)["filial_id"] = 589
        self.sync(data)
        self.assertEqual(self.fresh_room().branch_id, chilonzor.pk)

    def test_what_lcup_did_not_change_is_left_alone(self):
        # Ours is "Junior G21 Math", lc-up's "Junior G21 | Math | Vali" — as on prod; nothing changed.
        run = self.sync()
        self.assertEqual(self.fresh_room().name, "Junior G21 Math")
        self.assertEqual(run.counts["classes_updated"], 0)

    def test_days_that_are_not_odd_or_even_are_an_alert_not_a_change(self):
        data = lcup_data()
        self.g21(data)["days"] = [1, 3]
        run = self.sync(data)
        self.assertEqual(self.fresh_room().lesson_days, "ODD")
        self.assertTrue(any("days" in a and "Junior G21 Math" in a for a in run.alerts), run.alerts)

    def test_a_subject_change_is_only_an_alert(self):
        data = lcup_data()
        self.g21(data)["course"] = {"id": 302, "name": "Junior English"}
        run = self.sync(data)
        self.assertEqual(self.fresh_room().subject, "MATH")
        self.assertTrue(any("subject" in a for a in run.alerts), run.alerts)

    def test_a_level_the_subject_has_not_is_not_taken(self):
        english = Classroom.objects.create(
            name="Senior G1 English", subject="ENGLISH", level="senior", lesson_days="EVEN", lesson_time="16:00",
            created_by=self.vali, teacher=self.vali,
        )
        LcupGroupLink.objects.filter(lcup_group_id=11).update(classroom=english, status=GroupLinkStatus.CONFIRMED)
        data = lcup_data()
        next(row for row in data[f"{API}/groups"] if row["id"] == 11)["course"] = {"id": 304, "name": "Foundation English"}
        self.sync(data)
        english.refresh_from_db()
        self.assertEqual(english.level, "senior")  # English has no Foundation


class TeachersFollowTests(FollowFixture):
    def set_teachers(self, data, *lcup_ids):
        names = {2001: "Aliyev Vali", 2002: "Karimova Sayyora"}
        self.g21(data)["teachers"] = [{"id": i, "name": names[i]} for i in lcup_ids]

    def test_a_teacher_swap_hands_the_class_to_the_new_teacher(self):
        data = lcup_data()
        self.set_teachers(data, 2002)
        run = self.sync(data)
        room = self.fresh_room()
        self.assertEqual(room.teacher_id, self.sayyora.pk)
        self.assertEqual((self.row(self.sayyora).role, self.row(self.sayyora).status), (M.ROLE_ADMIN, M.STATUS_ACTIVE))
        self.assertEqual(self.row(self.vali).status, M.STATUS_REMOVED)
        self.assertTrue(UserAccess.objects.filter(user=self.sayyora, subject="math", classroom=self.room).exists())
        self.assertEqual((run.counts["teachers_added"], run.counts["teachers_removed"]), (1, 1))

    def test_a_second_lcup_teacher_joins_as_a_teacher(self):
        data = lcup_data()
        self.set_teachers(data, 2001, 2002)
        self.sync(data)
        self.assertEqual((self.row(self.sayyora).role, self.row(self.sayyora).status), (M.ROLE_TEACHER, M.STATUS_ACTIVE))
        self.assertEqual(self.row(self.vali).status, M.STATUS_ACTIVE)
        self.assertEqual(self.fresh_room().teacher_id, self.vali.pk)

    def test_a_teacher_lcup_takes_back_off_is_removed_again(self):
        data = lcup_data()
        self.set_teachers(data, 2001, 2002)
        self.sync(data)
        self.set_teachers(data, 2001)
        self.sync(data)
        self.assertEqual(self.row(self.sayyora).status, M.STATUS_REMOVED)
        self.assertEqual(self.row(self.vali).status, M.STATUS_ACTIVE)

    def test_a_removed_teacher_lcup_puts_back_is_reactivated(self):
        M.objects.create(classroom=self.room, user=self.sayyora, role=M.ROLE_TEACHER, status=M.STATUS_REMOVED)
        data = lcup_data()
        self.set_teachers(data, 2001, 2002)
        self.sync(data)
        self.assertEqual(self.row(self.sayyora).status, M.STATUS_ACTIVE)

    def test_a_linked_teacher_of_ours_lcup_never_listed_here_stays(self):
        # Prod: one teacher sits in six classes whose lc-up groups do not list them.
        M.objects.create(classroom=self.room, user=self.sayyora, role=M.ROLE_TEACHER)
        self.sync()
        self.sync()
        self.assertEqual(self.row(self.sayyora).status, M.STATUS_ACTIVE)

    def test_our_tas_and_unlinked_teachers_stay_through_a_swap(self):
        support = User.objects.create_user(None, password=None, username="sup", role="support_teacher", subject="math")
        ours = User.objects.create_user(None, password=None, username="ours", role="teacher", subject="math")
        M.objects.create(classroom=self.room, user=support, role=M.ROLE_TA)
        M.objects.create(classroom=self.room, user=ours, role=M.ROLE_TEACHER)
        data = lcup_data()
        self.set_teachers(data, 2002)
        self.sync(data)
        self.assertEqual((self.row(support).role, self.row(support).status), (M.ROLE_TA, M.STATUS_ACTIVE))
        self.assertEqual(self.row(ours).status, M.STATUS_ACTIVE)

    def test_a_student_row_is_never_made_a_teacher(self):
        M.objects.create(classroom=self.room, user=self.sayyora, role=M.ROLE_STUDENT)
        data = lcup_data()
        self.set_teachers(data, 2001, 2002)
        run = self.sync(data)
        self.assertEqual(self.row(self.sayyora).role, M.ROLE_STUDENT)
        self.assertTrue(any("student" in a for a in run.alerts), run.alerts)

    def test_an_empty_teacher_list_is_not_believed(self):
        data = lcup_data()
        self.set_teachers(data)
        run = self.sync(data)
        self.assertEqual(self.row(self.vali).status, M.STATUS_ACTIVE)
        self.assertEqual(self.fresh_room().teacher_id, self.vali.pk)
        self.assertTrue(any("no teacher" in a for a in run.alerts), run.alerts)


class ArchiveFollowTests(FollowFixture):
    def deleted(self):
        data = lcup_data()
        self.g21(data)["deleted_at"] = "2026-10-13 10:00:00"
        return data

    def test_a_deleted_group_archives_its_class_once(self):
        run = self.sync(self.deleted())
        self.assertFalse(self.fresh_room().is_active)
        self.assertIsNotNone(LcupGroupLink.objects.get(lcup_group_id=10).class_archived_at)
        self.assertIn("lc-up group deleted: Junior G21 | Math | Vali; its class Junior G21 Math was archived", run.alerts)
        self.assertEqual(run.counts["classes_archived"], 1)
        self.assertEqual(self.sync(self.deleted()).alerts, [])  # said once, not every 15 minutes
        # Nothing is deleted: the class keeps its people.
        self.assertEqual(self.row(self.vali).status, M.STATUS_ACTIVE)

    def test_a_restored_group_reopens_the_class_it_archived(self):
        self.sync(self.deleted())
        run = self.sync()
        self.assertTrue(self.fresh_room().is_active)
        self.assertIsNone(LcupGroupLink.objects.get(lcup_group_id=10).class_archived_at)
        self.assertIn("lc-up group restored: Junior G21 | Math | Vali; its class Junior G21 Math is open again", run.alerts)
        self.assertEqual(run.counts["classes_restored"], 1)

    def test_a_class_archived_before_stays_archived(self):
        Classroom.objects.filter(pk=self.room.pk).update(is_active=False)
        self.sync(self.deleted())
        self.assertIsNone(LcupGroupLink.objects.get(lcup_group_id=10).class_archived_at)
        self.sync()
        self.assertFalse(self.fresh_room().is_active)

    @override_settings(LCUP_ENABLED=True)
    def test_a_deleted_groups_class_is_no_longer_lcup_managed(self):
        self.assertTrue(is_lcup_managed(self.room))
        self.sync(self.deleted())
        self.assertFalse(is_lcup_managed(self.fresh_room()))
