"""Support teachers in lc-up (owner, 2026-10-13).

lc-up keeps a support teacher in the ordinary teacher role with ``is_supporter: true``. Here they
are a ``support_teacher`` who leads no lc-up group, so the sync settles them apart from the
teachers: never matched as a group teacher, never a class's teacher, never "to link".
"""

from __future__ import annotations

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from lcup.classrooms import teachers_for
from lcup.matching import SUPPORTER_REASON
from classes.models import ClassroomMembership
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupState, LcupTeacherLink, LinkStatus
from lcup.sync import run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import API, lcup_data
from users.models import User

SUPPORTER = {"id": 2003, "name": "Husanov Mahkam", "phone": "998906666666", "group_ids": [], "is_supporter": True}


def data_with_supporter(**overrides):
    d = lcup_data()
    d[f"{API}/teachers"] = d[f"{API}/teachers"] + [{**SUPPORTER, **overrides}]
    return d


class SupporterSyncTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.support = User.objects.create_user(
            None, password=None, username="mahkam", role="support_teacher", subject="english",
            phone_number="+998 90 666 66 66", first_name="Mahkam", last_name="Husanov",
        )

    def sync(self, data):
        return run_sync(FakeLcupClient(data), now=self.now)

    def link(self):
        return LcupTeacherLink.objects.get(lcup_teacher_id=2003)

    def test_a_supporter_is_settled_apart_on_our_support_teacher(self):
        run = self.sync(data_with_supporter())
        self.assertTrue(run.ok, run.errors)
        link = self.link()
        self.assertEqual((link.status, link.match_reason, link.user_id), (LinkStatus.IGNORED, SUPPORTER_REASON, self.support.pk))
        self.assertEqual(run.counts["teachers_support"], 1)
        self.support.refresh_from_db()
        self.assertEqual(self.support.role, "support_teacher")  # nobody's role moves

    def test_a_supporter_with_no_account_of_ours_still_leaves_the_to_link_list(self):
        run = self.sync(data_with_supporter(phone="998907777777"))
        link = self.link()
        self.assertEqual((link.status, link.match_reason, link.user_id), (LinkStatus.IGNORED, SUPPORTER_REASON, None))
        self.assertNotIn(link.status, (LinkStatus.NEEDS_REVIEW, LinkStatus.UNMATCHED))
        self.assertEqual(run.counts["teachers_support"], 1)

    def test_a_supporter_already_linked_as_a_teacher_is_moved_apart(self):
        # Before the flag was read, the sync auto-linked them as a group teacher by phone.
        LcupTeacherLink.objects.create(
            lcup_teacher_id=2003, name="Husanov Mahkam", phone="998906666666", user=self.support, status=LinkStatus.AUTO
        )
        self.sync(data_with_supporter())
        link = self.link()
        self.assertEqual((link.status, link.match_reason, link.user_id), (LinkStatus.IGNORED, SUPPORTER_REASON, self.support.pk))

    def test_a_supporter_linked_to_a_teachers_account_is_unlinked(self):
        teacher = User.objects.create_user(None, password=None, username="tt", role="teacher", subject="english")
        LcupTeacherLink.objects.create(lcup_teacher_id=2003, name="Husanov Mahkam", phone="998907777777", user=teacher, status=LinkStatus.CONFIRMED)
        self.sync(data_with_supporter(phone="998907777777"))
        link = self.link()
        self.assertEqual((link.status, link.user_id), (LinkStatus.IGNORED, None))

    def test_a_supporter_is_never_a_classs_teacher(self):
        self.sync(data_with_supporter())
        vali = User.objects.create_user(None, password=None, username="vali", role="teacher", subject="math")
        LcupTeacherLink.objects.filter(lcup_teacher_id=2001).update(user=vali, status=LinkStatus.CONFIRMED)
        users = teachers_for({"teachers": [{"id": 2003, "name": "Husanov Mahkam"}, {"id": 2001, "name": "Aliyev Vali"}]})
        self.assertEqual([u.pk for u in users], [vali.pk])

    def test_when_lcup_makes_them_a_teacher_again_they_are_matched_afresh(self):
        self.sync(data_with_supporter())
        self.sync(data_with_supporter(is_supporter=False))
        link = self.link()
        self.assertNotEqual(link.status, LinkStatus.IGNORED)
        self.assertNotEqual(link.match_reason, SUPPORTER_REASON)

    def test_a_row_with_no_flag_at_all_keeps_a_settled_supporter(self):
        # lc-up's External API leaves is_supporter out of /teachers (seen on prod 2026-10-13), so
        # the supporters are settled by hand; a sync that sends no flag must not undo that.
        LcupTeacherLink.objects.create(
            lcup_teacher_id=2003, name="Husanov Mahkam", phone="998906666666", user=self.support,
            status=LinkStatus.IGNORED, match_reason=SUPPORTER_REASON,
        )
        row = {k: v for k, v in SUPPORTER.items() if k != "is_supporter"}
        d = lcup_data()
        d[f"{API}/teachers"] = d[f"{API}/teachers"] + [row]
        self.sync(d)
        link = self.link()
        self.assertEqual((link.status, link.match_reason, link.user_id), (LinkStatus.IGNORED, SUPPORTER_REASON, self.support.pk))

    def test_an_admins_ignore_is_left_alone(self):
        self.sync(lcup_data())
        LcupTeacherLink.objects.filter(lcup_teacher_id=2002).update(status=LinkStatus.IGNORED, match_reason="")
        self.sync(lcup_data())
        self.assertEqual(LcupTeacherLink.objects.get(lcup_teacher_id=2002).status, LinkStatus.IGNORED)

    def test_an_admin_naming_a_supporters_account_keeps_them_a_supporter(self):
        self.sync(data_with_supporter(phone="998907777777"))
        admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        api = APIClient()
        api.force_authenticate(admin)
        resp = api.post(f"/api/lcup/teachers/{self.link().pk}/link/", {"user_id": self.support.pk}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        link = self.link()
        self.assertEqual((link.status, link.match_reason, link.user_id), (LinkStatus.IGNORED, SUPPORTER_REASON, self.support.pk))


class SupporterLedGroupTests(TestCase):
    """Foundation G14 (owner, 2026-11-05): lc-up's only teacher of the group is a support teacher."""

    def setUp(self):
        self.now = timezone.now()
        self.support = User.objects.create_user(
            None, password=None, username="ulugbek", role="support_teacher", subject="math", phone_number="+998 90 888 88 88",
        )
        LcupTeacherLink.objects.create(
            lcup_teacher_id=2009, name="Ulug'bek Abdurasulov", phone="998908888888", user=self.support,
            status=LinkStatus.IGNORED, match_reason="support teacher (marked by an admin)",
        )
        state = LcupState.get()
        state.initial_review_done_at = self.now
        state.save()
        self.data = lcup_data()
        group = dict(self.data[f"{API}/groups"][0], id=25599, name="Foundation G14 | Math | Ulug'bek")
        group["teachers"] = [{"id": 2009, "name": "Ulug'bek Abdurasulov"}]
        self.data[f"{API}/groups"] = [group]
        self.data[f"{API}/teachers"] = self.data[f"{API}/teachers"] + [
            {"id": 2009, "name": "Ulug'bek Abdurasulov", "phone": "998908888888", "group_ids": [], "is_supporter": False}
        ]
        self.data[f"{API}/groups/25599/students"] = []

    def test_the_sync_opens_the_class_with_them_as_ta_not_as_its_teacher(self):
        run = run_sync(FakeLcupClient(self.data), now=self.now)
        self.assertTrue(run.ok, run.errors)
        link = LcupGroupLink.objects.get(lcup_group_id=25599)
        self.assertEqual(link.status, GroupLinkStatus.CONFIRMED)
        room = link.classroom
        self.assertIsNone(room.teacher_id)
        self.assertEqual(room.created_by_id, self.support.pk)
        seat = ClassroomMembership.objects.get(classroom=room, user=self.support)
        self.assertEqual((seat.role, seat.status), (ClassroomMembership.ROLE_TA, ClassroomMembership.STATUS_ACTIVE))
        self.support.refresh_from_db()
        self.assertEqual(self.support.role, "support_teacher")

    def test_later_syncs_leave_the_ta_seat_and_the_empty_teacher_alone(self):
        run_sync(FakeLcupClient(self.data), now=self.now)
        run = run_sync(FakeLcupClient(self.data), now=self.now)
        self.assertTrue(run.ok, run.errors)
        room = LcupGroupLink.objects.get(lcup_group_id=25599).classroom
        self.assertIsNone(room.teacher_id)
        self.assertEqual(
            list(ClassroomMembership.objects.filter(classroom=room).exclude(role=ClassroomMembership.ROLE_STUDENT).values_list("user_id", "role", "status")),
            [(self.support.pk, ClassroomMembership.ROLE_TA, ClassroomMembership.STATUS_ACTIVE)],
        )

    def test_the_ta_can_take_this_class_attendance(self):
        from classes.capabilities import classroom_capabilities

        run_sync(FakeLcupClient(self.data), now=self.now)
        room = LcupGroupLink.objects.get(lcup_group_id=25599).classroom
        self.assertTrue(classroom_capabilities(self.support, room).can_take_attendance)

    def test_with_no_teacher_and_no_supporter_it_still_waits(self):
        LcupTeacherLink.objects.filter(lcup_teacher_id=2009).update(user=None)
        run_sync(FakeLcupClient(self.data), now=self.now)
        link = LcupGroupLink.objects.get(lcup_group_id=25599)
        self.assertEqual((link.status, link.classroom_id), (GroupLinkStatus.NEEDS_TEACHER, None))

    def test_the_create_class_button_does_the_same(self):
        LcupGroupLink.objects.create(
            lcup_group_id=25599, name="Foundation G14 | Math | Ulug'bek", snapshot=self.data[f"{API}/groups"][0],
            status=GroupLinkStatus.NEEDS_TEACHER,
        )
        link = LcupGroupLink.objects.get(lcup_group_id=25599)
        admin = User.objects.create_user(None, password=None, username="adm", role="admin")
        api = APIClient()
        api.force_authenticate(admin)
        self.assertEqual(api.post(f"/api/lcup/groups/{link.pk}/create-class/").status_code, 201)
        link.refresh_from_db()
        self.assertIsNone(link.classroom.teacher_id)
