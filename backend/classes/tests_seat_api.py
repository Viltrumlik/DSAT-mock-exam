from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from billing import ledger
from billing.models import Account, Seat
from classes.models import Classroom, ClassroomMembership as M
from classes.models_membership_audit import ClassroomMembershipEvent as Event
from lcup.models import GroupLinkStatus, LcupGroupLink
from users.people_parts import history_part

User = get_user_model()
ADMIN_HOST = "admin.mastersat.uz"
TODAY = date(2026, 10, 19)
PHONE = "998905550011"


@override_settings(ALLOWED_HOSTS=["testserver", ADMIN_HOST, "mastersat.uz"])
class ApiCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.student = User.objects.create_user(
            None, password=None, username="ali", role="student", first_name="Ali", last_name="Valiyev", phone_number="998901112233"
        )
        self.room = self.make_room()
        M.objects.create(classroom=self.room, user=self.teacher, role=M.ROLE_TEACHER)
        patcher = mock.patch("classes.views_seats._today", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)

    def make_room(self, name="Junior G1", days="ODD", price=500_000, **fields):
        return Classroom.objects.create(
            name=name, subject=Classroom.SUBJECT_MATH, lesson_days=days, monthly_price=price, teacher=self.teacher,
            created_by=self.teacher, **fields,
        )

    def post(self, path, data=None, *, user="admin"):
        api = APIClient()
        viewer = self.admin if user == "admin" else user
        if viewer:
            api.force_authenticate(viewer)
        return api.post(path, data or {}, format="json", HTTP_HOST=ADMIN_HOST if viewer == self.admin else "mastersat.uz")

    def seats(self, room=None):
        return f"/api/classes/admin/classrooms/{(room or self.room).pk}/seats/"

    def action(self, name, data=None, *, user="admin", who=None, room=None):
        return self.post(f"{self.seats(room)}{(who or self.student).pk}/{name}/", data, user=user)

    def add(self, status="active", day="2026-10-01", room=None):
        return self.post(self.seats(room), {"user_id": self.student.pk, "status": status, "date": day})

    def new_student(self, **fields):
        body = {"full_name": "Karimova Malika", "phone": PHONE, "status": "trial", "date": "2026-10-19", **fields}
        return self.post(f"{self.seats()}new-student/", body)

    def balance(self, user=None):
        return ledger.balance(Account.objects.get(user=user or self.student))


class PermissionTests(ApiCase):
    def paths(self):
        other = self.make_room("Other")
        return [
            (self.seats(), {"user_id": self.student.pk, "status": "trial"}),
            (f"{self.seats()}new-student/", {"full_name": "A B", "phone": PHONE, "status": "trial"}),
            *[(f"{self.seats()}{self.student.pk}/{name}/", {}) for name in ("activate", "freeze", "return", "leave", "fix-date")],
            (f"{self.seats()}{self.student.pk}/move/", {"to_classroom": other.pk}),
        ]

    def test_a_teacher_is_refused_even_in_their_own_class(self):
        for path, data in self.paths():
            self.assertEqual(self.post(path, data, user=self.teacher).status_code, 403, path)
        self.assertFalse(User.objects.filter(username=PHONE).exists())

    def test_a_student_is_refused(self):
        for path, data in self.paths():
            self.assertEqual(self.post(path, data, user=self.student).status_code, 403, path)

    def test_anonymous_is_refused(self):
        for path, data in self.paths():
            self.assertIn(self.post(path, data, user=None).status_code, (401, 403), path)

    def test_a_super_admin_gets_in(self):
        boss = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        api = APIClient()
        api.force_authenticate(boss)
        response = api.post(self.seats(), {"user_id": self.student.pk, "status": "trial"}, format="json", HTTP_HOST=ADMIN_HOST)
        self.assertEqual(response.status_code, 201, response.content)

    def test_the_admin_console_lets_it_through(self):
        self.assertEqual(self.add("trial").status_code, 201)


