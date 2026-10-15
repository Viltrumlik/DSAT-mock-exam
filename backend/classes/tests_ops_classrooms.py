"""/ops Classrooms as a Django-admin changelist and change form (plan 2026-10-15-ops-detail-pages)."""

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import GroupLinkStatus, LcupGroupLink
from users.models import User

URL = "/api/classes/admin/classrooms/"
HOST = "admin.mastersat.uz"
STUDENT, TA = ClassroomMembership.ROLE_STUDENT, ClassroomMembership.ROLE_TA


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(LCUP_ENABLED=True, ALLOWED_HOSTS=["testserver", HOST])
class ClassroomFixture(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("vali", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.other = make("olim", C.ROLE_TEACHER, subject="english", first_name="Olim", last_name="Karimov")
        self.paired = Classroom.objects.create(
            name="G21 Math", subject="MATH", lesson_days="ODD", created_by=self.teacher, teacher=self.teacher,
            room_number="205",
        )
        self.unpaired = Classroom.objects.create(
            name="G7 Math", subject="MATH", lesson_days="EVEN", created_by=self.teacher, teacher=self.teacher,
            room_number="301", level="junior",
        )
        self.archived = Classroom.objects.create(
            name="Old English", subject="ENGLISH", lesson_days="ODD", created_by=self.other, is_active=False,
        )
        LcupGroupLink.objects.create(
            lcup_group_id=10, name="G21 Math lc-up", classroom=self.paired, status=GroupLinkStatus.CONFIRMED
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov")
        self.malika = make("malika", first_name="Malika", last_name="Karimova")
        self.gone = make("gone", first_name="Gone", last_name="Student")
        self.solo = make("solo", first_name="Solo", last_name="Learner")
        self.ta = make("ta", C.ROLE_SUPPORT_TEACHER, subject="math")
        for u in (self.aziz, self.malika):
            ClassroomMembership.objects.create(classroom=self.paired, user=u, role=STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.paired, user=self.gone, role=STUDENT, status=ClassroomMembership.STATUS_REMOVED
        )
        ClassroomMembership.objects.create(classroom=self.paired, user=self.ta, role=TA)
        ClassroomMembership.objects.create(classroom=self.unpaired, user=self.solo, role=STUDENT)

    def client_for(self, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api

    def get(self, url=URL, user=None, **params):
        return self.client_for(user).get(url, params, HTTP_HOST=HOST)


class ClassroomChangeListTests(ClassroomFixture):
    def ids(self, body):
        return [r["id"] for r in body["results"]]

    def facet(self, body, key):
        f = next(f for f in body["filters"] if f["key"] == key)
        return {o["value"]: o["count"] for o in f["options"]}

    def test_every_class_newest_first(self):
        r = self.get()
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(self.ids(body), [self.archived.pk, self.unpaired.pk, self.paired.pk])
        self.assertEqual((body["count"], body["page"], body["pages"], body["ordering"]), (3, 1, 1, "-created"))

    def test_a_teacher_is_refused(self):
        self.assertEqual(self.get(user=self.teacher).status_code, 403)

    def test_the_lcup_filter_and_its_counts(self):
        body = self.get(lcup="paired").json()
        self.assertEqual(self.ids(body), [self.paired.pk])
        self.assertEqual(self.facet(body, "lcup"), {"paired": 1, "unpaired": 2})
        self.assertEqual(self.ids(self.get(lcup="unpaired").json()), [self.archived.pk, self.unpaired.pk])

    def test_status_archived(self):
        body = self.get(status="archived").json()
        self.assertEqual(self.ids(body), [self.archived.pk])
        self.assertEqual(self.facet(body, "status"), {"active": 2, "archived": 1})

    def test_search_covers_room_and_teacher(self):
        self.assertEqual(self.ids(self.get(q="301").json()), [self.unpaired.pk])
        self.assertEqual(self.ids(self.get(q="aliyev").json()), [self.unpaired.pk, self.paired.pk])

    def test_ordering_by_students_counts_active_student_seats_only(self):
        body = self.get(o="-students").json()
        self.assertEqual(self.ids(body), [self.paired.pk, self.unpaired.pk, self.archived.pk])
        self.assertEqual([r["students"] for r in body["results"]], [2, 1, 0])

    def test_a_page_past_the_end_clamps_to_the_last(self):
        body = self.get(page_size=25, page=9).json()
        self.assertEqual((body["page"], body["page_size"], body["pages"]), (1, 25, 1))

    def test_the_row_shape(self):
        rows = {r["id"]: r for r in self.get().json()["results"]}
        self.assertEqual(rows[self.paired.pk]["teacher"], {"id": self.teacher.pk, "name": "Vali Aliyev"})
        self.assertIs(rows[self.paired.pk]["lcup"], True)
        self.assertIs(rows[self.unpaired.pk]["lcup"], False)
        self.assertIsNone(rows[self.archived.pk]["teacher"])
        self.assertEqual(rows[self.archived.pk]["branch"], "")
        self.assertEqual(
            set(rows[self.paired.pk]),
            {"id", "name", "subject", "level", "teacher", "students", "lesson_days", "lesson_time", "room_number",
             "branch", "lcup", "is_active", "created_at"},
        )

    def test_the_other_facets(self):
        body = self.get(subject="MATH").json()
        self.assertEqual(self.ids(body), [self.unpaired.pk, self.paired.pk])
        self.assertEqual(self.facet(body, "subject"), {"ENGLISH": 1, "MATH": 2})
        self.assertEqual(self.facet(body, "level"), {"junior": 1, "untagged": 1})
        self.assertEqual(self.facet(body, "teacher"), {str(self.teacher.pk): 2})
        self.assertEqual(self.facet(body, "days"), {"EVEN": 1, "ODD": 1})
        self.assertEqual(self.ids(self.get(level="untagged").json()), [self.archived.pk, self.paired.pk])
        self.assertEqual(self.ids(self.get(teacher=self.teacher.pk, days="ODD").json()), [self.paired.pk])
