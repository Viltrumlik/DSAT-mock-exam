"""Full-mock hardening: submit_module timer-bypass guard + stranded-attempt reaper.

    python manage.py test mocks.tests_hardening
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from mocks.models import MockAttempt
from mocks.state_machine import STATE_COMPLETED, STATE_ENGLISH_M1
from mocks.tests_scoring import make_mock
from rest_framework.test import APIClient

User = get_user_model()


def _expire(att, state, minutes_ago):
    anchor = dict(att.phase_started_at or {})
    anchor[state] = (timezone.now() - timezone.timedelta(minutes=minutes_ago)).isoformat()
    att.phase_started_at = anchor
    att.save(update_fields=["phase_started_at"])


class SubmitModuleExpiryGuardTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, (self.e1, self.e2, self.m1, self.m2) = make_mock()

    def _start(self):
        r = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json")
        aid = r.json()["id"]
        self.c.post(f"/api/mocks/attempts/{aid}/start/", {}, format="json")
        return aid

    def test_within_time_submit_records_answers(self):
        aid = self._start()
        ans = {str(q.id): "a" for q in self.e1.questions.all()}
        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": ans}, format="json")
        self.assertEqual(r.json()["current_state"], "MODULE_2_ACTIVE")
        att = MockAttempt.objects.get(pk=aid)
        self.assertEqual(att.module_answers.get(str(self.e1.id)), ans)

    def test_expired_submit_drops_late_answers(self):
        aid = self._start()
        att = MockAttempt.objects.get(pk=aid)
        _expire(att, STATE_ENGLISH_M1, minutes_ago=40)  # E1 limit is 32 min
        late = {str(q.id): "a" for q in self.e1.questions.all()}
        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": late}, format="json")
        # It still advances (module closed) but the late answers are NOT recorded.
        self.assertEqual(r.json()["current_state"], "MODULE_2_ACTIVE")
        att.refresh_from_db()
        self.assertEqual(att.module_answers.get(str(self.e1.id), {}), {})


class SweepReaperTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="r", email="r@x.io")
        self.mock, self.mods = make_mock()

    def _stranded_on_e1(self, minutes_ago=90):
        att = MockAttempt.objects.create(mock=self.mock, student=self.user)
        att.start_attempt()
        _expire(att, STATE_ENGLISH_M1, minutes_ago=minutes_ago)
        return att

    def test_reaper_drains_stranded_attempt_to_completed(self):
        att = self._stranded_on_e1()
        call_command("sweep_mock_attempts", "--grace-minutes", "30")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertTrue(att.is_completed)
        # No answers were submitted → empty score floor.
        self.assertEqual(att.total_score, 400)

    def test_reaper_respects_grace(self):
        # Expired by only ~5 min over the 32-min limit → below a 30-min grace.
        att = self._stranded_on_e1(minutes_ago=37)
        call_command("sweep_mock_attempts", "--grace-minutes", "30")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertFalse(att.is_completed)

    def test_dry_run_changes_nothing(self):
        att = self._stranded_on_e1()
        call_command("sweep_mock_attempts", "--grace-minutes", "30", "--dry-run")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertFalse(att.is_completed)
