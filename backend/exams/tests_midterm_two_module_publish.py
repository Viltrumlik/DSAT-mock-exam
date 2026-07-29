"""Publishing a midterm authored as two modules but not set to RUN as two is blocked.

That combination is the exact shape of a production incident: the runtime serves every
question in one flat module on module 1's timer, so students get the whole paper in half the
time and module 2's minutes are silently discarded. It is only ever a mis-set switch —
"two timed modules meaning one long section" is what "1 module" is for.
"""

from django.test import TestCase

from exams.models import MockExam, Module, PracticeTest, Question
from exams.publish_service import mock_exam_publish_ready
from exams.sat_rules import mock_exam_publish_violations


def _midterm(*, module_count=2, runtime=True, forms=1, n_per_module=3):
    exam = MockExam.objects.create(
        title="Publish Guard MT", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
        midterm_scoring_scale="SCALE_100", midterm_module_count=module_count,
        midterm_module1_minutes=40, midterm_module2_minutes=40,
        midterm_module_question_limit=30, midterm_two_module_runtime=runtime,
    )
    for _ in range(forms):
        pt = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        for order in range(1, max(1, module_count) + 1):
            mod = Module.objects.create(practice_test=pt, module_order=order, time_limit_minutes=40)
            for i in range(n_per_module):
                Question.objects.create(
                    module=mod, question_type="MATH", question_text=f"M{order}Q{i}",
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers="a", score=10, order=i,
                )
    return exam


class TwoModuleRuntimePublishGuardTests(TestCase):
    def test_two_modules_without_the_runtime_flag_cannot_publish(self):
        exam = _midterm(module_count=2, runtime=False)
        ok, msg = mock_exam_publish_ready(exam)
        self.assertFalse(ok)
        codes = [v.code for v in mock_exam_publish_violations(exam)]
        self.assertIn("MIDTERM_TWO_MODULE_RUNTIME_OFF", codes)
        self.assertIn("module 1", msg)  # the message explains the actual consequence

    def test_two_modules_with_the_runtime_flag_publishes(self):
        ok, msg = mock_exam_publish_ready(_midterm(module_count=2, runtime=True))
        self.assertTrue(ok, msg)

    def test_a_single_module_midterm_is_unaffected(self):
        """The guard must not touch the production majority."""
        ok, msg = mock_exam_publish_ready(_midterm(module_count=1, runtime=False, n_per_module=4))
        self.assertTrue(ok, msg)

    def test_the_guard_applies_to_a_versioned_midterm_too(self):
        exam = _midterm(module_count=2, runtime=False, forms=3)
        codes = [v.code for v in mock_exam_publish_violations(exam)]
        self.assertIn("MIDTERM_TWO_MODULE_RUNTIME_OFF", codes)

    def test_a_full_mock_is_unaffected(self):
        """MOCK_SAT has its own strict rules and no midterm runtime flag."""
        mock = MockExam.objects.create(title="Full mock", kind=MockExam.KIND_MOCK_SAT)
        codes = [v.code for v in mock_exam_publish_violations(mock)]
        self.assertNotIn("MIDTERM_TWO_MODULE_RUNTIME_OFF", codes)
