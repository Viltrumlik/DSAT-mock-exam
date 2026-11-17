"""A level's own midterm topic list, managed by an admin from the builder.

    python manage.py test questionbank.tests.test_topic_lists --settings=config.settings_test_nomigrations

The promises pinned here:

* an admin adds, renames, reorders, retires and restores a junior/foundation topic; a
  teacher or a student cannot; the SAT taxonomy is out of reach (404);
* a new topic is offered by the builder's picker at once, and a retired one is not —
  except, flagged, to a question that already carries it;
* nothing newly tags a retired topic (question save, CSV import), but a question that
  already carries one still saves;
* a used topic is never deleted, and renaming one never rewrites graded history.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question
from exams.question_csv_import import import_questions_csv
from midterms.tests_report import make_midterm, sit
from questionbank.models import BankDomain, BankSkill, Subject, TaxonomyLevel

User = get_user_model()

_ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1", "questions.mastersat.uz"]
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}

PICKER = "/api/questionbank/taxonomy/"
LISTS = "/api/questionbank/topic-lists/"


def _taxonomy():
    """An SAT domain plus the junior list, on a clean slate (the data migrations' lists
    are cleared so every test states the whole taxonomy it runs against)."""
    BankSkill.objects.all().delete()
    BankDomain.objects.all().delete()
    algebra = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra", display_order=1)
    junior = BankDomain.objects.create(
        subject=Subject.MATH, name="Junior Math", code="junior-math", level=TaxonomyLevel.JUNIOR, display_order=100,
    )
    return {
        "algebra": algebra,
        "junior": junior,
        "sat_linear": BankSkill.objects.create(domain=algebra, name="Linear functions", code="linear-functions"),
        "percent": BankSkill.objects.create(domain=junior, name="Percent", code="percent", display_order=0),
        "circles": BankSkill.objects.create(domain=junior, name="Circles", code="circles", display_order=1),
    }


def _user(role, email):
    extra = {"subject": "math"} if role == "teacher" else {}
    return User.objects.create_user(email=email, password="pw", role=role, **extra)


def _client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class TopicApiTests(TestCase):
    def setUp(self):
        self.tax = _taxonomy()
        self.admin = _user("admin", "topics-admin@example.com")
        self.c = _client(self.admin)

    def _topics_url(self, domain=None):
        return f"{LISTS}{(domain or self.tax['junior']).id}/topics/"

    def _picker(self, client=None, **params):
        r = (client or self.c).get(PICKER, {"subject": "MATH", "level": "junior", **params}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        return r.data

    # ── listing ────────────────────────────────────────────────────────────────
    def test_the_lists_are_the_level_lists_only_with_their_topics_in_order(self):
        r = self.c.get(LISTS, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([d["name"] for d in r.data["results"]], ["Junior Math"])
        junior = r.data["results"][0]
        self.assertEqual(junior["level"], "junior")
        self.assertEqual(junior["level_label"], "Junior")
        self.assertEqual([t["name"] for t in junior["topics"]], ["Percent", "Circles"])
        self.assertEqual(junior["topics"][0]["questions"], 0)
        self.assertFalse(junior["topics"][0]["retired"])

    # ── add ────────────────────────────────────────────────────────────────────
    def test_an_admin_adds_a_topic_and_the_picker_offers_it_at_the_end(self):
        r = self.c.post(self._topics_url(), {"name": "  Quadratic   Equations "}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["name"], "Quadratic Equations")
        self.assertEqual(r.data["code"], "quadratic-equations")
        self.assertEqual(r.data["order"], 2)
        skills = self._picker()["results"][0]["skills"]
        self.assertEqual([s["name"] for s in skills], ["Percent", "Circles", "Quadratic Equations"])

    def test_a_name_already_in_the_list_is_refused_however_it_is_spelt(self):
        for spelling in ("percent", "PERCENT", " Percent "):
            with self.subTest(spelling=spelling):
                r = self.c.post(self._topics_url(), {"name": spelling}, format="json", **_QHOST)
                self.assertEqual(r.status_code, 400, r.content)
                self.assertIn("already in Junior Math", r.data["detail"])
        self.assertEqual(self.tax["junior"].skills.count(), 2)

    def test_an_apostrophe_spelt_another_way_is_the_same_name(self):
        self.c.post(self._topics_url(), {"name": "O'nli kasrlar"}, format="json", **_QHOST)
        r = self.c.post(self._topics_url(), {"name": "O’nli kasrlar"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_name_equal_to_another_topics_code_is_refused(self):
        # The CSV importer matches by name OR code; two topics answering "circles" would
        # make an import ambiguous.
        BankSkill.objects.filter(pk=self.tax["circles"].pk).update(name="Aylana")
        r = self.c.post(self._topics_url(), {"name": "Circles"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_retired_name_says_restore_it(self):
        BankSkill.objects.filter(pk=self.tax["percent"].pk).update(retired_at="2026-11-17T10:00:00Z")
        r = self.c.post(self._topics_url(), {"name": "Percent"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("Restore it", r.data["detail"])

    def test_a_blank_name_is_refused(self):
        r = self.c.post(self._topics_url(), {"name": "   "}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    def test_two_names_with_one_slug_get_two_codes(self):
        self.c.post(self._topics_url(), {"name": "Angles!"}, format="json", **_QHOST)
        r = self.c.post(self._topics_url(), {"name": "Angles?"}, format="json", **_QHOST)
        # Two different names (the importer keeps punctuation) that slugify alike.
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["code"], "angles-2")

    # ── rename ─────────────────────────────────────────────────────────────────
    def test_a_rename_keeps_the_code(self):
        r = self.c.patch(f"/api/questionbank/topics/{self.tax['percent'].id}/", {"name": "Foiz"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.tax["percent"].refresh_from_db()
        self.assertEqual((self.tax["percent"].name, self.tax["percent"].code), ("Foiz", "percent"))

    def test_a_rename_onto_another_topics_name_is_refused(self):
        r = self.c.patch(f"/api/questionbank/topics/{self.tax['percent'].id}/", {"name": "circles"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_rename_that_only_changes_case_is_allowed(self):
        r = self.c.patch(f"/api/questionbank/topics/{self.tax['percent'].id}/", {"name": "PERCENT"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)

    # ── retire / restore ───────────────────────────────────────────────────────
    def test_retire_hides_it_from_the_picker_and_restore_brings_it_back(self):
        url = f"/api/questionbank/topics/{self.tax['percent'].id}/"
        r = self.c.patch(url, {"retired": True}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["retired"])
        self.assertEqual([s["name"] for s in self._picker()["results"][0]["skills"]], ["Circles"])
        # The builder asks with include_retired so a question that carries it still names it.
        flagged = self._picker(include_retired="1")["results"][0]["skills"]
        self.assertEqual(flagged[0], {"id": self.tax["percent"].id, "name": "Percent", "retired": True})
        self.assertEqual(flagged[1], {"id": self.tax["circles"].id, "name": "Circles"})

        r = self.c.patch(url, {"retired": False}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([s["name"] for s in self._picker()["results"][0]["skills"]], ["Percent", "Circles"])

    def test_retired_must_be_a_boolean(self):
        r = self.c.patch(f"/api/questionbank/topics/{self.tax['percent'].id}/", {"retired": "yes"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)

    # ── reorder ────────────────────────────────────────────────────────────────
    def test_reorder(self):
        ids = [self.tax["circles"].id, self.tax["percent"].id]
        r = self.c.post(f"{LISTS}{self.tax['junior'].id}/reorder/", {"ids": ids}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 204, r.content)
        self.assertEqual([s["name"] for s in self._picker()["results"][0]["skills"]], ["Circles", "Percent"])

    def test_reorder_must_name_every_topic_of_the_list_once(self):
        url = f"{LISTS}{self.tax['junior'].id}/reorder/"
        for ids in ([self.tax["circles"].id], [self.tax["circles"].id] * 2,
                    [self.tax["circles"].id, self.tax["sat_linear"].id], "nope", ["x"]):
            with self.subTest(ids=ids):
                r = self.c.post(url, {"ids": ids}, format="json", **_QHOST)
                self.assertEqual(r.status_code, 400, r.content)

    # ── delete ─────────────────────────────────────────────────────────────────
    def test_an_unused_topic_can_be_deleted(self):
        r = self.c.delete(f"/api/questionbank/topics/{self.tax['circles'].id}/", **_QHOST)
        self.assertEqual(r.status_code, 204, r.content)
        self.assertFalse(BankSkill.objects.filter(pk=self.tax["circles"].pk).exists())

    def test_a_topic_a_question_uses_is_retire_only(self):
        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        Question.objects.create(
            module=module, question_type="MATH", question_text="Q", correct_answers="a",
            option_a="A", option_b="B", option_c="C", option_d="D", score=10, order=0, skill=self.tax["circles"],
        )
        r = self.c.delete(f"/api/questionbank/topics/{self.tax['circles'].id}/", **_QHOST)
        self.assertEqual(r.status_code, 409, r.content)
        self.assertIn("Retire it instead", r.data["detail"])
        listed = self.c.get(LISTS, **_QHOST).data["results"][0]["topics"]
        self.assertEqual(next(t for t in listed if t["name"] == "Circles")["questions"], 1)

    # ── reach ──────────────────────────────────────────────────────────────────
    def test_the_sat_taxonomy_is_out_of_reach(self):
        r = self.c.post(self._topics_url(self.tax["algebra"]), {"name": "New SAT skill"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 404, r.content)
        for method in ("patch", "delete"):
            with self.subTest(method=method):
                r = getattr(self.c, method)(
                    f"/api/questionbank/topics/{self.tax['sat_linear'].id}/", {"name": "x"}, format="json", **_QHOST,
                )
                self.assertEqual(r.status_code, 404, r.content)
        self.assertEqual(BankSkill.objects.get(pk=self.tax["sat_linear"].pk).name, "Linear functions")

    def test_teachers_and_students_cannot_manage_topics(self):
        for role in ("teacher", "student"):
            with self.subTest(role=role):
                c = _client(_user(role, f"{role}@example.com"))
                self.assertEqual(c.get(LISTS, **_QHOST).status_code, 403)
                r = c.post(self._topics_url(), {"name": "Mine"}, format="json", **_QHOST)
                self.assertEqual(r.status_code, 403, r.content)
                r = c.patch(f"/api/questionbank/topics/{self.tax['percent'].id}/", {"retired": True}, format="json", **_QHOST)
                self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(self.tax["junior"].skills.count(), 2)

    def test_the_picker_offers_new_topic_only_to_an_admin_on_a_level_list(self):
        self.assertTrue(self._picker()["can_manage_topics"])
        self.assertFalse(self._picker(level="middle")["can_manage_topics"])  # SAT skills
        self.assertFalse(self._picker(level="")["can_manage_topics"])
        teacher = _client(_user("teacher", "picker-teacher@example.com"))
        self.assertFalse(self._picker(client=teacher)["can_manage_topics"])


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class RetiredTopicOnQuestionTests(TestCase):
    """Nothing newly tags a retired topic; a question that carries one still saves."""

    def setUp(self):
        self.tax = _taxonomy()
        self.c = _client(_user("admin", "retired-admin@example.com"))
        exam = MockExam.objects.create(
            title="Junior Math Midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH", midterm_level="junior",
            midterm_scoring_scale=MockExam.SCALE_100, midterm_module_count=1,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=exam, title="Math", skip_default_modules=True,
        )
        self.mod = Module.objects.create(practice_test=self.pt, module_order=1, time_limit_minutes=30)
        self.q = Question.objects.create(
            module=self.mod, question_type="MATH", question_text="2 + 2 = ?", correct_answers="a",
            option_a="4", option_b="5", option_c="6", option_d="7", score=10, order=0,
        )
        BankSkill.objects.filter(pk=self.tax["percent"].pk).update(retired_at="2026-11-17T10:00:00Z")

    def _url(self):
        return f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/{self.q.id}/"

    def test_a_retired_topic_cannot_be_newly_set(self):
        r = self.c.patch(self._url(), {"skill": self.tax["percent"].id}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("retired topic", str(r.data["skill"]))

    def test_a_question_that_already_carries_it_still_saves(self):
        Question.objects.filter(pk=self.q.pk).update(skill=self.tax["percent"])
        r = self.c.patch(
            self._url(), {"skill": self.tax["percent"].id, "question_text": "2 + 3 = ?"}, format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.q.refresh_from_db()
        self.assertEqual((self.q.skill_id, self.q.question_text), (self.tax["percent"].id, "2 + 3 = ?"))

    def test_a_csv_row_naming_a_retired_topic_is_told_so(self):
        raw = b"question_text,correct_answer,option_a,option_b,option_c,option_d,skill\nQ,a,1,2,3,4,percent\n"
        created, error = import_questions_csv(module=self.mod, subject="MATH", raw_bytes=raw, cap=100, cap_label="It")
        self.assertEqual(created, [])
        self.assertIn("retired topic", str(error["errors"][0]["errors"]["skill"]))

    def test_a_csv_row_naming_an_active_topic_still_resolves(self):
        raw = b"question_text,correct_answer,option_a,option_b,option_c,option_d,skill\nQ,a,1,2,3,4,Circles\n"
        created, error = import_questions_csv(module=self.mod, subject="MATH", raw_bytes=raw, cap=100, cap_label="It")
        self.assertIsNone(error)
        self.assertEqual(Question.objects.get(pk=created[0]).skill_id, self.tax["circles"].id)


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class TopicHistoryTests(TestCase):
    """Renaming or retiring a topic never rewrites what a student was already shown."""

    def test_a_graded_report_keeps_the_name_it_was_graded_with(self):
        tax = _taxonomy()
        admin = _client(_user("admin", "history-admin@example.com"))
        student = User.objects.create(username="history-student")
        mt = make_midterm(skills=[tax["percent"], tax["circles"]])
        q1, q2 = list(mt.questions())
        attempt = sit(mt, student, {str(q1.id): "b", str(q2.id): "a"}, score=50)

        r = admin.patch(f"/api/questionbank/topics/{tax['percent'].id}/", {"name": "Foiz"}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        r = admin.patch(f"/api/questionbank/topics/{tax['percent'].id}/", {"retired": True}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)

        sc = _client(student)
        report = sc.get(f"/api/midterms/attempts/{attempt.id}/error-report/")
        self.assertEqual(report.status_code, 200, report.content)
        self.assertEqual([s["skill"] for s in report.json()["skills"]], ["Percent"])
        # A used topic stays retire-only.
        r = admin.delete(f"/api/questionbank/topics/{tax['percent'].id}/", **_QHOST)
        self.assertEqual(r.status_code, 409, r.content)
