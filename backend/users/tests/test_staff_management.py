"""Staff are the owner's (plan 2026-11-12-crm-roles, PR 4).

The accountant role, the owner's per-person ticks, turning an employee's access off, and the rule that giving a
staff role or changing a staff account needs ``manage_staff``, which only the owner holds.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from access import constants as C
from access.models import UserPermission
from access.services import authorize
from users.models import RefreshSession, SecurityAuditEvent

User = get_user_model()
ADMIN_HOST = "admin.mastersat.uz"


@override_settings(ALLOWED_HOSTS=["testserver", ADMIN_HOST])
class StaffCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create_user(email="sm-owner@example.com", password="pw", role=C.ROLE_SUPER_ADMIN)
        cls.admin = User.objects.create_user(email="sm-admin@example.com", password="pw", role=C.ROLE_ADMIN)
        cls.accountant = User.objects.create_user(email="sm-acc@example.com", password="pw", role=C.ROLE_ACCOUNTANT)
        cls.teacher = User.objects.create_user(
            email="sm-teacher@example.com", password="pw", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH,
        )
        cls.student = User.objects.create_user(email="sm-student@example.com", password="pw", role=C.ROLE_STUDENT)

    def call(self, actor, method, url, body=None):
        client = APIClient()
        client.force_authenticate(actor)
        return getattr(client, method)(url, body or {}, format="json", HTTP_HOST=ADMIN_HOST)


class AccountantTests(StaffCase):
    def test_holds_the_money_and_nothing_else_of_the_desk(self):
        a = self.accountant
        for code in (C.PERM_VIEW_MONEY, C.PERM_TAKE_PAYMENT, C.PERM_VOID_PAYMENT, C.PERM_SEND_DEBT_SMS):
            self.assertTrue(authorize(a, code), code)
        for code in (C.PERM_SEND_SMS, C.PERM_ENROLL, C.PERM_MANAGE_GROUPS, C.PERM_MANAGE_STAFF, C.PERM_LCUP_TOOLS):
            self.assertFalse(authorize(a, code), code)
        self.assertTrue(a.is_admin)  # staff, so the console treats them as staff
        self.assertFalse(authorize(a, C.PERM_MANAGE_TESTS))  # no Builder

    def test_reads_the_ledger_but_not_campaigns_or_lcup(self):
        self.assertEqual(self.call(self.accountant, "get", "/api/billing/accounts/").status_code, 200)
        self.assertEqual(self.call(self.accountant, "get", "/api/sms/admin/campaigns/").status_code, 403)
        self.assertEqual(self.call(self.accountant, "get", "/api/lcup/status/").status_code, 403)

    def test_reads_the_sms_settings_and_templates_the_debt_tab_needs_but_cannot_change_them(self):
        self.assertEqual(self.call(self.accountant, "get", "/api/sms/admin/settings/").status_code, 200)
        self.assertEqual(self.call(self.accountant, "patch", "/api/sms/admin/settings/", {"debt_hour": 9}).status_code, 403)


class OnlyTheOwnerManagesStaffTests(StaffCase):
    def test_the_administrator_no_longer_holds_manage_staff(self):
        self.assertFalse(authorize(self.admin, C.PERM_MANAGE_STAFF))
        self.assertTrue(authorize(self.owner, C.PERM_MANAGE_STAFF))

    def test_the_administrator_cannot_change_a_teachers_account(self):
        url = reverse("user-update", args=[self.teacher.pk])
        self.assertEqual(self.call(self.admin, "patch", url, {"first_name": "Okay"}).status_code, 403)
        self.assertEqual(self.call(self.owner, "patch", url, {"first_name": "Okay"}).status_code, 200)

    def test_the_administrator_still_changes_a_students_account(self):
        url = reverse("user-update", args=[self.student.pk])
        self.assertEqual(self.call(self.admin, "patch", url, {"first_name": "Okay"}).status_code, 200)

    def test_the_administrator_cannot_make_a_student_staff(self):
        url = reverse("user-update", args=[self.student.pk])
        res = self.call(self.admin, "patch", url, {"role": C.ROLE_TEACHER, "subject": C.DOMAIN_MATH})
        self.assertEqual(res.status_code, 400, res.content)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, C.ROLE_STUDENT)

    def test_the_owner_makes_an_accountant(self):
        url = reverse("user-update", args=[self.student.pk])
        res = self.call(self.owner, "patch", url, {"role": C.ROLE_ACCOUNTANT})
        self.assertEqual(res.status_code, 200, res.content)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, C.ROLE_ACCOUNTANT)

    def test_sending_the_same_role_back_is_not_a_role_change(self):
        # The profile form posts every field whole, the role included.
        url = reverse("user-update", args=[self.student.pk])
        res = self.call(self.admin, "patch", url, {"role": C.ROLE_STUDENT, "first_name": "Okay"})
        self.assertEqual(res.status_code, 200, res.content)


class TickTests(StaffCase):
    def url(self, user):
        return reverse("users-admin-person-permissions", args=[user.pk])

    def test_the_owner_sees_the_preset_and_no_ticks(self):
        res = self.call(self.owner, "get", self.url(self.accountant))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn(C.PERM_VIEW_MONEY, res.data["preset"])
        self.assertNotIn(C.PERM_ENROLL, res.data["preset"])
        self.assertEqual(res.data["ticks"], {})
        self.assertNotIn(C.PERM_MANAGE_STAFF, res.data["tickable"])

    def test_a_grant_and_a_removal_move_one_person_and_go_into_their_history(self):
        body = {"ticks": {C.PERM_ENROLL: True, C.PERM_VOID_PAYMENT: False}}
        res = self.call(self.owner, "put", self.url(self.accountant), body)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["ticks"], {C.PERM_ENROLL: True, C.PERM_VOID_PAYMENT: False})
        self.assertTrue(authorize(self.accountant, C.PERM_ENROLL))
        self.assertFalse(authorize(self.accountant, C.PERM_VOID_PAYMENT))
        event = SecurityAuditEvent.objects.filter(user=self.accountant, event_type="admin_permissions").get()
        self.assertEqual(event.detail["ticks"], {C.PERM_ENROLL: True, C.PERM_VOID_PAYMENT: False})

    def test_null_goes_back_to_the_preset_and_a_tick_equal_to_it_is_not_stored(self):
        self.call(self.owner, "put", self.url(self.accountant), {"ticks": {C.PERM_ENROLL: True}})
        self.call(self.owner, "put", self.url(self.accountant), {"ticks": {C.PERM_ENROLL: None, C.PERM_VIEW_MONEY: True}})
        self.assertFalse(UserPermission.objects.filter(user=self.accountant).exists())

    def test_refuses_manage_staff_a_learner_the_owner_and_the_administrator(self):
        bad = self.call(self.owner, "put", self.url(self.accountant), {"ticks": {C.PERM_MANAGE_STAFF: True}})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.call(self.owner, "get", self.url(self.student)).status_code, 400)
        self.assertEqual(self.call(self.owner, "get", self.url(self.owner)).status_code, 400)
        self.assertEqual(self.call(self.admin, "get", self.url(self.accountant)).status_code, 403)


class AccessTests(StaffCase):
    def url(self, user):
        return reverse("users-admin-person-access", args=[user.pk])

    def test_turning_access_off_signs_out_everywhere_and_on_again_restores_it(self):
        RefreshSession.objects.create(user=self.teacher, refresh_jti="sm-teacher-jti")
        res = self.call(self.owner, "post", self.url(self.teacher), {"active": False})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data, {"active": False, "revoked": 1})
        self.teacher.refresh_from_db()
        self.assertFalse(self.teacher.is_active)
        self.assertFalse(RefreshSession.objects.filter(refresh_jti="sm-teacher-jti", revoked_at__isnull=True).exists())
        self.assertEqual(self.call(self.owner, "post", self.url(self.teacher), {"active": True}).data["active"], True)
        events = list(SecurityAuditEvent.objects.filter(user=self.teacher).values_list("event_type", flat=True))
        self.assertIn("admin_access_off", events)
        self.assertIn("admin_access_on", events)

    def test_refuses_a_learner_your_own_account_and_the_administrator(self):
        self.assertEqual(self.call(self.owner, "post", self.url(self.student), {"active": False}).status_code, 400)
        self.assertEqual(self.call(self.owner, "post", self.url(self.owner), {"active": False}).status_code, 400)
        self.assertEqual(self.call(self.admin, "post", self.url(self.teacher), {"active": False}).status_code, 403)
        self.teacher.refresh_from_db()
        self.assertTrue(self.teacher.is_active)
