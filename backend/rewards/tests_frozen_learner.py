"""A frozen learner signs in, but cannot turn points into coins.

``ConvertPointsView`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated``, and
``coins.convert`` never looks at ``is_frozen`` — so a debt-frozen student could still spend
their points.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from rewards import coins as coins_service
from rewards import constants
from rewards.models import CoinTransaction
from rewards.services import award
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

User = get_user_model()

CONVERT = "/api/rewards/wallet/convert/"


class FrozenLearnerConvertTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user("rw_frozen@t.com", "secret123")
        award(self.student, constants.EVENT_MANUAL, idempotency_key="frozen:1", points=30)
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
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_convert(self):
        before = coins_service.wallet_state(self.student)
        self._set_frozen(True)

        with self.subTest(body="30 points"):
            self.assertFrozenRefusal(self.api.post(CONVERT, {"points": 30}, format="json"))
        with self.subTest(body="Max (no amount)"):
            self.assertFrozenRefusal(self.api.post(CONVERT, {}, format="json"))

        after = coins_service.wallet_state(self.student)
        self.assertEqual((after["coins"], after["points"]), (before["coins"], before["points"]))
        self.assertFalse(CoinTransaction.objects.filter(wallet__student=self.student).exists())

    def test_an_unfrozen_student_is_unaffected(self):
        r = self.api.post(CONVERT, {"points": 30}, format="json")

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["minted"], 3)
        self.assertEqual(coins_service.wallet_state(self.student)["coins"], 3)
