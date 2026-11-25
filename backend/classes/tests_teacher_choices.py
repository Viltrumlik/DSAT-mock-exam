"""The teachers and support teachers an admin can pick in "Add classroom" (cutover walkthrough, 25 Nov 2026).

The picker used to read the whole user directory, which an admin could be refused; it now has its own list,
gated by the permission the create endpoint needs, and it carries nothing but who can teach."""

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from access.models import Permission, UserPermission
from users.models import User

URL = "/api/classes/teacher-choices/"
HOST = "admin.mastersat.uz"


def make(username, role, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class TeacherChoicesTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("vali", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.support = make("ta", C.ROLE_SUPPORT_TEACHER, subject="both", first_name="Sue", last_name="Port")
        self.student = make("aziz", C.ROLE_STUDENT, first_name="Aziz")
        self.gone = make("gone", C.ROLE_TEACHER, subject="math", is_active=False)

    def get(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api.get(URL, HTTP_HOST=HOST)

    def test_an_admin_who_may_create_groups_sees_the_teachers_and_support_teachers(self):
        body = self.get(self.admin).json()
        self.assertEqual({row["id"] for row in body["teachers"]}, {self.teacher.pk})
        self.assertEqual({row["id"] for row in body["support_teachers"]}, {self.support.pk})
        self.assertEqual(body["teachers"][0]["name"], "Vali Aliyev")
        self.assertEqual(body["support_teachers"][0]["subject"], "both")

    def test_it_carries_nothing_but_who_can_teach(self):
        row = self.get(self.admin).json()["teachers"][0]
        self.assertEqual(set(row), {"id", "name", "email", "subject"})

    def test_an_admin_with_create_classroom_taken_away_gets_nothing(self):
        permission, _ = Permission.objects.get_or_create(codename=C.PERM_CREATE_CLASSROOM, defaults={"name": "x"})
        UserPermission.objects.create(user=self.admin, permission=permission, granted=False)
        self.assertEqual(self.get(self.admin).status_code, 403)

    def test_roles_without_it_get_nothing(self):
        for user in (make("acc", C.ROLE_ACCOUNTANT), self.teacher, self.student):
            self.assertEqual(self.get(user).status_code, 403, user.role)

    def test_an_owner_sees_them_too(self):
        self.assertEqual(self.get(make("owner", C.ROLE_SUPER_ADMIN)).status_code, 200)
