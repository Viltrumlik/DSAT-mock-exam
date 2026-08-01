"""Full-mock auto-pause: leaving the exam freezes the clock, returning starts it again.

A mock has no pause BUTTON — the student can never choose to stop the clock. But a dropped
connection, a closed laptop or a killed tab must not burn a 32/35-minute module nobody is
looking at, so the runner's leave handlers pause and its return handler resumes.

    python manage.py test mocks.tests_pause --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from mocks.models import MockAttempt
from mocks.state_machine import (
    STATE_BREAK,
    STATE_COMPLETED,
    STATE_ENGLISH_M1,
    STATE_ENGLISH_M2,
)
from mocks.tests_scoring import make_mock

User = get_user_model()


def _rewind(att, state, minutes):
    """Pretend the given phase started `minutes` ago."""
    anchor = dict(att.phase_started_at or {})
    anchor[state] = (timezone.now() - timezone.timedelta(minutes=minutes)).isoformat()
    att.phase_started_at = anchor
    att.save(update_fields=["phase_started_at"])
    att.refresh_from_db()


def _paused_since(att, minutes):
    MockAttempt.objects.filter(pk=att.pk).update(
        pause_started_at=timezone.now() - timezone.timedelta(minutes=minutes)
    )
    att.refresh_from_db()


def _wait_while_paused(att, state, minutes):
    """Let `minutes` of wall clock pass with the student away.

    Both anchors slide back together: the phase started that much earlier AND the pause
    started that much earlier. Moving only the pause start would put it before the module
    began, which cannot happen and makes the arithmetic meaningless.
    """
    anchor = dict(att.phase_started_at or {})
    started = timezone.datetime.fromisoformat(anchor[state])
    anchor[state] = (started - timezone.timedelta(minutes=minutes)).isoformat()
    att.phase_started_at = anchor
    paused_at = att.pause_started_at or timezone.now()
    MockAttempt.objects.filter(pk=att.pk).update(
        phase_started_at=anchor,
        pause_started_at=paused_at - timezone.timedelta(minutes=minutes),
    )
    att.refresh_from_db()


class PauseClockTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.mock, (self.e1, self.e2, self.m1, self.m2) = make_mock()
        self.att = MockAttempt.objects.create(mock=self.mock, student=self.user)
        self.att.start_attempt()

    def test_a_frozen_clock_does_not_move(self):
        _rewind(self.att, STATE_ENGLISH_M1, minutes=10)
        self.assertTrue(self.att.pause())
        left = self.att.get_timing().remaining_seconds

        # 20 more minutes pass with the student away — enough that a 32-minute module
        # sat for 10 minutes would otherwise be gone.
        _wait_while_paused(self.att, STATE_ENGLISH_M1, minutes=20)

        timing = self.att.get_timing()
        self.assertFalse(timing.is_expired)
        self.assertAlmostEqual(timing.remaining_seconds, left, delta=2)

    def test_resuming_banks_the_time_away_and_restarts_the_clock(self):
        _rewind(self.att, STATE_ENGLISH_M1, minutes=10)
        self.att.pause()
        _wait_while_paused(self.att, STATE_ENGLISH_M1, minutes=20)

        self.assertTrue(self.att.resume_pause())
        self.att.refresh_from_db()
        self.assertIsNone(self.att.pause_started_at)
        # 30 minutes of wall clock, 20 of them away → 10 minutes actually spent.
        self.assertAlmostEqual(self.att.paused_seconds[STATE_ENGLISH_M1], 20 * 60, delta=2)
        self.assertAlmostEqual(self.att.get_timing().elapsed_seconds, 10 * 60, delta=3)

    def test_pause_and_resume_are_both_idempotent(self):
        self.assertTrue(self.att.pause())
        self.assertFalse(self.att.pause())
        self.assertTrue(self.att.resume_pause())
        self.assertFalse(self.att.resume_pause())

    def test_the_break_is_never_pausable(self):
        self.att.submit_module(answers={})
        self.att.submit_module(answers={})
        self.assertEqual(self.att.current_state, STATE_BREAK)
        # A break is time away from the screen by definition; freezing it would let a
        # student stretch 10 minutes into an afternoon.
        self.assertFalse(self.att.pause())
        self.att.refresh_from_db()
        self.assertIsNone(self.att.pause_started_at)

    def test_the_pause_does_not_leak_across_the_module_boundary(self):
        """The pastpaper bug: module 2 opened already frozen and its timer never moved."""
        self.att.pause()
        _wait_while_paused(self.att, STATE_ENGLISH_M1, minutes=5)
        self.att.submit_module(answers={})

        self.att.refresh_from_db()
        self.assertEqual(self.att.current_state, STATE_ENGLISH_M2)
        self.assertIsNone(self.att.pause_started_at)
        # The 5 minutes belong to module 1, and module 2 opens running.
        self.assertAlmostEqual(self.att.paused_seconds[STATE_ENGLISH_M1], 5 * 60, delta=2)
        self.assertEqual(self.att.paused_seconds.get(STATE_ENGLISH_M2, 0), 0)
        self.assertLess(self.att.get_timing().elapsed_seconds, 5)


class PauseApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, (self.e1, self.e2, self.m1, self.m2) = make_mock()
        self.aid = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json").json()["id"]
        self.c.post(f"/api/mocks/attempts/{self.aid}/start/", {}, format="json")

    def test_leaving_and_returning_keeps_the_remaining_time(self):
        att = MockAttempt.objects.get(pk=self.aid)
        _rewind(att, STATE_ENGLISH_M1, minutes=12)

        body = self.c.post(f"/api/mocks/attempts/{self.aid}/pause/", {}, format="json").json()
        self.assertTrue(body["is_paused"])
        left = body["remaining_seconds"]

        _wait_while_paused(MockAttempt.objects.get(pk=self.aid), STATE_ENGLISH_M1, minutes=45)

        back = self.c.post(f"/api/mocks/attempts/{self.aid}/resume_pause/", {}, format="json").json()
        self.assertFalse(back["is_paused"])
        self.assertAlmostEqual(back["remaining_seconds"], left, delta=3)
        self.assertFalse(back["is_expired"])

    def test_a_paused_module_does_not_auto_submit_on_save(self):
        att = MockAttempt.objects.get(pk=self.aid)
        _rewind(att, STATE_ENGLISH_M1, minutes=20)
        self.c.post(f"/api/mocks/attempts/{self.aid}/pause/", {}, format="json")
        _wait_while_paused(MockAttempt.objects.get(pk=self.aid), STATE_ENGLISH_M1, minutes=60)

        qid = str(self.e1.questions.first().id)
        r = self.c.post(f"/api/mocks/attempts/{self.aid}/save_attempt/", {"answers": {qid: "a"}}, format="json")

        # Still on module 1 with the answer saved — the deadline never arrived.
        self.assertEqual(r.json()["current_state"], "MODULE_1_ACTIVE")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertEqual(att.module_answers[str(self.e1.id)], {qid: "a"})

    def test_pause_is_not_offered_on_the_break(self):
        for _ in range(2):
            self.c.post(f"/api/mocks/attempts/{self.aid}/submit_module/", {"answers": {}}, format="json")
        body = self.c.post(f"/api/mocks/attempts/{self.aid}/pause/", {}, format="json").json()
        self.assertTrue(body["is_on_break"])
        self.assertFalse(body["is_paused"])

    def test_another_student_cannot_pause_your_attempt(self):
        other = User.objects.create(username="o", email="o@x.io")
        c = APIClient()
        c.force_authenticate(other)
        self.assertEqual(c.post(f"/api/mocks/attempts/{self.aid}/pause/", {}, format="json").status_code, 404)


class PausedLeashTests(TestCase):
    """A frozen clock never expires, so the reaper needs its own way to let go."""

    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.mock, _mods = make_mock()
        self.att = MockAttempt.objects.create(mock=self.mock, student=self.user)
        self.att.start_attempt()
        self.att.pause()

    def _sweep(self):
        from mocks.reaper import sweep_stranded_mock_attempts

        return sweep_stranded_mock_attempts(grace_minutes=30)

    def test_a_recently_paused_attempt_is_left_alone(self):
        _rewind(self.att, STATE_ENGLISH_M1, minutes=600)  # long past the raw deadline
        _paused_since(self.att, minutes=120)
        self.assertEqual(self._sweep()["reaped"], 0)
        self.att.refresh_from_db()
        self.assertEqual(self.att.current_state, STATE_ENGLISH_M1)

    def test_a_pause_past_the_leash_is_reaped(self):
        _paused_since(self.att, minutes=80 * 60)  # 80 hours, leash is 72
        self.assertEqual(self._sweep()["reaped"], 1)
        self.att.refresh_from_db()
        self.assertEqual(self.att.current_state, STATE_COMPLETED)

    @override_settings(MOCK_PAUSED_ATTEMPT_LEASH_HOURS=0)
    def test_the_leash_can_be_switched_off(self):
        _paused_since(self.att, minutes=1000 * 60)
        self.assertEqual(self._sweep()["reaped"], 0)
