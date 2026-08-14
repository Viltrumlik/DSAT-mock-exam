"""Pastpaper certificates and the error report printed with them.

The report's job is to be *actionable*, and two properties carry that: unclassified questions
are bucketed rather than dropped (so its totals agree with the student's own score), and
skills are ordered worst-first (so the thing to work on is the first thing read).

The certificate's job is to be issuable without anyone approving it, which means the
issuance path has to survive being called on every save of an attempt row.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models_certificates import PastpaperCertificate
from classes.pastpaper_certificate import is_eligible, issue_for_attempt, tier_info_for
from classes.pastpaper_report import UNCLASSIFIED, build_error_report
from exams.models import Module, PracticeTest, Question, TestAttempt
from questionbank.models import BankDomain, BankSkill

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class PastpaperFixture(TestCase):
    """One two-question paper, one completed attempt, one right answer and one wrong."""

    def setUp(self):
        self.student = _u("pc_student@t.com")
        self.paper = PracticeTest.objects.create(
            subject="MATH", label="M", title="Section 1",
            collection_name="SAT March 2024", skip_default_modules=True,
        )
        self.module = Module.objects.create(
            practice_test=self.paper, module_order=1, time_limit_minutes=35
        )
        self.domain = BankDomain.objects.create(name="Algebra", code="algebra")
        self.skill = BankSkill.objects.create(
            domain=self.domain, name="Linear Functions", code="linear-functions"
        )

    def _question(self, order, answer, *, skill=None):
        return Question.objects.create(
            module=self.module, question_type="MATH", correct_answers=answer,
            order=order, question_text=f"q{order}", score=1, skill=skill,
        )

    def _attempt(self, answers, *, score=600, completed=True):
        attempt = TestAttempt.objects.create(
            student=self.student, practice_test=self.paper,
            module_answers={str(self.module.id): answers},
            score=score,
            is_completed=completed,
            current_state=TestAttempt.STATE_COMPLETED if completed else "IN_PROGRESS",
            completed_at=timezone.now() if completed else None,
        )
        return attempt


class ErrorReportTests(PastpaperFixture):
    def test_it_counts_right_and_wrong(self):
        q1 = self._question(1, "A", skill=self.skill)
        q2 = self._question(2, "B", skill=self.skill)
        attempt = self._attempt({str(q1.id): "A", str(q2.id): "C"})

        report = build_error_report(attempt)

        self.assertEqual(report["total"], 2)
        self.assertEqual(report["correct"], 1)
        self.assertEqual(report["wrong"], 1)
        self.assertEqual(report["accuracy"], 50.0)

    def test_a_wrong_answer_carries_both_answers(self):
        """"Wrong" without the right answer is a scolding rather than a lesson."""
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "C"})

        row = build_error_report(attempt)["questions"][0]

        self.assertEqual(row["your_answer"], "C")
        self.assertEqual(row["correct_answer"], "A")
        self.assertEqual(row["skill"], "Linear Functions")

    def test_an_unanswered_question_reads_as_a_dash_not_a_blank(self):
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({})

        row = build_error_report(attempt)["questions"][0]

        self.assertEqual(row["your_answer"], "—")

    def test_unclassified_questions_are_bucketed_not_dropped(self):
        """~2000 legacy questions have no skill. Dropping them would make the report's totals
        disagree with the student's own score — the fastest way to lose their trust in it."""
        q1 = self._question(1, "A")            # no skill
        attempt = self._attempt({str(q1.id): "B"})

        report = build_error_report(attempt)

        self.assertEqual(report["total"], 1)
        self.assertEqual(report["skills"][0]["skill"], UNCLASSIFIED)

    def test_skills_are_ordered_worst_first(self):
        """The point of the report is what to work on, so the weakest skill has to be the
        first thing read rather than something found by scrolling."""
        other_skill = BankSkill.objects.create(
            domain=self.domain, name="Ratios", code="ratios"
        )
        q1 = self._question(1, "A", skill=self.skill)
        q2 = self._question(2, "A", skill=self.skill)
        q3 = self._question(3, "A", skill=other_skill)
        attempt = self._attempt({str(q1.id): "X", str(q2.id): "X", str(q3.id): "X"})

        report = build_error_report(attempt)

        self.assertEqual(report["skills"][0]["skill"], "Linear Functions")   # 2 wrong
        self.assertEqual(report["skills"][0]["wrong"], 2)
        self.assertEqual(report["skills"][1]["skill"], "Ratios")             # 1 wrong

    def test_the_headline_names_the_skill_to_start_with(self):
        q1 = self._question(1, "A", skill=self.skill)
        q2 = self._question(2, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "X", str(q2.id): "X"})

        self.assertIn("Linear Functions", build_error_report(attempt)["headline"])

    def test_a_perfect_paper_has_nothing_to_review(self):
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "A"})

        report = build_error_report(attempt)

        self.assertEqual(report["wrong"], 0)
        self.assertEqual(report["questions"], [])
        self.assertIn("every question correct", report["headline"].lower())

    def test_question_numbers_are_continuous_across_modules(self):
        """A student counts questions 1..N through the paper, not 1..n per module."""
        second = Module.objects.create(
            practice_test=self.paper, module_order=2, time_limit_minutes=35
        )
        q1 = self._question(1, "A", skill=self.skill)
        q2 = Question.objects.create(
            module=second, question_type="MATH", correct_answers="A",
            order=1, question_text="m2q1", score=1, skill=self.skill,
        )
        attempt = TestAttempt.objects.create(
            student=self.student, practice_test=self.paper,
            module_answers={str(self.module.id): {str(q1.id): "X"},
                            str(second.id): {str(q2.id): "X"}},
            score=400, is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(),
        )

        numbers = [q["number"] for q in build_error_report(attempt)["questions"]]

        self.assertEqual(numbers, [1, 2])


