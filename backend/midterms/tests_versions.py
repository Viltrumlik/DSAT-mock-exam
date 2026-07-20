"""Version-aware midterm tests: per-student version assignment + version-scoped scoring.

    python manage.py test midterms.tests_versions --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt, MidtermVersion, MidtermVersionAssignment
from midterms.tests_api import force_expire, grant
from midterms.tests_classroom import enroll, make_classroom, open_window

User = get_user_model()


def _add_version(midterm, number, correct):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=midterm.duration_minutes)
    v = MidtermVersion.objects.create(
        midterm=midterm, version_number=number, label=f"Version {number}", question_module=module
    )
    for i in range(4):
        Question.objects.create(
            module=module, question_type="READING", question_text=f"V{number}Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers=correct, is_math_input=False, score=10, order=i,
        )
    return v


class MidtermVersionTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="tv", email="tv@x.io", is_staff=True)
        self.student = User.objects.create(username="sv", email="sv@x.io")
        self.room = make_classroom(self.teacher)
        enroll(self.room, self.student)
        # Versioned midterm: two versions with DIFFERENT correct answers (A→"a", B→"b").
        self.mt = Midterm.objects.create(
            title="Versioned", subject=Midterm.READING_WRITING,
            scoring_scale=Midterm.SCALE_100, duration_minutes=30, is_published=True,
        )
        self.vA = _add_version(self.mt, 1, "a")
        self.vB = _add_version(self.mt, 2, "b")
        grant(self.student, self.mt, classroom=self.room)
        self.sc = APIClient(); self.sc.force_authenticate(self.student)

    def _take_all(self, aid, answer):
        att = MidtermAttempt.objects.get(pk=aid)
        qids = [str(q.id) for q in att.effective_questions()]
        self.sc.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        force_expire(aid)
        return self.sc.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {q: answer for q in qids}}, format="json")

    def test_assigned_version_is_pinned_and_scored_against_its_own_key(self):
        MidtermVersionAssignment.objects.create(midterm=self.mt, classroom=self.room, student=self.student, version=self.vB)
        aid = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json").json()["id"]
        att = MidtermAttempt.objects.get(pk=aid)
        self.assertEqual(att.version_id, self.vB.id)
        # The runner serves version B's questions (not A's).
        served = {q["id"] for q in self.sc.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json").json()["current_module_details"]["questions"]}
        self.assertEqual(served, {q.id for q in self.vB.questions()})
        # Answering all "b" is perfect for B (would be 0 against A).
        force_expire(aid)
        qids = [str(q.id) for q in self.vB.questions()]
        r = self.sc.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {q: "b" for q in qids}}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertEqual(att.score, 100)

    def test_auto_assign_when_none_set_persists_for_classroom(self):
        aid = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json").json()["id"]
        att = MidtermAttempt.objects.get(pk=aid)
        self.assertIn(att.version_id, [self.vA.id, self.vB.id])
        self.assertTrue(
            MidtermVersionAssignment.objects.filter(midterm=self.mt, classroom=self.room, student=self.student).exists()
        )

    def test_students_never_see_the_version(self):
        aid = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json").json()["id"]
        snap = self.sc.get(f"/api/midterms/attempts/{aid}/status/").json()
        import json

        self.assertNotIn("version", json.dumps(snap.get("practice_test_details", {})))

    def test_versioned_midterm_reports_per_version_count_not_zero(self):
        # A versioned midterm's flat question_module is empty by design; display counts
        # must be version-aware (per-version length) so it doesn't read as an empty/hidden
        # midterm in listings. Each version here has 4 questions.
        self.assertEqual(self.mt.questions().count(), 0)  # flat module intentionally empty
        self.assertEqual(self.mt.display_question_count(), 4)
        self.assertTrue(self.mt.has_questions())


class MidtermVersionSyncTests(TestCase):
    def test_sync_mirrors_two_practice_tests_into_two_versions(self):
        from exams.models import MockExam, PracticeTest
        from exams.models import Module as XModule, Question as XQuestion
        from midterms.sync import upsert_midterm_from_legacy

        mock = MockExam.objects.create(
            title="Versioned MT", kind=MockExam.KIND_MIDTERM, midterm_subject="READING_WRITING",
            midterm_scoring_scale="SCALE_100", midterm_module_count=1, midterm_module1_minutes=30, is_published=True,
        )
        for correct in ["a", "b"]:  # two PracticeTests = two versions, different keys
            pt = PracticeTest.objects.create(mock_exam=mock, subject="READING_WRITING", form_type="INTERNATIONAL", skip_default_modules=True)
            mod = XModule.objects.create(practice_test=pt, module_order=1, time_limit_minutes=30)
            for i in range(3):
                XQuestion.objects.create(
                    module=mod, question_type="READING", question_text=f"q{i}",
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers=correct, is_math_input=False, score=10, order=i,
                )
        midterm = upsert_midterm_from_legacy(mock)
        self.assertEqual(midterm.versions.count(), 2)
        for v in midterm.versions.all():
            self.assertEqual(v.questions().count(), 3)
        # Single-set fallback: the flattened module is left empty for versioned midterms.
        self.assertEqual(midterm.questions().count(), 0)


class VersionAssignmentApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="tva", email="tva@x.io", is_staff=True)
        self.s1 = User.objects.create(username="va1", email="va1@x.io")
        self.s2 = User.objects.create(username="va2", email="va2@x.io")
        self.room = make_classroom(self.teacher)
        enroll(self.room, self.s1)
        enroll(self.room, self.s2)
        self.mt = Midterm.objects.create(
            title="V", subject=Midterm.READING_WRITING,
            scoring_scale=Midterm.SCALE_100, duration_minutes=30, is_published=True,
        )
        self.vA = _add_version(self.mt, 1, "a")
        self.vB = _add_version(self.mt, 2, "b")
        self.tc = APIClient(); self.tc.force_authenticate(self.teacher)
        # Assign carries a start time — a schedule-less assign is refused, and without the
        # grants it creates the roster (and so every assignment below) would be empty.
        r = self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/",
            {"midterm_id": self.mt.id, "starts_at": open_window()},
            format="json",
        )
        assert r.status_code == 200, r.content

    def test_preview_is_not_saved_then_commit_persists(self):
        cid = self.room.id
        url = f"/api/classes/{cid}/midterms-v2/{self.mt.id}/versions/"
        # Preview a random distribution — must not persist.
        r = self.tc.post(url, {"action": "preview"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()["assignments"]), 2)
        self.assertFalse(MidtermVersionAssignment.objects.filter(midterm=self.mt).exists())

        # Commit an explicit mapping.
        mapping = {str(self.s1.id): self.vA.id, str(self.s2.id): self.vB.id}
        r = self.tc.post(url, {"action": "commit", "assignments": mapping}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(MidtermVersionAssignment.objects.get(midterm=self.mt, student=self.s1).version_id, self.vA.id)
        self.assertEqual(MidtermVersionAssignment.objects.get(midterm=self.mt, student=self.s2).version_id, self.vB.id)

        # Panel roster surfaces the version + has_versions.
        body = self.tc.get(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/panel/").json()
        self.assertTrue(body["has_versions"])
        vnums = {row["student_id"]: row["version_number"] for row in body["students"]}
        self.assertEqual(vnums[self.s1.id], 1)
        self.assertEqual(vnums[self.s2.id], 2)
