"""Marking who came, and the XP that follows.

The amount is never written into this feature. It is a RewardRule row the learning center
retunes from ops, so the test retunes it and checks the award follows — a test asserting 10
would pass forever while the ledger paid something else.
"""

from __future__ import annotations

import importlib

import django.apps
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event, EventRegistration
from rewards import constants as RC
from rewards.models import PointAward, RewardRule

User = get_user_model()


class AttendanceFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("ev_ops3@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user("ev_anna3@t.com", "secret123", role=C.ROLE_STUDENT)
        self.now = timezone.now()
        self.event = Event.objects.create(
            title="Career talk",
            starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2),
            seats=20,
            status=Event.STATUS_PUBLISHED,
            published_at=self.now - timedelta(days=2),
            created_by=self.staff,
        )
        self.row = services.sign_up(self.event, self.anna, now=self.now)
        self.during = self.event.starts_at + timedelta(minutes=5)
        # The fast test settings skip migrations, so the seeded rule may not be there.
        RewardRule.objects.get_or_create(
            event=RC.EVENT_ATTENDED, defaults={"points": 10, "grants_xp": True}
        )

    def _award(self):
        return PointAward.objects.filter(
            idempotency_key=RC.event_attendance_key(self.row.pk)
        ).first()

    def _refusal(self, fn, *args, **kwargs) -> str:
        with self.assertRaises(services.EventRefused) as caught:
            fn(*args, **kwargs)
        return caught.exception.code


class MarkingWindowTests(AttendanceFixture):
    def test_marking_opens_two_hours_before_the_start(self):
        # The door opens before the event does, and by then the seat can no longer be given up.
        self.assertEqual(
            services.marking_opens_at(self.event), self.event.starts_at - services.CANCEL_CUTOFF
        )

    def test_too_early_is_refused(self):
        early = services.marking_opens_at(self.event) - timedelta(minutes=1)

        self.assertEqual(
            self._refusal(
                services.mark_attendance,
                self.row,
                EventRegistration.ATTENDANCE_ATTENDED,
                actor=self.staff,
                now=early,
            ),
            "too_early",
        )

    def test_marking_is_allowed_from_the_moment_the_door_opens(self):
        services.mark_attendance(
            self.row,
            EventRegistration.ATTENDANCE_ATTENDED,
            actor=self.staff,
            now=services.marking_opens_at(self.event),
        )

        self.row.refresh_from_db()
        self.assertEqual(self.row.attendance, EventRegistration.ATTENDANCE_ATTENDED)

    def test_a_cancelled_registration_is_not_marked(self):
        services.cancel_registration(self.row, now=self.now)

        self.assertEqual(
            self._refusal(
                services.mark_attendance,
                self.row,
                EventRegistration.ATTENDANCE_ATTENDED,
                actor=self.staff,
                now=self.during,
            ),
            "not_registered",
        )


class AttendancePaysTests(AttendanceFixture):
    def test_attending_pays_the_rule_and_records_who_marked_it(self):
        RewardRule.objects.filter(event=RC.EVENT_ATTENDED).update(points=7)

        services.mark_attendance(
            self.row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=self.during
        )

        self.row.refresh_from_db()
        award = self._award()
        self.assertEqual(
            (self.row.attendance, self.row.marked_by_id, award.points, award.xp),
            (EventRegistration.ATTENDANCE_ATTENDED, self.staff.id, 7, 7),
        )

    def test_the_award_belongs_to_no_classroom(self):
        services.mark_attendance(
            self.row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=self.during
        )

        # An event is not a lesson: the points count towards the student's own balance and the
        # global board, never a class board they are not on.
        self.assertIsNone(self._award().classroom_id)

    def test_marking_twice_pays_once(self):
        for _ in range(2):
            services.mark_attendance(
                self.row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=self.during
            )

        self.assertEqual(
            PointAward.objects.filter(
                idempotency_key=RC.event_attendance_key(self.row.pk)
            ).count(),
            1,
        )

    def test_correcting_attended_to_missed_takes_the_points_back(self):
        services.mark_attendance(
            self.row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=self.during
        )

        services.mark_attendance(
            self.row, EventRegistration.ATTENDANCE_MISSED, actor=self.staff, now=self.during
        )

        self.row.refresh_from_db()
        award = self._award()
        self.assertEqual(
            (self.row.attendance, award.points, award.xp),
            (EventRegistration.ATTENDANCE_MISSED, 0, 0),
        )

    def test_clearing_a_mark_takes_the_points_back_too(self):
        services.mark_attendance(
            self.row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=self.during
        )

        services.mark_attendance(self.row, None, actor=self.staff, now=self.during)

        self.row.refresh_from_db()
        self.assertEqual((self.row.attendance, self._award().points), (None, 0))

    def test_an_unknown_mark_is_refused(self):
        self.assertEqual(
            self._refusal(
                services.mark_attendance, self.row, "MAYBE", actor=self.staff, now=self.during
            ),
            "bad_value",
        )


class RewardRuleSeedTests(TestCase):
    """The migration's own guard, run under the fast (nomigrations) settings.

    This class replaces a with-migrations version: the local migration history is broken
    under Django 6 (see `settings_test_nomigrations`'s docstring — a duplicate
    `option_a_image` add in `exams`, unrelated to this work), so `manage.py migrate` cannot
    run here at all. Instead this loads the migration module directly and calls its own
    `seed()`, which is the only thing that actually needs proving: that the rule is seeded at
    10 points with XP on, and that re-running `seed` (`get_or_create`) never undoes a retune.
    """

    def test_seed_creates_the_rule_and_never_undoes_a_retune(self):
        migration = importlib.import_module("rewards.migrations.0011_event_attended")

        migration.seed(django.apps.apps, None)

        rule = RewardRule.objects.get(event=RC.EVENT_ATTENDED)
        self.assertEqual((rule.points, rule.grants_xp, rule.is_active), (10, True, True))

        RewardRule.objects.filter(event=RC.EVENT_ATTENDED).update(points=7)
        migration.seed(django.apps.apps, None)

        self.assertEqual(RewardRule.objects.get(event=RC.EVENT_ATTENDED).points, 7)
