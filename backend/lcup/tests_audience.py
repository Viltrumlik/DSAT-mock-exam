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


@override_settings(LCUP_ENABLED=True, PUBLIC_SPLIT_ENABLED=True)
class AudienceStageTests(TestCase):
    """Linked learners follow lc-up: in a live group → student; out of every group → public,
    frozen first when lc-up shows a debt; the freeze lifts once the balance is back to zero."""

    def setUp(self):
        self.now = timezone.now()
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})

    def sync(self, data):
        return run_sync(FakeLcupClient(data), now=self.now)

    def linked(self, lcup_id, username, role=C.ROLE_STUDENT):
        u = User.objects.create_user(None, password=None, username=username, role=role)
        LcupStudentLink.objects.update_or_create(
            lcup_student_id=lcup_id, defaults={"name": username, "user": u, "status": LinkStatus.CONFIRMED}
        )
        return u

    def data(self, balance_102="0", left_102=False):
        d = lcup_data()
        for row in d[f"{API}/students"]:
            row["balance"] = balance_102 if row["id"] == 102 else "0"
        if left_102:
            # lc-up lists a leaver with left_at. (An emptied member list is not believed at all.)
            for group in (10, 11):
                for m in d[f"{API}/groups/{group}/students"]:
                    if m["student_id"] == 102:
                        m["left_at"] = "2026-10-10 09:00:00"
        return d

    def test_leaving_without_debt_makes_a_public_learner(self):
        u = self.linked(102, "aziz")
        self.sync(self.data())
        run = self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_PUBLIC_STUDENT, False))
        self.assertEqual(run.counts["became_public"], 1)

    def test_leaving_with_debt_freezes_and_paying_lifts_it(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(balance_102="-150000"))
        run = self.sync(self.data(balance_102="-150000", left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen, u.frozen_reason), (C.ROLE_PUBLIC_STUDENT, True, "lcup_debt"))
        self.assertEqual(run.counts["frozen_for_debt"], 1)
        run = self.sync(self.data(balance_102="0", left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen, u.frozen_reason), (C.ROLE_PUBLIC_STUDENT, False, ""))
        self.assertEqual(run.counts["debt_cleared"], 1)

    def test_an_unknown_balance_is_not_debt(self):
        u = self.linked(102, "aziz")
        self.sync(self.data())
        self.sync(self.data(balance_102=None, left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_PUBLIC_STUDENT, False))

    def test_an_admins_freeze_is_never_lifted_by_the_sync(self):
        u = self.linked(102, "aziz", role=C.ROLE_PUBLIC_STUDENT)
        User.objects.filter(pk=u.pk).update(is_frozen=True, frozen_reason="")
        self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertTrue(u.is_frozen)

    def test_an_active_student_in_debt_is_never_frozen(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(balance_102="-150000"))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_STUDENT, False))

    def test_coming_back_makes_them_centre_again(self):
        u = self.linked(102, "aziz", role=C.ROLE_PUBLIC_STUDENT)
        run = self.sync(self.data())
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
        self.assertEqual(run.counts["became_centre"], 1)

    def test_coming_back_with_a_debt_freeze_lifts_it(self):
        u = self.linked(102, "aziz", role=C.ROLE_PUBLIC_STUDENT)
        User.objects.filter(pk=u.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.sync(self.data(balance_102="-150000"))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_STUDENT, False))

    def test_a_run_with_errors_changes_no_role(self):
        from lcup.client import LcupUnavailable

        u = self.linked(102, "aziz")
        self.sync(self.data())
        d = self.data(left_102=True)
        d[f"{API}/teachers"] = LcupUnavailable("503")
        run = self.sync(d)
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
        self.assertIn("role changes held: this sync had errors", run.alerts)

    def test_too_many_leavers_at_once_are_held(self):
        from unittest import mock

        u = self.linked(102, "aziz")
        self.sync(self.data())
        with mock.patch("lcup.audience.MAX_DEMOTIONS_PER_RUN", 0):
            run = self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
        self.assertTrue(any(a.startswith("role changes held") for a in run.alerts), run.alerts)
        self.assertEqual(run.counts["demotions_held"], 1)

    def test_a_dry_run_reports_but_changes_no_role(self):
        u = self.linked(102, "aziz")
        self.sync(self.data())
        run = run_sync(FakeLcupClient(self.data(left_102=True)), now=self.now, dry_run=True)
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
        self.assertEqual(run.counts["became_public"], 1)

    @override_settings(PUBLIC_SPLIT_ENABLED=False)
    def test_with_the_switch_off_nothing_moves(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)

    def test_a_seat_decides_for_accounts_lcup_does_not_know(self):
        # The seat rule (owner, 2026-10-14): a walk-in taken out of their only class is public by the
        # next sync, and a public learner an admin seats in a class is a student again.
        from classes.models import Classroom, ClassroomMembership

        t = User.objects.create_user(None, password=None, username="tt", role="teacher", subject="math")
        room = Classroom.objects.create(name="Own class", subject="MATH", created_by=t, teacher=t)
        walkin = User.objects.create_user(None, password=None, username="walkin", role=C.ROLE_STUDENT)
        seat = ClassroomMembership.objects.create(classroom=room, user=walkin, role="STUDENT")
        newcomer = User.objects.create_user(None, password=None, username="newcomer", role=C.ROLE_PUBLIC_STUDENT)
        self.sync(self.data())
        walkin.refresh_from_db()
        self.assertEqual(walkin.role, C.ROLE_STUDENT)

        seat.status = ClassroomMembership.STATUS_REMOVED
        seat.save()
        ClassroomMembership.objects.create(classroom=room, user=newcomer, role="STUDENT")
        run = self.sync(self.data())
        walkin.refresh_from_db()
        newcomer.refresh_from_db()
        self.assertEqual((walkin.role, newcomer.role), (C.ROLE_PUBLIC_STUDENT, C.ROLE_STUDENT))
        self.assertEqual((run.counts["became_public"], run.counts["became_centre"]), (1, 1))
