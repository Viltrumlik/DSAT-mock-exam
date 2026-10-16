"""/ops: the class Telegram group for admins — who is in it, who the bot looks after, and the
Remove button for the people it never will (decision 3, 2026-10-16)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.utils import timezone

from classes.models_telegram import ClassroomTelegramMember
from classes.tests_telegram_group import CHAT, TelegramGroupBase

User = get_user_model()
JOINED = ClassroomTelegramMember.STATUS_JOINED


class OpsTelegramPartTests(TelegramGroupBase):
    def url(self, tail=""):
        return f"/api/classes/admin/classrooms/{self.classroom.pk}/telegram/{tail}"

    def member(self, user, tg_id, *, identified=False, status="member"):
        self.tg.join(tg_id, status=status)
        return ClassroomTelegramMember.objects.create(
            classroom=self.classroom, user=user, telegram_user_id=tg_id, status=JOINED,
            joined_at=timezone.now(), identified_at=timezone.now() if identified else None,
        )

    def test_the_part_lists_who_is_in_and_who_the_bot_looks_after(self):
        self.member(self.student, 1001, identified=True)
        self.member(self.other, 1002)
        User.objects.filter(pk=self.other.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.client.force_authenticate(user=self.admin)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertTrue(body["configured"])
        by_tg = {m["telegram_user_id"]: m for m in body["members"]}
        self.assertTrue(by_tg[1001]["managed"])
        self.assertFalse(by_tg[1002]["managed"])
        self.assertTrue(by_tg[1002]["frozen_for_debt"])
        self.assertEqual(body["counts"]["known"], 2)
        self.assertEqual(body["counts"]["managed"], 1)
        self.assertEqual(body["counts"]["frozen_in_group"], 1)
        self.assertIsNotNone(body["counts"]["in_group"])

    def test_a_class_without_a_group_says_so(self):
        self.classroom.telegram_chat_id = ""
        self.classroom.save(update_fields=["telegram_chat_id"])
        self.client.force_authenticate(user=self.admin)
        self.assertFalse(self.client.get(self.url()).json()["configured"])

    def test_teachers_cannot_read_it(self):
        self.client.force_authenticate(user=self.teacher)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_an_admin_removes_an_old_member_by_hand(self):
        row = self.member(self.other, 1002)
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn((CHAT, 1002), self.tg.kicked)
        row.refresh_from_db()
        self.assertEqual(row.removed_reason, ClassroomTelegramMember.REASON_MANUAL)

    def test_a_chat_admin_is_never_removed(self):
        row = self.member(self.other, 1002, status="administrator")
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.tg.kicked, [])

    def test_only_admins_may_remove(self):
        row = self.member(self.other, 1002)
        self.client.force_authenticate(user=self.teacher)
        r = self.client.post(self.url("remove/"), {"member_id": row.pk}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.tg.kicked, [])

    def test_another_classes_row_is_not_found(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(self.url("remove/"), {"member_id": 999999}, format="json")
        self.assertEqual(r.status_code, 404)
