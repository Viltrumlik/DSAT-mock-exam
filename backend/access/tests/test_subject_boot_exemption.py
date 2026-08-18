"""A subject-misconfigured staff account must still be able to BOOT.

Regression for the "support teacher signs in, lands back on /login, forever" report. The
client decides "am I signed in?" from ``/api/users/me/``. ``StaffSubjectRequiredMiddleware``
runs on every ``/api/`` request, and it answered 403 to a subject-scoped staff account with no
valid subject — including on ``/users/me/``. The SPA reads that 403 as "not authenticated" and
redirects to /login; the login succeeds, boots, probes ``me``, is refused again, and loops with
no way to even see they are signed in.

The host guard already lets ``/api/users/me/`` (and the auth endpoints) through on every
console for exactly this boot reason. The subject gate has to honour the same exemption. The
scoping it enforces is unchanged for real work endpoints — those still 403 without a subject.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C

User = get_user_model()

TEACHER = "teacher.mastersat.uz"


@override_settings(ALLOWED_HOSTS=[TEACHER, "testserver"])
class SubjectGateBootExemptionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        # A support teacher with NO subject — the exact state that bricked the account. Built
        # with save(), bypassing full_clean(), because the point is defence in depth: a row
        # that reaches this state by ANY path (import, shell, a future bug) must not lock the
        # person into an invisible login loop.
        self.broken = User(
            email="nosub@t.com",
            username="nosub",
            role=C.ROLE_SUPPORT_TEACHER,
            first_name="Nodir",
            last_name="Karimov",
        )
        self.broken.subject = None
        self.broken.save()

    def _auth(self, user):
        token = str(RefreshToken.for_user(user).access_token)
        self.client.cookies["lms_access"] = token

    def test_me_is_reachable_for_a_subjectless_staff_account(self):
        self._auth(self.broken)
        res = self.client.get("/api/users/me/", HTTP_HOST=TEACHER)
        # 200, not 403: the identity probe must always answer so the client can boot.
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["id"], self.broken.id)

    def test_a_real_work_endpoint_still_enforces_subject(self):
        self._auth(self.broken)
        # Scoping is unchanged where it matters: a subjectless staff account still cannot
        # reach a work surface. (Any authenticated /api/ path that is not boot-exempt does.)
        res = self.client.get("/api/classes/", HTTP_HOST=TEACHER)
        self.assertEqual(res.status_code, 403, res.content)
        self.assertIn("subject", res.json().get("detail", "").lower())
