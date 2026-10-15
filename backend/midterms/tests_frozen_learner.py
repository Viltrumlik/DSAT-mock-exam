"""A frozen learner signs in, but cannot sit a midterm.

``MidtermAttemptViewSet`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated`` and ``can_start_midterm``
never looks at ``is_frozen`` — so a debt-frozen centre student could still start, save and submit.
These pin the freeze check on every route, including a sitting the freeze lands in the middle of.

    python manage.py test midterms.tests_frozen_learner --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from midterms.models import MidtermAttempt
from midterms.tests_api import grant, make_published_midterm
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen

User = get_user_model()

ATTEMPTS = "/api/midterms/attempts/"

#: Every detail route on the viewset (method, url_path) — none may answer a frozen learner.
DETAIL_ROUTES = (
    ("get", ""),
    ("get", "status/"),
    ("get", "review/"),
    ("get", "results/"),
    ("post", "start/"),
    ("post", "verify_code/"),
    ("post", "desktop_challenge/"),
    ("post", "desktop_session/"),
    ("post", "offscreen/"),
    ("post", "save_attempt/"),
    ("post", "submit_module/"),
)


class FrozenLearnerMidtermTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="frozen_mt_student", email="frozen_mt_student@x.io", role="student")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.midterm = make_published_midterm(n=4)
        grant(self.user, self.midterm)
        self.qids = [str(q.id) for q in self.midterm.questions()]

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        User.objects.filter(pk=self.user.pk).update(is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else "")
        self.user.refresh_from_db()
        self.client.force_authenticate(self.user)

    def _create(self) -> int:
        r = self.client.post(ATTEMPTS, {"midterm": self.midterm.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def _start(self, aid: int) -> None:
        r = self.client.post(f"{ATTEMPTS}{aid}/start/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        # The freeze gate refused — not a midterm rule (no access, too early to submit) that also answers 403.
        self.assertEqual(response.json().get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_create_a_sitting(self):
        self._set_frozen(True)

        self.assertFrozenRefusal(self.client.post(ATTEMPTS, {"midterm": self.midterm.id}, format="json"))
        self.assertFalse(MidtermAttempt.objects.filter(student=self.user).exists())

    def test_a_frozen_student_cannot_start_a_sitting_made_before_the_freeze(self):
        aid = self._create()
        self._set_frozen(True)

        self.assertFrozenRefusal(self.client.post(f"{ATTEMPTS}{aid}/start/", {}, format="json"))
        self.assertEqual(MidtermAttempt.objects.get(pk=aid).current_state, MidtermAttempt.STATE_NOT_STARTED)

    def test_a_freeze_mid_sitting_stops_saves_and_submits(self):
        aid = self._create()
        self._start(aid)
        self._set_frozen(True)
        body = {"answers": {q: "a" for q in self.qids}, "flagged": []}

        self.assertFrozenRefusal(self.client.post(f"{ATTEMPTS}{aid}/save_attempt/", body, format="json"))
        self.assertFrozenRefusal(self.client.post(f"{ATTEMPTS}{aid}/submit_module/", body, format="json"))

        attempt = MidtermAttempt.objects.get(pk=aid)
        self.assertEqual(attempt.current_state, MidtermAttempt.STATE_ACTIVE)
        self.assertFalse(attempt.is_completed)
        self.assertEqual(attempt.answers, {})

    def test_every_sitting_route_refuses_a_frozen_student(self):
        aid = self._create()
        self._start(aid)
        self._set_frozen(True)

        for method, path in DETAIL_ROUTES:
            with self.subTest(route=f"{method.upper()} {path or '<detail>'}"):
                r = getattr(self.client, method)(f"{ATTEMPTS}{aid}/{path}", {}, format="json")
                self.assertFrozenRefusal(r)
        self.assertEqual(MidtermAttempt.objects.get(pk=aid).offscreen_violations, 0)

    def test_an_unfrozen_student_is_unaffected(self):
        aid = self._create()
        self._start(aid)

        r = self.client.post(
            f"{ATTEMPTS}{aid}/save_attempt/", {"answers": {self.qids[0]: "a"}, "flagged": []}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_module_saved_answers"], {self.qids[0]: "a"})

    def test_lifting_the_freeze_restores_the_sitting(self):
        aid = self._create()
        self._start(aid)
        self._set_frozen(True)
        self.assertFrozenRefusal(self.client.get(f"{ATTEMPTS}{aid}/status/"))

        self._set_frozen(False)

        r = self.client.get(f"{ATTEMPTS}{aid}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_state"], "MODULE_1_ACTIVE")  # the API's name for STATE_ACTIVE
