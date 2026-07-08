"""Certificate tests: standalone auto-issue on submit + PDF download + ranking unit.

    python manage.py test midterms.tests_certificates --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models_certificates import MidtermCertificate
from midterms.certificate_service import _competition_ranks
from midterms.models import Midterm
from midterms.tests_api import make_published_midterm

User = get_user_model()


class StandaloneCertificateTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="t", email="t@x.io", is_staff=True)
        self.student = User.objects.create(username="s", email="s@x.io")
        self.tc = APIClient()
        self.tc.force_authenticate(self.teacher)
        self.sc = APIClient()
        self.sc.force_authenticate(self.student)
        self.mt = make_published_midterm(scale=Midterm.SCALE_800, n=4, correct="a")

    def _complete_as_student(self, correct_n):
        qids = [str(q.id) for q in self.mt.questions()]
        self.tc.post(
            f"/api/midterms/teacher/midterms/{self.mt.id}/grant/",
            {"user_ids": [self.student.id]}, format="json",
        )
        r = self.sc.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        aid = r.json()["id"]
        self.sc.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        ans = {qids[i]: ("a" if i < correct_n else "b") for i in range(4)}
        self.sc.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": ans}, format="json")
        return aid

    def test_standalone_certificate_auto_issued_on_submit(self):
        self._complete_as_student(correct_n=4)  # perfect -> 800
        cert = MidtermCertificate.objects.get(midterm=self.mt, student=self.student)
        self.assertEqual(cert.flavor, MidtermCertificate.FLAVOR_STANDALONE)
        self.assertIsNone(cert.rank)  # NO class ranking for standalone
        self.assertIsNone(cert.cohort_size)
        self.assertIsNone(cert.classroom_id)
        self.assertEqual(cert.score, 800)
        self.assertEqual(cert.score_ceiling, 800)
        self.assertEqual(cert.issued_by_id, self.teacher.id)  # instructor = grantor
        self.assertEqual(cert.midterm_id, self.mt.id)

    def test_review_exposes_certificate_block(self):
        aid = self._complete_as_student(correct_n=2)  # 2/4 -> 500
        r = self.sc.get(f"/api/midterms/attempts/{aid}/review/")
        body = r.json()
        self.assertEqual(body["total_score"], 500)
        self.assertIn("certificate", body)
        self.assertTrue(body["certificate"]["available"])
        self.assertIsNone(body["certificate"]["rank"])

    def test_certificate_pdf_downloads_for_owner(self):
        self._complete_as_student(correct_n=3)
        cert = MidtermCertificate.objects.get(midterm=self.mt, student=self.student)
        r = self.sc.get(f"/api/classes/certificates/midterm/{cert.code}/download/")
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(r.content[:4] == b"%PDF")

    def test_certificate_detail_json(self):
        self._complete_as_student(correct_n=4)
        cert = MidtermCertificate.objects.get(midterm=self.mt, student=self.student)
        r = self.sc.get(f"/api/classes/certificates/midterm/{cert.code}/")
        self.assertEqual(r.status_code, 200, r.content[:200])
        d = r.json()
        self.assertEqual(d["score"], 800)
        self.assertEqual(d["score_ceiling"], 800)
        self.assertIsNone(d["rank"])


class RankingUnitTests(TestCase):
    def test_competition_ranks_ties_share_rank(self):
        ranks, cohort = _competition_ranks([(1, 800), (2, 800), (3, 700), (4, 500)])
        self.assertEqual(cohort, 4)
        self.assertEqual(ranks[1], 1)
        self.assertEqual(ranks[2], 1)  # tie shares rank 1
        self.assertEqual(ranks[3], 3)  # next rank skips 2
        self.assertEqual(ranks[4], 4)

    def test_competition_ranks_none_last(self):
        ranks, cohort = _competition_ranks([(1, None), (2, 600)])
        self.assertEqual(ranks[2], 1)
        self.assertEqual(ranks[1], 2)
