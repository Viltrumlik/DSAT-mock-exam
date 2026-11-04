from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from users.models import SecurityAuditEvent
from users.people_detail import person_core

User = get_user_model()
HOST = "admin.mastersat.uz"


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class ParentDetailsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.kid = User.objects.create_user(
            None, password=None, username="kid", role="student", phone_number="998901112233",
            parent_name="Karim", parent_phone="998907777777",
        )
        self.room = Classroom.objects.create(name="G1", subject="MATH", lesson_days="ODD", teacher=self.teacher, created_by=self.teacher)
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.create(classroom=self.room, user=self.kid, role=ClassroomMembership.ROLE_STUDENT)

    def client_for(self, user):
        api = APIClient()
        if user:
            api.force_authenticate(user)
        return api

    def core(self, viewer):
        return self.client_for(viewer).get(f"/api/users/admin/people/{self.kid.pk}/", HTTP_HOST=HOST)

    def patch(self, viewer, data, target=None):
        return self.client_for(viewer).patch(
            f"/api/users/admin/people/{(target or self.kid).pk}/parent/", data, format="json", HTTP_HOST=HOST
        )

    def test_an_admin_reads_them_on_the_person_page(self):
        self.assertEqual(self.core(self.admin).json()["parent"], {"name": "Karim", "phone": "998907777777"})

    def test_a_super_admin_reads_them_too(self):
        boss = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        self.assertEqual(self.core(boss).json()["parent"]["name"], "Karim")

    def test_a_teacher_is_not_let_onto_the_page(self):
        response = self.client_for(self.teacher).get(f"/api/users/admin/people/{self.kid.pk}/")
        self.assertEqual(response.status_code, 403)

    def test_the_page_itself_gives_them_to_an_admin_alone(self):
        self.assertIsNone(person_core(self.kid, SimpleNamespace(user=self.teacher))["parent"])
        self.assertIsNone(person_core(self.kid)["parent"])

    def test_an_admin_edits_them(self):
        response = self.patch(self.admin, {"parent_name": " Salima ", "parent_phone": "90 123 45 67"})
        self.assertEqual(response.status_code, 200, response.content)
        self.kid.refresh_from_db()
        self.assertEqual((self.kid.parent_name, self.kid.parent_phone), ("Salima", "998901234567"))

    def test_they_can_be_cleared(self):
        self.patch(self.admin, {"parent_name": "", "parent_phone": ""})
        self.kid.refresh_from_db()
        self.assertEqual((self.kid.parent_name, self.kid.parent_phone), ("", ""))

    def test_a_bad_number_is_refused_in_words(self):
        response = self.patch(self.admin, {"parent_phone": "call mum"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Parent's phone", response.json()["detail"])

    def test_the_change_is_logged_without_the_values(self):
        self.patch(self.admin, {"parent_name": "Salima"})
        event = SecurityAuditEvent.objects.get(user=self.kid, event_type="admin_user_update")
        self.assertEqual(list(event.detail["changes"]), ["parent_name"])
        self.assertNotIn("Salima", str(event.detail))
        self.assertEqual(event.detail["actor_id"], self.admin.pk)

    def test_a_staff_account_has_no_parent(self):
        self.assertEqual(self.patch(self.admin, {"parent_name": "X"}, target=self.teacher).status_code, 400)

    def test_nobody_else_edits_them(self):
        self.assertEqual(self.patch(self.teacher, {"parent_name": "X"}).status_code, 403)
        self.assertEqual(self.patch(self.kid, {"parent_name": "X"}).status_code, 403)
        self.assertIn(self.patch(None, {"parent_name": "X"}).status_code, (401, 403))
        self.kid.refresh_from_db()
        self.assertEqual(self.kid.parent_name, "Karim")

    def assert_silent(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("parent_name", str(response.content))
        self.assertNotIn("parent_phone", str(response.content))
        self.assertNotIn("Karim", str(response.content))
        self.assertNotIn("998907777777", str(response.content))

    def test_no_student_or_teacher_serializer_gives_them_out(self):
        self.assert_silent(self.client_for(self.kid).get("/api/users/me/"))
        self.assert_silent(self.client_for(self.teacher).get(f"/api/classes/{self.room.pk}/people/"))
        self.assert_silent(self.client_for(self.teacher).get(f"/api/classes/{self.room.pk}/members/"))

    def test_the_user_form_neither_shows_nor_writes_them(self):
        api = self.client_for(self.admin)
        response = api.patch(
            f"/api/users/{self.kid.pk}/update/", {"parent_name": "Hacked", "first_name": "Ali"}, format="json", HTTP_HOST=HOST
        )
        self.assert_silent(response)
        self.kid.refresh_from_db()
        self.assertEqual(self.kid.parent_name, "Karim")

    def test_the_people_list_does_not_give_them_out(self):
        response = self.client_for(self.admin).get("/api/users/admin/people/", {"section": "students"}, HTTP_HOST=HOST)
        self.assert_silent(response)
