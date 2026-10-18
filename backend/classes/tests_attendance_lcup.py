"""The register of a class paired with lc-up (lc-up Part 2, owner 2026-10-14).

* An excused absence names one of lc-up's reasons — lc-up receives it as ``reason_id``.
* Once the register closes, lc-up is the source ("lc-up ustun"): while the pull switch is on, a
  closed register of a paired class is read-only for everybody, a global admin included, and says
  where the correction goes instead.
"""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import attendance_window
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from lcup.models import GroupLinkStatus, LcupAbsenceReason, LcupGroupLink, LcupMembership, LcupStudentLink

User = get_user_model()
OLD_MONDAY = date(2026, 6, 1)


@override_settings(LCUP_ENABLED=True)
class PairedRegisterFixture(TestCase):
    lesson_time = ""  # unreadable → the register is open for the whole of its own day

    def setUp(self):
        self.api = APIClient()
        self.teacher = User.objects.create_user("al_t@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        self.admin = User.objects.create_user("al_a@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        self.student = User.objects.create_user("al_s@t.com", "secret123", role=C.ROLE_STUDENT)
        self.room = Classroom.objects.create(
            name="Junior G21 | Math | Vali", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            lesson_time=self.lesson_time, created_by=self.admin,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_OWNER)
        seat = ClassroomMembership.objects.create(classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        ClassroomMembership.objects.filter(pk=seat.pk).update(joined_at=timezone.make_aware(timezone.datetime(2026, 5, 1)))
        self.link = LcupGroupLink.objects.create(
            lcup_group_id=10, name=self.room.name, classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        LcupAbsenceReason.objects.create(lcup_reason_id=3034, title="Kasal")
        LcupAbsenceReason.objects.create(lcup_reason_id=3035, title="Uzoqga ketib qolgan")

    def url(self, suffix):
        return f"/api/classes/{self.room.id}/attendance/{suffix}"

    def mark(self, session, status, reason_id=None, *, user=None):
        self.api.force_authenticate(user or self.teacher)
        entry = {"student_id": self.student.id, "status": status}
        if reason_id is not None:
            entry["reason_id"] = reason_id
        return self.api.post(self.url(f"sessions/{session.id}/mark/"), {"records": [entry]}, format="json")


class ExcuseReasonTests(PairedRegisterFixture):
    def setUp(self):
        super().setUp()
        self.session = AttendanceSession.objects.create(classroom=self.room, date=timezone.localdate())

    def record(self):
        return AttendanceRecord.objects.get(session=self.session, student=self.student)

    def test_the_register_offers_lcups_reasons(self):
        self.api.force_authenticate(self.teacher)
        body = self.api.get(self.url(f"sessions/{self.session.id}/")).json()
        self.assertEqual(body["excuse_reasons"], [{"id": 3034, "title": "Kasal"}, {"id": 3035, "title": "Uzoqga ketib qolgan"}])
        self.assertEqual(body["roster"][0]["reason_id"], None)

    def test_an_excused_absence_without_a_reason_is_refused(self):
        resp = self.mark(self.session, "EXCUSED")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("reason", resp.json()["detail"].lower())
        self.assertFalse(AttendanceRecord.objects.filter(session=self.session).exists())

    def test_a_reason_lcup_does_not_have_is_refused(self):
        self.assertEqual(self.mark(self.session, "EXCUSED", 9999).status_code, 400)

    def test_the_reason_is_kept_and_shown(self):
        self.assertEqual(self.mark(self.session, "EXCUSED", 3035).status_code, 200)
        self.assertEqual((self.record().status, self.record().lcup_reason_id), ("EXCUSED", 3035))
        body = self.api.get(self.url(f"sessions/{self.session.id}/")).json()
        self.assertEqual(body["roster"][0]["reason_id"], 3035)

    def test_another_status_clears_the_reason(self):
        self.mark(self.session, "EXCUSED", 3034)
        self.mark(self.session, "PRESENT", 3034)
        self.assertEqual((self.record().status, self.record().lcup_reason_id), ("PRESENT", None))

    def test_mark_all_present_keeps_an_excused_mark_and_its_reason(self):
        self.mark(self.session, "EXCUSED", 3034)
        self.api.post(self.url(f"sessions/{self.session.id}/mark-all-present/"), {}, format="json")
        self.assertEqual((self.record().status, self.record().lcup_reason_id), ("EXCUSED", 3034))

    def test_a_class_lcup_does_not_run_needs_no_reason(self):
        self.link.delete()
        self.assertEqual(self.mark(self.session, "EXCUSED").status_code, 200)
        body = self.api.get(self.url(f"sessions/{self.session.id}/")).json()
        self.assertEqual(body["excuse_reasons"], [])


class ClosedPairedRegisterTests(PairedRegisterFixture):
    lesson_time = "14:00"

    def setUp(self):
        super().setUp()
        self.session = AttendanceSession.objects.create(classroom=self.room, date=OLD_MONDAY)  # long closed

    @override_settings(LCUP_ATTENDANCE_PULL_ENABLED=True)
    def test_while_lcup_is_the_source_even_an_admin_cannot_write_it(self):
        resp = self.mark(self.session, "PRESENT", user=self.admin)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("lc-up", resp.json()["detail"])
        window = attendance_window.window_payload(self.room, OLD_MONDAY, user=self.admin)
        self.assertEqual((window["can_mark"], window["is_override"]), (False, False))
        self.assertIn("lc-up", window["reason"])

    def test_with_the_pull_off_the_admin_override_stands(self):
        self.assertEqual(self.mark(self.session, "PRESENT", user=self.admin).status_code, 200)

    @override_settings(LCUP_ATTENDANCE_PULL_ENABLED=True)
    def test_a_class_lcup_does_not_run_keeps_the_override(self):
        self.link.delete()
        self.assertEqual(self.mark(self.session, "PRESENT", user=self.admin).status_code, 200)


class FrozenInLcupTests(PairedRegisterFixture):
    """A student lc-up holds frozen stays on the register but is never marked (owner, 2026-10-17:
    "Belgilab bo'lmaydi") — lc-up refuses their marks, answering ``not_in_group``."""

    def setUp(self):
        super().setUp()
        self.session = AttendanceSession.objects.create(classroom=self.room, date=timezone.localdate())
        self.other = User.objects.create_user("al_o@t.com", "secret123", role=C.ROLE_STUDENT)
        seat = ClassroomMembership.objects.create(classroom=self.room, user=self.other, role=ClassroomMembership.ROLE_STUDENT)
        ClassroomMembership.objects.filter(pk=seat.pk).update(joined_at=timezone.make_aware(timezone.datetime(2026, 5, 1)))
        frozen = LcupStudentLink.objects.create(lcup_student_id=101, name="Frozen Student", user=self.student)
        self.membership = LcupMembership.objects.create(group=self.link, student=frozen, lcup_status="frozen")
        active = LcupStudentLink.objects.create(lcup_student_id=102, name="Active Student", user=self.other)
        LcupMembership.objects.create(group=self.link, student=active, lcup_status="active")

    def roster(self):
        self.api.force_authenticate(self.teacher)
        body = self.api.get(self.url(f"sessions/{self.session.id}/")).json()
        return {r["student_id"]: r for r in body["roster"]}

    def test_the_register_shows_them_frozen_in_lcup(self):
        roster = self.roster()
        self.assertTrue(roster[self.student.id]["frozen_in_lcup"])
        self.assertFalse(roster[self.other.id]["frozen_in_lcup"])

    def test_a_mark_for_them_is_refused_and_named_back(self):
        self.api.force_authenticate(self.teacher)
        resp = self.api.post(
            self.url(f"sessions/{self.session.id}/mark/"),
            {"records": [{"student_id": self.student.id, "status": "ABSENT"}, {"student_id": self.other.id, "status": "PRESENT"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual((resp.json()["updated"], resp.json()["frozen_in_lcup"]), (1, [self.student.id]))
        self.assertEqual(list(AttendanceRecord.objects.filter(session=self.session).values_list("student_id", flat=True)), [self.other.id])

    def test_mark_all_present_passes_them_by(self):
        self.api.force_authenticate(self.teacher)
        resp = self.api.post(self.url(f"sessions/{self.session.id}/mark-all-present/"), format="json")
        self.assertEqual(resp.json()["updated"], 1)
        self.assertFalse(AttendanceRecord.objects.filter(session=self.session, student=self.student).exists())

    def test_unfrozen_or_gone_from_the_group_they_are_marked_again(self):
        for change in ({"lcup_status": "active"}, {"lcup_status": "frozen", "left_at": timezone.now()}):
            LcupMembership.objects.filter(pk=self.membership.pk).update(**change)
            self.assertFalse(self.roster()[self.student.id]["frozen_in_lcup"], change)

    @override_settings(LCUP_ENABLED=False)
    def test_with_lcup_off_nobody_is_frozen_in_lcup(self):
        self.assertFalse(self.roster()[self.student.id]["frozen_in_lcup"])
