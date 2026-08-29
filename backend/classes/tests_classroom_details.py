"""Editing a classroom's information, and the three fields the create form sends.

Three separate things live here because they share one seam — ``ClassroomCreateSerializer``,
which serves BOTH create and update and whose ``Meta.fields`` is a hard whitelist:

* **the branch**, which the ops create form has sent since the region/branch picker shipped
  and which the serializer silently discarded, because ``branch`` was not in that list;
* **the Telegram group link**, a new field that would have been dropped the same way;
* **the support teachers**, which are not a classroom field at all — they are memberships,
  written beside the serializer the way ``teacher_id`` already is.

Plus the governance PATCH the ops console edits through, which exists because the ordinary
``PATCH /api/classes/<pk>/`` is membership-scoped and refuses any admin who did not create
the class.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_org import Branch, Region

User = get_user_model()


class ClassroomDetailsFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("cd_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        # A SECOND admin, who creates nothing. The governance endpoint exists for them: the
        # ordinary detail PATCH is membership-scoped, and only the creating admin is a member.
        self.other_admin = User.objects.create_user(
            "cd_admin2@t.com", "secret123", role=C.ROLE_ADMIN
        )
        self.teacher = User.objects.create_user(
            "cd_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("cd_student@t.com", "secret123")

        self.region = Region.objects.create(name="Tashkent")
        self.branch = Branch.objects.create(region=self.region, name="Chilonzor")
        self.closed_branch = Branch.objects.create(
            region=self.region, name="Old site", is_active=False
        )

        # Every support teacher this school has is subject="both" — the case a `==` on the
        # subject field would refuse for every classroom in the building.
        self.support_both = User.objects.create_user(
            "cd_sup_both@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject="both"
        )
        self.support_english = User.objects.create_user(
            "cd_sup_eng@t.com", "secret123",
            role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_ENGLISH,
        )

    def create(self, **overrides):
        self.client.force_authenticate(self.admin)
        payload = {
            "name": "Maths evening",
            "subject": Classroom.SUBJECT_MATH,
            "lesson_days": Classroom.DAYS_ODD,
            **overrides,
        }
        return self.client.post("/api/classes/", payload, format="json")


class BranchAtCreateTests(ClassroomDetailsFixture):
    def test_the_branch_the_form_sends_is_actually_stored(self):
        """The regression this file was written for.

        `branch` was missing from ClassroomCreateSerializer.Meta.fields, and DRF drops any
        request key outside it. The ops form sent one, the 201 came back with `branch: null`
        from the READ serializer, and nobody looked — so every classroom created through the
        region/branch picker was filed at no branch at all.
        """
        r = self.create(branch=self.branch.id)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Classroom.objects.get(name="Maths evening").branch_id, self.branch.id)

    def test_the_created_classroom_reports_its_branch_and_region(self):
        r = self.create(branch=self.branch.id)
        self.assertEqual(r.json()["branch"], self.branch.id)
        self.assertEqual(r.json()["branch_name"], "Chilonzor")
        self.assertEqual(r.json()["region_name"], "Tashkent")

    def test_a_closed_branch_is_refused(self):
        """Branches are deactivated rather than deleted, so the FK alone would happily file
        a new class at a site that shut last term."""
        r = self.create(branch=self.closed_branch.id)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("branch", r.json())

    def test_no_branch_is_still_allowed(self):
        """A school that has not set up regions yet must still be able to make a class."""
        self.assertEqual(self.create().status_code, 201)


class TelegramLinkTests(ClassroomDetailsFixture):
    def test_a_full_link_is_kept(self):
        r = self.create(telegram_group_url="https://t.me/joinchat/abc")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["telegram_group_url"], "https://t.me/joinchat/abc")

    def test_a_bare_t_me_link_gets_its_scheme(self):
        """An author pasting from the Telegram app gets `t.me/…`. Without a scheme that
        string in an href is a RELATIVE path, and the button would land the student on
        `/classes/12/t.me/mygroup`."""
        r = self.create(telegram_group_url="t.me/mygroup")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["telegram_group_url"], "https://t.me/mygroup")

    def test_telegram_me_and_www_are_accepted(self):
        for raw in ("https://telegram.me/x", "www.t.me/x"):
            r = self.create(name=f"c{raw}", telegram_group_url=raw)
            self.assertEqual(r.status_code, 201, raw)

    def test_a_link_to_somewhere_else_is_refused(self):
        """The button says "Join Telegram group". One that goes elsewhere is not a typo."""
        r = self.create(telegram_group_url="https://example.com/not-telegram")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("telegram_group_url", r.json())

    def test_blank_stays_blank(self):
        r = self.create(telegram_group_url="")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["telegram_group_url"], "")


class SupportTeacherAtCreateTests(ClassroomDetailsFixture):
    def _memberships(self, classroom):
        return set(
            ClassroomMembership.objects.filter(
                classroom=classroom,
                role=ClassroomMembership.ROLE_TA,
                status=ClassroomMembership.STATUS_ACTIVE,
            ).values_list("user_id", flat=True)
        )

    def test_a_support_teacher_is_attached_in_the_same_request(self):
        r = self.create(support_teacher_ids=[self.support_both.id])
        self.assertEqual(r.status_code, 201, r.content)
        classroom = Classroom.objects.get(name="Maths evening")
        self.assertEqual(self._memberships(classroom), {self.support_both.id})
        self.assertEqual(r.json()["support_teacher_ids"], [self.support_both.id])

    def test_subject_both_covers_a_maths_class(self):
        """`covers_domain_subject`, never `==`. Every support teacher this school has is
        "both", and a direct comparison refuses all of them for every classroom."""
        r = self.create(support_teacher_ids=[self.support_both.id])
        self.assertEqual(r.json()["support_teacher_ids"], [self.support_both.id])

    def test_a_mismatched_subject_is_skipped_not_fatal(self):
        """The classroom is the thing being created. Losing it because one of three pickers
        was stale would be the worse outcome — but the response must say what took."""
        r = self.create(support_teacher_ids=[self.support_english.id, self.support_both.id])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["support_teacher_ids"], [self.support_both.id])

    def test_a_plain_teacher_is_not_made_support_staff(self):
        """The other door onto ROLE_TA does not check the account role. This one must, or it
        writes a membership that is invisible on every student's booking calendar."""
        r = self.create(support_teacher_ids=[self.teacher.id])
        self.assertEqual(r.json()["support_teacher_ids"], [])

    def test_the_classroom_teacher_is_not_overwritten(self):
        r = self.create(teacher_id=self.teacher.id, support_teacher_ids=[self.support_both.id])
        classroom = Classroom.objects.get(name="Maths evening")
        self.assertEqual(classroom.teacher_id, self.teacher.id)


