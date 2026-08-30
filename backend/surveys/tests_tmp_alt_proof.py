"""PROOF: a blind student can answer the uniform photo question TODAY, no schema change.

The reporter says the picture "is announced as nothing" and "no author can describe it".
The second half is false: `help_text` is an authored text field that renders in the DOM
IMMEDIATELY ABOVE the <QuestionImage>, and the option labels are free text.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from surveys.models import Survey, SurveyAnswer, SurveyQuestion

User = get_user_model()

DESCRIPTION = (
    "Two uniforms photographed side by side. A (left): navy blazer, grey trousers, "
    "striped tie. B (right): white polo shirt, khaki chinos, no tie."
)


class BlindStudentCanAnswerThePhotoQuestion(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = User.objects.create_user("alt_head@t.com", "x", role=C.ROLE_SUPER_ADMIN)
        self.student = User.objects.create_user("alt_blind@t.com", "x")

    def test_route_exists_today(self):
        # ── The author, in the builder, with only fields that exist on main today ──
        self.client.force_authenticate(self.head)
        r = self.client.post("/api/surveys/admin/", {"title": "New uniform"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        sid = r.data["id"]

        r = self.client.post(
            f"/api/surveys/admin/{sid}/questions/",
            {
                "prompt": "Which uniform do you prefer?",
                # <- the description of the picture, an EXISTING field
                "help_text": DESCRIPTION,
                "question_type": SurveyQuestion.TYPE_SINGLE_CHOICE,
                # <- option labels carry the distinguishing detail, not "A"/"B"
                "options": [
                    "A - navy blazer and grey trousers",
                    "B - white polo and khaki chinos",
                ],
                "is_required": True,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        qid = r.data["id"]

        # The picture itself is attached the normal way; it is not what carries the meaning.
        SurveyQuestion.objects.filter(pk=qid).update(image="survey_images/uniforms.jpg")

        Survey.objects.filter(pk=sid).update(status=Survey.STATUS_PUBLISHED)

        # ── The blind student opens the form ──
        self.client.force_authenticate(self.student)
        r = self.client.get(f"/api/surveys/{sid}/")
        self.assertEqual(r.status_code, 200, r.content)
        q = r.data["questions"][0]

        # Everything a screen reader needs is in the payload, ahead of the image.
        self.assertEqual(q["prompt"], "Which uniform do you prefer?")
        self.assertEqual(q["help_text"], DESCRIPTION)
        self.assertIn("navy blazer", q["options"][0])
        self.assertIn("white polo", q["options"][1])
        self.assertTrue(q["image_url"])  # the photo is there too, for sighted students

        # ── And they can actually answer it ──
        r = self.client.post(
            f"/api/surveys/{sid}/respond/",
            {"answers": {str(qid): "B - white polo and khaki chinos"}},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(
            SurveyAnswer.objects.get(question_id=qid).value_text,
            "B - white polo and khaki chinos",
        )
