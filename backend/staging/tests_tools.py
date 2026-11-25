"""The toolbox's tools: test students, a balance set by hand, a filled register, a beat task run now, the captured
messages and a one-time "Sign in as" link (Part A, Task A4). Fixed dates: 25 Nov 2026 is a Wednesday."""

from datetime import date, datetime, timedelta
from unittest import mock
from urllib.parse import urlsplit

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from billing import ledger
from billing.models import Account, BillingState, EntryKind
from billing.tests_lesson_rule import LESSON_MODE
from billing.tests_shadow import NOW
from classes.models import Classroom, ClassroomMembership as M
from classes.models_attendance import AttendanceRecord, AttendanceSession
from config import celery_app
from staging import tools
from staging.models import CapturedMessage, ToolboxAction
from staging.tests_api_time import ADMIN_HOST, MAIN_HOST, TEACHER_HOST, ToolboxApiCase
from staging.timemachine import ToolboxRefused
from users import audience as A
from users.auth_cookies import ACCESS_COOKIE, REFRESH_COOKIE
from users.models import RefreshSession

User = get_user_model()
TODAY = date(2026, 11, 25)
#: The copy once it has left lc-up: money is entered here, the ledger bills and freezes on its own.
LEFT_LCUP = override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False, LCUP_ENABLED=False)


@celery_app.task(name="staging.tests_tools.double")
def double(x):
    return {"doubled": x * 2}


@celery_app.task(name="staging.tests_tools.explode")
def explode():
    raise RuntimeError("the task broke")


def open_ledger():
    state = BillingState.get()
    state.opened_at = NOW
    state.save()


def classroom(created_by, **fields):
    fields = {"name": "Junior G21 Math", "subject": Classroom.SUBJECT_MATH, "lesson_days": Classroom.DAYS_ODD,
              "monthly_price": 500_000, **fields}
    return Classroom.objects.create(created_by=created_by, **fields)


def seat(room, username, *, joined=datetime(2026, 11, 2, 9, 0)):
    user = User.objects.create_user(None, password=None, username=username, role="student")
    row = M.objects.create(classroom=room, user=user, role=M.ROLE_STUDENT)
    M.objects.filter(pk=row.pk).update(joined_at=timezone.make_aware(joined))
    return user


@LESSON_MODE
@LEFT_LCUP
class TestStudentTests(TestCase):
    def setUp(self):
        open_ledger()
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.room = classroom(self.admin)

    def make(self, **kw):
        kw = {"status": M.SEAT_TRIAL, "count": 2, "first_payment": False, "by": self.admin, "today": TODAY, **kw}
        return tools.make_test_students(self.room, **kw)

    def test_two_test_students_with_distinct_test_names_and_phones(self):
        users = self.make()
        names = [f"{u.first_name} {u.last_name}" for u in users]
        phones = [u.phone_number for u in users]
        self.assertEqual(len(set(names)), 2)
        self.assertTrue(all(name.startswith("TEST ") for name in names), names)
        self.assertEqual(len(set(phones)), 2)
        self.assertTrue(all(phone.startswith("998900") and len(phone) == 12 for phone in phones), phones)
        for user in users:
            self.assertTrue(user.parent_phone.startswith("998900"))
            self.assertNotIn(user.parent_phone, phones)
            self.assertEqual(M.objects.get(classroom=self.room, user=user).seat_status, M.SEAT_TRIAL)

    def test_a_phone_someone_holds_is_skipped(self):
        User.objects.create_user(None, password=None, username="998900000001", role="student", phone_number="998900000001")
        numbers = iter(["998900000001", "998900000002", "998900000003"])
        with mock.patch("staging.tools._random_phone", side_effect=lambda: next(numbers)):
            [user] = self.make(count=1)
        self.assertEqual((user.phone_number, user.parent_phone), ("998900000002", "998900000003"))

    def test_an_active_student_with_the_first_payment_holds_the_least_payment_and_is_not_frozen(self):
        [user] = self.make(status=M.SEAT_ACTIVE, count=1, first_payment=True)
        account = Account.objects.get(user=user)
        payment = account.entries.get(kind=EntryKind.PAYMENT)
        self.assertEqual((payment.amount, payment.method, payment.note), (500_000, "Naqd pul", "TEST first payment"))
        self.assertEqual(payment.seat.classroom_id, self.room.pk)
        self.assertEqual(ledger.balance(account), 0)  # the first month in full, then paid in full
        user.refresh_from_db()
        self.assertFalse(user.is_frozen)

    def test_one_to_five_at_a_time(self):
        for count in (0, 6):
            with self.assertRaises(ToolboxRefused):
                self.make(count=count)
        self.assertEqual(len(self.make(count=5)), 5)

    def test_a_seat_refused_is_a_refusal_in_words_and_nothing_is_kept(self):
        self.room.monthly_price = None
        self.room.save()
        with self.assertRaisesMessage(ToolboxRefused, "has no monthly price"):
            self.make(status=M.SEAT_ACTIVE)
        self.assertFalse(User.objects.filter(first_name__startswith="TEST").exists())

    @override_settings(LCUP_ENABLED=True)
    def test_while_lc_up_runs_seats_are_locked(self):
        with self.assertRaisesMessage(ToolboxRefused, "lc-up"):
            self.make()


