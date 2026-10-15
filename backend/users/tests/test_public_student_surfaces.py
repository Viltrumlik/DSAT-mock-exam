"""A public learner reaches only mocks, events, their profile and sign-in (plan 2026-10-13).

The host guard's allowlist is the gate (many student endpoints check no role at all, and DRF's
default admits any signed-in user); these tests pin it, and the per-surface refusals behind it.
"""

from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import get_resolver
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C
from access.host_guard import public_student_may
from desktop.models import DesktopAuthCode
from desktop.proof import new_secret, pkce_challenge, sha256_hex
from users.models import User

#: The top-level API namespaces a public learner may enter at all. Pinned on purpose: a new app is
#: closed to them until this set (and host_guard.PUBLIC_STUDENT_API_PREFIXES) says otherwise.
PUBLIC_NAMESPACES = {
    "/api/auth/", "/api/users/", "/api/mocks/", "/api/events/", "/api/notifications/",
    "/api/realtime/", "/api/annotations/", "/api/question-reports/", "/api/health/",
    "/api/schema/", "/api/csp-report/",
}


def top_level_api_prefixes() -> set[str]:
    out = set()
    for p in get_resolver().url_patterns:
        route = str(p.pattern).lstrip("^")
        parts = route.split("/")
        if parts[0] == "api" and len(parts) > 1 and parts[1]:
            out.add(f"/api/{parts[1]}/")
    return out


def bearer(user) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}


class GateTests(TestCase):
    def setUp(self):
        self.pub = User.objects.create_user("p@example.com", password="x", username="pub", role=C.ROLE_PUBLIC_STUDENT)

    def test_every_other_api_namespace_is_closed_to_public_learners(self):
        prefixes = top_level_api_prefixes()
        self.assertIn("/api/classes/", prefixes)  # the walk found the real URLconf
        for prefix in prefixes - PUBLIC_NAMESPACES:
            self.assertFalse(public_student_may(prefix + "x/"), prefix)

    def test_inside_users_only_me_and_sign_in_paths_are_open(self):
        for open_path in ("/api/users/me/", "/api/users/google/", "/api/users/telegram/start/", "/api/users/exam-dates/"):
            self.assertTrue(public_student_may(open_path), open_path)
        for closed in ("/api/users/admin/list/", "/api/users/42/update/", "/api/users/activity/"):
            self.assertFalse(public_student_may(closed), closed)

    def test_mock_sessions_stay_with_the_learning_center(self):
        self.assertTrue(public_student_may("/api/mocks/mine/"))
        self.assertTrue(public_student_may("/api/mocks/attempts/5/status/"))
        self.assertFalse(public_student_may("/api/mocks/sessions/join/"))

    def test_a_leaver_reads_only_their_own_finished_attempts_and_nothing_else_in_exams(self):
        # Read-only exceptions (owner decision 2026-10-14): list, detail, review, results. GET/HEAD only.
        self.assertTrue(public_student_may("/api/exams/attempts/", "GET"))
        self.assertTrue(public_student_may("/api/exams/attempts/", "HEAD"))
        self.assertTrue(public_student_may("/api/exams/attempts/5/", "GET"))
        self.assertTrue(public_student_may("/api/exams/attempts/5/review/", "GET"))
        self.assertTrue(public_student_may("/api/exams/attempts/5/results/", "GET"))
        self.assertFalse(public_student_may("/api/exams/attempts/", "POST"))
        self.assertFalse(public_student_may("/api/exams/attempts/5/review/", "POST"))
        self.assertFalse(public_student_may("/api/exams/attempts/5/resume/", "POST"))
        for closed in (
            "/api/exams/", "/api/exams/7/", "/api/exams/attempts/5/status/", "/api/exams/attempts/5/start/",
            "/api/exams/attempts/5/save_attempt/", "/api/exams/attempts/x/", "/api/exams/attempts/5/review/x/",
            "/api/exams/attempts/5/results/extra/", "/api/exams/admin/attempts/", "/api/exams/practice-packs/",
            # `$` would accept a trailing newline and `\d` any Unicode digit (Python's int() reads them, so the
            # router would resolve `\u0665` as attempt 5): an access boundary is ASCII and fully anchored.
            "/api/exams/attempts/\n", "/api/exams/attempts/5/\n", "/api/exams/attempts/5/review/\n",
            "/api/exams/attempts/5/results/\n", "/api/exams/attempts/\u0665/", "/api/exams/attempts/\u0665/review/",
            "/api/exams/attempts/\uff15/results/", "/api/exams/attempts//", "/api/exams/attempts/5",
        ):
            self.assertFalse(public_student_may(closed, "GET"), repr(closed))

    def test_a_refused_request_says_centre_only(self):
        api = APIClient()
        resp = api.get("/api/classes/", **bearer(self.pub))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "centre_only")
        self.assertEqual(api.get("/api/mocks/mine/", **bearer(self.pub)).status_code, 200)
        self.assertEqual(api.get("/api/users/me/", **bearer(self.pub)).status_code, 200)

    def test_a_learning_center_student_is_not_gated(self):
        s = User.objects.create_user("s@example.com", password="x", username="stu", role=C.ROLE_STUDENT)
        resp = APIClient().get("/api/classes/", **bearer(s))
        self.assertNotEqual(resp.status_code, 403)

    @override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
    def test_the_admin_console_refuses_a_public_learner_too(self):
        resp = APIClient().get("/api/users/admin/list/", HTTP_HOST="admin.mastersat.uz", **bearer(self.pub))
        self.assertEqual(resp.status_code, 403)


