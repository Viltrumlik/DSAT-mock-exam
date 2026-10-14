"""``LcupClient.post_attendance`` — the integration's only write to lc-up.

lc-up's ``POST /attendance`` charges the day's fee and messages the parents' bot, so the method
refuses outright while the push switch is off, and treats lc-up's "the window is closed" (403) as
final rather than something to retry.
"""

from __future__ import annotations

from datetime import date

from django.test import SimpleTestCase, override_settings

from lcup.client import LcupAuthError, LcupError, LcupUnavailable, LcupWindowClosed
from lcup.conf import attendance_pull_enabled, attendance_push_enabled, attendance_push_from
from lcup.tests_client import FakeResponse, login_ok, make, ok

RECORDS = [{"student_id": 140434, "status": "absent", "reason_id": 3034}, {"student_id": 140435, "status": "present"}]
ANSWER = {"group_id": 10111, "date": "2026-10-15", "summary": {"saved": 2, "deleted": 0, "unchanged": 0, "failed": 0}, "results": []}


@override_settings(LCUP_ATTENDANCE_PUSH_ENABLED=True)
class PostAttendanceTests(SimpleTestCase):
    def test_it_sends_one_group_and_day_exactly_as_lcup_documents_it(self):
        client, session, _ = make([login_ok(), ok(ANSWER)])
        self.assertEqual(client.post_attendance(10111, date(2026, 10, 15), RECORDS), ANSWER)
        sent = session.requests[-1]
        self.assertEqual((sent["method"], sent["url"]), ("POST", "https://lcup.test/api/external/v1/attendance"))
        self.assertEqual(sent["json"], {"group_id": 10111, "date": "2026-10-15", "records": RECORDS})
        self.assertEqual(sent["headers"]["Authorization"], "Bearer 1|tok")

    @override_settings(LCUP_ATTENDANCE_PUSH_ENABLED=False)
    def test_switched_off_it_refuses_before_any_request(self):
        client, session, _ = make([])
        with self.assertRaises(LcupError):
            client.post_attendance(10111, date(2026, 10, 15), RECORDS)
        self.assertEqual(session.requests, [])

    def test_a_closed_window_is_final_and_not_retried(self):
        client, session, sleeps = make([login_ok(), FakeResponse(403, {"success": False, "message": "yopiq"})])
        with self.assertRaises(LcupWindowClosed):
            client.post_attendance(10111, date(2026, 10, 15), RECORDS)
        self.assertEqual(len(session.requests), 2)  # the login, then one POST
        self.assertEqual(sleeps, [])

    def test_a_busy_group_day_is_retried_after_retry_after(self):
        busy = FakeResponse(409, {"success": False}, {"Retry-After": "2"})
        client, session, sleeps = make([login_ok(), busy, ok(ANSWER)])
        self.assertEqual(client.post_attendance(10111, date(2026, 10, 15), RECORDS), ANSWER)
        self.assertEqual(sleeps, [2])

    def test_it_gives_up_after_the_retries(self):
        client, _, _ = make([login_ok()] + [FakeResponse(503)] * 4)
        with self.assertRaises(LcupUnavailable):
            client.post_attendance(10111, date(2026, 10, 15), RECORDS)

    def test_a_stale_token_is_refreshed_once(self):
        client, session, _ = make([login_ok("1|old"), FakeResponse(401), login_ok("2|new"), ok(ANSWER)])
        client.post_attendance(10111, date(2026, 10, 15), RECORDS)
        self.assertEqual(session.requests[-1]["headers"]["Authorization"], "Bearer 2|new")

    def test_a_second_refusal_of_a_fresh_token_is_an_auth_error(self):
        client, _, _ = make([login_ok(), FakeResponse(401), login_ok("2|new"), FakeResponse(401)])
        with self.assertRaises(LcupAuthError):
            client.post_attendance(10111, date(2026, 10, 15), RECORDS)

    def test_more_than_a_hundred_records_is_refused_here(self):
        client, session, _ = make([])
        with self.assertRaises(LcupError):
            client.post_attendance(10111, date(2026, 10, 15), [{"student_id": i, "status": "present"} for i in range(101)])
        self.assertEqual(session.requests, [])


class SwitchTests(SimpleTestCase):
    def test_everything_is_off_by_default(self):
        self.assertFalse(attendance_pull_enabled())
        self.assertFalse(attendance_push_enabled())
        self.assertIsNone(attendance_push_from())

    @override_settings(LCUP_ATTENDANCE_PULL_ENABLED=True, LCUP_ATTENDANCE_PUSH_ENABLED=True, LCUP_ATTENDANCE_PUSH_FROM="2026-10-15")
    def test_the_switches_read_their_settings(self):
        self.assertTrue(attendance_pull_enabled())
        self.assertTrue(attendance_push_enabled())
        self.assertEqual(attendance_push_from(), date(2026, 10, 15))

    @override_settings(LCUP_ATTENDANCE_PUSH_FROM="tomorrow")
    def test_an_unreadable_cutover_is_no_cutover(self):
        self.assertIsNone(attendance_push_from())
