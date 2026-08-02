"""The off-screen rule on an invigilated mock: 3 seconds of grace, 3 chances, server-owned.

The whole design rests on the browser being able to REPORT an absence but never to DECIDE
what it costs — a client-side tally is cleared by a refresh, which is exactly what a student
gaming the rule would do. These tests pin that, plus the two things that make a mock
different from a midterm: four modules instead of two (a forfeit has to cut the chain from
wherever it happens) and a break that must never be policed.

    python manage.py test mocks.tests_proctoring --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from mocks.models import MockAttempt, MockSessionParticipant
from mocks.proctoring import GRACE_SECONDS, TERMINATION_OFFSCREEN, VIOLATION_LIMIT
from mocks.state_machine import STATE_BREAK, STATE_COMPLETED, STATE_ENGLISH_M1, STATE_MATH_M2
from mocks.tests_scoring import make_mock
from mocks.tests_sessions import make_session

User = get_user_model()


class OffscreenRuleTests(TestCase):
    def setUp(self):
        self.mock, self.mods = make_mock()
        self.session = make_session(self.mock)
        self.student = User.objects.create(username="s", email="s@x.io")
        MockSessionParticipant.objects.create(
            session=self.session, student=self.student, status=MockSessionParticipant.STATUS_APPROVED
        )
        from mocks.sessions import start_session

        start_session(self.session)
        self.attempt = MockAttempt.objects.get(session=self.session)
        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def _report(self, key=None):
        headers = {"HTTP_IDEMPOTENCY_KEY": key} if key else {}
        return self.c.post(f"/api/mocks/attempts/{self.attempt.id}/offscreen/", {}, format="json", **headers)

    def test_the_first_offence_costs_a_chance_and_buys_grace(self):
        body = self._report().json()
        self.assertEqual(body["violations"], 1)
        self.assertEqual(body["grace_seconds"], GRACE_SECONDS)
        self.assertFalse(body["terminated"])
        self.assertEqual(body["limit"], VIOLATION_LIMIT)

    def test_the_third_offence_takes_the_paper_in(self):
        self._report()
        self._report()
        body = self._report().json()

        self.assertEqual(body["violations"], VIOLATION_LIMIT)
        self.assertTrue(body["terminated"])
        self.assertEqual(body["grace_seconds"], 0, "no grace on the last strike")

        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.terminated_reason, TERMINATION_OFFSCREEN)
        self.assertEqual(self.attempt.current_state, STATE_COMPLETED)
        self.assertTrue(self.attempt.is_completed)

    def test_a_forfeited_paper_is_actually_scored(self):
        for _ in range(VIOLATION_LIMIT):
            self._report()
        self.attempt.refresh_from_db()
        # Cut on English module 1: Math was never reached, so it grades as omitted — both
        # sections land on their floor rather than the attempt being left unscored.
        self.assertIsNotNone(self.attempt.total_score)
        self.assertEqual(self.attempt.total_score, 400)

    def test_a_retried_report_does_not_burn_two_chances(self):
        self._report(key="abc")
        self._report(key="abc")
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.offscreen_violations, 1)

    def test_the_count_survives_a_refresh(self):
        self._report()
        # A "new tab" — nothing client-side carries over, so the snapshot must.
        fresh = APIClient()
        fresh.force_authenticate(self.student)
        body = fresh.get(f"/api/mocks/attempts/{self.attempt.id}/status/").json()
        self.assertEqual(body["offscreen_violations"], 1)
        self.assertEqual(body["offscreen_limit"], VIOLATION_LIMIT)
        self.assertEqual(body["offscreen_grace_seconds"], GRACE_SECONDS)
        self.assertTrue(body["proctored"])

    def test_the_break_is_never_policed(self):
        self.attempt.submit_module(answers={})
        self.attempt.submit_module(answers={})
        self.assertEqual(self.attempt.current_state, STATE_BREAK)

        body = self._report().json()

        # A break IS time away from the screen. Charging for it would forfeit everyone.
        self.assertEqual(body["violations"], 0)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, STATE_BREAK)

    def test_a_forfeit_on_the_last_module_still_cuts_straight_to_scoring(self):
        self.attempt.submit_module(answers={})
        self.attempt.submit_module(answers={})
        self.attempt.end_break()
        self.attempt.submit_module(answers={})
        self.assertEqual(self.attempt.current_state, STATE_MATH_M2)

        for _ in range(VIOLATION_LIMIT):
            self._report()

        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, STATE_COMPLETED)

    def test_answers_already_given_survive_the_forfeit(self):
        e1 = self.mods[0]
        qid = str(e1.questions.first().id)
        self.c.post(f"/api/mocks/attempts/{self.attempt.id}/save_attempt/", {"answers": {qid: "a"}}, format="json")

        for _ in range(VIOLATION_LIMIT):
            self._report()

        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.module_answers[str(e1.id)], {qid: "a"})

    def test_reporting_after_the_paper_is_in_is_a_harmless_noop(self):
        for _ in range(VIOLATION_LIMIT):
            self._report()
        body = self._report().json()
        self.assertTrue(body["terminated"])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.offscreen_violations, VIOLATION_LIMIT)


class SoloPracticeIsNotPolicedTests(TestCase):
    """Practice is not an exam: nobody is invigilating, so nothing is forfeited."""

    def setUp(self):
        self.mock, _mods = make_mock()
        self.student = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.student)
        aid = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json").json()["id"]
        self.c.post(f"/api/mocks/attempts/{aid}/start/", {}, format="json")
        self.attempt = MockAttempt.objects.get(pk=aid)

    def test_a_solo_attempt_is_not_proctored(self):
        self.assertFalse(self.attempt.is_proctored)
        body = self.c.get(f"/api/mocks/attempts/{self.attempt.id}/status/").json()
        self.assertFalse(body["proctored"])
        self.assertIsNone(body["session_id"])

    def test_a_crafted_client_cannot_burn_strikes_on_a_practice_paper(self):
        body = self.c.post(f"/api/mocks/attempts/{self.attempt.id}/offscreen/", {}, format="json").json()
        self.assertEqual(body["violations"], 0)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.offscreen_violations, 0)
        self.assertEqual(self.attempt.current_state, STATE_ENGLISH_M1)


class NoPauseAnywhereTests(TestCase):
    """The clock cannot be stopped — by anyone, on any mock."""

    def setUp(self):
        self.mock, _mods = make_mock()
        self.student = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.student)
        self.aid = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json").json()["id"]
        self.c.post(f"/api/mocks/attempts/{self.aid}/start/", {}, format="json")

    def test_the_pause_endpoints_are_gone(self):
        for path in ("pause", "resume_pause"):
            r = self.c.post(f"/api/mocks/attempts/{self.aid}/{path}/", {}, format="json")
            self.assertEqual(r.status_code, 404, f"{path} must not exist")

    def test_the_snapshot_never_reports_a_paused_mock(self):
        body = self.c.get(f"/api/mocks/attempts/{self.aid}/status/").json()
        self.assertFalse(body["is_paused"])
