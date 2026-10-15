"""The builder's Question Bank changelist — facets, search, ordering, pages, auth (views_changelist)."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from questionbank.models import BankDomain, BankQuestion, BankSkill, QuestionStatus, SourceType, Subject
from questionbank.services import create_bank_question

User = get_user_model()
URL = reverse("questionbank:question-changelist")


def _q(text, *, subject=Subject.ENGLISH, status=QuestionStatus.APPROVED, difficulty="", domain=None, skill=None,
       source=SourceType.MANUAL):
    return create_bank_question(
        subject=subject, question_type="MULTIPLE_CHOICE", question_text=text, status=status,
        domain=domain, skill=skill, difficulty=difficulty,
        option_a="One", option_b="Two", correct_answer="A", source_type=source,
    )


def _options(data, key):
    f = next(f for f in data["filters"] if f["key"] == key)
    return {o["value"]: o["count"] for o in f["options"]}, f["selected"]


class QbChangeListApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        eng = BankDomain.objects.create(subject=Subject.ENGLISH, name="Information & Ideas", code="info-ideas")
        eng_skill = BankSkill.objects.create(domain=eng, name="Central Ideas", code="central-ideas")
        cls.a = _q("The central idea of the passage", difficulty="EASY", domain=eng, skill=eng_skill)
        cls.b = _q("A second central question", status=QuestionStatus.TRIAGE, difficulty="HARD")
        cls.c = _q("Solve 2x = 4", subject=Subject.MATH, status=QuestionStatus.TRIAGE, source=SourceType.PDF_IMPORT)
        cls.admin = User.objects.create_user(
            email="qb-cl-admin@example.com", password="pw", role="super_admin", is_staff=True, is_superuser=True,
        )
        cls.student = User.objects.create_user(email="qb-cl-student@example.com", password="pw", role="student")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_students_and_anonymous_are_refused(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(URL).status_code, (401, 403))

    def test_page_envelope_newest_first(self):
        res = self.client.get(URL)
        self.assertEqual(res.status_code, 200)
        d = res.data
        self.assertEqual((d["count"], d["page"], d["pages"], d["page_size"], d["ordering"]), (3, 1, 1, 50, "-created"))
        self.assertEqual([r["id"] for r in d["results"]], [self.c.id, self.b.id, self.a.id])
        # The rows are the list serializer's, so the builder's row type fits.
        self.assertEqual(d["results"][-1]["domain_name"], "Information & Ideas")
        self.assertEqual([f["key"] for f in d["filters"]], ["subject", "status", "difficulty", "classified", "source"])

    def test_facets_count_with_the_other_filters_applied(self):
        d = self.client.get(URL, {"status": "TRIAGE"}).data
        self.assertEqual(d["count"], 2)
        status, selected = _options(d, "status")
        # A facet ignores its own filter: every status keeps its full count, zeros included.
        self.assertEqual(status, {"IMPORTED": 0, "TRIAGE": 2, "APPROVED": 1, "REJECTED": 0, "ARCHIVED": 0})
        self.assertEqual(selected, "TRIAGE")
        # …and every other facet counts only the triage rows.
        self.assertEqual(_options(d, "subject")[0], {"ENGLISH": 1, "MATH": 1})
        self.assertEqual(_options(d, "difficulty")[0], {"EASY": 0, "MEDIUM": 0, "HARD": 1, "none": 1})
        self.assertEqual(_options(d, "classified")[0], {"yes": 0, "no": 2})
        # Source lists only the sources present.
        self.assertEqual(_options(d, "source")[0], {"MANUAL": 1, "PDF_IMPORT": 1})

    def test_filters_combine_and_unknown_values_are_ignored(self):
        d = self.client.get(URL, {"subject": "ENGLISH", "classified": "no"}).data
        self.assertEqual([r["id"] for r in d["results"]], [self.b.id])
        d = self.client.get(URL, {"difficulty": "none", "source": "PDF_IMPORT"}).data
        self.assertEqual([r["id"] for r in d["results"]], [self.c.id])
        d = self.client.get(URL, {"status": "BOGUS", "subject": "latin"}).data
        self.assertEqual(d["count"], 3)
        self.assertIsNone(_options(d, "status")[1])

    def test_search_needs_every_word(self):
        d = self.client.get(URL, {"q": "central idea"}).data
        self.assertEqual([r["id"] for r in d["results"]], [self.a.id])
        d = self.client.get(URL, {"q": self.c.qb_id}).data
        self.assertEqual([r["id"] for r in d["results"]], [self.c.id])
        # The facets count within the search.
        self.assertEqual(_options(self.client.get(URL, {"q": "central"}).data, "subject")[0], {"ENGLISH": 2, "MATH": 0})

    def test_ordering_and_fallback(self):
        ids = [r["id"] for r in self.client.get(URL, {"o": "created"}).data["results"]]
        self.assertEqual(ids, [self.a.id, self.b.id, self.c.id])
        by_qb = sorted(BankQuestion.objects.all(), key=lambda q: q.qb_id, reverse=True)
        d = self.client.get(URL, {"o": "-qb_id"}).data
        self.assertEqual([r["id"] for r in d["results"]], [q.id for q in by_qb])
        self.assertEqual(self.client.get(URL, {"o": "password"}).data["ordering"], "-created")

    def test_pages_clamp_and_sizes_are_whitelisted(self):
        for i in range(24):
            _q(f"Filler {i}")
        d = self.client.get(URL, {"page_size": 25, "page": 2}).data
        self.assertEqual((d["count"], d["pages"], d["page"], len(d["results"])), (27, 2, 2, 2))
        d = self.client.get(URL, {"page_size": 25, "page": 99}).data
        self.assertEqual(d["page"], 2)
        self.assertEqual(self.client.get(URL, {"page_size": 7}).data["page_size"], 50)
