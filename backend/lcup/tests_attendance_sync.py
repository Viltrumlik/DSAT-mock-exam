"""The sync's attendance stage: every 15 minutes, closed registers of the last few days are made to
agree with lc-up, and — after the cutover — what lc-up lacks is sent, once.

A register still open is the teacher's; nothing touches it. A dry run sends nothing, ever: lc-up's
POST charges money, and a preview that charged money would not be a preview.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.test import override_settings
from django.utils import timezone

from lcup.models import LcupAbsenceReason
from lcup.sync import API, _attendance, _reasons, _Run
from lcup.testing import POST_ATTENDANCE, FakeLcupClient
from lcup.tests_attendance_reconcile import DAY, KASAL, R, ReconcileFixture, row

PULL_ON = {"LCUP_ATTENDANCE_PULL_ENABLED": True}
PUSH_ON = {**PULL_ON, "LCUP_ATTENDANCE_PUSH_ENABLED": True, "LCUP_ATTENDANCE_PUSH_FROM": DAY.isoformat()}


def at(hour, day=DAY):
    return timezone.make_aware(datetime.combine(day, time(hour, 0)))


class AttendanceStageTests(ReconcileFixture):
    def stage(self, rows, *, now=None, dry_run=False, answer=None):
        data = {f"{API}/attendance": rows}
        if answer is not None:
            data[POST_ATTENDANCE] = answer
        client = FakeLcupClient(data)
        run = _Run(now or at(21), dry_run=dry_run)  # the 16:00 lesson's register closed at 20:00
        _attendance(client, run)
        return client, run

    def test_switched_off_lcup_is_not_even_asked(self):
        client, _ = self.stage([row(101)])
        self.assertEqual(client.calls, [])

    @override_settings(**PULL_ON)
    def test_it_reads_the_last_days_including_deletions(self):
        client, _ = self.stage([])
        path, params = client.calls[0]
        self.assertEqual(path, f"{API}/attendance")
        self.assertEqual(params, {"from": (DAY - timedelta(days=3)).isoformat(), "to": DAY.isoformat(), "include_deleted": "true"})

    @override_settings(**PULL_ON)
    def test_an_open_register_is_left_to_the_teacher(self):
        self.mark(self.s1, R.STATUS_ABSENT)
        self.stage([row(101)], now=at(19))
        self.assertEqual(self.marks(), {self.s1.pk: (R.STATUS_ABSENT, None)})

    @override_settings(**PULL_ON)
    def test_a_closed_register_takes_lcups_marks(self):
        _, run = self.stage([row(101), row(102, present=False, reason=KASAL)])
        self.assertEqual(self.marks(), {self.s1.pk: (R.STATUS_PRESENT, None), self.s2.pk: (R.STATUS_EXCUSED, 3034)})
        self.assertEqual(run.counts["att_marks_added"], 2)

    @override_settings(**PUSH_ON)
    def test_after_the_cutover_what_lcup_lacks_is_sent_once(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        client, run = self.stage([row(101)])
        self.assertEqual(client.posts, [(10, DAY, [{"student_id": 102, "status": "absent"}])])
        self.assertEqual(run.counts["att_pushed"], 1)
        client, _ = self.stage([row(101)])  # the next run: already sent
        self.assertEqual(client.posts, [])

    @override_settings(**{**PUSH_ON, "LCUP_ATTENDANCE_PUSH_FROM": "2026-10-13"})
    def test_before_the_cutover_lcup_is_copied_and_nothing_is_sent(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        client, _ = self.stage([row(101)])
        self.assertEqual(client.posts, [])
        self.assertEqual(set(self.marks()), {self.s1.pk})

    @override_settings(**PUSH_ON)
    def test_a_dry_run_never_sends(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        client, run = self.stage([row(101)], dry_run=True)
        self.assertEqual(client.posts, [])
        self.assertEqual(run.counts["att_would_push"], 1)

    @override_settings(**PUSH_ON)
    def test_what_lcup_did_not_take_is_an_alert(self):
        self.mark(self.s2, R.STATUS_ABSENT)

        def answer(group_id, day, records):
            return {"summary": {"failed": 1}, "results": [
                {"student_id": 102, "status": "absent", "result": "failed", "error": {"code": "blocked_debt", "message": "x"}},
            ]}

        _, run = self.stage([row(101)], answer=answer)
        self.assertTrue(any("blocked_debt" in a for a in run.alerts), run.alerts)


class ReasonsStageTests(ReconcileFixture):
    def test_lcups_excuse_reasons_are_kept(self):
        client = FakeLcupClient({f"{API}/attendance/reasons": {"success": True, "data": [KASAL, {"id": 3035, "title": "Uzoqga ketib qolgan", "color": None}]}})
        run = _Run(at(21))
        _reasons(client, run)
        self.assertEqual(
            list(LcupAbsenceReason.objects.values_list("lcup_reason_id", "title")),
            [(3034, "Kasal"), (3035, "Uzoqga ketib qolgan")],
        )
        self.assertEqual(run.counts["absence_reasons"], 2)
