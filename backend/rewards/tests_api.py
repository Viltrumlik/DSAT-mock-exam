"""The read-only reward surfaces."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Classroom
from rewards import constants
from rewards.services import award, revoke

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class MyRewardsViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("api_s1@t.com")
        self.other = _u("api_s2@t.com")
        self.classroom = Classroom.objects.create(
            name="Maths A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.student,
        )

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/rewards/me/").status_code, 401)

    def test_returns_the_balance_and_history(self):
        award(
            self.student, constants.EVENT_ATTENDANCE_PRESENT,
            idempotency_key="attendance:1", classroom=self.classroom,
        )
        award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")

        self.client.force_authenticate(self.student)
        body = self.client.get("/api/rewards/me/").json()

        self.assertEqual(body["points"], 45)
        self.assertEqual(body["points_per_coin"], 10)
        self.assertEqual(len(body["history"]), 2)
        by_event = {row["event"]: row for row in body["history"]}
        self.assertEqual(by_event["ATTENDANCE_PRESENT"]["classroom_name"], "Maths A")
        self.assertEqual(by_event["SURVEY"]["classroom_name"], None)
        self.assertEqual(by_event["SURVEY"]["label"], "Survey completed")

    def test_shows_only_the_callers_own_earnings(self):
        award(self.other, constants.EVENT_SURVEY, idempotency_key="survey:2")

        self.client.force_authenticate(self.student)
        body = self.client.get("/api/rewards/me/").json()

        self.assertEqual(body["points"], 0)
        self.assertEqual(body["history"], [])

    def test_revoked_earnings_drop_out_of_the_feed(self):
        """A zeroed row is ledger bookkeeping. Showing "Attended a lesson — 0" to a student
        whose mark was corrected reads as a punishment notice."""
        award(
            self.student, constants.EVENT_ATTENDANCE_PRESENT,
            idempotency_key="attendance:1", classroom=self.classroom,
        )
        revoke("attendance:1", reason="marked absent")

        self.client.force_authenticate(self.student)
        body = self.client.get("/api/rewards/me/").json()

        self.assertEqual(body["points"], 0)
        self.assertEqual(body["history"], [])

    def test_the_season_never_reaches_the_student(self):
        """The season is an internal accounting boundary the school does not want students
        reasoning about. Hiding it in the UI would not hide it — anything in this payload is
        readable by anyone who opens devtools, so it has to be absent from the wire."""
        award(self.student, constants.EVENT_SURVEY, idempotency_key="survey:1")

        self.client.force_authenticate(self.student)
        body = self.client.get("/api/rewards/me/").json()

        self.assertNotIn("season", body)
        self.assertNotIn("season", str(body["history"]))


class RewardRulesViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("api_rules@t.com")

    def test_lists_what_earns_what(self):
        self.client.force_authenticate(self.student)
        rules = {r["event"]: r["points"] for r in self.client.get("/api/rewards/rules/").json()["rules"]}

        self.assertEqual(rules["ATTENDANCE_PRESENT"], 5)
        self.assertEqual(rules["ATTENDANCE_LATE"], 3)
        self.assertEqual(rules["SUPPORT_SESSION"], 10)
        self.assertEqual(rules["SURVEY"], 40)
        self.assertEqual(rules["MIDTERM_PASS"], 20)
        self.assertEqual(rules["MIDTERM_RETAKE_PASS"], 5)
        self.assertEqual(rules["HOMEWORK_FULL"], 15)

    def test_a_support_hour_serves_its_whole_group_ladder(self):
        """`points` is only the bottom rung: an hour pays per head and the rate climbs with the
        group. A rewards page that printed "+10" and nothing else would give a student no
        reason to bring the classmate the invite button exists for — and the three numbers are
        computed from the rule rather than typed into React, so retuning the rung moves them."""
        self.client.force_authenticate(self.student)
        rules = {r["event"]: r for r in self.client.get("/api/rewards/rules/").json()["rules"]}

        self.assertEqual(rules["SUPPORT_SESSION"]["group_points"], [10, 15, 20])
        # Every other earning is flat, and must say so rather than carry a misleading ladder.
        self.assertIsNone(rules["ATTENDANCE_PRESENT"]["group_points"])

    def test_says_which_earnings_do_not_add_xp(self):
        """The rewards page prints "+40" beside a survey, and since 2026-09-01 that number no
        longer tells the whole story — the earning pays points and no XP.

        Served rather than hardcoded in React: `grants_xp` is a checkbox the school can tick
        back on without a deploy, and a sentence in the UI would go on saying the opposite. So
        the payload has to carry it, and this pins that it does.
        """
        self.client.force_authenticate(self.student)
        rules = {r["event"]: r for r in self.client.get("/api/rewards/rules/").json()["rules"]}

        self.assertFalse(rules["SURVEY"]["grants_xp"])
        self.assertTrue(rules["ATTENDANCE_PRESENT"]["grants_xp"])

    def test_hides_the_manual_adjustment_row(self):
        """Not something a student can aim for."""
        self.client.force_authenticate(self.student)
        events = {r["event"] for r in self.client.get("/api/rewards/rules/").json()["rules"]}
        self.assertNotIn("MANUAL", events)
