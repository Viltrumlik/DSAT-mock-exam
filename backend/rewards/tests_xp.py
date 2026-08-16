"""XP: the same earnings as points, on every event, and it never falls for doing worse.

Two rules, and every test here is one of them:

  1. XP follows points everywhere. The old ATTENDANCE_LATE / SURVEY exclusion is gone; the
     lever that replaces it is per-rule data, ``RewardRule.grants_xp``.
  2. XP is a high-water mark *while the earning stands*. A re-grade downwards, a correction to
     a lesser event, a season reset — none of them can lower it. A **revocation** can, and
     only a revocation: a fact that never happened takes its XP with it.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from rewards import constants
from rewards.models import PointAward, PointAwardAudit, RewardRule
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


class XpFollowsPointsTests(TestCase):
    """Every event earns XP equal to its points. The exclusion list is empty."""

    def setUp(self):
        self.student = _u("xp_ex@t.com")

    def test_a_late_arrival_earns_xp_as_well_as_points(self):
        """Inverted deliberately. Turning up late used to earn points and no XP; the school
        wants one number that rises from everything a student does."""
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="att:late")

        self.assertEqual(balance(self.student), 3)
        self.assertEqual(xp_balance(self.student), 3)

    def test_a_survey_earns_xp_as_well_as_points(self):
        """Inverted deliberately, and this is the expensive one: at 40 points a single
        questionnaire is now worth two midterm passes on the XP board. The school was told and
        asked for it anyway; `grants_xp` is how they take it back."""
        award(self.student, constants.EVENT_SURVEY, idempotency_key="sv:1")

        self.assertEqual(balance(self.student), 40)
        self.assertEqual(xp_balance(self.student), 40)

    def test_being_present_earns_both(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:present")

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 5)

    def test_the_two_totals_now_agree(self):
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="a")   # 5 / 5
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="b")      # 3 / 3
        award(self.student, constants.EVENT_SURVEY, idempotency_key="c")               # 40 / 40
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="d", points=15)  # 15 / 15

        self.assertEqual(balance(self.student), 63)
        self.assertEqual(xp_balance(self.student), 63)

    def test_a_rule_can_take_an_event_back_out_of_xp(self):
        """The replacement for the deleted constant, and the whole reason it is a column: the
        school can put SURVEY back outside XP from the admin, without a deploy."""
        RewardRule.objects.update_or_create(
            event=constants.EVENT_SURVEY, defaults={"points": 40, "grants_xp": False}
        )
        award(self.student, constants.EVENT_SURVEY, idempotency_key="sv:2")

        self.assertEqual(balance(self.student), 40)
        self.assertEqual(xp_balance(self.student), 0)

    def test_an_event_with_no_rule_row_still_earns_xp(self):
        """The fallback is the empty `XP_EXCLUDED_EVENTS`, so a brand-new event is not
        silently XP-less until somebody remembers to seed a rule for it."""
        RewardRule.objects.filter(event=constants.EVENT_MIDTERM_PASS).delete()
        award(self.student, constants.EVENT_MIDTERM_PASS, idempotency_key="mt:1")

        self.assertEqual(xp_balance(self.student), 20)


class MonotonicTests(TestCase):
    """The load-bearing rule: XP does not fall for doing WORSE. Only a withdrawal takes it."""

    def setUp(self):
        self.student = _u("xp_mono@t.com")

    def test_a_revocation_zeroes_the_points_and_the_xp(self):
        """Inverted deliberately, and this is the change that makes save-time attendance
        payment safe: the register pays the moment a teacher hits save, and one "Mark all
        present" mis-click writes PRESENT for the whole roster. If XP survived the correction,
        that mis-click would grant XP to every absentee for good."""
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:1")
        revoke("att:1", reason="marked absent after all")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), 0)

    def test_a_regrade_downwards_lowers_the_points_and_leaves_the_xp(self):
        """A homework re-settled at a lower percent: 15 points becomes 5, XP stays at 15.

        The other half of the rule, and the half that did NOT change — a fact that got smaller
        is not a fact that never happened.
        """
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:1", points=15)
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:1", points=5)

        self.assertEqual(balance(self.student), 5)
        self.assertEqual(xp_balance(self.student), 15)

    def test_a_regrade_upwards_raises_both(self):
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:2", points=5)
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:2", points=15)

        self.assertEqual(balance(self.student), 15)
        self.assertEqual(xp_balance(self.student), 15)

    def test_present_corrected_to_late_keeps_the_xp_already_banked(self):
        """PRESENT (5) corrected to LATE (3) is a smaller fact, not a withdrawn one: the points
        fall to 3 and the XP stays at the 5 already banked.

        Worth keeping now that LATE grants XP of its own — it pins that the high-water mark
        governs a *downgrade between events*, not just a downgrade in amount.
        """
        award(self.student, constants.EVENT_ATTENDANCE_PRESENT, idempotency_key="att:2")
        award(self.student, constants.EVENT_ATTENDANCE_LATE, idempotency_key="att:2")

        self.assertEqual(balance(self.student), 3)
        self.assertEqual(xp_balance(self.student), 5)

    def test_absent_then_corrected_back_to_present_restores_both(self):
        """The other side of a revocation clearing XP: the correction has to give it back, or
        a teacher fixing their own mis-click would leave the student short."""
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
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:3", points=15)
        start_new_season("Season 2")

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), 15)


class AuditTests(TestCase):
    def setUp(self):
        self.student = _u("xp_audit@t.com")

    def test_the_first_grant_records_the_xp_it_created(self):
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:a", points=15)

        row = PointAwardAudit.objects.get()
        self.assertIsNone(row.previous_xp)
        self.assertEqual(row.new_xp, 15)

    def test_a_revocation_records_the_xp_leaving(self):
        """Inverted deliberately — it used to assert the XP did *not* move. It does now, and
        the audit row is the only place "why did my XP drop?" can be answered from."""
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:b", points=15)
        revoke("hw:b", reason="withdrawn")

        row = PointAwardAudit.objects.order_by("-id").first()
        self.assertEqual((row.previous_points, row.new_points), (15, 0))
        self.assertEqual((row.previous_xp, row.new_xp), (15, 0))

    def test_a_no_op_rerun_still_writes_nothing(self):
        """The property the hooks depend on: signals fire freely and cost nothing."""
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:c", points=15)
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:c", points=15)

        self.assertEqual(PointAwardAudit.objects.count(), 1)

    def test_re_revoking_a_fully_zeroed_award_writes_nothing(self):
        """A revoke hook re-firing must stay free, the same as an award re-firing."""
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="hw:d", points=15)
        self.assertTrue(revoke("hw:d", reason="withdrawn"))
        self.assertFalse(revoke("hw:d", reason="withdrawn again"))

        self.assertEqual(PointAwardAudit.objects.count(), 2)


class CohortReadTests(TestCase):
    def setUp(self):
        self.a = _u("xp_a@t.com")
        self.b = _u("xp_b@t.com")

    def test_xp_balances_for_reads_a_cohort_in_one_query(self):
        award(self.a, constants.EVENT_HOMEWORK, idempotency_key="x:1", points=15)
        award(self.b, constants.EVENT_SURVEY, idempotency_key="x:2")

        result = xp_balances_for([self.a.id, self.b.id])

        self.assertEqual(result[self.a.id], 15)
        self.assertEqual(result[self.b.id], 40)   # was 0 while SURVEY was excluded

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
        award(self.student, constants.EVENT_HOMEWORK, idempotency_key="api:1", points=15)
        award(self.student, constants.EVENT_SURVEY, idempotency_key="api:2")
        self.client.force_authenticate(self.student)

        body = self.client.get("/api/rewards/me/").json()

        self.assertEqual(body["points"], 55)
        self.assertEqual(body["xp"], 55)   # was 15 while SURVEY was excluded


class BackfillTests(TestCase):
    """The 0004 migration gives existing students the XP their history already earned.

    Exercised against the real app registry rather than a historical one: `backfill_xp` only
    reaches for `apps.get_model`, `annotate` and `bulk_update`, all of which behave the same
    either way, and calling it directly is what lets these tests set up the awkward states
    (a revoked award, an excluded event) through the ordinary service API.

    These deliberately still use the LEGACY homework events and still expect the old exclusion
    to hold. 0004 hardcodes the excluded list as a literal tuple on purpose — it has to keep
    meaning what it meant on the day it ran against production — so these assertions pin the
    migration, not the live rule.
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

    def test_the_events_excluded_on_the_day_it_ran_are_backfilled_to_nothing(self):
        """Both events grant XP live now. The migration still gives them none, which is the
        whole point of its frozen tuple: history is not restated by a later policy change."""
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
