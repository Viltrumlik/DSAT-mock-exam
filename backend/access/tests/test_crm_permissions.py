"""The CRM's permissions (plan 2026-11-12-crm-roles, PR 2).

Three guards and one proof:

* every CRM endpoint names the permission it needs (``Requires``), found by walking every URL;
* the role presets, pinned as a table;
* role × endpoint: on every CRM endpoint the new gate lets in exactly whom the old role-name check let in, so
  this change moves nobody;
* a per-person tick moves one person, and the endpoints that need a second permission for one action ask for it.
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from access import constants as C
from access.models import Permission, UserPermission
from access.permissions import Requires
from access.services import role_permissions_matrix
from billing.tests_api import ADMIN_HOST
from billing.tests_entries import EntryApiCase
from classes.models import Classroom

User = get_user_model()

#: Modules where every view is a CRM endpoint.
CRM_MODULES = frozenset({
    "billing.views", "lcup.views", "sms.views", "classes.views_seats", "classes.views_ops_classrooms",
})
#: In those modules, what a learner uses on their own account.
LEARNER_ENDPOINTS = frozenset({
    "lcup.views.ClaimPasswordView", "lcup.views.ClaimPhoneView", "lcup.views.StudentFinanceView",
})
#: Consoles inside apps that also serve learners: every view built on their staff base.
STAFF_BASES = ("shop.views._StaffView", "stories.views._StaffView", "events.views._StaffView",
               "telegram_posts.views._StaffView")
#: Single CRM views in modules that are otherwise not the CRM's.
CRM_VIEWS = frozenset({"rewards.views.WalletAdminView", "users.views_people_detail.PersonParentView"})


def _dotted(cls) -> str:
    return f"{cls.__module__}.{cls.__qualname__}"


def _resolve(dotted: str):
    module, _, name = dotted.rpartition(".")
    return getattr(importlib.import_module(module), name)


def _walk(patterns, prefix=""):
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern.url_patterns, prefix + str(pattern.pattern))
        elif isinstance(pattern, URLPattern):
            cls = getattr(pattern.callback, "view_class", None) or getattr(pattern.callback, "cls", None)
            if cls is not None:
                yield prefix + str(pattern.pattern), cls


def crm_endpoints() -> dict[str, type]:
    """Route → view class, for every CRM endpoint the URLconf serves."""
    bases = tuple(_resolve(dotted) for dotted in STAFF_BASES)
    found = {}
    for route, cls in _walk(get_resolver().url_patterns):
        name = _dotted(cls)
        if name in LEARNER_ENDPOINTS:
            continue
        if cls.__module__ in CRM_MODULES or name in CRM_VIEWS or issubclass(cls, bases):
            found[route] = cls
    return found


def gates(cls) -> list[Requires]:
    return [p for p in cls.permission_classes if isinstance(p, Requires)]


def tick(user, codename: str, *, granted: bool) -> None:
    permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename})
    UserPermission.objects.create(user=user, permission=permission, granted=granted)


class EveryCrmEndpointNamesItsPermissionTests(TestCase):
    def test_the_walk_finds_the_crm(self):
        # A walk that matched nothing would pass the test below on an empty list.
        self.assertGreaterEqual(len(crm_endpoints()), 80)

    def test_every_crm_endpoint_has_a_requires(self):
        missing = sorted(f"{route} {_dotted(cls)}" for route, cls in crm_endpoints().items() if not gates(cls))
        self.assertEqual(missing, [], "A CRM view without Requires(...) — name the permission it needs.")

    def test_the_lists_name_real_views(self):
        for dotted in sorted(LEARNER_ENDPOINTS | CRM_VIEWS | set(STAFF_BASES)):
            _resolve(dotted)

    def test_learner_endpoints_stay_open_to_learners(self):
        for dotted in sorted(LEARNER_ENDPOINTS):
            self.assertEqual(gates(_resolve(dotted)), [], dotted)


class RolePresetTests(TestCase):
    #: The CRM permissions each role holds. ``*`` is everything.
    TABLE = {
        C.ROLE_SUPER_ADMIN: {C.WILDCARD},
        C.ROLE_ADMIN: set(C.CRM_PERMISSION_CODENAMES),
        C.ROLE_TEACHER: set(),
        C.ROLE_SUPPORT_TEACHER: set(),
        C.ROLE_TEST_ADMIN: set(),
        C.ROLE_TEST_AUDITOR: set(),
        C.ROLE_STUDENT: set(),
        C.ROLE_PUBLIC_STUDENT: set(),
    }

    def test_every_role_is_in_the_table(self):
        self.assertEqual(set(self.TABLE), set(C.CANONICAL_ROLES))

    def test_the_crm_permissions_of_each_role(self):
        crm = set(C.CRM_PERMISSION_CODENAMES) | {C.WILDCARD}
        for role, held in role_permissions_matrix().items():
            self.assertEqual(set(held) & crm, self.TABLE[role], role)

    def test_the_admin_keeps_what_it_had(self):
        before = {C.PERM_VIEW_DASHBOARD, C.PERM_MANAGE_USERS, C.PERM_ASSIGN_ACCESS, C.PERM_CREATE_CLASSROOM,
                  C.PERM_MANAGE_TESTS, C.PERM_SUBMIT_TEST}
        self.assertEqual(set(role_permissions_matrix()[C.ROLE_ADMIN]) - set(C.CRM_PERMISSION_CODENAMES), before)

    def test_no_crm_permission_needs_a_subject(self):
        self.assertFalse(set(C.CRM_PERMISSION_CODENAMES) & C.PERMISSIONS_REQUIRING_PLATFORM_SUBJECT)

    def test_the_migration_adds_a_row_for_each(self):
        migration = importlib.import_module("access.migrations.0012_crm_permissions")
        self.assertEqual([row[0] for row in migration.CRM_PERMISSIONS], list(C.CRM_PERMISSION_CODENAMES))

    def test_requires_refuses_a_subject_scoped_codename(self):
        with self.assertRaises(ValueError):
            Requires(C.PERM_MANAGE_USERS)


class SameRightsAsBeforeTests(TestCase):
    """Every CRM endpoint, every role: the gate's answer is the old check's answer."""

    @staticmethod
    def old_check(user) -> bool:  # classes.capabilities.is_global_admin, which these endpoints used
        return user.is_superuser or user.role in ("super_admin", "admin")

    def setUp(self):
        self.people = []
        for role in sorted(C.CANONICAL_ROLES):
            subject = C.DOMAIN_MATH if role in C.SUBJECT_SCOPED_STAFF_ROLES else None
            self.people.append(User.objects.create_user(None, password=None, username=f"p_{role}", role=role,
                                                        subject=subject))
        superuser = User.objects.create_user(None, password=None, username="p_root", role=C.ROLE_TEACHER,
                                             subject=C.DOMAIN_MATH)
        superuser.is_superuser = True
        superuser.save(update_fields=["is_superuser"])
        self.people.append(superuser)

    def test_nobody_gains_or_loses_a_crm_endpoint(self):
        changed = []
        for route, cls in sorted(crm_endpoints().items()):
            view = cls()
            for person in self.people:
                request = SimpleNamespace(user=person)
                now = all(p.has_permission(request, view) for p in gates(cls))
                if now != self.old_check(person):
                    changed.append(f"{route} {person.username}: {'gains' if now else 'loses'}")
        self.assertEqual(changed, [])


class TickTests(EntryApiCase, TestCase):
    """A per-person tick moves one person; a deny wins over the role."""

    def get_as(self, user, path):
        api = APIClient()
        api.force_authenticate(user)
        with override_settings(ALLOWED_HOSTS=[ADMIN_HOST]):
            return api.get(path, HTTP_HOST=ADMIN_HOST)

    def test_a_deny_shuts_one_admin_out_of_the_ledger(self):
        other = User.objects.create_user(None, password=None, username="boss2", role="admin")
        tick(other, C.PERM_VIEW_MONEY, granted=False)
        self.assertEqual(self.get_as(other, "/api/billing/accounts/").status_code, 403)
        self.assertEqual(self.get_as(self.boss, "/api/billing/accounts/").status_code, 200)

    def test_a_grant_opens_the_ledger_to_one_teacher(self):
        teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.assertEqual(self.get_as(teacher, "/api/billing/accounts/").status_code, 403)
        tick(teacher, C.PERM_VIEW_MONEY, granted=True)
        self.assertEqual(self.get_as(teacher, "/api/billing/accounts/").status_code, 200)

    @override_settings(BILLING_PAYMENTS_OPEN=True)
    def test_a_payment_needs_take_payment_and_an_adjustment_adjust_balance(self):
        tick(self.boss, C.PERM_TAKE_PAYMENT, granted=False)
        self.assertEqual(self.post(self.url(), self.body()).status_code, 403)
        adjust = self.body(kind="adjust", amount=-5_000, method="", note="Rounding in October")
        self.assertEqual(self.post(self.url(), adjust).status_code, 201)

    @override_settings(BILLING_PAYMENTS_OPEN=True)
    def test_without_either_the_form_is_refused(self):
        tick(self.boss, C.PERM_TAKE_PAYMENT, granted=False)
        tick(self.boss, C.PERM_ADJUST_BALANCE, granted=False)
        adjust = self.body(kind="adjust", amount=-5_000, method="", note="Rounding in October")
        self.assertEqual(self.post(self.url(), adjust).status_code, 403)


@override_settings(ALLOWED_HOSTS=["testserver", ADMIN_HOST])
class SecondPermissionTests(TestCase):
    """Endpoints where one action needs a different permission from the rest."""

    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="Junior G1", subject=Classroom.SUBJECT_MATH, lesson_days="ODD", monthly_price=500_000,
            teacher=teacher, created_by=teacher,
        )

    def call(self, method, path, body=None):
        api = APIClient()
        api.force_authenticate(self.admin)
        return getattr(api, method)(path, body or {}, format="json", HTTP_HOST=ADMIN_HOST)

    def test_moving_a_seat_needs_manage_seats(self):
        tick(self.admin, C.PERM_MANAGE_SEATS, granted=False)
        base = f"/api/classes/admin/classrooms/{self.room.pk}/seats/999999"
        self.assertEqual(self.call("post", f"{base}/freeze/").status_code, 403)
        # Past the permission: the student does not exist.
        self.assertEqual(self.call("post", f"{base}/activate/").status_code, 404)

    def test_activating_needs_enroll(self):
        tick(self.admin, C.PERM_ENROLL, granted=False)
        base = f"/api/classes/admin/classrooms/{self.room.pk}/seats/999999"
        self.assertEqual(self.call("post", f"{base}/activate/").status_code, 403)
        self.assertEqual(self.call("post", f"{base}/freeze/").status_code, 404)

    def test_a_new_group_price_needs_set_prices(self):
        tick(self.admin, C.PERM_SET_PRICES, granted=False)
        path = f"/api/classes/{self.room.pk}/details/"
        self.assertEqual(self.call("patch", path, {"monthly_price": 600_000}).status_code, 403)
        # The form posts every field whole: the same price is no price change.
        self.assertEqual(self.call("patch", path, {"monthly_price": 500_000, "name": "Junior G2"}).status_code, 200)
        self.room.refresh_from_db()
        self.assertEqual((self.room.name, self.room.monthly_price), ("Junior G2", 500_000))

    def test_the_class_details_need_manage_groups(self):
        tick(self.admin, C.PERM_MANAGE_GROUPS, granted=False)
        self.assertEqual(self.call("patch", f"/api/classes/{self.room.pk}/details/", {"name": "X"}).status_code, 403)
