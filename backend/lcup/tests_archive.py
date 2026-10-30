"""lcup.archive: a read-only copy of everything lc-up's API serves, with history."""

from datetime import date, timedelta

from django.db.models import Count
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from lcup import archive as A
from lcup.client import LcupError, LcupUnavailable
from lcup.models import ArchiveEntity as E
from lcup.models import LcupArchiveMark, LcupArchiveRecord, LcupArchiveRun, LcupArchiveVersion
from lcup.testing import FakeLcupClient
from users.models import User

API = A.API
TODAY = date(2026, 10, 30)
SINCE = date(2026, 1, 1)


def windowed(rows):
    """A fake /attendance or /payments: only the rows inside the asked window."""
    def answer(params):
        start, end = date.fromisoformat(params["from"]), date.fromisoformat(params["to"])
        return [r for r in rows if start <= date.fromisoformat(r["date"]) <= end]
    return answer


def lc_up(**over):
    data = {
        f"{API}/filials": [{"id": 581, "name": "Master SAT"}],
        f"{API}/courses": [{"id": 4443, "name": "Junior Math"}],
        f"{API}/payment-methods": [{"id": 1, "name": "Naqd pul"}],
        f"{API}/attendance/reasons": [{"id": 3034, "title": "Kasal"}],
        f"{API}/teachers": [{"id": 7, "name": "Tess Teacher"}],
        f"{API}/groups": [{"id": 10, "name": "Junior G1", "cost": 500000, "deleted_at": None}],
        f"{API}/students": [{"id": 1, "name": "Ali Valiyev", "balance": 0}, {"id": 2, "name": "Vali Aliyev", "balance": -500000}],
        f"{API}/groups/10/students": [{"student_id": 1, "status": "active"}, {"student_id": 2, "status": "trial"}],
        f"{API}/attendance": windowed([
            {"id": 100, "date": "2026-10-29", "group_id": 10, "student_id": 1, "present": True},
            {"id": 101, "date": "2026-02-02", "group_id": 10, "student_id": 2, "present": False},
        ]),
        f"{API}/payments": windowed([{"id": 900, "date": "2026-10-01", "student_id": 1, "amount": 500000}]),
    }
    data.update(over)
    return FakeLcupClient(data)


def run(client, today=TODAY):
    archiver = A.Archiver(client, today=today)
    archiver.run()
    return archiver


def rec(entity, lcup_id):
    return LcupArchiveRecord.objects.get(entity=entity, lcup_id=str(lcup_id))