class NativeAppTests(TestCase):
    PASSWORD = "Kitob-va-Qalam-2026"

    def setUp(self):
        cache.clear()
        User.objects.create_user("p@example.com", password=self.PASSWORD, username="pubapp", role=C.ROLE_PUBLIC_STUDENT)

    def login(self, client_header):
        return APIClient().post(
            "/api/auth/login/", {"email": "pubapp", "password": self.PASSWORD}, format="json",
            HTTP_X_MASTERSAT_CLIENT=client_header,
        )

    def test_the_ios_and_windows_apps_refuse_a_public_learner(self):
        for header in ("ios/1.4.0", "windows/0.2.5", "desktop"):
            resp = self.login(header)
            self.assertEqual(resp.status_code, 403, header)
            self.assertIn("learning center students", resp.json()["detail"])

    @override_settings(ALLOWED_HOSTS=["testserver", "mastersat.uz"])
    def test_the_browser_still_signs_a_public_learner_in(self):
        resp = APIClient().post(
            "/api/auth/login/", {"email": "pubapp", "password": self.PASSWORD}, format="json",
            HTTP_HOST="mastersat.uz", HTTP_ORIGIN="https://mastersat.uz",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_a_learning_center_student_still_signs_in_on_the_apps(self):
        User.objects.create_user("s@example.com", password=self.PASSWORD, username="stuapp", role=C.ROLE_STUDENT)
        resp = APIClient().post(
            "/api/auth/login/", {"email": "stuapp", "password": self.PASSWORD}, format="json",
            HTTP_X_MASTERSAT_CLIENT="windows/0.2.5",
        )
        self.assertEqual(resp.status_code, 200, resp.content)


class DesktopTests(TestCase):
    """The host guard already closes /api/desktop/ to public learners; these pin the views' own
    refusals behind it, so the apps stay shut if the allowlist ever opens wider."""

    VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

    def setUp(self):
        cache.clear()
        self.pub = User.objects.create_user("p@example.com", password="x", username="pubdesk", role=C.ROLE_PUBLIC_STUDENT)

    def test_the_browser_will_not_mint_a_public_learner_an_app_code(self):
        from desktop.views import AuthCodeView

        request = APIRequestFactory().post(
            "/api/desktop/auth/code/", {"challenge": pkce_challenge(self.VERIFIER)}, format="json"
        )
        force_authenticate(request, user=self.pub)
        resp = AuthCodeView.as_view()(request)
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(DesktopAuthCode.objects.exists())

    def test_a_code_minted_before_the_split_is_refused_at_the_exchange(self):
        code = new_secret()
        DesktopAuthCode.objects.create(
            code_hash=sha256_hex(code), challenge=pkce_challenge(self.VERIFIER), user=self.pub,
            expires_at=timezone.now() + timedelta(seconds=60),
        )
        resp = APIClient().post(
            "/api/desktop/auth/exchange/", {"code": code, "verifier": self.VERIFIER}, format="json",
            HTTP_X_MASTERSAT_CLIENT="windows/0.2.6",
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertIn("learning center students", resp.json()["detail"])

    @override_settings(DESKTOP_V1_ENABLED=True)
    def test_v1_refuses_a_public_learner_who_still_holds_tokens(self):
        from desktop.v1.home import HomeView

        request = APIRequestFactory().get("/api/desktop/v1/home", HTTP_X_MASTERSAT_CLIENT="windows/0.2.6")
        force_authenticate(request, user=self.pub)
        resp = HomeView.as_view()(request)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "forbidden")


class SurfaceTests(TestCase):
    """Each surface refuses a public learner on its own, behind the gate."""

    def setUp(self):
        self.pub = User.objects.create_user("p@example.com", password="x", username="pubsurf", role=C.ROLE_PUBLIC_STUDENT)
        self.stu = User.objects.create_user("s@example.com", password="x", username="stusurf", role=C.ROLE_STUDENT)

    def test_join_by_code_refuses_a_public_learner(self):
        from classes.views import JoinClassView

        request = APIRequestFactory().post("/api/classes/join/", {"join_code": "ANY"}, format="json")
        force_authenticate(request, user=self.pub)
        resp = JoinClassView.as_view()(request)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "centre_only")

    def test_mock_sessions_refuse_a_public_learner(self):
        from mocks import sessions

        place, reason = sessions.request_place(self.pub, "123456")
        self.assertIsNone(place)
        self.assertEqual(reason, sessions.REASON_CENTRE_ONLY)
        self.assertIn(reason, sessions.REASON_DETAIL)

    def test_my_mock_sessions_is_empty_for_a_public_learner(self):
        from mocks.views_session import MyMockSessionsView

        request = APIRequestFactory().get("/api/mocks/sessions/mine/")
        force_authenticate(request, user=self.pub)
        self.assertEqual(MyMockSessionsView.as_view()(request).data, {"results": []})

    def test_a_public_learner_lists_and_takes_every_published_mock(self):
        from mocks.tests_scoring import make_mock

        mock, _mods = make_mock()
        api = APIClient()
        listed = api.get("/api/mocks/mine/", **bearer(self.pub))
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertIn(mock.pk, [row["mock_id"] for row in listed.json()["results"]])
        made = api.post("/api/mocks/attempts/", {"mock": mock.pk}, format="json", **bearer(self.pub))
        self.assertEqual(made.status_code, 201, made.content)
        started = api.post(f"/api/mocks/attempts/{made.json()['id']}/start/", {}, format="json", **bearer(self.pub))
        self.assertEqual(started.json()["current_state"], "MODULE_1_ACTIVE")

    def test_a_frozen_public_learner_cannot_start_a_mock(self):
        from mocks.tests_scoring import make_mock

        mock, _mods = make_mock()
        User.objects.filter(pk=self.pub.pk).update(is_frozen=True)
        resp = APIClient().post("/api/mocks/attempts/", {"mock": mock.pk}, format="json", **bearer(self.pub))
        self.assertEqual(resp.status_code, 403)

    def test_practice_packs_are_none_for_a_public_learner(self):
        from exams.views import PracticeTestPackStudentListView

        from django.db.models.query import EmptyQuerySet

        # Without the check a public learner fell through to the staff branch: every pack,
        # published or not.
        view = PracticeTestPackStudentListView()
        view.request = type("R", (), {"user": self.pub})()
        self.assertIsInstance(view.get_queryset(), EmptyQuerySet)

    def test_telegram_may_remove_a_public_learner_from_a_class_group(self):
        from classes.telegram_group import may_enforce_against

        self.assertTrue(may_enforce_against(self.pub, "member"))
        self.assertTrue(may_enforce_against(self.stu, "member"))

    def test_grants_skip_public_targets(self):
        from access.views import EngineGrantSubjectView

        admin = User.objects.create_user("a@example.com", password="x", username="adm", role=C.ROLE_SUPER_ADMIN)
        request = APIRequestFactory().post(
            "/api/access/grants/subject/", {"user_ids": [self.pub.pk, self.stu.pk], "subject": "math"}, format="json"
        )
        force_authenticate(request, user=admin)
        resp = EngineGrantSubjectView.as_view()(request)
        self.assertEqual(resp.status_code, 201, resp.data)
        from access.models import UserAccess

        self.assertTrue(UserAccess.objects.filter(user=self.stu, subject="math").exists())
        self.assertFalse(UserAccess.objects.filter(user=self.pub).exists())

    def test_the_single_grant_refuses_a_public_target(self):
        from access.models import UserAccess

        admin = User.objects.create_user("a@example.com", password="x", username="adm", role=C.ROLE_SUPER_ADMIN)
        api = APIClient()
        api.force_authenticate(admin)
        resp = api.post("/api/access/grant/", {"user_id": self.pub.pk, "subject": "math"}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(UserAccess.objects.filter(user=self.pub).exists())


class EventsTests(TestCase):
    """A public learner may hold a seat at an event; attending earns XP for a centre student only."""

    def setUp(self):
        from rewards import constants as RC
        from rewards.models import RewardRule

        from events.models import Event

        self.staff = User.objects.create_user("ops@example.com", password="x", username="evops", role=C.ROLE_ADMIN)
        self.pub = User.objects.create_user("p@example.com", password="x", username="evpub", role=C.ROLE_PUBLIC_STUDENT)
        self.stu = User.objects.create_user("s@example.com", password="x", username="evstu", role=C.ROLE_STUDENT)
        self.now = timezone.now()
        self.event = Event.objects.create(
            title="Career talk", starts_at=self.now + timedelta(days=1),
            ends_at=self.now + timedelta(days=1, hours=2), seats=20, status=Event.STATUS_PUBLISHED,
            published_at=self.now - timedelta(days=2), created_by=self.staff,
        )
        RewardRule.objects.get_or_create(event=RC.EVENT_ATTENDED, defaults={"points": 10, "grants_xp": True})

    def test_a_public_learner_may_sign_up(self):
        from events import services

        self.assertTrue(services.is_signupable_student(self.pub))
        self.assertIn(self.pub, services.active_students())
        services.sign_up(self.event, self.pub, now=self.now)

    def test_attendance_awards_a_centre_student_only(self):
        from events import services
        from events.models import EventRegistration
        from rewards import constants as RC
        from rewards.models import PointAward

        during = self.event.starts_at + timedelta(minutes=5)
        rows = {u.pk: services.sign_up(self.event, u, now=self.now) for u in (self.pub, self.stu)}
        for row in rows.values():
            services.mark_attendance(row, EventRegistration.ATTENDANCE_ATTENDED, actor=self.staff, now=during)
        self.assertFalse(PointAward.objects.filter(idempotency_key=RC.event_attendance_key(rows[self.pub.pk].pk)).exists())
        self.assertEqual(PointAward.objects.filter(idempotency_key=RC.event_attendance_key(rows[self.stu.pk].pk)).count(), 1)


class BroadcastTests(TestCase):
    def test_the_new_audiences_pick_the_right_people(self):
        from notifications.serializers import AUDIENCE_CHOICES
        from notifications.views import _AUDIENCE_ROLES

        for audience in ("centre_students", "public_students", "all_students"):
            self.assertIn(audience, AUDIENCE_CHOICES)
        self.assertEqual(set(_AUDIENCE_ROLES["centre_students"]), {C.ROLE_STUDENT})
        self.assertEqual(set(_AUDIENCE_ROLES["public_students"]), {C.ROLE_PUBLIC_STUDENT})
        self.assertEqual(set(_AUDIENCE_ROLES["all_students"]), set(C.LEARNER_ROLES))
        self.assertEqual(set(_AUDIENCE_ROLES["students"]), {C.ROLE_STUDENT})
