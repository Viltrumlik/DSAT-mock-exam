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
        rows.update({r["id"]: r for r in self.get(show="trial")["results"]})  # laylo: demo only, under the Demo chip
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
        # The parent's phone on the row's second line, for the desk (users/tests/test_person_parent.py).
        self.assertEqual(rows[self.aziz.pk]["parent_phone"], "998903001172")
        self.assertEqual(rows[self.laylo.pk]["parent_phone"], "")

    def test_the_chips_count_and_filter(self):
        body = self.get()
        self.assertEqual(
            self.facet(body, "show"), {"all": 3, "owes": 1, "trial": 1, "frozen": 1, "nogroup": 1}
        )
        self.assertEqual(self.ids(self.get(show="owes")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(show="trial")), [self.laylo.pk])
        self.assertEqual(self.ids(self.get(show="frozen")), [self.olim.pk])
        self.assertEqual(self.ids(self.get(show="nogroup")), [self.nobody.pk])
        # "All" filters nothing.
        self.assertEqual(len(self.get(show="all")["results"]), 3)  # laylo holds only a demo seat: under the Demo chip
        # The chips count with the other filters applied; the Demo chip still counts the demo-only person.
        body = self.get(group=str(self.junior.pk))
        self.assertEqual((self.facet(body, "show")["all"], self.facet(body, "show")["trial"]), (1, 1))

    def test_a_seat_in_an_archived_class_is_no_group(self):
        Classroom.objects.filter(pk=self.middle.pk).update(is_active=False)
        self.assertEqual(self.ids(self.get(show="nogroup")), sorted([self.olim.pk, self.nobody.pk]))

    def test_the_course_filter(self):
        body = self.get()
        course = next(f for f in body["filters"] if f["key"] == "course")
        self.assertEqual(
            [(o["value"], o["label"], o["count"]) for o in course["options"]],
            [("junior:MATH", "Junior Math", 1), ("middle:ENGLISH", "Middle English", 1)],
        )
        self.assertEqual(self.ids(self.get(course="junior:MATH")), [self.aziz.pk])
        self.assertEqual(len(self.get(course="nonsense")["results"]), 3)  # ignored

    def test_phone_and_parent_phone_filters_match_the_digits_typed(self):
        self.assertEqual(self.ids(self.get(phone="93 518")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(phone="+998 91 774")), [self.laylo.pk])
        self.assertEqual(self.ids(self.get(parent_phone="300-11-72")), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(parent_phone="000000")), [])
        # Typed letters alone filter nothing.
        self.assertEqual(len(self.get(phone="abc")["results"]), 3)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class DemoOnlyPeopleTests(TestCase):
    """A person whose only live seat is a demo (trial) one is not in the default list: they sit under the
    Demo chip, and a search still finds them."""

    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.room = Classroom.objects.create(name="G1 Math", subject="MATH", level="junior", created_by=self.admin)
        self.other = Classroom.objects.create(name="G2 Math", subject="MATH", level="junior", created_by=self.admin)
        self.paying = make("paying", first_name="Pay", last_name="Ing")
        self.demo = make("demoonly", first_name="Dema", last_name="Only")
        self.mixed = make("mixed", first_name="Mix", last_name="Ed")
        for room, user, seat in (
            (self.room, self.paying, SEAT.SEAT_ACTIVE),
            (self.room, self.demo, SEAT.SEAT_TRIAL),
            (self.room, self.mixed, SEAT.SEAT_TRIAL),
            (self.other, self.mixed, SEAT.SEAT_FROZEN),
        ):
            ClassroomMembership.objects.create(classroom=room, user=user, role=SEAT.ROLE_STUDENT, seat_status=seat)

    get = StudentsBoardTests.get
    ids = StudentsBoardTests.ids
    facet = StudentsBoardTests.facet

    def test_the_default_list_and_its_total_leave_out_a_demo_only_person(self):
        body = self.get()
        self.assertEqual(self.ids(body), sorted([self.paying.pk, self.mixed.pk]))
        self.assertEqual((body["count"], self.facet(body, "show")["all"]), (2, 2))

    def test_the_demo_chip_counts_and_lists_everyone_holding_a_demo_seat(self):
        self.assertEqual(self.facet(self.get(), "show")["trial"], 2)
        shown = self.get(show="trial")
        self.assertEqual(self.ids(shown), sorted([self.demo.pk, self.mixed.pk]))
        self.assertEqual({r["id"]: r["is_demo_only"] for r in shown["results"]}, {self.demo.pk: True, self.mixed.pk: False})

    def test_the_demo_chip_count_follows_the_other_filters(self):
        body = self.get(group=str(self.room.pk))
        self.assertEqual((self.facet(body, "show")["trial"], self.facet(body, "show")["all"]), (2, 2))
        body = self.get(q="nobody-matches")
        self.assertEqual(self.facet(body, "show")["trial"], 0)

    def test_a_search_finds_a_demo_only_person_with_the_flag(self):
        body = self.get(q="dema")
        self.assertEqual(self.ids(body), [self.demo.pk])
        self.assertTrue(body["results"][0]["is_demo_only"])

    def test_the_chip_is_labelled_demo(self):
        show = next(f for f in self.get()["filters"] if f["key"] == "show")
        self.assertEqual({o["value"]: o["label"] for o in show["options"]}["trial"], "Demo")

    def test_a_paying_row_is_not_demo_only(self):
        rows = {r["id"]: r for r in self.get()["results"]}
        self.assertFalse(rows[self.paying.pk]["is_demo_only"])
