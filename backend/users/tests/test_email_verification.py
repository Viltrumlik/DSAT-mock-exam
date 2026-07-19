"""Proof-of-control flow: request a code, confirm it, and the rules for taking an
address off someone else.

    python manage.py test users.tests.test_email_verification \
        --settings=config.settings_test_nomigrations

Every request here goes to ``/api/auth/…``, where ``config.csrf_api`` enforces CSRF
unconditionally and treats a request with neither Origin nor Referer as a bad origin —
so the headers below are load-bearing, not decoration.
"""
from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from users.email_utils import RELEASED_EMAIL_DOMAIN, synthetic_telegram_email
from users.models import EmailClaim

User = get_user_model()

ORIGIN = {"HTTP_ORIGIN": "http://localhost:3000", "HTTP_REFERER": "http://localhost:3000/profile"}
FIXED_CODE = "424242"


def _no_throttle(cls):
    """Disable one throttle class for a test.

    ``override_settings(REST_FRAMEWORK=…)`` does not reach DRF throttles: they bind
    ``SimpleRateThrottle.THROTTLE_RATES`` to the settings dict at import time.
    """
    return patch.object(cls, "THROTTLE_RATES", {**cls.THROTTLE_RATES, cls.scope: None})


class EmailVerificationFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        cache.clear()
        self.user = User.objects.create_user(
            email="claimant@test.com", username="claimant", password="secret12345",
            role="student", first_name="Clai", last_name="Mant",
        )
        self.client.force_authenticate(self.user)

    def tearDown(self):
        cache.clear()

    def _request(self, email="real.person@gmail.com"):
        with patch("users.email_verification._generate_code", return_value=FIXED_CODE):
            return self.client.post(
                reverse("auth-email-request-code"), {"email": email}, format="json", **ORIGIN
            )

    def _confirm(self, email="real.person@gmail.com", code=FIXED_CODE):
        return self.client.post(
            reverse("auth-email-confirm-code"), {"email": email, "code": code},
            format="json", **ORIGIN,
        )

    # ── Happy path ───────────────────────────────────────────────────────────
    def test_request_creates_a_pending_claim(self):
        r = self._request()
        self.assertEqual(r.status_code, 202, r.content)
        claim = EmailClaim.objects.get(user=self.user)
        self.assertEqual(claim.target_email, "real.person@gmail.com")
        self.assertEqual(claim.status, EmailClaim.STATUS_PENDING)
        self.assertNotIn(FIXED_CODE, claim.code_hash, "the code must be stored hashed")

    def test_confirm_sets_the_address_and_marks_it_verified(self):
        self._request()
        r = self._confirm()
        self.assertEqual(r.status_code, 200, r.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "real.person@gmail.com")
        self.assertTrue(self.user.email_verified)
        self.assertIsNotNone(self.user.email_verified_at)
        self.assertEqual(
            EmailClaim.objects.get(user=self.user).status, EmailClaim.STATUS_CONFIRMED
        )

    def test_target_is_normalized(self):
        self._request(email="  Real.Person@GMAIL.com  ")
        r = self._confirm(email="real.person@gmail.com")
        self.assertEqual(r.status_code, 200, r.content)

    # ── Code handling ────────────────────────────────────────────────────────
    def test_wrong_code_is_rejected_and_counted(self):
        self._request()
        r = self._confirm(code="000000")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["code"], "bad_code")
        self.assertEqual(EmailClaim.objects.get(user=self.user).attempts, 1)
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_claim_burns_after_five_wrong_codes(self):
        self._request()
        with _no_throttle(__import__("users.throttles", fromlist=["x"]).EmailConfirmThrottle):
            for _ in range(EmailClaim.MAX_ATTEMPTS):
                self._confirm(code="000000")
        claim = EmailClaim.objects.get(user=self.user)
        self.assertEqual(claim.status, EmailClaim.STATUS_BURNED)
        # The right code no longer helps — a burned claim is not pending.
        self.assertEqual(self._confirm().status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_expired_code_is_rejected(self):
        self._request()
        claim = EmailClaim.objects.get(user=self.user)
        claim.expires_at = timezone.now() - timezone.timedelta(minutes=1)
        claim.save(update_fields=["expires_at"])
        r = self._confirm()
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["code"], "expired")
        self.assertEqual(EmailClaim.objects.get(pk=claim.pk).status, EmailClaim.STATUS_EXPIRED)

    def test_confirm_without_a_request_fails(self):
        r = self._confirm()
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["code"], "no_claim")

    def test_another_users_claim_cannot_be_consumed(self):
        other = User.objects.create_user(
            email="other@test.com", username="otherone", password="secret12345", role="student",
        )
        with patch("users.email_verification._generate_code", return_value=FIXED_CODE):
            from users.email_verification import issue_code
            issue_code(other, "real.person@gmail.com")
        # self.user never requested anything, so there is no claim of theirs to consume.
        r = self._confirm()
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["code"], "no_claim")

    # ── Delivery gating ──────────────────────────────────────────────────────
    def test_nothing_is_sent_while_sending_is_disabled(self):
        # Django always defines EMAIL_BACKEND / DEFAULT_FROM_EMAIL, so a guard that
        # tests those is always true and would try to reach an SMTP server that does
        # not exist. Delivery must key off the explicit flag only.
        from django.core import mail

        with override_settings(EMAIL_SENDING_ENABLED=False):
            self._request()
        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(EmailClaim.objects.filter(user=self.user).exists(),
                        "the claim is still created; only delivery is inert")

    @override_settings(EMAIL_SENDING_ENABLED=True)
    def test_code_is_mailed_once_sending_is_enabled(self):
        from django.core import mail

        self._request()
        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["real.person@gmail.com"])
        self.assertIn(FIXED_CODE, sent.body)

    @override_settings(EMAIL_SENDING_ENABLED=True)
    def test_message_carries_both_a_text_and_an_html_part(self):
        # HTML rendering is deliberately non-fatal, so a broken template would otherwise
        # degrade to text-only in silence. Some clients show only the text part, which is
        # why the code has to be in both.
        from django.core import mail

        self._request()
        sent = mail.outbox[0]
        self.assertIn(FIXED_CODE, sent.body)
        self.assertIn("do not reply", sent.body.lower())
        self.assertEqual(len(sent.alternatives), 1)
        html, mimetype = sent.alternatives[0][0], sent.alternatives[0][1]
        self.assertEqual(mimetype, "text/html")
        self.assertIn(FIXED_CODE, html)
        self.assertNotIn("{{", html, "template placeholders must be substituted")

    @override_settings(EMAIL_SENDING_ENABLED=True, DEFAULT_FROM_EMAIL="MasterSAT <support@mastersat.uz>")
    def test_sender_is_the_support_address(self):
        from django.core import mail

        self._request()
        self.assertEqual(mail.outbox[0].from_email, "MasterSAT <support@mastersat.uz>")

    @override_settings(EMAIL_SENDING_ENABLED=True)
    def test_nothing_is_mailed_to_a_placeholder_address(self):
        from django.core import mail
        from users.email_verification import deliver_code

        claim = EmailClaim.objects.create(
            user=self.user,
            target_email=synthetic_telegram_email(999),
            code_hash="x",
            expires_at=timezone.now() + timezone.timedelta(minutes=5),
        )
        self.assertFalse(deliver_code(claim, FIXED_CODE))
        self.assertEqual(len(mail.outbox), 0)

    # ── Placeholder addresses ────────────────────────────────────────────────
    def test_synthetic_address_cannot_be_requested(self):
        r = self._request(email=synthetic_telegram_email(12345))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["code"], "not_deliverable")

    def test_released_placeholder_cannot_be_requested(self):
        r = self._request(email=f"released-9-abcd1234@{RELEASED_EMAIL_DOMAIN}")
        self.assertEqual(r.status_code, 400, r.content)