class TierTests(TestCase):
    def test_the_scale_runs_from_200_not_zero(self):
        """A student who answers nothing still scores 200. Calling that "a quarter of the way"
        would flatter it."""
        self.assertEqual(tier_info_for(200)["tier_label"], "Emerging")

    def test_a_strong_score_is_distinguished(self):
        self.assertEqual(tier_info_for(760)["tier_label"], "Distinguished")

    def test_the_citation_names_the_paper(self):
        info = tier_info_for(700, paper="SAT March 2024")
        self.assertIn("SAT March 2024", info["citation"])

    def test_a_blank_paper_title_does_not_leave_a_dangling_sentence(self):
        self.assertIn("this paper", tier_info_for(700, paper="")["citation"])

    def test_no_band_names_a_midterm(self):
        """The midterm citations say "midterm", which is simply false here."""
        for score in (200, 400, 600, 800):
            self.assertNotIn("midterm", tier_info_for(score, paper="X")["citation"].lower())

    def test_the_lowest_band_still_leaves_somewhere_to_go(self):
        """A certificate a struggling student is ashamed to show their family is worse than
        no certificate."""
        note = tier_info_for(210)["note"].lower()
        self.assertTrue("fail" not in note and "poor" not in note)


class IssuanceTests(PastpaperFixture):
    def test_a_completed_paper_issues_automatically(self):
        """Nobody approves a pastpaper — the student sat it, they get their certificate."""
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "A"}, score=640)

        cert = PastpaperCertificate.objects.get(attempt=attempt)

        self.assertEqual(cert.score, 640)
        self.assertEqual(cert.paper_title, "SAT March 2024 · Section 1")
        self.assertEqual(cert.questions_correct, 1)

    def test_an_unfinished_attempt_issues_nothing(self):
        q1 = self._question(1, "A", skill=self.skill)
        self._attempt({str(q1.id): "A"}, completed=False)

        self.assertEqual(PastpaperCertificate.objects.count(), 0)

    def test_a_mock_section_is_not_a_pastpaper(self):
        """A mock or midterm section reaches this code path through the same model and must
        not produce a certificate for one section of a longer exam."""
        from exams.models import MockExam

        mock = MockExam.objects.create(title="Full mock")
        section = PracticeTest.objects.create(
            subject="MATH", label="M", title="Mock section", mock_exam=mock,
            skip_default_modules=True,
        )
        attempt = TestAttempt.objects.create(
            student=self.student, practice_test=section, score=700,
            is_completed=True, current_state=TestAttempt.STATE_COMPLETED,
            completed_at=timezone.now(),
        )

        self.assertFalse(is_eligible(attempt))
        self.assertEqual(PastpaperCertificate.objects.filter(attempt=attempt).count(), 0)

    def test_issuing_is_idempotent(self):
        """The signal fires on every save of the attempt row, so the common case must write
        nothing at all."""
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "A"})
        first = PastpaperCertificate.objects.get(attempt=attempt)

        attempt.save()
        issue_for_attempt(attempt)

        self.assertEqual(PastpaperCertificate.objects.filter(attempt=attempt).count(), 1)
        self.assertEqual(PastpaperCertificate.objects.get(attempt=attempt).code, first.code)

    def test_force_refreezes_after_an_answer_key_correction(self):
        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "B"}, score=300)
        self.assertEqual(PastpaperCertificate.objects.get(attempt=attempt).questions_correct, 0)

        q1.correct_answers = "B"      # the key was wrong
        q1.save()
        attempt.score = 700
        attempt.save()
        issue_for_attempt(attempt, force=True)

        cert = PastpaperCertificate.objects.get(attempt=attempt)
        self.assertEqual(cert.score, 700)
        self.assertEqual(cert.questions_correct, 1)

    def test_a_re_sit_earns_its_own_certificate(self):
        """One per attempt, not one per paper — they earned it twice."""
        q1 = self._question(1, "A", skill=self.skill)
        self._attempt({str(q1.id): "A"}, score=600)
        self._attempt({str(q1.id): "A"}, score=700)

        self.assertEqual(PastpaperCertificate.objects.count(), 2)