@LESSON_MODE
@LEFT_LCUP
class SetBalanceTests(TestCase):
    def setUp(self):
        open_ledger()
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.user = User.objects.create_user(None, password=None, username="s1", role="student")
        self.account = Account.objects.create(name="s1", user=self.user)

    def test_minus_one_is_written_as_an_adjustment_and_freezes_for_debt(self):
        self.assertEqual(tools.set_balance(self.user, -1, by=self.admin, today=TODAY), -1)
        self.assertEqual(ledger.balance(self.account), -1)
        row = self.account.entries.get()
        self.assertEqual(
            (row.kind, row.amount, row.note, row.created_by), (EntryKind.ADJUST, -1, "TEST: balance set to -1", self.admin)
        )
        self.user.refresh_from_db()
        self.assertEqual((self.user.is_frozen, self.user.frozen_reason), (True, A.FROZEN_LCUP_DEBT))

    def test_back_above_zero_lifts_the_freeze_and_the_same_target_writes_nothing(self):
        tools.set_balance(self.user, -1, by=self.admin, today=TODAY)
        self.assertEqual(tools.set_balance(self.user, 38_500, by=self.admin, today=TODAY), 38_500)
        self.assertEqual(self.account.entries.latest("id").note, "TEST: balance set to 38,500")
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_frozen)
        self.assertEqual(tools.set_balance(self.user, 38_500, by=self.admin, today=TODAY), 38_500)
        self.assertEqual(self.account.entries.count(), 2)

    def test_someone_with_no_account_or_a_bad_target_is_refused(self):
        nobody = User.objects.create_user(None, password=None, username="s2", role="student")
        with self.assertRaises(ToolboxRefused):
            tools.set_balance(nobody, 0, by=self.admin, today=TODAY)
        with self.assertRaises(ToolboxRefused):
            tools.set_balance(self.user, "a lot", by=self.admin, today=TODAY)


class FillRegisterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.room = classroom(self.admin)
        self.students = [seat(self.room, f"s{n}") for n in range(3)]
        seat(self.room, "late", joined=datetime(2026, 11, 28, 9, 0))  # not on the roster on the 25th

    def marks(self):
        session = AttendanceSession.objects.get(classroom=self.room, date=TODAY)
        return dict(AttendanceRecord.objects.filter(session=session).values_list("student_id", "status"))

    def test_present_marks_every_active_student(self):
        result = tools.fill_register(self.room, TODAY, "present", by=self.admin)
        self.assertEqual(self.marks(), {u.pk: AttendanceRecord.STATUS_PRESENT for u in self.students})
        self.assertEqual((result["present"], result["absent"]), (3, 0))

    def test_some_absent_is_one_or_two_absences(self):
        tools.fill_register(self.room, TODAY, "some_absent", by=self.admin)
        marks = self.marks()
        self.assertEqual(set(marks), {u.pk for u in self.students})
        self.assertIn(list(marks.values()).count(AttendanceRecord.STATUS_ABSENT), (1, 2))

    def test_none_opens_the_register_and_marks_nothing(self):
        tools.fill_register(self.room, TODAY, "present", by=self.admin)
        tools.fill_register(self.room, TODAY, "none", by=self.admin)
        self.assertEqual(len(self.marks()), 3)  # what was marked stays
        self.assertEqual(AttendanceSession.objects.filter(classroom=self.room, date=TODAY).count(), 1)
        with self.assertRaises(ToolboxRefused):
            tools.fill_register(self.room, TODAY, "everyone", by=self.admin)


@override_settings(CELERY_BEAT_SCHEDULE={
    "stub-double": {"task": "staging.tests_tools.double", "schedule": 60.0, "kwargs": {"x": 21}},
})
class TaskTests(TestCase):
    def test_the_beat_tasks_are_listed(self):
        self.assertEqual(tools.beat_tasks(), [{"name": "stub-double", "task": "staging.tests_tools.double", "schedule": "every 60s"}])

    def test_run_task_runs_the_entry_and_returns_its_value(self):
        result = tools.run_task("stub-double")
        self.assertEqual((result["ok"], result["result"]), (True, '{"doubled": 42}'))
        with self.assertRaises(ToolboxRefused):
            tools.run_task("no-such-entry")

    @override_settings(CELERY_BEAT_SCHEDULE={"stub-explode": {"task": "staging.tests_tools.explode", "schedule": 60.0}})
    def test_a_task_that_raises_is_a_failed_run_not_an_error(self):
        result = tools.run_task("stub-explode")
        self.assertEqual((result["ok"], result["result"]), (False, "RuntimeError: the task broke"))


