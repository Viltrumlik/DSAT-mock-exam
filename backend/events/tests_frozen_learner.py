"""A frozen learner signs in, but cannot cancel an event seat.

``EventCancelView`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated``, and
``services.cancel_registration`` never looks at ``is_frozen``. Signing up needs no such fix:
``services.is_signupable_student`` already refuses a frozen account.
"""

from __future__ import annotations

from events import services
from events.models import EventRegistration
from events.tests_api_student import StudentApiFixture
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen


class FrozenLearnerCancelTests(StudentApiFixture):
    def setUp(self):
        super().setUp()
        self.seat = services.sign_up(self.event, self.anna)
        self.url = f"/api/events/{self.event.id}/cancel/"

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        type(self.anna).objects.filter(pk=self.anna.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.anna.refresh_from_db()

    def test_a_frozen_student_cannot_cancel_a_seat_taken_before_the_freeze(self):
        self._set_frozen(True)

        r = self._as(self.anna).post(self.url)

        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.data.get("detail"), IsAuthenticatedAndNotFrozen.message)
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, EventRegistration.STATUS_REGISTERED)

    def test_an_unfrozen_student_is_unaffected(self):
        r = self._as(self.anna).post(self.url)

        self.assertEqual(r.status_code, 200, r.content)
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, EventRegistration.STATUS_CANCELLED)
