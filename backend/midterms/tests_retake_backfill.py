"""``backfill_retake_grants`` — repairing retakes that were assigned under the old rule.

Fixing the rule fixes every FUTURE assignment, but a retake already sitting in the database
still has no grant for the students who were absent from its parent. This command adds them
without a teacher re-assigning each retake by hand.

    python manage.py test midterms.tests_retake_backfill --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from midterms.models import Midterm, MidtermOutcome
from midterms.tests_api import make_published_midterm
from midterms.tests_classroom import enroll, make_classroom

User = get_user_model()


def _grant(user, midterm, classroom):
    return ResourceAccessGrant.objects.create(
        user=user, classroom=classroom, scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        source=ResourceAccessGrant.SOURCE_CLASSROOM, status=ResourceAccessGrant.STATUS_ACTIVE,
    )


def _granted_ids(midterm, classroom):
    return set(
        ResourceAccessGrant.objects.filter(
            scope=ResourceAccessGrant.SCOPE_RESOURCE, resource_type=RT_MIDTERM_V2,
            resource_id=midterm.id, classroom=classroom,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        ).values_list("user_id", flat=True)
    )


class RetakeBackfillTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="t", email="t@x.io", is_staff=True)
        self.room = make_classroom(self.teacher)
        self.failer = User.objects.create(username="f", email="f@x.io")
        self.passer = User.objects.create(username="p", email="p@x.io")
        self.absentee = User.objects.create(username="a", email="a@x.io")
        for s in (self.failer, self.passer, self.absentee):
            enroll(self.room, s)

        self.parent = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.parent.pass_mark = 60
        self.parent.save(update_fields=["pass_mark"])
        self.retake = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.retake.midterm_type = Midterm.TYPE_RETAKE
        self.retake.retake_of = self.parent
        self.retake.pass_mark = 60
        self.retake.save(update_fields=["midterm_type", "retake_of", "pass_mark"])

        # The sitting happened: everyone was assigned the parent, two turned up.
        for s in (self.failer, self.passer, self.absentee):
            _grant(s, self.parent, self.room)
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.failer, score=40, pass_mark=60, passed=False
        )
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.passer, score=90, pass_mark=60, passed=True
        )
        # The retake was then assigned under the OLD rule — failers only.
        _grant(self.failer, self.retake, self.room)

    def test_the_absentee_gets_the_retake_grant(self):
        self.assertEqual(_granted_ids(self.retake, self.room), {self.failer.id})
        call_command("backfill_retake_grants")
        self.assertEqual(_granted_ids(self.retake, self.room), {self.failer.id, self.absentee.id})

    def test_the_passer_is_never_backfilled(self):
        call_command("backfill_retake_grants")
        self.assertNotIn(self.passer.id, _granted_ids(self.retake, self.room))

    def test_dry_run_changes_nothing(self):
        call_command("backfill_retake_grants", "--dry-run")
        self.assertEqual(_granted_ids(self.retake, self.room), {self.failer.id})

    def test_running_twice_grants_once(self):
        call_command("backfill_retake_grants")
        before = ResourceAccessGrant.objects.filter(
            resource_type=RT_MIDTERM_V2, resource_id=self.retake.id
        ).count()
        call_command("backfill_retake_grants")
        after = ResourceAccessGrant.objects.filter(
            resource_type=RT_MIDTERM_V2, resource_id=self.retake.id
        ).count()
        self.assertEqual(before, after)

    def test_a_classroom_that_was_never_assigned_the_retake_is_left_alone(self):
        other_room = make_classroom(self.teacher)
        stranger = User.objects.create(username="s", email="s@x.io")
        enroll(other_room, stranger)
        _grant(stranger, self.parent, other_room)  # sat the parent elsewhere, no retake here
        call_command("backfill_retake_grants")
        self.assertEqual(_granted_ids(self.retake, other_room), set())

    def test_a_newcomer_is_not_backfilled(self):
        newcomer = User.objects.create(username="n", email="n@x.io")
        enroll(self.room, newcomer)  # never assigned the parent
        call_command("backfill_retake_grants")
        self.assertNotIn(newcomer.id, _granted_ids(self.retake, self.room))

    def test_a_removed_student_is_not_backfilled(self):
        from classes.models import ClassroomMembership

        ClassroomMembership.objects.filter(classroom=self.room, user=self.absentee).update(
            status=ClassroomMembership.STATUS_REMOVED
        )
        call_command("backfill_retake_grants")
        self.assertNotIn(self.absentee.id, _granted_ids(self.retake, self.room))

    def test_scoping_to_one_midterm(self):
        other_parent = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        other_retake = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        other_retake.midterm_type = Midterm.TYPE_RETAKE
        other_retake.retake_of = other_parent
        other_retake.save(update_fields=["midterm_type", "retake_of"])
        _grant(self.absentee, other_parent, self.room)
        _grant(self.failer, other_retake, self.room)

        call_command("backfill_retake_grants", "--midterm", str(self.retake.id))

        self.assertIn(self.absentee.id, _granted_ids(self.retake, self.room))
        self.assertNotIn(self.absentee.id, _granted_ids(other_retake, self.room))
