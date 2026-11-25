"""The lesson changes' API (owner, 2026-11-25): cancel, move, a centre holiday and undo behind ``manage_lessons``, the
list behind ``view_people``. December 2026: Monday 7, Tuesday 8, Wednesday 9; the class is ODD (Mon/Wed/Fri)."""

from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from access.models import Permission, UserPermission
from billing import ledger
from billing.models import Entry, EntryKind
from billing.tests_lesson_rule import LESSON_MODE, seat_for, student
from billing.tests_seat_class import make_room
from classes.models_lesson_changes import LessonChange

User = get_user_model()
HOST = "admin.mastersat.uz"
TODAY = date(2026, 12, 9)  # a Wednesday
MON, TUE, WED, THU = date(2026, 12, 7), date(2026, 12, 8), date(2026, 12, 9), date(2026, 12, 10)


def deny(user, codename):
    permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename})
    UserPermission.objects.create(user=user, permission=permission, granted=False)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class ApiCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role=C.ROLE_ADMIN)
        self.room = make_room()  # ODD, "Junior G1"
        patcher = mock.patch("classes.views_lesson_changes._today", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method, path, body=None, *, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        if method == "get":
            return api.get(path, body or {}, HTTP_HOST=HOST)
        return api.post(path, body or {}, format="json", HTTP_HOST=HOST)

    def cancel(self, day="2026-12-07", reason="Teacher ill", **kw):
        return self.call("post", f"/api/classes/admin/classrooms/{self.room.pk}/lessons/cancel/", {"day": day, "reason": reason}, **kw)

    def move(self, day="2026-12-07", new_day="2026-12-08", reason="Teacher at a seminar", **kw):
        body = {"day": day, "new_day": new_day, "reason": reason}
        return self.call("post", f"/api/classes/admin/classrooms/{self.room.pk}/lessons/move/", body, **kw)

    def holiday(self, day="2026-12-08", reason="Independence Day", **kw):
        return self.call("post", "/api/classes/admin/lessons/holiday/", {"day": day, "reason": reason}, **kw)

    def undo(self, change_id, **kw):
        return self.call("post", f"/api/classes/admin/lesson-changes/{change_id}/undo/", **kw)

    def listed(self, user=None, **params):
        return self.call("get", "/api/classes/admin/lesson-changes/", params, user=user)


class PermissionTests(ApiCase):
    def writes(self, user):
        change = LessonChange.objects.create(classroom=self.room, day=MON, kind="cancel", reason="r")
        return [
            self.cancel("2026-12-09", user=user), self.move("2026-12-11", "2026-12-12", user=user),
            self.holiday(user=user), self.undo(change.pk, user=user),
        ]

    def test_an_admin_may(self):
        self.assertEqual([r.status_code for r in self.writes(self.admin)], [201, 201, 201, 200])

    def test_the_owner_always_may(self):
        owner = User.objects.create_user(None, password=None, username="owner", role=C.ROLE_SUPER_ADMIN)
        self.assertEqual([r.status_code for r in self.writes(owner)], [201, 201, 201, 200])

    def test_a_teacher_may_not_even_read(self):
        teacher = User.objects.create_user(None, password=None, username="t", role=C.ROLE_TEACHER, subject="math")
        self.assertEqual([r.status_code for r in self.writes(teacher)], [403, 403, 403, 403])
        self.assertEqual(self.listed(user=teacher).status_code, 403)

    def test_an_accountant_reads_but_may_not_change_a_lesson(self):
        accountant = User.objects.create_user(None, password=None, username="acc", role=C.ROLE_ACCOUNTANT)
        self.assertEqual([r.status_code for r in self.writes(accountant)], [403, 403, 403, 403])
        self.assertEqual(self.listed(user=accountant).status_code, 200)
        self.assertEqual(LessonChange.objects.count(), 1)

    def test_the_staff_page_can_take_it_from_one_admin(self):
        deny(self.admin, C.PERM_MANAGE_LESSONS)
        self.assertEqual(self.cancel().status_code, 403)
        self.assertEqual(self.listed().status_code, 200)


class EndpointTests(ApiCase):
    def test_cancel(self):
        response = self.cancel()
        self.assertEqual(response.status_code, 201, response.content)
        change = LessonChange.objects.get()
        body = response.json()
        self.assertEqual(
            {k: body["change"][k] for k in ("id", "classroom_id", "classroom", "kind", "reason", "day", "new_day")},
            {"id": change.pk, "classroom_id": self.room.pk, "classroom": "Junior G1", "kind": "cancel",
             "reason": "Teacher ill", "day": "2026-12-07", "new_day": None},
        )
        self.assertEqual((body["change"]["created_by"], body["change"]["undone_at"]), ("boss", None))
        self.assertEqual(body["money"], {"voided": 0, "students": 0, "amount": 0, "unfrozen": 0, "frozen": 0})
        self.assertEqual(change.created_by, self.admin)

    def test_move(self):
        response = self.move()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            (response.json()["change"]["kind"], response.json()["change"]["new_day"]), ("move", "2026-12-08")
        )

    def test_holiday(self):
        response = self.holiday()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            (response.json()["change"]["classroom_id"], response.json()["change"]["classroom"]), (None, None)
        )

    def test_undo(self):
        change_id = self.cancel().json()["change"]["id"]
        response = self.undo(change_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["change"]["undone_by"], "boss")
        self.assertIsNotNone(response.json()["change"]["undone_at"])
        self.assertIsNotNone(LessonChange.objects.get(pk=change_id).undone_at)

    def test_the_list_is_the_live_changes_of_those_days_for_a_class_and_its_holidays(self):
        other = make_room("Middle G2")
        mine = self.cancel().json()["change"]["id"]
        holiday = self.holiday().json()["change"]["id"]
        self.call("post", f"/api/classes/admin/classrooms/{other.pk}/lessons/cancel/", {"day": "2026-12-09", "reason": "r"})
        self.undo(self.move("2026-12-11", "2026-12-12").json()["change"]["id"])
        body = self.listed(**{"from": "2026-12-07", "to": "2026-12-13", "classroom": str(self.room.pk)}).json()
        self.assertEqual((body["from"], body["to"]), ("2026-12-07", "2026-12-13"))
        self.assertEqual([row["id"] for row in body["changes"]], [mine, holiday])
        self.assertEqual(len(self.listed(**{"from": "2026-12-07", "to": "2026-12-13"}).json()["changes"]), 3)
        self.assertEqual(self.listed(**{"from": "2026-12-08", "to": "2026-12-08"}).json()["changes"][0]["id"], holiday)

    def test_the_list_by_default_is_the_days_that_can_be_changed(self):
        self.cancel()
        body = self.listed().json()
        self.assertEqual((body["from"], body["to"], len(body["changes"])), ("2026-11-08", "2027-02-07", 1))

    def test_unknown_things_are_not_found(self):
        self.assertEqual(self.call("post", "/api/classes/admin/classrooms/999999/lessons/cancel/", {"day": "2026-12-07", "reason": "r"}).status_code, 404)
        self.assertEqual(self.undo(999999).status_code, 404)


