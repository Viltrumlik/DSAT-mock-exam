"""The person page's lazy parts and "log out everywhere" (plan 2026-10-15-ops-detail-pages)."""

from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from users.models import RefreshSession, RoleChange, SecurityAuditEvent, User

HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class PersonPartsTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN, first_name="Bo", last_name="Ss")
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math")
        self.room = Classroom.objects.create(name="Own class", subject="MATH", created_by=self.teacher,
                                             teacher=self.teacher)
        self.kid = make("kid", first_name="Ali", last_name="Valiyev")
        ClassroomMembership.objects.create(classroom=self.room, user=self.kid, role="STUDENT")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def part(self, name, pk=None):
        return self.api.get(f"/api/users/admin/people/{pk or self.kid.pk}/{name}/", HTTP_HOST=HOST)

    def test_attendance_counts_and_recent_marks(self):
        today = timezone.localdate()
        for i, status in enumerate(["PRESENT", "LATE", "ABSENT"]):
            s = AttendanceSession.objects.create(classroom=self.room, date=today - timedelta(days=i))
            AttendanceRecord.objects.create(session=s, student=self.kid, status=status)
        body = self.part("attendance").json()
        (c,) = body["classes"]
        self.assertEqual((c["present"], c["late"], c["absent"], c["counted"]), (1, 1, 1, 3))
        self.assertEqual([r["status"] for r in body["recent"]], ["PRESENT", "LATE", "ABSENT"])
        self.assertIsNone(body["recent"][0]["lcup_push"])

    def test_results_list_overdue_homework(self):
        Assignment.objects.create(classroom=self.room, title="HW late", status="PUBLISHED", created_by=self.teacher,
                                  due_at=timezone.now() - timedelta(days=1))
        body = self.part("results").json()
        self.assertEqual([o["title"] for o in body["overdue"]], ["HW late"])
        self.assertEqual(body["homework"][0]["total"], 1)
        self.assertEqual(body["rewards"], {"xp": 0, "coins": 0})

    def test_security_lists_live_sessions_without_tokens(self):
        RefreshSession.objects.create(user=self.kid, refresh_jti="secret-jti", user_agent="Mozilla/5.0 Chrome")
        RefreshSession.objects.create(user=self.kid, refresh_jti="old", revoked_at=timezone.now())
        body = self.part("security").json()
        self.assertEqual(len(body["sessions"]), 1)
        self.assertNotIn("secret-jti", str(body))

    def test_security_sends_the_whole_user_agent_for_the_page_to_name(self):
        # Telegram's in-app browser says so only at the end of a long Android user agent.
        ua = ("Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like "
              "Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Telegram-Android/10.6.2")
        RefreshSession.objects.create(user=self.kid, refresh_jti="a", user_agent=ua)
        RefreshSession.objects.create(user=self.kid, refresh_jti="b", user_agent="  ")
        devices = sorted(s["device"] for s in self.part("security").json()["sessions"])
        self.assertEqual(devices, ["", ua])

    def test_history_merges_sources_newest_first(self):
        RoleChange.objects.create(user=self.kid, from_role="student", to_role="public_student",
                                  reason="lcup_left", source="lcup_sync")
        SecurityAuditEvent.objects.create(user=self.kid, event_type="admin_freeze",
                                          detail={"actor_id": self.admin.pk, "actor": "Bo Ss"})
        SecurityAuditEvent.objects.create(user=self.kid, event_type="ping")
        items = self.part("history").json()["items"]
        kinds = [i["kind"] for i in items]
        self.assertIn("role", kinds)
        self.assertIn("group", kinds)  # the seat added in setUp
        self.assertEqual(next(i for i in items if i["kind"] == "admin")["by"], "Bo Ss")
        self.assertNotIn("ping", str(items))
        self.assertEqual(items, sorted(items, key=lambda i: i["at"], reverse=True))

    def test_history_names_roles_in_words_not_codes(self):
        RoleChange.objects.create(user=self.kid, from_role="student", to_role="public_student",
                                  reason="lcup_left", source="lcup_sync")
        RoleChange.objects.create(user=self.kid, from_role="public_student", to_role="support_teacher",
                                  reason="promoted", source="admin")
        RoleChange.objects.create(user=self.kid, from_role="ghost", to_role="student", reason="x", source="admin")
        titles = {i["title"] for i in self.part("history").json()["items"] if i["kind"] == "role"}
        self.assertEqual(titles, {
            "Role student → public user (left every group in lc-up)",
            "Role public user → support teacher (promoted)",
            "Role ghost → student (x)",  # a code with no name stays as it is
        })

    def test_history_payment_amounts_read_as_the_lcup_box_and_carry_no_time(self):
        from lcup.models import LcupPayment, LcupStudentLink, LinkStatus

        LcupStudentLink.objects.create(lcup_student_id=9, name="Valiyev Ali", user=self.kid, status=LinkStatus.AUTO)
        LcupPayment.objects.create(lcup_payment_id=1, lcup_student_id=9, kind="payment", amount=650000,
                                   paid_on=timezone.localdate(), month="2026-10", synced_at=timezone.now())
        items = self.part("history").json()["items"]
        (pay,) = [i for i in items if i["kind"] == "payment"]
        self.assertEqual(pay["title"], "Payment 650,000 UZS for 2026-10")
        self.assertIs(pay["all_day"], True)
        self.assertFalse(any(i.get("all_day") for i in items if i["kind"] != "payment"))

    def test_an_unknown_part_is_404(self):
        self.assertEqual(self.part("passwords").status_code, 404)

    def test_log_out_everywhere_revokes_and_is_recorded(self):
        RefreshSession.objects.create(user=self.kid, refresh_jti="a")
        RefreshSession.objects.create(user=self.kid, refresh_jti="b")
        r = self.api.post(f"/api/users/admin/people/{self.kid.pk}/revoke-sessions/", HTTP_HOST=HOST)
        self.assertEqual(r.json(), {"revoked": 2})
        self.assertFalse(RefreshSession.objects.filter(user=self.kid, revoked_at__isnull=True).exists())
        ev = SecurityAuditEvent.objects.get(user=self.kid, event_type="admin_revoke_sessions")
        self.assertEqual((ev.detail["actor_id"], ev.detail["sessions"]), (self.admin.pk, 2))

    def test_log_out_everywhere_refuses_your_own_account(self):
        r = self.api.post(f"/api/users/admin/people/{self.admin.pk}/revoke-sessions/", HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 400)
