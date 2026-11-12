"""Studio home's summary (``questionbank/studio.py``): each card's number, the traps, auth, query count.

    SECRET_KEY=t DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 \
      python3 manage.py test questionbank.tests.test_studio_summary --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from assessments.models import AssessmentAttempt, AssessmentQuestion, AssessmentSet, GovernanceEvent, HomeworkAssignment
from classes.models import Assignment, Classroom
from exams.models import PracticeTest
from exams.models import Question as ExamQuestion
from midterms.models import Midterm
from mocks.models import Mock, MockAttempt, MockSection
from mocks.tests_scoring import _module, make_mock
from questionbank import audit
from questionbank.models import (
    BankDomain, BankQuestion, BankSkill, ImportBatch, ImportCandidate, QuestionStatus, Subject, TaxonomyLevel,
)
from questionbank.services import create_bank_question
from questionbank.studio import parse_recent
from vocabulary.models import VocabSection

User = get_user_model()
URL = reverse("questionbank:studio-summary")
CHANGELIST = reverse("questionbank:question-changelist")
_n = 0


def _user(role="student", **kw):
    global _n
    _n += 1
    return User.objects.create_user(f"studio{_n}@example.com", password="x", username=f"studio{_n}", role=role, **kw)


def _bq(text="Q", *, subject=Subject.ENGLISH, status=QuestionStatus.APPROVED, key="A", domain=None, skill=None, **kw):
    q = create_bank_question(
        subject=subject, question_type="MULTIPLE_CHOICE", question_text=text, status=status,
        domain=domain, skill=skill, option_a="One", option_b="Two", correct_answer="A", **kw,
    )
    # create_bank_question may normalise the answer; write the case under test straight to the row.
    BankQuestion.objects.filter(pk=q.pk).update(correct_answer=key)
    q.refresh_from_db()
    return q


class StudioSummaryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = _user("super_admin", is_staff=True, is_superuser=True, first_name="Nodira")
        cls.kamola = _user("admin", first_name="Kamola")
        cls.teacher = _user("teacher", first_name="Doston", subject="english")

        sat = BankDomain.objects.create(subject=Subject.ENGLISH, name="Craft & Structure", code="craft")
        cls.wic = BankSkill.objects.create(domain=sat, name="Words in Context", code="wic")
        cls.cross = BankSkill.objects.create(domain=sat, name="Cross-Text Connections", code="cross")
        # A level's own topic list is not the SAT taxonomy: it never appears in Coverage.
        own = BankDomain.objects.create(subject=Subject.MATH, name="Junior topics", code="jr", level=TaxonomyLevel.JUNIOR)
        BankSkill.objects.create(domain=own, name="Fractions", code="frac")

        # Bank: 3 approved with a skill, review queue of 2 (1 with a suggestion), keys missing 4 ways.
        cls.approved = [_bq(f"ok {i}", domain=sat, skill=cls.wic) for i in range(3)]
        cls.triage = _bq("triage", status=QuestionStatus.TRIAGE)
        BankQuestion.objects.filter(pk=cls.triage.pk).update(suggested_skill=cls.cross)
        cls.triage2 = _bq("triage 2", status=QuestionStatus.TRIAGE, subject=Subject.MATH)
        _bq("imported", status=QuestionStatus.IMPORTED)  # IMPORTED is not the review queue
        cls.null_key = _bq("null key", key=None, domain=sat, skill=cls.wic)
        cls.empty_key = _bq("empty key", key="", domain=sat, skill=cls.wic)
        cls.list_key = _bq("list key", key=[], domain=sat, skill=cls.wic)
        cls.dict_key = _bq("dict key", key={}, domain=sat, skill=cls.wic)

        # Live use of keyless questions: an active approved set (live), a published mock (live),
        # an unpublished past paper (NOT live).
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_ENGLISH, level="junior", title="Homework 3", created_by=cls.admin,
            review_status=AssessmentSet.STATUS_APPROVED, category="Words",
        )
        cls.aset = aset
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="p", question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
            choices=[{"id": "A", "text": "a"}], correct_answer="A", bank_question=cls.null_key,
        )
        cls.live_mock, mods = make_mock()  # published, 4 modules × 4 questions (short of 27 / 22)
        ExamQuestion.objects.filter(pk=mods[0].questions.first().pk).update(bank_question=cls.empty_key)
        paper = PracticeTest.objects.create(subject="READING_WRITING", title="March 2024", is_published=False)
        q = ExamQuestion.objects.create(
            module=paper.modules.get(module_order=1), question_type="READING", question_text="x",
            option_a="A", option_b="B", correct_answers="a", order=0,
        )
        ExamQuestion.objects.filter(pk=q.pk).update(bank_question=cls.list_key)
        PracticeTest.objects.create(subject="MATH", title="Practice 1", is_published=True, is_practice_test=True)

        # Students on the set: 2 done (one twice), 1 still working.
        room = Classroom.objects.create(
            name="Junior J8", subject=Classroom.SUBJECT_ENGLISH, level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD, created_by=cls.teacher, teacher=cls.teacher,
        )
        hw = HomeworkAssignment.objects.create(
            classroom=room, assessment_set=aset, assigned_by=cls.teacher,
            assignment=Assignment.objects.create(classroom=room, created_by=cls.teacher, title="HW", instructions=""),
        )
        s1, s2, s3 = _user(), _user(), _user()
        for s, status in ((s1, "graded"), (s1, "submitted"), (s2, "submitted"), (s3, "in_progress")):
            AssessmentAttempt.objects.create(homework=hw, student=s, status=status)

        # Mid-attempt on the live mock (one attempt per student): 3 active (incl. the break), 1 completed,
        # 1 not started.
        for s, state, done in ((s1, "ENGLISH_M2_ACTIVE", False), (_user(), "BREAK", False), (s2, "MATH_M1_ACTIVE", False),
                               (s3, "COMPLETED", True), (_user(), "NOT_STARTED", False)):
            MockAttempt.objects.create(mock=cls.live_mock, student=s, current_state=state, is_completed=done)

        # A draft mock: R&W 2 has 19 of 27, Math 2 is empty → can't be published.
        cls.draft = Mock.objects.create(title="Full Mock 7", is_published=False)
        MockSection.objects.create(mock=cls.draft, subject="READING_WRITING", module1=_module(1, n=27), module2=_module(2, n=19))
        MockSection.objects.create(mock=cls.draft, subject="MATH", module1=_module(1, n=22, qtype="MATH"), module2=_module(2, n=0, qtype="MATH"))

        # Imports: a READY batch with errors (shown), a PROMOTED one still holding an ERROR row (not shown).
        cls.bad = ImportBatch.objects.create(filename="batch3.pdf", status=ImportBatch.Status.READY, uploaded_by=cls.teacher)
        for v in ("ERROR", "ERROR", "ERROR", "DUPLICATE", "VALID"):
            ImportCandidate.objects.create(batch=cls.bad, validation_status=v)
        old = ImportBatch.objects.create(filename="old.pdf", status=ImportBatch.Status.PROMOTED)
        ImportCandidate.objects.create(batch=old, validation_status="ERROR")

        # Team today: Kamola approved 2, the admin edited 1, an approval two days ago is not today.
        for _ in range(2):
            GovernanceEvent.objects.create(event_type=audit.EVT_APPROVE, actor=cls.kamola, actor_email=cls.kamola.email,
                                           entity_type="BankQuestion", entity_id=cls.approved[0].id)
        GovernanceEvent.objects.create(event_type=audit.EVT_UPDATE, actor=cls.admin, actor_email=cls.admin.email,
                                       entity_type="BankQuestion", entity_id=cls.approved[1].id)
        GovernanceEvent.objects.create(event_type=audit.EVT_APPROVE, actor=cls.kamola, actor_email=cls.kamola.email,
                                       entity_type="BankQuestion", entity_id=cls.approved[2].id,
                                       occurred_at=timezone.now() - timedelta(days=2))
        Mock.objects.filter(pk=cls.live_mock.pk).update(published_at=timezone.now())

        Midterm.objects.create(title="Pre-midterm R&W", subject=Midterm.READING_WRITING, is_published=True)
        VocabSection.objects.create(title="SAT Core", slug="sat-core", order=1)
        VocabSection.objects.create(title="Hard words for 750+", slug="hard", order=2)
        VocabSection.objects.create(title="Idioms", slug="idioms", order=3)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def get(self, **params):
        res = self.client.get(URL, params)
        self.assertEqual(res.status_code, 200, res.content[:300])
        return res.json()

    def test_students_and_anonymous_are_refused(self):
        self.client.force_authenticate(_user())
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(URL).status_code, (401, 403))

    def test_review_queue_is_triage_only(self):
        d = self.get()["review"]
        self.assertEqual((d["count"], d["with_suggestion"]), (2, 1))
        self.assertIsNotNone(d["oldest_at"])

    def test_no_key_counts_every_empty_shape_and_only_live_use(self):
        d = self.get()["no_key"]
        # null, "", [], {} — and of them the set's (null) and the published mock's ("") are live;
        # the unpublished past paper's ([]) is not.
        self.assertEqual((d["count"], d["live"]), (4, 2))

    def test_no_key_agrees_with_the_bank_lists_answer_filter(self):
        res = self.client.get(CHANGELIST, {"answer": "no"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], self.get()["no_key"]["count"])
        options = {o["value"]: o["count"] for o in next(f for f in res.data["filters"] if f["key"] == "answer")["options"]}
        self.assertEqual(options["no"], 4)
        self.assertEqual(options["yes"], BankQuestion.objects.count() - 4)

    def test_without_a_skill_is_the_lists_unclassified(self):
        res = self.client.get(CHANGELIST, {"classified": "no"})
        self.assertEqual(self.get()["no_skill"]["count"], res.data["count"])

    def test_failed_imports_are_ready_batches_with_error_rows(self):
        d = self.get()["imports"]
        self.assertEqual((d["batches"], d["with_errors"]), (2, 1))
        [b] = d["failed"]
        self.assertEqual((b["id"], b["errors"], b["duplicates"], b["by"]), (self.bad.id, 3, 1, "Doston"))

    def test_mocks_publish_rule_gaps_and_mid_attempt(self):
        d = self.get()["mocks"]
        self.assertEqual((d["total"], d["live"], d["incomplete"], d["not_ready_count"]), (2, 1, 2, 1))
        [draft] = d["not_ready"]
        self.assertEqual(draft["title"], "Full Mock 7")
        self.assertFalse(draft["ready"])
        self.assertEqual(draft["block_reason"], "Every module needs at least one question.")
        self.assertEqual(draft["gaps"], [{"module": "R&W 2", "have": 19, "need": 27}, {"module": "Math 2", "have": 0, "need": 22}])
        self.assertEqual(draft["short"], 30)
        # Students in an active state (the break included); completed and not-started don't count.
        self.assertEqual(d["mid_attempt"], [{"id": self.live_mock.id, "title": "Full Mock", "students": 3}])

    def test_team_today(self):
        rows = self.get()["team_today"]
        lines = {(r["who"], r["what"], r["detail"]) for r in rows}
        self.assertIn(("Kamola", "approved 2 questions", ""), lines)
        self.assertIn(("You", "edited 1 question", ""), lines)
        self.assertIn(("Doston", "imported batch #%d" % self.bad.id, "3 rows failed"), lines)
        # Publishing records no actor: the line names nobody.
        self.assertIn((None, "Full Mock published", "full mock"), lines)
        self.assertEqual(sum(1 for r in rows if r["what"].startswith("approved")), 1)  # the old one is not today
        self.assertEqual([r["at"] for r in rows], sorted((r["at"] for r in rows), reverse=True))

    def test_coverage_is_the_sat_taxonomy_only(self):
        d = self.get()["coverage"]
        self.assertEqual((d["target"], d["thin_below"]), (10, 5))
        self.assertEqual({s["name"]: s["approved"] for s in d["skills"]}, {"Words in Context": 7, "Cross-Text Connections": 0})

    def test_library_counts(self):
        lib = self.get()["library"]
        self.assertEqual(lib["questions"]["review"], 2)
        self.assertEqual(lib["questions"]["english"] + lib["questions"]["math"], lib["questions"]["total"])
        self.assertEqual((lib["sets"]["total"], lib["sets"]["live"], lib["sets"]["english"], lib["sets"]["categories"]), (1, 1, 1, 1))
        self.assertEqual((lib["midterms"]["total"], lib["midterms"]["live"], lib["midterms"]["english"]), (1, 1, 1))
        self.assertEqual(lib["vocabulary"], {"sections": 3, "names": ["SAT Core", "Hard words for 750+"]})
        self.assertEqual(lib["pastpapers"], {"total": 1, "live": 0})
        self.assertEqual(lib["practice_tests"], {"total": 1, "live": 1})
        self.assertEqual(lib["mocks"], {"total": 2, "live": 1, "incomplete": 2})
        self.assertEqual(lib["imports"], {"batches": 2, "with_errors": 1})

    def test_recent_items_in_order_unknown_dropped(self):
        recent = f"mock:{self.draft.id},question:{self.triage.id},set:{self.aset.id},question:999999,bogus:1"
        rows = self.get(recent=recent)["recent"]
        self.assertEqual([(r["kind"], r["id"]) for r in rows], [("mock", self.draft.id), ("question", self.triage.id), ("set", self.aset.id)])
        mock, question, aset = rows
        self.assertEqual(mock["gaps"][0], {"module": "R&W 2", "have": 19, "need": 27})
        self.assertTrue(question["needs_skill"])
        self.assertEqual(question["status"], "TRIAGE")
        self.assertEqual((aset["live"], aset["classes"], aset["done"], aset["questions"]), (True, 1, 2, 1))
        self.assertEqual(self.get()["recent"], [])

    def test_parse_recent(self):
        self.assertEqual(parse_recent("question:3, set:4,question:3,mock:x,pastpaper:12345678901,:,"), [("question", 3), ("set", 4)])
        self.assertEqual(len(parse_recent(",".join(f"question:{i}" for i in range(30)))), 8)
        self.assertEqual(parse_recent(None), [])

    def test_query_count_does_not_grow_with_the_bank(self):
        recent = f"mock:{self.draft.id},question:{self.triage.id},set:{self.aset.id}"
        with CaptureQueriesContext(connection) as before:
            self.get(recent=recent)
        for i in range(5):
            _bq(f"more {i}", status=QuestionStatus.TRIAGE, key=None)
        extra = Mock.objects.create(title="Another", is_published=False)
        MockSection.objects.create(mock=extra, subject="MATH", module1=_module(1, n=2, qtype="MATH"))
        b = ImportBatch.objects.create(filename="more.pdf", status=ImportBatch.Status.READY)
        ImportCandidate.objects.create(batch=b, validation_status="ERROR")
        with CaptureQueriesContext(connection) as after:
            self.get(recent=recent)
        self.assertEqual(len(after), len(before))
        self.assertLessEqual(len(before), 30)
