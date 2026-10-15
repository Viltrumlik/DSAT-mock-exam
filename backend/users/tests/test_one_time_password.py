"""A one-time password from the person page (owner, 2026-10-15: "new password kerak emas uning o'rniga
… give one time password bo'lsin, shuni bosganda yana telefoni 4ta raqamiga qaytsin bir martalik qilib").

The password goes; the account signs in ONCE with its phone and the phone's last four digits, and the
completion gate then asks for a new password before anything else opens.
"""

from django.contrib.auth import authenticate
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from lcup.claims import password_requirement
from lcup.models import AccountClaim
from users.models import RefreshSession, SecurityAuditEvent, User

HOST = "admin.mastersat.uz"
PHONE = "998901234567"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password="Old-password-1", username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST], LCUP_ENABLED=True)
class OneTimePasswordTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN, first_name="Bo", last_name="Ss")
        self.kid = make("aziz", phone_number=PHONE, first_name="Aziz", last_name="Tursunov")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def post(self, user):
        return self.api.post(f"/api/users/admin/people/{user.pk}/one-time-password/", HTTP_HOST=HOST)

    def test_the_password_goes_and_the_phone_signs_in_once(self):
        RefreshSession.objects.create(user=self.kid, refresh_jti="live")
        r = self.post(self.kid)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["login"], r.json()["code"]), (PHONE, "4567"))

        self.kid.refresh_from_db()
        self.assertFalse(self.kid.has_usable_password())
        self.assertIsNone(authenticate(username="aziz", password="Old-password-1"))
        self.assertFalse(RefreshSession.objects.filter(user=self.kid, revoked_at__isnull=True).exists())

        signed_in = authenticate(username=PHONE, password="4567")
        self.assertEqual(signed_in, self.kid)
        # ...and the very next thing the app asks for is a new password.
        self.assertEqual(password_requirement(self.kid), ["password"])

        ev = SecurityAuditEvent.objects.get(user=self.kid, event_type="admin_one_time_password")
        self.assertEqual(ev.detail["actor_id"], self.admin.pk)

    def test_a_used_claim_is_reopened_not_duplicated(self):
        AccountClaim.objects.create(
            user=self.kid, phone=PHONE, expires_at=timezone.now(), password_set_at=timezone.now(), failed_attempts=4
        )
        self.post(self.kid)
        claim = AccountClaim.objects.get(user=self.kid)
        self.assertIsNone(claim.password_set_at)
        self.assertEqual((claim.failed_attempts, claim.reissued_count), (0, 1))
        self.assertGreater(claim.expires_at, timezone.now())

    def test_another_accounts_spent_claim_on_the_phone_does_not_block_the_sign_in(self):
        old = make("old", C.ROLE_PUBLIC_STUDENT)
        AccountClaim.objects.create(user=old, phone=PHONE, expires_at=timezone.now(), password_set_at=timezone.now())
        self.assertEqual(self.post(self.kid).status_code, 200)
        self.assertEqual(authenticate(username=PHONE, password="4567"), self.kid)

    def test_an_account_without_a_phone_is_refused(self):
        nophone = make("nophone")
        r = self.post(nophone)
        self.assertEqual(r.status_code, 409)
        self.assertIn("no phone number", r.json()["detail"])
        nophone.refresh_from_db()
        self.assertTrue(nophone.has_usable_password())

    def test_another_open_claim_on_the_phone_is_refused(self):
        other = make("other", C.ROLE_PUBLIC_STUDENT)
        AccountClaim.objects.create(user=other, phone=PHONE, expires_at=timezone.now())
        self.assertEqual(self.post(self.kid).status_code, 409)

    def test_admins_and_yourself_are_refused(self):
        other_admin = make("chief", C.ROLE_ADMIN, phone_number="998907654321")
        self.assertEqual(self.post(other_admin).status_code, 400)
        self.assertEqual(self.post(self.admin).status_code, 400)

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_changes_while_one_time_sign_in_is_off(self):
        self.assertEqual(self.post(self.kid).status_code, 409)
        self.kid.refresh_from_db()
        self.assertTrue(self.kid.has_usable_password())

    def test_the_page_says_a_one_time_password_is_open(self):
        url = f"/api/users/admin/people/{self.kid.pk}/"
        self.assertIsNone(self.api.get(url, HTTP_HOST=HOST).json()["one_time_password"])
        self.post(self.kid)
        otp = self.api.get(url, HTTP_HOST=HOST).json()["one_time_password"]
        self.assertEqual((otp["used"], otp["locked"]), (False, False))
        self.assertIsNotNone(otp["expires_at"])
