"""The one-off split, by the seat rule (owner, 2026-10-14: "guruhi yo'q studentlar to'g'ridan to'g'ri
public bo'lib qolsin"): every active student with no seat in an active class becomes public — frozen
for the debt when lc-up shows one — a public learner with a seat becomes a student again, and
--revert puts back exactly what --apply changed."""

import json
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink, LinkStatus
from users.models import RoleChange, User


class SplitTests(TestCase):
    def setUp(self):
        t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="R", subject="MATH", created_by=t, teacher=t)
        # An lc-up student sitting in their class: stays.
        self.centre = User.objects.create_user(None, password=None, username="centre", role=C.ROLE_STUDENT)
        LcupStudentLink.objects.create(lcup_student_id=1, name="c", user=self.centre, status=LinkStatus.AUTO)
        ClassroomMembership.objects.create(classroom=self.room, user=self.centre, role="STUDENT")
        # Not in lc-up, but in a class: a seat is what counts, so stays too.
        self.walkin = User.objects.create_user(None, password=None, username="walkin", role=C.ROLE_STUDENT)
        ClassroomMembership.objects.create(classroom=self.room, user=self.walkin, role="STUDENT")
        # In lc-up, owing, in no class: public, frozen for the debt.
        self.leaver = User.objects.create_user(None, password=None, username="leaver", role=C.ROLE_STUDENT)
        LcupStudentLink.objects.create(
            lcup_student_id=2, name="l", user=self.leaver, status=LinkStatus.AUTO, balance=Decimal("-1")
        )
        # In no class at all: public.
        self.groupless = User.objects.create_user(None, password=None, username="groupless", role=C.ROLE_STUDENT)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("split_public_students", *args, stdout=out)
        return json.loads(out.getvalue())

    def roles(self, *users):
        for u in users:
            u.refresh_from_db()
        return tuple(u.role for u in users)

    def test_dry_run_writes_nothing(self):
        counts = self.run_cmd("--dry-run")
        self.assertEqual((counts["to_public"], counts["to_freeze"], counts["to_centre"]), (2, 1, 0))
        self.assertEqual(User.objects.filter(role=C.ROLE_PUBLIC_STUDENT).count(), 0)
        self.assertFalse(RoleChange.objects.exists())

    def test_apply_splits_by_seat_and_revert_undoes_it(self):
        self.assertTrue(self.run_cmd("--apply")["applied"])
        self.assertEqual(
            self.roles(self.centre, self.walkin, self.leaver, self.groupless),
            (C.ROLE_STUDENT, C.ROLE_STUDENT, C.ROLE_PUBLIC_STUDENT, C.ROLE_PUBLIC_STUDENT),
        )
        self.assertEqual((self.leaver.is_frozen, self.leaver.frozen_reason), (True, "lcup_debt"))
        self.assertFalse(self.groupless.is_frozen)

        self.assertEqual(self.run_cmd("--revert"), {"reverted": 2})
        self.assertEqual(self.roles(self.leaver, self.groupless), (C.ROLE_STUDENT, C.ROLE_STUDENT))
        self.assertFalse(self.leaver.is_frozen)
        self.assertFalse(RoleChange.objects.filter(reason="initial_split", reverted_at__isnull=True).exists())
        self.assertEqual(self.run_cmd("--revert"), {"reverted": 0})  # twice is harmless

    def test_apply_twice_changes_nobody_twice(self):
        self.run_cmd("--apply")
        self.assertEqual(self.run_cmd("--apply")["to_public"], 0)
        self.assertEqual(RoleChange.objects.count(), 2)

    def test_a_public_learner_with_a_seat_is_a_student_again(self):
        back = User.objects.create_user(None, password=None, username="back", role=C.ROLE_PUBLIC_STUDENT)
        ClassroomMembership.objects.create(classroom=self.room, user=back, role="STUDENT")
        self.assertEqual(self.run_cmd("--apply")["to_centre"], 1)
        self.assertEqual(self.roles(back), (C.ROLE_STUDENT,))

    def test_an_invited_or_archived_seat_is_not_a_seat_and_comes_back_on_revert(self):
        invited = ClassroomMembership.objects.create(
            classroom=self.room, user=self.groupless, role="STUDENT", status=ClassroomMembership.STATUS_INVITED
        )
        archived = Classroom.objects.create(
            name="Old", subject="MATH", created_by=self.room.teacher, teacher=self.room.teacher, is_active=False
        )
        ClassroomMembership.objects.create(classroom=archived, user=self.leaver, role="STUDENT")
        self.run_cmd("--apply")
        self.assertEqual(self.roles(self.groupless, self.leaver), (C.ROLE_PUBLIC_STUDENT, C.ROLE_PUBLIC_STUDENT))
        invited.refresh_from_db()
        self.assertEqual(invited.status, ClassroomMembership.STATUS_REMOVED)
        self.run_cmd("--revert")
        invited.refresh_from_db()
        self.assertEqual(invited.status, ClassroomMembership.STATUS_INVITED)

    def test_an_admins_freeze_survives_the_split_and_its_revert(self):
        User.objects.filter(pk=self.groupless.pk).update(is_frozen=True)
        self.run_cmd("--apply")
        self.run_cmd("--revert")
        self.groupless.refresh_from_db()
        self.assertEqual((self.groupless.role, self.groupless.is_frozen), (C.ROLE_STUDENT, True))

    def test_staff_and_inactive_accounts_are_left_alone(self):
        User.objects.filter(pk=self.groupless.pk).update(is_active=False)
        admin = User.objects.create_user(None, password=None, username="adm", role=C.ROLE_ADMIN)
        counts = self.run_cmd("--apply")
        self.assertEqual(counts["to_public"], 1)  # the leaver only
        self.assertEqual(self.roles(admin, self.groupless), (C.ROLE_ADMIN, C.ROLE_STUDENT))
