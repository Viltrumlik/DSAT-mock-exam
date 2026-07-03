"""
Question `order` integrity: dense-order helper + repair_question_order command.

Reproduces the "Boundaries" defect (duplicate / gapped `order` values that make
the (order, id) delivery sort shuffle questions) and proves:

  * the repair command compacts to unique contiguous 0..n-1,
  * `--by id` restores creation order (only the order field had drifted),
  * `--by current` preserves the visible sequence while deduping,
  * dry-run writes nothing and a second apply is a no-op,
  * the dense reindex helper is atomic and handles partial / unknown id lists.
"""
from __future__ import annotations

import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase

from assessments.domain.question_ordering import (
    append_order_locked,
    reindex_set_questions_dense_locked,
)
from assessments.models import AssessmentQuestion, AssessmentSet

User = get_user_model()


class QuestionOrderRepairTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="order", email="order@test.local")

    def _set(self, title="Order Set"):
        return AssessmentSet.objects.create(
            subject="english", category="Boundaries", title=title, created_by=self.user,
        )

    def _q(self, s, order, prompt):
        return AssessmentQuestion.objects.create(
            assessment_set=s, order=order, prompt=prompt,
            question_type="multiple_choice",
            choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
            correct_answer="A",
        )

    def _orders(self, set_id):
        return list(
            AssessmentQuestion.objects.filter(assessment_set_id=set_id)
            .order_by("id").values_list("order", flat=True)
        )

    def _run(self, *args) -> dict:
        out = StringIO()
        call_command("repair_question_order", *args, "--json", stdout=out)
        return json.loads(out.getvalue())

    def test_by_id_restores_creation_order(self):
        s = self._set()
        # Created in id order a,b,c but order field scrambled: a=2, b=0, c=1.
        a = self._q(s, 2, "A")
        b = self._q(s, 0, "B")
        c = self._q(s, 1, "C")
        res = self._run("--set", str(s.id), "--by", "id", "--apply")
        self.assertEqual(res["sets_changed"], 1)
        a.refresh_from_db(); b.refresh_from_db(); c.refresh_from_db()
        self.assertEqual((a.order, b.order, c.order), (0, 1, 2))  # dense, by id

    def test_by_current_preserves_visible_sequence(self):
        s = self._set()
        # Visible (order,id) sequence is b(0), c(1), a(2) — keep it, just compact.
        a = self._q(s, 2, "A")
        b = self._q(s, 0, "B")
        c = self._q(s, 1, "C")
        self._run("--set", str(s.id), "--by", "current", "--apply")
        a.refresh_from_db(); b.refresh_from_db(); c.refresh_from_db()
        self.assertEqual((b.order, c.order, a.order), (0, 1, 2))

    def test_gapped_orders_are_compacted(self):
        # Post-constraint the realistic defect is unique-but-gapped orders (e.g.
        # after deletes). --by current keeps the sequence and compacts to 0..n-1.
        s = self._set()
        self._q(s, 0, "A"); self._q(s, 2, "B"); self._q(s, 5, "C")
        self._run("--set", str(s.id), "--by", "current", "--apply")
        self.assertEqual(sorted(self._orders(s.id)), [0, 1, 2])

    def test_dry_run_writes_nothing(self):
        s = self._set()
        self._q(s, 5, "A"); self._q(s, 7, "B")  # unique but gapped
        res = self._run("--set", str(s.id), "--by", "current")  # no --apply
        self.assertFalse(res["applied"])
        self.assertEqual(sorted(self._orders(s.id)), [5, 7])  # untouched

    def test_apply_is_idempotent(self):
        s = self._set()
        self._q(s, 3, "A"); self._q(s, 0, "B"); self._q(s, 9, "C")  # unique, sparse
        self._run("--set", str(s.id), "--by", "id", "--apply")
        second = self._run("--set", str(s.id), "--by", "id", "--apply")
        self.assertEqual(second["sets_changed"], 0)  # already clean

    def test_already_clean_set_reports_no_change(self):
        s = self._set()
        self._q(s, 0, "A"); self._q(s, 1, "B")
        res = self._run("--set", str(s.id), "--by", "current")
        self.assertEqual(res["sets_changed"], 0)


class ReindexHelperTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="reindex", email="reindex@test.local")

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="x", title="Reindex", created_by=self.user,
        )

    def _q(self, s, order):
        return AssessmentQuestion.objects.create(
            assessment_set=s, order=order, prompt=f"q{order}",
            question_type="numeric", choices=[], correct_answer=0,
        )

    def test_reindex_explicit_order(self):
        s = self._set()
        a = self._q(s, 0); b = self._q(s, 1); c = self._q(s, 2)
        # Move c to the front.
        final = reindex_set_questions_dense_locked(s.id, [c.id, a.id, b.id])
        self.assertEqual(final, [c.id, a.id, b.id])
        a.refresh_from_db(); b.refresh_from_db(); c.refresh_from_db()
        self.assertEqual((c.order, a.order, b.order), (0, 1, 2))

    def test_partial_list_appends_missing_and_ignores_unknown(self):
        s = self._set()
        a = self._q(s, 0); b = self._q(s, 1); c = self._q(s, 2)
        # Only mention b; unknown id 999999 ignored; a & c appended by (order,id).
        final = reindex_set_questions_dense_locked(s.id, [b.id, 999999])
        self.assertEqual(final, [b.id, a.id, c.id])
        self.assertEqual(sorted(self._orders_for(s.id)), [0, 1, 2])

    def _orders_for(self, set_id):
        return list(
            AssessmentQuestion.objects.filter(assessment_set_id=set_id).values_list("order", flat=True)
        )


class OrderConstraintTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="uniq", email="uniq@test.local")

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="x", title="Uniq", created_by=self.user,
        )

    def _q(self, s, order):
        return AssessmentQuestion.objects.create(
            assessment_set=s, order=order, prompt=f"q{order}",
            question_type="numeric", choices=[], correct_answer=0,
        )

    def test_unique_constraint_rejects_duplicate_order(self):
        s = self._set()
        self._q(s, 0)
        q1 = self._q(s, 1)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                # Bypass the ordering helper and force a collision.
                AssessmentQuestion.objects.filter(pk=q1.pk).update(order=0)

    def test_append_order_locked_yields_unique_dense(self):
        s = self._set()
        for _ in range(4):
            with transaction.atomic():
                o = append_order_locked(s.id)
                self._q(s, o)
        orders = sorted(self._orders_for(s.id))
        self.assertEqual(orders, [0, 1, 2, 3])  # unique + contiguous

    def _orders_for(self, set_id):
        return list(
            AssessmentQuestion.objects.filter(assessment_set_id=set_id).values_list("order", flat=True)
        )
