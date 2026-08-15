"""XP: the same earnings as points, on a smaller set of events, and it never goes down.

Two rules, and every test here is one of them:

  1. ATTENDANCE_LATE and SURVEY earn points but no XP.
  2. XP is a high-water mark. Nothing — a re-grade, a correction, a revocation, a season
     reset — can lower it.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from rewards import constants
from rewards.models import PointAward, PointAwardAudit
from rewards.services import (
    award,
    balance,
    revoke,
    start_new_season,
    xp_balance,
    xp_balances_for,
)

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class ExcludedEventTests(TestCase):
    """Turning up late and filling in a survey are worth points. Neither is worth XP."""

    def setUp(self):
        self.student = _u("xp_ex@t.com")

    def test_a_late_arrival_earns_points_but_no_xp(self):
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="att:late")

        self.assertEqual(balance(self.student), 3)
        self.assertEqual(xp_balance(self.student), 0)

    def test_a_survey_earns_points_but_no_xp(self):
        award(self.student, constants.EVENT_SURVEY, idempotency_key="sv:1")

        self.assertEqual(balance(self.student), 40)
        self.assertEqual(xp_balance(self.student), 0)

    def test_being_present_earns_both(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:present")

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 5)

    def test_the_two_totals_differ_by_exactly_the_excluded_events(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="a")   # 5 / 5
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="b")      # 3 / 0
        award(self.student, constants.EVENT_SURVEY, idempotency_key="c")               # 40 / 0
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="d")        # 15 / 15

        self.assertEqual(balance(self.student), 63)
        self.assertEqual(xp_balance(self.student), 20)


class MonotonicTests(TestCase):
    """The load-bearing rule: XP has no downward direction."""

    def setUp(self):
        self.student = _u("xp_mono@t.com")

    def test_a_revocation_zeroes_the_points_and_leaves_the_xp(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:1")
        revoke("att:1", reason="marked absent after all")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), 5)

    def test_a_regrade_downwards_lowers_the_points_and_leaves_the_xp(self):
        """HOMEWORK_FULL corrected to HOMEWORK_MID: 15 points becomes 5, XP stays at 15."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:1")
        award(self.student, constants.EVENT_HOMEWORK_MID, idempotency_key="hw:1")

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 15)

    def test_a_regrade_upwards_raises_both(self):
        award(self.student, constants.EVENT_HOMEWORK_MID, idempotency_key="hw:2")
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:2")

        self.assertEqual(balance(self.student), 15)
        self.assertEqual(xp_balance(self.student), 15)

    def test_present_corrected_to_late_keeps_the_xp_already_banked(self):
        """LATE earns no XP, but the PRESENT that came first did — and XP is not taken back.

        Worth stating plainly because it is the one case where the two rules meet and the
        answer is not obvious: the exclusion decides what an event *grants*, never what it
        takes away.
        """
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:2")
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="att:2")

        self.assertEqual(balance(self.student), 3)
        self.assertEqual(xp_balance(self.student), 5)

    def test_absent_then_corrected_back_to_present_restores_both(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:3")
        revoke("att:3", reason="absent")
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:3")

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 5)

    def test_a_manual_deduction_cannot_produce_negative_xp(self):
        award(self.student, constants.EVENT_MANUAL, idempotency_key="m:1", points=-20)

        self.assertEqual(balance(self.student), -20)
        self.assertEqual(xp_balance(self.student), 0)

    def test_a_season_reset_zeroes_the_points_but_not_the_xp(self):
        """XP is lifetime. A reset is the school clearing the scoreboard, and it is also the
        largest possible subtraction — so it is the one XP most has to survive."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:3")
        start_new_season("Season 2")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), 15)


class AuditTests(TestCase):
    def setUp(self):
        self.student = _u("xp_audit@t.com")

    def test_the_first_grant_records_the_xp_it_created(self):
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:a")

        row = PointAwardAudit.objects.get()
        self.assertIsNone(row.previous_xp)
        self.assertEqual(row.new_xp, 15)

    def test_a_revocation_records_the_xp_that_did_not_move(self):
        """So "why is my XP higher than my points?" is answerable from the ledger alone."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:b")
        revoke("hw:b", reason="withdrawn")

        row = PointAwardAudit.objects.order_by("-id").first()
        self.assertEqual((row.previous_points, row.new_points), (15, 0))
        self.assertEqual((row.previous_xp, row.new_xp), (15, 15))

    def test_a_no_op_rerun_still_writes_nothing(self):
        """The property the hooks depend on: signals fire freely and cost nothing."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:c")
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="hw:c")

        self.assertEqual(PointAwardAudit.objects.count(), 1)


class CohortReadTests(TestCase):
    def setUp(self):
        self.a = _u("xp_a@t.com")
        self.b = _u("xp_b@t.com")

    def test_xp_balances_for_reads_a_cohort_in_one_query(self):
        award(self.a, constants.EVENT_HOMEWORK_FULL, idempotency_key="x:1")
        award(self.b, constants.EVENT_SURVEY, idempotency_key="x:2")

        result = xp_balances_for([self.a.id, self.b.id])

        self.assertEqual(result[self.a.id], 15)
        self.assertEqual(result[self.b.id], 0)

    def test_a_student_with_no_awards_is_absent_rather_than_zero(self):
        """Same contract as `balances_for` — a board must default them, not read a 0 that
        was never written."""
        self.assertEqual(xp_balances_for([self.a.id]), {})

    def test_an_empty_cohort_does_not_query(self):
        with self.assertNumQueries(0):
            self.assertEqual(xp_balances_for([]), {})


class XpApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("xp_api@t.com")

    def test_the_points_page_reports_xp(self):
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="api:1")
        award(self.student, constants.EVENT_SURVEY, idempotency_key="api:2")
        self.client.force_authenticate(self.student)

        body = self.client.get("/api/rewards/me/").json()

        self.assertEqual(body["points"], 55)
        self.assertEqual(body["xp"], 15)


class BackfillTests(TestCase):
    """The 0004 migration gives existing students the XP their history already earned.

    Exercised against the real app registry rather than a historical one: `backfill_xp` only
    reaches for `apps.get_model`, `annotate` and `bulk_update`, all of which behave the same
    either way, and calling it directly is what lets these tests set up the awkward states
    (a revoked award, an excluded event) through the ordinary service API.
    """

    def setUp(self):
        self.student = _u("xp_backfill@t.com")
        from importlib import import_module

        self._backfill = import_module(
            "rewards.migrations.0004_pointaward_xp_pointawardaudit_new_xp_and_more"
        ).backfill_xp

    def _run(self):
        from django.apps import apps as registry

        PointAward.objects.update(xp=0)      # the pre-migration state
        self._backfill(registry, None)

    def test_a_revoked_award_is_backfilled_from_its_audit_peak(self):
        """Why the backfill reads the audit table rather than `points`: a revoked award reads
        0 today, but the student did earn it, and XP is never taken back."""
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="bf:1")
        revoke("bf:1", reason="withdrawn")

        self._run()

        self.assertEqual(xp_balance(self.student), 15)

    def test_a_downgraded_award_is_backfilled_from_its_peak(self):
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="bf:2")
        award(self.student, constants.EVENT_HOMEWORK_MID, idempotency_key="bf:2")

        self._run()

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 15)

    def test_the_excluded_events_are_backfilled_to_nothing(self):
        award(self.student, constants.EVENT_SURVEY, idempotency_key="bf:3")
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="bf:4")

        self._run()

        self.assertEqual(xp_balance(self.student), 0)

    def test_the_backfill_is_safe_to_run_twice(self):
        award(self.student, constants.EVENT_HOMEWORK_FULL, idempotency_key="bf:5")

        self._run()
        from django.apps import apps as registry

        self._backfill(registry, None)       # again, without zeroing first

        self.assertEqual(xp_balance(self.student), 15)
