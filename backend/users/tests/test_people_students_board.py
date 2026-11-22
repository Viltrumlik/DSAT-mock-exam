"""The Students list in lc-up's shape (canvas board "Students", 22 Nov 2026): each group as a course tag with its
room, teacher, seat status and start; the chips (All / Owe money / Trial / Frozen / No group); the Course filter; and
the typed Phone and Parent phone filters (the parent's phone is searched by, never given out)."""

from datetime import date
from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink, LinkStatus
from users.models import User

URL = "/api/users/admin/people/"
HOST = "admin.mastersat.uz"
SEAT = ClassroomMembership


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class StudentsBoardTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math", first_name="Bekzod", last_name="Toshmatov")
        self.junior = Classroom.objects.create(
            name="Junior G21 | Math | Bekzod", subject="MATH", level="junior", room_number="304",
            created_by=self.teacher, teacher=self.teacher,
        )
        self.middle = Classroom.objects.create(
            name="Middle G4 English", subject="ENGLISH", level="middle", created_by=self.teacher,
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Karimov", phone_number="998935182046",
                         parent_phone="998903001172")
        self.laylo = make("laylo", first_name="Laylo", last_name="Saidova", phone_number="998917740533")
        self.olim = make("olim", first_name="Olim", last_name="Nazarov")
        self.nobody = make("nobody", first_name="No", last_name="Group")
        ClassroomMembership.objects.create(
            classroom=self.junior, user=self.aziz, role=SEAT.ROLE_STUDENT, seat_start_date=date(2026, 9, 2)
        )
        ClassroomMembership.objects.create(
            classroom=self.junior, user=self.laylo, role=SEAT.ROLE_STUDENT, seat_status=SEAT.SEAT_TRIAL
        )
        ClassroomMembership.objects.create(
            classroom=self.middle, user=self.olim, role=SEAT.ROLE_STUDENT, seat_status=SEAT.SEAT_FROZEN
        )
        LcupStudentLink.objects.create(
            lcup_student_id=1, name="Karimov Aziz", user=self.aziz, status=LinkStatus.AUTO, balance=Decimal("-153846")
        )

    def get(self, **params):
        api = APIClient()
        api.force_authenticate(self.admin)
        r = api.get(URL, {"section": "students", **params}, HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def ids(self, body):
        return sorted(r["id"] for r in body["results"])

    def facet(self, body, key):
        f = next(f for f in body["filters"] if f["key"] == key)
        return {o["value"]: o["count"] for o in f["options"]}

    def test_a_group_cell_carries_the_course_room_teacher_seat_and_start(self):
        rows = {r["id"]: r for r in self.get()["results"]}
        self.assertEqual(
            rows[self.aziz.pk]["groups"],
            [{
                "id": self.junior.pk, "name": "Junior G21 | Math | Bekzod", "level": "junior", "subject": "MATH",
                "room": "304", "teacher": {
                    "id": self.teacher.pk, "name": "Bekzod Toshmatov", "first_name": "Bekzod", "last_name": "Toshmatov",
                },
                "seat_status": "active", "joined": "2026-09-02",
            }],
        )
        laylo = rows[self.laylo.pk]["groups"][0]
        self.assertEqual(laylo["seat_status"], "trial")
        # No start stated: the day the seat was made.
        self.assertIsNotNone(laylo["joined"])
        self.assertIsNone(rows[self.olim.pk]["groups"][0]["teacher"])
        # Searched by, never given out (users/tests/test_person_parent.py).
        self.assertNotIn("parent_phone", rows[self.aziz.pk])

    def test_the_chips_count_and_filter(self):
        body = self.get()
        self.assertEqual(
            self.facet(body, "show"), {"all": 4, "owes": 1, "trial": 1, "frozen": 1, "nogroup": 1}
        )
        self.assertEqual(self.ids(self.get(show="owes")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(show="trial")), [self.laylo.pk])
        self.assertEqual(self.ids(self.get(show="frozen")), [self.olim.pk])
        self.assertEqual(self.ids(self.get(show="nogroup")), [self.nobody.pk])
        # "All" filters nothing.
        self.assertEqual(len(self.get(show="all")["results"]), 4)
        # The chips count with the other filters applied.
        self.assertEqual(self.facet(self.get(group=str(self.junior.pk)), "show")["all"], 2)

    def test_a_seat_in_an_archived_class_is_no_group(self):
        Classroom.objects.filter(pk=self.middle.pk).update(is_active=False)
        self.assertEqual(self.ids(self.get(show="nogroup")), sorted([self.olim.pk, self.nobody.pk]))

    def test_the_course_filter(self):
        body = self.get()
        course = next(f for f in body["filters"] if f["key"] == "course")
        self.assertEqual(
            [(o["value"], o["label"], o["count"]) for o in course["options"]],
            [("junior:MATH", "Junior Math", 2), ("middle:ENGLISH", "Middle English", 1)],
        )
        self.assertEqual(self.ids(self.get(course="junior:MATH")), sorted([self.aziz.pk, self.laylo.pk]))
        self.assertEqual(len(self.get(course="nonsense")["results"]), 4)  # ignored

    def test_phone_and_parent_phone_filters_match_the_digits_typed(self):
        self.assertEqual(self.ids(self.get(phone="93 518")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(phone="+998 91 774")), [self.laylo.pk])
        self.assertEqual(self.ids(self.get(parent_phone="300-11-72")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(parent_phone="000000")), [])
        # Typed letters alone filter nothing.
        self.assertEqual(len(self.get(phone="abc")["results"]), 4)
