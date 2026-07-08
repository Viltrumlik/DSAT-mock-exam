"""HTTP lifecycle test for the mock attempt runner endpoints.

    python manage.py test mocks.tests_api --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from mocks.tests_scoring import make_mock

User = get_user_model()


class MockApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, self.mods = make_mock()  # published

    def _answers(self, module, letter="a"):
        return {str(q.id): letter for q in module.questions.all()}

    def test_full_mock_flow(self):
        e1, e2, m1, m2 = self.mods
        r = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        aid = r.json()["id"]
        self.assertEqual(r.json()["current_state"], "NOT_STARTED")
        self.assertEqual(r.json()["practice_test_details"]["mock_kind"], "MOCK")

        r = self.c.post(f"/api/mocks/attempts/{aid}/start/", {}, format="json")
        self.assertEqual(r.json()["current_state"], "MODULE_1_ACTIVE")
        self.assertEqual(r.json()["practice_test_details"]["subject"], "READING_WRITING")
        self.assertEqual(len(r.json()["current_module_details"]["questions"]), 4)

        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": self._answers(e1)}, format="json")
        self.assertEqual(r.json()["current_state"], "MODULE_2_ACTIVE")

        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": self._answers(e2)}, format="json")
        body = r.json()
        self.assertTrue(body["is_on_break"])
        self.assertIsNotNone(body["break_remaining_seconds"])

        r = self.c.post(f"/api/mocks/attempts/{aid}/end_break/", {}, format="json")
        self.assertEqual(r.json()["current_state"], "MODULE_1_ACTIVE")
        self.assertEqual(r.json()["practice_test_details"]["subject"], "MATH")

        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": self._answers(m1)}, format="json")
        self.assertEqual(r.json()["current_state"], "MODULE_2_ACTIVE")

        r = self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", {"answers": self._answers(m2)}, format="json")
        self.assertEqual(r.json()["current_state"], "COMPLETED")

        r = self.c.get(f"/api/mocks/attempts/{aid}/results/")
        self.assertEqual(r.status_code, 200, r.content)
        res = r.json()
        self.assertEqual(res["english_score"], 800)
        self.assertEqual(res["math_score"], 800)
        self.assertEqual(res["total_score"], 1600)
        self.assertEqual(res["score_ceiling"], 1600)
