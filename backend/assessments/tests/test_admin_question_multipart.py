"""
Regression: authoring a question via **multipart** (image attached) must behave
exactly like the JSON path.

The live defect: ``AdminAssessmentQuestionCreateView`` spread the request into a
plain dict (``data={**request.data, ...}``). On a multipart request ``request.data``
is a Django ``QueryDict``; spreading it wraps every value in a one-element list, so
the serializer rejected almost every field at once (``question_image`` →
"The submitted data was not a file", ``choices`` → "Not a valid string", …) → a
blanket 400 that blocked every create-with-image. JSON creates worked; PATCH
(which never spread) worked — so teachers could only add an image by editing after
a text-only create.

These tests lock in the fix: pass ``request.data`` through untouched, keep
``assessment_set``/``order`` server-owned, and validate strictly with precise
field errors.
"""
from __future__ import annotations

import io
import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentQuestion, AssessmentSet

User = get_user_model()

AUTHORING_HOST = "questions.mastersat.uz"
_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver", "admin.mastersat.uz", AUTHORING_HOST]


def _png_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 10, 10)).save(buf, "PNG")
    return buf.getvalue()


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class AdminQuestionMultipartCreateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.author = User.objects.create_user(
            email="qbauthor@example.com", password="x", role=acc_const.ROLE_TEST_ADMIN,
        )
        self.client.force_authenticate(user=self.author)
        self.aset = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="MP Set", created_by=self.author,
        )

    def _create_url(self):
        return f"/api/assessments/admin/sets/{self.aset.id}/questions/"

    def _mc_multipart(self, **overrides):
        """A valid multipart MC payload mirroring the builder's FormData branch."""
        data = {
            "prompt": "Repro question",
            "question_prompt": "",
            "question_type": "multiple_choice",
            "choices": json.dumps([{"id": "A", "text": "x"}, {"id": "B", "text": "y"}]),
            "correct_answer": json.dumps("A"),
            "grading_config": json.dumps({}),
            "points": "1",
            "is_active": "true",
            "explanation": "",
            "question_image": SimpleUploadedFile("q.png", _png_bytes(), content_type="image/png"),
        }
        data.update(overrides)
        return data

    # ── the core fix ─────────────────────────────────────────────────────────
    def test_multipart_create_with_image_succeeds(self):
        resp = self.client.post(
            self._create_url(), self._mc_multipart(), format="multipart", HTTP_HOST=AUTHORING_HOST,
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        q = AssessmentQuestion.objects.get(pk=resp.json()["id"])
        # JSON columns must be stored decoded, not as raw strings.
        self.assertIsInstance(q.choices, list)
        self.assertEqual([c["id"] for c in q.choices], ["A", "B"])
        self.assertEqual(q.correct_answer, "A")
        self.assertIsInstance(q.grading_config, dict)
        self.assertTrue(q.question_image.name, "image file should be stored")

    def test_multipart_matches_json_path(self):
        json_payload = {
            "prompt": "JSON q", "question_type": "multiple_choice",
            "choices": [{"id": "A", "text": "x"}, {"id": "B", "text": "y"}],
            "correct_answer": "B", "points": 1, "is_active": True,
        }
        r = self.client.post(self._create_url(), json_payload, format="json", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 201, r.content)
        q = AssessmentQuestion.objects.get(pk=r.json()["id"])
        self.assertEqual(q.correct_answer, "B")
        self.assertIsInstance(q.choices, list)

    # ── server-owned order/assessment_set ────────────────────────────────────
    def test_stale_client_order_is_ignored(self):
        # A pre-deploy builder tab still sends order; it must be ignored (server owns
        # it), never collide under UNIQUE(assessment_set, order), never 500.
        self.client.post(self._create_url(), self._mc_multipart(), format="multipart", HTTP_HOST=AUTHORING_HOST)
        data = self._mc_multipart(order="0", prompt="second")
        r = self.client.post(self._create_url(), data, format="multipart", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 201, r.content)
        orders = sorted(
            AssessmentQuestion.objects.filter(assessment_set=self.aset).values_list("order", flat=True)
        )
        self.assertEqual(orders, [0, 1])  # dense + unique, server-assigned

    def test_assessment_set_cannot_be_spoofed(self):
        other = AssessmentSet.objects.create(
            subject="english", category="X", title="Other", created_by=self.author,
        )
        data = self._mc_multipart(assessment_set=str(other.id))
        r = self.client.post(self._create_url(), data, format="multipart", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 201, r.content)
        q = AssessmentQuestion.objects.get(pk=r.json()["id"])
        self.assertEqual(q.assessment_set_id, self.aset.id)  # URL set wins, not the body

    # ── precise validation errors (so the builder can surface them) ──────────
    def test_invalid_choices_json_400_names_field(self):
        data = self._mc_multipart(choices="{not json")
        r = self.client.post(self._create_url(), data, format="multipart", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 400)
        self.assertIn("choices", r.json())

    def test_mc_correct_answer_not_in_choices_400(self):
        data = self._mc_multipart(correct_answer=json.dumps("Z"))
        r = self.client.post(self._create_url(), data, format="multipart", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 400)
        self.assertIn("correct_answer", r.json())

    def test_mc_without_choices_400(self):
        data = self._mc_multipart(choices=json.dumps([]))
        r = self.client.post(self._create_url(), data, format="multipart", HTTP_HOST=AUTHORING_HOST)
        self.assertEqual(r.status_code, 400)
        self.assertIn("choices", r.json())

    # ── reorder endpoint ─────────────────────────────────────────────────────
    def test_reorder_endpoint_dense_and_stable(self):
        ids = []
        for i in range(3):
            r = self.client.post(
                self._create_url(), self._mc_multipart(prompt=f"q{i}"),
                format="multipart", HTTP_HOST=AUTHORING_HOST,
            )
            ids.append(r.json()["id"])
        # Reverse the order via the atomic endpoint.
        r = self.client.post(
            f"/api/assessments/admin/sets/{self.aset.id}/questions/reorder/",
            {"ordered_ids": list(reversed(ids))}, format="json", HTTP_HOST=AUTHORING_HOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["ordered_ids"], list(reversed(ids)))
        by_order = list(
            AssessmentQuestion.objects.filter(assessment_set=self.aset)
            .order_by("order").values_list("id", flat=True)
        )
        self.assertEqual(by_order, list(reversed(ids)))

    def test_reorder_rejects_non_list(self):
        r = self.client.post(
            f"/api/assessments/admin/sets/{self.aset.id}/questions/reorder/",
            {"ordered_ids": "nope"}, format="json", HTTP_HOST=AUTHORING_HOST,
        )
        self.assertEqual(r.status_code, 400)
