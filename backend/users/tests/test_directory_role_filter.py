"""`GET /api/users/?role=` narrows the directory.

Written after the support console shipped asking for support teachers and rendering the whole
school: the list view took the parameter and ignored it, so the console looked like a broken
UI rather than a missing filter. A query parameter that is silently dropped is worse than one
that errors — the caller has no way to tell the difference between "no filter" and "no
matches".
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C

User = get_user_model()


def _u(email, role, **kw):
    return User.objects.create_user(email, "secret123", role=role, **kw)


class DirectoryRoleFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = _u("dir_admin@t.com", C.ROLE_ADMIN)
        self.support_a = _u("dir_sup_a@t.com", C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        self.support_b = _u("dir_sup_b@t.com", C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.teacher = _u("dir_teacher@t.com", C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = _u("dir_student@t.com", C.ROLE_STUDENT)
        self.client.force_authenticate(self.admin)

    def _ids(self, url):
        body = self.client.get(url).json()
        rows = body.get("results", body) if isinstance(body, dict) else body
        return {row["id"] for row in rows}

    def test_the_filter_returns_only_that_role(self):
        ids = self._ids(f"/api/users/?role={C.ROLE_SUPPORT_TEACHER}")

        self.assertEqual(ids, {self.support_a.pk, self.support_b.pk})

    def test_a_both_subject_support_teacher_is_not_dropped_by_it(self):
        """The account this console exists to manage. Filtering on ROLE must not accidentally
        depend on subject, where "both" is the value every naive comparison gets wrong."""
        self.assertIn(self.support_b.pk, self._ids(f"/api/users/?role={C.ROLE_SUPPORT_TEACHER}"))

    def test_omitting_it_still_returns_the_whole_directory(self):
        """Every caller that predates the filter sends nothing and expects everybody."""
        ids = self._ids("/api/users/")

        for user in (self.support_a, self.support_b, self.teacher, self.student):
            self.assertIn(user.pk, ids)

    def test_an_unknown_role_returns_nothing_rather_than_everything(self):
        """The failure this whole test module is about: answering a filter you did not apply
        with a full directory. Narrowing to nothing is wrong-but-obvious; returning the school
        is wrong-and-invisible."""
        self.assertEqual(self._ids("/api/users/?role=wizard"), set())
