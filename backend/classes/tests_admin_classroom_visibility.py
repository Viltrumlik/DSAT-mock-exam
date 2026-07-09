"""super_admin / superuser see and can open EVERY classroom via /api/classes/ without
being a member (they oversee everything, incl. assigning midterms to any class). Regular
non-members stay strictly membership-scoped (fail-closed).
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership

User = get_user_model()


def _ids(resp):
    if resp.status_code != 200:
        return set()
    data = resp.json()
    items = data["results"] if isinstance(data, dict) and "results" in data else data
    return {c["id"] for c in items}


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class AdminClassroomVisibilityTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("acv_owner@t.com", "pw12345678")
        self.math = Classroom.objects.create(name="Algebra", subject=Classroom.SUBJECT_MATH, created_by=self.owner)
        self.eng = Classroom.objects.create(name="Essay", subject=Classroom.SUBJECT_ENGLISH, created_by=self.owner)
        for cls in (self.math, self.eng):
            ClassroomMembership.objects.create(classroom=cls, user=self.owner, role=ClassroomMembership.ROLE_OWNER)

        self.superadmin = User.objects.create_user("acv_admin@t.com", "pw12345678")
        if hasattr(self.superadmin, "role"):
            self.superadmin.role = "super_admin"
            self.superadmin.save(update_fields=["role"])
        self.superuser = User.objects.create_user("acv_su@t.com", "pw12345678")
        self.superuser.is_superuser = True
        self.superuser.save(update_fields=["is_superuser"])
        self.stranger = User.objects.create_user("acv_stranger@t.com", "pw12345678")  # member of neither

    def _c(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def test_super_admin_lists_every_classroom_without_membership(self):
        ids = _ids(self._c(self.superadmin).get("/api/classes/"))
        self.assertIn(self.math.id, ids)
        self.assertIn(self.eng.id, ids)

    def test_django_superuser_lists_every_classroom(self):
        ids = _ids(self._c(self.superuser).get("/api/classes/"))
        self.assertIn(self.math.id, ids)
        self.assertIn(self.eng.id, ids)

    def test_super_admin_can_open_any_classroom(self):
        self.assertEqual(self._c(self.superadmin).get(f"/api/classes/{self.math.id}/").status_code, 200)

    def test_non_member_still_scoped_out(self):
        ids = _ids(self._c(self.stranger).get("/api/classes/"))
        self.assertNotIn(self.math.id, ids)
        self.assertNotIn(self.eng.id, ids)
        self.assertNotEqual(self._c(self.stranger).get(f"/api/classes/{self.math.id}/").status_code, 200)
