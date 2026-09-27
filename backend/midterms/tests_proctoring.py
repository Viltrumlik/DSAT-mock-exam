"""The off-screen rule, enforced server-side.

The rule is 3 seconds of grace on the first two offences and instant forfeit on the third.
Every test here exists because the obvious implementation — counting in the browser — is
defeated by a refresh, and because the early-submit lock (`submit_module` 403s any
non-expired ACTIVE submit) has to be relaxed for exactly this case and no other.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt, MidtermAttemptEngineAudit
from midterms.proctoring import GRACE_SECONDS, VIOLATION_LIMIT

User = get_user_model()


class OffscreenRuleTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username="stu", email="stu@example.com", password="x", role="student"
        )
        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=60)
        for i in range(4):
            Question.objects.create(
                module=module, question_type="MATH", question_text=f"Q{i}",
                option_a="A", option_b="B", option_c="C", option_d="D",
                correct_answers="a", score=10, order=i,
            )
        self.midterm = Midterm.objects.create(
            title="MT", subject=Midterm.MATH, scoring_scale="SCALE_100",
            duration_minutes=60, question_module=module, is_published=True,
        )
        ResourceAccessGrant.objects.create(
            user=self.student, resource_type=RT_MIDTERM_V2, resource_id=self.midterm.id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE, status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        self.attempt = MidtermAttempt.objects.create(midterm=self.midterm, student=self.student)
        self.attempt.start_attempt()
        self.attempt.refresh_from_db()

        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _offscreen(self, *, key=None, body=None):
        url = f"/api/midterms/attempts/{self.attempt.pk}/offscreen/"
        headers = {"HTTP_IDEMPOTENCY_KEY": key} if key else {}
        return self.client.post(url, body or {}, format="json", **headers)

    # ── the rule ─────────────────────────────────────────────────────────────
    def test_first_offence_grants_grace_and_does_not_terminate(self):
        resp = self._offscreen()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["violations"], 1)
        self.assertEqual(resp.data["grace_seconds"], GRACE_SECONDS)
        self.assertFalse(resp.data["terminated"])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, MidtermAttempt.STATE_ACTIVE)

    def test_second_offence_still_grants_grace(self):
        self._offscreen()
        resp = self._offscreen()
        self.assertEqual(resp.data["violations"], 2)
        self.assertEqual(resp.data["grace_seconds"], GRACE_SECONDS)
        self.assertFalse(resp.data["terminated"])

    def test_third_offence_terminates_immediately_with_no_grace(self):
        self._offscreen()
        self._offscreen()
        resp = self._offscreen()
        self.assertEqual(resp.data["violations"], VIOLATION_LIMIT)
        self.assertEqual(resp.data["grace_seconds"], 0)
        self.assertTrue(resp.data["terminated"])

        self.attempt.refresh_from_db()
        self.assertTrue(self.attempt.is_completed or self.attempt.current_state != MidtermAttempt.STATE_ACTIVE)
        self.assertEqual(self.attempt.terminated_reason, MidtermAttempt.TERMINATION_OFFSCREEN)

    def test_terminated_attempt_is_actually_scored(self):
        for _ in range(VIOLATION_LIMIT):
            self._offscreen()
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, MidtermAttempt.STATE_COMPLETED)
        self.assertIsNotNone(self.attempt.score)

    # ── the count must survive the client ────────────────────────────────────
    def test_count_lives_on_the_server_so_a_refresh_cannot_reset_it(self):
        self._offscreen()
        self._offscreen()
        # A "fresh page load" — brand new client, no local state whatsoever.
        fresh = APIClient()
        fresh.force_authenticate(self.student)
        snapshot = fresh.get(f"/api/midterms/attempts/{self.attempt.pk}/status/")
        self.assertEqual(snapshot.data["offscreen_violations"], 2)
        # ...and the next offence is still the terminating one.
        resp = fresh.post(f"/api/midterms/attempts/{self.attempt.pk}/offscreen/", {}, format="json")
        self.assertTrue(resp.data["terminated"])

    def test_snapshot_publishes_the_limits_to_the_runner(self):
        data = self.client.get(f"/api/midterms/attempts/{self.attempt.pk}/status/").data
        self.assertEqual(data["offscreen_limit"], VIOLATION_LIMIT)
        self.assertEqual(data["offscreen_grace_seconds"], GRACE_SECONDS)

    def test_retried_report_does_not_burn_two_chances(self):
        self._offscreen(key="evt-1")
        self._offscreen(key="evt-1")
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.offscreen_violations, 1)

    def test_report_after_completion_is_a_harmless_noop(self):
        for _ in range(VIOLATION_LIMIT):
            self._offscreen()
        resp = self._offscreen()  # e.g. a closing tab firing one last event
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["violations"], VIOLATION_LIMIT)

    # ── every counted offence leaves evidence ────────────────────────────────
    # Until this existed the only trace of a strike was its idempotency row: nothing said
    # whether the page was hidden, fullscreen was exited or focus moved, nor whether strikes
    # 2 and 3 were new absences or ONE absence running out its grace. That question had to be
    # answered from gunicorn logs, which rotate away after a week.
    def _evidence(self):
        return list(
            MidtermAttemptEngineAudit.objects.filter(attempt=self.attempt, event="offscreen")
            .order_by("id")
            .values_list("detail", flat=True)
        )

    def test_each_counted_offence_is_logged_with_what_the_browser_saw(self):
        self._offscreen(body={"reason": "fullscreen", "continuing": False})
        self._offscreen(body={"reason": "fullscreen", "continuing": True})
        self.assertEqual(
            self._evidence(),
            [
                {"reason": "fullscreen", "continuing": False, "violations": 1, "terminated": False},
                {"reason": "fullscreen", "continuing": True, "violations": 2, "terminated": False},
            ],
        )

    def test_the_terminating_offence_is_logged_before_the_submit_it_causes(self):
        for _ in range(VIOLATION_LIMIT):
            self._offscreen(body={"reason": "hidden"})
        events = list(
            MidtermAttemptEngineAudit.objects.filter(attempt=self.attempt).order_by("id").values_list("event", flat=True)
        )
        last_offence = max(i for i, event in enumerate(events) if event == "offscreen")
        self.assertLess(last_offence, events.index("submit"))
        self.assertTrue(self._evidence()[-1]["terminated"])

    def test_a_replayed_report_logs_nothing_new(self):
        self._offscreen(key="evt-1", body={"reason": "blur"})
        self._offscreen(key="evt-1", body={"reason": "blur"})
        self.assertEqual(len(self._evidence()), 1)

    def test_a_report_after_the_paper_is_in_logs_nothing(self):
        for _ in range(VIOLATION_LIMIT):
            self._offscreen()
        self._offscreen(body={"reason": "hidden"})
        self.assertEqual(len(self._evidence()), VIOLATION_LIMIT)

    def test_a_bodyless_report_is_still_counted_and_logged(self):
        # A runner loaded before this change sends `{}`; its offences count exactly as before.
        resp = self._offscreen()
        self.assertEqual(resp.data["violations"], 1)
        self.assertEqual(
            self._evidence(), [{"reason": "", "continuing": False, "violations": 1, "terminated": False}]
        )

    def test_evidence_is_whitelisted(self):
        self._offscreen(body={"reason": "<script>", "continuing": "yes"})
        self.assertEqual(self._evidence()[0]["reason"], "")
        self.assertIs(self._evidence()[0]["continuing"], False)

    def test_evidence_never_changes_the_consequence(self):
        # The body is the client's word; it can neither buy a chance back nor end the paper.
        resp = self._offscreen(body={"reason": "hidden", "continuing": True, "violations": 99, "terminated": True})
        self.assertEqual(resp.data["violations"], 1)
        self.assertFalse(resp.data["terminated"])
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, MidtermAttempt.STATE_ACTIVE)

    # ── the early-submit lock is relaxed for this case ONLY ──────────────────
    def test_submit_is_still_refused_before_the_deadline_normally(self):
        resp = self.client.post(
            f"/api/midterms/attempts/{self.attempt.pk}/submit_module/", {"answers": {}}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

    def test_submit_is_refused_even_after_one_offence(self):
        # The bypass must require the allowance to be SPENT, not merely touched.
        self._offscreen()
        resp = self.client.post(
            f"/api/midterms/attempts/{self.attempt.pk}/submit_module/", {"answers": {}}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

    def test_client_cannot_assert_forfeiture_to_submit_early(self):
        # A crafted body claiming the rule was broken must not open the lock; only the
        # server-side counter can.
        resp = self.client.post(
            f"/api/midterms/attempts/{self.attempt.pk}/submit_module/",
            {"answers": {}, "offscreen_violations": 3, "terminated_reason": "OFFSCREEN"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.offscreen_violations, 0)
