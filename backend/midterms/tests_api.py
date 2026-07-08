"""HTTP lifecycle tests for the midterm attempt runner endpoints.

    python manage.py test midterms.tests_api --settings=config.settings_test_nomigrations
"""

import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt

User = get_user_model()


def make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a"):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
    mt = Midterm.objects.create(
        title="Unit 1 Midterm",
        subject=Midterm.READING_WRITING,
        scoring_scale=scale,
        duration_minutes=30,
        question_module=module,
        is_published=True,
    )
    for i in range(n):
        Question.objects.create(
            module=module, question_type="READING", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers=correct, is_math_input=False, score=10, order=i,
        )
    return mt


def grant(user, midterm, classroom=None):
    return ResourceAccessGrant.objects.create(
        user=user,
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type="midterm",
        resource_id=midterm.id,
        status=ResourceAccessGrant.STATUS_ACTIVE,
        classroom=classroom,
    )


class MidtermApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="stud", email="stud@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_no_access_is_403(self):
        mt = make_published_midterm()
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.json()["error"], "no_access")

    def test_full_lifecycle_and_masking(self):
        mt = make_published_midterm(scale=Midterm.SCALE_800, n=4, correct="a")
        grant(self.user, mt)
        qids = [str(q.id) for q in mt.questions()]

        # create -> holds NOT_STARTED
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        aid = data["id"]
        self.assertEqual(data["current_state"], "NOT_STARTED")
        self.assertEqual(data["practice_test_details"]["mock_kind"], "MIDTERM")
        self.assertIsNone(data["score"])
        # No answer key anywhere in the payload
        self.assertNotIn("correct_answers", json.dumps(data))

        # start -> MODULE_1_ACTIVE with questions + timer
        r = self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual(d["current_state"], "MODULE_1_ACTIVE")
        self.assertEqual(d["current_module_details"]["module_order"], 1)
        self.assertEqual(len(d["current_module_details"]["questions"]), 4)
        self.assertEqual(d["module_duration_seconds"], 30 * 60)
        self.assertTrue(d["remaining_seconds"] <= 30 * 60)
        self.assertFalse(d["is_paused"])
        self.assertNotIn("correct_answers", json.dumps(d))

        # autosave partial
        r = self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {qids[0]: "a"}, "flagged": [int(qids[1])]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_module_saved_answers"], {qids[0]: "a"})

        # submit all correct -> inline score -> COMPLETED
        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {q: "a" for q in qids}},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_state"], "COMPLETED")

        # review -> score-only, released (standalone), 800 for perfect
        r = self.client.get(f"/api/midterms/attempts/{aid}/review/")
        self.assertEqual(r.status_code, 200, r.content)
        rev = r.json()
        self.assertTrue(rev["score_only"])
        self.assertTrue(rev["released"])
        self.assertEqual(rev["total_score"], 800)
        self.assertNotIn("questions", rev)
        self.assertNotIn("correct_answers", json.dumps(rev))

        # no-retake
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.json()["error"], "midterm_completed")

    def test_start_idempotency_replay(self):
        mt = make_published_midterm()
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        aid = r.json()["id"]
        h = {"HTTP_IDEMPOTENCY_KEY": "start-key-1"}
        r1 = self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json", **h)
        r2 = self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json", **h)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.json()["version_number"], r2.json()["version_number"])
