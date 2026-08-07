"""Award service: idempotency, correction, revocation, seasons, and failure isolation."""

from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase

from classes.models import Classroom
from rewards import constants
from rewards.models import PointAward, PointAwardAudit, RewardRule, RewardSeason
from rewards.services import (
    award,
    balance,
    balances_for,
    current_season,
    points_for,
    revoke,
    start_new_season,
)

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class PointsForTests(TestCase):
    def test_reads_the_rule_row(self):
        RewardRule.objects.update_or_create(
            event=constants.EVENT_ATTENDANCE_PRESENT, defaults={"points": 7}
        )
        self.assertEqual(points_for(constants.EVENT_ATTENDANCE_PRESENT), 7)

    def test_falls_back_to_the_default_when_no_rule_exists(self):
        RewardRule.objects.filter(event=constants.EVENT_SURVEY).delete()
        self.assertEqual(points_for(constants.EVENT_SURVEY), 40)

    def test_an_inactive_rule_falls_back_rather_than_awarding_nothing(self):
        RewardRule.objects.update_or_create(
            event=constants.EVENT_SURVEY, defaults={"points": 99, "is_active": False}
        )
        self.assertEqual(points_for(constants.EVENT_SURVEY), 40)


class AwardIdempotencyTests(TestCase):
    def setUp(self):
        self.student = _u("rw_s1@t.com")

    def test_grant_writes_the_award_and_one_audit_row(self):
        a = award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")
        self.assertIsNotNone(a)
        self.assertEqual(a.points, 40)
        self.assertEqual(PointAward.objects.count(), 1)
        audit = PointAwardAudit.objects.get(award=a)
        self.assertIsNone(audit.previous_points)
        self.assertEqual(audit.new_points, 40)

    def test_re_running_with_the_same_value_writes_nothing_at_all(self):
        """The backfill / duplicate-delivery case. Not even an audit row, or every re-run of
        a management command would look like a change in the student's history."""
        first = award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")
        again = award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")

        self.assertEqual(again.pk, first.pk)
        self.assertEqual(PointAward.objects.count(), 1)
        self.assertEqual(PointAwardAudit.objects.count(), 1)

    def test_a_changed_value_corrects_in_place_and_leaves_a_trail(self):
        award(self.student, constants.EVENT_HOMEWORK_MID, idempotency_key="homework:1:1")
        corrected = award(
            self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="homework:1:1"
        )

        self.assertEqual(PointAward.objects.count(), 1)   # corrected, not stacked
        self.assertEqual(corrected.points, 15)
        self.assertEqual(corrected.event, constants.EVENT_HOMEWORK_FULL)
        self.assertEqual(balance(self.student), 15)

        trail = list(PointAwardAudit.objects.filter(award=corrected).order_by("id"))
        self.assertEqual([(t.previous_points, t.new_points) for t in trail], [(None, 5), (5, 15)])

    def test_an_explicit_zero_is_recorded_so_a_later_regrade_can_lift_it(self):
        a = award(self.student, constants.EVENT_MANUAL, idempotency_key="manual:x", points=0)
        self.assertEqual(a.points, 0)
        self.assertEqual(PointAward.objects.count(), 1)


