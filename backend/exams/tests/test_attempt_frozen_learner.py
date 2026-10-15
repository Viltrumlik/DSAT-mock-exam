"""A frozen learner signs in, but cannot use exam attempts.

``TestAttemptViewSet`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated`` there, and neither
``RequiresSubmitTest`` nor ``authorize()`` looks at ``is_frozen`` — so a debt-frozen centre student
could still list, start, autosave and submit. These pin the freeze check on every route.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

ATTEMPTS = "/api/exams/attempts/"

#: Every detail route on the viewset (method, url_path) — none may answer a frozen learner.
DETAIL_ROUTES = (
    ("get", ""),
    ("get", "status/"),
    ("get", "review/"),
    ("get", "results/"),
    ("post", "resume/"),
    ("post", "start/"),
    ("post", "start_module/"),
    ("post", "save_attempt/"),
    ("post", "submit_module/"),
    ("post", "pause/"),
    ("post", "resume_pause/"),
)


@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
class FrozenLearnerAttemptTests(APITestCase):
    def setUp(self):
        self.student = get_user_model().objects.create_user(
            username="frozen_attempt_student",
            email="frozen_attempt_student@example.com",
            password="pw12345678",
            role="student",
        )
        self.client.force_authenticate(self.student)

        self.test = PracticeTest.objects.create(
            subject="READING_WRITING",
            title="Freeze RW",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=30)
        Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=30)
        seed_mc_questions_for_practice_test(self.test)
        self.test.assigned_users.add(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        get_user_model().objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.client.force_authenticate(self.student)

    def _create(self) -> int:
        r = self.client.post(ATTEMPTS, {"practice_test": self.test.id}, format="json")
        self.assertIn(r.status_code, (200, 201), r.content)
        return int(r.data["id"])

    def _start(self, attempt_id: int) -> None:
        r = self.client.post(f"{ATTEMPTS}{attempt_id}/start/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        # The freeze gate refused — not RequiresSubmitTest further down the list.
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_create_an_attempt(self):
        self._set_frozen(True)

        r = self.client.post(ATTEMPTS, {"practice_test": self.test.id}, format="json")

        self.assertFrozenRefusal(r)
        self.assertFalse(TestAttempt.objects.filter(student=self.student).exists())

    def test_a_frozen_student_cannot_list_their_attempts(self):
        self._create()
        self._set_frozen(True)

        self.assertFrozenRefusal(self.client.get(ATTEMPTS))

    def test_a_frozen_student_cannot_start_an_attempt_made_before_the_freeze(self):
        attempt_id = self._create()
        self._set_frozen(True)

        r = self.client.post(f"{ATTEMPTS}{attempt_id}/start/", {}, format="json")

        self.assertFrozenRefusal(r)
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.current_state, TestAttempt.STATE_NOT_STARTED)

    def test_a_frozen_student_cannot_save_or_submit_a_running_module(self):
        attempt_id = self._create()
        self._start(attempt_id)
        self._set_frozen(True)
        body = {"answers": {"1": "A"}, "flagged": []}

        self.assertFrozenRefusal(self.client.post(f"{ATTEMPTS}{attempt_id}/save_attempt/", body, format="json"))
        self.assertFrozenRefusal(self.client.post(f"{ATTEMPTS}{attempt_id}/submit_module/", body, format="json"))

        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.current_state, TestAttempt.STATE_MODULE_1_ACTIVE)
        self.assertFalse(attempt.is_completed)
        self.assertFalse(attempt.module_answers)

    def test_every_attempt_route_refuses_a_frozen_student(self):
        attempt_id = self._create()
        self._start(attempt_id)
        self._set_frozen(True)

        for method, path in DETAIL_ROUTES:
            with self.subTest(route=f"{method.upper()} {path or '<detail>'}"):
                r = getattr(self.client, method)(f"{ATTEMPTS}{attempt_id}/{path}", {}, format="json")
                self.assertFrozenRefusal(r)

    def test_an_unfrozen_student_is_unaffected(self):
        attempt_id = self._create()
        self._start(attempt_id)

        r = self.client.post(
            f"{ATTEMPTS}{attempt_id}/save_attempt/", {"answers": {"1": "A"}, "flagged": []}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(
            f"{ATTEMPTS}{attempt_id}/submit_module/", {"answers": {"1": "A"}, "flagged": []}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)

        r = self.client.get(ATTEMPTS)
        self.assertEqual(r.status_code, 200, r.content)
        rows = r.data["results"] if isinstance(r.data, dict) and "results" in r.data else r.data
        self.assertIn(attempt_id, [row["id"] for row in rows])

    def test_lifting_the_freeze_restores_the_attempt(self):
        attempt_id = self._create()
        self._start(attempt_id)
        self._set_frozen(True)
        self.assertFrozenRefusal(self.client.get(f"{ATTEMPTS}{attempt_id}/status/"))

        self._set_frozen(False)

        r = self.client.get(f"{ATTEMPTS}{attempt_id}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)
