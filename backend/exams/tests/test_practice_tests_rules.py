from django.contrib.auth import get_user_model
from django.test import TestCase

from access import constants as acc_const
from classes.models import Classroom, ClassroomMembership
from exams.models import PracticeTest
from exams.practice_tests import (
    assign_practice_number, live_group_levels, practice_display_title, visible_practice_tests_q,
)

User = get_user_model()


class PracticeTestRuleTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(email="ptr_teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER, subject="math")
        self.student = User.objects.create_user(email="ptr_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)

    def _class(self, level, *, active=True):
        return Classroom.objects.create(
            name=f"Class {level or 'none'}", subject=Classroom.SUBJECT_MATH, level=level,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher, is_active=active,
        )

    def _join(self, room, status=ClassroomMembership.STATUS_ACTIVE):
        ClassroomMembership.objects.create(classroom=room, user=self.student, role=ClassroomMembership.ROLE_STUDENT, status=status)

    def _pt(self, *, access=PracticeTest.ACCESS_OPEN, level="", published=True, practice=True, subject="MATH"):
        return PracticeTest.objects.create(
            subject=subject, title="T", is_practice_test=practice, practice_access=access,
            practice_level=level, is_published=published, skip_default_modules=True,
        )

    def _visible(self):
        return set(PracticeTest.objects.filter(visible_practice_tests_q(self.student)).values_list("id", flat=True))

    def test_live_group_levels_only_counts_active_memberships_in_active_classes(self):
        self._join(self._class("middle"))
        self._join(self._class("senior", active=False))
        self._join(self._class("junior"), status=ClassroomMembership.STATUS_REMOVED)
        self._join(self._class(""))
        self.assertEqual(live_group_levels(self.student), {"middle"})

    def test_open_published_test_with_no_level_is_visible(self):
        pt = self._pt()
        self.assertIn(pt.id, self._visible())

    def test_open_test_needs_an_exact_level_match(self):
        self._join(self._class("middle"))
        middle, senior, junior = self._pt(level="middle"), self._pt(level="senior"), self._pt(level="junior")
        self.assertEqual(self._visible() & {middle.id, senior.id, junior.id}, {middle.id})

    def test_student_without_level_sees_only_blank_level_tests(self):
        self._join(self._class(""))
        blank, middle = self._pt(), self._pt(level="middle")
        self.assertEqual(self._visible() & {blank.id, middle.id}, {blank.id})

    def test_homework_only_and_unpublished_are_hidden_until_given(self):
        hw, draft = self._pt(access=PracticeTest.ACCESS_HOMEWORK_ONLY), self._pt(published=False)
        self.assertEqual(self._visible() & {hw.id, draft.id}, set())
        hw.assigned_users.add(self.student)
        self.assertIn(hw.id, self._visible())

    def test_filter_returns_each_test_once_even_when_many_are_assigned(self):
        # An open test also given to several people must not repeat (list page) nor make
        # .get(pk=...) raise MultipleObjectsReturned (detail page / attempt creation).
        pt = self._pt()
        for i in range(3):
            pt.assigned_users.add(User.objects.create_user(email=f"ptr_other{i}@example.com", password="pw", role=acc_const.ROLE_STUDENT))
        pt.assigned_users.add(self.student)
        qs = PracticeTest.objects.filter(visible_practice_tests_q(self.student))
        self.assertEqual(qs.count(), 1)
        self.assertEqual(PracticeTest.objects.filter(visible_practice_tests_q(self.student)).get(pk=pt.pk), pt)

    def test_past_papers_never_match(self):
        pp = self._pt(practice=False)
        pp.assigned_users.add(self.student)
        self.assertNotIn(pp.id, self._visible())

    def test_public_student_sees_nothing(self):
        public = User.objects.create_user(email="ptr_public@example.com", password="pw", role=acc_const.ROLE_PUBLIC_STUDENT)
        pt = self._pt()
        pt.assigned_users.add(public)
        self.assertFalse(PracticeTest.objects.filter(visible_practice_tests_q(public)).exists())

    def test_numbers_are_per_subject_and_stable(self):
        m1, m2 = self._pt(published=False), self._pt(published=False)
        r1 = self._pt(published=False, subject="READING_WRITING")
        for pt in (m1, m2, r1):
            assign_practice_number(pt)
        self.assertEqual((m1.practice_number, m2.practice_number, r1.practice_number), (1, 2, 1))
        assign_practice_number(m1)  # already numbered: unchanged
        self.assertEqual(m1.practice_number, 1)

    def test_a_stale_instance_never_renumbers_an_already_numbered_test(self):
        # Two requests load the same un-numbered row; the first numbers it, the second (stale
        # in memory, practice_number still None) must adopt that number, not take the next one.
        pt = self._pt(published=False)
        stale = PracticeTest.objects.get(pk=pt.pk)
        assign_practice_number(pt)
        assign_practice_number(stale)
        self.assertEqual(stale.practice_number, 1)
        pt.refresh_from_db()
        self.assertEqual(pt.practice_number, 1)
        self.assertEqual(PracticeTest.objects.filter(is_practice_test=True, subject="MATH").count(), 1)
        nxt = self._pt(published=False)
        assign_practice_number(nxt)
        self.assertEqual(nxt.practice_number, 2)  # no number was burned

    def test_assign_number_ignores_past_papers(self):
        pp = self._pt(practice=False)
        assign_practice_number(pp)
        self.assertIsNone(pp.practice_number)

    def test_display_title(self):
        pt = self._pt()
        self.assertEqual(practice_display_title(pt), "T")
        assign_practice_number(pt)
        self.assertEqual(practice_display_title(pt), "Practice Test 1")
