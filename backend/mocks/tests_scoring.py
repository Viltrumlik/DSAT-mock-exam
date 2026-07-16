"""Full-mock scorer tests (per-section SAT 200-800 -> combined 1600).

    python manage.py test mocks.tests_scoring --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import Module, Question
from mocks.models import Mock, MockAttempt, MockSection

User = get_user_model()


def _module(order, n=4, correct="a", qtype="READING"):
    module = Module.objects.create(practice_test=None, module_order=order, time_limit_minutes=32)
    for i in range(n):
        Question.objects.create(
            module=module, question_type=qtype, question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers=correct, is_math_input=False, score=10, order=i,
        )
    return module


def make_mock():
    mock = Mock.objects.create(title="Full Mock", is_published=True)
    e1, e2 = _module(1, qtype="READING"), _module(2, qtype="READING")
    m1, m2 = _module(1, qtype="MATH"), _module(2, qtype="MATH")
    MockSection.objects.create(mock=mock, subject="READING_WRITING", module1=e1, module2=e2)
    MockSection.objects.create(mock=mock, subject="MATH", module1=m1, module2=m2)
    return mock, [e1, e2, m1, m2]


def answers_all(modules, letter="a"):
    return {str(m.id): {str(q.id): letter for q in m.questions.all()} for m in modules}


class MockScoringTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="s", email="s@x.io")

    def test_perfect_is_1600(self):
        mock, mods = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student, module_answers=answers_all(mods, "a"))
        res = att.grade()
        # Perfect section = 200 + cap(m1) + cap(m2): R&W 200+330+270=800; Math 200+380+220=800.
        self.assertEqual(res["english_score"], 800)
        self.assertEqual(res["math_score"], 800)
        self.assertEqual(res["total_score"], 1600)

    def test_empty_is_base_400(self):
        mock, _mods = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student, module_answers={})
        res = att.grade()
        self.assertEqual(res["english_score"], 200)  # base only
        self.assertEqual(res["math_score"], 200)
        self.assertEqual(res["total_score"], 400)

    def test_half_english_module1(self):
        mock, mods = make_mock()
        e1 = mods[0]
        qids = [str(q.id) for q in e1.questions.all()]
        # 2 of 4 correct in English module 1 only; everything else blank.
        ma = {str(e1.id): {qids[0]: "a", qids[1]: "a", qids[2]: "b", qids[3]: "b"}}
        att = MockAttempt.objects.create(mock=mock, student=self.student, module_answers=ma)
        res = att.grade()
        # English m1 cap 330, half correct -> round(0.5*330)=165; m2 empty -> 0 => 200+165=365 raw.
        # A section score only exists in 10-point steps, so it snaps to the grid: 365 sits exactly
        # between 360 and 370 and round() is banker's (36.5 -> 36), giving 360.
        self.assertEqual(res["english_score"], 360)
        self.assertEqual(res["math_score"], 200)
        self.assertEqual(res["total_score"], 560)

    def test_uniq_active_blocks_second(self):
        from django.db import IntegrityError

        mock, _ = make_mock()
        MockAttempt.objects.create(mock=mock, student=self.student)
        with self.assertRaises(IntegrityError):
            MockAttempt.objects.create(mock=mock, student=self.student)
