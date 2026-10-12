from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from lcup.models import MAX_CLAIM_FAILURES, AccountClaim, LcupState
from users.models import User


class AccountClaimTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.user = User.objects.create_user(None, password=None, username="998901234567", role="student")
        self.claim = AccountClaim.objects.create(
            user=self.user, phone="998901234567", expires_at=self.now + timedelta(days=14)
        )

    def test_fresh_claim_can_attempt(self):
        self.assertTrue(self.claim.can_attempt(self.now))

    def test_failures_lock_at_the_limit(self):
        for _ in range(MAX_CLAIM_FAILURES - 1):
            self.claim.record_failure(self.now)
        self.assertTrue(self.claim.can_attempt(self.now))
        self.claim.record_failure(self.now)
        self.claim.refresh_from_db()
        self.assertEqual(self.claim.failed_attempts, MAX_CLAIM_FAILURES)
        self.assertIsNotNone(self.claim.locked_at)
        self.assertFalse(self.claim.can_attempt(self.now))

    def test_expired_claim_cannot_attempt(self):
        self.assertFalse(self.claim.can_attempt(self.now + timedelta(days=15)))

    def test_finished_claim_cannot_attempt(self):
        self.claim.password_set_at = self.now
        self.assertFalse(self.claim.can_attempt(self.now))

    def test_success_resets_failures_and_stamps_first_login_once(self):
        self.claim.record_failure(self.now)
        self.claim.record_success(self.now)
        later = self.now + timedelta(hours=1)
        self.claim.record_success(later)
        self.claim.refresh_from_db()
        self.assertEqual(self.claim.failed_attempts, 0)
        self.assertEqual(self.claim.first_login_at, self.now)


class LcupStateTests(TestCase):
    def test_singleton(self):
        self.assertEqual(LcupState.get().pk, LcupState.get().pk)
        self.assertEqual(LcupState.objects.count(), 1)