class EmailClaimContestedTests(TestCase):
    """What happens when the address already sits on somebody else's account."""

    def setUp(self):
        self.client = APIClient()
        cache.clear()
        self.claimant = User.objects.create_user(
            email="claimant@test.com", username="claimant", password="secret12345",
            role="student", first_name="Clai", last_name="Mant",
        )
        self.client.force_authenticate(self.claimant)

    def tearDown(self):
        cache.clear()

    def _incumbent(self, **kwargs):
        defaults = dict(
            email="contested@gmail.com", username="incumbent", password="secret12345",
            role="student", first_name="Incum", last_name="Bent",
        )
        defaults.update(kwargs)
        return User.objects.create_user(**defaults)

    def _request(self, email="contested@gmail.com"):
        with patch("users.email_verification._generate_code", return_value=FIXED_CODE):
            return self.client.post(
                reverse("auth-email-request-code"), {"email": email}, format="json", **ORIGIN
            )

    def _confirm(self, email="contested@gmail.com"):
        return self.client.post(
            reverse("auth-email-confirm-code"), {"email": email, "code": FIXED_CODE},
            format="json", **ORIGIN,
        )

    def test_verified_incumbent_blocks_at_request_time(self):
        u = self._incumbent()
        u.email_verified = True
        u.save(update_fields=["email_verified"])
        r = self._request()
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()["code"], "taken_verified")
        self.assertFalse(EmailClaim.objects.exists(), "no code should be mailed to a proven owner")

    def test_transfer_is_refused_while_the_flag_is_off(self):
        incumbent = self._incumbent()
        incumbent.last_password_change = timezone.now()
        incumbent.save(update_fields=["last_password_change"])
        self._request()
        r = self._confirm()
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()["code"], "taken_unverified")
        incumbent.refresh_from_db()
        self.assertEqual(incumbent.email, "contested@gmail.com", "incumbent must keep its address")

    @override_settings(EMAIL_TRANSFER_ENABLED=True)
    def test_transfer_moves_the_address_from_an_empty_student(self):
        incumbent = self._incumbent()
        incumbent.last_password_change = timezone.now()  # has a password: not locked out
        incumbent.save(update_fields=["last_password_change"])

        self._request()
        r = self._confirm()
        self.assertEqual(r.status_code, 200, r.content)

        self.claimant.refresh_from_db()
        incumbent.refresh_from_db()
        self.assertEqual(self.claimant.email, "contested@gmail.com")
        self.assertTrue(self.claimant.email_verified)
        self.assertTrue(incumbent.email.endswith(f"@{RELEASED_EMAIL_DOMAIN}"))
        self.assertEqual(incumbent.previous_email, "contested@gmail.com")
        self.assertIsNotNone(incumbent.email_released_at)
        self.assertFalse(incumbent.email_verified)

    def _assert_refused_and_unchanged(self, incumbent):
        """The claimant gets a generic refusal and the incumbent keeps its address.

        The *reason* is deliberately not in the response: it would tell the claimant
        things about a stranger's account (that it holds exam history, that it belongs
        to staff). It goes to the security audit log, where support can read it.
        """
        self._request()
        r = self._confirm()
        self.assertEqual(r.status_code, 409, r.content)
        body = r.json()
        self.assertEqual(body["code"], "taken_unverified")
        self.assertNotIn("reason", body)
        incumbent.refresh_from_db()
        self.assertEqual(incumbent.email, "contested@gmail.com")
        self.assertIsNone(incumbent.email_released_at)
        self.assertEqual(
            EmailClaim.objects.get(user=self.claimant).status, EmailClaim.STATUS_REFUSED
        )

    @override_settings(EMAIL_TRANSFER_ENABLED=True)
    def test_transfer_refused_when_the_incumbent_has_exam_history(self):
        from exams.models import PracticeTest, TestAttempt

        incumbent = self._incumbent()
        incumbent.last_password_change = timezone.now()
        incumbent.save(update_fields=["last_password_change"])
        TestAttempt.objects.create(
            practice_test=PracticeTest.objects.create(subject="MATH"), student=incumbent
        )
        self._assert_refused_and_unchanged(incumbent)

    @override_settings(EMAIL_TRANSFER_ENABLED=True)
    def test_transfer_refused_for_staff_accounts(self):
        incumbent = self._incumbent(role="admin")
        incumbent.last_password_change = timezone.now()
        incumbent.save(update_fields=["last_password_change"])
        self._assert_refused_and_unchanged(incumbent)

    @override_settings(EMAIL_TRANSFER_ENABLED=True)
    def test_transfer_refused_when_it_would_lock_the_incumbent_out(self):
        # No telegram_id and no password they ever set: a Google-origin account.
        # Releasing the address leaves them unable to authenticate at all, and the login
        # error reads as a typo, so they could never find out what happened.
        incumbent = self._incumbent()
        self.assertIsNone(incumbent.telegram_id)
        self.assertIsNone(incumbent.last_password_change)
        self._assert_refused_and_unchanged(incumbent)


