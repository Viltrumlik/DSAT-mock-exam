"""Admin/builder tests: create midterm -> add questions -> publish; permissions + cap.

    python manage.py test midterms.tests_admin --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from midterms.models import Midterm

User = get_user_model()
BASE = "/api/midterms/admin/midterms/"


class AdminBuilderTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create(username="admin", email="a@x.io", is_staff=True, is_superuser=True)
        self.c = APIClient()
        self.c.force_authenticate(self.staff)

    def test_create_add_question_publish(self):
        r = self.c.post(
            BASE,
            {"title": "Diag", "subject": "READING_WRITING", "scoring_scale": "SCALE_100", "duration_minutes": 30, "question_limit": 30},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        mid = r.json()["id"]
        self.assertFalse(r.json()["publish_ready"])
        self.assertEqual(r.json()["question_count"], 0)
        self.assertIsNotNone(Midterm.objects.get(pk=mid).question_module_id)  # module provisioned

        # Publish blocked with no questions.
        r = self.c.post(f"{BASE}{mid}/publish/", {}, format="json")
        self.assertEqual(r.status_code, 400, r.content)

        # Add a stub question, then fill it in.
        r = self.c.post(f"{BASE}{mid}/questions/", {}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        qid = r.json()["id"]
        r = self.c.patch(
            f"{BASE}{mid}/questions/{qid}/",
            {"question_text": "1+1?", "option_a": "2", "option_b": "3", "option_c": "4", "option_d": "5", "correct_answer": "a"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)

        r = self.c.get(f"{BASE}{mid}/questions/")
        self.assertEqual(len(r.json()), 1)

        r = self.c.get(f"{BASE}{mid}/")
        self.assertTrue(r.json()["publish_ready"])
        self.assertEqual(r.json()["question_count"], 1)

        r = self.c.post(f"{BASE}{mid}/publish/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["is_published"])

    def test_question_limit_enforced(self):
        r = self.c.post(
            BASE,
            {"title": "L", "subject": "MATH", "scoring_scale": "SCALE_100", "duration_minutes": 30, "question_limit": 2},
            format="json",
        )
        mid = r.json()["id"]
        for _ in range(2):
            self.assertEqual(self.c.post(f"{BASE}{mid}/questions/", {}, format="json").status_code, 201)
        capped = self.c.post(f"{BASE}{mid}/questions/", {}, format="json")
        self.assertEqual(capped.status_code, 400, capped.content)

    def test_student_cannot_author(self):
        student = User.objects.create(username="stu", email="stu@x.io")
        c = APIClient()
        c.force_authenticate(student)
        r = c.post(BASE, {"title": "x", "subject": "MATH", "duration_minutes": 30}, format="json")
        self.assertIn(r.status_code, (401, 403), r.content)

    def test_midterm_questions_exempt_from_sat_type_rules(self):
        # A READING_WRITING midterm accepts a MATH-typed question (SAT type enforcement is
        # skipped for midterm-owned modules).
        r = self.c.post(
            BASE, {"title": "E", "subject": "READING_WRITING", "scoring_scale": "SCALE_800", "duration_minutes": 20}, format="json"
        )
        mid = r.json()["id"]
        r = self.c.post(f"{BASE}{mid}/questions/", {}, format="json")
        qid = r.json()["id"]
        r = self.c.patch(
            f"{BASE}{mid}/questions/{qid}/",
            {"question_type": "MATH", "question_text": "2x?", "is_math_input": True, "correct_answer": "4"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
