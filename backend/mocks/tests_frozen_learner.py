"""A frozen learner signs in, but cannot queue for an invigilated mock or poll the waiting room.

``JoinMockSessionView`` and ``MyMockSessionsView`` name their own ``permission_classes``, which
REPLACES the project default (``IsAuthenticatedAndNotFrozen``). They once listed a bare
``IsAuthenticated``, and ``sessions.request_place`` never looks at ``is_frozen`` — so a
debt-frozen student could still take a place in the room.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from mocks.models import MockSessionParticipant
from mocks.tests_scoring import make_mock
from mocks.tests_sessions import make_session
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

User = get_user_model()

JOIN = "/api/mocks/sessions/join/"
MINE = "/api/mocks/sessions/mine/"


class FrozenLearnerMockSessionTests(TestCase):
    def setUp(self):
        self.mock, _mods = make_mock()
        self.session = make_session(self.mock)
        self.student = User.objects.create(username="frozen_mock", email="frozen_mock@x.io")
        self.api = APIClient()
        self.api.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        User.objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.api.force_authenticate(self.student)

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        # The freeze gate refused — not the view's own 403 for a bad code or a closed room.
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_join_or_poll(self):
        self._set_frozen(True)

        with self.subTest(route="POST join"):
            self.assertFrozenRefusal(self.api.post(JOIN, {"code": "123456"}, format="json"))
        with self.subTest(route="GET mine"):
            self.assertFrozenRefusal(self.api.get(MINE))

        self.assertFalse(MockSessionParticipant.objects.filter(student=self.student).exists())

    def test_an_unfrozen_student_is_unaffected(self):
        r = self.api.post(JOIN, {"code": "123456"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

        r = self.api.get(MINE)

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.data["results"]), 1)
