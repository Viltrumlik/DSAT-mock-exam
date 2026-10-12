from datetime import timedelta

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from lcup.accounts import create_account_for
from lcup.auth_backend import LcupClaimBackend
from lcup.claims import password_requirement, set_initial_password
from lcup.models import AccountClaim, LcupStudentLink
from users.models import SecurityAuditEvent, User
from users.profile_completeness import missing_profile_fields

STRONG = "Kitob-va-Qalam-2026"


@override_settings(LCUP_ENABLED=True)
class ClaimLoginTests(TestCase):
    def setUp(self):
        cache.clear()  # the login throttle counts per IP across tests
        self.now = timezone.now()
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        self.user = create_account_for(link, now=self.now)
        self.api = APIClient()

    def login(self, ident, password):
        # The login view checks the browser origin, as users/tests_frozen_access.py does.
        return self.api.post(
            "/api/auth/login/",
            {"email": ident, "password": password},
            format="json",
            HTTP_ORIGIN="http://localhost:3000",
            HTTP_REFERER="http://localhost:3000/login",
        )

    def test_phone_and_its_last_four_digits_sign_in(self):
        self.assertEqual(self.login("+998 90 123 45 67", "4567").status_code, 200)
        claim = AccountClaim.objects.get(user=self.user)
        self.assertIsNotNone(claim.first_login_at)
        self.assertTrue(SecurityAuditEvent.objects.filter(user=self.user, event_type="lcup_claim_login").exists())

    def test_five_wrong_codes_lock_the_claim(self):
        for _ in range(5):
            self.assertEqual(self.login("998901234567", "0000").status_code, 401)
        self.assertEqual(self.login("998901234567", "4567").status_code, 401)
        self.assertIsNotNone(AccountClaim.objects.get(user=self.user).locked_at)

    def test_an_expired_code_no_longer_works(self):
        AccountClaim.objects.filter(user=self.user).update(expires_at=self.now - timedelta(minutes=1))
        self.assertEqual(self.login("998901234567", "4567").status_code, 401)

    def test_after_choosing_a_password_only_that_password_works(self):
        set_initial_password(self.user, STRONG, now=self.now)
        self.assertEqual(self.login("998901234567", "4567").status_code, 401)
        self.assertEqual(self.login("998901234567", STRONG).status_code, 200)

    def test_an_account_with_a_usable_password_is_never_let_in_by_the_code(self):
        self.user.set_password(STRONG)
        self.user.save()
        self.assertIsNone(LcupClaimBackend().authenticate(None, username="998901234567", password="4567"))

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_signs_in_while_the_integration_is_off(self):
        self.assertEqual(self.login("998901234567", "4567").status_code, 401)


@override_settings(LCUP_ENABLED=True)
class PasswordRequirementTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        self.user = create_account_for(link, now=self.now)

    def test_a_claimed_account_is_asked_for_a_password_first(self):
        self.assertEqual(password_requirement(self.user), ["password"])
        self.assertEqual(missing_profile_fields(self.user)[0], "password")
        api = APIClient()
        api.force_authenticate(self.user)
        self.assertEqual(api.get("/api/users/me/").data["missing_fields"][0], "password")

    def test_the_requirement_is_gone_once_a_password_is_chosen(self):
        set_initial_password(self.user, STRONG, now=self.now)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG))
        self.assertNotIn("password", missing_profile_fields(self.user))
        self.assertIsNotNone(AccountClaim.objects.get(user=self.user).password_set_at)

    def test_a_weak_password_is_refused(self):
        with self.assertRaises(ValidationError):
            set_initial_password(self.user, "1234", now=self.now)

    def test_without_an_open_claim_there_is_nothing_to_set(self):
        set_initial_password(self.user, STRONG, now=self.now)
        with self.assertRaises(PermissionError):
            set_initial_password(self.user, STRONG + "x", now=self.now)

    def test_a_regular_account_is_unaffected(self):
        regular = User.objects.create_user("someone@example.com", password=STRONG, username="someone", role="student")
        self.assertEqual(password_requirement(regular), [])
        self.assertNotIn("password", missing_profile_fields(regular))
        google_only = User.objects.create_user("g@example.com", password=None, username="gonly", role="student")
        self.assertEqual(password_requirement(google_only), [])
