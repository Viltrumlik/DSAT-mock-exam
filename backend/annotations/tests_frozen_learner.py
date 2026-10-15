"""A frozen learner signs in, but cannot read or write their study annotations.

``AnnotationListView`` and ``AnnotationWriteView`` name their own ``permission_classes``, which
REPLACES the project default (``IsAuthenticatedAndNotFrozen``). They once listed a bare
``IsAuthenticated``.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

from .models import StudyAnnotation

User = get_user_model()

LIST_URL = "/api/annotations/"
WRITE_URL = "/api/annotations/write/"
REGION = {"start": 0, "end": 5, "kind": "highlight", "color": "yellow"}


class FrozenLearnerAnnotationTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user("ann_frozen@t.com", "secret123")
        self.api = APIClient()
        self.api.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        User.objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.api.force_authenticate(self.student)

    def _write(self, data):
        body = {"scope": "exam", "ref": "42", "target_id": 7, "container": "passage", "data": data}
        return self.api.put(WRITE_URL, body, format="json")

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_write_or_read(self):
        self._set_frozen(True)

        with self.subTest(route="PUT write"):
            self.assertFrozenRefusal(self._write([REGION]))
        with self.subTest(route="GET list"):
            self.assertFrozenRefusal(self.api.get(LIST_URL, {"scope": "exam", "ref": "42"}))

        self.assertFalse(StudyAnnotation.objects.filter(student=self.student).exists())

    def test_a_frozen_students_empty_write_does_not_delete_their_marks(self):
        # An empty list is the delete — refused like any other write.
        self.assertEqual(self._write([REGION]).status_code, 204)
        self._set_frozen(True)

        self.assertFrozenRefusal(self._write([]))

        self.assertTrue(StudyAnnotation.objects.filter(student=self.student).exists())

    def test_an_unfrozen_student_is_unaffected(self):
        self.assertEqual(self._write([REGION]).status_code, 204)

        r = self.api.get(LIST_URL, {"scope": "exam", "ref": "42"})

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.data["items"]), 1)
