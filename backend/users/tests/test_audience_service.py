"""users.audience is the one place a learner moves between the learning center and public, and the
one place a debt freeze is set or lifted (plan 2026-10-13)."""

from django.test import TestCase, override_settings

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from users import audience
from users.models import RoleChange, User


class AudienceServiceTests(TestCase):
    def setUp(self):
        self.t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="R", subject="MATH", level="junior", lesson_days="ODD", lesson_time="18:00",
            created_by=self.t, teacher=self.t,
        )
        self.s = User.objects.create_user(None, password=None, username="s", role=C.ROLE_STUDENT)
        self.m = ClassroomMembership.objects.create(classroom=self.room, user=self.s, role="STUDENT")

    def test_make_public_removes_every_student_seat_and_logs_it(self):
        change = audience.make_public(self.s, reason=audience.REASON_LEFT, source=audience.SOURCE_SYNC, run_id=7)
        self.s.refresh_from_db()
        self.m.refresh_from_db()
        self.assertEqual(self.s.role, C.ROLE_PUBLIC_STUDENT)
        self.assertEqual(self.m.status, ClassroomMembership.STATUS_REMOVED)
        self.assertEqual((change.from_role, change.to_role, change.lcup_run_id), ("student", "public_student", 7))
        self.assertEqual(change.removed_membership_ids, [[self.m.pk, "ACTIVE"]])
        self.assertFalse(self.s.is_frozen)

    def test_leaving_with_debt_freezes_with_the_debt_reason(self):
        audience.make_public(
            self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True
        )
        self.s.refresh_from_db()
        self.assertTrue(self.s.is_frozen)
        self.assertEqual(self.s.frozen_reason, audience.FROZEN_LCUP_DEBT)
        self.assertEqual(audience.kind_of(self.s), "frozen_debt")

    def test_a_manual_freeze_is_never_relabelled_or_lifted(self):
        self.s.is_frozen = True
        self.s.save(update_fields=["is_frozen"])
        audience.make_public(
            self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True
        )
        self.s.refresh_from_db()
        self.assertEqual((self.s.is_frozen, self.s.frozen_reason), (True, ""))
        self.assertIsNone(audience.clear_debt_freeze(self.s, source=audience.SOURCE_SYNC))
        self.assertEqual(audience.kind_of(self.s), "frozen_admin")

    def test_paying_the_debt_lifts_only_the_debt_freeze(self):
        audience.make_public(
            self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True
        )
        change = audience.clear_debt_freeze(self.s, source=audience.SOURCE_SYNC)
        self.s.refresh_from_db()
        self.assertEqual((self.s.is_frozen, self.s.frozen_reason, change.unfroze), (False, "", True))
        self.assertEqual(audience.kind_of(self.s), "public")

    def test_coming_back_restores_the_role_and_lifts_a_debt_freeze(self):
        audience.make_public(
            self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True
        )
        audience.make_centre(self.s, reason=audience.REASON_JOINED, source=audience.SOURCE_SYNC)
        self.s.refresh_from_db()
        self.assertEqual((self.s.role, self.s.is_frozen), (C.ROLE_STUDENT, False))
        self.assertEqual(audience.kind_of(self.s), "centre")
        self.assertEqual(RoleChange.objects.filter(user=self.s).count(), 2)

    def test_staff_are_never_moved(self):
        with self.assertRaises(ValueError):
            audience.make_public(self.t, reason=audience.REASON_LEFT, source=audience.SOURCE_SYNC)
        self.assertEqual(audience.kind_of(self.t), "staff")

    @override_settings(PUBLIC_SPLIT_ENABLED=True)
    def test_sign_up_role_follows_the_switch(self):
        self.assertEqual(audience.self_signup_role(), C.ROLE_PUBLIC_STUDENT)
        with self.settings(PUBLIC_SPLIT_ENABLED=False):
            self.assertEqual(audience.self_signup_role(), C.ROLE_STUDENT)
