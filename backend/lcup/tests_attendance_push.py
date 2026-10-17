"""Sending what only we have to lc-up — once per group and day, never before the cutover.

lc-up charges the day's fee and messages the parents' bot for every mark it receives, so every
refusal to send here is a guard on money: the switch, the cutover date, a student lc-up has that we
could not match, and the one-push-per-register rule.
"""

from __future__ import annotations

from django.test import override_settings
from django.utils import timezone

from lcup.attendance import plan_day, push_day, push_held_reason
from lcup.client import LcupUnavailable, LcupWindowClosed
from lcup.models import LcupAttendancePush, LcupMembership, LcupStudentLink
from lcup.testing import POST_ATTENDANCE, FakeLcupClient
from lcup.tests_attendance_reconcile import DAY, R, ReconcileFixture

PUSH_ON = {"LCUP_ATTENDANCE_PUSH_ENABLED": True, "LCUP_ATTENDANCE_PUSH_FROM": DAY.isoformat()}


@override_settings(**PUSH_ON)
class PushTests(ReconcileFixture):
    def setUp(self):
        super().setUp()
        self.mark(self.s1, R.STATUS_PRESENT)
        self.mark(self.s2, R.STATUS_EXCUSED, reason_id=3035)
        self.now = timezone.now()

    def push(self, client):
        return push_day(client, plan_day(self.link, DAY, [], gap_fill=True), now=self.now)

    def test_it_sends_the_group_and_day_and_records_what_it_sent(self):
        client = FakeLcupClient({})
        push = self.push(client)
        self.assertEqual(client.posts, [(10, DAY, [
            {"student_id": 101, "status": "present"},
            {"student_id": 102, "status": "absent", "reason_id": 3035},
        ])])
        self.assertEqual((push.state, push.attempts, push.sent_at), (LcupAttendancePush.STATE_SENT, 1, self.now))
        self.assertEqual({r["user_id"] for r in push.records}, {self.s1.pk, self.s2.pk})
        self.assertEqual(push.summary["saved"], 2)

    @override_settings(LCUP_ATTENDANCE_PUSH_FROM="2026-10-13")
    def test_a_day_before_the_cutover_is_never_sent(self):
        client = FakeLcupClient({})
        self.assertIsNone(self.push(client))
        self.assertEqual((client.posts, LcupAttendancePush.objects.count()), ([], 0))

    @override_settings(LCUP_ATTENDANCE_PUSH_FROM="")
    def test_no_cutover_means_nothing_is_sent(self):
        client = FakeLcupClient({})
        self.assertIsNone(self.push(client))
        self.assertEqual(client.posts, [])

    @override_settings(LCUP_ATTENDANCE_PUSH_ENABLED=False)
    def test_switched_off_nothing_is_sent(self):
        client = FakeLcupClient({})
        self.assertIsNone(self.push(client))
        self.assertEqual(client.posts, [])

    def test_an_lcup_student_with_no_account_here_holds_the_push(self):
        # Their fee would be missed: we can only send the students we know.
        unknown = LcupStudentLink.objects.create(lcup_student_id=555, name="Unknown Student")
        LcupMembership.objects.create(group=self.link, student=unknown, lcup_status="active")
        client = FakeLcupClient({})
        self.assertIsNone(self.push(client))
        self.assertEqual(client.posts, [])
        self.assertIn(self.link.name, push_held_reason(self.link))

    def test_a_member_lcup_holds_frozen_is_not_sent(self):
        # lc-up refuses a frozen member's mark (not_in_group, 13 of 13 on prod by 2026-10-16).
        link = LcupStudentLink.objects.get(lcup_student_id=101)
        LcupMembership.objects.create(group=self.link, student=link, lcup_status="frozen")
        client = FakeLcupClient({})
        self.push(client)
        self.assertEqual(client.posts, [(10, DAY, [{"student_id": 102, "status": "absent", "reason_id": 3035}])])

    def test_a_member_who_has_left_their_freeze_behind_is_sent(self):
        link = LcupStudentLink.objects.get(lcup_student_id=101)
        LcupMembership.objects.create(group=self.link, student=link, lcup_status="active")
        client = FakeLcupClient({})
        self.push(client)
        self.assertEqual([r["student_id"] for r in client.posts[0][2]], [101, 102])

    def test_a_sent_register_is_never_sent_again(self):
        client = FakeLcupClient({})
        self.push(client)
        self.assertIsNone(self.push(client))
        self.assertEqual(len(client.posts), 1)

    def test_a_failed_push_is_tried_again_and_given_up_after_five(self):
        client = FakeLcupClient({POST_ATTENDANCE: LcupUnavailable("lc-up answered 503")})
        for _ in range(5):
            push = self.push(client)
            self.assertEqual(push.state, LcupAttendancePush.STATE_FAILED)
        self.assertIsNone(self.push(client))
        self.assertEqual((len(client.posts), LcupAttendancePush.objects.get().attempts), (5, 5))

    def test_a_closed_lcup_window_is_refused_for_good(self):
        client = FakeLcupClient({POST_ATTENDANCE: LcupWindowClosed("lc-up answered 403")})
        self.assertEqual(self.push(client).state, LcupAttendancePush.STATE_REFUSED)
        self.assertIsNone(self.push(client))
        self.assertEqual(len(client.posts), 1)

    def test_students_lcup_did_not_take_are_recorded(self):
        def answer(group_id, day, records):
            return {
                "summary": {"saved": 1, "deleted": 0, "unchanged": 0, "failed": 1},
                "results": [
                    {"student_id": 101, "status": "present", "result": "saved", "error": None},
                    {"student_id": 102, "status": "absent", "result": "failed",
                     "error": {"code": "blocked_debt", "message": "Qarzdorlik sababli bloklangan"}},
                ],
            }

        push = self.push(FakeLcupClient({POST_ATTENDANCE: answer}))
        self.assertEqual(push.state, LcupAttendancePush.STATE_SENT)
        self.assertEqual(
            push.failures,
            [{"user_id": self.s2.pk, "student_id": 102, "code": "blocked_debt", "message": "Qarzdorlik sababli bloklangan"}],
        )


