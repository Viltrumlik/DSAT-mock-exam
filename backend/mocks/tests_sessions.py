"""Invigilated mock sittings: code -> request -> approve -> one Start for the whole room.

    python manage.py test mocks.tests_sessions --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from mocks.models import MockAttempt, MockSession, MockSessionParticipant
from mocks.sessions import request_place, start_session
from mocks.state_machine import STATE_COMPLETED, STATE_ENGLISH_M1, STATE_NOT_STARTED
from mocks.tests_scoring import make_mock

User = get_user_model()
ADMIN_SESSIONS = "/api/mocks/admin/sessions/"


def make_session(mock, *, date=None, code="123456", status=MockSession.STATUS_OPEN):
    return MockSession.objects.create(
        mock=mock, session_date=date or timezone.localdate(),
        access_code=code, access_code_set_at=timezone.now(), status=status,
    )


class JoinRequestTests(TestCase):
    def setUp(self):
        self.mock, _mods = make_mock()
        self.session = make_session(self.mock)
        self.student = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def _join(self, code):
        return self.c.post("/api/mocks/sessions/join/", {"code": code}, format="json")

    def test_the_right_code_puts_a_student_in_the_queue(self):
        r = self._join("123456")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["my_status"], MockSessionParticipant.STATUS_PENDING)
        self.assertIsNone(r.json()["attempt_id"])
        self.assertEqual(MockSessionParticipant.objects.count(), 1)

    def test_the_code_is_never_sent_back_to_the_student(self):
        body = self._join("123456").json()
        self.assertNotIn("access_code", body)
        self.assertNotIn("123456", str(body))

    def test_a_wrong_code_is_refused(self):
        r = self._join("999999")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["error"], "bad_code")

    def test_asking_twice_does_not_queue_twice(self):
        self._join("123456")
        self._join("123456")
        self.assertEqual(MockSessionParticipant.objects.count(), 1)

    def test_yesterdays_code_does_not_open_todays_room(self):
        self.session.session_date = timezone.localdate() - timezone.timedelta(days=1)
        self.session.save(update_fields=["session_date"])
        self.assertEqual(self._join("123456").status_code, 403)

    def test_a_started_room_refuses_a_newcomer(self):
        self.session.status = MockSession.STATUS_STARTED
        self.session.save(update_fields=["status"])
        r = self._join("123456")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["error"], "session_already_started")

    def test_an_approved_student_can_still_resolve_their_place_mid_sitting(self):
        place, _ = request_place(self.student, "123456")
        place.status = MockSessionParticipant.STATUS_APPROVED
        place.save(update_fields=["status"])
        self.session.status = MockSession.STATUS_STARTED
        self.session.save(update_fields=["status"])
        # Reloading during the exam must find the way back in, not a locked door.
        self.assertEqual(self._join("123456").status_code, 200)

    def test_a_rejected_student_stays_rejected_on_retyping(self):
        place, _ = request_place(self.student, "123456")
        place.status = MockSessionParticipant.STATUS_REJECTED
        place.save(update_fields=["status"])
        self.assertEqual(self._join("123456").json()["my_status"], MockSessionParticipant.STATUS_REJECTED)


class StartTheRoomTests(TestCase):
    def setUp(self):
        self.mock, _mods = make_mock()
        self.session = make_session(self.mock)
        self.approved = [User.objects.create(username=f"a{i}", email=f"a{i}@x.io") for i in range(3)]
        self.pending = User.objects.create(username="p", email="p@x.io")
        for u in self.approved:
            MockSessionParticipant.objects.create(
                session=self.session, student=u, status=MockSessionParticipant.STATUS_APPROVED
            )
        MockSessionParticipant.objects.create(session=self.session, student=self.pending)

    def test_start_seats_only_the_approved(self):
        result = start_session(self.session)
        self.assertEqual(result["seated"], 3)
        self.assertEqual(MockAttempt.objects.filter(session=self.session).count(), 3)
        self.assertFalse(MockAttempt.objects.filter(student=self.pending).exists())

    def test_the_whole_room_shares_one_clock_zero(self):
        start_session(self.session)
        anchors = {
            a.phase_started_at[STATE_ENGLISH_M1]
            for a in MockAttempt.objects.filter(session=self.session)
        }
        self.assertEqual(len(anchors), 1, "every student must get the identical deadline")

    def test_every_seated_paper_is_actually_running(self):
        start_session(self.session)
        for a in MockAttempt.objects.filter(session=self.session):
            self.assertEqual(a.current_state, STATE_ENGLISH_M1)
            self.assertTrue(a.is_proctored)

    def test_pressing_start_twice_seats_latecomers_without_restarting_anyone(self):
        start_session(self.session)
        first = {a.id: a.phase_started_at[STATE_ENGLISH_M1] for a in MockAttempt.objects.filter(session=self.session)}
        late = User.objects.create(username="late", email="late@x.io")
        MockSessionParticipant.objects.create(
            session=self.session, student=late, status=MockSessionParticipant.STATUS_APPROVED
        )

        result = start_session(self.session)

        self.assertEqual(result["seated"], 1)
        for a in MockAttempt.objects.filter(session=self.session, id__in=first):
            self.assertEqual(a.phase_started_at[STATE_ENGLISH_M1], first[a.id], "a running clock was reset")

    def test_a_place_is_linked_to_its_paper(self):
        start_session(self.session)
        for p in MockSessionParticipant.objects.filter(session=self.session, status="APPROVED"):
            self.assertIsNotNone(p.attempt_id)

    def test_a_solo_attempt_does_not_block_a_session_seat(self):
        """The old constraint was keyed to the MOCK, so practice silently ate the sitting."""
        solo = MockAttempt.objects.create(mock=self.mock, student=self.approved[0])
        solo.start_attempt()
        start_session(self.session)
        seat = MockAttempt.objects.get(session=self.session, student=self.approved[0])
        self.assertNotEqual(seat.pk, solo.pk)
        self.assertTrue(seat.is_proctored)
        self.assertFalse(solo.is_proctored)


class SessionConsoleTests(TestCase):
    def setUp(self):
        self.mock, _mods = make_mock()
        self.admin = User.objects.create(username="admin", email="ad@x.io", is_staff=True, is_superuser=True)
        self.teacher = User.objects.create(username="t", email="t@x.io", role="teacher")
        self.student = User.objects.create(username="s", email="s@x.io")
        self.ac = APIClient(); self.ac.force_authenticate(self.admin)
        self.tc = APIClient(); self.tc.force_authenticate(self.teacher)
        self.sc = APIClient(); self.sc.force_authenticate(self.student)

    def _create(self):
        return self.ac.post(
            ADMIN_SESSIONS,
            {"mock": self.mock.id, "session_date": timezone.localdate().isoformat(), "title": "Saturday"},
            format="json",
        )

    def test_admin_creates_a_session_and_gets_a_six_digit_code(self):
        r = self._create()
        self.assertEqual(r.status_code, 201, r.content)
        code = r.json()["access_code"]
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())

    def test_a_teacher_cannot_create_a_session(self):
        r = self.tc.post(
            ADMIN_SESSIONS,
            {"mock": self.mock.id, "session_date": timezone.localdate().isoformat()},
            format="json",
        )
        self.assertIn(r.status_code, (401, 403))

    def test_a_student_cannot_reach_the_console_at_all(self):
        self.assertIn(self.sc.get(ADMIN_SESSIONS).status_code, (401, 403))

    def test_a_teacher_runs_the_room_the_admin_created(self):
        sid = self._create().json()["id"]
        code = MockSession.objects.get(pk=sid).access_code
        self.sc.post("/api/mocks/sessions/join/", {"code": code}, format="json")
        place = MockSessionParticipant.objects.get()

        # The teacher approves and starts — both allowed.
        r = self.tc.post(f"{ADMIN_SESSIONS}{sid}/decide/", {"participant": place.id, "approve": True}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = self.tc.post(f"{ADMIN_SESSIONS}{sid}/start/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["seated"], 1)
        self.assertEqual(MockSession.objects.get(pk=sid).status, MockSession.STATUS_STARTED)

    def test_a_rejected_student_is_never_seated(self):
        sid = self._create().json()["id"]
        code = MockSession.objects.get(pk=sid).access_code
        self.sc.post("/api/mocks/sessions/join/", {"code": code}, format="json")
        place = MockSessionParticipant.objects.get()
        self.tc.post(f"{ADMIN_SESSIONS}{sid}/decide/", {"participant": place.id, "approve": False}, format="json")
        self.tc.post(f"{ADMIN_SESSIONS}{sid}/start/", {}, format="json")
        self.assertEqual(MockAttempt.objects.count(), 0)

    def test_rotating_the_code_invalidates_the_old_one(self):
        sid = self._create().json()["id"]
        old = MockSession.objects.get(pk=sid).access_code
        new = self.ac.post(f"{ADMIN_SESSIONS}{sid}/rotate_code/", {}, format="json").json()["access_code"]
        self.assertNotEqual(old, new)
        self.assertEqual(self.sc.post("/api/mocks/sessions/join/", {"code": old}, format="json").status_code, 403)

    def test_a_teacher_cannot_rotate_the_code(self):
        sid = self._create().json()["id"]
        self.assertIn(self.tc.post(f"{ADMIN_SESSIONS}{sid}/rotate_code/", {}, format="json").status_code, (401, 403))

    def test_ending_the_room_takes_every_unfinished_paper_in(self):
        sid = self._create().json()["id"]
        code = MockSession.objects.get(pk=sid).access_code
        self.sc.post("/api/mocks/sessions/join/", {"code": code}, format="json")
        place = MockSessionParticipant.objects.get()
        self.tc.post(f"{ADMIN_SESSIONS}{sid}/decide/", {"participant": place.id, "approve": True}, format="json")
        self.tc.post(f"{ADMIN_SESSIONS}{sid}/start/", {}, format="json")

        r = self.tc.post(f"{ADMIN_SESSIONS}{sid}/end/", {}, format="json")

        self.assertEqual(r.status_code, 200, r.content)
        att = MockAttempt.objects.get(session_id=sid)
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertTrue(att.is_completed)

    def test_the_waiting_room_sees_its_attempt_id_the_moment_the_room_starts(self):
        sid = self._create().json()["id"]
        code = MockSession.objects.get(pk=sid).access_code
        self.sc.post("/api/mocks/sessions/join/", {"code": code}, format="json")
        place = MockSessionParticipant.objects.get()
        self.tc.post(f"{ADMIN_SESSIONS}{sid}/decide/", {"participant": place.id, "approve": True}, format="json")

        before = self.sc.get("/api/mocks/sessions/mine/").json()["results"][0]
        self.assertIsNone(before["attempt_id"])

        self.tc.post(f"{ADMIN_SESSIONS}{sid}/start/", {}, format="json")

        after = self.sc.get("/api/mocks/sessions/mine/").json()["results"][0]
        self.assertIsNotNone(after["attempt_id"])
        self.assertEqual(after["status"], MockSession.STATUS_STARTED)