class ToolApiTests(ToolboxApiCase):
    def setUp(self):
        super().setUp()
        open_ledger()
        self.room = classroom(self.admin)

    def test_test_students_through_the_api(self):
        response = self.call("post", "/api/staging/students/", {"classroom_id": self.room.pk, "status": "trial", "count": 2})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["students"]), 2)
        self.assertTrue(response.data["students"][0]["name"].startswith("TEST "))
        self.assertEqual(ToolboxAction.objects.get().action, "students")
        nine = {"classroom_id": self.room.pk, "status": "trial", "count": 9}
        self.assertEqual(self.refused("post", "/api/staging/students/", nine).status_code, 400)

    @LESSON_MODE
    @LEFT_LCUP
    def test_set_a_balance_through_the_api(self):
        user = User.objects.create_user(None, password=None, username="s1", role="student")
        Account.objects.create(name="s1", user=user)
        response = self.call("post", "/api/staging/balance/", {"user_id": user.pk, "target": 38_500})
        self.assertEqual((response.status_code, response.data["balance"]), (200, 38_500))
        self.assertEqual(ToolboxAction.objects.get().detail, {"user_id": user.pk, "target": 38_500, "balance": 38_500})

    def test_fill_a_register_through_the_api(self):
        seat(self.room, "s1")
        response = self.call(
            "post", "/api/staging/register/", {"classroom_id": self.room.pk, "date": "2026-11-25", "mode": "present"}
        )
        self.assertEqual((response.status_code, response.data["present"]), (200, 1))

    def test_groups_and_people_to_pick_from(self):
        student = seat(self.room, "998901112233")
        groups = self.call("get", "/api/staging/groups/").data
        self.assertEqual([(g["id"], g["name"]) for g in groups], [(self.room.pk, "Junior G21 Math")])
        people = self.call("get", "/api/staging/people/", {"q": "99890111"}).data
        self.assertEqual([p["id"] for p in people], [student.pk])

    @override_settings(CELERY_BEAT_SCHEDULE={
        "stub-double": {"task": "staging.tests_tools.double", "schedule": 60.0, "kwargs": {"x": 21}},
    })
    def test_run_a_task_through_the_api(self):
        self.assertEqual([t["name"] for t in self.call("get", "/api/staging/tasks/").data], ["stub-double"])
        response = self.call("post", "/api/staging/tasks/run/", {"name": "stub-double"})
        self.assertEqual((response.status_code, response.data["result"]), (200, '{"doubled": 42}'))
        self.assertEqual(ToolboxAction.objects.get().action, "task.run")

    @override_settings(CELERY_BEAT_SCHEDULE={"stub-explode": {"task": "staging.tests_tools.explode", "schedule": 60.0}})
    def test_run_now_answers_in_json_whatever_goes_wrong(self):
        broken = self.call("post", "/api/staging/tasks/run/", {"name": "stub-explode"})
        self.assertEqual((broken.status_code, broken.data["ok"], broken.data["result"]), (200, False, "RuntimeError: the task broke"))
        with mock.patch("staging.tools.run_task", side_effect=LookupError("the task registry broke")):
            crashed = self.call("post", "/api/staging/tasks/run/", {"name": "stub-explode"})
        self.assertEqual((crashed.status_code, crashed.data["ok"]), (200, False))
        self.assertEqual(crashed.data["result"], "LookupError: the task registry broke")
        rows = list(ToolboxAction.objects.order_by("id"))
        self.assertEqual([(r.action, r.detail["ok"]) for r in rows], [("task.run", False), ("task.run", False)])
        self.assertEqual(rows[1].detail["error"], "LookupError: the task registry broke")


class MessagesApiTests(ToolboxApiCase):
    def setUp(self):
        super().setUp()
        for n in range(55):
            CapturedMessage.objects.create(channel="sms", to=f"99890000{n:04d}", body=f"SMS {n}")
        CapturedMessage.objects.create(channel="telegram", to="-1001", body="Salom guruh")

    def test_fifty_a_page_newest_first_filtered_by_channel_and_person(self):
        first = self.call("get", "/api/staging/messages/").data
        self.assertEqual((first["count"], len(first["results"]), first["results"][0]["body"]), (56, 50, "Salom guruh"))
        second = self.call("get", "/api/staging/messages/", {"page": 2}).data
        self.assertEqual(len(second["results"]), 6)
        sms = self.call("get", "/api/staging/messages/", {"channel": "sms", "q": "998900000054"}).data
        self.assertEqual([m["body"] for m in sms["results"]], ["SMS 54"])

    def test_clear_deletes_the_captured_messages_only(self):
        response = self.call("post", "/api/staging/messages/clear/")
        self.assertEqual((response.status_code, response.data["deleted"]), (200, 56))
        self.assertFalse(CapturedMessage.objects.exists())
        self.assertEqual(ToolboxAction.objects.get().detail, {"deleted": 56})


