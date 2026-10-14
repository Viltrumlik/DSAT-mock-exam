"""Money from lc-up (Part 3): the payments copy, the freeze for an unpaid month, and who sees what.

Owner, 2026-10-14: "har oyning 6-sanasigacha qarz to'lanmasa muzlatilsin 6-kuni" (from the day it is
switched on); the student sees their own money, admins everyone's, teachers only a "frozen" badge.
Every date is fixed: the freeze reads the day of the month, so a test must never read the clock.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from io import StringIO
import json
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access.host_guard import public_student_may
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceSession
from lcup import finance
from lcup.models import (
    GroupLinkStatus,
    LcupGroupLink,
    LcupMembership,
    LcupPayment,
    LcupState,
    LcupStudentLink,
    LinkStatus,
)
from lcup.sync import API, run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import lcup_data
from users.models import RoleChange, User

PAYMENTS = f"{API}/payments"
ON = {"LCUP_DEBT_FREEZE_ENABLED": True}


def at(day, month=10, hour=9):
    return timezone.make_aware(datetime(2026, month, day, hour, 0))


def pay(pid, *, student=101, amount=500000, day="2026-10-07", kind="payment", method="Naqd pul", month="2026-10", group=10):
    return {
        "id": pid, "student_id": student, "amount": amount, "date": day, "type": kind,
        "method": {"id": 1, "name": method}, "month": month, "group_id": group, "note": None,
        "created_at": f"{day} 10:00:00", "updated_at": f"{day} 10:00:00", "filial_id": 588,
        "student_balance": 0, "student_debt": 0,
    }


class FakeRun:
    def __init__(self, now):
        self.now = now
        self.counts = defaultdict(int)
        self.errors = []
        self.alerts = []


class FinanceFixture(TestCase):
    def setUp(self):
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=10, name="Junior G21 | Math | Vali", status=GroupLinkStatus.CONFIRMED,
            snapshot={"cost": 500000, "course_start_date": "2026-09-01", "teachers": [{"id": 2001, "name": "Aliyev Vali"}]},
        )
        self.aziz, self.aziz_link = self.learner(101, "aziz", balance=-150000)
        self.malika, self.malika_link = self.learner(102, "malika", balance=200000)

    def learner(self, lcup_id, username, *, balance, role="student", in_group=True, **extra):
        user = User.objects.create_user(
            None, password=None, username=username, role=role, first_name=username.title(), last_name="Testov", **extra
        )
        link = LcupStudentLink.objects.create(
            lcup_student_id=lcup_id, name=f"Testov {username.title()}", user=user, status=LinkStatus.CONFIRMED,
            balance=None if balance is None else Decimal(balance),
        )
        if in_group:
            LcupMembership.objects.create(group=self.group, student=link, lcup_status="active")
        return user, link

    def set_balance(self, link, balance):
        LcupStudentLink.objects.filter(pk=link.pk).update(balance=None if balance is None else Decimal(balance))
        link.refresh_from_db()

    def freeze(self, user, reason="lcup_debt"):
        User.objects.filter(pk=user.pk).update(is_frozen=True, frozen_reason=reason)
        user.refresh_from_db()

    def state(self, user):
        user.refresh_from_db()
        return (user.is_frozen, user.frozen_reason)


class PaymentSyncTests(FinanceFixture):
    def sync(self, rows, now=None):
        client = FakeLcupClient({PAYMENTS: rows})
        run = FakeRun(now or at(14))
        finance.sync_payments(client, run)
        return client, run

    def test_the_first_run_reads_every_day_since_the_first_course(self):
        client, run = self.sync([pay(1), pay(2, student=102, method="Plastik karta")])
        self.assertEqual([(p["from"], p["to"]) for _, p in client.calls], [("2026-09-01", "2026-10-14")])
        self.assertEqual(LcupPayment.objects.count(), 2)
        self.assertIsNotNone(LcupState.get().payments_backfilled_at)
        self.assertEqual(run.counts["payments"], 2)

    def test_a_long_history_is_read_in_windows_lcup_accepts(self):
        LcupGroupLink.objects.filter(pk=self.group.pk).update(snapshot={"course_start_date": "2026-05-01"})
        client, _ = self.sync([])
        windows = [(datetime.fromisoformat(p["from"]).date(), datetime.fromisoformat(p["to"]).date()) for _, p in client.calls]
        self.assertEqual(str(windows[0][0]), "2026-05-01")
        self.assertEqual(str(windows[-1][1]), "2026-10-14")
        for (lo, hi), (nxt, _) in zip(windows, windows[1:]):
            self.assertLessEqual((hi - lo).days + 1, 92)
            self.assertEqual((nxt - hi).days, 1)

    def test_later_runs_read_the_last_week(self):
        LcupState.objects.update_or_create(pk=1, defaults={"payments_backfilled_at": at(1)})
        client, _ = self.sync([])
        self.assertEqual([(p["from"], p["to"]) for _, p in client.calls], [("2026-10-07", "2026-10-14")])

    def test_a_payment_is_kept_as_lcup_wrote_it(self):
        self.sync([pay(7, kind="refund", amount=100000, method="Plastik karta", month="2026-09", day="2026-10-02")])
        p = LcupPayment.objects.get(lcup_payment_id=7)
        self.assertEqual(
            (p.kind, p.amount, p.method, p.month, str(p.paid_on), p.student_id, p.group_id),
            ("refund", 100000, "Plastik karta", "2026-09", "2026-10-02", self.aziz_link.pk, self.group.pk),
        )

    def test_a_payment_lcup_deleted_goes_and_older_ones_stay(self):
        LcupState.objects.update_or_create(pk=1, defaults={"payments_backfilled_at": at(1)})
        for pid, day in ((1, "2026-10-10"), (2, "2026-09-15")):
            LcupPayment.objects.create(
                lcup_payment_id=pid, lcup_student_id=101, kind="payment", amount=1, paid_on=day, synced_at=at(1)
            )
        _, run = self.sync([])
        self.assertEqual(list(LcupPayment.objects.values_list("lcup_payment_id", flat=True)), [2])
        self.assertEqual(run.counts["payments_removed"], 1)

    def test_a_half_empty_row_is_skipped(self):
        _, run = self.sync([pay(1), {**pay(2), "date": None}, {**pay(3), "amount": "n/a"}])
        self.assertEqual(list(LcupPayment.objects.values_list("lcup_payment_id", flat=True)), [1])
        self.assertEqual(run.counts["payments_skipped"], 2)


@override_settings(**ON)
class FreezeTests(FinanceFixture):
    def run_on(self, day, *, errors=()):
        run = FakeRun(at(day))
        run.errors = list(errors)
        finance.apply_freeze(run)
        return run

    def test_from_the_sixth_a_student_who_owes_is_frozen(self):
        run = self.run_on(6)
        self.assertEqual(self.state(self.aziz), (True, "lcup_debt"))
        self.assertEqual(self.state(self.malika), (False, ""))
        change = RoleChange.objects.get(user=self.aziz)
        self.assertEqual((change.froze, change.reason, change.from_role, change.to_role), (True, "lcup_debt_unpaid", "student", "student"))
        self.assertEqual(run.counts["debt_frozen"], 1)

    def test_before_the_sixth_nobody_new_is_frozen(self):
        self.run_on(5)
        self.assertEqual(self.state(self.aziz), (False, ""))

    @override_settings(LCUP_DEBT_FREEZE_DAY=10)
    def test_the_due_day_is_a_setting(self):
        self.run_on(9)
        self.assertFalse(self.state(self.aziz)[0])
        self.run_on(10)
        self.assertTrue(self.state(self.aziz)[0])

    def test_paying_lifts_it_any_day(self):
        self.freeze(self.aziz)
        self.set_balance(self.aziz_link, 0)
        run = self.run_on(3)
        self.assertEqual(self.state(self.aziz), (False, ""))
        self.assertEqual(run.counts["debt_unfrozen"], 1)

    def test_paying_part_keeps_it(self):
        self.freeze(self.aziz)
        self.set_balance(self.aziz_link, -1)
        self.run_on(20)
        self.assertEqual(self.state(self.aziz), (True, "lcup_debt"))
        self.assertFalse(RoleChange.objects.exists())

    def test_an_unknown_balance_is_never_debt(self):
        self.set_balance(self.aziz_link, None)
        self.run_on(20)
        self.assertFalse(self.state(self.aziz)[0])

    def test_an_exempt_student_is_never_frozen_and_is_let_go(self):
        LcupStudentLink.objects.filter(pk=self.aziz_link.pk).update(debt_freeze_exempt_at=at(1))
        self.run_on(20)
        self.assertFalse(self.state(self.aziz)[0])
        self.freeze(self.aziz)
        self.run_on(20)
        self.assertFalse(self.state(self.aziz)[0])

    def test_an_administrators_freeze_is_never_touched(self):
        self.freeze(self.aziz, reason="")
        self.run_on(20)
        self.set_balance(self.aziz_link, 0)
        self.run_on(20)
        self.assertEqual(self.state(self.aziz), (True, ""))
        self.assertFalse(RoleChange.objects.exists())

    def test_staff_are_never_frozen(self):
        teacher, _ = self.learner(103, "teacher", balance=-500000, role="teacher", subject="math")
        self.run_on(20)
        self.assertFalse(self.state(teacher)[0])

    def test_a_student_lcup_archived_is_not_frozen(self):
        LcupStudentLink.objects.filter(pk=self.aziz_link.pk).update(deleted_in_lcup=True)
        self.run_on(20)
        self.assertFalse(self.state(self.aziz)[0])

    def test_a_leaver_who_owes_is_frozen_too(self):
        leaver, _ = self.learner(104, "leaver", balance=-90000, role="public_student", in_group=False)
        self.run_on(20)
        self.assertEqual(self.state(leaver), (True, "lcup_debt"))

    def test_a_run_with_errors_freezes_nobody_but_still_lets_go(self):
        paid, paid_link = self.learner(105, "paid", balance=0)
        self.freeze(paid)
        run = self.run_on(20, errors=[{"stage": "groups", "error": "LcupUnavailable"}])
        self.assertFalse(self.state(self.aziz)[0])
        self.assertFalse(self.state(paid)[0])
        self.assertIn("debt freezes held: this sync had errors", run.alerts)

    def test_too_many_at_once_wait_for_a_person(self):
        with mock.patch.object(finance, "MAX_FREEZES_PER_RUN", 0):
            run = self.run_on(20)
        self.assertFalse(self.state(self.aziz)[0])
        self.assertEqual(run.counts["debt_freezes_held"], 1)

    @override_settings(LCUP_DEBT_FREEZE_ENABLED=False)
    def test_switched_off_it_lets_go_the_centre_students_it_froze(self):
        self.freeze(self.aziz)
        leaver, _ = self.learner(104, "leaver", balance=-90000, role="public_student", in_group=False)
        self.freeze(leaver)  # the audience stage's freeze of a leaver with debt: not this switch's
        self.run_on(20)
        self.assertEqual(self.state(self.aziz), (False, ""))
        self.assertEqual(self.state(leaver), (True, "lcup_debt"))

    def test_the_report_shows_who_would_be_frozen_and_changes_nothing(self):
        report = finance.freeze_report(at(6))
        self.assertEqual([r["username"] for r in report["would_freeze"]], ["aziz"])
        self.assertEqual(report["would_freeze"][0]["debt"], 150000)
        self.assertEqual(report["would_freeze"][0]["groups"], ["Junior G21 | Math | Vali"])
        self.assertFalse(self.state(self.aziz)[0])
        out = StringIO()
        call_command("lcup_finance_report", stdout=out)
        self.assertIn("would_freeze", json.loads(out.getvalue()))


@override_settings(LCUP_ENABLED=True, **ON)
class FreezeInTheSyncTests(TestCase):
    """The stages in order: lc-up's balances first, then the freeze — and the audience stage of the
    public split must not lift it every run (it used to, for a centre student frozen for debt)."""

    def setUp(self):
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": at(1)})
        self.user = User.objects.create_user(None, password=None, username="malika", role="student")
        LcupStudentLink.objects.create(lcup_student_id=101, name="Karimova Malika", user=self.user, status=LinkStatus.CONFIRMED)

    def data(self, balance):
        d = lcup_data()
        for row in d[f"{API}/students"]:
            row["balance"] = balance if row["id"] == 101 else "0"
        d[PAYMENTS] = [pay(1)]
        return d

    def test_the_sync_copies_payments_and_freezes_an_unpaid_month(self):
        run = run_sync(FakeLcupClient(self.data("-100000")), now=at(6))
        self.user.refresh_from_db()
        self.assertEqual((self.user.is_frozen, self.user.frozen_reason), (True, "lcup_debt"), run.errors)
        self.assertEqual(LcupPayment.objects.count(), 1)
        run_sync(FakeLcupClient(self.data("0")), now=at(7))
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_frozen)

    @override_settings(PUBLIC_SPLIT_ENABLED=True)
    def test_the_split_does_not_lift_it_every_run(self):
        for _ in range(3):
            run_sync(FakeLcupClient(self.data("-100000")), now=at(6))
        self.user.refresh_from_db()
        self.assertEqual((self.user.role, self.user.is_frozen), ("student", True))
        self.assertEqual(RoleChange.objects.filter(user=self.user).count(), 1)


class StudentFinanceViewTests(FinanceFixture):
    URL = "/api/lcup/me/finance/"

    def setUp(self):
        super().setUp()
        for pid, day in ((1, "2026-09-07"), (2, "2026-10-07")):
            LcupPayment.objects.create(
                lcup_payment_id=pid, student=self.aziz_link, lcup_student_id=101, group=self.group, lcup_group_id=10,
                kind="payment", amount=500000, method="Naqd pul", paid_on=day, month=day[:7], synced_at=at(7),
            )

    def get(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api.get(self.URL)

    def test_a_student_sees_their_own_money(self):
        body = self.get(self.aziz).json()
        self.assertEqual((body["linked"], body["balance"], body["debt"], body["monthly_cost"]), (True, -150000, 150000, 500000))
        self.assertEqual(body["groups"], [{"name": "Junior G21 | Math | Vali", "monthly_cost": 500000}])
        self.assertEqual([p["date"] for p in body["payments"]], ["2026-10-07", "2026-09-07"])
        self.assertEqual(body["payments"][0]["method"], "Naqd pul")
        self.assertFalse(body["frozen_for_debt"])

    def test_a_student_sees_only_their_own(self):
        body = self.get(self.malika).json()
        self.assertEqual((body["balance"], body["debt"], body["payments"]), (200000, 0, []))

    def test_an_account_lcup_does_not_know_has_nothing_to_show(self):
        stranger = User.objects.create_user(None, password=None, username="stranger", role="student")
        self.assertEqual(self.get(stranger).json(), {"linked": False})

    def test_a_student_frozen_for_debt_can_still_see_what_they_owe(self):
        self.freeze(self.aziz)
        response = self.get(self.aziz)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["frozen_for_debt"])
        self.assertEqual(response.json()["debt"], 150000)

    def test_a_public_learner_may_reach_their_own_page_and_nothing_else_of_lcup(self):
        self.assertTrue(public_student_may(self.URL))
        self.assertFalse(public_student_may("/api/lcup/finance/summary/"))


@override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
class AdminFinanceViewTests(FinanceFixture):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        rows = (
            (1, 101, "payment", 500000, "Naqd pul", "2026-10-07"),
            (2, 102, "payment", 500000, "Plastik karta", "2026-10-08"),
            (3, 102, "refund", 100000, "Naqd pul", "2026-10-09"),
            (4, 101, "payment", 500000, "Naqd pul", "2026-09-07"),
        )
        links = {101: self.aziz_link, 102: self.malika_link}
        for pid, sid, kind, amount, method, day in rows:
            LcupPayment.objects.create(
                lcup_payment_id=pid, student=links[sid], lcup_student_id=sid, group=self.group, lcup_group_id=10,
                kind=kind, amount=amount, method=method, paid_on=day, month=day[:7], synced_at=at(9),
            )

    def api(self, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api

    def get(self, path, user=None):
        return self.api(user).get(path, HTTP_HOST="admin.mastersat.uz")

    def test_the_month_in_numbers(self):
        body = self.get("/api/lcup/finance/summary/?month=2026-10").json()
        self.assertEqual((body["paid"], body["refunded"], body["total_debt"], body["debtors"]), (1000000, 100000, 150000, 1))
        self.assertEqual(body["by_method"], {"Naqd pul": 500000, "Plastik karta": 500000})
        group = body["by_group"][0]
        self.assertEqual(
            (group["group"], group["students"], group["debtors"], group["debt"], group["income"], group["teachers"]),
            ("Junior G21 | Math | Vali", 2, 1, 150000, 900000, ["Aliyev Vali"]),
        )
        self.assertEqual(body["freeze"], {"enabled": False, "day": 6})

    def test_debtors_with_their_groups_teachers_and_last_payment(self):
        rows = self.get("/api/lcup/finance/debtors/").json()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["name"], row["debt"], row["last_payment_on"]), ("Testov Aziz", 150000, "2026-10-07"))
        self.assertEqual((row["groups"], row["teachers"], row["frozen"], row["exempt"]), (["Junior G21 | Math | Vali"], ["Aliyev Vali"], False, False))
        self.assertEqual(row["user"]["username"], "aziz")

    def test_the_months_payments(self):
        rows = self.get("/api/lcup/finance/payments/?month=2026-09").json()
        self.assertEqual([(r["id"], r["student"], r["amount"]) for r in rows], [(4, "Testov Aziz", 500000)])

    def test_an_exemption_lets_a_frozen_student_go_and_can_be_taken_back(self):
        self.freeze(self.aziz)
        url = f"/api/lcup/finance/exempt/{self.aziz_link.pk}/"
        res = self.api().post(url, {"exempt": True}, format="json", HTTP_HOST="admin.mastersat.uz")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.state(self.aziz), (False, ""))
        self.aziz_link.refresh_from_db()
        self.assertEqual(self.aziz_link.debt_freeze_exempt_by, self.admin)
        self.api().post(url, {"exempt": False}, format="json", HTTP_HOST="admin.mastersat.uz")
        self.aziz_link.refresh_from_db()
        self.assertIsNone(self.aziz_link.debt_freeze_exempt_at)
        self.assertEqual(
            self.api().post(url, {"exempt": "yes"}, format="json", HTTP_HOST="admin.mastersat.uz").status_code, 400
        )

    def test_a_teacher_sees_none_of_it(self):
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        for path in ("/api/lcup/finance/summary/", "/api/lcup/finance/debtors/", "/api/lcup/finance/payments/"):
            self.assertEqual(self.get(path, teacher).status_code, 403, path)


class TeacherBadgeTests(FinanceFixture):
    """The teaching team sees that a student is frozen for debt — the badge, never the amount."""

    def setUp(self):
        super().setUp()
        self.teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", lesson_days="ODD", lesson_time="16:00",
            created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        for u in (self.aziz, self.malika):
            ClassroomMembership.objects.create(classroom=self.room, user=u, role=ClassroomMembership.ROLE_STUDENT)
        self.freeze(self.aziz)

    def as_user(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def test_the_people_page_shows_the_badge_to_the_teacher_only(self):
        for viewer, expected in ((self.teacher, True), (self.malika, False)):
            rows = self.as_user(viewer).get(f"/api/classes/{self.room.pk}/people/").data
            flags = {row["user"]["id"]: row["frozen_for_debt"] for row in rows}
            self.assertEqual(flags[self.aziz.pk], expected, viewer.username)
            self.assertFalse(flags[self.malika.pk])

    def test_the_roster_and_the_register_show_it_without_an_amount(self):
        rows = self.as_user(self.teacher).get(f"/api/classes/{self.room.pk}/members/").data
        self.assertTrue({r["user"]["id"]: r["frozen_for_debt"] for r in rows}[self.aziz.pk])
        session = AttendanceSession.objects.create(classroom=self.room, date=timezone.localdate())
        body = self.as_user(self.teacher).get(f"/api/classes/{self.room.pk}/attendance/sessions/{session.pk}/").json()
        row = {r["student_id"]: r for r in body["roster"]}[self.aziz.pk]
        self.assertTrue(row["frozen_for_debt"])
        self.assertNotIn("debt", row)
        self.assertNotIn("balance", json.dumps(body))
