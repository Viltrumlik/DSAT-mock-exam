"""Regression: a stale/retried Module-1 submit must NOT finalize Module 2.

Production bug (systemic, ~24% of 2-module pastpaper attempts): when Module 1's timer
expired, the client's submit was sometimes retried with a new idempotency key. The first
request advanced Module 1 -> Module 2; the retry — still carrying Module 1's answers and
version — landed on the now-active Module 2 and the server (soft version conflict)
finalized Module 2 with Module 1's answers. Module 2 was scored blank; students never took
it. Fix: the submit is now MODULE-TARGETED — the client sends module_id, and the server
no-ops if that module is no longer active.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_question

User = get_user_model()


@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
class SubmitModuleTargetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pp_target", email="pp_target@example.com", password="pw12345678",
            is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.user)
        self.test = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True,
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=35)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=35)
        # Both modules must have questions so submit_module_1 advances to M2 (not skip-to-scoring).
        seed_mc_question(self.m1, stem="M1Q1")
        seed_mc_question(self.m2, stem="M2Q1")

    def _start(self):
        att = TestAttempt.objects.create(student=self.user, practice_test=self.test)
        att.start_module(self.m1)
        return TestAttempt.objects.get(pk=att.pk)

    def _submit(self, att, module_id, answers=None):
        return self.client.post(
            f"/api/exams/attempts/{att.pk}/submit_module/",
            {"answers": answers or {}, "flagged": [], "module_id": module_id},
            format="json",
        )

    def test_stale_module1_submit_does_not_finalize_module2(self):
        att = self._start()
        # First submit (targets M1) advances to Module 2.
        r1 = self._submit(att, self.m1.id)
        self.assertEqual(r1.status_code, 200, r1.content)
        att.refresh_from_db()
        self.assertEqual(att.current_state, TestAttempt.STATE_MODULE_2_ACTIVE)

        # Stale/retried submit STILL targeting Module 1 — must be a no-op, NOT finalize M2.
        r2 = self._submit(att, self.m1.id)
        self.assertEqual(r2.status_code, 200, r2.content)
        att.refresh_from_db()
        self.assertEqual(att.current_state, TestAttempt.STATE_MODULE_2_ACTIVE)  # still on M2, not SCORING
        self.assertFalse(att.is_completed)

    def test_normal_two_module_flow_still_scores(self):
        att = self._start()
        self.assertEqual(self._submit(att, self.m1.id).status_code, 200)
        att.refresh_from_db()
        self.assertEqual(att.current_state, TestAttempt.STATE_MODULE_2_ACTIVE)
        # Proper Module 2 submit (targets M2) → finalizes.
        r = self._submit(att, self.m2.id)
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertIn(att.current_state, (TestAttempt.STATE_SCORING, TestAttempt.STATE_COMPLETED))

    def test_no_module_id_is_backward_compatible(self):
        # Old clients omit module_id → server submits the current module (legacy behavior).
        att = self._start()
        r = self.client.post(
            f"/api/exams/attempts/{att.pk}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertEqual(att.current_state, TestAttempt.STATE_MODULE_2_ACTIVE)
