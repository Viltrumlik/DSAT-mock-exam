"""A frozen learner signs in, but cannot answer a survey or keep a draft of one.

``SurveyRespondView`` and ``SurveyDraftView`` name their own ``permission_classes``, which
REPLACES the project default (``IsAuthenticatedAndNotFrozen``). They once listed a bare
``IsAuthenticated``, and ``services.submit_response`` never looks at ``is_frozen`` — so a
debt-frozen student could still submit, and be paid the 40 points for it.
"""

from __future__ import annotations

from rewards.models import PointAward
from surveys.models import SurveyResponse
from surveys.tests_surveys import SurveyFixture
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen


class FrozenLearnerSurveyTests(SurveyFixture):
    def setUp(self):
        super().setUp()
        self.respond_url = f"/api/surveys/{self.survey.id}/respond/"
        self.draft_url = f"/api/surveys/{self.survey.id}/draft/"
        self.client.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        type(self.student).objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.client.force_authenticate(self.student)

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_respond(self):
        self._set_frozen(True)

        self.assertFrozenRefusal(
            self.client.post(self.respond_url, {"answers": self.full_answers()}, format="json")
        )

        self.assertFalse(SurveyResponse.objects.filter(student=self.student).exists())
        self.assertFalse(PointAward.objects.filter(student=self.student).exists())

    def test_a_frozen_student_cannot_save_or_read_a_draft(self):
        self._set_frozen(True)

        with self.subTest(route="PUT draft"):
            self.assertFrozenRefusal(
                self.client.put(self.draft_url, {"answers": self.full_answers()}, format="json")
            )
        with self.subTest(route="GET draft"):
            self.assertFrozenRefusal(self.client.get(self.draft_url))

        self.assertFalse(SurveyResponse.objects.filter(student=self.student).exists())

    def test_an_unfrozen_student_is_unaffected(self):
        r = self.client.put(self.draft_url, {"answers": self.full_answers()}, format="json")
        self.assertEqual(r.status_code, 204, r.content)
        self.assertEqual(self.client.get(self.draft_url).status_code, 200)

        r = self.client.post(self.respond_url, {"answers": self.full_answers()}, format="json")

        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(
            SurveyResponse.objects.filter(
                student=self.student, status=SurveyResponse.STATUS_SUBMITTED
            ).exists()
        )
