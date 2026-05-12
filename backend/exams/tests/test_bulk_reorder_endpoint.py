"""
Structural integrity tests for AdminQuestionViewSet.bulk_reorder.

These are not UI tests. They verify the ordering-correctness contract of the
endpoint that is now the sole mechanism for question reordering in pastpaper
modules. A bug here can silently corrupt module question order in a way that
only surfaces during student test-taking.

Coverage targets:
  1. Happy path — full reorder produces correct dense order
  2. Idempotency — same call twice yields same result
  3. Reverse order — full reversal is preserved correctly
  4. Duplicate IDs — rejected with 400
  5. Missing IDs — rejected with 400 (partial reorder forbidden)
  6. Extra/foreign IDs — rejected with 400 (cross-module moves blocked)
  7. Empty list — rejected with 400
  8. Non-integer values — rejected with 400
  9. Order integrity after invalid payload — existing order preserved
 10. Cross-module isolation — another module's questions are unaffected
 11. Single question — no-op reorder succeeds
 12. Auth guard — unauthenticated request returns 401/403
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module, PracticeTest, Question

User = get_user_model()


def _make_practice_test(subject: str = "MATH", title: str = "Bulk Reorder Test PT") -> PracticeTest:
    return PracticeTest.objects.create(
        subject=subject,
        title=title,
        form_type="INTERNATIONAL",
        mock_exam=None,
        skip_default_modules=True,
    )


def _make_module(pt: PracticeTest, order: int = 1) -> Module:
    return Module.objects.create(
        practice_test=pt,
        module_order=order,
        time_limit_minutes=35,
    )


def _make_question(module: Module, text: str, order: int) -> Question:
    """Create a minimal valid question without triggering the dense-reindex save path."""
    q = Question(
        module=module,
        question_type="MATH",
        question_text=text,
        correct_answers="a",
        order=order,
    )
    q.save(_plain_db_save=True)
    return q


def _ordered_texts(module: Module) -> list[str]:
    return list(
        Question.objects.filter(module=module)
        .order_by("order", "id")
        .values_list("question_text", flat=True)
    )


def _ordered_ids(module: Module) -> list[int]:
    return list(
        Question.objects.filter(module=module)
        .order_by("order", "id")
        .values_list("id", flat=True)
    )


class BulkReorderEndpointTests(TestCase):
    """
    Full-stack integration tests against the real DB.
    Uses APIClient with force_authenticate — no mocks.
    """

    def setUp(self):
        self.client = APIClient()
        self.author = User.objects.create_user(
            email="reorder_author@example.com",
            password="pw",
            role=acc_const.ROLE_TEST_ADMIN,
        )
        self.client.force_authenticate(user=self.author)

        self.pt = _make_practice_test()
        self.mod = _make_module(self.pt)

        # Create 4 questions in natural order: A=0, B=1, C=2, D=3
        self.qa = _make_question(self.mod, "A", 0)
        self.qb = _make_question(self.mod, "B", 1)
        self.qc = _make_question(self.mod, "C", 2)
        self.qd = _make_question(self.mod, "D", 3)

    def _url(self, module: Module | None = None) -> str:
        mod = module or self.mod
        return (
            f"/api/exams/admin/tests/{mod.practice_test_id}/"
            f"modules/{mod.pk}/questions/bulk-reorder/"
        )

    def _post(self, ordered_ids: list, module: Module | None = None) -> "rest_framework.response.Response":
        return self.client.post(
            self._url(module),
            data={"ordered_ids": ordered_ids},
            format="json",
        )

    # ── Happy paths ───────────────────────────────────────────────────────────

    def test_full_reorder_produces_correct_dense_order(self):
        """D, B, A, C → orders should be 0,1,2,3 in that sequence."""
        resp = self._post([self.qd.id, self.qb.id, self.qa.id, self.qc.id])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(_ordered_texts(self.mod), ["D", "B", "A", "C"])

    def test_orders_are_dense_zero_based_after_reorder(self):
        """After a full reorder, order values must be 0, 1, 2, 3 — no gaps."""
        self._post([self.qd.id, self.qb.id, self.qa.id, self.qc.id])
        orders = list(
            Question.objects.filter(module=self.mod)
            .order_by("order", "id")
            .values_list("order", flat=True)
        )
        self.assertEqual(orders, [0, 1, 2, 3])

    def test_idempotency_same_call_twice_yields_same_result(self):
        """Calling with the same ordered_ids twice must leave the module in the same state."""
        ids = [self.qc.id, self.qa.id, self.qd.id, self.qb.id]
        r1 = self._post(ids)
        r2 = self._post(ids)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(_ordered_texts(self.mod), ["C", "A", "D", "B"])
        # Orders are still dense after second call.
        orders = list(
            Question.objects.filter(module=self.mod)
            .order_by("order")
            .values_list("order", flat=True)
        )
        self.assertEqual(orders, [0, 1, 2, 3])

    def test_full_reversal_preserved_correctly(self):
        """Reversing [A,B,C,D] → [D,C,B,A] must persist exactly."""
        ids = [self.qd.id, self.qc.id, self.qb.id, self.qa.id]
        resp = self._post(ids)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(_ordered_texts(self.mod), ["D", "C", "B", "A"])

    def test_single_question_module_noop_reorder_succeeds(self):
        """A module with one question can receive a reorder with just that question's ID."""
        pt2 = _make_practice_test(title="Single Q PT")
        mod2 = _make_module(pt2)
        only_q = _make_question(mod2, "Only", 0)

        resp = self._post([only_q.id], module=mod2)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(_ordered_ids(mod2), [only_q.id])

    def test_response_body_contains_count(self):
        resp = self._post([self.qa.id, self.qb.id, self.qc.id, self.qd.id])
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("count"), 4)

    # ── Rejection: payload validation ─────────────────────────────────────────

    def test_duplicate_ids_rejected_400(self):
        """ordered_ids with duplicate values must be rejected."""
        resp = self._post([self.qa.id, self.qb.id, self.qa.id, self.qc.id])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("duplicate", resp.json().get("error", "").lower())

    def test_missing_ids_rejected_400(self):
        """Omitting a question from ordered_ids (partial reorder) must be rejected."""
        # Send only 3 of 4 questions.
        resp = self._post([self.qa.id, self.qb.id, self.qc.id])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.json())

    def test_extra_foreign_ids_rejected_400(self):
        """Including an ID from a different module must be rejected."""
        pt2 = _make_practice_test(title="Foreign PT")
        mod2 = _make_module(pt2)
        foreign_q = _make_question(mod2, "Foreign", 0)

        # Replace qd with a foreign question — total count matches but IDs are wrong.
        resp = self._post([self.qa.id, self.qb.id, self.qc.id, foreign_q.id])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.json())

    def test_empty_list_rejected_400(self):
        """An empty ordered_ids list must be rejected."""
        resp = self._post([])
        self.assertEqual(resp.status_code, 400)

    def test_non_integer_values_rejected_400(self):
        """Non-integer values in ordered_ids must be rejected."""
        resp = self._post(["abc", self.qb.id, self.qc.id, self.qd.id])
        self.assertEqual(resp.status_code, 400)

    def test_null_ordered_ids_rejected_400(self):
        """Omitting ordered_ids from the payload body must be rejected."""
        resp = self.client.post(self._url(), data={}, format="json")
        self.assertEqual(resp.status_code, 400)

    # ── Order integrity after failed request ─────────────────────────────────

    def test_order_preserved_after_invalid_payload(self):
        """
        When a request is rejected (invalid payload), the existing question
        order must be completely unchanged. Verify no partial mutation occurred.
        """
        original_order = _ordered_ids(self.mod)

        # Send a request that will be rejected (duplicate IDs).
        self._post([self.qa.id, self.qa.id, self.qb.id, self.qc.id])

        # Confirm the order is identical to before the rejected request.
        self.assertEqual(_ordered_ids(self.mod), original_order)

    def test_order_preserved_after_missing_id_rejection(self):
        """Partial ordered_ids rejection must not mutate any question order."""
        original_order = _ordered_ids(self.mod)
        self._post([self.qa.id, self.qb.id])  # Missing qc, qd — rejected.
        self.assertEqual(_ordered_ids(self.mod), original_order)

    # ── Cross-module isolation ────────────────────────────────────────────────

    def test_second_module_unaffected_by_reorder_of_first(self):
        """
        A reorder of module 1 must not change the question order in module 2
        of the same practice test.
        """
        mod2 = _make_module(self.pt, order=2)
        x = _make_question(mod2, "X", 0)
        y = _make_question(mod2, "Y", 1)
        z = _make_question(mod2, "Z", 2)

        # Reorder mod1.
        self._post([self.qd.id, self.qa.id, self.qb.id, self.qc.id])

        # mod2 order must be unchanged.
        self.assertEqual(_ordered_texts(mod2), ["X", "Y", "Z"])
        mod2_orders = list(
            Question.objects.filter(module=mod2)
            .order_by("order", "id")
            .values_list("order", flat=True)
        )
        self.assertEqual(mod2_orders, [0, 1, 2])

    # ── Auth guard ────────────────────────────────────────────────────────────

    def test_unauthenticated_request_rejected(self):
        """Unauthenticated callers must not be able to reorder questions."""
        unauth_client = APIClient()
        resp = unauth_client.post(
            self._url(),
            data={"ordered_ids": [self.qa.id, self.qb.id, self.qc.id, self.qd.id]},
            format="json",
        )
        self.assertIn(resp.status_code, [401, 403])

    def test_student_role_rejected(self):
        """A student-role user must not be able to call the reorder endpoint."""
        student = User.objects.create_user(
            email="student_reorder@example.com",
            password="pw",
            role=acc_const.ROLE_STUDENT,
        )
        student_client = APIClient()
        student_client.force_authenticate(user=student)
        resp = student_client.post(
            self._url(),
            data={"ordered_ids": [self.qa.id, self.qb.id, self.qc.id, self.qd.id]},
            format="json",
        )
        self.assertIn(resp.status_code, [403, 404])

    # ── High-water mark integrity ─────────────────────────────────────────────

    def test_module_high_water_updated_after_reorder(self):
        """
        Module.question_order_high_water must equal len(questions) - 1 after
        a successful reorder. This field is used by the dense ordering system.
        """
        self._post([self.qd.id, self.qc.id, self.qb.id, self.qa.id])
        self.mod.refresh_from_db()
        self.assertEqual(self.mod.question_order_high_water, 3)