@override_settings(LCUP_ARCHIVE_SINCE=SINCE.isoformat())
class ArchiveTests(TestCase):
    def test_first_run_stores_every_kind_with_one_version_each(self):
        archiver = run(lc_up())
        held = dict(LcupArchiveRecord.objects.values_list("entity").annotate(n=Count("id")).order_by())
        self.assertEqual(held, {
            E.FILIAL: 1, E.COURSE: 1, E.PAYMENT_METHOD: 1, E.ABSENCE_REASON: 1, E.TEACHER: 1, E.GROUP: 1,
            E.STUDENT: 2, E.GROUP_MEMBER: 2, E.ATTENDANCE: 2, E.PAYMENT: 1,
        })
        self.assertEqual(LcupArchiveVersion.objects.count(), LcupArchiveRecord.objects.count())
        self.assertEqual(rec(E.GROUP_MEMBER, "10:2").payload["status"], "trial")
        self.assertEqual(rec(E.ATTENDANCE, 101).day, date(2026, 2, 2))
        self.assertEqual(archiver.counts[E.STUDENT]["new"], 2)
        self.assertEqual(archiver.errors, [])

    def test_only_reads(self):
        client = lc_up()
        run(client)
        self.assertEqual(client.posts, [])

    def test_unchanged_rerun_adds_no_version(self):
        run(lc_up())
        archiver = run(lc_up())
        self.assertEqual(LcupArchiveVersion.objects.count(), LcupArchiveRecord.objects.count())
        self.assertEqual(archiver.counts[E.STUDENT], {"seen": 2, "new": 0, "changed": 0, "gone": 0, "back": 0, "unlisted": 0})

    def test_a_changed_payload_is_a_new_version_never_an_overwrite(self):
        run(lc_up())
        run(lc_up(**{f"{API}/students": [{"id": 1, "name": "Ali Valiyev", "balance": -500000}, {"id": 2, "name": "Vali Aliyev", "balance": -500000}]}))
        ali = rec(E.STUDENT, 1)
        self.assertEqual(ali.versions_count, 2)
        self.assertEqual(ali.payload["balance"], -500000)
        self.assertEqual([v.payload["balance"] for v in ali.versions.all()], [0, -500000])

    def test_missing_from_a_complete_list_is_gone_and_comes_back(self):
        run(lc_up())
        run(lc_up(**{f"{API}/teachers": [{"id": 8, "name": "New"}]}))
        self.assertIsNotNone(rec(E.TEACHER, 7).gone_at)
        archiver = run(lc_up())
        self.assertIsNone(rec(E.TEACHER, 7).gone_at)
        self.assertEqual(archiver.counts[E.TEACHER]["back"], 1)

    def test_an_empty_answer_marks_nothing_gone(self):
        run(lc_up())
        archiver = run(lc_up(**{f"{API}/students": []}))
        self.assertFalse(LcupArchiveRecord.objects.filter(entity=E.STUDENT, gone_at__isnull=False).exists())
        self.assertTrue(any("returned nothing" in a for a in archiver.alerts))

    def test_a_failed_list_is_an_error_and_the_rest_still_run(self):
        run(lc_up())
        archiver = run(lc_up(**{f"{API}/groups": LcupUnavailable("lc-up answered 503")}))
        self.assertTrue(any(e.startswith("group:") for e in archiver.errors))
        self.assertIsNone(rec(E.GROUP, 10).gone_at)
        self.assertEqual(archiver.counts[E.PAYMENT]["seen"], 1)

    def test_a_failed_run_is_recorded_not_ok(self):
        row = A.run_archive(lc_up(**{f"{API}/teachers": LcupError("lc-up answered 500")}))
        self.assertFalse(row.ok)
        self.assertTrue(row.errors)

    def test_a_deleted_group_lc_up_no_longer_serves_keeps_its_members(self):
        run(lc_up())
        archiver = run(lc_up(**{
            f"{API}/groups": [{"id": 10, "name": "Junior G1", "deleted_at": "2026-10-20 10:00:00"}],
            f"{API}/groups/10/students": LcupError("lc-up answered 404 on /groups/10/students"),
        }))
        self.assertEqual(archiver.errors, [])
        self.assertEqual(archiver.counts[E.GROUP_MEMBER]["deleted_group_unavailable"], 1)
        self.assertFalse(LcupArchiveRecord.objects.filter(entity=E.GROUP_MEMBER, gone_at__isnull=False).exists())

    def test_a_member_who_left_one_group_is_gone_from_that_group_only(self):
        groups = [{"id": 10, "name": "G1"}, {"id": 11, "name": "G2"}]
        both = [{"student_id": 1, "status": "active"}, {"student_id": 2, "status": "active"}]
        run(lc_up(**{f"{API}/groups": groups, f"{API}/groups/11/students": both}))
        run(lc_up(**{f"{API}/groups": groups, f"{API}/groups/11/students": both[:1],
                     f"{API}/groups/10/students": both}))
        self.assertIsNotNone(rec(E.GROUP_MEMBER, "11:2").gone_at)
        self.assertIsNone(rec(E.GROUP_MEMBER, "10:2").gone_at)

    def test_windows_are_stable_and_at_most_ninety_days(self):
        spans = A.windows(SINCE, TODAY)
        self.assertEqual(spans[0][0], SINCE)
        self.assertEqual(spans[-1][1], TODAY)
        self.assertTrue(all((end - start).days < A.WINDOW_DAYS for start, end in spans))
        self.assertTrue(all(b[0] == a[1] + timedelta(days=1) for a, b in zip(spans, spans[1:])))
        self.assertEqual(A.windows(SINCE, TODAY)[:2], A.windows(SINCE, TODAY + timedelta(days=5))[:2])

    def test_old_windows_are_read_once_and_the_nightly_span_every_night(self):
        client = lc_up()
        run(client)
        first = [p for path, p in client.calls if path == f"{API}/attendance"]
        self.assertEqual(first[0]["from"], SINCE.isoformat())
        self.assertEqual(first[-1]["to"], TODAY.isoformat())
        done = LcupArchiveMark.objects.filter(key__startswith="window:attendance:").count()
        self.assertEqual(done, sum(A._complete(s, TODAY) for s, _ in A.backfill_windows(SINCE, TODAY)))

        client = lc_up()
        run(client)
        again = [p for path, p in client.calls if path == f"{API}/attendance"]
        self.assertLess(len(again), len(first))
        self.assertEqual(again[-1], {"include_deleted": "true", "from": A._nightly_start(TODAY).isoformat(), "to": TODAY.isoformat()})

    def test_gone_inside_a_window_only(self):
        run(lc_up())
        rows = [{"id": 101, "date": "2026-02-02", "group_id": 10, "student_id": 2, "present": False}]
        run(lc_up(**{f"{API}/attendance": windowed(rows + [{"id": 102, "date": "2026-10-28", "student_id": 1}])}))
        # 100 (Oct 29) is inside the nightly span and no longer served; 101's window is done and not re-read.
        self.assertIsNotNone(rec(E.ATTENDANCE, 100).gone_at)
        self.assertIsNone(rec(E.ATTENDANCE, 101).gone_at)

    def test_an_old_window_answered_empty_over_held_records_stays_due(self):
        start = SINCE
        archiver = A.Archiver(lc_up(), today=TODAY)
        archiver.pull_window(E.ATTENDANCE, f"{API}/attendance", None, start, start + timedelta(days=A.WINDOW_DAYS - 1))
        archiver = A.Archiver(lc_up(**{f"{API}/attendance": windowed([])}), today=TODAY)
        archiver.pull_windows()
        self.assertTrue(any("returned nothing" in a for a in archiver.alerts))
        self.assertFalse(LcupArchiveMark.objects.filter(key=A._window_key(E.ATTENDANCE, start)).exists())
        self.assertIsNone(rec(E.ATTENDANCE, 101).gone_at)

        client = lc_up()
        A.Archiver(client, today=TODAY).pull_windows()
        asked = [p["from"] for path, p in client.calls if path == f"{API}/attendance"]
        self.assertIn(start.isoformat(), asked)
        self.assertTrue(LcupArchiveMark.objects.filter(key=A._window_key(E.ATTENDANCE, start)).exists())

    def test_an_unlisted_student_is_fetched_by_id_and_not_marked_gone(self):
        client = lc_up(**{
            f"{API}/payments": windowed([{"id": 901, "date": "2026-10-02", "student_id": 55, "amount": 1}]),
            f"{API}/students/55": {"data": {"id": 55, "name": "Left Long Ago", "balance": -10}},
        })
        run(client)
        self.assertEqual(rec(E.STUDENT, 55).payload["name"], "Left Long Ago")
        run(client)
        self.assertIsNone(rec(E.STUDENT, 55).gone_at)
        self.assertEqual(rec(E.STUDENT, 55).versions_count, 1)

    def test_an_unlisted_student_back_on_the_list_is_kept_by_the_list(self):
        payments = windowed([{"id": 901, "date": "2026-10-02", "student_id": 55, "amount": 1}])
        run(lc_up(**{f"{API}/payments": payments, f"{API}/students/55": {"data": {"id": 55, "name": "X", "groups": []}}}))
        listed = [{"id": 1, "name": "Ali Valiyev", "balance": 0}, {"id": 55, "name": "X", "balance": 0}]
        client = lc_up(**{f"{API}/payments": payments, f"{API}/students": listed})
        run(client)
        self.assertFalse(LcupArchiveMark.objects.filter(key="unlisted:student:55").exists())
        run(client)
        self.assertNotIn(f"{API}/students/55", [path for path, _ in client.calls])
        self.assertEqual(rec(E.STUDENT, 55).versions_count, 2)

    def test_a_student_lc_up_has_no_record_of_is_not_asked_again(self):
        payments = windowed([{"id": 901, "date": "2026-10-02", "student_id": 56, "amount": 1}])
        client = lc_up(**{f"{API}/payments": payments, f"{API}/students/56": LcupError("lc-up answered 404 on /students/56")})
        archiver = run(client)
        self.assertEqual(archiver.errors, [])
        client = lc_up(**{f"{API}/payments": payments})
        run(client)
        self.assertNotIn(f"{API}/students/56", [path for path, _ in client.calls])

    def test_dry_run_writes_nothing_but_its_report(self):
        row = A.run_archive(lc_up(), dry_run=True)
        self.assertTrue(row.ok)
        self.assertEqual(row.counts[E.STUDENT]["new"], 2)
        self.assertEqual(LcupArchiveRecord.objects.count(), 0)
        self.assertEqual(LcupArchiveMark.objects.count(), 0)
        self.assertEqual(LcupArchiveRun.objects.count(), 1)

    def test_summary(self):
        A.run_archive(lc_up())
        data = A.summary()
        students = next(e for e in data["entities"] if e["entity"] == E.STUDENT)
        self.assertEqual((students["total"], students["live"], students["versions"]), (2, 2, 2))
        attendance = next(e for e in data["entities"] if e["entity"] == E.ATTENDANCE)
        self.assertEqual(attendance["first_day"], date(2026, 2, 2))
        self.assertEqual(len(data["runs"]), 1)


class ArchiveSwitchTests(TestCase):
    @override_settings(LCUP_ENABLED=True, LCUP_ARCHIVE_ENABLED=False)
    def test_the_nightly_task_waits_for_its_switch(self):
        from lcup.tasks import archive

        self.assertEqual(archive(), {"skipped": "disabled"})

    def test_admin_only_view(self):
        admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        for user, code in ((teacher, 403), (admin, 200)):
            api = APIClient()
            api.force_authenticate(user)
            self.assertEqual(api.get("/api/lcup/archive/").status_code, code)
        api = APIClient()
        api.force_authenticate(admin)
        body = api.get("/api/lcup/archive/").json()
        self.assertEqual({e["entity"] for e in body["entities"]}, set(E.values))
        self.assertNotIn("payload", str(body))
