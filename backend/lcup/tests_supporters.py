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
from lcup.models import LcupTeacherLink, LinkStatus
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
