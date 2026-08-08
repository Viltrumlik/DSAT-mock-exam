from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from exams.models import PracticeTest, Module, TestAttempt
from exams.tests.support import seed_mc_question


@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
def _rewind_m1_timer(attempt_pk: int) -> None:
    """Timer anchor for module 1 is ``module_1_started_at`` (not only ``current_module_start_time``)."""
    past = timezone.now() - timezone.timedelta(minutes=5)
    TestAttempt.objects.filter(pk=attempt_pk).update(
        module_1_started_at=past,
        current_module_start_time=past,
    )


class AttemptTimerEnforcementTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="student_timer",
            email="student_timer@example.com",
            password="pw12345678",
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)

        self.test = PracticeTest.objects.create(
            subject="MATH",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=1)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=1)
        # Both modules need a question. A pastpaper whose Module 2 is empty is a *one*-module
        # pastpaper by definition (see submit_module_1), so without these the fixture built the
        # opposite of the two-module exam these tests describe and the attempt correctly went
        # straight to SCORING where they expect MODULE_2_ACTIVE.
        self.q1 = seed_mc_question(self.m1, stem="M1 Q1")
        self.q2 = seed_mc_question(self.m2, stem="M2 Q1")

    def _create_attempt_and_start_m1(self) -> TestAttempt:
        att = TestAttempt.objects.create(student=self.user, practice_test=self.test)
        att.start_module(self.m1)
        return TestAttempt.objects.get(pk=att.pk)

    def test_autosave_rejected_when_module_expired(self):
        att = self._create_attempt_and_start_m1()
        _rewind_m1_timer(att.pk)

        r = self.client.post(
            f"/api/exams/attempts/{att.pk}/save_attempt/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
        )
        # Timeout behavior: autosave will auto-submit and return canonical state.
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.get("is_expired"))

    def test_autosave_idempotency_replay(self):
        att = self._create_attempt_and_start_m1()
        headers = {"HTTP_IDEMPOTENCY_KEY": "save-1"}
        r1 = self.client.post(
            f"/api/exams/attempts/{att.pk}/save_attempt/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
            **headers,
        )
        self.assertEqual(r1.status_code, 200)
        r2 = self.client.post(
            f"/api/exams/attempts/{att.pk}/save_attempt/",
            {"answers": {"1": "B"}, "flagged": []},
            format="json",
            **headers,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.data, r2.data)

    def test_a_late_explicit_submit_is_accepted_and_keeps_the_answers(self):
        """This used to assert 409 ``exam_module_deadline_passed``.

        That behaviour was removed on purpose in d554dc27, "CRITICAL: stop wiping student
        answers on submit": refusing a late submit threw away what the student had selected
        and left them on an expired screen that stayed expired on reload. The server now
        records the answers and moves the module on. The deadline is still detected — it is
        what the module advances *because of* — so what is worth pinning is that the work
        survives it.
        """
        att = self._create_attempt_and_start_m1()
        _rewind_m1_timer(att.pk)

        r = self.client.post(
            f"/api/exams/attempts/{att.pk}/submit_module/",
            {"answers": {str(self.q1.id): "A"}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)

        att.refresh_from_db()
        self.assertEqual(
            (att.module_answers or {}).get(str(self.m1.id), {}).get(str(self.q1.id)), "A"
        )

    def test_deadline_via_save_attempt_auto_advances_via_server_timer(self):
        att = self._create_attempt_and_start_m1()
        _rewind_m1_timer(att.pk)

        r = self.client.post(
            f"/api/exams/attempts/{att.pk}/save_attempt/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.get("is_expired"))
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)

