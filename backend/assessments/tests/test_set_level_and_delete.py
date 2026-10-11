"""AssessmentSet.level: subject-dependent validation, and the hardened set-delete
endpoint (blocks published/assigned sets with 409 instead of 500)."""
from __future__ import annotations

import importlib

from django.contrib import admin as django_admin
from django.contrib.auth import get_user_model
from django.db import IntegrityError, migrations, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet, HomeworkAssignment
from assessments.serializers import AssessmentSetAdminWriteSerializer
from classes.models import Assignment, Classroom

User = get_user_model()


class AllowedLevelsTests(TestCase):
    def test_allowed_levels_per_subject(self):
        eng = AssessmentSet.allowed_levels_for_subject(AssessmentSet.SUBJECT_ENGLISH)
        math = AssessmentSet.allowed_levels_for_subject(AssessmentSet.SUBJECT_MATH)
        self.assertEqual(set(eng), {"junior", "middle", "senior"})
        self.assertEqual(set(math), {"foundation", "junior", "middle", "senior"})
        self.assertEqual(AssessmentSet.allowed_levels_for_subject("nope"), ())


class WriteSerializerLevelTests(TestCase):
    def _payload(self, **over):
        base = {
            "subject": "english", "title": "Set", "category": "Boundaries",
            "source": AssessmentSet.SOURCE_SATOPLAM,
        }
        base.update(over)
        return base

    def test_english_rejects_foundation(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="foundation"))
        self.assertFalse(s.is_valid())
        self.assertIn("level", s.errors)

    def test_english_accepts_middle(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="middle"))
        self.assertTrue(s.is_valid(), s.errors)

    def test_math_accepts_foundation(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(subject="math", source=AssessmentSet.SOURCE_MATHBOOK, level="foundation")
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_blank_level_allowed_on_create(self):
        # Level is required in the UI, but blank is accepted server-side (legacy/untagged).
        s = AssessmentSetAdminWriteSerializer(data=self._payload())
        self.assertTrue(s.is_valid(), s.errors)

    def test_update_rejects_invalid_level_for_subject(self):
        author = User.objects.create_user("lvl_author@test.com", "secret123")
        inst = AssessmentSet.objects.create(
            subject="english", category="Boundaries", title="Existing", created_by=author,
        )
        s = AssessmentSetAdminWriteSerializer(inst, data={"level": "foundation"}, partial=True)
        self.assertFalse(s.is_valid())
        self.assertIn("level", s.errors)


class SecondaryLevelValidationTests(TestCase):
    """The OPTIONAL second level (2026-10-11, the school's request): a set shown to two
    cohorts at once. Never alone, never the primary twice, always valid for the subject —
    and a PATCH that touches only the primary or the subject is checked against the
    second level already stored."""

    def setUp(self):
        self.author = User.objects.create_user("sec_lvl_author@test.com", "secret123")

    def _payload(self, **over):
        base = {
            "subject": "math", "title": "Set", "category": "Algebra",
            "source": AssessmentSet.SOURCE_MATHBOOK,
        }
        base.update(over)
        return base

    def _stored(self, **over):
        fields = {
            "subject": "math", "category": "Algebra", "title": "Stored",
            "source": AssessmentSet.SOURCE_MATHBOOK, "level": "junior",
            "secondary_level": "middle", "created_by": self.author,
        }
        fields.update(over)
        return AssessmentSet.objects.create(**fields)

    def _patch(self, inst, data):
        return AssessmentSetAdminWriteSerializer(inst, data=data, partial=True)

    # ── create ───────────────────────────────────────────────────────────────
    def test_second_level_is_optional(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(level="junior"))
        self.assertTrue(s.is_valid(), s.errors)
        inst = s.save(created_by=self.author)
        self.assertEqual(inst.secondary_level, "")
        self.assertEqual(inst.levels, ("junior",))

    def test_math_junior_plus_middle_accepted_on_create(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(level="junior", secondary_level="middle")
        )
        self.assertTrue(s.is_valid(), s.errors)
        inst = s.save(created_by=self.author)
        self.assertEqual(inst.levels, ("junior", "middle"))

    def test_secondary_equal_to_primary_rejected(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(level="middle", secondary_level="middle")
        )
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    def test_secondary_without_primary_rejected(self):
        s = AssessmentSetAdminWriteSerializer(data=self._payload(secondary_level="middle"))
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    def test_english_foundation_secondary_rejected(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(
                subject="english", source=AssessmentSet.SOURCE_SATOPLAM,
                level="junior", secondary_level="foundation",
            )
        )
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    def test_unknown_secondary_rejected_by_choices(self):
        s = AssessmentSetAdminWriteSerializer(
            data=self._payload(level="junior", secondary_level="expert")
        )
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    # ── PATCH ────────────────────────────────────────────────────────────────
    def test_patch_adds_a_valid_second_level(self):
        inst = self._stored(secondary_level="")
        s = self._patch(inst, {"secondary_level": "middle"})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().levels, ("junior", "middle"))

    def test_patch_clears_the_second_level(self):
        inst = self._stored()
        s = self._patch(inst, {"secondary_level": ""})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().levels, ("junior",))

    def test_patch_primary_onto_the_stored_secondary_rejected(self):
        # Only ``level`` is sent; the stored secondary is already "middle".
        s = self._patch(self._stored(), {"level": "middle"})
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    def test_patch_swapping_both_levels_accepted(self):
        s = self._patch(self._stored(), {"level": "middle", "secondary_level": "junior"})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().levels, ("middle", "junior"))

    def test_patch_clearing_primary_while_secondary_stored_rejected(self):
        s = self._patch(self._stored(), {"level": ""})
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)

    def test_patch_clearing_both_accepted(self):
        s = self._patch(self._stored(), {"level": "", "secondary_level": ""})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().levels, ())

    def test_patch_subject_stranding_the_stored_secondary_rejected(self):
        # Math Junior + Foundation, moved to English (which has no Foundation): the
        # primary still fits, the stored secondary no longer does.
        inst = self._stored(secondary_level="foundation")
        s = self._patch(
            inst, {"subject": "english", "source": AssessmentSet.SOURCE_SATOPLAM}
        )
        self.assertFalse(s.is_valid())
        self.assertIn("secondary_level", s.errors)


