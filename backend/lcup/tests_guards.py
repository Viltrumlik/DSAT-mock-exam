from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from lcup.models import AccountClaim, GroupLinkStatus, LcupGroupLink
from users.models import User

STUDENT = ClassroomMembership.ROLE_STUDENT


@override_settings(LCUP_ENABLED=True)
class RosterGuardTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", lesson_days="ODD", created_by=self.teacher, teacher=self.teacher
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        self.member = self.student("member")
        ClassroomMembership.objects.create(classroom=self.room, user=self.member, role=STUDENT)
        self.outsider = self.student("outsider")

    def student(self, username):
        return User.objects.create_user(None, password=None, username=username, role="student")

    def manage(self):
        LcupGroupLink.objects.create(lcup_group_id=7, name="G21", classroom=self.room, status=GroupLinkStatus.CONFIRMED)

    def as_user(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def remove_member(self):
        return self.as_user(self.teacher).patch(
            f"/api/classes/{self.room.pk}/members/{self.member.pk}/", {"status": "REMOVED"}, format="json"
        )

    def add_outsider(self):
        return self.as_user(self.admin).post(
            f"/api/classes/{self.room.pk}/members/", {"user_id": self.outsider.pk}, format="json"
        )

    def join_by_code(self):
        return self.as_user(self.outsider).post("/api/classes/join/", {"join_code": self.room.join_code}, format="json")

    def test_student_roster_edits_are_refused_on_a_managed_class(self):
        self.manage()
        for response in (self.remove_member(), self.add_outsider(), self.join_by_code()):
            self.assertEqual(response.status_code, 409, response.data)
            self.assertEqual(response.data["code"], "lcup_managed")
        self.assertEqual(
            ClassroomMembership.objects.get(classroom=self.room, user=self.member).status, ClassroomMembership.STATUS_ACTIVE
        )
        self.assertFalse(ClassroomMembership.objects.filter(classroom=self.room, user=self.outsider).exists())

    def test_promoting_a_student_to_ta_is_still_allowed(self):
        self.manage()
        response = self.as_user(self.teacher).patch(
            f"/api/classes/{self.room.pk}/members/{self.member.pk}/", {"role": "TA"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_an_unmanaged_class_behaves_as_before(self):
        self.assertEqual(self.remove_member().status_code, 200)
        self.assertIn(self.add_outsider().status_code, (200, 201))

    def test_joining_an_unmanaged_class_by_code_works(self):
        self.assertIn(self.join_by_code().status_code, (200, 201))

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_is_refused_while_the_integration_is_off(self):
        self.manage()
        self.assertEqual(self.remove_member().status_code, 200)

    def test_the_people_page_flags_them_for_the_teacher_only(self):
        AccountClaim.objects.create(user=self.member, phone="998901234567", expires_at=timezone.now() + timedelta(days=14))
        for viewer, expected in ((self.teacher, True), (self.member, False)):
            rows = self.as_user(viewer).get(f"/api/classes/{self.room.pk}/people/").data
            flags = {row["user"]["id"]: row["lcup_claim_pending"] for row in rows}
            self.assertEqual(flags[self.member.pk], expected, viewer.username)

    def test_the_roster_flags_accounts_that_have_not_signed_in_yet(self):
        AccountClaim.objects.create(user=self.member, phone="998901234567", expires_at=timezone.now() + timedelta(days=14))
        signed_in = self.student("signed_in")
        ClassroomMembership.objects.create(classroom=self.room, user=signed_in, role=STUDENT)
        AccountClaim.objects.create(
            user=signed_in, phone="998907654321", expires_at=timezone.now() + timedelta(days=14), password_set_at=timezone.now()
        )
        rows = self.as_user(self.teacher).get(f"/api/classes/{self.room.pk}/members/").data
        pending = {row["user"]["id"]: row["lcup_claim_pending"] for row in rows}
        self.assertEqual(pending, {self.teacher.pk: False, self.member.pk: True, signed_in.pk: False})
