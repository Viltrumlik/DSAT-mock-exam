"""The Groups list in lc-up's shape (classes/ops_groups_list.py): price, start, trial seats and lessons done against
the course's length on a row; the Course, Room and Price filters; the "Ends this week" and "Has demo students"
chips."""

from datetime import date, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.ops_groups_list import lessons_for
from lcup.models import GroupLinkStatus, LcupGroupLink
from lcup.models_archive import ArchiveEntity, LcupArchiveRecord
from users.models import User

URL = "/api/classes/admin/classrooms/"
HOST = "admin.mastersat.uz"
SEAT = ClassroomMembership
TODAY = date(2026, 11, 22)


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(LCUP_ENABLED=True, ALLOWED_HOSTS=["testserver", HOST])
class GroupsBoardTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("bekzod", C.ROLE_TEACHER, subject="math", first_name="Bekzod", last_name="Toshmatov")
        self.foundation = Classroom.objects.create(
            name="Foundation G14 | Math | Bekzod", subject="MATH", level="foundation", lesson_days="ODD",
            room_number="302", monthly_price=500000, start_date=date(2026, 11, 6), created_by=self.teacher,
            teacher=self.teacher,
        )
        self.junior = Classroom.objects.create(
            name="Junior G22 English", subject="ENGLISH", level="junior", lesson_days="EVEN", room_number="303",
            start_date=date(2026, 11, 5), created_by=self.teacher,
        )
        self.own = Classroom.objects.create(
            name="Own class", subject="MATH", lesson_days="ODD", created_by=self.teacher
        )
        LcupGroupLink.objects.create(
            lcup_group_id=10, name="Foundation G14", classroom=self.foundation, status=GroupLinkStatus.CONFIRMED,
            snapshot={"course": {"id": 4447, "name": "Foundation Math"}},
        )
        LcupGroupLink.objects.create(
            lcup_group_id=11, name="Junior G22", classroom=self.junior, status=GroupLinkStatus.CONFIRMED,
            snapshot={"course": {"id": 4443, "name": "Junior English"}},
        )
        for key, n in (("4447", 14), ("4443", 0)):  # a course of no stated length has none
            LcupArchiveRecord.objects.create(
                entity=ArchiveEntity.COURSE, lcup_id=key, payload={"id": int(key), "lessons_count": n},
                payload_hash=key,
            )
        self.kids = [make(f"s{i}") for i in range(3)]
        ClassroomMembership.objects.create(classroom=self.foundation, user=self.kids[0], role=SEAT.ROLE_STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.foundation, user=self.kids[1], role=SEAT.ROLE_STUDENT, seat_status=SEAT.SEAT_TRIAL
        )
        ClassroomMembership.objects.create(classroom=self.junior, user=self.kids[2], role=SEAT.ROLE_STUDENT)

    def mark(self, room, day, marked=True):
        session = AttendanceSession.objects.create(classroom=room, date=day)
        if marked:
            AttendanceRecord.objects.create(
                session=session, student=self.kids[0], status=AttendanceRecord.STATUS_PRESENT
            )

    def get(self, **params):
        api = APIClient()
        api.force_authenticate(self.admin)
        with mock.patch("classes.views_ops_classrooms.timezone.localdate", return_value=TODAY):
            r = api.get(URL, params, HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def rows(self, **params):
        return {r["id"]: r for r in self.get(**params)["results"]}

    def facet(self, body, key):
        f = next(f for f in body["filters"] if f["key"] == key)
        return {o["value"]: o["count"] for o in f["options"]}

    def test_a_row_carries_price_start_trial_and_teacher_names(self):
        row = self.rows()[self.foundation.pk]
        self.assertEqual(
            (row["monthly_price"], row["start_date"], row["students"], row["trial"]), (500000, "2026-11-06", 1, 1)
        )
        self.assertEqual((row["teacher_first_name"], row["teacher_last_name"]), ("Bekzod", "Toshmatov"))
        self.assertEqual(row["lesson_hours"], 2)
        own = self.rows()[self.own.pk]
        self.assertEqual((own["monthly_price"], own["start_date"], own["trial"], own["lessons"]), (None, None, 0, None))

    def test_lessons_done_counts_marked_registers_since_the_start(self):
        # The 4th is before the course; the 24th is still to come.
        for day in (date(2026, 11, 4), date(2026, 11, 6), date(2026, 11, 9), date(2026, 11, 11), TODAY + timedelta(2)):
            self.mark(self.foundation, day)
        self.mark(self.foundation, date(2026, 11, 13), marked=False)  # opened, never marked
        rows = self.rows()
        self.assertEqual(rows[self.foundation.pk]["lessons"], {"done": 3, "total": 14})
        # A course of no stated length, and a class with no lc-up course, have no lessons figure at all.
        self.assertIsNone(rows[self.junior.pk]["lessons"])
        self.assertIsNone(rows[self.own.pk]["lessons"])

    def test_no_archive_no_lessons(self):
        LcupArchiveRecord.objects.all().delete()
        self.assertEqual(lessons_for([self.foundation], TODAY), {})

    def test_ends_this_week_and_has_trial_chips(self):
        start = date(2026, 11, 6)
        for i in range(11):  # 11 of 14 done: three left
            self.mark(self.foundation, start + timedelta(days=i))
        body = self.get()
        self.assertEqual(self.facet(body, "show"), {"all": 3, "ends": 1, "trial": 1})
        show = next(f for f in body["filters"] if f["key"] == "show")
        self.assertIn("Has demo students", [o["label"] for o in show["options"]])
        self.assertEqual(list(self.rows(show="ends")), [self.foundation.pk])
        self.assertEqual(list(self.rows(show="trial")), [self.foundation.pk])
        self.assertEqual(len(self.rows(show="all")), 3)
        # Four left is not this week.
        AttendanceSession.objects.filter(classroom=self.foundation, date=start).delete()
        self.assertEqual(self.facet(self.get(), "show")["ends"], 0)

    def test_course_room_and_price_filters(self):
        body = self.get()
        course = next(f for f in body["filters"] if f["key"] == "course")
        self.assertEqual(
            [(o["value"], o["label"]) for o in course["options"]],
            [("foundation:MATH", "Foundation Math"), ("junior:ENGLISH", "Junior English")],
        )
        self.assertEqual(list(self.rows(course="junior:ENGLISH")), [self.junior.pk])
        self.assertEqual(self.facet(body, "room"), {"302": 1, "303": 1})
        room = next(f for f in body["filters"] if f["key"] == "room")
        self.assertEqual([o["label"] for o in room["options"]], ["Room 302", "Room 303"])
        self.assertEqual(list(self.rows(room="303")), [self.junior.pk])
        self.assertEqual(list(self.rows(price="500 000")), [self.foundation.pk])
        self.assertEqual(len(self.rows(price="abc")), 3)  # ignored
