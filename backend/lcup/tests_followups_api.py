from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class FollowupsApiTests(FollowupsFixtureMixin, TestCase):
    def get(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api.get("/api/lcup/followups/")

    def test_a_teacher_is_refused(self):
        self.assertEqual(self.get(self.teacher).status_code, 403)

    def test_the_desk_sees_trials_neediest_first_and_the_missing(self):
        used, came = self.student("Sardor", "Nazarov"), self.student("Ali", "Valiyev")
        self.lcup_member("Not Yet", user=self.student("Not", "Yet"), status="trial", since=date(2026, 10, 1))
        self.lcup_member("Ali Valiyev", user=came, status="trial", since=date(2026, 10, 16))
        self.lcup_member("Sardor Nazarov", user=used, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), used, "PRESENT")
        self.mark(date(2026, 10, 14), used, "PRESENT")
        self.mark(date(2026, 10, 16), came, "PRESENT")
        self.lcup_member("Jasur Toshmatov", status="trial", since=self.MONDAY)

        response = self.get(self.admin)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["free_trial_lessons"], 1)
        self.assertEqual(
            [(row["name"], row["state"]) for row in body["trials"]],
            [("Sardor Nazarov", "used"), ("Ali Valiyev", "came"), ("Not Yet", "not_yet"), ("Jasur Toshmatov", "not_yet")],
        )
        sardor = body["trials"][0]
        self.assertEqual(sardor["lessons"], 2)
        self.assertEqual((sardor["first_lesson"], sardor["last_lesson"]), ("2026-10-12", "2026-10-14"))
        self.assertEqual(sardor["classroom"], {"id": self.room.pk, "name": "Middle G23"})
        self.assertEqual(sardor["teachers"], ["Tess Teacher"])
        self.assertEqual(sardor["student"]["id"], used.pk)
        [missing] = body["not_on_list"]
        self.assertEqual((missing["name"], missing["reason"], missing["student"]), ("Jasur Toshmatov", "no_account", None))
        self.assertIn("next lc-up sync", missing["reason_text"])
        self.assertEqual(body["pending"], 3)
