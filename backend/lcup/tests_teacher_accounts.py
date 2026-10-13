"""A new lc-up teacher gets an account of their own (owner, 2026-10-13: "teacher uchun ham yangi
account ochilaversin"), signed into the way a new student's is: phone + its last four digits.

Only a teacher nothing matched gets one, only after the initial review, and only once a live lc-up
group needs them — the group is where the account's subject comes from.
"""

from __future__ import annotations

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import UserAccess
from lcup.models import AccountClaim, GroupLinkStatus, LcupGroupLink, LcupState, LcupTeacherLink, LinkStatus
from lcup.sync import run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import API, lcup_data
from users.models import User

SAYYORA_PHONE = "998902222222"  # lc-up teacher 2002, the only teacher of English group 11


class TeacherAccountTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def review_done(self):
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})

    def sync(self, data=None):
        return run_sync(FakeLcupClient(data or lcup_data()), now=self.now)

    def teacher_row(self, data, lcup_id):
        return next(row for row in data[f"{API}/teachers"] if row["id"] == lcup_id)

    def test_after_the_review_a_new_teacher_gets_an_account_and_their_group_a_class(self):
        self.review_done()
        run = self.sync()
        self.assertTrue(run.ok, run.errors)

        sayyora = User.objects.get(username=SAYYORA_PHONE)
        self.assertEqual((sayyora.role, sayyora.subject), ("teacher", "english"))
        self.assertEqual((sayyora.first_name, sayyora.last_name), ("Sayyora", "Karimova"))
        self.assertFalse(sayyora.has_usable_password())
        self.assertTrue(AccountClaim.objects.filter(user=sayyora, phone=SAYYORA_PHONE).exists())
        # Parity with an admin-made teacher: the global row for their subject.
        self.assertTrue(UserAccess.objects.filter(user=sayyora, subject="english", classroom__isnull=True).exists())

        link = LcupTeacherLink.objects.get(lcup_teacher_id=2002)
        self.assertEqual((link.status, link.user_id), (LinkStatus.CREATED, sayyora.pk))
        # The group that waited for a teacher gets its class in the same run, owned by them.
        g11 = LcupGroupLink.objects.get(lcup_group_id=11)
        self.assertEqual(g11.status, GroupLinkStatus.CONFIRMED)
        self.assertEqual(g11.classroom.teacher_id, sayyora.pk)
        self.assertEqual(run.counts["teacher_accounts_created"], 2)  # Vali (2001) had no account either
        self.assertIn("teacher account created for Karimova Sayyora", run.alerts)

    def test_before_the_review_no_teacher_account_is_made(self):
        self.sync()
        self.assertFalse(User.objects.filter(username=SAYYORA_PHONE).exists())
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2002).status, LinkStatus.UNMATCHED)

    def test_a_teacher_deleted_in_lcup_gets_no_account(self):
        # lc-up keeps a deleted teacher on the groups they used to teach (seen on prod).
        self.review_done()
        data = lcup_data()
        self.teacher_row(data, 2002)["deleted_at"] = "2026-09-01 10:00:00"
        self.sync(data)
        self.assertFalse(User.objects.filter(username=SAYYORA_PHONE).exists())

    def test_a_support_teacher_gets_no_account(self):
        self.review_done()
        data = lcup_data()
        self.teacher_row(data, 2002)["is_supporter"] = True
        self.sync(data)
        self.assertFalse(User.objects.filter(username=SAYYORA_PHONE).exists())
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2002).status, LinkStatus.IGNORED)

    def test_a_teacher_in_no_live_group_gets_no_account(self):
        self.review_done()
        data = lcup_data()
        data[f"{API}/teachers"].append({"id": 2009, "name": "Yangi Ustoz", "phone": "998909999999", "group_ids": []})
        self.sync(data)
        self.assertFalse(User.objects.filter(username="998909999999").exists())
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2009).status, LinkStatus.UNMATCHED)

    def test_a_phone_already_used_goes_to_review(self):
        User.objects.create_user(None, password=None, username="someone", role="student", phone_number=SAYYORA_PHONE)
        self.review_done()
        self.sync()
        link = LcupTeacherLink.objects.get(lcup_teacher_id=2002)
        self.assertEqual((link.status, link.user_id), (LinkStatus.NEEDS_REVIEW, None))
        self.assertFalse(User.objects.filter(role="teacher", phone_number=SAYYORA_PHONE).exists())

    def test_a_public_account_keeps_its_phone_and_the_teacher_goes_to_review(self):
        # A student's phone moves off a public account; a teacher's never does — the admin decides.
        public = User.objects.create_user(
            None, password=None, username="pub", role="public_student", phone_number=SAYYORA_PHONE
        )
        self.review_done()
        self.sync()
        public.refresh_from_db()
        self.assertEqual(public.phone_number, SAYYORA_PHONE)
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2002).status, LinkStatus.NEEDS_REVIEW)

    def test_a_teacher_matched_by_phone_is_linked_not_duplicated(self):
        own = User.objects.create_user(
            None, password=None, username="sayyora", role="teacher", subject="english", phone_number=SAYYORA_PHONE
        )
        self.review_done()
        self.sync()
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2002).user_id, own.pk)
        self.assertFalse(User.objects.filter(username=SAYYORA_PHONE).exists())


@override_settings(LCUP_ENABLED=True, ALLOWED_HOSTS=["mastersat.uz", "teacher.mastersat.uz", "testserver"])
class TeacherClaimLoginTests(TestCase):
    def test_the_teacher_signs_in_at_the_portal_with_phone_and_its_last_four_digits(self):
        cache.clear()  # the login throttle counts per IP across tests
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": timezone.now()})
        run_sync(FakeLcupClient(lcup_data()), now=timezone.now())
        response = APIClient().post(
            "/api/auth/login/",
            {"email": SAYYORA_PHONE, "password": "2222"},
            format="json",
            HTTP_HOST="teacher.mastersat.uz",
            HTTP_ORIGIN="https://teacher.mastersat.uz",
            HTTP_REFERER="https://teacher.mastersat.uz/login",
        )
        self.assertEqual(response.status_code, 200, response.content)
