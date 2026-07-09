"""Regression: the mutating midterm endpoints must lock without a nullable outer join.

Postgres rejects ``SELECT ... FOR UPDATE`` on the nullable side of an outer join
(``FeatureNotSupported``). ``Midterm.question_module`` is ``null=True``, so a lock query
that ``select_related``s it 500s start/save/submit on prod (SQLite silently allows it, so
this never surfaced in the suite). The lock queryset must therefore avoid that join.
"""

from __future__ import annotations

from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from midterms.views import MidtermAttemptViewSet


class LockQuerysetNoNullableOuterJoinTests(TestCase):
    def _viewset_for(self, user):
        vs = MidtermAttemptViewSet()
        vs.request = SimpleNamespace(user=user)
        return vs

    def test_lock_queryset_omits_nullable_question_module_join(self):
        student = get_user_model().objects.create(username="lock_student")
        vs = self._viewset_for(student)

        lock_sql = str(vs._lock_queryset().select_for_update().query).upper()
        # The exact thing Postgres rejects under FOR UPDATE — the lock query must have none.
        self.assertNotIn("LEFT OUTER JOIN", lock_sql)

        # Sanity: the read queryset DOES outer-join question_module (nullable). That is fine
        # there — no FOR UPDATE — and guards against "just drop select_related everywhere".
        read_sql = str(vs.get_queryset().query).upper()
        self.assertIn("LEFT OUTER JOIN", read_sql)