class RefusalTests(ApiCase):
    def test_a_refusal_says_why_in_words(self):
        response = self.cancel("2026-12-08")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "Junior G1 has no lesson on 8 Dec."}))
        self.assertFalse(LessonChange.objects.exists())

    def test_a_reason_and_real_dates_are_needed(self):
        self.assertEqual(self.cancel(reason="  ").json(), {"detail": "A lesson change needs a reason."})
        for bad in ("", "2026-02-30", "8 Dec"):
            with self.subTest(day=bad):
                self.assertEqual((self.cancel(bad).status_code, self.cancel(bad).json()), (400, {"detail": "That is not a date."}))
        self.assertEqual(self.move(new_day="soon").json(), {"detail": "That is not a date."})
        self.assertEqual(self.listed(**{"from": "yesterday"}).status_code, 400)
        self.assertEqual(self.listed(classroom="x").status_code, 400)

    def test_undo_twice(self):
        change_id = self.cancel().json()["change"]["id"]
        self.undo(change_id)
        self.assertEqual(self.undo(change_id).json(), {"detail": "This change was undone already."})


@LESSON_MODE
class MoneyTests(ApiCase):
    def test_the_money_says_what_came_back(self):
        _, account = student("ali")
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=0, day=date(2026, 11, 30), key="open:ali")
        seat = seat_for(account)
        seat.classroom = self.room
        seat.save(update_fields=["classroom"])
        ledger.start_span(seat, date(2026, 12, 2), today=TODAY)
        money = self.cancel().json()["money"]
        self.assertEqual(money, {"voided": 1, "students": 1, "amount": 38_500, "unfrozen": 0, "frozen": 0})
        self.assertEqual(self.undo(LessonChange.objects.get().pk).json()["money"]["voided"], 0)
        self.assertEqual(account.entries.filter(key__startswith="lesson:", voided_at__isnull=True).count(), 4)