class PricingIsFrozenAtGrantTests(TestCase):
    """A rule is a price list for FUTURE earnings, not a lever over banked ones."""

    def setUp(self):
        self.student = _u("rw_price@t.com")

    def test_retuning_a_rule_does_not_restate_an_award_already_banked(self):
        """Hooks re-fire freely and the deadline sweep re-runs hourly, so re-reading the rule
        on every correction would silently rewrite history students have already seen."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="homework:1:1")
        self.assertEqual(balance(self.student), 15)

        RewardRule.objects.update_or_create(
            event=constants.EVENT_HOMEWORK_FULL, defaults={"points": 5}
        )
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="homework:1:1")

        self.assertEqual(balance(self.student), 15)

    def test_a_retuned_rule_does_price_the_next_new_earning(self):
        RewardRule.objects.update_or_create(
            event=constants.EVENT_HOMEWORK_FULL, defaults={"points": 5}
        )
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="homework:2:1")
        self.assertEqual(balance(self.student), 5)

    def test_a_changed_event_is_a_changed_fact_and_re_prices(self):
        """A re-grade moving MID→FULL must move the points; only the RULE is frozen."""
        award(self.student, constants.EVENT_HOMEWORK_MID, idempotency_key="homework:3:1")
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="homework:3:1")
        self.assertEqual(balance(self.student), 15)

    def test_a_revoked_award_is_restored_at_the_rules_value(self):
        """PRESENT → ABSENT → PRESENT has to give the 5 back, not keep the zero."""
        key = "attendance:99"
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key=key)
        revoke(key, reason="marked absent")
        self.assertEqual(balance(self.student), 0)

        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key=key)
        self.assertEqual(balance(self.student), 5)


class RevokeTests(TestCase):
    def setUp(self):
        self.student = _u("rw_s2@t.com")

    def test_revoke_zeroes_the_award_but_keeps_the_row_and_history(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="attendance:1")
        self.assertTrue(revoke("attendance:1", reason="marked absent"))

        a = PointAward.objects.get(idempotency_key="attendance:1")
        self.assertEqual(a.points, 0)
        self.assertEqual(balance(self.student), 0)
        self.assertEqual(PointAwardAudit.objects.filter(award=a).count(), 2)

    def test_revoking_an_unknown_key_is_a_harmless_no_op(self):
        self.assertFalse(revoke("attendance:999", reason="never existed"))

    def test_revoking_twice_writes_only_one_audit_row(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="attendance:1")
        revoke("attendance:1", reason="first")
        self.assertFalse(revoke("attendance:1", reason="second"))
        a = PointAward.objects.get(idempotency_key="attendance:1")
        self.assertEqual(PointAwardAudit.objects.filter(award=a).count(), 2)


class FailureIsolationTests(TestCase):
    """An award must never break the thing that triggered it."""

    def setUp(self):
        self.student = _u("rw_s3@t.com")

    def test_a_write_failure_returns_none_instead_of_raising(self):
        with mock.patch.object(
            PointAwardAudit.objects, "create", side_effect=IntegrityError("boom")
        ):
            self.assertIsNone(
                award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")
            )
        self.assertEqual(PointAward.objects.count(), 0)   # rolled back with the savepoint

    def test_a_failure_leaves_the_callers_transaction_usable(self):
        """The regression this pins: catching a database error without a savepoint leaves the
        surrounding transaction aborted on PostgreSQL, so every later query in the request
        fails. The hook sites all run inside someone else's transaction."""
        with transaction.atomic():
            Classroom.objects.create(
                name="Before", subject=Classroom.SUBJECT_MATH,
                lesson_days=Classroom.DAYS_ODD, created_by=self.student,
            )
            with mock.patch.object(
                PointAwardAudit.objects, "create", side_effect=IntegrityError("boom")
            ):
                award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")

            # Would raise TransactionManagementError if the failure had poisoned the block.
            Classroom.objects.create(
                name="After", subject=Classroom.SUBJECT_MATH,
                lesson_days=Classroom.DAYS_ODD, created_by=self.student,
            )

        self.assertEqual(Classroom.objects.filter(name__in=["Before", "After"]).count(), 2)

    def test_a_missing_student_is_ignored_rather_than_crashing(self):
        self.assertIsNone(award(None, constants.EVENT_SURVEY, idempotency_key="survey:2"))


class BalanceTests(TestCase):
    def setUp(self):
        self.s1, self.s2 = _u("rw_b1@t.com"), _u("rw_b2@t.com")
        self.classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.s1,
        )

    def test_balance_sums_the_ledger(self):
        award(self.s1, constants.EVENT_SURVEY, idempotency_key="survey:1")
        award(self.s1, constants.EVENT_MIDTERM_PASS, idempotency_key="midterm:1")
        self.assertEqual(balance(self.s1), 60)
        self.assertEqual(balance(self.s2), 0)

    def test_cohort_balances_in_one_call(self):
        award(self.s1, constants.EVENT_SURVEY, idempotency_key="survey:1")
        award(self.s2, constants.EVENT_MIDTERM_PASS, idempotency_key="midterm:2")
        self.assertEqual(
            balances_for([self.s1.id, self.s2.id]), {self.s1.id: 40, self.s2.id: 20}
        )

    def test_scoping_to_a_classroom_excludes_classroom_less_earnings(self):
        """Surveys and midterms belong to no single class. They count toward the global
        balance but must not appear on one classroom's board."""
        award(
            self.s1, constants.EVENT_ATTENDANCE_PRESENT,
            idempotency_key="attendance:1", classroom=self.classroom,
        )
        award(self.s1, constants.EVENT_SURVEY, idempotency_key="survey:1")   # no classroom

        self.assertEqual(balance(self.s1), 45)
        self.assertEqual(balances_for([self.s1.id], classroom=self.classroom), {self.s1.id: 5})


class SeasonTests(TestCase):
    def setUp(self):
        self.student = _u("rw_season@t.com")

    def test_the_first_season_is_created_on_demand(self):
        RewardSeason.objects.all().delete()
        season = current_season()
        self.assertTrue(season.is_current)
        self.assertEqual(RewardSeason.objects.count(), 1)

    def test_starting_a_new_season_resets_the_balance_without_deleting_history(self):
        award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")
        self.assertEqual(balance(self.student), 40)

        start_new_season("Season 2")

        self.assertEqual(balance(self.student), 0)          # fresh start
        self.assertEqual(PointAward.objects.count(), 1)     # nothing destroyed
        old = RewardSeason.objects.get(name="Season 1")
        self.assertFalse(old.is_current)
        self.assertIsNotNone(old.ended_at)

    def test_only_one_season_can_be_current(self):
        start_new_season("Season 2")
        self.assertEqual(RewardSeason.objects.filter(is_current=True).count(), 1)
