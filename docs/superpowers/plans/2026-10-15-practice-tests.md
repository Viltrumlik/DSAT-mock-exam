# Practice Tests (PR 1: backend + web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "practice tests" into the centre's own single-section tests that run on the past-paper engine but have their own page, their own visibility rules (Open / Homework only, group level), a permanent number, a Timed/Untimed choice, homework support and certificates.

**Architecture:** A practice test is a standalone `exams.PracticeTest` row (`mock_exam` NULL), exactly like a past paper, flagged `is_practice_test=True`. Four new columns hold its rules, and `TestAttempt.is_timed` records the student's Timed/Untimed choice. One visibility rule (`exams/practice_tests.py`) serves the list, the detail page and attempt creation. Everything else — runner, scoring, review, question editor, homework grant/grade, certificate — is the past-paper code. The old "pack" system is detached by a data migration and deleted later (PR 3).

**Tech Stack:** Django 6.0.3 + DRF (backend), Next.js App Router + React + TypeScript + zod + vitest (frontend).

**Spec:** none — the owner's rule is "no spec, plan then code". The binding decisions are the chat design approved on 2026-10-14/15. They are restated in Global Constraints below, and memory note `practice-test-logic-2026-10.md` carries the history.

## Global Constraints

- A practice test is ONE section, R&W or Math, like a past paper ("practice test pastpaper kabi faqat bitta section bo'ladi").
- It is a separate product with the same engine: its own student page `/practice-tests`, its own builder page `/builder/practice-tests`. It is NEVER listed among past papers (student list, teacher past-paper picker, builder past-paper list, Windows app `pastpapers` block). The runner, scoring, review and question editor are the past-paper code ("practice test alohida tursin. pastpaper bilan ishlash engine bir xil bo'lsin").
- Visibility rule (student role only). The test must be `is_practice_test=True`, `mock_exam` NULL, AND one of:
  - (`is_published` AND `practice_access="open"` AND (`practice_level=""` OR `practice_level` ∈ levels of the student's ACTIVE memberships in ACTIVE classes));
  - OR the student is in `assigned_users` (given through homework or by an admin).
- Level match is EXACT (no lower levels). Blank level = all levels. A student whose groups have no level sees only blank-level tests.
- `public_student` sees no practice test. A public student may only GET their own FINISHED attempts (list, detail, `review`, `results`) — practice tests and past papers alike. Debt-frozen accounts stay fully locked (unchanged).
- Level codes: `foundation`, `junior`, `middle`, `senior` (identical to `classes.Classroom.level`).
- Access codes: `open`, `homework_only`. Model default `homework_only` (nothing leaks before the admin opens it).
- Number: assigned at FIRST publish, per subject (`max(number)+1` within that subject). It is permanent: unpublish keeps it. Display name `Practice Test {N}`; the admin's `title` is a subtitle.
- Timed/Untimed: the student picks it on the Welcome screen before Module 1 starts, in homework too. It applies ONLY to practice tests; past papers are always timed. An untimed attempt has no countdown, no time-based auto-submit and no Pause. The choice is fixed for that attempt; a retake asks again.
- Homework works exactly like past papers. Teachers pick practice tests in their own tab, filtered to the group's subject. The ids go into the SAME `practice_test_ids` field, so publishing grants `assigned_users`. The LATEST attempt finished after the homework was set counts. Late work earns a grade but no XP. Answers show right after finishing.
- Certificate: the past-paper certificate, one per finished attempt (200–800), titled `Practice Test {N}`, plus ` · Untimed` when untimed.
- New DB columns use `db_default` as well as `default`. The deploy is migrate-first while the OLD code is live, so the old code's INSERTs must not fail.
- Commits are authored by `Viltrumlik <viltrumlik@gmail.com>` (check `git config user.email`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend test command (no venv; pyenv `python3` has Django):
  `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <label> --settings=config.settings_test_nomigrations -v 1` — only a literal `OK` counts as green. Below, `<TEST>` stands for this whole command prefix.
- Frontend checks: `cd frontend && npx vitest run <path>`. Run `rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` and prove it with a deliberate probe error (a stale `.next/dev/types` gives a false green).
- The worktree is `/Users/macbook/Projects/dsat-wt-practice` on branch `feat/practice-tests` (off origin/main `fa0b1836`). Never work in the stale primary checkout. The frontend needs `node_modules`: symlink `frontend/node_modules` to the primary checkout's (`ln -s /Users/macbook/Projects/DSAT-mock-exam/frontend/node_modules frontend/node_modules`), as earlier worktrees did.

**Out of scope (later PRs):**
- PR 2: Windows app. `desktop/v1` home gets a `practice_tests` block and `open` gets a `timed` flag; Flutter screens in `desktop-native/`.
- PR 3: drop `PracticeTestPack`, the pack admin/student endpoints, `Assignment.practice_test_pack(_ids)` and their frontend remnants.

---

## File map

| File | Responsibility |
|---|---|
| `backend/exams/models.py` | new `PracticeTest` columns + constraint; `TestAttempt.is_timed` |
| `backend/exams/migrations/0055_practice_test_fields.py` | schema (db_default) |
| `backend/exams/migrations/0056_packs_to_practice_tests.py` | detach the pack sections into practice tests |
| `backend/exams/practice_tests.py` (new) | `live_group_levels`, `visible_practice_tests_q`, `assign_practice_number`, `practice_display_title` |
| `backend/exams/views.py` | student list/detail gate + `?kind=`; attempt create gate; `start` takes `timed`; review `is_timed`; admin `?kind=` + number on publish + delete guard; public read-only permissions |
| `backend/exams/attempt_timing.py` | untimed ⇒ no timing |
| `backend/exams/serializers.py` | new fields on student/admin/attempt serializers |
| `backend/access/host_guard.py` | GET-only allowlist for a public learner's own attempts |
| `backend/classes/views.py` | teacher picker: past papers exclude practice tests; new `practice_test_items` |
| `backend/classes/serializers.py` | homework launcher rows: `is_practice_test` + "Practice Test N" name |
| `backend/classes/views_results.py` | results rows: type "Practice Test" + `untimed` |
| `backend/classes/pastpaper_certificate.py` | certificate title |
| `backend/desktop/v1/home.py` | Windows `pastpapers` block excludes practice tests |
| `frontend/src/lib/api.ts` | section type fields; `getPracticeTestSections`; admin `kind`/`getSection` |
| `frontend/src/features/pastpapers/pastpaperLabels.ts` | `sectionTitle` names practice tests; `levelLabel` |
| `frontend/src/features/pastpapers/PaperLibrary.tsx` (new) | `Booklet`, `Segmented`, `ScoreBlock`, `HistoryLink`, empty/error + `usePaperLibrary` moved out of the past-papers page |
| `frontend/src/app/(main)/pastpapers/page.tsx` | uses `PaperLibrary` (behaviour unchanged) |
| `frontend/src/app/(main)/practice-tests/page.tsx` | rewritten: single-section practice tests |
| `frontend/src/app/(main)/practice-tests/[packId]/page.tsx` | redirect to `/practice-tests` |
| `frontend/src/features/testing-simulation/...` | Timed/Untimed on Welcome, untimed timer/header/pause |
| `frontend/src/app/review/[attemptId]/page.tsx` | "Untimed" label |
| `frontend/src/app/(builder)/builder/practice-tests/page.tsx` | rewritten: practice-test library builder |
| `frontend/src/app/(builder)/builder/practice-tests/[testId]/[moduleId]/page.tsx` (new) | re-export of the past-paper module editor |
| `frontend/src/app/(builder)/builder/pastpapers/...` | `kind=pastpaper`; module editor loads one section |
| `frontend/src/features/classroom/pages/AssignmentForm.tsx` | "Practice tests" tab replaces the hidden packs tab |
| `frontend/src/features/classroom/homeworkApi.ts` | launcher says "Open Practice Test" |
| `frontend/src/features/classroom/pages/Results.tsx` | Practice Test filter + Untimed chip |
| `frontend/src/lib/roles.ts`, profile page | public learner reaches `/review` + their scores |
| `frontend/src/features/dashboard/useDashboardData.ts` | fix the false "Untimed" copy |

---

### Task 1: Schema + data migration

**Files:**
- Modify: `backend/exams/models.py` (`PracticeTest` ~485-553, `TestAttempt` ~719-813)
- Create: `backend/exams/migrations/0055_practice_test_fields.py`
- Create: `backend/exams/migrations/0056_packs_to_practice_tests.py`
- Test: `backend/exams/tests/test_practice_test_migration.py`

**Interfaces:**
- Produces:
  - `PracticeTest.is_practice_test: bool`
  - `PracticeTest.practice_access: "open" | "homework_only"`
  - `PracticeTest.practice_level: str` (blank or a level code)
  - `PracticeTest.practice_number: int | None`
  - Constants `PracticeTest.ACCESS_OPEN`, `PracticeTest.ACCESS_HOMEWORK_ONLY`, `PracticeTest.LEVEL_CHOICES`
  - `TestAttempt.is_timed: bool`
  - Data-migration function `forwards(apps, schema_editor)` in module `exams.migrations.0056_packs_to_practice_tests`

- [ ] **Step 1: Add the model fields.** In `class PracticeTest`, directly after the `skip_default_modules` field, add:

```python
    # ── Practice tests (owner decisions 2026-10-14) ───────────────────────────
    # The centre's own tests. A practice test is a standalone section exactly like a past
    # paper (same runner, scoring, builder, review) but listed on its own page with its own
    # rules: who sees it (Open / Homework only), which group level, a permanent number.
    # Only meaningful when mock_exam is NULL.
    ACCESS_OPEN = "open"
    ACCESS_HOMEWORK_ONLY = "homework_only"
    ACCESS_CHOICES = [
        (ACCESS_OPEN, "Open"),
        (ACCESS_HOMEWORK_ONLY, "Homework only"),
    ]
    # Codes match classes.Classroom.level verbatim (exams cannot import classes — it imports us).
    LEVEL_CHOICES = [
        ("foundation", "Foundation"),
        ("junior", "Junior"),
        ("middle", "Middle"),
        ("senior", "Senior"),
    ]
    # db_default as well as default: the deploy migrates first while the old code still runs,
    # and the old code's INSERTs do not name these columns.
    is_practice_test = models.BooleanField(default=False, db_default=False, db_index=True)
    practice_access = models.CharField(
        max_length=16, choices=ACCESS_CHOICES,
        default=ACCESS_HOMEWORK_ONLY, db_default=ACCESS_HOMEWORK_ONLY,
    )
    practice_level = models.CharField(
        max_length=16, choices=LEVEL_CHOICES, blank=True, default="", db_default="",
    )
    # Given at first publish, per subject; never renumbered.
    practice_number = models.PositiveIntegerField(null=True, blank=True)
```

Replace `PracticeTest.Meta` with:

```python
    class Meta:
        db_table = 'practice_tests'
        constraints = [
            models.UniqueConstraint(
                fields=["subject", "practice_number"],
                condition=models.Q(is_practice_test=True, practice_number__isnull=False),
                name="uniq_practice_number_per_subject",
            ),
        ]
```

In `class TestAttempt`, directly after `score = models.IntegerField(null=True, blank=True)`, add:

```python
    # A practice-test student may choose to work without the clock (owner decision 2026-10-14).
    # False = no deadline, no time-based auto-submit, no pause. Past papers are always timed.
    is_timed = models.BooleanField(default=True, db_default=True)
```

- [ ] **Step 2: Write the schema migration.** `backend/exams/migrations/0055_practice_test_fields.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0054_mockexam_midterm_two_module_runtime"),
    ]

    operations = [
        migrations.AddField(
            model_name="practicetest",
            name="is_practice_test",
            field=models.BooleanField(db_default=False, db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_access",
            field=models.CharField(
                choices=[("open", "Open"), ("homework_only", "Homework only")],
                db_default="homework_only", default="homework_only", max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_level",
            field=models.CharField(
                blank=True,
                choices=[("foundation", "Foundation"), ("junior", "Junior"), ("middle", "Middle"), ("senior", "Senior")],
                db_default="", default="", max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_number",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="testattempt",
            name="is_timed",
            field=models.BooleanField(db_default=True, default=True),
        ),
        migrations.AddConstraint(
            model_name="practicetest",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_practice_test", True), ("practice_number__isnull", False)),
                fields=("subject", "practice_number"),
                name="uniq_practice_number_per_subject",
            ),
        ),
    ]
```

- [ ] **Step 3: Check that the models and migration agree.**

Run: `cd backend && SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations exams --check --dry-run`
Expected: `No changes detected in app 'exams'`. If it proposes changes, align the field arguments in 0055 with the model and repeat.

- [ ] **Step 4: Write the failing data-migration test.** `backend/exams/tests/test_practice_test_migration.py`:

```python
from importlib import import_module

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as acc_const
from exams.models import PracticeTest, PracticeTestPack
from exams.tests.support import seed_mc_questions_for_practice_test

forwards = import_module("exams.migrations.0056_packs_to_practice_tests").forwards
User = get_user_model()


class PacksToPracticeTestsMigrationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="mig_admin@example.com", password="pw", role=acc_const.ROLE_SUPER_ADMIN)

    def _pack(self, title, *, published, math_questions=True):
        pack = PracticeTestPack.objects.create(
            title=title, created_by=self.admin, is_published=published,
            published_at=timezone.now() if published else None,
        )
        rw = PracticeTest.objects.create(practice_test_pack=pack, subject="READING_WRITING", title=f"{title} - Reading & Writing")
        math = PracticeTest.objects.create(practice_test_pack=pack, subject="MATH", title=f"{title} - Math")
        if math_questions:
            seed_mc_questions_for_practice_test(math)
        return rw, math

    def test_published_pack_sections_with_questions_become_numbered_open_practice_tests(self):
        rw1, math1 = self._pack("Pack 1", published=True)
        rw2, math2 = self._pack("Pack 2", published=True)

        forwards(django_apps, None)

        for pt in (rw1, math1, rw2, math2):
            pt.refresh_from_db()
            self.assertTrue(pt.is_practice_test)
            self.assertIsNone(pt.practice_test_pack_id)
            self.assertEqual(pt.practice_level, "")
        self.assertEqual((math1.practice_number, math2.practice_number), (1, 2))
        self.assertTrue(math1.is_published and math2.is_published)
        self.assertEqual(math1.practice_access, PracticeTest.ACCESS_OPEN)
        # Empty R&W sections become unpublished, unnumbered drafts — nothing is deleted.
        for rw in (rw1, rw2):
            self.assertFalse(rw.is_published)
            self.assertIsNone(rw.practice_number)
            self.assertEqual(rw.practice_access, PracticeTest.ACCESS_HOMEWORK_ONLY)

    def test_unpublished_pack_sections_stay_unpublished_drafts(self):
        rw, math = self._pack("Draft pack", published=False)
        forwards(django_apps, None)
        math.refresh_from_db()
        self.assertTrue(math.is_practice_test)
        self.assertFalse(math.is_published)
        self.assertIsNone(math.practice_number)

    def test_running_twice_changes_nothing(self):
        self._pack("Pack 1", published=True)
        forwards(django_apps, None)
        before = list(PracticeTest.objects.order_by("id").values_list("id", "practice_number", "is_published"))
        forwards(django_apps, None)
        after = list(PracticeTest.objects.order_by("id").values_list("id", "practice_number", "is_published"))
        self.assertEqual(before, after)

    def test_past_papers_are_untouched(self):
        pp = PracticeTest.objects.create(subject="MATH", title="Past paper", is_published=True)
        forwards(django_apps, None)
        pp.refresh_from_db()
        self.assertFalse(pp.is_practice_test)
        self.assertIsNone(pp.practice_number)
```

- [ ] **Step 5: Run it to verify it fails.**

Run: `<TEST> exams.tests.test_practice_test_migration`
Expected: ERROR, `ModuleNotFoundError: No module named 'exams.migrations.0056_packs_to_practice_tests'`.

- [ ] **Step 6: Write the data migration.** `backend/exams/migrations/0056_packs_to_practice_tests.py`:

```python
"""Detach every practice-test-pack section into a standalone practice test (owner 2026-10-15:
"practice test pastpaper kabi faqat bitta section bo'ladi").

A section that has questions and whose pack was published goes live as an Open, all-levels
practice test with the next number for its subject (packs in creation order). Everything else
becomes an unpublished draft. Nothing is deleted; the empty pack rows go in PR 3.
"""
from django.db import migrations
from django.db.models import Max
from django.utils import timezone


def forwards(apps, schema_editor):
    PracticeTestPack = apps.get_model("exams", "PracticeTestPack")
    PracticeTest = apps.get_model("exams", "PracticeTest")
    Question = apps.get_model("exams", "Question")

    next_number = {}
    for subject in ("READING_WRITING", "MATH"):
        top = (
            PracticeTest.objects.filter(is_practice_test=True, subject=subject)
            .aggregate(m=Max("practice_number"))["m"]
        )
        next_number[subject] = (top or 0) + 1

    now = timezone.now()
    for pack in PracticeTestPack.objects.order_by("created_at", "id"):
        for section in PracticeTest.objects.filter(practice_test_pack_id=pack.pk).order_by("subject", "id"):
            has_questions = Question.objects.filter(module__practice_test_id=section.pk).exists()
            live = bool(pack.is_published and has_questions)
            section.is_practice_test = True
            section.practice_test_pack_id = None
            section.practice_level = ""
            if live:
                section.practice_access = "open"
                section.is_published = True
                section.published_at = section.published_at or pack.published_at or now
                section.practice_number = next_number[section.subject]
                next_number[section.subject] += 1
            else:
                section.practice_access = "homework_only"
                section.is_published = False
            section.save(update_fields=[
                "is_practice_test", "practice_test_pack", "practice_level", "practice_access",
                "is_published", "published_at", "practice_number",
            ])


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0055_practice_test_fields"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
```

- [ ] **Step 7: Run the test to verify it passes.** Run the Step 5 command. Expected: `OK` (4 tests).

- [ ] **Step 8: Commit.**

```bash
git add backend/exams/models.py backend/exams/migrations/0055_practice_test_fields.py backend/exams/migrations/0056_packs_to_practice_tests.py backend/exams/tests/test_practice_test_migration.py
git commit -m "feat(practice-tests): practice tests become single sections with access, level, number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The visibility rule and numbering

**Files:**
- Create: `backend/exams/practice_tests.py`
- Test: `backend/exams/tests/test_practice_tests_rules.py`

**Interfaces:**
- Consumes: Task 1 fields.
- Produces:
  - `live_group_levels(user) -> set[str]`
  - `visible_practice_tests_q(user) -> django.db.models.Q`
  - `assign_practice_number(section: PracticeTest) -> None` (no-op if not a practice test or already numbered)
  - `practice_display_title(section) -> str`

- [ ] **Step 1: Write the failing tests.** `backend/exams/tests/test_practice_tests_rules.py`:

```python
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
        self.teacher = User.objects.create_user(email="ptr_teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER)
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

    def test_assign_number_ignores_past_papers(self):
        pp = self._pt(practice=False)
        assign_practice_number(pp)
        self.assertIsNone(pp.practice_number)

    def test_display_title(self):
        pt = self._pt()
        self.assertEqual(practice_display_title(pt), "T")
        assign_practice_number(pt)
        self.assertEqual(practice_display_title(pt), "Practice Test 1")
```

- [ ] **Step 2: Run to verify failure.**

Run: `<TEST> exams.tests.test_practice_tests_rules`
Expected: ERROR `ModuleNotFoundError: No module named 'exams.practice_tests'`.

- [ ] **Step 3: Implement** `backend/exams/practice_tests.py`:

```python
"""Practice tests: the centre's own standalone sections (owner decisions 2026-10-14/15).

ONE visibility rule serves the student list, the detail page and attempt creation, so a
student can never see a practice test they cannot start (the old packs did exactly that:
listed to everyone, 404 on Start).
"""
from __future__ import annotations

from django.db import transaction
from django.db.models import Max, Q

from access import constants as acc_const
from core.authz import normalized_role

from .models import PracticeTest


def live_group_levels(user) -> set[str]:
    """Levels of the classes the user studies in right now (ACTIVE member of an ACTIVE class)."""
    from classes.models import ClassroomMembership  # classes imports exams

    if not getattr(user, "is_authenticated", False):
        return set()
    levels = ClassroomMembership.objects.filter(
        user=user,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
        classroom__is_active=True,
    ).values_list("classroom__level", flat=True)
    return {lvl for lvl in levels if lvl}


def visible_practice_tests_q(user) -> Q:
    """Practice tests this learner may see and start.

    Open + published + level blank or one of the learner's group levels (exact match), OR given
    to the learner through homework / an admin (``assigned_users``). A public learner gets nothing.
    """
    if not getattr(user, "is_authenticated", False) or normalized_role(user) == acc_const.ROLE_PUBLIC_STUDENT:
        return Q(pk__in=[])
    levels = live_group_levels(user)
    level_ok = Q(practice_level="") | Q(practice_level__in=levels)
    open_to_learner = Q(is_published=True, practice_access=PracticeTest.ACCESS_OPEN) & level_ok
    given = Q(assigned_users=user)
    return Q(is_practice_test=True, mock_exam__isnull=True) & (open_to_learner | given)


def assign_practice_number(section: PracticeTest) -> None:
    """Give a practice test its permanent number (next free in its subject). Idempotent."""
    if not section.is_practice_test or section.practice_number is not None:
        return
    with transaction.atomic():
        # Lock the subject's practice tests so two first-publishes can't take the same number;
        # the partial unique constraint is the backstop.
        list(
            PracticeTest.objects.select_for_update()
            .filter(is_practice_test=True, subject=section.subject)
            .values_list("pk", flat=True)
        )
        top = (
            PracticeTest.objects.filter(is_practice_test=True, subject=section.subject)
            .aggregate(m=Max("practice_number"))["m"]
        )
        section.practice_number = (top or 0) + 1
        section.save(update_fields=["practice_number", "updated_at"])


def practice_display_title(section) -> str:
    """'Practice Test N' for a numbered practice test, else the section's own title."""
    if getattr(section, "is_practice_test", False) and getattr(section, "practice_number", None):
        return f"Practice Test {section.practice_number}"
    return (getattr(section, "title", "") or "").strip()
```

- [ ] **Step 4: Run to verify it passes.** Same command. Expected: `OK` (10 tests).

- [ ] **Step 5: Commit.**

```bash
git add backend/exams/practice_tests.py backend/exams/tests/test_practice_tests_rules.py
git commit -m "feat(practice-tests): one visibility rule (open+level or given) and per-subject numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Student endpoints use the rule

**Files:**
- Modify: `backend/exams/views.py` — `PracticeTestViewSet.get_queryset` (~543-568), `TestAttemptViewSet._student_startable_practice_tests` (~811-832)
- Modify: `backend/exams/serializers.py` — `PracticeTestSerializer.Meta` (~194-209)
- Test: `backend/exams/tests/test_practice_tests_student_api.py`

**Interfaces:**
- Consumes: `visible_practice_tests_q` (Task 2).
- Produces:
  - `GET /api/exams/` returns past papers only; `GET /api/exams/?kind=practice_test` returns practice tests only; `GET /api/exams/<id>/` returns either.
  - Rows carry `is_practice_test`, `practice_access`, `practice_level`, `practice_number`.
  - `POST /api/exams/attempts/ {practice_test}` is allowed for a visible practice test.

- [ ] **Step 1: Write the failing tests.** `backend/exams/tests/test_practice_tests_student_api.py`:

```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


def _rows(body):
    return body["results"] if isinstance(body, dict) else body


class PracticeTestStudentApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(email="pts_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.client.force_authenticate(self.student)

    def _section(self, *, practice, access=PracticeTest.ACCESS_OPEN, published=True, number=None):
        pt = PracticeTest.objects.create(
            subject="MATH", title="S", is_practice_test=practice, practice_access=access,
            is_published=published, practice_number=number,
        )
        seed_mc_questions_for_practice_test(pt)
        return pt

    def _ids(self, url):
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200, r.content)
        return {row["id"] for row in _rows(r.json())}

    def test_default_list_is_past_papers_only(self):
        pp = self._section(practice=False)
        pp.assigned_users.add(self.student)
        pt = self._section(practice=True, number=1)
        self.assertEqual(self._ids("/api/exams/"), {pp.id})
        self.assertEqual(self._ids("/api/exams/?kind=practice_test"), {pt.id})

    def test_practice_rows_carry_the_new_fields(self):
        self._section(practice=True, number=3)
        row = _rows(self.client.get("/api/exams/?kind=practice_test").json())[0]
        self.assertEqual(row["practice_number"], 3)
        self.assertTrue(row["is_practice_test"])
        self.assertEqual(row["practice_access"], "open")
        self.assertEqual(row["practice_level"], "")

    def test_hidden_practice_test_is_404_on_detail_and_on_start(self):
        hidden = self._section(practice=True, access=PracticeTest.ACCESS_HOMEWORK_ONLY)
        self.assertEqual(self.client.get(f"/api/exams/{hidden.id}/").status_code, 404)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": hidden.id}, format="json").status_code, 404)

    def test_visible_practice_test_can_be_opened_and_started(self):
        pt = self._section(practice=True, number=1)
        self.assertEqual(self.client.get(f"/api/exams/{pt.id}/").status_code, 200)
        r = self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_given_homework_only_test_can_be_started(self):
        pt = self._section(practice=True, access=PracticeTest.ACCESS_HOMEWORK_ONLY)
        pt.assigned_users.add(self.student)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json").status_code, 201)

    def test_unassigned_past_paper_still_cannot_be_started(self):
        pp = self._section(practice=False)
        self.assertEqual(self.client.post("/api/exams/attempts/", {"practice_test": pp.id}, format="json").status_code, 404)
```

- [ ] **Step 2: Run to verify failure.**

Run: `<TEST> exams.tests.test_practice_tests_student_api`
Expected: FAIL. The `?kind=` list returns nothing, and the visible practice test is 404.

- [ ] **Step 3: Implement.**

In `backend/exams/views.py`, add `from .practice_tests import assign_practice_number, visible_practice_tests_q` next to the other `exams` imports (Task 5 uses `assign_practice_number`). Make sure `Q` is imported at module level: `from django.db.models import Q`.

Replace the body of `PracticeTestViewSet.get_queryset`. Keep its docstring and append this sentence to it: "Practice tests follow ``visible_practice_tests_q``; the list returns ONE kind: past papers by default, practice tests with ``?kind=practice_test``." The new body:

```python
        user = self.request.user
        # Student practice library must never surface empty tests (no questions); the exam runner
        # requires a non-empty `current_module_details.questions` payload.
        base = (
            PracticeTest.objects.filter(mock_exam__isnull=True, modules__questions__isnull=False)
            .select_related("mock_exam")
            .prefetch_related("modules")
            .distinct()
        )
        if can_browse_standalone_practice_library(user):
            qs = filter_practice_tests_for_user(user, base).distinct()
        elif not user.is_authenticated or normalized_role(user) == acc_const.ROLE_PUBLIC_STUDENT:
            # Unauthenticated / public learners: nothing (assignment or centre membership required).
            return base.none()
        else:
            # A pastpaper ONLY when it has been explicitly assigned (publishing alone must not
            # expose a section — every assignment path writes ``assigned_users``); a practice
            # test by its own rule (open + level, or given).
            qs = base.filter(
                Q(is_practice_test=False, assigned_users=user) | visible_practice_tests_q(user)
            ).distinct()
        if getattr(self, "action", None) == "list":
            # The two libraries are separate pages: one kind per list.
            wants_practice = self.request.query_params.get("kind") == "practice_test"
            qs = qs.filter(is_practice_test=wants_practice)
        return qs
```

In `TestAttemptViewSet._student_startable_practice_tests`, replace

```python
        cond = Q(mock_exam__isnull=True, assigned_users=user)
```

with

```python
        cond = Q(mock_exam__isnull=True, is_practice_test=False, assigned_users=user) | visible_practice_tests_q(user)
```

Then add the line "(c) practice tests the student may see (``visible_practice_tests_q``)." to its docstring list.

In `backend/exams/serializers.py` `PracticeTestSerializer.Meta`, add `"is_practice_test", "practice_access", "practice_level", "practice_number"` to `fields` (after `"mock_exam_id"`) and to `read_only_fields`.

- [ ] **Step 4: Run to verify it passes.** Expected: `OK` (6 tests).

- [ ] **Step 5: Regressions in the library gate.**

Run: `<TEST> exams.tests.test_pastpaper_system_hardening exams.tests.test_bulk_assign_route_permissions exams.tests_retake_gate`
Expected: `OK`.

- [ ] **Step 6: Commit.**

```bash
git add backend/exams/views.py backend/exams/serializers.py backend/exams/tests/test_practice_tests_student_api.py
git commit -m "feat(practice-tests): students list, open and start practice tests by the one rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Timed / Untimed on the server

**Files:**
- Modify: `backend/exams/attempt_timing.py` (`get_active_module_timing`)
- Modify: `backend/exams/serializers.py`:
  - `AttemptPracticeTestDetailsSerializer` (~168-184)
  - `TestAttemptSerializer.get_module_duration_seconds` (~307), `get_practice_test_details` (~474-502), `Meta` (~504-554)
- Modify: `backend/exams/views.py` — `TestAttemptViewSet.start` (~1105-1152), the `review` response dict (the one holding `'score_percentage'`, ~1610-1627)
- Test: `backend/exams/tests/test_practice_tests_untimed.py`

**Interfaces:**
- Consumes: `TestAttempt.is_timed`, `PracticeTest.is_practice_test`.
- Produces:
  - `POST /api/exams/attempts/<id>/start/ {"timed": false}` makes a NOT_STARTED practice-test attempt untimed. It is ignored for past papers and for attempts already started.
  - Attempt payloads carry `is_timed` and `practice_test_details.is_practice_test` / `.practice_number`.
  - The review payload carries `is_timed`.

- [ ] **Step 1: Write the failing tests.** `backend/exams/tests/test_practice_tests_untimed.py`:

```python
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.attempt_timing import get_active_module_timing
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


class UntimedPracticeTestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(email="unt_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.client.force_authenticate(self.student)

    def _create_attempt(self, *, practice):
        pt = PracticeTest.objects.create(
            subject="MATH", title="S", is_practice_test=practice, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=1 if practice else None,
        )
        seed_mc_questions_for_practice_test(pt)
        if not practice:
            pt.assigned_users.add(self.student)
        r = self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def test_untimed_start_records_choice_and_drops_the_clock(self):
        aid = self._create_attempt(practice=True)
        r = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertFalse(body["is_timed"])
        self.assertIsNone(body["remaining_seconds"])
        self.assertIsNone(body["module_duration_seconds"])
        self.assertTrue(body["can_submit"])
        self.assertTrue(body["practice_test_details"]["is_practice_test"])
        self.assertEqual(body["practice_test_details"]["practice_number"], 1)

    def test_untimed_attempt_never_expires(self):
        aid = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        TestAttempt.objects.filter(pk=aid).update(module_1_started_at=timezone.now() - timedelta(hours=5))
        attempt = TestAttempt.objects.select_related("current_module").get(pk=aid)
        self.assertIsNone(get_active_module_timing(attempt))

    def test_default_start_stays_timed(self):
        aid = self._create_attempt(practice=True)
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {}, format="json").json()
        self.assertTrue(body["is_timed"])
        self.assertIsNotNone(body["remaining_seconds"])

    def test_past_papers_ignore_the_untimed_request(self):
        aid = self._create_attempt(practice=False)
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json").json()
        self.assertTrue(body["is_timed"])

    def test_choice_cannot_change_after_the_start(self):
        aid = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {}, format="json", HTTP_IDEMPOTENCY_KEY="k1")
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json", HTTP_IDEMPOTENCY_KEY="k2").json()
        self.assertTrue(body["is_timed"])
```

Before running, read `backend/exams/idempotency.py`. If the header `consume_idempotency` reads is not `Idempotency-Key`, change `HTTP_IDEMPOTENCY_KEY` in the last test to the real one. That test needs two DIFFERENT keys so the second call is not served from the first one's cache.

- [ ] **Step 2: Run to verify failure.**

Run: `<TEST> exams.tests.test_practice_tests_untimed`
Expected: FAIL / `KeyError: 'is_timed'`.

- [ ] **Step 3: Implement.**

`backend/exams/attempt_timing.py`: at the top of `get_active_module_timing`'s body (before `mod: Module | None = ...`), add:

```python
    if not getattr(attempt, "is_timed", True):
        # An untimed practice-test sitting has no deadline: nothing expires, nothing auto-submits.
        return None
```

Then audit the callers. Run `grep -rn "get_active_module_timing" backend --include='*.py'`. Every caller must handle `None` (`if timing and …` / `… if timing else None`). Guard any caller that dereferences without a check, including `desktop/v1/snapshots.py`.

`backend/exams/serializers.py`:
1. Add the following to `AttemptPracticeTestDetailsSerializer`:

```python
    is_practice_test = serializers.BooleanField(required=False)
    practice_number = serializers.IntegerField(allow_null=True, required=False)
```

2. Add this at the top of `TestAttemptSerializer.get_module_duration_seconds`'s body:

```python
        if not getattr(obj, "is_timed", True):
            return None
```

3. Add these entries to the dict returned by `get_practice_test_details`:

```python
            "is_practice_test": bool(getattr(pt, "is_practice_test", False)),
            "practice_number": getattr(pt, "practice_number", None),
```

4. Add `'is_timed'` to `Meta.fields` (after `'is_paused'`) and to `read_only_fields`.

`backend/exams/views.py`, `TestAttemptViewSet.start`. Directly after `attempt = self.get_object()`, add:

```python
        # Timed/Untimed is the student's choice on the Welcome screen — practice tests only, and
        # only before Module 1 starts (owner decision 2026-10-14). Past papers are always timed.
        raw_timed = request.data.get("timed", True) if hasattr(request, "data") else True
        wants_untimed = raw_timed in (False, "false", "False", "0", 0)
```

Inside `_compute`, insert the following between `locked.refresh_from_db()` and the `if pre_state != TestAttempt.STATE_SCORING …` line right after it:

```python
                    if (
                        wants_untimed
                        and locked.current_state == TestAttempt.STATE_NOT_STARTED
                        and locked.is_timed
                        and locked.practice_test.is_practice_test
                    ):
                        locked.is_timed = False
                        locked.save(update_fields=["is_timed", "updated_at"])
```

In the `review` action's response dict (the one with `'score_percentage'`), add `'is_timed': <attempt variable>.is_timed,`, using the name the action binds for the attempt.

- [ ] **Step 4: Run to verify it passes.** Expected: `OK` (5 tests).

- [ ] **Step 5: Regression run of the attempt engine.**

Run: `<TEST> exams`
Expected: `OK`. If a failure also fails on a clean `origin/main` worktree, note it as pre-existing and leave it.

- [ ] **Step 6: Commit.**

```bash
git add backend/exams/attempt_timing.py backend/exams/serializers.py backend/exams/views.py backend/exams/tests/test_practice_tests_untimed.py
git commit -m "feat(practice-tests): Timed or Untimed, chosen at Start — untimed never expires

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Builder API for practice tests

**Files:**
- Modify: `backend/exams/views.py` — `AdminPracticeTestViewSet.get_queryset` (~2109-2119), `publish` (~2122-2139), add `destroy`
- Modify: `backend/exams/serializers.py` — `AdminPracticeTestSerializer` (~828-877)
- Test: `backend/exams/tests/test_practice_tests_builder_api.py`

**Interfaces:**
- Consumes: `assign_practice_number` (Task 2).
- Produces:
  - `GET /api/exams/admin/tests/?standalone=1&kind=practice_test|pastpaper`
  - Admin rows carry `is_practice_test` (settable on create only), `practice_access`, `practice_level`, `practice_number` (read-only).
  - Publish numbers a practice test.
  - Delete of an attempted section is refused (400).

- [ ] **Step 1: Write the failing tests.** `backend/exams/tests/test_practice_tests_builder_api.py`:

```python
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()
_HOSTS = ["testserver", "questions.mastersat.uz"]
_Q = {"HTTP_HOST": "questions.mastersat.uz"}


def _rows(body):
    return body["results"] if isinstance(body, dict) else body


@override_settings(ALLOWED_HOSTS=_HOSTS)
class PracticeTestBuilderApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="ptb_admin@example.com", password="pw", role=acc_const.ROLE_ADMIN)
        self.client.force_authenticate(self.admin)

    def _create(self, **extra):
        r = self.client.post("/api/exams/admin/tests/", {"subject": "MATH", "title": "Algebra focus", **extra}, format="json", **_Q)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_create_practice_test_with_access_and_level(self):
        row = self._create(is_practice_test=True, practice_access="open", practice_level="middle")
        self.assertTrue(row["is_practice_test"])
        self.assertEqual((row["practice_access"], row["practice_level"], row["practice_number"]), ("open", "middle", None))

    def test_bad_level_is_rejected(self):
        r = self.client.post("/api/exams/admin/tests/", {"subject": "MATH", "is_practice_test": True, "practice_level": "expert"}, format="json", **_Q)
        self.assertEqual(r.status_code, 400)

    def test_kind_filter_splits_the_two_libraries(self):
        pt = self._create(is_practice_test=True)
        pp = self._create()

        def ids(kind):
            return {x["id"] for x in _rows(self.client.get(f"/api/exams/admin/tests/?standalone=1&kind={kind}", **_Q).json())}

        self.assertEqual(ids("practice_test") & {pt["id"], pp["id"]}, {pt["id"]})
        self.assertEqual(ids("pastpaper") & {pt["id"], pp["id"]}, {pp["id"]})

    def test_publish_numbers_once(self):
        row = self._create(is_practice_test=True)
        seed_mc_questions_for_practice_test(PracticeTest.objects.get(pk=row["id"]))
        first = self.client.post(f"/api/exams/admin/tests/{row['id']}/publish/", **_Q).json()
        self.assertEqual(first["practice_number"], 1)
        self.client.post(f"/api/exams/admin/tests/{row['id']}/unpublish/", **_Q)
        again = self.client.post(f"/api/exams/admin/tests/{row['id']}/publish/", **_Q).json()
        self.assertEqual(again["practice_number"], 1)

    def test_kind_cannot_change_after_create(self):
        row = self._create(is_practice_test=True)
        r = self.client.patch(f"/api/exams/admin/tests/{row['id']}/", {"is_practice_test": False}, format="json", **_Q)
        self.assertEqual(r.status_code, 400)

    def test_attempted_section_cannot_be_deleted(self):
        row = self._create(is_practice_test=True)
        student = User.objects.create_user(email="ptb_st@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        TestAttempt.objects.create(student=student, practice_test_id=row["id"])
        r = self.client.delete(f"/api/exams/admin/tests/{row['id']}/", **_Q)
        self.assertEqual(r.status_code, 400)
        self.assertTrue(PracticeTest.objects.filter(pk=row["id"]).exists())
```

- [ ] **Step 2: Run to verify failure.**

Run: `<TEST> exams.tests.test_practice_tests_builder_api`
Expected: FAIL (no `is_practice_test` key).

- [ ] **Step 3: Implement.**

`AdminPracticeTestSerializer`: add `"is_practice_test", "practice_access", "practice_level", "practice_number"` to `Meta.fields`, and `"practice_number"` to `read_only_fields`. Then add:

```python
    def validate_is_practice_test(self, value):
        # The kind is fixed at creation: a past paper never turns into a practice test or back
        # (their lists, numbering and visibility rules differ).
        if self.instance is not None and bool(value) != bool(self.instance.is_practice_test):
            raise serializers.ValidationError("A section's kind cannot change after it is created.")
        return value
```

`AdminPracticeTestViewSet.get_queryset`: replace the `standalone` block with:

```python
        standalone = self.request.query_params.get("standalone")
        if standalone in ("1", "true", "yes"):
            base = base.filter(mock_exam__isnull=True)
            kind = self.request.query_params.get("kind")
            if kind == "practice_test":
                base = base.filter(is_practice_test=True)
            elif kind == "pastpaper":
                base = base.filter(is_practice_test=False)
        return base
```

`AdminPracticeTestViewSet.publish`: add the following just before `return Response(...)`:

```python
        assign_practice_number(section)  # first publish of a practice test gives its number
```

Add this method to `AdminPracticeTestViewSet` (the pack rule it replaces lived on the pack viewset):

```python
    def destroy(self, request, *args, **kwargs):
        section = self.get_object()
        if TestAttempt.objects.filter(practice_test=section).exists():
            return Response(
                {"detail": "Cannot delete: students have attempts on this section. Unpublish it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)
```

- [ ] **Step 4: Run to verify it passes.** Expected: `OK` (6 tests). Then run `<TEST> exams.tests.test_pastpaper_system_hardening exams.tests.test_pastpapers_admin_main_domain` → `OK`.

- [ ] **Step 5: Commit.**

```bash
git add backend/exams/views.py backend/exams/serializers.py backend/exams/tests/test_practice_tests_builder_api.py
git commit -m "feat(practice-tests): builder API — kind filter, access/level, number on first publish

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Homework, results, certificate, Windows list

**Files:**
- Modify: `backend/classes/views.py` — `assignment_options` (~1155-1300: `pt_qs`, the `practice_tests` loop and the final `Response`)
- Modify: `backend/classes/serializers.py` — `_section_name`, `get_practice_bundle_tests` (~745-772), `AssignmentPracticeBundleTestSerializer`
- Modify: `backend/classes/views_results.py` (~170-190)
- Modify: `backend/classes/pastpaper_certificate.py` — `_paper_title` (~97-108) and its call (~153)
- Modify: `backend/desktop/v1/home.py` — `pastpaper_rows` (~85-90)
- Test: `backend/classes/tests_practice_test_homework.py`

**Interfaces:**
- Consumes: Task 1 fields.
- Produces:
  - The assignment-options payload key `practice_test_items: [{id, number, title, subject, level, access, already_assigned}]`. `practice_tests` no longer contains practice tests.
  - Launcher rows carry `is_practice_test`, and `name` = "Practice Test N".
  - Results rows carry `type` "Practice Test" and `untimed`.
  - `_paper_title(practice_test, attempt=None)` returns "Practice Test N" (+ " · Untimed").

- [ ] **Step 1: Find the real names the test needs.**
  - `grep -n "assignment.options\|assignment_options" backend/classes/urls.py backend/classes/views.py` gives the URL of the teacher picker.
  - Read `backend/desktop/v1/home.py` ~100-195 to get the key each `pastpaper_rows` row uses for the section id.

- [ ] **Step 2: Write the failing tests.** `backend/classes/tests_practice_test_homework.py`. Replace `OPTIONS_URL` with the real path from Step 1, and `row["id"]` with the real key if it differs:

```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Classroom, ClassroomMembership
from classes.pastpaper_certificate import _paper_title
from desktop.v1.home import pastpaper_rows
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()
OPTIONS_URL = "/api/classes/{id}/assignment-options/"


class PracticeTestHomeworkTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(email="pth_teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER)
        self.student = User.objects.create_user(email="pth_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.room = Classroom.objects.create(
            name="Math", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.create(classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        self.practice = PracticeTest.objects.create(
            subject="MATH", title="Algebra focus", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_HOMEWORK_ONLY, practice_level="middle", practice_number=4,
        )
        seed_mc_questions_for_practice_test(self.practice)
        self.pastpaper = PracticeTest.objects.create(subject="MATH", title="Oct 2025", is_published=True)
        seed_mc_questions_for_practice_test(self.pastpaper)

    def test_picker_splits_past_papers_and_practice_tests(self):
        self.client.force_authenticate(self.teacher)
        r = self.client.get(OPTIONS_URL.format(id=self.room.id))
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertNotIn(self.practice.id, {x["id"] for x in body["practice_tests"]})
        items = {x["id"]: x for x in body["practice_test_items"]}
        self.assertEqual(items[self.practice.id]["number"], 4)
        self.assertEqual(items[self.practice.id]["level"], "middle")
        self.assertEqual(items[self.practice.id]["access"], "homework_only")

    def test_certificate_title(self):
        attempt = TestAttempt(practice_test=self.practice, student=self.student, is_timed=False)
        self.assertEqual(_paper_title(self.practice, attempt), "Practice Test 4 · Untimed")
        attempt.is_timed = True
        self.assertEqual(_paper_title(self.practice, attempt), "Practice Test 4")

    def test_windows_pastpaper_list_excludes_practice_tests(self):
        self.practice.assigned_users.add(self.student)
        self.pastpaper.assigned_users.add(self.student)
        ids = {row["id"] for row in pastpaper_rows(self.student)}
        self.assertIn(self.pastpaper.id, ids)
        self.assertNotIn(self.practice.id, ids)
```

- [ ] **Step 3: Run to verify failure.**

Run: `<TEST> classes.tests_practice_test_homework`
Expected: FAIL (`KeyError: 'practice_test_items'`, a TypeError on `_paper_title` with 2 args, the practice test present in `pastpaper_rows`).

- [ ] **Step 4: Implement.**

`classes/views.py` `assignment_options`: change `pt_qs = pvs.get_queryset()` to

```python
        pt_qs = pvs.get_queryset().filter(is_practice_test=False)  # practice tests have their own tab
```

After the `practice_tests` loop, add the following. Use a local `from exams.models import PracticeTest` beside the function's other local imports.

```python
        # Practice tests (the centre's own; owner decisions 2026-10-14): every published one of the
        # class's subject — Open AND Homework only — with its number and level. Picking one writes
        # practice_test_ids exactly like a past paper, so grant/grade/launcher are shared.
        practice_test_items = []
        pti_qs = (
            PracticeTest.objects.filter(
                is_practice_test=True, is_published=True, mock_exam__isnull=True,
                modules__questions__isnull=False,
            )
            .distinct()
            .order_by("-practice_number", "-id")
        )
        if platform_subject:
            pti_qs = pti_qs.filter(subject=platform_subject)
        for pt in pti_qs:
            practice_test_items.append({
                "id": pt.id,
                "number": pt.practice_number,
                "title": (pt.title or "").strip(),
                "subject": pt.subject,
                "level": pt.practice_level or "",
                "access": pt.practice_access,
                "already_assigned": pt.id in assigned_pt_ids,
            })
```

Add `"practice_test_items": practice_test_items,` to the final `Response({...})` dict next to `"practice_test_packs"`.

`classes/serializers.py`:
- At the top of `_section_name(self, p)`, add:

```python
        if getattr(p, "is_practice_test", False) and getattr(p, "practice_number", None):
            return f"Practice Test {p.practice_number}"
```

- Add `"is_practice_test": bool(getattr(p, "is_practice_test", False)),` to each dict in `get_practice_bundle_tests`.
- Add `is_practice_test = serializers.BooleanField(required=False)` to `AssignmentPracticeBundleTestSerializer`.

`classes/views_results.py`:
- Widen the filter guard: `if f_type in ("all", "past paper", "pastpaper", "past_paper", "practice test", "practice_test"):`.
- Change `.select_related("assignment", "review")` to `.select_related("assignment", "review", "attempt__practice_test")`.
- In the row dict, replace `"type": "Past Paper",` with:

```python
                    "type": "Practice Test" if (s.attempt_id and s.attempt.practice_test.is_practice_test) else "Past Paper",
                    "untimed": bool(s.attempt_id and not s.attempt.is_timed),
```

`classes/pastpaper_certificate.py`:
- Change the signature to `def _paper_title(practice_test, attempt=None) -> str:` and add at the top of its body:

```python
    if getattr(practice_test, "is_practice_test", False) and getattr(practice_test, "practice_number", None):
        name = f"Practice Test {practice_test.practice_number}"
        return f"{name} · Untimed" if attempt is not None and not getattr(attempt, "is_timed", True) else name
```

- At the call site (~153), pass the attempt the enclosing function holds: `"paper_title": _paper_title(practice_test, <attempt variable>),`.

`desktop/v1/home.py` `pastpaper_rows`: add `is_practice_test=False` to the `PracticeTest.objects.filter(...)` call. Practice tests reach the Windows app in PR 2.

- [ ] **Step 5: Run to verify it passes.** Expected: `OK` (3 tests).

- [ ] **Step 6: Regression run.**

Run: `<TEST> classes.tests_practice_homework_unpublished classes.tests_homework_autograde classes.tests_pastpaper_certificate classes.tests_assignment_options_filter desktop`
Expected: `OK`.

- [ ] **Step 7: Commit.**

```bash
git add backend/classes/views.py backend/classes/serializers.py backend/classes/views_results.py backend/classes/pastpaper_certificate.py backend/desktop/v1/home.py backend/classes/tests_practice_test_homework.py
git commit -m "feat(practice-tests): homework picker data, launcher names, results, certificate title

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A public learner reads their own finished results

**Files:**
- Modify: `backend/access/host_guard.py` — `public_student_may` and its call (~43-49, ~165)
- Modify: `backend/exams/views.py` — `TestAttemptViewSet` (`get_permissions`, `get_queryset` ~716-728)
- Modify: `backend/users/tests/test_public_student_surfaces.py`
- Test: `backend/exams/tests/test_public_student_results.py`

**Interfaces:**
- Produces: `public_student_may(path: str, method: str = "GET") -> bool`.
- A public learner may only GET `/api/exams/attempts/`, `/api/exams/attempts/<id>/`, `/api/exams/attempts/<id>/review/` and `/api/exams/attempts/<id>/results/`, for their own COMPLETED attempts. Everything else stays `centre_only`.

- [ ] **Step 1: Write the failing tests.** `backend/exams/tests/test_public_student_results.py`:

```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest, TestAttempt

User = get_user_model()


class PublicLearnerResultsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.public = User.objects.create_user(email="pub_leaver@example.com", password="pw", role=acc_const.ROLE_PUBLIC_STUDENT)
        self.client.force_authenticate(self.public)
        pt = PracticeTest.objects.create(subject="MATH", title="Old paper", skip_default_modules=True)
        self.done = TestAttempt.objects.create(
            student=self.public, practice_test=pt, is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(), score=600,
        )
        pt2 = PracticeTest.objects.create(subject="MATH", title="Unfinished", skip_default_modules=True)
        self.open = TestAttempt.objects.create(student=self.public, practice_test=pt2)

    def test_lists_only_finished_attempts(self):
        r = self.client.get("/api/exams/attempts/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        ids = {row["id"] for row in (body["results"] if isinstance(body, dict) else body)}
        self.assertEqual(ids, {self.done.id})

    def test_reads_a_finished_attempt_but_not_an_open_one(self):
        self.assertEqual(self.client.get(f"/api/exams/attempts/{self.done.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/exams/attempts/{self.open.id}/").status_code, 404)

    def test_cannot_start_anything(self):
        r = self.client.post("/api/exams/attempts/", {"practice_test": self.open.practice_test_id}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "centre_only")

    def test_practice_test_library_stays_closed(self):
        self.assertEqual(self.client.get("/api/exams/?kind=practice_test").status_code, 403)
```

- [ ] **Step 2: Run to verify failure.**

Run: `<TEST> exams.tests.test_public_student_results`
Expected: FAIL (list → 403 `centre_only`).

- [ ] **Step 3: Implement.**

`backend/access/host_guard.py`: add `import re` if it is missing. Below `PUBLIC_STUDENT_DENIED_PREFIXES`, add:

```python
#: Read-only exceptions: a public learner who used to study at the centre still opens their OWN
#: finished results — practice tests and past papers (owner decision 2026-10-14, B4 = A).
#: GET/HEAD only; the view scopes the rows to completed attempts of the requester.
PUBLIC_STUDENT_READONLY_PATTERNS = (
    re.compile(r"^/api/exams/attempts/$"),
    re.compile(r"^/api/exams/attempts/\d+/$"),
    re.compile(r"^/api/exams/attempts/\d+/(review|results)/$"),
)
```

Replace `public_student_may` with:

```python
def public_student_may(path: str, method: str = "GET") -> bool:
    """May a public learner reach this path? Non-API paths are not this guard's business."""
    if not path.startswith("/api/"):
        return True
    if path.startswith(PUBLIC_STUDENT_DENIED_PREFIXES):
        return False
    if path.startswith(PUBLIC_STUDENT_API_PREFIXES):
        return True
    return method in ("GET", "HEAD") and any(p.match(path) for p in PUBLIC_STUDENT_READONLY_PATTERNS)
```

At the middleware call site, change `not public_student_may(path)` to `not public_student_may(path, request.method)`.

`backend/exams/views.py` `TestAttemptViewSet`: add the following after `http_method_names`:

```python
    #: The only actions a public learner reaches (their own finished results; see host_guard).
    _PUBLIC_READ_ACTIONS = frozenset({"list", "retrieve", "review", "results"})

    @staticmethod
    def _is_public(user) -> bool:
        return bool(getattr(user, "is_authenticated", False)) and normalized_role(user) == acc_const.ROLE_PUBLIC_STUDENT

    def get_permissions(self):
        # RequiresSubmitTest refuses a public learner (no permissions at all); reading their own
        # finished results needs only a signed-in account. Writes keep the full check.
        if self._is_public(getattr(self.request, "user", None)) and getattr(self, "action", None) in self._PUBLIC_READ_ACTIONS:
            return [IsAuthenticated()]
        return super().get_permissions()
```

In `get_queryset`, bind the existing expression to `qs`, then end the method with:

```python
        if self._is_public(self.request.user):
            qs = qs.filter(is_completed=True, current_state=TestAttempt.STATE_COMPLETED)
        return qs
```

`backend/users/tests/test_public_student_surfaces.py`: read it, then add these assertions next to where it pins the allowlist:
- `public_student_may("/api/exams/attempts/", "GET")` is True;
- `public_student_may("/api/exams/attempts/", "POST")` is False;
- `public_student_may("/api/exams/attempts/5/review/", "GET")` is True;
- `public_student_may("/api/exams/", "GET")` is False.

- [ ] **Step 4: Run to verify it passes.**

Run: `<TEST> exams.tests.test_public_student_results users.tests.test_public_student_surfaces access`
Expected: `OK`.

- [ ] **Step 5: Commit.**

```bash
git add backend/access/host_guard.py backend/exams/views.py backend/users/tests/test_public_student_surfaces.py backend/exams/tests/test_public_student_results.py
git commit -m "feat(practice-tests): a learner who left still reads their own finished results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Student page — practice tests on the past-paper booklets

**Files:**
- Modify: `frontend/src/lib/api.ts` — `PastpaperSection` (~68-81), `examsPublicApi` (~689-830)
- Modify: `frontend/src/features/pastpapers/pastpaperLabels.ts`
- Create: `frontend/src/features/pastpapers/PaperLibrary.tsx`
- Modify: `frontend/src/app/(main)/pastpapers/page.tsx`
- Rewrite: `frontend/src/app/(main)/practice-tests/page.tsx`
- Rewrite: `frontend/src/app/(main)/practice-tests/[packId]/page.tsx` (redirect)
- Modify: `frontend/src/features/dashboard/useDashboardData.ts` (~321-338 copy)
- Test: `frontend/src/features/pastpapers/__tests__/practiceLabels.test.ts`

**Interfaces:**
- Consumes: `GET /api/exams/?kind=practice_test` rows with `is_practice_test`, `practice_number`, `practice_level`, `practice_access` (Task 3).
- Produces:
  - `examsPublicApi.getPracticeTestSections(): Promise<PastpaperSection[]>`
  - `sectionTitle(s)` → "Practice Test N" for numbered practice tests
  - `levelLabel(code): string`
  - From `PaperLibrary.tsx`: `Booklet` (new optional props `badge?: ReactNode`, `meta?: ReactNode`), `Segmented`, `PapersEmpty` (new optional `noun?: string`), `PapersError`, and `usePaperLibrary({ loadSections, backHref })`, which returns `{ sections, atts, reopened, loading, error, load, byTest, starting, startError, handleOpen }`.

- [ ] **Step 1: Write the failing label test.** `frontend/src/features/pastpapers/__tests__/practiceLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { levelLabel, sectionTitle } from "../pastpaperLabels";
import type { PastpaperSection } from "@/lib/api";

const base: PastpaperSection = {
  id: 1, title: "Algebra focus", practice_date: null, subject: "MATH", label: "", form_type: "INTERNATIONAL",
  collection_name: "", is_published: true, modules: [],
};

describe("practice test labels", () => {
  it("names a numbered practice test by its number", () => {
    expect(sectionTitle({ ...base, is_practice_test: true, practice_number: 3 })).toBe("Practice Test 3");
  });
  it("falls back to the title for a past paper or an unnumbered draft", () => {
    expect(sectionTitle(base)).toBe("Algebra focus");
    expect(sectionTitle({ ...base, is_practice_test: true, practice_number: null })).toBe("Algebra focus");
  });
  it("labels levels, blank = all levels", () => {
    expect(levelLabel("")).toBe("All levels");
    expect(levelLabel("middle")).toBe("Middle");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `cd frontend && npx vitest run src/features/pastpapers/__tests__/practiceLabels.test.ts`
Expected: FAIL (`levelLabel` is not exported).

- [ ] **Step 3: Types, API and labels.**

In `lib/api.ts`, add to `PastpaperSection`:

```ts
    /** True for the centre's own practice tests (own page, own rules); false/absent = past paper. */
    is_practice_test?: boolean;
    practice_access?: "open" | "homework_only";
    /** "" = all levels, else foundation | junior | middle | senior. */
    practice_level?: string;
    /** Permanent number, given at first publish (per subject). Null for drafts. */
    practice_number?: number | null;
```

In `examsPublicApi`, add `getPracticeTestSections` next to `getPastpaperSections`. Copy `getPastpaperSections`' body verbatim, then change the request line to `const res = await api.get("/exams/", { params: { kind: "practice_test" } });` and the JSDoc to `/** GET /exams/?kind=practice_test — the practice tests this student may see (visibility is server-side). */`.

In `features/pastpapers/pastpaperLabels.ts`, replace `sectionTitle` and add `levelLabel`:

```ts
export function sectionTitle(s: PastpaperSection): string {
  if (s.is_practice_test && s.practice_number) return `Practice Test ${s.practice_number}`;
  if (s.title && s.title.trim()) return s.title.trim();
  return variantLabel(s);
}

const LEVEL_LABELS: Record<string, string> = { foundation: "Foundation", junior: "Junior", middle: "Middle", senior: "Senior" };
/** A practice test's level badge: blank means every level sees it. */
export function levelLabel(code: string | null | undefined): string {
  return (code && LEVEL_LABELS[code]) || "All levels";
}
```

- [ ] **Step 4: Run the label test.** Expected: PASS (3).

- [ ] **Step 5: Move the shared pieces out of the past-papers page (no behaviour change).**

Create `features/pastpapers/PaperLibrary.tsx` (`"use client";`). MOVE these from `app/(main)/pastpapers/page.tsx` verbatim, with the imports they need: `Segmented`, `Booklet`, `ScoreBlock`, `HistoryLink`, `PapersEmpty`, `PapersError`. Export `Segmented`, `Booklet`, `PapersEmpty` and `PapersError`.

Then make two prop changes:
- **`Booklet`:** add `badge?: React.ReactNode` (rendered in place of the region badge `<span>` — the one with 🇺🇸 / `<Globe/>` and "US"/"International" — when given) and `meta?: React.ReactNode` (rendered in place of the `<Calendar size={14} /> {fmtMonth(section.practice_date)}` content when given). The defaults keep today's output exactly.
- **`PapersEmpty`:** add `noun = "papers"` and use it in place of the word "papers" in its copy.

MOVE the page's data logic into a hook in the same file. That logic is the `useState`s for sections/atts/reopened/loading/error/starting/startError, `load`, the `useEffect(load)`, `byTest` and `handleOpen`. The hook has this signature:

```ts
export function usePaperLibrary({ loadSections, backHref }: {
  loadSections: () => Promise<PastpaperSection[]>;
  backHref: string;
}) {
  // ...the moved code verbatim, with two edits:
  //   examsPublicApi.getPastpaperSections()  →  loadSections()
  //   `?back=/pastpapers`                    →  `?back=${encodeURIComponent(backHref)}`
  return { sections, atts, reopened, loading, error, load, byTest, starting, startError, handleOpen };
}
```

The two comment lines inside the function body stand for the moved code. Paste the real code, with those two edits, in their place. Rewire `app/(main)/pastpapers/page.tsx` to `const lib = usePaperLibrary({ loadSections: examsPublicApi.getPastpaperSections, backHref: "/pastpapers" });` plus the moved components. Its filters, month grouping and rendering stay in the page, now reading from `lib.*`.

Run: `cd frontend && npx vitest run src/features/pastpapers "src/app/(main)/pastpapers"`. Expected: PASS, the same results as before the move.

- [ ] **Step 6: Rewrite the practice-tests page.**

Build `app/(main)/practice-tests/page.tsx` from `app/(main)/pastpapers/page.tsx`'s return block. Keep the same `dzboard` / `dz-content` wrappers, the header block (SIMULATION eyebrow + H1), the filter row, the search box, the skeleton grid, `PapersError` and `PapersEmpty`. It differs in:
- the H1 is "Practice tests";
- the filters are `<Segmented label="Subject" …/>` (`ALL`/`RW`/`MATH` → "All"/"Reading & Writing"/"Math") and `<Segmented label="Status" …/>` (`ALL`/`new`/`progress`/`completed` → "All"/"New"/"In progress"/"Completed");
- the search placeholder is "Search practice tests…";
- there is ONE grid of `rows` (no month groups);
- `PapersEmpty` gets `noun="practice tests"`.

The page logic:

```tsx
"use client";

/**
 * /practice-tests — the centre's own practice tests (owner decisions 2026-10-14/15). Each card is
 * ONE section on the past-paper engine and looks like a past-paper booklet; the server decides
 * which ones this student sees (Open + level, or given as homework). Newest number first, with a
 * subject and a status filter. Timed/Untimed is chosen on the runner's Welcome screen.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// eslint-disable-next-line no-restricted-imports
import { examsPublicApi } from "@/lib/api";
import { cardState } from "@/features/pastpapers/pastpaperCardState";
import { isRW, levelLabel, sectionTitle, subjectLabel } from "@/features/pastpapers/pastpaperLabels";
import { Booklet, PapersEmpty, PapersError, Segmented, usePaperLibrary } from "@/features/pastpapers/PaperLibrary";

type SubjectFilter = "ALL" | "RW" | "MATH";
type StatusFilter = "ALL" | "new" | "progress" | "completed";

export default function PracticeTestsPage() {
  const router = useRouter();
  const lib = usePaperLibrary({ loadSections: examsPublicApi.getPracticeTestSections, backHref: "/practice-tests" });
  const [subject, setSubject] = useState<SubjectFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return lib.sections
      .map((s) => ({ section: s, d: cardState(lib.byTest.get(s.id) ?? [], lib.reopened.get(s.id)) }))
      .filter(({ section, d }) => {
        if (subject === "RW" && !isRW(section.subject)) return false;
        if (subject === "MATH" && isRW(section.subject)) return false;
        const bucket = d.status === "reopened" ? "new" : d.status;
        if (status !== "ALL" && bucket !== status) return false;
        if (q && !`${sectionTitle(section)} ${section.title} ${subjectLabel(section.subject)}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        (b.section.practice_number ?? 0) - (a.section.practice_number ?? 0)
        || (isRW(a.section.subject) ? 0 : 1) - (isRW(b.section.subject) ? 0 : 1)
        || b.section.id - a.section.id);
  }, [lib.sections, lib.byTest, lib.reopened, subject, status, search]);

  const hasFilter = subject !== "ALL" || status !== "ALL" || !!search.trim();
  // return: the past-papers page's layout with the differences listed above; each card is
  //   <Booklet key={row.section.id} section={row.section} d={row.d}
  //     badge={<LevelBadge code={row.section.practice_level ?? ""} />}
  //     meta={row.section.title?.trim() || "Timed or untimed — your choice"}
  //     busy={lib.starting === row.section.id}
  //     error={lib.startError?.sectionId === row.section.id ? lib.startError.msg : null}
  //     onOpen={() => void lib.handleOpen(row.section, row.d)}
  //     onReport={() => { if (row.d.completedAttemptId) router.push(`/pastpapers/${row.d.completedAttemptId}/report`); }}
  //     onHistory={() => { if (row.d.completedAttemptId) router.push(`/pastpapers/${row.d.completedAttemptId}/report#history`); }} />
}

function LevelBadge({ code }: { code: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "var(--dz-indigo)", background: "var(--dz-indigo-soft)", padding: "4px 10px", borderRadius: 8 }}>
      {levelLabel(code)}
    </span>
  );
}
```

The `// return:` comment above is a spec for the JSX. Write the real `return (...)` in its place, from the past-papers page plus the listed differences. No comment placeholder may remain in the committed file.

Replace `app/(main)/practice-tests/[packId]/page.tsx` entirely with:

```tsx
import { redirect } from "next/navigation";

/** Packs were retired (2026-10-15): a practice test is one section now. Old links land on the list. */
export default function RetiredPackPage() {
  redirect("/practice-tests");
}
```

In `features/dashboard/useDashboardData.ts` (~321-338), change the practice entry's "Untimed" wording to "Timed or untimed".

- [ ] **Step 7: Typecheck (with a probe) and run the tests.**

```bash
cd frontend && rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json
```

Append `const __probe: number = "x";` to `app/(main)/practice-tests/page.tsx` and re-run tsc. Expect exactly that error, then remove the probe line. Then run `npx vitest run src/features/pastpapers` and expect PASS.

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/lib/api.ts frontend/src/features/pastpapers "frontend/src/app/(main)/pastpapers/page.tsx" "frontend/src/app/(main)/practice-tests" frontend/src/features/dashboard/useDashboardData.ts
git commit -m "feat(practice-tests): student page on the past-paper booklets, numbered, level badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Runner — Timed/Untimed choice and the untimed sitting

**Files:**
- Modify: `frontend/src/features/testing-simulation/types/attempt.ts` (`practiceTestDetailsSchema`, `attemptSchema`)
- Modify: `frontend/src/features/testing-simulation/state/selectors.ts`
- Modify: `frontend/src/features/testing-simulation/services/examApiClient.ts` (`start`, ~66)
- Modify: `frontend/src/features/testing-simulation/hooks/useExamAttempt.ts` (`start`, ~37, ~79-98)
- Modify: `frontend/src/features/testing-simulation/hooks/useModuleTimer.ts`
- Modify: `frontend/src/features/testing-simulation/components/WelcomeScreen.tsx`, `components/ExamHeader.tsx`
- Modify: `frontend/src/features/testing-simulation/pages/ExamRunnerPage.tsx` (~204, ~298-315, ~564-570, ~1031-1039, ~1102)
- Modify: `frontend/src/app/review/[attemptId]/page.tsx` (~566)
- Test: `frontend/src/features/testing-simulation/__tests__/untimed.test.tsx`

**Interfaces:**
- Consumes: attempt `is_timed`, `practice_test_details.is_practice_test` / `practice_number`; `POST start {timed:false}`; review `is_timed` (Task 4).
- Produces:
  - `isUntimed(attempt)`, `isPracticeTest(attempt)`
  - `useExamAttempt().start(opts?: { timed?: boolean })`
  - `examApiClient.start(attemptId, key?, opts?)`
  - `useModuleTimer({ …, untimed })`
  - `WelcomeScreen` prop `timing?: { timed: boolean; onChange: (timed: boolean) => void }`
  - `ExamHeader` prop `untimed?: boolean`

- [ ] **Step 1: Write the failing tests.** `frontend/src/features/testing-simulation/__tests__/untimed.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { isPracticeTest, isUntimed } from "../state/selectors";

const attempt = (extra: Record<string, unknown>) => extra as never;

describe("untimed practice tests", () => {
  it("reads the server's choice", () => {
    expect(isUntimed(attempt({ is_timed: false }))).toBe(true);
    expect(isUntimed(attempt({ is_timed: true }))).toBe(false);
    expect(isUntimed(attempt({}))).toBe(false);
    expect(isPracticeTest(attempt({ practice_test_details: { is_practice_test: true } }))).toBe(true);
  });

  it("offers Timed / Untimed on the Welcome screen and reports the choice", () => {
    const onChange = vi.fn();
    render(
      <WelcomeScreen moduleTitle="Section 2, Module 1: Math" kindLabel="Practice Test" subjectLabel="Math"
        minutes={35} questionCount={22} starting={false} fullscreenSupported={false} onStart={() => {}}
        timing={{ timed: true, onChange }} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /untimed/i }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows 'No limit' and the untimed rule when untimed is picked", () => {
    render(
      <WelcomeScreen moduleTitle="M" kindLabel="Practice Test" subjectLabel="Math" minutes={35}
        questionCount={22} starting={false} fullscreenSupported={false} onStart={() => {}}
        timing={{ timed: false, onChange: () => {} }} />,
    );
    expect(screen.getByText("No limit")).toBeTruthy();
    expect(screen.getByText(/no timer/i)).toBeTruthy();
  });

  it("past papers get no choice", () => {
    render(
      <WelcomeScreen moduleTitle="M" subjectLabel="Math" minutes={35} questionCount={22}
        starting={false} fullscreenSupported={false} onStart={() => {}} />,
    );
    expect(screen.queryByRole("radio", { name: /untimed/i })).toBeNull();
  });
});
```

Also add a timer test. Run `grep -rl useModuleTimer frontend/src --include='*.test.*'`. If a test file exists, add a case there using its setup. Otherwise create `__tests__/useModuleTimer.untimed.test.ts` with `renderHook` + `vi.useFakeTimers()`. The case: an attempt in MODULE_1_ACTIVE whose `current_module_start_time` is 2 hours ago, `module_duration_seconds: 2100`, and `untimed: true`. Advancing the timers by 5 s leaves `ready === false` and never calls `onExpire`.

- [ ] **Step 2: Run to verify failure.**

Run: `cd frontend && npx vitest run src/features/testing-simulation/__tests__/untimed.test.tsx`
Expected: FAIL (`isUntimed` is not exported).

- [ ] **Step 3: Implement.**

`types/attempt.ts`:
- In `practiceTestDetailsSchema`'s object, add `is_practice_test: z.boolean().optional(), practice_number: z.number().nullable().optional(),`.
- In `attemptSchema`'s object, add `is_timed: z.boolean().default(true),`.

`state/selectors.ts`: add these after `pauseAllowed`:

```ts
/** A practice-test student chose to work without the clock (server `is_timed=false`). */
export function isUntimed(attempt: Attempt | null): boolean {
  return attempt?.is_timed === false;
}

/** The centre's own practice test (own Welcome wording + the Timed/Untimed choice). */
export function isPracticeTest(attempt: Attempt | null): boolean {
  return Boolean(attempt?.practice_test_details?.is_practice_test);
}
```

`services/examApiClient.ts`, replace `start` with:

```ts
    /** Transition NOT_STARTED → active. Idempotent via key. `timed:false` = untimed practice test. */
    async start(attemptId: number, idempotencyKey?: string, opts?: { timed?: boolean }): Promise<Attempt> {
      const body = opts?.timed === false ? { timed: false } : {};
      const r = await guarded(
        api.post(`${base}/${attemptId}/start/`, body, { headers: headersFor(attemptId, idempotencyKey) }),
      );
      return parseAttempt(r.data, "POST start");
    },
```

`hooks/useExamAttempt.ts`:
- Change the declared type to `start: (opts?: { timed?: boolean }) => Promise<void>;`.
- Change the callback to `const start = useCallback(async (opts?: { timed?: boolean }) => {` and its call to `await api.start(attemptId, startKey(attemptId), opts);`.
- Leave the initial-load call (~117) unchanged.
- If `api` is typed by a separate interface that declares `start(attemptId: number, idempotencyKey?: string)`, add the optional third parameter there too.

`hooks/useModuleTimer.ts`:
- Add `untimed?: boolean` to `UseModuleTimerArgs` and destructure `untimed = false`.
- In the (re)anchor effect, change the guard to `if (untimed || !moduleId || !startTime || limitSeconds <= 0) {` and add `untimed` to that effect's dependency array.
- In any other effect that ticks or calls `onExpireRef.current`, return early when `untimed`.

`components/WelcomeScreen.tsx`:
- Add the prop and its doc:

```ts
  /** Practice tests only: the student's Timed/Untimed choice (owner decision 2026-10-14). */
  timing?: { timed: boolean; onChange: (timed: boolean) => void };
```

- Destructure `timing` and set `const untimed = timing?.timed === false;`.
- The Time tile value becomes `{untimed ? "No limit" : minutes ? `${minutes} min` : "—"}`.
- Insert directly above the `<ul>`:

```tsx
          {timing && (
            <div role="radiogroup" aria-label="Timing" className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              {[{ v: true, l: "Timed" }, { v: false, l: "Untimed" }].map((o) => (
                <button key={o.l} type="button" role="radio" aria-checked={timing.timed === o.v}
                  onClick={() => timing.onChange(o.v)}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${timing.timed === o.v ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {o.l}
                </button>
              ))}
            </div>
          )}
```

- The first bullet's text becomes `{untimed ? "There is no timer — take as long as you need." : "The timer starts when you press Start and cannot be reset."}`.

`components/ExamHeader.tsx`: add `untimed?: boolean` to the props interface, destructure it, and wrap the `<Timer …/>` element (its props unchanged):

```tsx
        {untimed ? (
          <span className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-bold text-slate-600">Untimed</span>
        ) : (
          <Timer
            secondsLeft={secondsLeft}
            hidden={timerHidden}
            onToggleHidden={onToggleTimer}
            warning={timerWarning}
            pauseAllowed={pauseAllowed}
            paused={paused}
            onTogglePause={onTogglePause}
          />
        )}
```

`pages/ExamRunnerPage.tsx`:
- Import `isPracticeTest, isUntimed` from `../state/selectors`.
- Add `const [timedChoice, setTimedChoice] = useState(true);` next to the welcome state (~204).
- `useModuleTimer({ attempt, clock, paused: …unchanged…, onExpire, untimed: isUntimed(attempt) })`.
- In `handleStart` (~298-315), change `await start();` to `await start(isPracticeTest(attempt) ? { timed: timedChoice } : undefined);` and add `timedChoice` to the callback's dependency list.
- On `<WelcomeScreen …>`, add `kindLabel={isPracticeTest(attempt) ? "Practice Test" : "Past Paper"}` and `timing={isPracticeTest(attempt) ? { timed: timedChoice, onChange: setTimedChoice } : undefined}`.
- On `<ExamHeader …>`, add `untimed={isUntimed(attempt)}` and change `pauseAllowed={pauseAllowed(attempt, mockFlow)}` to `pauseAllowed={pauseAllowed(attempt, mockFlow) && !isUntimed(attempt)}`.

`app/review/[attemptId]/page.tsx`:
- Add `is_timed?: boolean` to the review data type used by the page.
- Change the label text `{subjectLabel} · Section Score` to `{subjectLabel} · Section Score{review.is_timed === false ? " · Untimed" : ""}`.

- [ ] **Step 4: Run tests.**

Run: `cd frontend && npx vitest run src/features/testing-simulation "src/app/review"`
Expected: PASS, the new tests included. The existing runner tests stay green.

- [ ] **Step 5: Typecheck with a probe** (as in Task 8 Step 7, with the probe in `selectors.ts`).

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/features/testing-simulation frontend/src/app/review
git commit -m "feat(practice-tests): Timed or Untimed on the Welcome screen; untimed has no clock or pause

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Builder — practice-test library on the past-paper editor

**Files:**
- Modify: `frontend/src/lib/api.ts` (admin `getStandaloneSections`, `createSection`, add `getSection`, ~1640-1670); if `frontend/src/features/examsAdmin/api.ts` re-wraps them, mirror the changes there
- Modify: `frontend/src/app/(builder)/builder/pastpapers/page.tsx` (fetch `kind: "pastpaper"`)
- Modify: `frontend/src/app/(builder)/builder/pastpapers/[testId]/[moduleId]/page.tsx` (load ONE section)
- Rewrite: `frontend/src/app/(builder)/builder/practice-tests/page.tsx`
- Delete: `frontend/src/app/(builder)/builder/practice-tests/[packId]/` (whole directory)
- Create: `frontend/src/app/(builder)/builder/practice-tests/[testId]/[moduleId]/page.tsx`
- Test: `frontend/src/app/(builder)/builder/practice-tests/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: the Task 5 admin API.
- Produces:
  - `examsAdminApi.getStandaloneSections(kind?: "pastpaper" | "practice_test")`
  - `examsAdminApi.getSection(id: number): Promise<AdminPastpaperSection>`
  - `createSection(...)` accepts `is_practice_test`, `practice_access`, `practice_level`

- [ ] **Step 1: Write the failing builder test.** `__tests__/page.test.tsx`:
- Mock the module the page imports `examsAdminApi` from with `vi.mock(...)`.
- Make `getStandaloneSections` resolve `[{ id: 7, title: "Algebra focus", subject: "MATH", is_practice_test: true, practice_number: 2, practice_access: "open", practice_level: "middle", is_published: true, label: "", form_type: "INTERNATIONAL", collection_name: "", practice_date: null, modules: [{ id: 70, module_order: 1 }, { id: 71, module_order: 2 }] }]`.
- Render the page and `await` the text "Practice Test 2".
- Assert "Algebra focus", "Open" and "Middle" are shown, and that a link has `href="/builder/practice-tests/7/70"`.
- Assert `getStandaloneSections` was called with `"practice_test"`.

Use the closest existing builder page test as the template for providers and router mocks (`grep -rl "builder" frontend/src --include='*.test.tsx' | head`).

- [ ] **Step 2: Run to verify failure.** `cd frontend && npx vitest run "src/app/(builder)/builder/practice-tests"` → FAIL.

- [ ] **Step 3: API and routes.**

```ts
    getStandaloneSections: async (kind?: 'pastpaper' | 'practice_test'): Promise<AdminPastpaperSection[]> => {
        const r = await api.get('/exams/admin/tests/', { params: { standalone: '1', ...(kind ? { kind } : {}) } });
        return unwrapAdminList<AdminPastpaperSection>(r.data);
    },
    getSection: async (id: number): Promise<AdminPastpaperSection> => {
        const r = await api.get(`/exams/admin/tests/${id}/`);
        return r.data as AdminPastpaperSection;
    },
```

Add `is_practice_test?: boolean; practice_access?: 'open' | 'homework_only'; practice_level?: string;` to `createSection`'s data type.

`builder/pastpapers/page.tsx`: change its `getStandaloneSections()` calls to `getStandaloneSections("pastpaper")`.

`builder/pastpapers/[testId]/[moduleId]/page.tsx`: replace the effect body that calls `getStandaloneSections().then(...)` with:

```ts
    examsAdminApi.getSection(testId)
      .then((s) => { if (!cancelled) setSection(s); })
      .catch(() => { if (!cancelled) setSection(null); });
```

The same editor now serves both libraries.

Create `builder/practice-tests/[testId]/[moduleId]/page.tsx`:

```tsx
/** Practice tests use the past-paper module editor unchanged ("savol qo'shish bir xil"). */
export { default } from "../../../pastpapers/[testId]/[moduleId]/page";
```

Delete `builder/practice-tests/[packId]/`. It would clash with `[testId]`, because Next refuses two different slug names at one level.

- [ ] **Step 4: Rewrite `builder/practice-tests/page.tsx`.**

Base it on `builder/pastpapers/page.tsx`: the `SectionCard` / `FilterGroup` / `SectionModal` look and classes. Copy the helpers this page needs into it; never import from another page file. It differs in:
- **Data:** `examsAdminApi.getStandaloneSections("practice_test")`. Sort drafts (no number) first, then `practice_number` desc, then subject.
- **Filters:** Subject (All / Reading & Writing / Math) and Status (All / Published / Draft).
- **Card title:** `section.practice_number ? `Practice Test ${section.practice_number}` : "Draft — numbered when published"`. The subtitle is `section.title`.
- **Badges:** subject, `levelLabel(section.practice_level)`, and `section.practice_access === "open" ? "Open" : "Homework only"`.
- **Module links:** `/builder/practice-tests/${section.id}/${mod.id}` (one per module, labelled "Module 1"/"Module 2" as in the past-paper card).
- **Actions:**
  - Publish / Unpublish: `publishSection` / `unpublishSection`. Show `violations[].message` from a 400, as the past-paper page does.
  - Edit: opens the modal.
  - Delete: `deleteSection` after a confirm; show the server's 400 `detail` when students have attempts.
- **Modal "New practice test" / "Edit practice test":**
  - Fields:
    - Subject (radio R&W / Math, create only);
    - Subtitle (`title`, optional);
    - Who sees it (radio: "Open — in the library for students of the level" / "Homework only — hidden until a teacher sets it");
    - Level (select: All levels / Foundation / Junior / Middle / Senior → `""`/codes).
  - Create calls `createSection({ subject, title, is_practice_test: true, practice_access, practice_level })`.
  - Edit calls `updateSection(id, { title, practice_access, practice_level })`.
- **Header:** H1 "Practice tests". Helper line: "The centre's own tests. Students see Open tests of their group's level; Homework only tests appear when a teacher sets them."

- [ ] **Step 5: Run the test and typecheck (with a probe).** Expected: the test PASSes; tsc catches the probe and is otherwise clean.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/lib/api.ts frontend/src/features/examsAdmin "frontend/src/app/(builder)/builder/pastpapers" "frontend/src/app/(builder)/builder/practice-tests"
git commit -m "feat(practice-tests): builder library (access, level, number) on the past-paper editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Teacher — Practice tests tab, launcher, results

**Files:**
- Modify: `frontend/src/features/classroom/pages/AssignmentForm.tsx` (TabKey ~79, state ~232, options ~259-311, TABS ~1038-1046, packs panel ~1253-1270, payloads ~590-602 / ~662-663)
- Modify: `frontend/src/features/classroom/homeworkApi.ts` (the `practice_bundle_tests` element type; the launcher loop ~284-305)
- Modify: `frontend/src/features/classroom/pages/Results.tsx`
- Test: `frontend/src/features/classroom/__tests__/practiceTestsTab.test.tsx`

**Interfaces:**
- Consumes: `practice_test_items` (Task 6); bundle rows `is_practice_test`; results rows `type`, `untimed`.
- Produces: a homework form whose practice-test picks land in `practice_test_ids`; launcher label "Open Practice Test".

- [ ] **Step 1: Write the failing tests.** Use the existing AssignmentForm tests as the template for mocks and providers (`grep -rl AssignmentForm frontend/src --include='*.test.tsx'`).
  - **Test 1:**
    - Mock the assignment-options call to return one past paper and `practice_test_items: [{ id: 9, number: 4, title: "Algebra focus", subject: "MATH", level: "middle", access: "homework_only", already_assigned: false }]`.
    - Render the create form, click the "Practice tests" tab, click the "Practice Test 4" card, then submit.
    - Assert the submitted FormData's `practice_test_ids` is `"[9]"` and that no `practice_test_pack_ids` key is present.
  - **Test 2:** call the exported function that contains the launcher loop (read `homeworkApi.ts` ~260-310 for its name) with an assignment whose `practice_bundle_tests` is `[{ id: 9, name: "Practice Test 4", is_practice_test: true, state: "not_started", subject: "MATH", attempt_id: null, retake: false }]`. Assert one launcher with label "Open Practice Test" and name "Practice Test 4".

- [ ] **Step 2: Run to verify failure.** `cd frontend && npx vitest run src/features/classroom/__tests__/practiceTestsTab.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**

`AssignmentForm.tsx`:
- **Types:**
  - `type TabKey = "pastpapers" | "practice" | "assessments" | "vocabulary" | "submission";`
  - Add `type PracticeTestItemOption = { id: number; number: number | null; title: string; subject: string; level: string; access: "open" | "homework_only"; already_assigned: boolean };`
  - In the `assignmentOptions` state type and initial value, replace `practice_test_packs` with `practice_test_items: PracticeTestItemOption[]`. Map the response with `practice_test_items: res.practice_test_items ?? []`.
- **Remove:**
  - `selectedPackIds` and its setters;
  - the pack search state and memos (`packSearch`, `filteredPacks`, `availablePacks`, `givenPacks`);
  - `renderPackCard` and the `activeTab === "packs"` panel;
  - both `practice_test_pack_ids` payload lines (edit body and create FormData);
  - the edit-hydrate of pack ids;
  - `PracticeTestPackOption` if unused.
- **TABS:** insert after the pastpapers entry, unconditionally: `{ key: "practice", label: "Practice tests", icon: FlaskConical },`. Delete the comment line "Practice test packs are no longer offered when creating an assignment."
- **Selection:** find the handler `renderPastpaperCard` uses to toggle a section in `selectedTestIds`. Reuse it if it only toggles. If it does more (e.g. resets `practiceScope`), write the small toggle below instead.
- **Memos and card renderer:**

```tsx
  const availablePracticeItems = useMemo(() => assignmentOptions.practice_test_items.filter((p) => !p.already_assigned), [assignmentOptions.practice_test_items]);
  const givenPracticeItems = useMemo(() => assignmentOptions.practice_test_items.filter((p) => p.already_assigned), [assignmentOptions.practice_test_items]);
  const togglePracticeItem = (id: number) =>
    setSelectedTestIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const renderPracticeItemCard = (p: PracticeTestItemOption, given: boolean) => (
    <PickCard key={p.id} selected={selectedTestIds.has(p.id)} given={given} onClick={() => togglePracticeItem(p.id)}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary">
        {p.access === "homework_only" ? "Practice test · Homework only" : "Practice test"}
      </span>
      <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{p.number ? `Practice Test ${p.number}` : p.title}</span>
      <span className="text-[12px] font-semibold text-muted-foreground">{[p.number && p.title ? p.title : null, levelLabel(p.level)].filter(Boolean).join(" · ")}</span>
    </PickCard>
  );
```

- **Panel:**

```tsx
          {activeTab === "practice" && (
            <div className={panelCls} role="tabpanel">
              {assignmentOptions.practice_test_items.length === 0 ? (
                <EmptyPanel icon={FlaskConical} title="No practice tests for this subject yet" text="Publish one in the Builder console first." />
              ) : (
                <>
                  {availablePracticeItems.length > 0 && (<>{groupTitle("Available")}<div className={cardGrid}>{availablePracticeItems.map((p) => renderPracticeItemCard(p, false))}</div></>)}
                  {givenPracticeItems.length > 0 && (<>{groupTitle("Already assigned")}<div className={cardGrid}>{givenPracticeItems.map((p) => renderPracticeItemCard(p, true))}</div></>)}
                </>
              )}
              <p className={captionCls}>Select one or more. Homework only tests stay hidden from students until you set them.</p>
            </div>
          )}
```

- Import `levelLabel` from `@/features/pastpapers/pastpaperLabels`.

`homeworkApi.ts`:
- Add `is_practice_test?: boolean;` to the `practice_bundle_tests` element type.
- In the launcher loop, add `const isPractice = Boolean(t.is_practice_test);`.
- In `base`, use the fallback `isPractice ? "Practice Test" : "Past Paper"` in place of the literal `"Past Paper"`.
- Change the label to `label: isPractice ? "Open Practice Test" : "Open Past Paper",`.

`Results.tsx`:
- Add `{ v: "practice test", label: "Practice Test" }` to the type filter options.
- Add `untimed?: boolean` to the row type.
- After the content-name text, render `{row.untimed ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">Untimed</span> : null}`.

- [ ] **Step 4: Run tests and typecheck (with a probe).** Run `npx vitest run src/features/classroom` → PASS; tsc is clean.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/features/classroom
git commit -m "feat(practice-tests): teachers set practice tests as homework; launcher and results know them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: A public learner opens their results in the web app

**Files:**
- Modify: `frontend/src/lib/roles.ts` (~75)
- Modify: the profile page (`frontend/src/app/(main)/profile/page.tsx` ~179-182) and its test (`ProfilePage.test.tsx` ~176)
- Test: the existing roles test (`grep -rl "PUBLIC_STUDENT_PATH_PREFIXES\|homePathFor" frontend/src --include='*.test.*'`)

- [ ] **Step 1: Write the failing tests.**
  - In the roles test, use the exported function built on `PUBLIC_STUDENT_PATH_PREFIXES` (read `roles.ts` ~75-80 for its name). Assert it returns true for `/review/12` and false for `/practice-tests` and `/pastpapers`.
  - In `ProfilePage.test.tsx`, change the public-learner case from "does not call `/exams/attempts/`" to "calls `/exams/attempts/`".

- [ ] **Step 2: Run to verify failure.** `cd frontend && npx vitest run src/lib "src/app/(main)/profile"` → FAIL.

- [ ] **Step 3: Implement.**
  - `roles.ts`: `const PUBLIC_STUDENT_PATH_PREFIXES = ["/mock-exam", "/exam", "/events", "/profile", "/review"] as const;`. Above it, add the comment `// "/review": a learner who left reads their own finished results (owner 2026-10-14).`
  - Profile page: remove the public-learner skip around the attempts fetch (~179-182). The server now returns completed attempts only.

- [ ] **Step 4: Run tests.** PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/lib/roles.ts "frontend/src/app/(main)/profile"
git commit -m "feat(practice-tests): a learner who left reaches their score history and review pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Full verification, Postgres migration check, PR

- [ ] **Step 1: Backend suites.**

Run: `<TEST> exams classes users access desktop`
Expected: literal `OK`. For any red test, also run it in a clean `origin/main` worktree. If it is red there too, it is pre-existing: list it in the PR and leave it.

- [ ] **Step 2: Migrations on a throwaway Postgres.**

Start a local PostgreSQL 18 cluster on port 55432 (Homebrew `initdb` + `pg_ctl`, with `LC_ALL=C`; role `dsat_probe`). Then:

```bash
cd backend && DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres SECRET_KEY=test-secret DEBUG=True python3 manage.py migrate exams 0056 --noinput
cd backend && DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres SECRET_KEY=test-secret DEBUG=True python3 manage.py sqlmigrate exams 0055
```

Expected:
- `Applying exams.0055_practice_test_fields... OK` and `Applying exams.0056_packs_to_practice_tests... OK`;
- in the `sqlmigrate` output, each `ADD COLUMN` carries a `DEFAULT` that is never dropped (db_default).

Stop and delete the cluster afterwards.

- [ ] **Step 3: Frontend gates.**

```bash
cd frontend && rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx eslint src --max-warnings=0
```

Expected: tsc proven by a probe, vitest all PASS, eslint clean.

- [ ] **Step 4: Render check.** Run the worktree's `next dev` against a local backend seeded with:
- one Open Math practice test numbered 1;
- one Homework-only practice test;
- a Middle-level student in a Middle class.

As that student, check that:
- `/practice-tests` shows only Practice Test 1;
- the Welcome screen offers Timed/Untimed;
- an Untimed sitting shows "Untimed" in the header and no Pause.

Save PNG screenshots for the PR on the `pr-screenshots` orphan branch. The built-in browser pane cannot drive this app; use the render-to-PNG route.

- [ ] **Step 5: Keep the graph current.** Run `graphify update .` from the repo root.

- [ ] **Step 6: Push and open the PR.**

```bash
git push -u origin HEAD:refs/heads/feat/practice-tests
gh pr create --base main --title "Practice tests: single sections with access, level, number, Timed/Untimed" --body-file <scratchpad>/pr-practice-tests.md
```

The PR body must include:
- what changed, by task;
- the owner decisions;
- **Deploy:**
  1. migrate-first: `exams.0055` adds 4 + 1 columns with `db_default` plus a partial unique index on `practice_tests`; `exams.0056` touches only the former pack sections;
  2. zero-downtime release phase A/B;
  3. after the switch, the two existing practice tests read "Practice Test 1/2" (Math), Open, all levels; their empty R&W halves are drafts in the builder.
- **Rollback:** code-only. Old code ignores the new columns, and 0056 is not reversed, so old code shows no packs.
- the screenshots;
- out of scope: PR 2 (Windows app) and PR 3 (pack removal);
- the final line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Then call `mcp__ccd_pr__get_status` and bind the PR if it is not reported.
