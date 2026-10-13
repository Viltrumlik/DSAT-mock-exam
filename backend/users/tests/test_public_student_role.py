"""public_student is a real role: it normalizes to itself, holds no permission, is blocked when
frozen, and cannot be granted staff powers by a per-user override (plan 2026-10-13)."""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from access import constants as C
from access.services import get_effective_permission_codenames, normalized_role
from users.models import User
from users.serializers import UserSerializer
from users.views import RegistrationRateThrottle


def public(username="pub", **kw):
    return User.objects.create_user(
        f"{username}@example.com", password="Pass-12345678", username=username, role=C.ROLE_PUBLIC_STUDENT, **kw
    )


class RoleBasicsTests(TestCase):
    def test_the_role_is_canonical_and_normalizes_to_itself(self):
        self.assertIn(C.ROLE_PUBLIC_STUDENT, C.CANONICAL_ROLES)
        self.assertIn((C.ROLE_PUBLIC_STUDENT, "Public student"), C.ROLE_CHOICES)
        self.assertEqual(C.LEARNER_ROLES, frozenset({C.ROLE_STUDENT, C.ROLE_PUBLIC_STUDENT}))
        self.assertEqual(normalized_role(public()), C.ROLE_PUBLIC_STUDENT)

    def test_it_holds_no_permission_not_even_submit_test(self):
        self.assertEqual(get_effective_permission_codenames(public()), frozenset())

    def test_every_canonical_role_has_a_rank(self):
        self.assertTrue(C.CANONICAL_ROLES <= set(UserSerializer._ROLE_RANK))

    def test_a_frozen_public_student_is_blocked_on_default_permission_views(self):
        api = APIClient()
        api.force_authenticate(public(is_frozen=True))
        self.assertEqual(api.patch("/api/users/me/", {"first_name": "X"}, format="json").status_code, 403)


_OPEN_RATE = patch.object(
    RegistrationRateThrottle, "THROTTLE_RATES", {**RegistrationRateThrottle.THROTTLE_RATES, "register": "1000/hour"}
)


@override_settings(PUBLIC_SPLIT_ENABLED=True, GOOGLE_CLIENT_ID="ours.apps.googleusercontent.com")
class SignUpRoleTests(TestCase):
    """An account made on the site itself is a public learner; one an administrator makes, or the
    lc-up sync makes, is a learning-center student."""

    def setUp(self):
        cache.clear()

    @_OPEN_RATE
    def test_self_registration_is_public(self):
        resp = APIClient().post(reverse("user-register"), {
            "email": "newbie@test.com", "username": "newbie", "first_name": "New", "last_name": "Bie",
            "password": "secret12345",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(User.objects.get(username="newbie").role, C.ROLE_PUBLIC_STUDENT)

    @_OPEN_RATE
    def test_self_registration_cannot_pick_its_own_role(self):
        resp = APIClient().post(reverse("user-register"), {
            "email": "sneaky@test.com", "username": "sneaky", "first_name": "Sardor", "last_name": "Nazarov",
            "password": "secret12345", "role": "student",
        }, format="json")
        self.assertNotEqual(resp.status_code, 201)
        self.assertFalse(User.objects.filter(username="sneaky", role=C.ROLE_STUDENT).exists())

    def test_an_admin_creating_without_a_role_still_makes_a_centre_student(self):
        admin = User.objects.create_user("a@test.com", password="x", username="adm", role=C.ROLE_SUPER_ADMIN)
        request = type("R", (), {"user": admin})()
        s = UserSerializer(data={"email": "c@test.com", "username": "centrekid", "password": "secret12345"},
                           context={"request": request})
        s.is_valid(raise_exception=True)
        self.assertEqual(s.save().role, C.ROLE_STUDENT)

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_google_sign_up_is_public(self, verify):
        verify.return_value = {"email": "g@test.com", "email_verified": True, "given_name": "Gulnora", "family_name": "Latipova"}
        resp = APIClient().post("/api/users/google/", {"credential": "a-token"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(User.objects.get(email="g@test.com").role, C.ROLE_PUBLIC_STUDENT)

    def test_telegram_sign_up_is_public(self):
        from users.views import _create_telegram_user

        u = _create_telegram_user(email="tg_1@telegram.local", base_username="tguser", first_name="Tg", last_name="")
        self.assertEqual(u.role, C.ROLE_PUBLIC_STUDENT)

    @override_settings(PUBLIC_SPLIT_ENABLED=False)
    @_OPEN_RATE
    def test_with_the_switch_off_sign_up_is_still_a_student(self):
        resp = APIClient().post(reverse("user-register"), {
            "email": "off@test.com", "username": "offswitch", "first_name": "Ofelia", "last_name": "Fayz", "password": "secret12345",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(User.objects.get(username="offswitch").role, C.ROLE_STUDENT)
