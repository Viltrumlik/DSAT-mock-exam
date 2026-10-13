"""The one-off split: every active student who is not a live lc-up member becomes public, a
linked leaver in debt is frozen for it, and --revert puts back exactly what --apply changed."""

import json
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink, LinkStatus
from users.models import RoleChange, User


class SplitTests(TestCase):
    def setUp(self):
        t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="R", subject="MATH", created_by=t, teacher=t)
        group = LcupGroupLink.objects.create(
            lcup_group_id=10, name="G", status=GroupLinkStatus.CONFIRMED, classroom=self.room
        )
        self.centre = User.objects.create_user(None, password=None, username="centre", role=C.ROLE_STUDENT)
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="c", user=self.centre, status=LinkStatus.AUTO)
        LcupMembership.objects.create(group=group, student=link, lcup_status="active")
        self.walkin = User.objects.create_user(None, password=None, username="walkin", role=C.ROLE_STUDENT)
        self.seat = ClassroomMembership.objects.create(classroom=self.room, user=self.walkin, role="STUDENT")
        self.leaver = User.objects.create_user(None, password=None, username="leaver", role=C.ROLE_STUDENT)
        LcupStudentLink.objects.create(
            lcup_student_id=2, name="l", user=self.leaver, status=LinkStatus.AUTO, balance=Decimal("-1")
        )

    def run_cmd(self, *args):
        out = StringIO()
        call_command("split_public_students", *args, stdout=out)
        return json.loads(out.getvalue())

    def test_dry_run_writes_nothing(self):
        counts = self.run_cmd("--dry-run")
        self.assertEqual((counts["to_public"], counts["to_freeze"]), (2, 1))
        self.assertEqual(User.objects.filter(role=C.ROLE_PUBLIC_STUDENT).count(), 0)
        self.assertFalse(RoleChange.objects.exists())

    def test_apply_splits_and_revert_undoes_it(self):
        counts = self.run_cmd("--apply")
        self.assertTrue(counts["applied"])
        for u in (self.walkin, self.leaver, self.centre):
            u.refresh_from_db()
        self.assertEqual(
            (self.walkin.role, self.leaver.role, self.centre.role),
            (C.ROLE_PUBLIC_STUDENT, C.ROLE_PUBLIC_STUDENT, C.ROLE_STUDENT),
        )
        self.assertEqual((self.leaver.is_frozen, self.leaver.frozen_reason), (True, "lcup_debt"))
        self.assertFalse(self.walkin.is_frozen)
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, ClassroomMembership.STATUS_REMOVED)

        self.assertEqual(self.run_cmd("--revert"), {"reverted": 2})
        for u in (self.walkin, self.leaver):
            u.refresh_from_db()
        self.assertEqual(
            (self.walkin.role, self.leaver.role, self.leaver.is_frozen), (C.ROLE_STUDENT, C.ROLE_STUDENT, False)
        )
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, ClassroomMembership.STATUS_ACTIVE)
        self.assertFalse(RoleChange.objects.filter(reason="initial_split", reverted_at__isnull=True).exists())
        self.assertEqual(self.run_cmd("--revert"), {"reverted": 0})  # twice is harmless

    def test_apply_twice_changes_nobody_twice(self):
        self.run_cmd("--apply")
        self.assertEqual(self.run_cmd("--apply")["to_public"], 0)
        self.assertEqual(RoleChange.objects.count(), 2)

    def test_an_invited_seat_comes_back_invited(self):
        self.seat.status = ClassroomMembership.STATUS_INVITED
        self.seat.save()
        self.run_cmd("--apply")
        self.run_cmd("--revert")
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, ClassroomMembership.STATUS_INVITED)

    def test_an_admins_freeze_survives_the_split_and_its_revert(self):
        User.objects.filter(pk=self.walkin.pk).update(is_frozen=True)
        self.run_cmd("--apply")
        self.run_cmd("--revert")
        self.walkin.refresh_from_db()
        self.assertEqual((self.walkin.role, self.walkin.is_frozen), (C.ROLE_STUDENT, True))

    def test_staff_and_inactive_accounts_are_left_alone(self):
        User.objects.filter(pk=self.walkin.pk).update(is_active=False)
        admin = User.objects.create_user(None, password=None, username="adm", role=C.ROLE_ADMIN)
        counts = self.run_cmd("--apply")
        self.assertEqual(counts["to_public"], 1)  # the leaver only
        admin.refresh_from_db()
        self.walkin.refresh_from_db()
        self.assertEqual((admin.role, self.walkin.role), (C.ROLE_ADMIN, C.ROLE_STUDENT))

    def test_a_link_to_an_archived_lcup_student_is_not_a_centre_student(self):
        LcupStudentLink.objects.filter(user=self.centre).update(deleted_in_lcup=True)
        self.run_cmd("--apply")
        self.centre.refresh_from_db()
        self.assertEqual(self.centre.role, C.ROLE_PUBLIC_STUDENT)
