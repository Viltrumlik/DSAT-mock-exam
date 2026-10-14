"""The one-time history import: every paired group's registers, from the course's start, made
lc-up's (owner, 2026-10-14: "u yerda 100% aniqlikdagi davomat bor"; "XP ham lc-up'ga moslashsin").

The dry run is how the owner sees the numbers before anything changes, so it must change nothing.
"""

from __future__ import annotations

from datetime import date, timedelta
from io import StringIO
import json
from unittest import mock

from django.core.management import call_command
from django.db.models import Sum
from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceSession
from lcup.attendance import import_history
from lcup.client import ATTENDANCE_PATH
from lcup.models import LcupGroupLink
from lcup.testing import FakeLcupClient
from lcup.tests_attendance_reconcile import DAY, KASAL, R, ReconcileFixture, midnight, row
from rewards.models import PointAward

EARLIER = DAY - timedelta(days=2)  # the Saturday before


def attendance_xp():
    return PointAward.objects.filter(source_type="attendance_record").aggregate(t=Sum("xp"))["t"] or 0


class HistoryImportTests(ReconcileFixture):
    def setUp(self):
        super().setUp()
        LcupGroupLink.objects.filter(pk=self.link.pk).update(snapshot={"course_start_date": "2026-10-05"})
        self.rows = [row(101), row(102, present=False, reason=KASAL), row(101, late=True, day=EARLIER)]

    def lcup(self, rows=None):
        return FakeLcupClient({ATTENDANCE_PATH: self.rows if rows is None else rows})

    def test_a_dry_run_reports_and_changes_nothing(self):
        report = import_history(self.lcup(), until=DAY, dry_run=True)
        self.assertEqual(AttendanceSession.objects.count(), 0)
        self.assertEqual(attendance_xp(), 0)
        self.assertEqual(report["counts"]["att_marks_added"], 3)
        self.assertEqual(report["counts"]["att_registers_created"], 2)
        self.assertEqual((report["xp_before"], report["xp_after"]), (0, 8))  # PRESENT 5 + LATE 3
        self.assertTrue(report["dry_run"])

    def test_applying_copies_the_history_and_pays_as_usual(self):
        report = import_history(self.lcup(), until=DAY)
        self.assertEqual(self.marks(), {self.s1.pk: (R.STATUS_PRESENT, None), self.s2.pk: (R.STATUS_EXCUSED, 3034)})
        self.assertEqual(attendance_xp(), 8)
        self.assertEqual(report["students_touched"], 2)
        self.assertFalse(report["dry_run"])

    def test_a_day_lcup_never_recorded_is_untouched(self):
        self.mark(self.s2, R.STATUS_PRESENT)
        import_history(self.lcup([row(101, day=EARLIER)]), until=DAY)
        self.assertEqual(self.marks(), {self.s2.pk: (R.STATUS_PRESENT, None)})

    def test_nothing_after_until_is_copied(self):
        import_history(self.lcup(), until=EARLIER)
        self.assertIsNone(self.session())

    def test_a_matching_mark_refused_by_a_late_join_date_is_paid_after(self):
        late = self.learner("late", 105, joined=midnight(DAY + timedelta(days=3)))
        self.mark(late, R.STATUS_PRESENT)
        self.assertEqual(attendance_xp(), 0)  # refused: the seat says they joined after the lesson
        import_history(self.lcup([row(105)]), until=DAY)
        self.assertEqual(timezone.localdate(ClassroomMembership.objects.get(classroom=self.room, user=late).joined_at), DAY)
        self.assertEqual(attendance_xp(), 5)

    def test_lcup_is_read_in_windows_lcup_accepts(self):
        LcupGroupLink.objects.filter(pk=self.link.pk).update(snapshot={"course_start_date": "2026-06-01"})
        lcup = self.lcup([])
        import_history(lcup, until=DAY)
        windows = [(date.fromisoformat(p["from"]), date.fromisoformat(p["to"])) for _, p in lcup.calls]
        self.assertEqual(windows[0][0], date(2026, 6, 1))
        self.assertEqual(windows[-1][1], DAY)
        self.assertTrue(all((hi - lo).days < 92 for lo, hi in windows))
        self.assertTrue(all(p["include_deleted"] == "true" for _, p in lcup.calls))

    def test_the_command_prints_the_report(self):
        out = StringIO()
        with mock.patch("lcup.management.commands.lcup_attendance_history.default_client", return_value=self.lcup()):
            call_command("lcup_attendance_history", "--dry-run", f"--until={DAY.isoformat()}", stdout=out)
        report = json.loads(out.getvalue())
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["counts"]["att_marks_added"], 3)
        self.assertEqual(AttendanceSession.objects.count(), 0)
