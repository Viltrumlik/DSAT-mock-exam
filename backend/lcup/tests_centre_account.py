from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from lcup.accounts import CLAIM_DAYS, PhoneTaken, create_centre_account
from lcup.models import AccountClaim, LcupStudentLink
from users.models import SecurityAuditEvent, User

PHONE = "998901234567"
STRONG = "Kitob-va-Qalam-2026"


class CreateCentreAccountTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def make(self, phone=PHONE, name="Karimova Malika", **fields):
        return create_centre_account(name, phone, now=self.now, **fields)

    def test_the_account_is_made_the_existing_way(self):
        user = self.make()
        self.assertEqual((user.username, user.phone_number), (PHONE, PHONE))
        self.assertEqual((user.first_name, user.last_name), ("Malika", "Karimova"))
        self.assertEqual(user.role, "student")
        self.assertFalse(user.has_usable_password())
        claim = AccountClaim.objects.get(user=user)
        self.assertEqual((claim.phone, claim.expires_at), (PHONE, self.now + timedelta(days=CLAIM_DAYS)))

    def test_there_is_no_lc_up_link(self):
        self.make()
        self.assertFalse(LcupStudentLink.objects.exists())

    def test_it_can_carry_the_parent(self):
        user = self.make(parent_name="Karim", parent_phone="998907777777")
        user.refresh_from_db()
        self.assertEqual((user.parent_name, user.parent_phone), ("Karim", "998907777777"))

    def test_a_public_accounts_phone_moves_to_the_new_account(self):
        old = User.objects.create_user("old@example.com", password=STRONG, username="old", role="public_student", phone_number=PHONE)
        user = self.make()
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)
        self.assertEqual(old.email, "old@example.com")
        self.assertEqual(user.phone_number, PHONE)
        event = SecurityAuditEvent.objects.get(user=old, event_type="centre_phone_moved")
        self.assertEqual(event.detail["to_user_id"], user.pk)

    def test_a_public_account_with_the_phone_written_otherwise_moves_too(self):
        old = User.objects.create_user(None, password=STRONG, username="old", role="public_student", phone_number="+998 90 123 45 67")
        self.make()
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)

    def test_a_public_account_whose_login_is_the_phone_stops_it(self):
        old = User.objects.create_user(None, password=STRONG, username=PHONE, role="public_student", phone_number=PHONE)
        with self.assertRaises(PhoneTaken) as caught:
            self.make()
        self.assertEqual(caught.exception.account, old)
        old.refresh_from_db()
        self.assertEqual(old.phone_number, PHONE)

    def test_a_centre_account_stops_it_and_says_whose(self):
        old = User.objects.create_user(None, password=STRONG, username="c", role="student", phone_number=PHONE)
        with self.assertRaises(PhoneTaken) as caught:
            self.make()
        self.assertEqual(caught.exception.account, old)
        self.assertEqual(User.objects.count(), 1)

    def test_a_staff_account_stops_it(self):
        old = User.objects.create_user(None, password=STRONG, username="t", role="teacher", subject="math", phone_number=PHONE)
        with self.assertRaises(PhoneTaken) as caught:
            self.make()
        self.assertEqual(caught.exception.account, old)

    def test_someone_still_waiting_on_that_phone_stops_it(self):
        old = User.objects.create_user(None, password=None, username="w", role="student", phone_number="998900000001")
        AccountClaim.objects.create(user=old, phone=PHONE, expires_at=self.now + timedelta(days=1))
        with self.assertRaises(PhoneTaken) as caught:
            self.make()
        self.assertEqual(caught.exception.account, old)

    def test_a_used_claim_on_that_phone_does_not(self):
        old = User.objects.create_user(None, password=None, username="w", role="student", phone_number="998900000001")
        AccountClaim.objects.create(user=old, phone=PHONE, expires_at=self.now, password_set_at=self.now)
        self.assertEqual(self.make().phone_number, PHONE)


@override_settings(LCUP_ENABLED=False)
class FirstSignInWithLcupOffTests(TestCase):
    def setUp(self):
        cache.clear()  # the login throttle counts per IP across tests
        self.now = timezone.now()
        self.user = create_centre_account("Karimova Malika", PHONE, now=self.now)
        self.api = APIClient()

    def login(self, ident=PHONE, password="4567"):
        return self.api.post(
            "/api/auth/login/", {"email": ident, "password": password}, format="json",
            HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
        )

    def test_phone_and_its_last_four_digits_sign_in(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertIsNotNone(AccountClaim.objects.get(user=self.user).first_login_at)

    def test_a_wrong_code_does_not(self):
        self.assertEqual(self.login(password="0000").status_code, 401)

    def test_five_wrong_tries_still_lock_it(self):
        for _ in range(5):
            self.login(password="0000")
        cache.clear()
        self.assertIsNotNone(AccountClaim.objects.get(user=self.user).locked_at)
        self.assertEqual(self.login().status_code, 401)

    def test_after_fourteen_days_it_no_longer_works(self):
        AccountClaim.objects.filter(user=self.user).update(expires_at=self.now - timedelta(seconds=1))
        self.assertEqual(self.login().status_code, 401)

    def test_a_chosen_password_ends_it(self):
        self.user.set_password(STRONG)
        self.user.save()
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(self.login(password=STRONG).status_code, 200)
