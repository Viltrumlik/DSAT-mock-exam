"""The group page's register grid and roster phones (lc-up structure, our look — 22 Nov 2026)."""

from datetime import date, datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from users.models import User

HOST = "admin.mastersat.uz"
STUDENT = ClassroomMembership.ROLE_STUDENT
#: Wednesday 18 Nov 2026: the odd days (Mon Wed Fri) after it this month are 20, 23, 25, 27, 30.
TODAY = date(2026, 11, 18)


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


def at(day):
    return timezone.make_aware(datetime(day.year, day.month, day.day, 9, 0))


_real_localdate = timezone.localdate


def localdate(value=None, timezone=None):
    """Today is ``TODAY``; any other moment is read as it is."""
    return TODAY if value is None else _real_localdate(value, timezone)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class RegisterPartTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("vali", C.ROLE_TEACHER, subject="math")
        self.room = Classroom.objects.create(
            name="Foundation G13 Math", subject="MATH", lesson_days="ODD", created_by=self.teacher,
            teacher=self.teacher, start_date=date(2026, 10, 1),
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Karimov", phone_number="998935182046")
        self.bek = make("bek", first_name="Bek", last_name="Aliyev")
        self.gone = make("gone", first_name="Gone", last_name="Student")
        for user, joined, status in (
            (self.aziz, date(2026, 10, 1), ClassroomMembership.STATUS_ACTIVE),
            (self.bek, date(2026, 11, 9), ClassroomMembership.STATUS_ACTIVE),
            (self.gone, date(2026, 10, 1), ClassroomMembership.STATUS_REMOVED),
        ):
            seat = ClassroomMembership.objects.create(classroom=self.room, user=user, role=STUDENT, status=status)
            # ``joined_at`` is auto_now_add: set after the row exists.
            ClassroomMembership.objects.filter(pk=seat.pk).update(joined_at=at(joined))
        for day, marks in (
            (date(2026, 11, 2), {self.aziz: "PRESENT", self.gone: "ABSENT"}),
            (date(2026, 11, 16), {self.aziz: "EXCUSED", self.bek: "LATE"}),
            (date(2026, 10, 30), {self.aziz: "PRESENT"}),
        ):
            session = AttendanceSession.objects.create(classroom=self.room, date=day)
            for user, status in marks.items():
                AttendanceRecord.objects.create(session=session, student=user, status=status)

    def register(self, user=None, **params):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        with mock.patch("django.utils.timezone.localdate", side_effect=localdate):
            return api.get(f"/api/classes/admin/classrooms/{self.room.pk}/register/", params, HTTP_HOST=HOST)

    def test_a_month_lists_the_registers_held_and_the_lessons_still_ahead(self):
        body = self.register(month="2026-11").json()
        self.assertEqual(body["month"], "2026-11")
        self.assertEqual(body["today"], "2026-11-18")
        held = [(d["date"], d["held"]) for d in body["dates"]]
        self.assertEqual(held, [
            ("2026-11-02", True), ("2026-11-16", True), ("2026-11-18", False), ("2026-11-20", False),
            ("2026-11-23", False), ("2026-11-25", False), ("2026-11-27", False), ("2026-11-30", False),
        ])

    def test_todays_lesson_is_a_column_before_its_register_opens(self):
        # A lesson day's column is there from the morning, so it can be cancelled or moved before anyone marks it.
        before = [(d["date"], d["held"]) for d in self.register(month="2026-11").json()["dates"]]
        self.assertIn(("2026-11-18", False), before)
        AttendanceSession.objects.create(classroom=self.room, date=TODAY)
        after = [(d["date"], d["held"]) for d in self.register(month="2026-11").json()["dates"]]
        self.assertEqual([held for day, held in after if day == "2026-11-18"], [True])

    def test_each_student_carries_their_marks_and_the_day_they_joined(self):
        body = self.register(month="2026-11").json()
        rows = {s["name"]: s for s in body["students"]}
        self.assertEqual(rows["Aziz Karimov"]["marks"], {"2026-11-02": "PRESENT", "2026-11-16": "EXCUSED"})
        self.assertEqual(rows["Bek Aliyev"]["marks"], {"2026-11-16": "LATE"})
        self.assertEqual(rows["Bek Aliyev"]["joined"], "2026-11-09")
        self.assertEqual(rows["Aziz Karimov"]["seat_status"], "active")

    def test_someone_marked_that_month_who_has_left_is_listed_last_and_flagged(self):
        students = self.register(month="2026-11").json()["students"]
        self.assertEqual([s["name"] for s in students], ["Aziz Karimov", "Bek Aliyev", "Gone Student"])
        self.assertEqual((students[-1]["left"], students[-1]["marks"]), (True, {"2026-11-02": "ABSENT"}))

    def test_the_months_with_registers_are_offered_and_this_month_is_the_default(self):
        body = self.register().json()
        self.assertEqual(body["month"], "2026-11")
        self.assertEqual(body["months"], ["2026-10", "2026-11"])
        october = self.register(month="2026-10").json()
        self.assertEqual([d["date"] for d in october["dates"]], ["2026-10-30"])
        self.assertEqual(self.register(month="nonsense").json()["month"], "2026-11")

    def test_an_archived_class_shows_no_lessons_ahead(self):
        Classroom.objects.filter(pk=self.room.pk).update(is_active=False)
        body = self.register(month="2026-11").json()
        self.assertEqual([d["date"] for d in body["dates"]], ["2026-11-02", "2026-11-16"])

    def test_a_changed_day_says_how_and_stays_a_column_to_undo_it(self):
        from classes import lesson_changes as L

        def change(*args):
            return (L.move if len(args) == 4 else L.cancel)(*args, by=self.admin, today=TODAY)

        cancelled = change(self.room, date(2026, 11, 20), "Teacher ill")
        gone_by = change(self.room, date(2026, 11, 9), "Power cut")  # no register was held that day
        moved = change(self.room, date(2026, 11, 23), date(2026, 11, 24), "Room taken")
        holiday = change(None, date(2026, 11, 25), "Teachers' day")
        change(None, date(2026, 11, 10), "Not our day")  # a Tuesday: this class never met on it
        L.undo(change(self.room, date(2026, 11, 13), "Undone"), by=self.admin, today=TODAY)
        dates = {d["date"]: (d["held"], d["change"]) for d in self.register(month="2026-11").json()["dates"]}
        self.assertEqual(
            list(dates),
            ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-18", "2026-11-20", "2026-11-23", "2026-11-24",
             "2026-11-25", "2026-11-27", "2026-11-30"],
        )
        self.assertEqual(
            dates["2026-11-20"], (False, {"id": cancelled.pk, "kind": "cancel", "reason": "Teacher ill", "holiday": False})
        )
        self.assertEqual(
            dates["2026-11-09"], (False, {"id": gone_by.pk, "kind": "cancel", "reason": "Power cut", "holiday": False})
        )
        self.assertEqual(
            dates["2026-11-23"],
            (False, {"id": moved.pk, "kind": "move", "reason": "Room taken", "holiday": False, "new_day": "2026-11-24"}),
        )
        self.assertEqual(
            dates["2026-11-24"],
            (False, {"id": moved.pk, "kind": "move", "reason": "Room taken", "holiday": False, "from_day": "2026-11-23"}),
        )
        self.assertEqual(
            dates["2026-11-25"], (False, {"id": holiday.pk, "kind": "cancel", "reason": "Teachers' day", "holiday": True})
        )
        self.assertEqual((dates["2026-11-02"], dates["2026-11-27"]), ((True, None), (False, None)))

    def test_the_desk_only(self):
        self.assertEqual(self.register(user=self.teacher).status_code, 403)

    def test_the_roster_gives_each_student_their_phone(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        body = api.get(f"/api/classes/admin/classrooms/{self.room.pk}/roster/", HTTP_HOST=HOST).json()
        phones = {s["name"]: s["phone"] for s in body["students"]}
        self.assertEqual(phones, {"Aziz Karimov": "998935182046", "Bek Aliyev": ""})
