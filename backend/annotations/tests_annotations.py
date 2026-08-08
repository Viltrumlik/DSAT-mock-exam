"""Study annotations: private to their student, one region at a time, empty means gone."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import StudyAnnotation

User = get_user_model()

LIST_URL = "/api/annotations/"
WRITE_URL = "/api/annotations/write/"


def _range(start=0, end=5, **extra):
    return {"start": start, "end": end, "kind": "highlight", "color": "yellow", **extra}


class AnnotationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user("ann_student@t.com", "secret123")
        self.other = User.objects.create_user("ann_other@t.com", "secret123")
        self.client.force_authenticate(self.student)

    def _write(self, **over):
        body = {
            "scope": "exam", "ref": "42", "target_id": 7,
            "container": "passage", "data": [_range()],
        }
        body.update(over)
        return self.client.put(WRITE_URL, body, format="json")

    # ── round trip ────────────────────────────────────────────────────────────
    def test_what_is_written_comes_back(self):
        self.assertEqual(self._write().status_code, 204)
        r = self.client.get(LIST_URL, {"scope": "exam", "ref": "42"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["items"], [{"target_id": 7, "container": "passage", "data": [_range()]}])

    def test_writing_the_same_region_twice_replaces_it(self):
        self._write()
        self._write(data=[_range(10, 20, color="blue")])
        rows = StudyAnnotation.objects.filter(student=self.student)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().data[0]["color"], "blue")

    def test_regions_of_one_question_are_independent(self):
        # The passage, the prompt and the choices each have their own offset space, so they
        # must not overwrite each other.
        self._write(container="passage")
        self._write(container="choices", data=[_range(1, 3)])
        r = self.client.get(LIST_URL, {"scope": "exam", "ref": "42"})
        self.assertEqual({i["container"] for i in r.json()["items"]}, {"passage", "choices"})

    def test_an_empty_list_deletes_the_row(self):
        # "Cleared their highlights" and "never highlighted here" are the same fact, and the
        # list read pulls every row for the attempt.
        self._write()
        self.assertEqual(self._write(data=[]).status_code, 204)
        self.assertFalse(StudyAnnotation.objects.filter(student=self.student).exists())

    # ── privacy ───────────────────────────────────────────────────────────────
    def test_a_student_never_sees_another_students_marks(self):
        StudyAnnotation.objects.create(
            student=self.other, scope="exam", ref="42", target_id=7,
            container="passage", data=[_range()],
        )
        r = self.client.get(LIST_URL, {"scope": "exam", "ref": "42"})
        self.assertEqual(r.json()["items"], [])

    def test_writing_cannot_overwrite_another_students_row(self):
        StudyAnnotation.objects.create(
            student=self.other, scope="exam", ref="42", target_id=7,
            container="passage", data=[_range()],
        )
        self._write(data=[_range(90, 99, color="pink")])
        self.assertEqual(StudyAnnotation.objects.count(), 2)  # a new row, not a hijacked one
        self.assertEqual(
            StudyAnnotation.objects.get(student=self.other).data[0]["color"], "yellow"
        )

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(LIST_URL, {"scope": "exam", "ref": "1"}).status_code, (401, 403))

    # ── scoping ───────────────────────────────────────────────────────────────
    def test_the_three_scopes_do_not_collide(self):
        # An exam attempt id and a vocabulary set id can be the same number.
        self._write(scope="exam", ref="5", target_id=1, container="word")
        self._write(scope="vocab", ref="5", target_id=1, container="word", data=[_range(2, 4)])
        exam = self.client.get(LIST_URL, {"scope": "exam", "ref": "5"}).json()["items"]
        vocab = self.client.get(LIST_URL, {"scope": "vocab", "ref": "5"}).json()["items"]
        self.assertEqual(exam[0]["data"][0]["start"], 0)
        self.assertEqual(vocab[0]["data"][0]["start"], 2)

    def test_an_unknown_scope_is_refused(self):
        self.assertEqual(self._write(scope="nonsense").status_code, 400)
        self.assertEqual(self.client.get(LIST_URL, {"scope": "nonsense", "ref": "1"}).status_code, 400)

    def test_ref_is_required_on_read(self):
        self.assertEqual(self.client.get(LIST_URL, {"scope": "exam"}).status_code, 400)

    # ── validation ────────────────────────────────────────────────────────────
    def test_a_backwards_range_is_refused(self):
        self.assertEqual(self._write(data=[_range(9, 2)]).status_code, 400)

    def test_an_unknown_colour_is_refused(self):
        # A bad row would break the NEXT read for this student, not this write, so it is
        # worth refusing at the door.
        self.assertEqual(self._write(data=[_range(color="chartreuse")]).status_code, 400)

    def test_an_underline_keeps_its_style_and_drops_a_stray_colour(self):
        self._write(data=[{"start": 0, "end": 4, "kind": "underline", "underline": "dashed", "color": "blue"}])
        stored = StudyAnnotation.objects.get(student=self.student).data[0]
        self.assertEqual(stored["underline"], "dashed")
        self.assertNotIn("color", stored)

    def test_a_runaway_client_is_capped(self):
        self.assertEqual(self._write(data=[_range(i, i + 1) for i in range(600)]).status_code, 400)
