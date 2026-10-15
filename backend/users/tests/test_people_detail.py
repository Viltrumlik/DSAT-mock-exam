"""GET /api/users/admin/people/<id>/ — one account's change form (plan 2026-10-15-ops-detail-pages)."""

from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupStudentLink, LinkStatus
from users.models import RefreshSession, User

HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST], LCUP_ENABLED=True)
class PersonCoreTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.paired = Classroom.objects.create(name="Junior G21 Math", subject="MATH", created_by=self.teacher,
                                               teacher=self.teacher)
        self.own = Classroom.objects.create(name="Own class", subject="MATH", created_by=self.teacher,
                                            teacher=self.teacher)
        self.old = Classroom.objects.create(name="Old class", subject="MATH", created_by=self.teacher,
                                            teacher=self.teacher, is_active=False)
        LcupGroupLink.objects.create(lcup_group_id=10, name="G21", classroom=self.paired,
                                     status=GroupLinkStatus.CONFIRMED)
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov", phone_number="998901234567")
        ClassroomMembership.objects.create(classroom=self.paired, user=self.aziz, role="STUDENT")
        ClassroomMembership.objects.create(classroom=self.old, user=self.aziz, role="STUDENT")
        LcupStudentLink.objects.create(lcup_student_id=1, name="Tursunov Aziz", user=self.aziz,
                                       status=LinkStatus.CREATED, balance=Decimal("-250000"))

    def get(self, pk, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(f"/api/users/admin/people/{pk}/", HTTP_HOST=HOST)

    def test_a_student_opens_with_groups_lcup_and_past_groups(self):
        body = self.get(self.aziz.pk).json()
        self.assertEqual((body["section"], body["status"], body["name"]), ("students", "centre", "Aziz Tursunov"))
        self.assertEqual([(g["name"], g["lcup_managed"]) for g in body["groups"]], [("Junior G21 Math", True)])
        self.assertEqual([g["name"] for g in body["past_groups"]], ["Old class"])
        self.assertEqual(body["open_classes"], [{"id": self.own.pk, "name": "Own class"}])
        self.assertEqual((body["lcup"]["balance"], body["lcup"]["debt"]), (-250000, 250000))
        self.assertEqual(body["lcup"]["status"], "created")
        self.assertTrue(body["lcup_created"])
        self.assertIsNone(body["staff"])

    def test_the_lcup_part_says_whether_the_debt_freeze_runs(self):
        with self.settings(LCUP_DEBT_FREEZE_ENABLED=False):
            self.assertFalse(self.get(self.aziz.pk).json()["lcup"]["freeze_on"])
        with self.settings(LCUP_DEBT_FREEZE_ENABLED=True):
            self.assertTrue(self.get(self.aziz.pk).json()["lcup"]["freeze_on"])

    def test_the_freeze_reason_is_debt_or_admin(self):
        User.objects.filter(pk=self.aziz.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.assertEqual(self.get(self.aziz.pk).json()["frozen_reason"], "debt")
        User.objects.filter(pk=self.aziz.pk).update(frozen_reason="")
        self.assertEqual(self.get(self.aziz.pk).json()["frozen_reason"], "admin")

    def test_same_name_accounts_are_listed_but_not_itself(self):
        twin = make("aziz2", C.ROLE_PUBLIC_STUDENT, first_name="aziz", last_name="TURSUNOV")
        dupes = self.get(self.aziz.pk).json()["duplicates"]
        self.assertEqual([(d["id"], d["section"]) for d in dupes], [(twin.pk, "public")])

    def test_last_seen_is_the_newest_session(self):
        RefreshSession.objects.create(user=self.aziz, refresh_jti="a")
        self.assertIsNotNone(self.get(self.aziz.pk).json()["last_seen"])

    def test_staff_get_their_classes_and_workload(self):
        ta = make("ta1", C.ROLE_SUPPORT_TEACHER, subject="math")
        ClassroomMembership.objects.create(classroom=self.own, user=ta, role="TA")
        a = Assignment.objects.create(classroom=self.paired, title="HW1", status="PUBLISHED", created_by=self.teacher)
        Submission.objects.create(assignment=a, student=self.aziz, status="SUBMITTED")
        body = self.get(self.teacher.pk).json()
        self.assertEqual(body["section"], "staff")
        self.assertEqual(sorted((c["name"], c["as"]) for c in body["staff"]["classes"]),
                         [("Junior G21 Math", "teacher"), ("Own class", "teacher")])
        self.assertEqual(body["staff"]["workload"], {"classes": 2, "students": 1, "to_review": 1})
        self.assertEqual([(c["name"], c["as"]) for c in self.get(ta.pk).json()["staff"]["classes"]],
                         [("Own class", "ta")])

    def test_the_header_gets_a_photo_slot_and_the_glance(self):
        from datetime import date

        from classes.models_attendance import AttendanceRecord, AttendanceSession

        for i, status in enumerate(["PRESENT", "ABSENT"]):
            s = AttendanceSession.objects.create(classroom=self.paired, date=date(2026, 10, 1 + i))
            AttendanceRecord.objects.create(session=s, student=self.aziz, status=status)
        Assignment.objects.create(classroom=self.paired, title="HW1", status="PUBLISHED", created_by=self.teacher)
        body = self.get(self.aziz.pk).json()
        self.assertIsNone(body["avatar_url"])  # no photo uploaded: the page draws initials
        self.assertEqual(body["glance"]["attendance_rate"], 50.0)
        self.assertEqual(body["glance"]["homework"], {"completed": 0, "total": 1})
        self.assertEqual((body["glance"]["mocks_taken"], body["glance"]["last_mock_total"]), (0, None))
        self.assertIsNone(self.get(self.teacher.pk).json()["glance"])

    def test_out_of_scope_or_missing_is_404_and_learners_are_403(self):
        self.assertEqual(self.get(999999).status_code, 404)
        self.assertEqual(self.get(self.aziz.pk, user=self.aziz).status_code, 403)
