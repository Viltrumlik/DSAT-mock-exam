from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models_attendance import AttendanceSession
from lcup.models import LcupGroupLink
from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class RegisterFollowupsTests(FollowupsFixtureMixin, TestCase):
    def register(self, day):
        session, _ = AttendanceSession.objects.get_or_create(classroom=self.room, date=day, defaults={"created_by": self.teacher})
        api = APIClient()
        api.force_authenticate(self.teacher)
        response = api.get(f"/api/classes/{self.room.pk}/attendance/sessions/{session.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def row(self, payload, user):
        return next(r for r in payload["roster"] if r["student_id"] == user.pk)

    def test_a_trial_student_on_their_first_lesson_then_after_the_free_one(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 14))
        first = self.register(date(2026, 10, 14))
        self.assertEqual(self.row(first, ali)["lcup_trial"], {"lessons_before": 0, "free_used": False})
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        second = self.register(date(2026, 10, 16))
        self.assertEqual(self.row(second, ali)["lcup_trial"], {"lessons_before": 1, "free_used": True})

    def test_an_active_student_has_no_trial(self):
        bek = self.student("Bek", "Rahimov")
        self.lcup_member("Bek Rahimov", user=bek)
        self.assertIsNone(self.row(self.register(self.MONDAY), bek)["lcup_trial"])

    def test_the_register_names_lc_up_members_it_cannot_show(self):
        self.lcup_member("Jasur Toshmatov", status="trial")
        self.assertEqual(self.register(self.MONDAY)["not_on_list"], [{"name": "Jasur Toshmatov"}])

    def test_a_class_lc_up_does_not_run_has_neither(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial")
        self.lcup_member("Jasur Toshmatov")
        LcupGroupLink.objects.update(classroom=None)
        payload = self.register(self.MONDAY)
        self.assertIsNone(self.row(payload, ali)["lcup_trial"])
        self.assertEqual(payload["not_on_list"], [])
