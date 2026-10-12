from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from lcup.accounts import create_account_for
from lcup.models import (
    AccountClaim,
    GroupLinkStatus,
    LcupGroupLink,
    LcupMembership,
    LcupState,
    LcupStudentLink,
    LcupTeacherLink,
    LinkStatus,
)
from users.models import User

SNAPSHOT = {
    "name": "Junior G21 | Math | Vali",
    "course": {"id": 301, "name": "Junior Math"},
    "days": [1, 3, 5],
    "start_time": "18:00:00",
    "finish_time": "19:30:00",
    "teachers": [{"id": 2001, "name": "Aliyev Vali"}],
    "filial_id": 588,
}


class AdminApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        self.teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", level="junior", lesson_days="ODD", created_by=self.teacher, teacher=self.teacher
        )
        self.group = LcupGroupLink.objects.create(lcup_group_id=10, name=SNAPSHOT["name"], snapshot=SNAPSHOT, suggestion=self.room)
        self.api = self.client_for(self.admin)

    def client_for(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def live_student(self, lcup_id, **kw):
        link = LcupStudentLink.objects.create(lcup_student_id=lcup_id, name=kw.pop("name", f"Student {lcup_id}"), **kw)
        LcupMembership.objects.create(group=self.group, student=link, lcup_status="active")
        return link

    def test_admin_only(self):
        teacher_api = self.client_for(self.teacher)
        for path in ("status/", "groups/", "students/", "teachers/", "accounts/", "unlinked-members/"):
            self.assertEqual(teacher_api.get(f"/api/lcup/{path}").status_code, 403, path)
            self.assertEqual(self.api.get(f"/api/lcup/{path}").status_code, 200, path)

    def test_status_counts(self):
        self.live_student(1, status=LinkStatus.NEEDS_REVIEW)
        body = self.api.get("/api/lcup/status/").data
        self.assertEqual(body["counts"]["needs_review_students"], 1)
        self.assertEqual(body["counts"]["groups_pending"], 1)
        self.assertIsNone(body["last_run"])

    def test_confirm_pairs_the_group_and_refuses_a_class_paired_elsewhere(self):
        response = self.api.post(f"/api/lcup/groups/{self.group.pk}/confirm/", {"classroom_id": self.room.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.group.refresh_from_db()
        self.assertEqual((self.group.status, self.group.classroom_id), (GroupLinkStatus.CONFIRMED, self.room.pk))
        other = LcupGroupLink.objects.create(lcup_group_id=11, name="G22")
        response = self.api.post(f"/api/lcup/groups/{other.pk}/confirm/", {"classroom_id": self.room.pk}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_confirm_without_a_classroom_uses_the_suggestion(self):
        self.assertEqual(self.api.post(f"/api/lcup/groups/{self.group.pk}/confirm/", {}, format="json").status_code, 200)
        self.group.refresh_from_db()
        self.assertEqual(self.group.classroom_id, self.room.pk)

    def test_create_class_needs_a_linked_teacher(self):
        self.assertEqual(self.api.post(f"/api/lcup/groups/{self.group.pk}/create-class/").status_code, 400)
        LcupTeacherLink.objects.create(lcup_teacher_id=2001, name="Aliyev Vali", user=self.teacher, status=LinkStatus.CONFIRMED)
        response = self.api.post(f"/api/lcup/groups/{self.group.pk}/create-class/")
        self.assertEqual(response.status_code, 201, response.data)
        self.group.refresh_from_db()
        self.assertNotEqual(self.group.classroom_id, self.room.pk)
        self.assertEqual(self.group.classroom.teacher_id, self.teacher.pk)

    def test_ignore_a_group(self):
        self.api.post(f"/api/lcup/groups/{self.group.pk}/ignore/")
        self.group.refresh_from_db()
        self.assertEqual(self.group.status, GroupLinkStatus.IGNORED)

    def test_student_review_list_link_and_ignore(self):
        link = self.live_student(1, status=LinkStatus.NEEDS_REVIEW)
        rows = self.api.get("/api/lcup/students/").data
        self.assertEqual([r["id"] for r in rows], [link.pk])
        self.assertEqual(rows[0]["groups"], [self.group.name])

        s = User.objects.create_user(None, password=None, username="malika", role="student")
        self.assertEqual(self.api.post(f"/api/lcup/students/{link.pk}/link/", {"user_id": s.pk}, format="json").status_code, 200)
        link.refresh_from_db()
        self.assertEqual((link.status, link.user_id), (LinkStatus.CONFIRMED, s.pk))

        second = self.live_student(2, status=LinkStatus.NEEDS_REVIEW)
        response = self.api.post(f"/api/lcup/students/{second.pk}/link/", {"user_id": s.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.api.post(f"/api/lcup/students/{second.pk}/ignore/")
        second.refresh_from_db()
        self.assertEqual(second.status, LinkStatus.IGNORED)

    def test_create_account_with_another_phone_for_a_sibling(self):
        link = self.live_student(1, name="Ergashev Bobur", phone="998904444444", status=LinkStatus.NEEDS_REVIEW)
        response = self.api.post(f"/api/lcup/students/{link.pk}/create-account/", {"phone": "+998 93 000 00 01"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(User.objects.filter(username="998930000001").exists())

    def test_teacher_link(self):
        link = LcupTeacherLink.objects.create(lcup_teacher_id=2001, name="Aliyev Vali")
        self.assertEqual([r["id"] for r in self.api.get("/api/lcup/teachers/").data], [link.pk])
        response = self.api.post(f"/api/lcup/teachers/{link.pk}/link/", {"user_id": self.teacher.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        link.refresh_from_db()
        self.assertEqual((link.status, link.user_id), (LinkStatus.CONFIRMED, self.teacher.pk))

    def test_unlinked_members_of_paired_classes(self):
        LcupGroupLink.objects.filter(pk=self.group.pk).update(classroom=self.room, status=GroupLinkStatus.CONFIRMED)
        loose = User.objects.create_user(None, password=None, username="loose", role="student")
        ClassroomMembership.objects.create(classroom=self.room, user=loose, role="STUDENT")
        rows = self.api.get("/api/lcup/unlinked-members/").data
        self.assertEqual([r["user"]["id"] for r in rows], [loose.pk])

    def test_review_done_waits_for_the_queue_to_be_empty(self):
        link = self.live_student(1, status=LinkStatus.NEEDS_REVIEW)
        self.assertEqual(self.api.post("/api/lcup/review-done/").status_code, 400)
        LcupStudentLink.objects.filter(pk=link.pk).update(status=LinkStatus.IGNORED)
        self.assertEqual(self.api.post("/api/lcup/review-done/").status_code, 200)
        self.assertIsNotNone(LcupState.get().initial_review_done_at)

    def test_accounts_list_and_reissue(self):
        link = self.live_student(1, name="Tursunov Aziz", phone="998903333333")
        user = create_account_for(link, now=timezone.now() - timedelta(days=20))
        rows = self.api.get("/api/lcup/accounts/").data
        self.assertEqual([(r["user"]["id"], r["state"]) for r in rows], [(user.pk, "expired")])
        self.assertEqual(self.api.post(f"/api/lcup/accounts/{user.pk}/reissue/").status_code, 200)
        self.assertEqual(self.api.get("/api/lcup/accounts/").data[0]["state"], "pending")

    @override_settings(LCUP_ENABLED=False)
    def test_a_real_sync_is_refused_while_off_but_a_dry_run_is_queued(self):
        self.assertEqual(self.api.post("/api/lcup/sync/").status_code, 409)
        with mock.patch("lcup.views.tasks.dry_run.delay") as delay:
            self.assertEqual(self.api.post("/api/lcup/sync/?dry_run=1").status_code, 202)
        delay.assert_called_once()

    @override_settings(LCUP_ENABLED=True)
    def test_sync_now_is_queued(self):
        with mock.patch("lcup.views.tasks.sync.delay") as delay:
            self.assertEqual(self.api.post("/api/lcup/sync/").status_code, 202)
        delay.assert_called_once()


class ClaimPasswordApiTests(TestCase):
    def setUp(self):
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        self.user = create_account_for(link, now=timezone.now())
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_choose_the_first_password_once(self):
        self.assertEqual(self.api.post("/api/lcup/claim/password/", {"password": "12"}, format="json").status_code, 400)
        response = self.api.post("/api/lcup/claim/password/", {"password": "Kitob-va-Qalam-2026"}, format="json")
        self.assertEqual(response.status_code, 204)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Kitob-va-Qalam-2026"))
        self.assertIsNotNone(AccountClaim.objects.get(user=self.user).password_set_at)
        again = self.api.post("/api/lcup/claim/password/", {"password": "Another-Strong-2026"}, format="json")
        self.assertEqual(again.status_code, 403)


@override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
class HostGuardTests(TestCase):
    def test_the_admin_console_reaches_the_lcup_api(self):
        admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        api = APIClient()
        api.force_authenticate(admin)
        self.assertEqual(api.get("/api/lcup/status/", HTTP_HOST="admin.mastersat.uz").status_code, 200)
