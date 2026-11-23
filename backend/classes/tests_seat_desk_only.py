"""Part B of leaving lc-up (owner, 2026-11-22): once the ledger is the master, a student joins or leaves a group only
through the seat tools, which write the money; every other way in or out is refused, and a class with students in
it cannot be archived or deleted."""

from django.test import override_settings
from rest_framework.test import APIClient

from billing.models import Seat, SeatState
from classes.models import Classroom, ClassroomMembership as M
from classes.tests_seat_api import ADMIN_HOST, ApiCase

OURS = override_settings(LCUP_ENABLED=False, BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False)


def as_(user):
    api = APIClient()
    api.force_authenticate(user)
    return api


class Fixture(ApiCase):
    def seated(self):
        self.assertEqual(self.add("active").status_code, 201)
        return M.objects.get(classroom=self.room, user=self.student)

    def details(self, data, room=None):
        return as_(self.admin).patch(f"/api/classes/{(room or self.room).pk}/details/", data, format="json", HTTP_HOST=ADMIN_HOST)


@OURS
class DeskOnlyTests(Fixture):
    def test_the_teacher_roster_cannot_take_a_student_out(self):
        row = self.seated()
        response = as_(self.teacher).patch(f"/api/classes/{self.room.pk}/members/{self.student.pk}/", {"status": "REMOVED"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "desk_only"))
        row.refresh_from_db()
        self.assertEqual(row.status, M.STATUS_ACTIVE)
        self.assertTrue(Seat.objects.get(classroom=self.room).spans.filter(end__isnull=True).exists())

    def test_the_code_less_add_is_refused(self):
        response = as_(self.admin).post(f"/api/classes/{self.room.pk}/members/", {"user_id": self.student.pk}, format="json", HTTP_HOST=ADMIN_HOST)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "desk_only"))
        self.assertFalse(M.objects.filter(classroom=self.room, user=self.student).exists())

    def test_a_join_code_is_refused(self):
        response = as_(self.student).post("/api/classes/join/", {"join_code": self.room.join_code}, format="json", HTTP_HOST="mastersat.uz")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "desk_only"))
        self.assertFalse(M.objects.filter(classroom=self.room, user=self.student).exists())

    def test_the_seat_tools_still_move_them(self):
        self.seated()
        self.assertEqual(self.action("leave", {"date": "2026-10-19"}).status_code, 200)
        self.assertEqual(Seat.objects.get(classroom=self.room).state, SeatState.LEFT)

    def test_a_class_with_a_student_in_it_is_not_archived(self):
        self.seated()
        response = self.details({"is_active": False})
        self.assertEqual(response.status_code, 409)
        self.assertIn("1 student is still in Junior G1", response.json()["detail"])
        self.room.refresh_from_db()
        self.assertTrue(self.room.is_active)

    def test_once_they_left_it_is(self):
        self.seated()
        self.action("leave", {"date": "2026-10-19"})
        self.assertEqual(self.details({"is_active": False}).status_code, 200)
        self.room.refresh_from_db()
        self.assertFalse(self.room.is_active)

    def test_a_seat_with_no_platform_account_still_counts(self):
        from billing.models import Account

        Seat.objects.create(
            account=Account.objects.create(name="Old lc-up student"), classroom=self.room, group_name="Junior G1",
            price=500_000, days=[1, 3, 5], state=SeatState.ACTIVE,
        )
        self.assertEqual(self.details({"is_active": False}).status_code, 409)

    def test_nor_deleted(self):
        self.seated()
        governance = as_(self.admin).delete(f"/api/classes/{self.room.pk}/governance-delete/", HTTP_HOST=ADMIN_HOST)
        self.assertEqual(governance.status_code, 409)
        M.objects.filter(classroom=self.room, user=self.teacher).update(role=M.ROLE_ADMIN)  # the class's owner
        owner = as_(self.teacher).delete(f"/api/classes/{self.room.pk}/")
        self.assertEqual(owner.status_code, 409)
        self.assertTrue(Classroom.objects.filter(pk=self.room.pk).exists())

    def test_an_empty_class_is_archived_and_deleted_as_before(self):
        empty = self.make_room("Empty")
        self.assertEqual(self.details({"is_active": False}, room=empty).status_code, 200)
        self.assertEqual(as_(self.admin).delete(f"/api/classes/{empty.pk}/governance-delete/", HTTP_HOST=ADMIN_HOST).status_code, 204)


class BeforeTheCutoverTests(Fixture):
    """While lc-up is the master (the default here), nothing changes."""

    def test_the_roster_and_the_join_code_work_as_before(self):
        joined = as_(self.student).post("/api/classes/join/", {"join_code": self.room.join_code}, format="json", HTTP_HOST="mastersat.uz")
        self.assertEqual(joined.status_code, 200, joined.content)
        removed = as_(self.teacher).patch(f"/api/classes/{self.room.pk}/members/{self.student.pk}/", {"status": "REMOVED"}, format="json")
        self.assertEqual(removed.status_code, 200, removed.content)

    def test_a_class_with_students_is_archived_as_before(self):
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        self.assertEqual(self.details({"is_active": False}).status_code, 200)
