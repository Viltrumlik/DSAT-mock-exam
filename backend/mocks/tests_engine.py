"""Full-mock engine lifecycle tests (4 modules + break, one attempt).

    python manage.py test mocks.tests_engine --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from mocks.models import MockAttempt
from mocks.state_machine import (
    STATE_BREAK, STATE_COMPLETED, STATE_ENGLISH_M1, STATE_ENGLISH_M2,
    STATE_MATH_M1, STATE_MATH_M2, STATE_SCORING,
)
from mocks.tests_scoring import make_mock

User = get_user_model()


def all_correct(module):
    return {str(q.id): "a" for q in module.questions.all()}


class MockEngineTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="s", email="s@x.io")

    def test_full_lifecycle_1600(self):
        mock, (e1, e2, m1, m2) = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student)

        self.assertTrue(att.start_attempt())
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertFalse(att.start_attempt())  # idempotent

        self.assertTrue(att.submit_module(answers=all_correct(e1)))
        self.assertEqual(att.current_state, STATE_ENGLISH_M2)

        self.assertTrue(att.submit_module(answers=all_correct(e2)))
        self.assertEqual(att.current_state, STATE_BREAK)
        self.assertIsNotNone(att.get_break_timing())  # break timer is live

        self.assertTrue(att.end_break())
        self.assertEqual(att.current_state, STATE_MATH_M1)
        self.assertFalse(att.end_break())  # idempotent

        self.assertTrue(att.submit_module(answers=all_correct(m1)))
        self.assertEqual(att.current_state, STATE_MATH_M2)

        self.assertTrue(att.submit_module(answers=all_correct(m2)))
        self.assertEqual(att.current_state, STATE_SCORING)

        self.assertTrue(att.complete())
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertTrue(att.is_completed)
        self.assertEqual(att.english_score, 800)
        self.assertEqual(att.math_score, 800)
        self.assertEqual(att.total_score, 1600)
        self.assertFalse(att.complete())  # idempotent

    def test_break_timing_and_active_module(self):
        mock, (e1, e2, m1, m2) = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student)
        att.start_attempt()
        # active module during ENGLISH_M1 is the English section's module1
        self.assertEqual(mock.active_module(STATE_ENGLISH_M1).id, e1.id)
        self.assertEqual(mock.active_module(STATE_MATH_M2).id, m2.id)
        t = att.get_timing()
        self.assertIsNotNone(t)
        self.assertEqual(t.limit_seconds, 32 * 60)

    def test_autosave_and_partial(self):
        mock, (e1, e2, m1, m2) = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student)
        att.start_attempt()
        qids = [str(q.id) for q in e1.questions.all()]
        self.assertTrue(att.autosave(answers={qids[0]: "a"}))
        self.assertEqual(att.module_answers[str(e1.id)], {qids[0]: "a"})
        # autosave merges, never blanks
        self.assertTrue(att.autosave(answers={qids[1]: "b"}))
        self.assertEqual(att.module_answers[str(e1.id)], {qids[0]: "a", qids[1]: "b"})

    def test_break_auto_end_when_expired(self):
        mock, mods = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=self.student)
        att.start_attempt()
        att.submit_module(answers={})
        att.submit_module(answers={})  # -> BREAK
        self.assertEqual(att.current_state, STATE_BREAK)
        # Simulate the break having started 11 minutes ago -> expired.
        past = (timezone.now() - timezone.timedelta(minutes=11)).isoformat()
        att.phase_started_at[STATE_BREAK] = past
        att.save(update_fields=["phase_started_at"])
        att.refresh_from_db()
        self.assertTrue(att.get_break_timing().is_expired)
