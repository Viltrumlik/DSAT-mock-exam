"""A level's own topic list — the learning center's junior and foundation math topics —
beside the SAT taxonomy.

Three promises, each pinned here:

* a junior or foundation math midterm is tagged from that level's topics and from nothing
  else: the builder's picker endpoint, and a CSV import into one of its modules, see only
  that list — not the SAT taxonomy and not the OTHER level's curriculum;
* nothing else ever sees them — every other picker and every name-matching import stays
  on the SAT taxonomy exactly as before, so a curriculum topic cannot reach the bank;
* each list is the school's, in the school's order and in the school's words.

The fixtures reuse the name "Circles" in all three lists on purpose: a module must resolve
the one ITS list offers. The foundation names carry an apostrophe, which the school, a
teacher's keyboard and Excel each spell differently — matching folds them.
"""

from __future__ import annotations

import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest
from exams.question_csv_import import _midterm_level, _norm_key, _skill_index
from midterms.models import Midterm
from questionbank.models import BankDomain, BankSkill, Subject, TaxonomyLevel

User = get_user_model()

_ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1", "questions.mastersat.uz"]
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}

_migration = importlib.import_module("questionbank.migrations.0007_junior_math_topics")
_foundation = importlib.import_module("questionbank.migrations.0008_foundation_math_topics")


def _taxonomy():
    """A small SAT taxonomy plus a junior and a foundation list. Clears whatever the data
    migrations seeded first, so each test states the whole taxonomy it runs against."""
    BankSkill.objects.all().delete()
    BankDomain.objects.all().delete()
    algebra = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra", display_order=1)
    craft = BankDomain.objects.create(subject=Subject.ENGLISH, name="Craft and Structure", code="craft")
    junior = BankDomain.objects.create(
        subject=Subject.MATH, name="Junior Math", code="junior-math",
        level=TaxonomyLevel.JUNIOR, display_order=100,
    )
    foundation = BankDomain.objects.create(
        subject=Subject.MATH, name="Foundation Math", code="foundation-math",
        level=TaxonomyLevel.FOUNDATION, display_order=101,
    )
    return {
        "sat_circles": BankSkill.objects.create(domain=algebra, name="Circles", code="circles"),
        "words": BankSkill.objects.create(domain=craft, name="Words in Context", code="wic"),
        "percent": BankSkill.objects.create(domain=junior, name="Percent", code="percent", display_order=0),
        "junior_circles": BankSkill.objects.create(domain=junior, name="Circles", code="circles", display_order=1),
        "kasrlar": BankSkill.objects.create(
            domain=foundation, name="O'nli kasrlar", code="onli-kasrlar", display_order=0,
        ),
        "foundation_circles": BankSkill.objects.create(
            domain=foundation, name="Circles", code="circles", display_order=1,
        ),
    }


