"""The practice-test detail route.

`GET /api/exams/<id>/` is what `/practice-test/<id>` reads, and homework sends students
straight there for practice and module content (`homeworkApi.ts` builds that href).

It was dead for three months. The route was declared

    re_path(r"^(?P<pk>\\\\d+)/$", ...)

— a doubled backslash inside a raw string, so the pattern matched a literal ``\\dd/`` and
never an id. Every request 404'd, and the page said "Practice test not found" to students
whose test was sitting right there. `resolve()` is asserted directly because a view test
alone would not have caught it: the failure was that the URL never reached the view.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import resolve, reverse
from rest_framework.test import APIClient

from exams.models import Module, PracticeTest, Question

User = get_user_model()


class PracticeTestDetailRouteTests(TestCase):
    def test_a_numeric_id_reaches_the_practice_test_view(self):
        match = resolve("/api/exams/4/")
        self.assertEqual(match.kwargs, {"pk": "4"})
        self.assertEqual(match.func.cls.__name__, "PracticeTestViewSet")

    def test_the_named_route_builds_a_plain_numeric_url(self):
        self.assertEqual(reverse("practice-test-detail", kwargs={"pk": 4}), "/api/exams/4/")

    def test_a_non_numeric_id_does_not_reach_it(self):
        # The whole reason for the explicit int route: `/attempts/` must not be read as a pk.
        match = resolve("/api/exams/attempts/")
        self.assertNotEqual(match.func.__name__, "PracticeTestViewSet")


class PracticeTestDetailAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user("pt_student@t.com", "secret123")
        self.other = User.objects.create_user("pt_other@t.com", "secret123")
        self.test = PracticeTest.objects.create(
            subject="MATH", title="November 2025 International Math"
        )
        # A PracticeTest may come with its modules already made, so take the first rather
        # than adding a second and colliding on (practice_test, module_order).
        module = self.test.modules.order_by("module_order").first() or Module.objects.create(
            practice_test=self.test, module_order=1, time_limit_minutes=35
        )
        # The student queryset requires a non-empty module — an empty test is filtered out
        # before the pk ever matters, which would hide a routing regression.
        Question.objects.create(
            module=module, order=1, question_type="MATH",
            question_text="1 + 1 = ?", correct_answers="2",
        )

    def test_an_assigned_student_can_open_it(self):
        self.test.assigned_users.add(self.student)
        self.client.force_authenticate(self.student)
        r = self.client.get(f"/api/exams/{self.test.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["id"], self.test.id)

    def test_a_student_it_was_not_assigned_to_gets_404(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"/api/exams/{self.test.id}/").status_code, 404)
