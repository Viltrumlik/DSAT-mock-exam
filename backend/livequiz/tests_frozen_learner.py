"""A frozen learner signs in, but cannot take a place in a live quiz.

``JoinView`` (by code) and ``SessionJoinByIdView`` (by id, from "running now") name their own
``permission_classes``, which REPLACES the project default (``IsAuthenticatedAndNotFrozen``).
They once listed a bare ``IsAuthenticated``, and ``services.join_session`` only asks whether
the student is on the class roster — so a debt-frozen student could still join.
"""

from __future__ import annotations

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

from .models import LiveQuizParticipant
from .tests_services import LiveQuizBase


@override_settings(LIVE_QUIZ_ENABLED=True)
class FrozenLearnerJoinTests(LiveQuizBase):
    def setUp(self):
        super().setUp()
        self.session = self._session()
        self.api = APIClient()
        self.api.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        type(self.student).objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.api.force_authenticate(self.student)

    def _join_by_code(self):
        return self.api.post(reverse("livequiz-join"), {"code": self.session.join_code}, format="json")

    def _join_by_id(self):
        return self.api.post(reverse("livequiz-session-join", args=[self.session.pk]), {}, format="json")

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        # The freeze gate refused — not join_session's own "not in your class".
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_join_by_code_or_by_id(self):
        self._set_frozen(True)

        for route, join in (("by code", self._join_by_code), ("by id", self._join_by_id)):
            with self.subTest(route=route):
                self.assertFrozenRefusal(join())

        self.assertFalse(LiveQuizParticipant.objects.filter(user=self.student).exists())

    def test_an_unfrozen_student_is_unaffected(self):
        self.assertEqual(self._join_by_code().status_code, 200)
        self.assertEqual(self._join_by_id().status_code, 200)

        self.assertEqual(
            LiveQuizParticipant.objects.filter(session=self.session, user=self.student).count(), 1
        )
