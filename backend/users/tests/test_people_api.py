"""The /ops Students, Public users and Staff lists (plan 2026-10-14): three separate sections, each a
Django-admin changelist — search, filters with counts, ordering and server-side pages."""

from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink, LinkStatus
from users.models import User

URL = "/api/users/admin/people/"
HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, email=None, **extra):
    return User.objects.create_user(email, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class PeopleListTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", created_by=self.teacher, teacher=self.teacher
        )
        self.old_room = Classroom.objects.create(
            name="Old class", subject="MATH", created_by=self.teacher, teacher=self.teacher, is_active=False
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov", phone_number="998901234567")
        self.malika = make("malika", first_name="Malika", last_name="Karimova")
        for u in (self.aziz, self.malika):
            ClassroomMembership.objects.create(classroom=self.room, user=u, role="STUDENT")
        ClassroomMembership.objects.create(classroom=self.old_room, user=self.malika, role="STUDENT")
        LcupStudentLink.objects.create(
            lcup_student_id=1, name="Tursunov Aziz", user=self.aziz, status=LinkStatus.AUTO, balance=Decimal("-250000")
        )
        User.objects.filter(pk=self.malika.pk).update(is_frozen=True, frozen_reason="")
        self.pub = make("pub", C.ROLE_PUBLIC_STUDENT, first_name="Public", last_name="Person", email="p@example.com")

    def get(self, user=None, **params):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(URL, params, HTTP_HOST=HOST)

    def ids(self, body):
        return [r["id"] for r in body["results"]]

    def facet(self, body, key):
        f = next(f for f in body["filters"] if f["key"] == key)
        return {o["value"]: o["count"] for o in f["options"]}

    def test_each_section_lists_only_its_own_people(self):
        self.assertEqual(sorted(self.ids(self.get(section="students").json())), sorted([self.aziz.pk, self.malika.pk]))
        self.assertEqual(self.ids(self.get(section="public").json()), [self.pub.pk])
        self.assertEqual(sorted(self.ids(self.get(section="staff").json())), sorted([self.admin.pk, self.teacher.pk]))

    def test_a_student_row_carries_groups_lcup_and_status(self):
        rows = {r["id"]: r for r in self.get(section="students").json()["results"]}
        self.assertEqual(rows[self.aziz.pk]["groups"], [{"id": self.room.pk, "name": "Junior G21 Math"}])
        self.assertEqual(rows[self.aziz.pk]["lcup"], {"linked": True, "balance": -250000})
        # The archived class is not a group.
        self.assertEqual(rows[self.malika.pk]["groups"], [{"id": self.room.pk, "name": "Junior G21 Math"}])
        self.assertEqual((rows[self.aziz.pk]["status"], rows[self.malika.pk]["status"]), ("centre", "frozen_admin"))
        # The editor saves first and last name apart, and a delete warns with the work it would take.
        self.assertEqual((rows[self.aziz.pk]["first_name"], rows[self.aziz.pk]["last_name"]), ("Aziz", "Tursunov"))
        self.assertEqual(rows[self.aziz.pk]["attempt_count"], 0)

    def test_search_reads_names_usernames_and_phones(self):
        self.assertEqual(self.ids(self.get(section="students", q="tursunov").json()), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(section="students", q="90123").json()), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(section="students", q="Malika Karimova").json()), [self.malika.pk])

    def test_filters_narrow_and_count_every_choice(self):
        body = self.get(section="students", status="frozen_admin").json()
        self.assertEqual(self.ids(body), [self.malika.pk])
        # A facet counts with the OTHER filters applied, not its own: both choices stay visible.
        self.assertEqual(self.facet(body, "status"), {"active": 1, "frozen_debt": 0, "frozen_admin": 1})
        self.assertEqual(self.facet(body, "lcup"), {"linked": 0, "unlinked": 1})
        self.assertEqual(self.ids(self.get(section="students", debt="owes").json()), [self.aziz.pk])
        self.assertEqual(self.ids(self.get(section="students", lcup="unlinked").json()), [self.malika.pk])
        in_room = self.get(section="students", group=str(self.room.pk)).json()
        self.assertEqual(sorted(self.ids(in_room)), sorted([self.aziz.pk, self.malika.pk]))
        self.assertEqual(self.facet(self.get(section="students").json(), "teacher"), {str(self.teacher.pk): 2})

    def test_same_name_accounts_can_be_listed_together(self):
        twin = make("aziz2", first_name="aziz", last_name="TURSUNOV")
        ClassroomMembership.objects.create(classroom=self.room, user=twin, role="STUDENT")
        body = self.get(section="students", dupes="yes").json()
        self.assertEqual(sorted(self.ids(body)), sorted([self.aziz.pk, twin.pk]))
        self.assertEqual(self.facet(self.get(section="students").json(), "dupes"), {"yes": 2})
        # Short enough for the filter sidebar, which cut the longer label off.
        dupes = next(f for f in self.get(section="students").json()["filters"] if f["key"] == "dupes")
        self.assertEqual([o["label"] for o in dupes["options"]], ["Same name"])

    def test_never_signed_in_means_no_session_at_all(self):
        from users.models import RefreshSession

        RefreshSession.objects.create(user=self.aziz, refresh_jti="x")
        self.assertEqual(self.ids(self.get(section="students", signin="never").json()), [self.malika.pk])
        self.assertEqual(self.facet(self.get(section="students").json(), "signin"), {"never": 1, "yes": 1})
        self.assertEqual(self.ids(self.get(section="public", signin="never").json()), [self.pub.pk])

    def test_an_unknown_choice_is_ignored_not_an_error(self):
        self.assertEqual(len(self.get(section="students", status="nope").json()["results"]), 2)

    def test_ordering_and_pages(self):
        for i in range(30):
            make(f"p{i:02d}", C.ROLE_PUBLIC_STUDENT)
        body = self.get(section="public", page_size=25, page=2, o="name").json()
        self.assertEqual((body["count"], body["pages"], body["page"], len(body["results"])), (31, 2, 2, 6))
        self.assertEqual(self.get(section="public", page=99, page_size=25).json()["page"], 2)  # clamped
        self.assertEqual(self.get(section="students", o="debt").json()["results"][0]["id"], self.aziz.pk)

    def test_a_scoped_directory_is_distinct_and_still_sorts_by_debt(self):
        # A subject-scoped directory comes back DISTINCT (users.views.manageable_users_queryset);
        # ordering by a related column must still work there (Postgres rejects a bad pairing).
        from unittest import mock

        scoped = User.objects.filter(class_memberships__classroom=self.room).distinct()
        with mock.patch("users.views_people.manageable_users_queryset", return_value=scoped):
            body = self.get(section="students", o="debt").json()
        self.assertEqual(self.ids(body)[0], self.aziz.pk)
        self.assertEqual(body["count"], 2)

    def test_a_section_is_required_and_staff_only(self):
        self.assertEqual(self.get(section="everyone").status_code, 400)
        self.assertEqual(self.get(self.aziz, section="students").status_code, 403)