class SecondaryLevelEndpointTests(TestCase):
    """The same rules through the real admin endpoints, and the field on the reads."""

    def setUp(self):
        self.admin = User.objects.create_user(
            "sec_lvl_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_create_and_patch_round_trip(self):
        resp = self.client.post(
            "/api/assessments/admin/sets/",
            {
                "subject": "math", "title": "Dual", "category": "Algebra",
                "source": AssessmentSet.SOURCE_MATHBOOK,
                "level": "junior", "secondary_level": "middle",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["level"], "junior")
        self.assertEqual(resp.json()["secondary_level"], "middle")
        set_id = resp.json()["id"]

        detail = self.client.get(f"/api/assessments/admin/sets/{set_id}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()["secondary_level"], "middle")

        patched = self.client.patch(
            f"/api/assessments/admin/sets/{set_id}/", {"secondary_level": "senior"}, format="json"
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(AssessmentSet.objects.get(pk=set_id).secondary_level, "senior")

    def test_patch_onto_stored_secondary_is_a_400(self):
        aset = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Dual",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", secondary_level="middle",
            created_by=self.admin,
        )
        resp = self.client.patch(
            f"/api/assessments/admin/sets/{aset.id}/", {"level": "middle"}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("secondary_level", resp.json())
        aset.refresh_from_db()
        self.assertEqual((aset.level, aset.secondary_level), ("junior", "middle"))


class SecondaryLevelAdminFormTests(TestCase):
    """The Django admin's change form never goes through the API serializer, only through
    the model's ``clean()``. It must refuse the same pairs the API refuses, with the error
    on the second-level field. A bad pair saved there would make every later builder
    "Save metadata" on that set a 400 that the editor cannot clear."""

    def setUp(self):
        self.staff = User.objects.create_superuser("sec_lvl_staff@test.com", "secret123")

    def _form(self, instance=None, **over):
        request = RequestFactory().get("/django-admin/")
        request.user = self.staff
        # The admin's OWN form class, built the way the change view builds it.
        form_class = django_admin.site._registry[AssessmentSet].get_form(request, instance)
        data = {
            "subject": "math", "source": AssessmentSet.SOURCE_MATHBOOK,
            "level": "junior", "secondary_level": "", "category": "Algebra",
            "title": "Staff edit", "description": "", "is_active": "on",
            "review_status": AssessmentSet.STATUS_DRAFT, "created_by": str(self.staff.pk),
        }
        data.update(over)
        return form_class(data=data, instance=instance)

    def _assert_refused(self, form, subject, level, secondary):
        self.assertFalse(form.is_valid())
        # Exactly the API's message, once. The DB CHECK constraint is not reported a
        # second time as a non-field error.
        self.assertEqual(
            form.errors["secondary_level"],
            [AssessmentSet.secondary_level_problem(subject, level, secondary)],
        )
        self.assertNotIn("__all__", form.errors)

    def test_admin_refuses_second_level_without_primary(self):
        self._assert_refused(
            self._form(level="", secondary_level="middle"), "math", "", "middle"
        )

    def test_admin_refuses_second_level_equal_to_primary(self):
        self._assert_refused(
            self._form(level="middle", secondary_level="middle"), "math", "middle", "middle"
        )

    def test_admin_refuses_english_foundation_second_level(self):
        self._assert_refused(
            self._form(
                subject="english", source=AssessmentSet.SOURCE_SATOPLAM,
                level="junior", secondary_level="foundation",
            ),
            "english", "junior", "foundation",
        )

    def test_admin_change_form_clearing_primary_under_stored_second_level_refused(self):
        stored = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Dual",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", secondary_level="middle",
            created_by=self.staff,
        )
        self._assert_refused(
            self._form(stored, level="", secondary_level="middle"), "math", "", "middle"
        )
        stored.refresh_from_db()
        self.assertEqual(stored.levels, ("junior", "middle"))

    def test_admin_saves_a_valid_pair(self):
        form = self._form(level="junior", secondary_level="middle")
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.save().levels, ("junior", "middle"))

    def test_admin_still_saves_a_legacy_untagged_set(self):
        form = self._form(level="", secondary_level="")
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.save().levels, ())

    def test_admin_and_api_give_the_same_message(self):
        # One rule, two doors: the messages cannot drift apart.
        for level, secondary in (("", "middle"), ("middle", "middle")):
            api = AssessmentSetAdminWriteSerializer(
                data={
                    "subject": "math", "title": "Set", "category": "Algebra",
                    "source": AssessmentSet.SOURCE_MATHBOOK,
                    "level": level, "secondary_level": secondary,
                }
            )
            self.assertFalse(api.is_valid())
            form = self._form(level=level, secondary_level=secondary)
            self.assertFalse(form.is_valid())
            self.assertEqual(
                [str(m) for m in api.errors["secondary_level"]],
                form.errors["secondary_level"],
            )


class SecondaryLevelDbConstraintTests(TestCase):
    """The CHECK constraint under both validators. It catches writers that skip
    validation entirely: ``.update()``, shell scripts, a future import."""

    def setUp(self):
        self.author = User.objects.create_user("sec_lvl_db@test.com", "secret123")

    def _create(self, **over):
        fields = {
            "subject": "math", "category": "Algebra", "title": "Row",
            "source": AssessmentSet.SOURCE_MATHBOOK, "created_by": self.author,
        }
        fields.update(over)
        return AssessmentSet.objects.create(**fields)

    def test_db_refuses_second_level_without_primary(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._create(level="", secondary_level="middle")

    def test_db_refuses_second_level_equal_to_primary(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._create(level="middle", secondary_level="middle")

    def test_db_refuses_an_update_that_breaks_a_stored_pair(self):
        dual = self._create(level="junior", secondary_level="middle")
        qs = AssessmentSet.objects.filter(pk=dual.pk)
        with self.assertRaises(IntegrityError), transaction.atomic():
            qs.update(level="middle")
        with self.assertRaises(IntegrityError), transaction.atomic():
            qs.update(level="")
        dual.refresh_from_db()
        self.assertEqual(dual.levels, ("junior", "middle"))

    def test_db_accepts_valid_pairs_and_single_or_no_level(self):
        self._create(title="Dual", level="junior", secondary_level="middle")
        self._create(title="Single", level="senior")
        self._create(title="Untagged")
        self.assertEqual(AssessmentSet.objects.count(), 3)


class SecondaryLevelMigrationShapeTests(SimpleTestCase):
    """The suite builds tables from the models, never from migrations, so a CHECK
    constraint missing from 0031 would pass every test and still never reach prod."""

    def test_0031_adds_the_model_constraint_after_the_column(self):
        mod = importlib.import_module(
            "assessments.migrations.0031_assessmentset_secondary_level"
        )
        ops = mod.Migration.operations
        kinds = [type(op) for op in ops]
        self.assertEqual(kinds, [migrations.AddField, migrations.AddConstraint])
        (model_constraint,) = [
            c for c in AssessmentSet._meta.constraints
            if c.name == "assessment_sets_secondary_level_valid"
        ]
        self.assertEqual(ops[1].constraint, model_constraint)


class LevelHelpersTests(TestCase):
    """``levels`` / ``level_q`` / ``effective_level_for`` — the model helpers every level
    filter and the runner's calculator decision go through."""

    def setUp(self):
        self.author = User.objects.create_user("lvl_helpers@test.com", "secret123")

    def _mk(self, title, level="", secondary=""):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra", title=title,
            source=AssessmentSet.SOURCE_MATHBOOK, level=level, secondary_level=secondary,
            created_by=self.author,
        )

    def test_level_q_matches_either_level(self):
        dual = self._mk("Dual", "junior", "middle")
        junior = self._mk("Junior", "junior")
        middle = self._mk("Middle", "middle")
        self._mk("Senior", "senior")
        self._mk("Untagged")
        ids = lambda lv: set(  # noqa: E731
            AssessmentSet.objects.filter(AssessmentSet.level_q(lv)).values_list("id", flat=True)
        )
        self.assertEqual(ids("junior"), {dual.id, junior.id})
        self.assertEqual(ids("middle"), {dual.id, middle.id})
        self.assertNotIn(dual.id, ids("senior"))

    def test_effective_level(self):
        dual = self._mk("Dual", "junior", "middle")
        self.assertEqual(dual.effective_level_for("junior"), "junior")
        self.assertEqual(dual.effective_level_for("middle"), "middle")
        # Not one of the set's levels (untagged class / re-tagged set) -> the primary.
        self.assertEqual(dual.effective_level_for("senior"), "junior")
        self.assertEqual(dual.effective_level_for(""), "junior")
        self.assertEqual(dual.effective_level_for(None), "junior")
        self.assertEqual(self._mk("Untagged").effective_level_for("middle"), "")


class SetDeleteGuardTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "del_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk_set(self, title="Draft set"):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra", title=title,
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.admin,
        )

    def _delete(self, set_id):
        return self.client.delete(f"/api/assessments/admin/sets/{set_id}/")

    def test_delete_pristine_draft_returns_204(self):
        s = self._mk_set()
        resp = self._delete(s.id)
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(AssessmentSet.objects.filter(pk=s.id).exists())

    def test_delete_assigned_set_returns_409(self):
        s = self._mk_set("Assigned set")
        classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.admin, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=s, assignment=assignment, assigned_by=self.admin,
        )
        resp = self._delete(s.id)
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertTrue(AssessmentSet.objects.filter(pk=s.id).exists())

    def test_force_delete_removes_assigned_set_with_attempts(self):
        from assessments.models import AssessmentAttempt, AssessmentAnswer
        s = self._mk_set("Force me")
        classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.admin, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        hw = HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=s, assignment=assignment,
            assigned_by=self.admin,
        )
        student = User.objects.create_user("force_student@test.com", "secret123")
        attempt = AssessmentAttempt.objects.create(homework=hw, student=student)
        AssessmentAnswer.objects.create(attempt=attempt, question_id=1, answer="B")

        # Without force: blocked.
        self.assertEqual(self._delete(s.id).status_code, 409)

        # With force: gone, along with homework + attempt + answers.
        resp = self.client.delete(f"/api/assessments/admin/sets/{s.id}/?force=true")
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(AssessmentSet.objects.filter(pk=s.id).exists())
        self.assertFalse(HomeworkAssignment.objects.filter(pk=hw.id).exists())
        self.assertFalse(AssessmentAttempt.objects.filter(pk=attempt.id).exists())
