"""Public vs learning center, seen from the lc-up sync (plan 2026-10-13).

Balances are stored; once the initial review is done a new lc-up student always gets a new
account (owner: "agar o'quvchi birinchi marta markazga o'qishga kirsa yangi akkaunt ochiladi
eskisi bo'lgan bo'lsa ham"), and a phone held by one public account moves to it.
"""

from __future__ import annotations

from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone

from access import constants as C
from lcup.accounts import create_account_for
from lcup.models import LcupState, LcupStudentLink, LinkStatus
from lcup.sync import _money, run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import API, lcup_data
from users.models import SecurityAuditEvent, User


@override_settings(LCUP_ENABLED=True, PUBLIC_SPLIT_ENABLED=True)
class BalanceAndEnrollmentTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def data(self):
        d = lcup_data()
        for row in d[f"{API}/students"]:
            row["balance"] = "-150000.00" if row["id"] == 102 else 0
        return d

    def review_done(self):
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})

    def test_the_balance_is_stored(self):
        run_sync(FakeLcupClient(self.data()), now=self.now)
        aziz = LcupStudentLink.objects.get(lcup_student_id=102)
        self.assertEqual(aziz.balance, Decimal("-150000.00"))
        self.assertEqual(aziz.balance_seen_at, self.now)
        self.assertEqual(LcupStudentLink.objects.get(lcup_student_id=101).balance, Decimal("0"))

    def test_a_missing_or_garbled_balance_is_unknown_not_zero(self):
        self.assertIsNone(_money(None))
        self.assertIsNone(_money(""))
        self.assertIsNone(_money("about 5k"))
        self.assertEqual(_money(-150000), Decimal("-150000"))
        self.assertEqual(_money("12.50"), Decimal("12.50"))

    def test_after_the_review_a_new_lcup_student_always_gets_a_new_account(self):
        # Same phone and name as an existing public account: still a NEW account, and the phone moves.
        old = User.objects.create_user(
            "aziz@gmail.com", password="x", username="aziz", role=C.ROLE_PUBLIC_STUDENT,
            phone_number="998903333333", first_name="Aziz", last_name="Tursunov",
        )
        self.review_done()
        run_sync(FakeLcupClient(self.data()), now=self.now)
        link = LcupStudentLink.objects.get(lcup_student_id=102)
        self.assertNotEqual(link.user_id, old.pk)
        self.assertEqual(link.status, LinkStatus.CREATED)
        self.assertEqual(link.user.username, "998903333333")
        self.assertEqual(link.user.role, C.ROLE_STUDENT)
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)
        self.assertEqual(old.role, C.ROLE_PUBLIC_STUDENT)
        self.assertTrue(SecurityAuditEvent.objects.filter(user=old, event_type="lcup_phone_moved").exists())

    def test_after_the_review_siblings_sharing_a_phone_still_wait_for_the_admin(self):
        self.review_done()
        run_sync(FakeLcupClient(self.data()), now=self.now)
        for lcup_id in (103, 104):
            self.assertEqual(LcupStudentLink.objects.get(lcup_student_id=lcup_id).status, LinkStatus.NEEDS_REVIEW)
        self.assertFalse(User.objects.filter(username="998904444444").exists())

    def test_a_phone_that_is_another_accounts_username_still_goes_to_review(self):
        User.objects.create_user(None, password=None, username="998903333333", role=C.ROLE_PUBLIC_STUDENT)
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Tursunov Aziz", phone="998903333333")
        self.assertIsNone(create_account_for(link, now=self.now))
        link.refresh_from_db()
        self.assertEqual(link.status, LinkStatus.NEEDS_REVIEW)

    def test_a_phone_on_a_learning_center_account_still_goes_to_review(self):
        User.objects.create_user(
            None, password=None, username="someone", role=C.ROLE_STUDENT, phone_number="998903333333"
        )
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Tursunov Aziz", phone="998903333333")
        self.assertIsNone(create_account_for(link, now=self.now))
        link.refresh_from_db()
        self.assertEqual(link.status, LinkStatus.NEEDS_REVIEW)