@override_settings(LCUP_ENABLED=True)
class LockTests(ApiCase):
    def pair(self):
        LcupGroupLink.objects.create(lcup_group_id=1, name="G1", classroom=self.room, status=GroupLinkStatus.CONFIRMED)

    def assert_locked(self, response):
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "lcup_managed")

    def test_a_paired_class_answers_lcup_managed(self):
        self.pair()
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        for name in ("activate", "freeze", "return", "leave", "fix-date"):
            self.assert_locked(self.action(name, {"date": "2026-10-19"}))
        other = self.make_room("Other")
        self.assert_locked(self.action("move", {"to_classroom": other.pk}))
        outsider = User.objects.create_user(None, password=None, username="b", role="student")
        self.assert_locked(self.post(self.seats(), {"user_id": outsider.pk, "status": "trial"}))

    def test_an_unpaired_class_is_locked_too_while_lc_up_runs(self):
        self.assert_locked(self.add("trial"))

    def test_a_new_student_is_refused(self):
        self.assert_locked(self.new_student())
        self.assertFalse(User.objects.filter(username=PHONE).exists())

    def test_the_screens_are_told(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        core = api.get(f"/api/classes/admin/classrooms/{self.room.pk}/", HTTP_HOST=ADMIN_HOST).json()
        self.assertFalse(core["seats_open"])

    def test_the_trials_page_is_told(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        self.assertFalse(api.get("/api/lcup/followups/", HTTP_HOST=ADMIN_HOST).json()["seats_open"])

    @override_settings(LCUP_ENABLED=False)
    def test_they_open_when_lc_up_is_switched_off(self):
        self.pair()
        self.assertEqual(self.add("active").status_code, 201)
        api = APIClient()
        api.force_authenticate(self.admin)
        self.assertTrue(api.get(f"/api/classes/admin/classrooms/{self.room.pk}/", HTTP_HOST=ADMIN_HOST).json()["seats_open"])
        self.assertTrue(api.get("/api/lcup/followups/", HTTP_HOST=ADMIN_HOST).json()["seats_open"])


class ActionTests(ApiCase):
    def test_adding_answers_with_the_seat(self):
        response = self.add("active", "2026-10-21")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["user_id"], body["status"], body["seat_status"], body["seat_start_date"]),
            (self.student.pk, "ACTIVE", "active", "2026-10-21"),
        )
        self.assertEqual(self.balance(), -192_000)

    def test_a_date_left_out_is_today(self):
        self.post(self.seats(), {"user_id": self.student.pk, "status": "active"})
        self.assertEqual(M.objects.get(classroom=self.room, user=self.student).seat_start_date, TODAY)

    def test_a_date_that_is_not_one_is_refused_in_words(self):
        for bad in ("soon", "2026-02-30"):
            response = self.add("active", bad)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "That is not a date.")

    def test_a_refusal_comes_back_in_words(self):
        self.add("active")
        response = self.add("active")
        self.assertEqual(response.status_code, 400)
        self.assertIn("already in", response.json()["detail"])

    def test_a_class_with_no_price_says_so(self):
        free = self.make_room("Free", price=None)
        response = self.add("active", room=free)
        self.assertEqual(response.status_code, 400)
        self.assertIn("no monthly price", response.json()["detail"])

    def test_no_student_named(self):
        self.assertEqual(self.post(self.seats(), {"status": "trial"}).status_code, 400)
        self.assertEqual(self.post(self.seats(), {"user_id": "x", "status": "trial"}).status_code, 400)

    def test_a_student_or_class_that_is_not_there(self):
        self.assertEqual(self.post(self.seats(), {"user_id": 999999, "status": "trial"}).status_code, 404)
        self.assertEqual(self.post("/api/classes/admin/classrooms/999999/seats/", {"user_id": self.student.pk}).status_code, 404)
        self.assertEqual(self.post(f"{self.seats()}999999/leave/").status_code, 404)

    def test_an_action_that_does_not_exist(self):
        self.assertEqual(self.action("explode").status_code, 404)

    def test_activate(self):
        self.add("trial", "2026-10-12")
        self.assertEqual(self.action("activate", {"date": "2026-10-21"}).status_code, 200)
        self.assertEqual(self.balance(), -192_000)

    def test_freeze_and_return(self):
        self.add("active")
        self.assertEqual(self.action("freeze", {"date": "2026-10-19"}).json()["seat_status"], "frozen")
        self.assertEqual(self.balance(), -308_000)
        self.assertEqual(self.action("return", {"date": "2026-10-26"}).json()["seat_status"], "active")
        self.assertEqual(self.balance(), -423_000)

    def test_move(self):
        other = self.make_room("Middle G2", days="EVEN")
        self.add("active")
        response = self.action("move", {"date": "2026-10-19", "to_classroom": other.pk})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["classroom_id"], other.pk)
        self.assertEqual(self.balance(), -522_000)

    def test_move_needs_a_group_that_exists(self):
        self.add("active")
        for data in ({"date": "2026-10-19"}, {"to_classroom": 999999}, {"to_classroom": "x"}):
            response = self.action("move", data)
            self.assertEqual(response.status_code, 400)
            self.assertIn("Choose the group", response.json()["detail"])

    def test_leave(self):
        self.add("active")
        response = self.action("leave", {"date": "2026-10-19"})
        self.assertEqual((response.json()["status"], response.json()["seat_left_on"]), ("REMOVED", "2026-10-19"))
        self.assertEqual(self.balance(), -308_000)

    def test_fix_date(self):
        self.add("active", "2026-10-12")
        self.assertEqual(self.action("fix-date", {"date": "2026-10-14"}).json()["seat_start_date"], "2026-10-14")

    def test_the_history_says_what_and_who(self):
        self.add("active")
        self.action("freeze", {"date": "2026-10-19"})
        api = APIClient()
        api.force_authenticate(self.admin)
        items = api.get(f"/api/classes/admin/classrooms/{self.room.pk}/history/", HTTP_HOST=ADMIN_HOST).json()["items"]
        self.assertIn("Frozen from 2026-10-19", items[0]["title"])
        self.assertTrue(items[0]["by"])
        titles = [row["title"] for row in history_part(self.student)["items"] if row["kind"] == "group"]
        self.assertTrue(any("Frozen from 2026-10-19" in title for title in titles), titles)

    def test_the_join_audit_names_the_admin(self):
        self.add("active")
        self.assertEqual(Event.objects.get(student=self.student, action=Event.ACTION_ADDED).actor, self.admin)