@override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
class PushListViewTests(ReconcileFixture):
    def test_an_admin_sees_each_push_and_the_students_lcup_did_not_take(self):
        from rest_framework.test import APIClient

        from users.models import User

        LcupAttendancePush.objects.create(
            group=self.link, date=DAY, state=LcupAttendancePush.STATE_SENT, attempts=1,
            records=[{"user_id": self.s1.pk, "student_id": 101, "status": "present"},
                     {"user_id": self.s2.pk, "student_id": 102, "status": "absent"}],
            summary={"saved": 1, "failed": 1},
            failures=[{"user_id": self.s2.pk, "student_id": 102, "code": "blocked_debt", "message": "x"}],
        )
        api = APIClient()
        api.force_authenticate(User.objects.create_user(None, password=None, username="boss", role="admin"))
        body = api.get("/api/lcup/attendance/pushes/", HTTP_HOST="admin.mastersat.uz").json()
        self.assertEqual(len(body), 1)
        push = body[0]
        self.assertEqual((push["group"], push["date"], push["state"], push["marks"]), (self.link.name, DAY.isoformat(), "sent", 2))
        self.assertEqual(push["failures"][0]["code"], "blocked_debt")
        self.assertEqual(push["failures"][0]["student"]["id"], self.s2.pk)

    def test_a_teacher_is_refused(self):
        from rest_framework.test import APIClient

        api = APIClient()
        api.force_authenticate(self.teacher)
        self.assertEqual(api.get("/api/lcup/attendance/pushes/", HTTP_HOST="admin.mastersat.uz").status_code, 403)
