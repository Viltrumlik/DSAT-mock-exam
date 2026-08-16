"""A support teacher who covers both subjects, and an admin who sets their hours.

The dangerous shape of the first change is a *silent* one: `user_domain_subject` compares with
`==` at every alignment site, so a "both" teacher who reached those comparisons would be
denied everywhere rather than allowed everywhere. Half these tests exist to pin that they are
allowed, and that the value never leaks into the places where "both" is meaningless.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from access.models import UserAccess
from access.services import covers_domain_subject, user_domain_subject, user_domain_subjects
from classes.models import Classroom, ClassroomMembership
from classes.models_support import SupportAvailability

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class BothSubjectTests(TestCase):
    def setUp(self):
        self.both = _u("sb_both@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.math_only = _u("sb_math@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)

    def test_a_support_teacher_may_cover_both(self):
        self.assertEqual(
            user_domain_subjects(self.both), frozenset({C.DOMAIN_MATH, C.DOMAIN_ENGLISH})
        )

    def test_the_singular_resolver_still_returns_one_subject_or_none(self):
        """The load-bearing decision. Every alignment site compares this with `==` against a
        single domain, so "both" must NOT come back from here — it would be compared against
        "math", fail, and deny the teacher everywhere."""
        self.assertEqual(user_domain_subject(self.math_only), C.DOMAIN_MATH)
        self.assertIsNone(user_domain_subject(self.both))

    def test_covers_answers_yes_for_either_subject(self):
        self.assertTrue(covers_domain_subject(self.both, C.DOMAIN_MATH))
        self.assertTrue(covers_domain_subject(self.both, C.DOMAIN_ENGLISH))

    def test_a_single_subject_teacher_still_covers_only_theirs(self):
        self.assertTrue(covers_domain_subject(self.math_only, C.DOMAIN_MATH))
        self.assertFalse(covers_domain_subject(self.math_only, C.DOMAIN_ENGLISH))

    def test_both_is_not_a_grant_vocabulary_word(self):
        """`UserAccess.subject` names a domain of resources, where "both" is meaningless."""
        self.assertNotIn(C.DOMAIN_BOTH, C.ALL_DOMAIN_SUBJECTS)

    def test_a_class_teacher_cannot_be_both(self):
        """A classroom has one subject, so a both-subject teacher is one no class can align to."""
        teacher = User(email="sb_t@t.com", username="sb_t", role=C.ROLE_TEACHER, subject=C.DOMAIN_BOTH)
        with self.assertRaises(ValidationError):
            teacher.clean()

    def test_a_support_teacher_can_be(self):
        support = User(
            email="sb_s@t.com", username="sb_s",
            role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH,
        )
        support.clean()   # must not raise


class BothSubjectApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = _u("sb_admin@t.com", role=C.ROLE_ADMIN)

    def test_creating_a_both_support_teacher_grants_two_access_rows(self):
        """Two real rows, not one "both" row — that is what makes every existing
        subject-scoped check work unchanged."""
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/users/create/", {
            "email": "sb_new@t.com", "username": "sb_new", "password": "secret12345",
            "role": C.ROLE_SUPPORT_TEACHER, "subject": C.DOMAIN_BOTH,
        }, format="json")

        self.assertIn(response.status_code, (200, 201), response.content)
        created = User.objects.get(email="sb_new@t.com")
        self.assertEqual(
            set(
                UserAccess.objects.filter(user=created, classroom__isnull=True)
                .values_list("subject", flat=True)
            ),
            {C.DOMAIN_MATH, C.DOMAIN_ENGLISH},
        )

    def test_a_both_support_teacher_appears_in_both_directory_pickers(self):
        """Without this they appear in neither, and ops could never assign the account they
        just created."""
        both = _u("sb_dir@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.client.force_authenticate(self.admin)

        for domain in (C.DOMAIN_MATH, C.DOMAIN_ENGLISH):
            body = self.client.get(f"/api/users/?subject={domain}").json()
            rows = body.get("results", body) if isinstance(body, dict) else body
            ids = {row["id"] for row in rows}
            self.assertIn(both.pk, ids, f"missing from the {domain} picker")


class TheGatesTests(TestCase):
    """The gates a both-subject support teacher is actually stopped by.

    Every test above this class passed while a real both-subject support teacher could not
    load a single page of the platform. That is the whole lesson: ``BothSubjectTests`` proves
    ``covers_domain_subject`` answers correctly, and proves nothing at all about whether
    anything **calls** it.

    Four central gates still compared the singular ``user_domain_subject``, which returns
    ``None`` for "both" by design, so the account was refused everywhere:

      * ``StaffSubjectRequiredMiddleware`` — runs on EVERY ``/api/`` request, so this one
        alone returned 403 to every call the account ever made;
      * ``has_global_subject_access``;
      * ``has_access_for_classroom``;
      * ``authorize`` — which logged the refusal as ``actor_subject_mismatch``, reading like a
        misconfigured account rather than the bug it was.

    Each test here goes through the real gate rather than through the helper.
    """

    def setUp(self):
        self.client = APIClient()
        self.both = _u("gate_both@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.math_only = _u("gate_math@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        for domain in (C.DOMAIN_MATH, C.DOMAIN_ENGLISH):
            UserAccess.objects.create(user=self.both, subject=domain, classroom=None)
        UserAccess.objects.create(user=self.math_only, subject=C.DOMAIN_MATH, classroom=None)

    def test_the_middleware_lets_a_both_subject_account_make_any_api_call(self):
        """The bug the school reported as "cannot get into the teacher panel".

        The middleware sits in front of every ``/api/`` path, so this is not one broken screen
        — it is the whole account. Asserted on the refusal's own wording so that a 403 arriving
        from some unrelated permission check cannot make this test look green.

        ``force_login``, NOT ``force_authenticate``: DRF's helper attaches the user inside the
        view, and this gate is Django middleware that has already run and gone by then. Written
        with ``force_authenticate`` the test passes whatever the middleware does, because
        ``request.user`` is still anonymous when the gate reads it and the gate skips anonymous
        requests. Session login goes through ``AuthenticationMiddleware``, which the stack
        places before this gate (config/settings.py).
        """
        self.client.force_login(self.both)

        response = self.client.get("/api/classes/")

        self.assertNotEqual(response.status_code, 403, response.content)
        self.assertNotIn(b"missing a valid subject", response.content)

    def test_an_account_with_no_subject_at_all_is_still_refused(self):
        """The gate must still do its job — "both" is configured, blank is not.

        The blank has to be written with ``update()`` because ``create_user`` already refuses
        it, which is the stronger guard. That is precisely the state this middleware defends
        against, though: a row that got into a bad shape by some route that never went through
        the manager — a data migration, a fixture, a hand-edited row.
        """
        broken = _u("gate_none@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        User.objects.filter(pk=broken.pk).update(subject="")
        broken.refresh_from_db()
        self.client.force_login(broken)   # see the note above on force_login vs force_authenticate

        response = self.client.get("/api/classes/")

        self.assertEqual(response.status_code, 403)
        self.assertIn(b"missing a valid subject", response.content)

    def test_global_subject_access_is_granted_for_either_domain(self):
        from access.services import has_global_subject_access

        self.assertTrue(has_global_subject_access(self.both, C.DOMAIN_MATH))
        self.assertTrue(has_global_subject_access(self.both, C.DOMAIN_ENGLISH))

    def test_classroom_access_is_granted_in_either_subject(self):
        """The bug the school reported as "cannot be assigned to a classroom"."""
        from access.services import has_access_for_classroom

        teacher = _u("gate_owner@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        maths = Classroom.objects.create(
            name="M", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=teacher,
        )
        english = Classroom.objects.create(
            name="E", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=teacher,
        )

        self.assertTrue(has_access_for_classroom(self.both, C.DOMAIN_MATH, maths.pk))
        self.assertTrue(has_access_for_classroom(self.both, C.DOMAIN_ENGLISH, english.pk))

    def test_a_single_subject_support_teacher_is_still_refused_the_other_one(self):
        """The fix must not become "everyone covers everything"."""
        from access.services import has_global_subject_access

        self.assertTrue(has_global_subject_access(self.math_only, C.DOMAIN_MATH))
        self.assertFalse(has_global_subject_access(self.math_only, C.DOMAIN_ENGLISH))


class SupportAssignmentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = _u("sa_admin@t.com", role=C.ROLE_ADMIN)
        self.both = _u("sa_both@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.math_only = _u("sa_math@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        self.english_class = Classroom.objects.create(
            name="Eng", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )

    def _assign(self, user):
        return self.client.post(
            f"/api/classes/{self.english_class.pk}/support-teachers/",
            {"user_id": user.pk}, format="json",
        )

    def test_a_both_teacher_can_be_assigned_to_an_english_class(self):
        self.client.force_authenticate(self.admin)

        response = self._assign(self.both)

        self.assertIn(response.status_code, (200, 201), response.content)
        self.assertTrue(
            ClassroomMembership.objects.filter(
                classroom=self.english_class, user=self.both,
                role=ClassroomMembership.ROLE_TA,
            ).exists()
        )

    def test_a_maths_only_teacher_still_cannot(self):
        self.client.force_authenticate(self.admin)

        response = self._assign(self.math_only)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Subject mismatch", response.json()["detail"])


class AdminSetsHoursTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = _u("ah_admin@t.com", role=C.ROLE_ADMIN)
        self.support = _u("ah_support@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        self.other = _u("ah_other@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        # Next hour, on the hour — the grid only speaks in whole hours.
        self.hour = (timezone.localtime() + timedelta(days=1)).replace(
            minute=0, second=0, microsecond=0
        )

    def test_an_admin_closes_an_hour_on_the_teachers_calendar(self):
        """The bug this fixes: without a target, the write landed on the ADMIN's calendar,
        where no student would ever see it."""
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/classes/support/hours/close/", {
            "starts_at": self.hour.isoformat(),
            "support_teacher": self.support.pk,
        }, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        slot = SupportAvailability.objects.get(support_teacher=self.support)
        self.assertTrue(slot.is_cancelled)
        self.assertFalse(SupportAvailability.objects.filter(support_teacher=self.admin).exists())

    def test_a_support_teacher_cannot_edit_somebody_elses_hours(self):
        self.client.force_authenticate(self.support)

        response = self.client.post("/api/classes/support/hours/close/", {
            "starts_at": self.hour.isoformat(),
            "support_teacher": self.other.pk,
        }, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertFalse(SupportAvailability.objects.filter(support_teacher=self.other).exists())

    def test_omitting_the_target_still_edits_your_own(self):
        """Nothing a support teacher already does changes."""
        self.client.force_authenticate(self.support)

        response = self.client.post("/api/classes/support/hours/close/", {
            "starts_at": self.hour.isoformat(),
        }, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(SupportAvailability.objects.filter(support_teacher=self.support).exists())

    def test_an_admin_cannot_name_somebody_who_is_not_a_support_teacher(self):
        student = _u("ah_student@t.com")
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/classes/support/hours/close/", {
            "starts_at": self.hour.isoformat(),
            "support_teacher": student.pk,
        }, format="json")

        self.assertEqual(response.status_code, 400)

    def test_an_admin_publishes_a_group_slot_for_a_teacher(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/classes/support/availability/", {
            "starts_at": self.hour.isoformat(),
            "ends_at": (self.hour + timedelta(hours=1)).isoformat(),
            "capacity": 4,
            "support_teacher": self.support.pk,
        }, format="json")

        self.assertIn(response.status_code, (200, 201), response.content)
        slot = SupportAvailability.objects.get(support_teacher=self.support)
        self.assertEqual(slot.capacity, 4)

    def test_an_admin_reads_a_teachers_grid_before_editing_it(self):
        SupportAvailability.objects.create(
            support_teacher=self.support, starts_at=self.hour,
            ends_at=self.hour + timedelta(hours=1), capacity=3,
        )
        self.client.force_authenticate(self.admin)

        body = self.client.get(
            f"/api/classes/support/availability/?support_teacher={self.support.pk}"
        ).json()

        self.assertEqual(len(body["slots"]), 1)
