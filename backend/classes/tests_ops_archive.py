"""/ops Archive (classes.ops_archive): who left a group, when and by whose hand, the balance now for the money's
holders only, the archived groups — and who may read any of it."""

from datetime import date, datetime
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from access.models import Permission, UserPermission
from access.permissions import Requires
from classes.models import Classroom, ClassroomMembership
from classes.models_membership_audit import ClassroomMembershipEvent
from classes.views_ops_archive import ArchiveGroupsView, ArchiveStudentsView
from core.actor import clear_actor, set_actor
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupStudentLink, LinkStatus
from users.models import User

STUDENTS = "/api/classes/admin/archive/students/"
GROUPS = "/api/classes/admin/archive/groups/"
HOST = "admin.mastersat.uz"
M = ClassroomMembership


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


def deny(user, codename):
    permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename})
    UserPermission.objects.create(user=user, permission=permission, granted=False)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class ArchiveFixture(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN, first_name="Sevara", last_name="Hamidova")
        self.vali = make("vali", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.olim = make("olim", C.ROLE_TEACHER, subject="english", first_name="Olim", last_name="Karimov")
        self.math = Classroom.objects.create(
            name="Junior G21 · Math", subject="MATH", level="junior", lesson_days="ODD", created_by=self.admin,
            teacher=self.vali,
        )
        self.english = Classroom.objects.create(
            name="Senior G4 · English", subject="ENGLISH", level="senior", lesson_days="EVEN", created_by=self.admin,
            teacher=self.olim,
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov", phone_number="+998901112233")
        self.malika = make("malika", first_name="Malika", last_name="Saidova")
        self.bobur = make("bobur", C.ROLE_PUBLIC_STUDENT, first_name="Bobur", last_name="Aliev")
        self.stays = make("stays", first_name="Stays", last_name="Here")
        self.ta = make("ta", C.ROLE_SUPPORT_TEACHER, subject="math")
        # Aziz left Math on 10 Nov by the admin's hand; Malika left English on 14 Nov; Bobur left Math before the
        # seat kept a day, and only the history knows when.
        self.leave(self.math, self.aziz, day=date(2026, 11, 10), by=self.admin)
        self.leave(self.english, self.malika, day=date(2026, 11, 14), by=None)
        self.leave(self.math, self.bobur, day=None, by=self.admin, recorded=datetime(2026, 11, 12, 9, 0))
        M.objects.create(classroom=self.math, user=self.stays, role=M.ROLE_STUDENT)
        ta_seat = M.objects.create(classroom=self.math, user=self.ta, role=M.ROLE_TA)
        ta_seat.status = M.STATUS_REMOVED
        ta_seat.save()
        LcupStudentLink.objects.create(
            lcup_student_id=101, name="Tursunov Aziz", user=self.aziz, status=LinkStatus.CONFIRMED,
            balance=Decimal("-375000"),
        )
        LcupStudentLink.objects.create(
            lcup_student_id=102, name="Saidova Malika", user=self.malika, status=LinkStatus.CONFIRMED,
            balance=Decimal("146429"), phone="+998907654321",
        )

    def tearDown(self):
        clear_actor()

    def leave(self, room, user, *, day, by, recorded=None):
        seat = M.objects.create(classroom=room, user=user, role=M.ROLE_STUDENT)
        set_actor(by)
        seat.status, seat.seat_left_on = M.STATUS_REMOVED, day
        seat.save()
        clear_actor()
        if recorded is not None:
            ClassroomMembershipEvent.objects.filter(student=user, action=ClassroomMembershipEvent.ACTION_REMOVED).update(
                created_at=timezone.make_aware(recorded)
            )
        return seat

    def get(self, url=STUDENTS, user=None, **params):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(url, params, HTTP_HOST=HOST)

    def names(self, body):
        return [r["student"]["name"] for r in body["results"]]


class ArchiveStudentsTests(ArchiveFixture):
    def test_students_who_left_newest_first(self):
        r = self.get()
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        # Not the student still in a group, not the support teacher who left.
        self.assertEqual(self.names(body), ["Malika Saidova", "Bobur Aliev", "Aziz Tursunov"])
        self.assertEqual(body["count"], 3)
        self.assertEqual(body["totals"], {"students": 3, "groups": 0})

    def test_a_row_says_the_group_the_day_and_who(self):
        body = self.get().json()
        aziz = next(r for r in body["results"] if r["student"]["id"] == self.aziz.pk)
        self.assertEqual(aziz["student"], {"id": self.aziz.pk, "name": "Aziz Tursunov", "section": "students", "phone": "+998901112233"})
        self.assertEqual(
            aziz["group"],
            {"id": self.math.pk, "name": "Junior G21 · Math", "level": "junior", "subject": "MATH", "is_active": True,
             "teacher": "Vali Aliyev"},
        )
        self.assertEqual((aziz["left_on"], aziz["removed_by"]), ("2026-11-10", "Sevara Hamidova"))
        malika = next(r for r in body["results"] if r["student"]["id"] == self.malika.pk)
        # Nobody clicked (lc-up's sync, a command): no name is made up. Her phone comes from lc-up.
        self.assertEqual((malika["removed_by"], malika["student"]["phone"]), ("", "+998907654321"))

    def test_an_older_removal_takes_its_day_from_the_history(self):
        bobur = next(r for r in self.get().json()["results"] if r["student"]["id"] == self.bobur.pk)
        self.assertEqual((bobur["left_on"], bobur["student"]["section"]), ("2026-11-12", "public"))

    def test_a_day_nobody_kept_goes_last(self):
        ghost = make("ghost", first_name="Ghost", last_name="Learner")
        M.objects.create(classroom=self.english, user=ghost, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED)
        body = self.get().json()
        self.assertEqual(self.names(body)[-1], "Ghost Learner")
        self.assertIsNone(body["results"][-1]["left_on"])

    def test_search_by_name_or_phone(self):
        self.assertEqual(self.names(self.get(q="malika").json()), ["Malika Saidova"])
        self.assertEqual(self.names(self.get(q="901112233").json()), ["Aziz Tursunov"])
        self.assertEqual(self.names(self.get(q="907654321").json()), ["Malika Saidova"])  # lc-up's phone

    def test_group_and_teacher_filters_with_counts(self):
        body = self.get(classroom=self.math.pk).json()
        self.assertEqual(self.names(body), ["Bobur Aliev", "Aziz Tursunov"])
        group = next(f for f in body["filters"] if f["key"] == "classroom")
        self.assertEqual({o["label"]: o["count"] for o in group["options"]}, {"Junior G21 · Math": 2, "Senior G4 · English": 1})
        self.assertEqual(group["selected"], str(self.math.pk))
        teacher = self.get(teacher=self.olim.pk).json()
        self.assertEqual(self.names(teacher), ["Malika Saidova"])

    def test_the_balance_now_and_its_filter_are_the_moneys(self):
        body = self.get().json()
        self.assertTrue(body["money"])
        balances = {r["student"]["name"]: r["balance"] for r in body["results"]}
        self.assertEqual(balances, {"Aziz Tursunov": -375000, "Malika Saidova": 146429, "Bobur Aliev": None})
        self.assertEqual(self.names(self.get(owing="1").json()), ["Aziz Tursunov"])

    def test_without_the_money_no_balance_and_no_balance_filter(self):
        desk = make("desk", C.ROLE_ADMIN)
        deny(desk, C.PERM_VIEW_MONEY)
        body = self.get(user=desk, owing="1").json()
        self.assertFalse(body["money"])
        # The filter is not applied either: filtering on a balance would say the balance.
        self.assertEqual(len(body["results"]), 3)
        self.assertTrue(all("balance" not in r for r in body["results"]))
        self.assertNotIn("owing", [f["key"] for f in body["filters"]])

    def test_who_may_read_it(self):
        self.assertEqual(self.get(user=self.vali).status_code, 403)
        self.assertEqual(self.get(user=self.aziz).status_code, 403)
        no_people = make("counter", C.ROLE_ACCOUNTANT)
        deny(no_people, C.PERM_VIEW_PEOPLE)
        self.assertEqual(self.get(user=no_people).status_code, 403)
        self.assertEqual(self.get(user=make("acc", C.ROLE_ACCOUNTANT)).status_code, 200)

    def test_both_views_name_their_permission(self):
        for view in (ArchiveStudentsView, ArchiveGroupsView):
            gates = [p for p in view.permission_classes if isinstance(p, Requires)]
            self.assertEqual(len(gates), 1, view)

    def test_a_fixed_number_of_queries(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        api.get(STUDENTS, HTTP_HOST=HOST)  # warm the permission caches
        before = self.queries(api)
        for n in range(6):
            student = make(f"more{n}", first_name="More", last_name=str(n))
            LcupStudentLink.objects.create(lcup_student_id=300 + n, name=f"More {n}", user=student, balance=Decimal("-1"))
            self.leave(self.english if n % 2 else self.math, student, day=date(2026, 11, 1 + n), by=self.admin)
        self.assertEqual(self.queries(api), before)

    def queries(self, api) -> int:
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(api.get(STUDENTS, HTTP_HOST=HOST).status_code, 200)
        return len(ctx.captured_queries)

    def test_pages(self):
        body = self.get(page_size=25, page=9).json()
        self.assertEqual((body["page"], body["pages"], body["page_size"]), (1, 1, 25))

    def test_says_whether_seats_can_be_taken_here(self):
        # Return goes through the group's Add, which lc-up keeps closed while it runs.
        with override_settings(LCUP_ENABLED=True):
            self.assertFalse(self.get().json()["seats_open"])
        with override_settings(LCUP_ENABLED=False):
            self.assertTrue(self.get().json()["seats_open"])


class ArchiveGroupsTests(ArchiveFixture):
    def setUp(self):
        super().setUp()
        self.old = Classroom.objects.create(
            name="Foundation G2 · Math", subject="MATH", level="foundation", lesson_days="ODD", created_by=self.admin,
            teacher=self.vali, is_active=False, start_date=date(2026, 3, 1),
        )
        self.by_hand = Classroom.objects.create(
            name="Middle G9 · English", subject="ENGLISH", lesson_days="EVEN", created_by=self.admin, is_active=False,
        )
        LcupGroupLink.objects.create(
            lcup_group_id=10, name="Foundation G2", classroom=self.old, status=GroupLinkStatus.CONFIRMED,
            class_archived_at=timezone.make_aware(datetime(2026, 10, 20, 12, 0)),
        )
        self.leave(self.old, make("was", first_name="Was", last_name="There"), day=date(2026, 10, 19), by=None)

    def test_archived_groups_with_their_dates(self):
        r = self.get(GROUPS)
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual([g["name"] for g in body["results"]], ["Foundation G2 · Math", "Middle G9 · English"])
        old, hand = body["results"]
        self.assertEqual(
            (old["level"], old["teacher"], old["start_date"], old["archived_on"], old["left"]),
            ("foundation", "Vali Aliyev", "2026-03-01", "2026-10-20", 1),
        )
        # Archived by hand: no day was kept, so none is shown.
        self.assertIsNone(hand["archived_on"])
        self.assertEqual(body["totals"], {"students": 4, "groups": 2})

    def test_search(self):
        self.assertEqual([g["name"] for g in self.get(GROUPS, q="middle").json()["results"]], ["Middle G9 · English"])

    def test_who_may_read_it(self):
        self.assertEqual(self.get(GROUPS, user=self.vali).status_code, 403)
