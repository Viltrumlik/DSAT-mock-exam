from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from access.models import UserAccess
from classes.capabilities import classroom_capabilities
from classes.models import ClassroomMembership
from lcup.accounts import CLAIM_DAYS, create_account_for, reissue_claim
from lcup.classrooms import create_classroom_for
from lcup.models import AccountClaim, GroupLinkStatus, LcupGroupLink, LcupStudentLink, LinkStatus
from users.models import User


class CreateAccountTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def link(self, **kw):
        defaults = {"lcup_student_id": 1, "name": "Karimova Malika", "phone": "998901234567"}
        defaults.update(kw)
        return LcupStudentLink.objects.create(**defaults)

    def test_creates_a_student_with_a_claim_and_no_usable_password(self):
        link = self.link()
        user = create_account_for(link, now=self.now)
        self.assertEqual(user.username, "998901234567")
        self.assertEqual(user.phone_number, "998901234567")
        self.assertEqual((user.first_name, user.last_name), ("Malika", "Karimova"))
        self.assertEqual(user.role, "student")
        self.assertIsNone(user.email)
        self.assertFalse(user.has_usable_password())
        claim = AccountClaim.objects.get(user=user)
        self.assertEqual(claim.phone, "998901234567")
        self.assertEqual(claim.expires_at, self.now + timedelta(days=CLAIM_DAYS))
        link.refresh_from_db()
        self.assertEqual((link.user_id, link.status), (user.pk, LinkStatus.CREATED))

    def test_a_phone_already_on_another_account_goes_to_review(self):
        User.objects.create_user(None, password=None, username="someone", role="student", phone_number="+998 90 123 45 67")
        link = self.link()
        self.assertIsNone(create_account_for(link, now=self.now))
        link.refresh_from_db()
        self.assertEqual((link.status, link.match_reason), (LinkStatus.NEEDS_REVIEW, "phone already used by another account"))
        self.assertFalse(User.objects.filter(username="998901234567").exists())

    def test_no_phone_goes_to_review(self):
        link = self.link(phone="")
        self.assertIsNone(create_account_for(link, now=self.now))
        link.refresh_from_db()
        self.assertEqual((link.status, link.match_reason), (LinkStatus.NEEDS_REVIEW, "no phone in lc-up"))

    def test_the_admin_can_give_a_sibling_another_phone(self):
        link = self.link()
        user = create_account_for(link, now=self.now, phone_override="+998 93 000 00 01")
        self.assertEqual(user.username, "998930000001")
        self.assertEqual(AccountClaim.objects.get(user=user).phone, "998930000001")

    def test_reissue_unlocks_and_extends(self):
        user = create_account_for(self.link(), now=self.now)
        claim = AccountClaim.objects.get(user=user)
        claim.failed_attempts, claim.locked_at = 5, self.now
        claim.save()
        later = self.now + timedelta(days=20)
        reissue_claim(claim, now=later)
        claim.refresh_from_db()
        self.assertEqual((claim.failed_attempts, claim.locked_at, claim.reissued_count), (0, None, 1))
        self.assertEqual(claim.expires_at, later + timedelta(days=CLAIM_DAYS))
        self.assertTrue(claim.can_attempt(later))


SNAPSHOT = {
    "name": "Junior G21 | Math | Abdulaziz",
    "course": {"id": 301, "name": "Junior Math"},
    "days": [1, 3, 5],
    "start_time": "18:00:00",
    "finish_time": "19:30:00",
}


class CreateClassroomTests(TestCase):
    def setUp(self):
        self.t1 = User.objects.create_user(None, password=None, username="t1", role="teacher", subject="math")
        self.t2 = User.objects.create_user(None, password=None, username="t2", role="teacher", subject="math")
        self.link = LcupGroupLink.objects.create(lcup_group_id=7, name=SNAPSHOT["name"], snapshot=SNAPSHOT)

    def test_builds_the_class_from_the_lcup_group(self):
        room = create_classroom_for(self.link, teacher_users=[self.t1, self.t2], branch=None)
        self.assertEqual(
            (room.subject, room.level, room.lesson_days, room.lesson_time, room.lesson_hours),
            ("MATH", "junior", "ODD", "18:00", 2),
        )
        self.assertEqual((room.created_by_id, room.teacher_id), (self.t1.pk, self.t1.pk))
        roles = dict(ClassroomMembership.objects.filter(classroom=room).values_list("user_id", "role"))
        self.assertEqual(roles, {self.t1.pk: ClassroomMembership.ROLE_ADMIN, self.t2.pk: ClassroomMembership.ROLE_TEACHER})
        self.assertTrue(UserAccess.objects.filter(user=self.t2, classroom=room).exists())
        self.assertTrue(classroom_capabilities(self.t2, room).can_manage_roster)
        self.link.refresh_from_db()
        self.assertEqual((self.link.classroom_id, self.link.status), (room.pk, GroupLinkStatus.CONFIRMED))

    def test_refuses_without_a_linked_teacher(self):
        with self.assertRaises(ValueError):
            create_classroom_for(self.link, teacher_users=[], branch=None)

    def test_refuses_when_the_days_are_not_a_known_pattern(self):
        self.link.snapshot = {**SNAPSHOT, "days": [1, 2]}
        with self.assertRaises(ValueError):
            create_classroom_for(self.link, teacher_users=[self.t1], branch=None)