class NewStudentApiTests(ApiCase):
    def test_it_makes_the_account_and_the_seat(self):
        response = self.new_student(parent_name="Karim", parent_phone="907777777", status="active", date="2026-10-21")
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(username=PHONE)
        self.assertEqual(response.json()["user_id"], user.pk)
        self.assertEqual(response.json()["login"], {"phone": PHONE, "code": "0011"})
        self.assertEqual((user.parent_name, user.parent_phone), ("Karim", "998907777777"))
        self.assertEqual(self.balance(user), -192_000)

    def test_refusals_come_back_in_words(self):
        response = self.new_student(phone="123")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Uzbek", response.json()["detail"])

    def test_a_centre_account_on_the_phone_is_shown(self):
        other = self.make_room("Middle G2")
        sibling = User.objects.create_user(
            None, password=None, username="sib", role="student", phone_number=PHONE, first_name="Sara", last_name="Karimova"
        )
        M.objects.create(classroom=other, user=sibling, role=M.ROLE_STUDENT)
        response = self.new_student()
        self.assertEqual(response.status_code, 409, response.content)
        body = response.json()
        self.assertEqual(body["code"], "phone_taken")
        self.assertIn("Sara Karimova", body["detail"])
        self.assertIn("different phone", body["detail"])
        self.assertEqual(
            body["account"],
            {"id": sibling.pk, "name": "Sara Karimova", "section": "students", "groups": ["Middle G2"], "can_add": True},
        )

    def test_a_public_account_whose_login_is_the_phone_cannot_simply_be_added(self):
        User.objects.create_user(None, password=None, username=PHONE, role="public_student", phone_number=PHONE, first_name="Pub")
        body = self.new_student().json()
        self.assertEqual(body["code"], "phone_taken")
        self.assertFalse(body["account"]["can_add"])

    def test_a_public_accounts_phone_moves_quietly(self):
        old = User.objects.create_user(None, password=None, username="old", role="public_student", phone_number=PHONE)
        self.assertEqual(self.new_student().status_code, 201)
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)


