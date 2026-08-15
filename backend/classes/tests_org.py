"""Regions, branches, and putting a classroom in one.

These endpoints exist because the branch leaderboard shipped inert: the derivation was right,
but nothing could create a branch or assign a classroom to it outside Django admin, so every
student resolved to no branch and the "My Branch" tab hid itself.

The load-bearing test is the last one — assign a classroom, and a student's branch resolves
without anything being written to the student.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_org import Branch, Region, branch_for_student

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class OrgApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = _u("org_admin@t.com", role=C.ROLE_ADMIN)
        self.teacher = _u("org_teacher@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = _u("org_student@t.com")
        self.classroom = Classroom.objects.create(
            name="Math A", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )

    # ── permissions ──────────────────────────────────────────────────────────

    def test_a_student_cannot_see_or_shape_the_org(self):
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get("/api/classes/org/regions/").status_code, 403)
        self.assertEqual(self.client.get("/api/classes/org/branches/").status_code, 403)

    def test_a_teacher_cannot_move_their_classroom_to_another_branch(self):
        """That would move their students onto a different leaderboard — a school-level call."""
        region = Region.objects.create(name="Tashkent")
        branch = Branch.objects.create(region=region, name="Chilonzor")
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            f"/api/classes/{self.classroom.pk}/branch/", {"branch": branch.pk}, format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.classroom.refresh_from_db()
        self.assertIsNone(self.classroom.branch)

    # ── regions and branches ─────────────────────────────────────────────────

    def test_an_admin_creates_a_region_then_a_branch_in_it(self):
        self.client.force_authenticate(self.admin)

        r = self.client.post("/api/classes/org/regions/", {"name": "Tashkent"}, format="json")
        self.assertEqual(r.status_code, 201)

        b = self.client.post(
            "/api/classes/org/branches/",
            {"name": "Chilonzor", "region": r.json()["id"]}, format="json",
        )
        self.assertEqual(b.status_code, 201)
        self.assertEqual(b.json()["region_name"], "Tashkent")

    def test_a_case_insensitive_duplicate_region_is_refused(self):
        """Two regions differing only by case would split a leaderboard in half, and nobody
        would notice for a term."""
        Region.objects.create(name="Tashkent")
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/classes/org/regions/", {"name": "tashkent"}, format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("already exists", response.json()["detail"])

    def test_a_branch_needs_a_region(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/classes/org/branches/", {"name": "Orphan"}, format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_the_same_branch_name_is_allowed_in_a_different_region(self):
        north = Region.objects.create(name="Tashkent")
        south = Region.objects.create(name="Samarkand")
        Branch.objects.create(region=north, name="Markaz")
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/classes/org/branches/", {"name": "Markaz", "region": south.pk}, format="json",
        )

        self.assertEqual(response.status_code, 201)

    def test_the_branch_list_reports_how_many_classrooms_sit_there(self):
        region = Region.objects.create(name="Tashkent")
        branch = Branch.objects.create(region=region, name="Chilonzor")
        self.classroom.branch = branch
        self.classroom.save()
        self.client.force_authenticate(self.admin)

        rows = self.client.get("/api/classes/org/branches/").json()["branches"]

        self.assertEqual(rows[0]["classroom_count"], 1)

    # ── the point of all of it ───────────────────────────────────────────────

    def test_assigning_a_classroom_makes_its_students_branch_resolve(self):
        """Nothing is written to the student — their branch is derived from the classroom."""
        region = Region.objects.create(name="Tashkent")
        branch = Branch.objects.create(region=region, name="Chilonzor")
        self.assertIsNone(branch_for_student(self.student))
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/classes/{self.classroom.pk}/branch/", {"branch": branch.pk}, format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["students_affected"], 1)
        self.assertEqual(branch_for_student(self.student), branch)

    def test_clearing_a_branch_is_allowed_and_resolves_to_none(self):
        """A classroom that moved out and has not moved in yet is a real state — leaving it
        pointed at the old branch would keep its students on a board they left."""
        region = Region.objects.create(name="Tashkent")
        branch = Branch.objects.create(region=region, name="Chilonzor")
        self.classroom.branch = branch
        self.classroom.save()
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/classes/{self.classroom.pk}/branch/", {"branch": None}, format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(branch_for_student(self.student))

    def test_an_unknown_branch_is_refused(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/classes/{self.classroom.pk}/branch/", {"branch": 99999}, format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.classroom.refresh_from_db()
        self.assertIsNone(self.classroom.branch)

    def test_the_classroom_payload_carries_the_branch_names(self):
        """The ops page reads these rather than joining them itself."""
        region = Region.objects.create(name="Tashkent")
        branch = Branch.objects.create(region=region, name="Chilonzor")
        self.classroom.branch = branch
        self.classroom.save()
        self.client.force_authenticate(self.admin)

        from classes.serializers import ClassroomSerializer

        data = ClassroomSerializer(self.classroom).data

        self.assertEqual(data["branch"], branch.pk)
        self.assertEqual(data["branch_name"], "Chilonzor")
        self.assertEqual(data["region_name"], "Tashkent")