class SignInTests(ToolboxApiCase):
    def setUp(self):
        super().setUp()
        self.student = User.objects.create_user(None, password=None, username="998901234567", role="student")
        self.teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")

    def link(self, user, *, by=None, refused=False):
        return (self.refused if refused else self.call)("post", "/api/staging/sign-in-link/", {"user_id": user.pk}, user=by)

    def redeem(self, url, *, host=None, refused=False):
        parts = urlsplit(url)
        return (self.refused if refused else self.call)("get", parts.path, authenticate=False, host=host or parts.netloc)

    def test_a_student_link_opens_the_student_side_once_and_both_are_logged(self):
        response = self.link(self.student)
        self.assertEqual(response.status_code, 200)
        url = response.data["url"]
        self.assertEqual(urlsplit(url).netloc, MAIN_HOST)
        first = self.redeem(url)
        self.assertEqual((first.status_code, first["Location"]), (302, "/"))
        self.assertTrue(first.cookies[ACCESS_COOKIE].value)
        self.assertTrue(first.cookies[REFRESH_COOKIE].value)
        self.assertTrue(RefreshSession.objects.filter(user=self.student).exists())
        self.assertEqual(self.redeem(url, refused=True).status_code, 403)
        made = ToolboxAction.objects.get(action="sign_in_link")
        used = ToolboxAction.objects.get(action="sign_in")  # who was signed in, by whose link
        self.assertEqual((made.user, made.detail["user_id"]), (self.admin, self.student.pk))
        self.assertEqual((used.user, used.detail["user_id"], used.detail["name"]), (self.admin, self.student.pk, "998901234567"))

    def test_a_teacher_link_opens_the_teacher_portal(self):
        url = self.link(self.teacher).data["url"]
        self.assertEqual(urlsplit(url).netloc, TEACHER_HOST)
        self.assertEqual(self.redeem(url).status_code, 302)

    def test_a_staff_link_opens_the_console(self):
        owner = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        url = self.link(self.admin, by=owner).data["url"]
        self.assertEqual(urlsplit(url).netloc, ADMIN_HOST)
        self.assertEqual(self.redeem(url)["Location"], "/ops")

    def test_a_link_is_dead_after_ten_minutes(self):
        start = 1_800_000_000.0
        with mock.patch("time.time", return_value=start):
            url = self.link(self.student).data["url"]
        with mock.patch("time.time", return_value=start + 601):
            self.assertEqual(self.redeem(url, refused=True).status_code, 403)
        with mock.patch("time.time", return_value=start + 599):
            self.assertEqual(self.redeem(url).status_code, 302)

    def test_a_link_signed_in_the_future_is_refused(self):
        # A link made at a later test date, then the time machine went Back: its age is negative, not small.
        start = 1_800_000_000.0
        with mock.patch("time.time", return_value=start):
            url = self.link(self.student).data["url"]
        with mock.patch("time.time", return_value=start - 86_400):
            response = self.redeem(url, refused=True)
        self.assertEqual(response.status_code, 403)
        self.assertIn("not valid", response.data["detail"])
        self.assertFalse(ToolboxAction.objects.filter(action="sign_in").exists())

    def test_an_inactive_account_or_a_forged_link_is_refused(self):
        url = self.link(self.student).data["url"]
        User.objects.filter(pk=self.student.pk).update(is_active=False)
        self.assertEqual(self.redeem(url, refused=True).status_code, 403)
        forged = self.refused("get", "/api/staging/sign-in/1:abc:def:ghi/", authenticate=False, host=MAIN_HOST)
        self.assertEqual(forged.status_code, 403)

    def test_the_wrong_console_is_refused_and_the_link_kept(self):
        url = self.link(self.student).data["url"]
        for host in (TEACHER_HOST, ADMIN_HOST):
            self.assertEqual(self.redeem(url, host=host, refused=True).status_code, 403, host)
        self.assertEqual(self.redeem(url).status_code, 302)

    def test_an_admin_cannot_become_someone_ranked_as_high(self):
        owner = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        other = User.objects.create_user(None, password=None, username="other", role="admin")
        for target in (owner, other):
            self.assertEqual(self.link(target, refused=True).status_code, 403, target.role)
        self.assertEqual(self.link(other, by=owner).status_code, 200)

    def test_off_the_copy_a_link_is_not_found(self):
        url = self.link(self.student).data["url"]
        with override_settings(STAGING_TOOLBOX=False):
            self.assertEqual(self.redeem(url, refused=True).status_code, 404)
