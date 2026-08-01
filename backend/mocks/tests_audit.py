"""Full-mock audit regressions — the holes an end-to-end read of the feature turned up.

Each test here fails against the code as it was before the audit; together they pin the
four defects that mattered:

  1. ``save_attempt`` banked answers typed AFTER the module deadline, while
     ``submit_module`` dropped them — so the timer guard was one endpoint wide.
  2. A ``background`` keepalive flush from a closing tab could open the NEXT module and
     start its clock with nobody watching (the midterm already guards this; the mock did not).
  3. Deleting a Mock orphaned its four ``exams.Module`` rows and every question on them.
  4. A Math question could be authored into the Reading & Writing section (and vice versa),
     because the SAT type check keys off ``Module.practice_test`` and a mock module has none.

    python manage.py test mocks.tests_audit --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import Module, Question
from mocks.models import Mock, MockAttempt
from mocks.state_machine import STATE_ENGLISH_M1, STATE_ENGLISH_M2
from mocks.tests_scoring import make_mock

User = get_user_model()
ADMIN_BASE = "/api/mocks/admin/mocks/"


def _expire(att, state, minutes_ago):
    anchor = dict(att.phase_started_at or {})
    anchor[state] = (timezone.now() - timezone.timedelta(minutes=minutes_ago)).isoformat()
    att.phase_started_at = anchor
    att.save(update_fields=["phase_started_at"])


class LateSaveTests(TestCase):
    """The deadline has to hold on EVERY write endpoint, not just submit_module."""

    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, (self.e1, self.e2, self.m1, self.m2) = make_mock()

    def _start(self):
        aid = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json").json()["id"]
        self.c.post(f"/api/mocks/attempts/{aid}/start/", {}, format="json")
        return aid

    def _late(self):
        return {str(q.id): "a" for q in self.e1.questions.all()}

    def test_a_save_after_the_deadline_does_not_bank_late_answers(self):
        aid = self._start()
        att = MockAttempt.objects.get(pk=aid)
        _expire(att, STATE_ENGLISH_M1, minutes_ago=40)  # English module 1 is 32 minutes
        self.c.post(f"/api/mocks/attempts/{aid}/save_attempt/", {"answers": self._late()}, format="json")
        att.refresh_from_db()
        # The module is over: it still closes, but nothing typed after the bell counts.
        self.assertEqual(att.current_state, STATE_ENGLISH_M2)
        self.assertEqual(att.module_answers.get(str(self.e1.id), {}), {})

    def test_answers_saved_before_the_deadline_survive_the_auto_submit(self):
        aid = self._start()
        qid = str(self.e1.questions.first().id)
        self.c.post(f"/api/mocks/attempts/{aid}/save_attempt/", {"answers": {qid: "a"}}, format="json")
        att = MockAttempt.objects.get(pk=aid)
        _expire(att, STATE_ENGLISH_M1, minutes_ago=40)
        self.c.post(f"/api/mocks/attempts/{aid}/save_attempt/", {"answers": self._late()}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.module_answers.get(str(self.e1.id)), {qid: "a"})

    def test_a_background_flush_after_the_deadline_does_not_open_the_next_module(self):
        aid = self._start()
        att = MockAttempt.objects.get(pk=aid)
        _expire(att, STATE_ENGLISH_M1, minutes_ago=40)
        self.c.post(
            f"/api/mocks/attempts/{aid}/save_attempt/",
            {"answers": self._late(), "background": True},
            format="json",
        )
        att.refresh_from_db()
        # The tab is gone. Opening module 2 now would burn its 32 minutes unwatched.
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertEqual(att.module_answers.get(str(self.e1.id), {}), {})

    def test_a_background_flush_inside_the_deadline_still_saves(self):
        aid = self._start()
        qid = str(self.e1.questions.first().id)
        self.c.post(
            f"/api/mocks/attempts/{aid}/save_attempt/",
            {"answers": {qid: "b"}, "background": True},
            format="json",
        )
        att = MockAttempt.objects.get(pk=aid)
        self.assertEqual(att.current_state, STATE_ENGLISH_M1)
        self.assertEqual(att.module_answers.get(str(self.e1.id)), {qid: "b"})

    def test_a_stale_tab_gets_a_409_instead_of_overwriting(self):
        aid = self._start()
        qids = [str(q.id) for q in self.e1.questions.all()]
        # The live tab saves; the attempt's version moves on.
        r = self.c.post(
            f"/api/mocks/attempts/{aid}/save_attempt/",
            {"answers": {qids[0]: "c"}, "expected_version_number": 1},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        # A second tab still believes it is writing on top of version 1.
        stale = self.c.post(
            f"/api/mocks/attempts/{aid}/save_attempt/",
            {"answers": {qids[0]: "a"}, "expected_version_number": 1},
            format="json",
        )
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertIn("attempt", stale.json())
        att = MockAttempt.objects.get(pk=aid)
        self.assertEqual(att.module_answers[str(self.e1.id)][qids[0]], "c")


class MockDeletionTests(TestCase):
    def test_deleting_a_mock_takes_its_modules_and_questions_with_it(self):
        mock, modules = make_mock()
        module_ids = [m.id for m in modules]
        self.assertEqual(Question.objects.filter(module_id__in=module_ids).count(), 16)

        mock.delete()

        self.assertEqual(Module.objects.filter(id__in=module_ids).count(), 0)
        self.assertEqual(Question.objects.filter(module_id__in=module_ids).count(), 0)

    def test_deleting_a_section_still_takes_its_modules(self):
        mock, modules = make_mock()
        section = mock.english_section()
        ids = [section.module1_id, section.module2_id]
        section.delete()
        self.assertEqual(Module.objects.filter(id__in=ids).count(), 0)


class ReaperScheduleTests(TestCase):
    """The reaper is only worth having if something actually runs it."""

    def test_the_sweep_is_registered_on_celery_beat(self):
        from django.conf import settings

        tasks = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
        self.assertIn("mocks.tasks.sweep_mock_attempts_task", tasks)

    def test_the_beat_task_reaps_a_stranded_attempt(self):
        from mocks.state_machine import STATE_COMPLETED
        from mocks.tasks import sweep_mock_attempts_task

        user = User.objects.create(username="ghost", email="g@x.io")
        mock, _mods = make_mock()
        att = MockAttempt.objects.create(mock=mock, student=user)
        att.start_attempt()
        _expire(att, STATE_ENGLISH_M1, minutes_ago=90)  # 32-min module, 58 min overdue

        result = sweep_mock_attempts_task(grace_minutes=30)

        self.assertEqual(result["reaped"], 1)
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_COMPLETED)
        # Freed up: the student can start the mock again.
        MockAttempt.objects.create(mock=mock, student=user)


class MyMocksListTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="s", email="s@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, self.mods = make_mock()

    def _row(self):
        return self.c.get("/api/mocks/mine/").json()["results"][0]

    def test_a_retake_does_not_hide_the_finished_result(self):
        done = MockAttempt.objects.create(
            mock=self.mock, student=self.user, is_completed=True,
            current_state="COMPLETED", total_score=1230, english_score=600, math_score=630,
        )
        row = self._row()
        self.assertTrue(row["submitted"])
        self.assertEqual(row["total_score"], 1230)
        self.assertEqual(row["result_attempt_id"], done.id)

        # Retake starts: the score is still reachable, and Resume points at the new sitting.
        retake = MockAttempt.objects.create(mock=self.mock, student=self.user)
        row = self._row()
        self.assertTrue(row["in_progress"])
        self.assertEqual(row["attempt_id"], retake.id)
        self.assertEqual(row["result_attempt_id"], done.id)
        self.assertEqual(row["total_score"], 1230)


class SectionSubjectTests(TestCase):
    """A mock module carries no practice_test, so the SAT type rule has to come from its section."""

    def setUp(self):
        self.staff = User.objects.create(username="admin", email="a@x.io", is_staff=True, is_superuser=True)
        self.c = APIClient()
        self.c.force_authenticate(self.staff)
        mock_id = self.c.post(ADMIN_BASE, {"title": "Mock"}, format="json").json()["id"]
        self.mock = Mock.objects.get(pk=mock_id)
        self.english = self.mock.english_section().module1
        self.math = self.mock.math_section().module1

    def _post(self, module, payload):
        return self.c.post(f"{ADMIN_BASE}{self.mock.id}/modules/{module.id}/questions/", payload, format="json")

    def _body(self, qtype):
        return {
            "question_type": qtype,
            "question_text": "Q",
            "option_a": "A", "option_b": "B", "option_c": "C", "option_d": "D",
            "correct_answer": "a",
            "score": 10,
        }

    def test_a_math_question_is_rejected_in_the_reading_and_writing_section(self):
        r = self._post(self.english, self._body("MATH"))
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("question_type", r.json())

    def test_a_reading_question_is_rejected_in_the_math_section(self):
        r = self._post(self.math, self._body("READING"))
        self.assertEqual(r.status_code, 400, r.content)

    def test_the_right_types_are_accepted(self):
        self.assertEqual(self._post(self.english, self._body("READING")).status_code, 201)
        self.assertEqual(self._post(self.english, self._body("WRITING")).status_code, 201)
        self.assertEqual(self._post(self.math, self._body("MATH")).status_code, 201)

    def test_a_short_mock_says_how_far_off_the_sat_shape_it_is(self):
        for module in (self.english, self.math):
            self.c.post(
                f"{ADMIN_BASE}{self.mock.id}/modules/{module.id}/questions/",
                self._body("READING" if module is self.english else "MATH"),
                format="json",
            )
        body = self.c.get(f"{ADMIN_BASE}{self.mock.id}/").json()
        warnings = " ".join(body["publish_warnings"])
        self.assertIn("Reading & Writing module 1 has 1 of 27 questions.", warnings)
        self.assertIn("Math module 1 has 1 of 22 questions.", warnings)
        # Advisory only — a short mock still publishes once every module has a question.
        rw = body["sections"][0]["modules"][0]
        self.assertEqual(rw["question_target"], 27)
        self.assertEqual(body["sections"][1]["modules"][0]["question_target"], 22)

    def test_a_csv_row_of_the_wrong_subject_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        csv = (
            "question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,score\n"
            "MATH,\"What is 2+2?\",\"2\",\"4\",\"5\",\"8\",B,10\n"
        ).encode("utf-8")
        r = self.c.post(
            f"{ADMIN_BASE}{self.mock.id}/modules/{self.english.id}/questions/bulk-import/",
            {"file": SimpleUploadedFile("q.csv", csv, content_type="text/csv")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Question.objects.filter(module_id=self.english.id).count(), 0)
