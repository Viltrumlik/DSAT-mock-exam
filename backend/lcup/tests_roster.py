from django.test import TestCase
from django.utils import timezone

from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership
from classes.models_membership_audit import ClassroomMembershipEvent
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink
from lcup.roster import apply_plan, per_class_removal_cap, plan_group
from users.models import User

ACTIVE = ClassroomMembership.STATUS_ACTIVE
REMOVED = ClassroomMembership.STATUS_REMOVED
STUDENT = ClassroomMembership.ROLE_STUDENT


class RosterTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject="MATH", lesson_days="ODD", created_by=self.teacher, teacher=self.teacher
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=7, name="Junior G21 | Math", classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        self._ids = iter(range(1, 1000))

    def student(self, name):
        return User.objects.create_user(None, password=None, username=name, role="student")

    def linked(self, user, *, lcup_status="active", left=False, in_group=True):
        link = LcupStudentLink.objects.create(lcup_student_id=next(self._ids), name=user.username, user=user)
        if in_group:
            LcupMembership.objects.create(
                group=self.group, student=link, lcup_status=lcup_status, left_at=timezone.now() if left else None
            )
        return link

    def ours(self, user, status=ACTIVE, role=STUDENT):
        return ClassroomMembership.objects.create(classroom=self.room, user=user, role=role, status=status)

    def status_of(self, user):
        return ClassroomMembership.objects.get(classroom=self.room, user=user).status

    def test_adds_a_new_student_and_the_audit_records_it(self):
        s = self.student("s1")
        self.linked(s)
        plan = plan_group(self.group)
        self.assertEqual(plan.to_add, {s.pk})
        self.assertEqual(apply_plan(self.group, plan, allow_removals=True), {"added": 1, "reactivated": 0, "removed": 0, "removed_unlinked": 0})
        self.assertEqual(self.status_of(s), ACTIVE)
        self.assertTrue(ClassroomMembershipEvent.objects.filter(classroom=self.room, student=s).exists())

    def test_an_added_or_reactivated_student_gets_the_subject_access_grant(self):
        new, back = self.student("new"), self.student("back")
        self.linked(new)
        self.linked(back)
        self.ours(back, status=REMOVED)
        apply_plan(self.group, plan_group(self.group), allow_removals=True)
        for user in (new, back):
            self.assertTrue(UserAccess.objects.filter(user=user, classroom=self.room, subject="math").exists(), user)

    def test_trial_and_frozen_members_are_ordinary_members(self):
        trial, frozen = self.student("trial"), self.student("frozen")
        self.linked(trial, lcup_status="trial")
        self.linked(frozen, lcup_status="frozen")
        self.assertEqual(plan_group(self.group).to_add, {trial.pk, frozen.pk})

    def test_reactivates_a_removed_student(self):
        s = self.student("s1")
        self.linked(s)
        self.ours(s, status=REMOVED)
        plan = plan_group(self.group)
        self.assertEqual((plan.to_add, plan.to_reactivate), (set(), {s.pk}))
        apply_plan(self.group, plan, allow_removals=True)
        self.assertEqual(self.status_of(s), ACTIVE)

    def test_removes_a_linked_student_who_left_lcup(self):
        s = self.student("s1")
        self.linked(s, left=True)
        self.ours(s)
        plan = plan_group(self.group)
        self.assertEqual(plan.to_remove, {s.pk})
        apply_plan(self.group, plan, allow_removals=True)
        self.assertEqual(self.status_of(s), REMOVED)

    def test_a_member_lcup_does_not_have_leaves(self):
        # Owner 2026-10-14: "o'quvchi lc-upda bo'lmasa bizdan ham chiqib ketsin".
        s = self.student("unlinked")
        self.ours(s)
        plan = plan_group(self.group)
        self.assertEqual((plan.to_remove, plan.to_remove_unlinked), (set(), {s.pk}))
        self.assertEqual(apply_plan(self.group, plan, allow_removals=True)["removed_unlinked"], 1)
        self.assertEqual(self.status_of(s), REMOVED)

    def test_an_unlinked_member_stays_while_an_lcup_member_has_no_account_here(self):
        # That lc-up student may be this very person, waiting in the review queue.
        s = self.student("unlinked")
        self.ours(s)
        waiting = LcupStudentLink.objects.create(lcup_student_id=999, name="Waiting Student")
        LcupMembership.objects.create(group=self.group, student=waiting, lcup_status="active")
        self.assertEqual(plan_group(self.group).to_remove_unlinked, set())

    def test_unlinked_members_leave_whatever_the_caps(self):
        # The caps guard against lc-up sending half a member list; this removal reads no list.
        stray = [self.student(f"u{i}") for i in range(10)]
        for s in stray:
            self.ours(s)
        plan = plan_group(self.group)
        self.assertEqual(len(plan.to_remove_unlinked), 10)
        self.assertFalse(plan.blocked_removals)
        apply_plan(self.group, plan, allow_removals=False)
        self.assertTrue(all(self.status_of(s) == REMOVED for s in stray))

    def test_never_touches_a_staff_row(self):
        self.linked(self.teacher)
        plan = plan_group(self.group)
        self.assertEqual((plan.to_add, plan.to_reactivate, plan.to_remove), (set(), set(), set()))
        apply_plan(self.group, plan, allow_removals=True)
        self.assertEqual(
            ClassroomMembership.objects.get(classroom=self.room, user=self.teacher).role, ClassroomMembership.ROLE_ADMIN
        )

    def test_too_many_removals_in_one_class_are_held(self):
        students = [self.student(f"s{i}") for i in range(10)]
        for i, s in enumerate(students):
            self.linked(s, left=i < 4)
            self.ours(s)
        plan = plan_group(self.group)
        self.assertEqual(len(plan.to_remove), 4)
        self.assertTrue(plan.blocked_removals)
        apply_plan(self.group, plan, allow_removals=True)
        self.assertTrue(all(self.status_of(s) == ACTIVE for s in students))

    def test_removals_can_be_held_while_adds_still_happen(self):
        leaver, joiner = self.student("leaver"), self.student("joiner")
        self.linked(leaver, left=True)
        self.ours(leaver)
        self.linked(joiner)
        counts = apply_plan(self.group, plan_group(self.group), allow_removals=False)
        self.assertEqual(counts, {"added": 1, "reactivated": 0, "removed": 0, "removed_unlinked": 0})
        self.assertEqual(self.status_of(leaver), ACTIVE)

    def test_cap(self):
        self.assertEqual([per_class_removal_cap(n) for n in (0, 10, 20, 30)], [3, 3, 4, 6])