class ReleaseGuardTests(TestCase):
    """The guard predicate itself, where the reason string is meaningful."""

    def _student(self, **kwargs):
        defaults = dict(
            email="guard@test.com", username="guarded", password="secret12345", role="student",
        )
        defaults.update(kwargs)
        return User.objects.create_user(**defaults)

    def _reason(self, user):
        from users.email_verification import _release_blocked_reason

        return _release_blocked_reason(user)

    def test_empty_student_with_a_password_may_be_released(self):
        u = self._student()
        u.last_password_change = timezone.now()
        u.save(update_fields=["last_password_change"])
        self.assertIsNone(self._reason(u))

    def test_telegram_user_may_be_released(self):
        # Telegram login resolves by telegram_id, so they keep a way in.
        u = self._student(telegram_id=99887766)
        self.assertIsNone(self._reason(u))

    def test_verified_incumbent_is_never_released(self):
        u = self._student()
        u.email_verified = True
        u.last_password_change = timezone.now()
        u.save(update_fields=["email_verified", "last_password_change"])
        self.assertEqual(self._reason(u), "incumbent_verified")

    def test_staff_is_never_released(self):
        for role in ("teacher", "admin", "test_admin", "super_admin"):
            with self.subTest(role=role):
                u = self._student(
                    email=f"{role}@test.com", username=f"u{role}", role=role,
                    **({"subject": "math"} if role == "teacher" else {}),
                )
                u.last_password_change = timezone.now()
                u.save(update_fields=["last_password_change"])
                self.assertEqual(self._reason(u), "incumbent_is_staff")

    def test_account_with_work_is_not_released(self):
        from exams.models import PracticeTest, TestAttempt

        u = self._student()
        u.last_password_change = timezone.now()
        u.save(update_fields=["last_password_change"])
        TestAttempt.objects.create(
            practice_test=PracticeTest.objects.create(subject="MATH"), student=u
        )
        self.assertEqual(self._reason(u), "incumbent_has_work")

    def test_account_with_no_other_credential_is_not_released(self):
        self.assertEqual(self._reason(self._student()), "incumbent_would_be_locked_out")