class PastpaperCertificateApiTests(PastpaperFixture):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.q1 = self._question(1, "A", skill=self.skill)
        self.q2 = self._question(2, "B", skill=self.skill)
        self.attempt = self._attempt({str(self.q1.id): "A", str(self.q2.id): "X"}, score=560)
        self.cert = PastpaperCertificate.objects.get(attempt=self.attempt)

    def test_a_student_reads_their_own_certificate_and_report(self):
        self.client.force_authenticate(self.student)

        body = self.client.get(f"/api/classes/certificates/pastpaper/{self.cert.code}/").json()

        self.assertEqual(body["score"], 560)
        self.assertEqual(body["score_ceiling"], 800)
        self.assertEqual(body["report"]["wrong"], 1)
        self.assertIn("citation", body)

    def test_another_student_cannot(self):
        self.client.force_authenticate(_u("pc_other@t.com"))

        response = self.client.get(f"/api/classes/certificates/pastpaper/{self.cert.code}/")

        self.assertEqual(response.status_code, 403)

    def test_staff_can(self):
        self.client.force_authenticate(_u("pc_admin@t.com", role=C.ROLE_ADMIN))

        response = self.client.get(f"/api/classes/certificates/pastpaper/{self.cert.code}/")

        self.assertEqual(response.status_code, 200)

    def test_the_report_endpoint_works_without_a_certificate(self):
        """It is the review screen's endpoint, so it has to work for an attempt that never
        earned one."""
        PastpaperCertificate.objects.all().delete()
        self.client.force_authenticate(self.student)

        body = self.client.get(
            f"/api/classes/pastpapers/attempts/{self.attempt.pk}/report/"
        ).json()

        self.assertEqual(body["wrong"], 1)
        self.assertIsNone(body["certificate_code"])

    def test_an_unfinished_paper_has_no_report(self):
        """Showing one mid-sitting would hand a student the answer key to questions they have
        not submitted yet."""
        unfinished = self._attempt({}, completed=False)
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f"/api/classes/pastpapers/attempts/{unfinished.pk}/report/"
        )

        self.assertEqual(response.status_code, 400)

    def test_a_student_cannot_read_somebody_elses_report(self):
        self.client.force_authenticate(_u("pc_nosy@t.com"))

        response = self.client.get(
            f"/api/classes/pastpapers/attempts/{self.attempt.pk}/report/"
        )

        self.assertEqual(response.status_code, 403)

    def test_a_student_cannot_reissue_their_own_certificate(self):
        """Re-issuing changes the printed score — a student pressing it after a downward
        correction would be watching their own certificate get worse."""
        self.client.force_authenticate(self.student)

        response = self.client.post(
            f"/api/classes/pastpapers/attempts/{self.attempt.pk}/certificate/reissue/"
        )

        self.assertEqual(response.status_code, 403)


class TemplateRenderTests(PastpaperFixture):
    """The HTML renders without Chromium — the template itself is worth testing separately
    from whether the box can print it."""

    def test_the_certificate_html_carries_the_students_data(self):
        from classes.pastpaper_certificate_pdf import render_html

        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "X"}, score=430)
        cert = PastpaperCertificate.objects.get(attempt=attempt)

        html = render_html(cert)

        self.assertIn(cert.student_name, html)
        self.assertIn("430", html)
        self.assertIn("SAT March 2024", html)
        self.assertIn("What to work on", html)          # page 2 present
        self.assertIn("Linear Functions", html)

    def test_a_perfect_paper_gets_no_second_page(self):
        """A student who got everything right is handed a certificate, not a blank page
        headed "What to work on"."""
        from classes.pastpaper_certificate_pdf import render_html

        q1 = self._question(1, "A", skill=self.skill)
        attempt = self._attempt({str(q1.id): "A"}, score=800)
        cert = PastpaperCertificate.objects.get(attempt=attempt)

        html = render_html(cert)

        self.assertNotIn("What to work on", html)
