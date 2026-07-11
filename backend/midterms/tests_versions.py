"""Version-aware midterm tests: per-student version assignment + version-scoped scoring.

    python manage.py test midterms.tests_versions --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt, MidtermVersion, MidtermVersionAssignment
from midterms.tests_api import force_expire, grant
from midterms.tests_classroom import enroll, make_classroom

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
