"""
Regression: the Windows app reopening a past paper during Module 2 restarted the paper.

The released Windows app (0.1.0) calls ``POST /api/exams/attempts/`` every time a paper is
opened — it has no separate resume step. For a past paper, that create path abandoned any
open MODULE_2_ACTIVE attempt (the website's "stale tab" rule) and, because the active-attempt
unique constraint ignores ABANDONED rows, then made a fresh NOT_STARTED one. A student who
closed the app in Module 2 came back to Module 1 with nothing answered.

Fix: a native client (``X-MasterSAT-Client`` and no auth cookie —
``users.auth_cookies.is_native_client``) skips that abandonment, so the get-or-create resumes
the open attempt. The website — every request carries its auth cookies — keeps today's rule
exactly, and mock exams resumed for everyone before and still do.

Every request here goes through the real middleware the way each client sends it: the app
with ``Authorization: Bearer``, its header and a foreign Origin; the website with its
``lms_access`` cookie and its own Origin.
"""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from exams.models import MockExam, Module, PortalMockExam, PracticeTest, Question, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test
from users.auth_cookies import ACCESS_COOKIE

User = get_user_model()

ATTEMPTS = "/api/exams/attempts/"


class _ReopenFixture(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username="reopen_m2", email="reopen_m2@example.com", password="pw12345678",
        )
        self.access = str(RefreshToken.for_user(self.student).access_token)

    # ── the two clients ─────────────────────────────────────────────────────────

    def app(self) -> APIClient:
        """The Windows app: Bearer only, its header, a foreign origin, NO cookie jar entry.
        CSRF checks are enforced, as in production — the native exemption must carry it."""
        client = APIClient(enforce_csrf_checks=True)
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {self.access}",
            HTTP_X_MASTERSAT_CLIENT="desktop",
            HTTP_ORIGIN="http://tauri.localhost",
        )
        return client

    def website(self, *, with_native_header: bool = False) -> APIClient:
        """The website: signed in by the HttpOnly ``lms_access`` cookie, same-origin."""
        client = APIClient()
        client.cookies[ACCESS_COOKIE] = self.access
        scheme = "http" if settings.DEBUG else "https"
        extra = {"HTTP_ORIGIN": f"{scheme}://testserver"}
        if with_native_header:
            extra["HTTP_X_MASTERSAT_CLIENT"] = "desktop"
        client.credentials(**extra)
        return client

    # ── the paper ───────────────────────────────────────────────────────────────

    def _paper(self, *, mock_exam=None) -> PracticeTest:
        test = PracticeTest.objects.create(
            mock_exam=mock_exam, subject="MATH", form_type="INTERNATIONAL",
            title="SAT March 2024", skip_default_modules=True,
        )
        Module.objects.create(practice_test=test, module_order=1, time_limit_minutes=32)
        Module.objects.create(practice_test=test, module_order=2, time_limit_minutes=32)
        seed_mc_questions_for_practice_test(test, questions_per_module=2)
        return test

    def _module(self, test, order) -> Module:
        return Module.objects.get(practice_test=test, module_order=order)

    def _qids(self, test, order) -> list[str]:
        return [
            str(q) for q in Question.objects.filter(module=self._module(test, order))
            .order_by("order", "id").values_list("id", flat=True)
        ]

    def _create(self, client, test):
        r = client.post(ATTEMPTS, {"practice_test": test.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.data

    def _into_module_2(self, client, test) -> tuple[int, dict, dict]:
        """Open → Start → answer + submit Module 1 → answer some of Module 2 (autosave).
        Returns the attempt id and the answers saved for each module."""
        data = self._create(client, test)
        attempt_id = data["id"]
        if data["current_state"] == TestAttempt.STATE_NOT_STARTED:
            r = client.post(f"{ATTEMPTS}{attempt_id}/start/", {}, format="json")
            self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            TestAttempt.objects.get(pk=attempt_id).current_state, TestAttempt.STATE_MODULE_1_ACTIVE
        )

        m1_answers = {qid: "a" for qid in self._qids(test, 1)}
        r = client.post(
            f"{ATTEMPTS}{attempt_id}/submit_module/",
            {"answers": m1_answers, "flagged": [], "module_id": self._module(test, 1).id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["current_state"], TestAttempt.STATE_MODULE_2_ACTIVE)

        m2_answers = {self._qids(test, 2)[0]: "b"}
        r = client.post(
            f"{ATTEMPTS}{attempt_id}/save_attempt/",
            {"answers": m2_answers, "flagged": [int(self._qids(test, 2)[0])]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        return attempt_id, m1_answers, m2_answers

    def _attempts(self, test):
        return TestAttempt.objects.filter(student=self.student, practice_test=test).order_by("id")


class AppReopeningModule2ResumesTests(_ReopenFixture):
    def setUp(self):
        super().setUp()
        self.test = self._paper()
        self.test.assigned_users.add(self.student)

    def test_reopening_in_module_2_resumes_the_same_attempt_with_its_answers(self):
        app = self.app()
        attempt_id, m1_answers, m2_answers = self._into_module_2(app, self.test)
        before = TestAttempt.objects.get(pk=attempt_id)

        reopened = self._create(app, self.test)  # the app opens the paper again

        self.assertEqual(reopened["id"], attempt_id)
        self.assertEqual(reopened["current_state"], TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(reopened["current_module"], self._module(self.test, 2).id)
        after = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(after.current_state, TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(after.current_module_id, self._module(self.test, 2).id)
        m1_id = str(self._module(self.test, 1).id)
        m2_id = str(self._module(self.test, 2).id)
        self.assertEqual(after.module_answers.get(m1_id), m1_answers)
        self.assertEqual(after.module_answers.get(m2_id), m2_answers)
        self.assertEqual(after.flagged_questions.get(m2_id), [int(next(iter(m2_answers)))])
        # Module 2's clock keeps its original start: a reopen is not a restart.
        self.assertEqual(after.module_2_started_at, before.module_2_started_at)
        # No second sitting and nothing abandoned.
        self.assertEqual(list(self._attempts(self.test).values_list("id", flat=True)), [attempt_id])
        self.assertFalse(
            self._attempts(self.test).filter(current_state=TestAttempt.STATE_ABANDONED).exists()
        )

    def test_the_status_read_after_the_reopen_is_still_module_2(self):
        # The app's open sequence is create → status; status must show the live Module 2.
        app = self.app()
        attempt_id, _, m2_answers = self._into_module_2(app, self.test)
        self._create(app, self.test)

        r = app.get(f"{ATTEMPTS}{attempt_id}/status/")

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["current_state"], TestAttempt.STATE_MODULE_2_ACTIVE)

    def test_reopening_twice_still_resumes(self):
        app = self.app()
        attempt_id, _, _ = self._into_module_2(app, self.test)

        first = self._create(app, self.test)
        second = self._create(app, self.test)

        self.assertEqual((first["id"], second["id"]), (attempt_id, attempt_id))
        self.assertEqual(second["current_state"], TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(self._attempts(self.test).count(), 1)

    def test_module_2_can_still_be_submitted_after_the_reopen(self):
        app = self.app()
        attempt_id, _, m2_answers = self._into_module_2(app, self.test)
        self._create(app, self.test)

        r = app.post(
            f"{ATTEMPTS}{attempt_id}/submit_module/",
            {"answers": m2_answers, "flagged": [], "module_id": self._module(self.test, 2).id},
            format="json",
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn(
            r.data["current_state"], (TestAttempt.STATE_SCORING, TestAttempt.STATE_COMPLETED)
        )

    def test_reopening_in_module_1_resumes_as_before(self):
        app = self.app()
        data = self._create(app, self.test)
        app.post(f"{ATTEMPTS}{data['id']}/start/", {}, format="json")

        reopened = self._create(app, self.test)

        self.assertEqual(reopened["id"], data["id"])
        self.assertEqual(reopened["current_state"], TestAttempt.STATE_MODULE_1_ACTIVE)


class WebsiteKeepsTheStaleModule2RuleTests(_ReopenFixture):
    """The website's behaviour must not move at all: re-entering a past paper whose open
    attempt is on Module 2 abandons it and offers a fresh, held attempt."""

    def setUp(self):
        super().setUp()
        self.test = self._paper()
        self.test.assigned_users.add(self.student)

    def _assert_abandoned_and_fresh(self, old_id, reopened, m1_answers):
        self.assertNotEqual(reopened["id"], old_id)
        self.assertEqual(reopened["current_state"], TestAttempt.STATE_NOT_STARTED)
        old = TestAttempt.objects.get(pk=old_id)
        self.assertEqual(old.current_state, TestAttempt.STATE_ABANDONED)
        self.assertEqual(old.abandoned_checkpoint_state, TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertIsNone(old.current_module_id)
        # The abandoned sitting keeps what was answered; it is just no longer the open one.
        self.assertEqual(old.module_answers.get(str(self._module(self.test, 1).id)), m1_answers)
        self.assertEqual(self._attempts(self.test).count(), 2)

    def test_a_browser_reentering_module_2_still_starts_fresh(self):
        site = self.website()
        old_id, m1_answers, _ = self._into_module_2(site, self.test)

        reopened = self._create(site, self.test)

        self._assert_abandoned_and_fresh(old_id, reopened, m1_answers)

    def test_a_cookie_bearing_request_is_a_browser_whatever_header_it_sends(self):
        # The exemption is is_native_client's, and an auth cookie always means a browser.
        site = self.website(with_native_header=True)
        old_id, m1_answers, _ = self._into_module_2(site, self.test)

        reopened = self._create(site, self.test)

        self._assert_abandoned_and_fresh(old_id, reopened, m1_answers)


class MockExamsResumeForEveryoneTests(_ReopenFixture):
    """Mock exam sections always resumed in Module 2; neither client changes that."""

    def setUp(self):
        super().setUp()
        self.mock = MockExam.objects.create(
            title="Mock 1", kind=MockExam.KIND_MOCK_SAT, is_active=True, is_published=True,
        )
        portal = PortalMockExam.objects.create(mock_exam=self.mock, is_active=True)
        portal.assigned_users.add(self.student)
        self.test = self._paper(mock_exam=self.mock)

    def _assert_resumes(self, client):
        attempt_id, _, m2_answers = self._into_module_2(client, self.test)

        reopened = self._create(client, self.test)

        self.assertEqual(reopened["id"], attempt_id)
        self.assertEqual(reopened["current_state"], TestAttempt.STATE_MODULE_2_ACTIVE)
        after = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(after.module_answers.get(str(self._module(self.test, 2).id)), m2_answers)
        self.assertEqual(self._attempts(self.test).count(), 1)

    def test_the_website_resumes_a_mock_in_module_2(self):
        self._assert_resumes(self.website())

    def test_the_app_resumes_a_mock_in_module_2(self):
        self._assert_resumes(self.app())
