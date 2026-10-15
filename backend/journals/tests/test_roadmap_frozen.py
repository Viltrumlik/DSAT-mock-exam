"""A frozen learner can still see the roadmap, but cannot open or confirm a reading.

The map is left open on purpose (``classes.tests_roadmap.test_frozen_student_can_view``): it
emits no openable id for anything the student may not open. The reading is what the map
opens — the lesson material, and the homework id once confirmed — so it sits behind the
freeze like everything else downstream of the map.

``RoadmapReadingView`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated``.
"""

from __future__ import annotations

from journals.models import RoadmapRead
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

from .test_roadmap import RoadmapTestBase


class FrozenLearnerReadingTests(RoadmapTestBase):
    def setUp(self):
        super().setUp()
        self.row = self._deliver(self._roadmap_session())
        self.url = f"/api/classes/roadmap/{self.row.id}/reading/"
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

    def test_a_frozen_student_cannot_open_or_confirm_a_reading(self):
        self._set_frozen(True)

        with self.subTest(route="GET reading"):
            self.assertFrozenRefusal(self.client.get(self.url))
        with self.subTest(route="POST reading"):
            self.assertFrozenRefusal(self.client.post(self.url))

        self.assertFalse(RoadmapRead.objects.filter(classroom_lesson=self.row).exists())

    def test_the_map_itself_stays_open_to_a_frozen_student(self):
        self._set_frozen(True)

        r = self.client.get("/api/classes/roadmap/")

        self.assertEqual(r.status_code, 200, r.content)

    def test_an_unfrozen_student_is_unaffected(self):
        self.assertEqual(self.client.get(self.url).status_code, 200)

        r = self.client.post(self.url)

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["read"])
        self.assertEqual(r.data["homework_assignment_id"], self.row.assignment_id)
