"""A register of a paired class closes 5 minutes before lc-up's window does, and goes at that minute.

lc-up's window ends two hours after the lesson, which was also when ours closed: every push at the
exact minute was taken, every one a minute or more late refused for good (2026-10-31 to 2026-11-05).
Owner, 2026-11-05: "limitdan 5daqiqa oldin jo'nating har ehtimolga qarshi".
"""

from __future__ import annotations

from datetime import datetime, time
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

from classes.attendance_window import STATE_LOCKED, STATE_OPEN, marking_state, marking_window
from classes.models import Classroom
from lcup.attendance import registers_just_closed
from lcup.sync import API, _attendance, _Run
from lcup.tasks import push_closed_registers
from lcup.testing import FakeLcupClient
from lcup.tests_attendance_reconcile import DAY, R, ReconcileFixture, row

PULL_ON = {"LCUP_ENABLED": True, "LCUP_ATTENDANCE_PULL_ENABLED": True}
PUSH_ON = {**PULL_ON, "LCUP_ATTENDANCE_PUSH_ENABLED": True, "LCUP_ATTENDANCE_PUSH_FROM": DAY.isoformat()}


def at(hour, minute=0, second=0):
    return timezone.make_aware(datetime.combine(DAY, time(hour, minute, second)))


class WindowTests(ReconcileFixture):
    def test_with_the_push_off_the_register_keeps_the_schools_two_hours(self):
        self.assertEqual(marking_window(self.room, DAY)[1], at(20))
        with override_settings(**PULL_ON):
            self.assertEqual(marking_window(self.room, DAY)[1], at(20))

    @override_settings(**PUSH_ON)
    def test_a_paired_class_closes_five_minutes_sooner(self):
        self.assertEqual(marking_window(self.room, DAY)[1], at(19, 55))
        self.assertEqual(marking_state(self.room, DAY, now=at(19, 54)), STATE_OPEN)
        self.assertEqual(marking_state(self.room, DAY, now=at(19, 55, 1)), STATE_LOCKED)

    @override_settings(**PUSH_ON)
    def test_a_class_lc_up_does_not_run_keeps_the_two_hours(self):
        other = Classroom.objects.create(
            name="Own class", subject="MATH", lesson_days="ODD", lesson_time="16:00",
            created_by=self.teacher, teacher=self.teacher,
        )
        self.assertEqual(marking_window(other, DAY)[1], at(20))


@override_settings(**PUSH_ON)
class PushMomentTests(ReconcileFixture):
    def stage(self, now):
        client = FakeLcupClient({f"{API}/attendance": [row(101)]})
        run = _Run(now)
        _attendance(client, run)
        return client

    def test_the_mark_goes_as_the_register_closes_inside_lcups_window(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        client = self.stage(at(19, 55, 1))
        self.assertEqual(len(client.posts), 1)
        self.assertEqual(client.posts[0][2], [{"student_id": 102, "status": "absent"}])

    def test_an_open_register_is_not_sent(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        self.assertEqual(self.stage(at(19, 54)).posts, [])


class TickTests(ReconcileFixture):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)

    def tick(self, now, result=None):
        with mock.patch("django.utils.timezone.now", return_value=now), mock.patch(
            "lcup.tasks._exclusive", return_value=result if result is not None else {"added": 0}
        ) as sync:
            return push_closed_registers(), sync

    @override_settings(**PUSH_ON)
    def test_only_a_marked_register_inside_the_last_minutes_is_due(self):
        self.assertEqual(registers_just_closed(at(19, 56)), set())  # nobody marked: nothing to send
        self.mark(self.s1, R.STATUS_PRESENT)
        self.assertEqual(registers_just_closed(at(19, 54)), set())
        self.assertEqual(registers_just_closed(at(19, 55)), {at(19, 55)})
        self.assertEqual(registers_just_closed(at(19, 59)), {at(19, 55)})
        self.assertEqual(registers_just_closed(at(20, 0)), set())  # lc-up's window is over: the quarter hour's job

    @override_settings(**PUSH_ON)
    def test_a_sync_runs_once_for_a_closing_time(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        self.assertEqual(self.tick(at(19, 54))[1].call_count, 0)
        result, sync = self.tick(at(19, 55))
        self.assertEqual(sync.call_count, 1)
        self.assertEqual(sync.call_args.kwargs, {"dry_run": False})
        self.assertEqual(result, {"due": 1})
        self.assertEqual(self.tick(at(19, 56))[1].call_count, 0)

    @override_settings(**PUSH_ON)
    def test_while_another_sync_runs_the_next_minute_tries_again(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        result, _ = self.tick(at(19, 55), result={"skipped": "already running"})
        self.assertEqual(result, {"skipped": "already running"})
        self.assertEqual(self.tick(at(19, 56))[1].call_count, 1)

    def test_it_waits_for_its_switches(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        with override_settings(**PULL_ON):
            result, sync = self.tick(at(19, 55))
        self.assertEqual((result, sync.call_count), ({"skipped": "disabled"}, 0))