class RosterTests(ApiCase):
    def get(self, part=""):
        api = APIClient()
        api.force_authenticate(self.admin)
        return api.get(f"/api/classes/admin/classrooms/{self.room.pk}/{part}", HTTP_HOST=ADMIN_HOST).json()

    def test_the_class_page_has_the_price(self):
        self.assertEqual(self.get()["monthly_price"], 500_000)

    def test_a_row_has_its_seat(self):
        self.add("trial", "2026-10-12")
        row = self.get("roster/")["students"][0]
        self.assertEqual((row["seat_status"], row["seat_start_date"]), ("trial", "2026-10-12"))

    def test_who_left_is_listed_apart(self):
        self.add("active")
        self.action("leave", {"date": "2026-10-19"})
        part = self.get("roster/")
        self.assertEqual(part["students"], [])
        self.assertEqual(part["left"][0]["id"], self.student.pk)
        self.assertEqual(part["left"][0]["seat_left_on"], "2026-10-19")

    def test_a_teacher_sees_a_badge_and_no_money(self):
        self.add("active")
        api = APIClient()
        api.force_authenticate(self.teacher)
        for path in (f"/api/classes/{self.room.pk}/", f"/api/classes/{self.room.pk}/people/", f"/api/classes/{self.room.pk}/members/"):
            response = api.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertNotIn("monthly_price", str(response.content), path)
            self.assertNotIn("500000", str(response.content), path)


class GroupFormTests(ApiCase):
    def patch(self, data, *, user=None, path=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        host = ADMIN_HOST if (user or self.admin) == self.admin else "mastersat.uz"
        return api.patch(path or f"/api/classes/{self.room.pk}/details/", data, format="json", HTTP_HOST=host)

    def test_an_admin_sets_the_price_and_the_seats_follow(self):
        self.add("active")
        self.assertEqual(self.patch({"monthly_price": 600_000}).status_code, 200)
        self.room.refresh_from_db()
        self.assertEqual(self.room.monthly_price, 600_000)
        self.assertEqual(Seat.objects.get().price, 600_000)
        self.assertEqual(self.balance(), -500_000)

    def test_new_lesson_days_reach_the_seats(self):
        self.add("active")
        self.patch({"lesson_days": "EVEN"})
        self.assertEqual(Seat.objects.get().days, [2, 4, 6])

    def test_nothing_else_touches_the_seats(self):
        self.add("active")
        Seat.objects.update(price=123)
        self.patch({"room_number": "301"})
        self.assertEqual(Seat.objects.get().price, 123)

    def test_a_price_of_nothing_is_refused(self):
        self.assertEqual(self.patch({"monthly_price": 0}).status_code, 400)

    def test_it_can_be_cleared(self):
        self.assertEqual(self.patch({"monthly_price": None}).status_code, 200)
        self.room.refresh_from_db()
        self.assertIsNone(self.room.monthly_price)

    @override_settings(LCUP_ENABLED=True)
    def test_the_guard_locks_the_price_of_a_paired_class(self):
        LcupGroupLink.objects.create(lcup_group_id=1, name="G1", classroom=self.room, status=GroupLinkStatus.CONFIRMED)
        response = self.patch({"monthly_price": 600_000})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["fields"], ["monthly_price"])
        self.assertEqual(self.patch({"monthly_price": 500_000}).status_code, 200)
        api = APIClient()
        api.force_authenticate(self.admin)
        core = api.get(f"/api/classes/admin/classrooms/{self.room.pk}/", HTTP_HOST=ADMIN_HOST).json()
        self.assertIn("monthly_price", core["lcup"]["locked_fields"])

    def test_a_teacher_cannot_write_it_through_their_own_form(self):
        response = self.patch({"monthly_price": 1, "room_number": "9"}, user=self.teacher, path=f"/api/classes/{self.room.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("monthly_price", str(response.content))
        self.room.refresh_from_db()
        self.assertEqual(self.room.monthly_price, 500_000)

    def test_a_new_class_takes_a_price_from_an_admin(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        response = api.post(
            "/api/classes/",
            {"name": "New", "subject": "MATH", "lesson_days": "ODD", "monthly_price": 450_000}, format="json", HTTP_HOST=ADMIN_HOST,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Classroom.objects.get(name="New").monthly_price, 450_000)