def _staff():
    return User.objects.create_user(
        email="topics-admin@example.com", password="pw", role="super_admin", is_staff=True, is_superuser=True,
    )


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class TopicPickerTests(TestCase):
    URL = "/api/questionbank/taxonomy/"

    def setUp(self):
        self.tax = _taxonomy()
        self.client = APIClient()
        self.client.force_authenticate(_staff())

    def _domains(self, **params):
        r = self.client.get(self.URL, params, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        return r.data["results"]

    def test_a_junior_math_question_gets_the_junior_list_and_nothing_else(self):
        results = self._domains(subject="MATH", level="junior")
        self.assertEqual([d["domain"] for d in results], ["Junior Math"])
        self.assertEqual(results[0]["level"], "junior")
        self.assertEqual([s["name"] for s in results[0]["skills"]], ["Percent", "Circles"])

    def test_a_foundation_math_question_gets_the_foundation_list_and_nothing_else(self):
        results = self._domains(subject="MATH", level="foundation")
        self.assertEqual([d["domain"] for d in results], ["Foundation Math"])
        self.assertEqual(results[0]["level"], "foundation")
        self.assertEqual([s["name"] for s in results[0]["skills"]], ["O'nli kasrlar", "Circles"])

    def test_one_curriculum_never_offers_the_others_topics(self):
        junior = self._domains(subject="MATH", level="junior")
        foundation = self._domains(subject="MATH", level="foundation")
        self.assertNotIn("Foundation Math", [d["domain"] for d in junior])
        self.assertNotIn("Junior Math", [d["domain"] for d in foundation])
        # Same name, two lists: each level resolves its OWN row, never the other's.
        self.assertEqual(junior[0]["skills"][1]["id"], self.tax["junior_circles"].id)
        self.assertEqual(foundation[0]["skills"][1]["id"], self.tax["foundation_circles"].id)

    def test_without_a_level_it_is_the_sat_taxonomy_as_before(self):
        self.assertEqual([d["domain"] for d in self._domains(subject="MATH")], ["Algebra"])
        self.assertEqual(
            {d["domain"] for d in self._domains()}, {"Algebra", "Craft and Structure"},
        )
        self.assertEqual(self._domains(subject="MATH")[0]["level"], "")

    def test_a_level_with_no_list_of_its_own_gets_the_sat_taxonomy(self):
        self.assertEqual([d["domain"] for d in self._domains(subject="MATH", level="middle")], ["Algebra"])
        # There are no junior ENGLISH topics, so a junior R&W midterm keeps the SAT skills.
        self.assertEqual(
            [d["domain"] for d in self._domains(subject="READING_WRITING", level="junior")],
            ["Craft and Structure"],
        )

    def test_the_question_bank_pickers_never_offer_a_curriculum_topic(self):
        r = self.client.get("/api/questionbank/domains/", {"subject": "MATH"}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([d["name"] for d in r.data], ["Algebra"])
        r = self.client.get("/api/questionbank/skills/", {"subject": "MATH"}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([s["id"] for s in r.data], [self.tax["sat_circles"].id])


class CsvSkillColumnTests(TestCase):
    def setUp(self):
        self.tax = _taxonomy()

    def _legacy_module(self, level):
        exam = MockExam.objects.create(
            title="Junior Math Midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_level=level, midterm_scoring_scale=MockExam.SCALE_100, midterm_module_count=1,
        )
        pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=exam, title="Math", skip_default_modules=True,
        )
        return Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=30)

    def test_a_junior_midterm_module_resolves_the_junior_topics(self):
        module = self._legacy_module("junior")
        self.assertEqual(_midterm_level(module), "junior")
        index = _skill_index("MATH", _midterm_level(module))
        self.assertEqual(index["percent"], self.tax["percent"].id)
        self.assertEqual(index["circles"], self.tax["junior_circles"].id)

    def test_a_foundation_midterm_module_resolves_the_foundation_topics(self):
        module = self._legacy_module("foundation")
        self.assertEqual(_midterm_level(module), "foundation")
        index = _skill_index("MATH", _midterm_level(module))
        self.assertEqual(index["circles"], self.tax["foundation_circles"].id)
        # The junior list is a different curriculum, not a fallback for this one.
        self.assertNotIn("percent", index)

    def test_an_uzbek_apostrophe_resolves_however_it_was_typed(self):
        """The school's document, a phone keyboard and Excel each write a different
        apostrophe. All of them must find "O'nli kasrlar"."""
        index = _skill_index("MATH", "foundation")
        for spelling in ("O'nli kasrlar", "O\u2019nli kasrlar", "O\u02bbnli kasrlar", "ONLI KASRLAR"):
            with self.subTest(spelling=spelling):
                self.assertEqual(index[_norm_key(spelling)], self.tax["kasrlar"].id)

    def test_every_other_module_resolves_the_sat_taxonomy_only(self):
        module = self._legacy_module("middle")
        index = _skill_index("MATH", _midterm_level(module))
        self.assertEqual(index["circles"], self.tax["sat_circles"].id)
        self.assertNotIn("percent", index)
        # A module that belongs to no midterm (a pastpaper) has no level at all.
        self.assertEqual(_midterm_level(Module.objects.create(module_order=1, time_limit_minutes=30)), "")

    def test_a_new_model_midterm_module_carries_its_midterms_level(self):
        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        Midterm.objects.create(
            title="Junior Math Midterm", subject=Midterm.MATH, level="junior",
            duration_minutes=30, question_module=module,
        )
        self.assertEqual(_midterm_level(module), "junior")


class JuniorMathTopicsMigrationTests(TestCase):
    def setUp(self):
        BankSkill.objects.all().delete()
        BankDomain.objects.all().delete()

    def test_the_list_is_the_schools_in_the_schools_order(self):
        _migration.add_topics(django_apps, None)
        domain = BankDomain.objects.get(code="junior-math")
        self.assertEqual((domain.subject, domain.level, domain.name), ("MATH", "junior", "Junior Math"))
        names = list(domain.skills.order_by("display_order").values_list("name", flat=True))
        self.assertEqual(names, _migration.JUNIOR_MATH_TOPICS)
        self.assertEqual(len(names), 27)
        self.assertEqual(names[0], "Exponents and Their Properties")
        self.assertEqual(names[-1], "Volume and Surface Area")
        # The list repeats its revision lesson four times; it is one topic.
        self.assertEqual(sum(1 for n in names if n.startswith("Takrorlash")), 1)

    def test_running_it_again_changes_nothing(self):
        _migration.add_topics(django_apps, None)
        _migration.add_topics(django_apps, None)
        self.assertEqual(BankDomain.objects.filter(code="junior-math").count(), 1)
        self.assertEqual(BankSkill.objects.filter(domain__code="junior-math").count(), 27)

    def test_it_sits_after_the_sat_domains_and_outside_them(self):
        _migration.add_topics(django_apps, None)
        algebra = BankDomain.objects.create(subject="MATH", name="Algebra", code="algebra", display_order=1)
        self.assertEqual(list(BankDomain.objects.filter(subject="MATH")), [algebra, BankDomain.objects.get(code="junior-math")])
        self.assertEqual(list(BankDomain.objects.sat().filter(subject="MATH")), [algebra])


class FoundationMathTopicsMigrationTests(TestCase):
    def setUp(self):
        BankSkill.objects.all().delete()
        BankDomain.objects.all().delete()

    def test_the_list_is_the_schools_in_the_schools_order(self):
        _foundation.add_topics(django_apps, None)
        domain = BankDomain.objects.get(code="foundation-math")
        self.assertEqual(
            (domain.subject, domain.level, domain.name), ("MATH", "foundation", "Foundation Math"),
        )
        names = list(domain.skills.order_by("display_order").values_list("name", flat=True))
        self.assertEqual(names, _foundation.FOUNDATION_MATH_TOPICS)
        self.assertEqual(len(names), 11)
        self.assertEqual(names[0], "Musbat va manfiy sonlar ustida amallar")
        self.assertEqual(names[-1], "Revision")
        # The school writes this syllabus in Uzbek; the names are not translated.
        self.assertIn("O'nli kasrlar/ O'nli va oddiy kasrlar ustida amallar", names)

    def test_running_it_again_changes_nothing(self):
        _foundation.add_topics(django_apps, None)
        _foundation.add_topics(django_apps, None)
        self.assertEqual(BankDomain.objects.filter(code="foundation-math").count(), 1)
        self.assertEqual(BankSkill.objects.filter(domain__code="foundation-math").count(), 11)

    def test_it_is_a_second_list_beside_junior_not_a_replacement(self):
        _migration.add_topics(django_apps, None)
        _foundation.add_topics(django_apps, None)
        self.assertEqual(BankSkill.objects.filter(domain__code="junior-math").count(), 27)
        self.assertEqual(BankSkill.objects.filter(domain__code="foundation-math").count(), 11)
        # Neither reaches the question bank.
        self.assertEqual(list(BankDomain.objects.sat().filter(subject="MATH")), [])

    def test_reversing_it_leaves_the_junior_list_alone(self):
        _migration.add_topics(django_apps, None)
        _foundation.add_topics(django_apps, None)
        _foundation.remove_topics(django_apps, None)
        self.assertFalse(BankDomain.objects.filter(code="foundation-math").exists())
        self.assertEqual(BankSkill.objects.filter(domain__code="junior-math").count(), 27)
