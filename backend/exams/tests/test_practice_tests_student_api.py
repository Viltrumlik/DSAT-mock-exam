from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


def _rows(body):
    return body["results"] if isinstance(body, dict) else body


class PracticeTestStudentApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(email="pts_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.client.force_authenticate(self.student)

    def _section(self, *, practice, access=PracticeTest.ACCESS_OPEN, published=True, number=None):
        pt = PracticeTest.objects.create(
            subject="MATH", title="S", is_practice_test=practice, practice_access=access,
            is_published=published, practice_number=number,
        )
        seed_mc_questions_for_practice_test(pt)
        return pt

    def _ids(self, url):
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200, r.content)
        return {row["id"] for row in _rows(r.json())}

    def test_default_list_is_past_papers_only(self):
        pp = self._section(practice=False)
        pp.assigned_users.add(self.student)
        pt = self._section(practice=True, number=1)
        self.assertEqual(self._ids("/api/exams/"), {pp.id})
        self.assertEqual(self._ids("/api/exams/?kind=practice_test"), {pt.id})

    def test_practice_rows_carry_the_new_fields(self):
        self._section(practice=True, number=3)
        row = _rows(self.client.get("/api/exams/?kind=practice_test").json())[0]
        self.assertEqual(row["practice_number"], 3)
        self.assertTrue(row["is_practice_test"])
        self.assertEqual(row["practice_access"], "open")
        self.assertEqual(row["practice_level"], "")

    def test_hidden_practice_test_is_404_on_detail_and_on_start(self):
        hidden = self._section(practice=True, access=PracticeTest.ACCESS_HOMEWORK_ONLY)
        self.assertEqual(self.client.get(f"/api/exams/{hidden.id}/").status_code, 404)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": hidden.id}, format="json").status_code, 404)

    def test_visible_practice_test_can_be_opened_and_started(self):
        pt = self._section(practice=True, number=1)
        self.assertEqual(self.client.get(f"/api/exams/{pt.id}/").status_code, 200)
        r = self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_given_homework_only_test_can_be_started(self):
        pt = self._section(practice=True, access=PracticeTest.ACCESS_HOMEWORK_ONLY)
        pt.assigned_users.add(self.student)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json").status_code, 201)

    def test_unassigned_past_paper_still_cannot_be_started(self):
        pp = self._section(practice=False)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": pp.id}, format="json").status_code, 404)