class GovernanceUpdateTests(ClassroomDetailsFixture):
    def setUp(self):
        super().setUp()
        self.create(branch=self.branch.id)
        self.classroom = Classroom.objects.get(name="Maths evening")

    def patch(self, user, body):
        self.client.force_authenticate(user)
        return self.client.patch(
            f"/api/classes/{self.classroom.id}/details/", body, format="json"
        )

    def test_an_admin_who_did_not_create_it_can_still_edit_it(self):
        """The whole reason this endpoint exists. `ClassroomViewSet.get_queryset` is
        membership-scoped for everyone including super_admin, so the ordinary detail PATCH
        403s for every admin but the one who happened to create the class."""
        r = self.patch(self.other_admin, {"name": "Maths evening (renamed)"})
        self.assertEqual(r.status_code, 200, r.content)
        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.name, "Maths evening (renamed)")

    def test_it_edits_the_things_the_console_offers(self):
        r = self.patch(self.other_admin, {
            "level": Classroom.LEVEL_JUNIOR,
            "description": "Evening group",
            "lesson_days": Classroom.DAYS_EVEN,
            "lesson_time": "18:00",
            "room_number": "214",
            "telegram_group_url": "t.me/evening",
            "is_active": False,
        })
        self.assertEqual(r.status_code, 200, r.content)
        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.level, Classroom.LEVEL_JUNIOR)
        self.assertEqual(self.classroom.description, "Evening group")
        self.assertEqual(self.classroom.lesson_days, Classroom.DAYS_EVEN)
        self.assertEqual(self.classroom.room_number, "214")
        self.assertEqual(self.classroom.telegram_group_url, "https://t.me/evening")
        self.assertFalse(self.classroom.is_active)

    def test_the_branch_can_be_moved_and_cleared(self):
        second = Branch.objects.create(region=self.region, name="Yunusobod")
        self.assertEqual(self.patch(self.other_admin, {"branch": second.id}).status_code, 200)
        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.branch_id, second.id)
        # `null` clears it — an emptied select is a decision, not a no-op.
        self.assertEqual(self.patch(self.other_admin, {"branch": None}).status_code, 200)
        self.classroom.refresh_from_db()
        self.assertIsNone(self.classroom.branch_id)

    def test_the_subject_cannot_be_changed(self):
        """It decides which journal binds and which assessments the level admits. Flipping it
        on a running class strands the homework already released to those students."""
        r = self.patch(self.other_admin, {"subject": Classroom.SUBJECT_ENGLISH})
        self.assertEqual(r.status_code, 400, r.content)
        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.subject, Classroom.SUBJECT_MATH)

    def test_a_level_the_subject_does_not_offer_is_refused(self):
        """English has no Foundation; Maths does. The serializer checks the pair."""
        Classroom.objects.filter(pk=self.classroom.pk).update(
            subject=Classroom.SUBJECT_ENGLISH
        )
        r = self.patch(self.other_admin, {"level": Classroom.LEVEL_FOUNDATION})
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_classroom_at_a_closed_branch_is_still_editable(self):
        """Closing a branch must not make every class still at it permanently uneditable.
        The edit form sends `branch` on every save, so without the keep-what-you-have
        carve-out, renaming one would 400 on a field nobody touched."""
        Classroom.objects.filter(pk=self.classroom.pk).update(branch=self.closed_branch)
        r = self.patch(self.other_admin, {
            "name": "Renamed", "branch": self.closed_branch.id,
        })
        self.assertEqual(r.status_code, 200, r.content)
        self.classroom.refresh_from_db()
        self.assertEqual(self.classroom.name, "Renamed")
        self.assertEqual(self.classroom.branch_id, self.closed_branch.id)

    def test_but_it_still_cannot_be_MOVED_to_a_closed_branch(self):
        another_closed = Branch.objects.create(
            region=self.region, name="Also shut", is_active=False
        )
        r = self.patch(self.other_admin, {"branch": another_closed.id})
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_bad_telegram_link_is_refused_here_too(self):
        r = self.patch(self.other_admin, {"telegram_group_url": "https://example.com/x"})
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_teacher_cannot_edit_a_classroom_here(self):
        self.assertEqual(self.patch(self.teacher, {"name": "Mine now"}).status_code, 403)

    def test_a_student_cannot_edit_a_classroom_here(self):
        self.assertEqual(self.patch(self.student, {"name": "Mine now"}).status_code, 403)

    def test_sending_nothing_editable_says_so(self):
        """Silence would look like success — a 200 and an unchanged classroom."""
        r = self.patch(self.other_admin, {"join_code": "hacked"})
        self.assertEqual(r.status_code, 400, r.content)
        self.classroom.refresh_from_db()
        self.assertNotEqual(self.classroom.join_code, "hacked")
