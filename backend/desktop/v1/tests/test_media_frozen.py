"""``attempts/{kind}/{id}/media`` refuses a frozen learner, for both kinds of paper.

``AttemptMediaView`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated``, so a debt-frozen
student refused by the runners could still have the paper's images signed for them.
"""

from __future__ import annotations

from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

from desktop.v1.tests.support import AppClient
from desktop.v1.tests.test_midterms import MidtermCase
from desktop.v1.tests.test_pastpapers import PastpaperCase

FROZEN_REFUSAL = {"code": "forbidden", "detail": IsAuthenticatedAndNotFrozen.message}


def set_frozen(student, frozen: bool) -> None:
    # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
    type(student).objects.filter(pk=student.pk).update(
        is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
    )
    student.refresh_from_db()


class FrozenPastpaperMediaTests(PastpaperCase):
    def test_a_frozen_student_gets_no_past_paper_images(self):
        attempt_id = self.started()
        set_frozen(self.student, True)
        self.app = AppClient(self.student)

        res = self.app.get(f"attempts/pastpaper/{attempt_id}/media")

        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.json(), FROZEN_REFUSAL)

    def test_lifting_the_freeze_restores_them(self):
        attempt_id = self.started()
        set_frozen(self.student, True)
        set_frozen(self.student, False)
        self.app = AppClient(self.student)

        res = self.app.get(f"attempts/pastpaper/{attempt_id}/media")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["media"])


class FrozenMidtermMediaTests(MidtermCase):
    def test_a_frozen_student_gets_no_midterm_images(self):
        attempt_id = self.opened()
        set_frozen(self.student, True)
        self.app = AppClient(self.student)

        res = self.app.get(f"attempts/midterm/{attempt_id}/media")

        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.json(), FROZEN_REFUSAL)

    def test_an_unfrozen_student_is_unaffected(self):
        attempt_id = self.opened()

        res = self.app.get(f"attempts/midterm/{attempt_id}/media")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([m["key"] for m in res.json()["media"]], ["question_images/mt-m1-q1.png"])
