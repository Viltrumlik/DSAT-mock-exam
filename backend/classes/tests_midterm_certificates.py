"""Midterm certificate tests — ranking, gate, idempotency, PDF, permissions, release."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM
from exams.models import MockExam, PracticeTest, TestAttempt

from classes.models import Classroom, ClassroomMembership
from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from classes.certificate_pdf import render_midterm_certificate_pdf
from classes.certificates_service import issue_certificates

User = get_user_model()


class MidtermCertificateFixture(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("cert_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Cert Class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.students = []
        for i in range(3):
            u = User.objects.create_user(f"cert_s{i}@t.com", "secret123")
            u.first_name, u.last_name = "Stu", f"Dent{i}"
            u.save(update_fields=["first_name", "last_name"])
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
            self.students.append(u)
        self.s0, self.s1, self.s2 = self.students

        self.midterm = MockExam.objects.create(
            title="Algebra Midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_800,
        )
        self.section = PracticeTest.objects.create(
            subject="MATH", label="M", title="sec", collection_name="MID", mock_exam=self.midterm
        )
        for u in self.students:
            ResourceAccessGrant.objects.create(
                user=u, scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM, resource_id=self.midterm.id,
                classroom=self.classroom, status=ResourceAccessGrant.STATUS_ACTIVE,
            )
        self.client = APIClient()

    def _complete(self, student, score, *, completed=True):
        return TestAttempt.objects.create(
            student=student, practice_test=self.section, mock_exam=self.midterm,
            score=score, is_completed=completed,
            current_state="COMPLETED" if completed else "MODULE_1_ACTIVE",
            completed_at=timezone.now() if completed else None,
            submitted_at=timezone.now() if completed else None,
        )

    def _issue_url(self):
        return f"/api/classes/{self.classroom.id}/midterms/{self.midterm.id}/certificates/issue/"

    def _download_all_url(self):
        return f"/api/classes/{self.classroom.id}/midterms/{self.midterm.id}/certificates/download-all/"


class IssuanceLogicTests(MidtermCertificateFixture):
    def test_gate_blocks_until_all_finished(self):
        self._complete(self.s0, 700)
        self._complete(self.s1, 650)
        result = issue_certificates(self.classroom, self.midterm, self.owner)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "not_all_finished")
        self.assertEqual(result["remaining"], 1)
        self.assertEqual(MidtermCertificate.objects.count(), 0)

    def test_ranking_ties_snapshot_and_release(self):
        self._complete(self.s0, 750)
        self._complete(self.s1, 700)
        self._complete(self.s2, 700)  # tie with s1
        result = issue_certificates(self.classroom, self.midterm, self.owner)
        self.assertTrue(result["ok"])
        self.assertEqual(result["issued"], 3)

        ranks = {c.student_id: c.rank for c in MidtermCertificate.objects.all()}
        self.assertEqual(ranks[self.s0.id], 1)
        self.assertEqual(ranks[self.s1.id], 2)
        self.assertEqual(ranks[self.s2.id], 2)

        top = MidtermCertificate.objects.get(student=self.s0)
        self.assertEqual(top.cohort_size, 3)
        self.assertEqual(top.scoring_scale, MockExam.SCALE_800)
        self.assertEqual(top.score_display(), "750 / 800")
        self.assertEqual(top.student_name, "Stu Dent0")

        # Issuing certificates also RELEASES the results.
        sched = MidtermSchedule.objects.get(classroom=self.classroom, mock_exam=self.midterm)
        self.assertTrue(sched.results_released)
        self.assertIsNotNone(sched.results_released_at)

    def test_idempotent_reissue_keeps_code_updates_rank(self):
        self._complete(self.s0, 600)
        self._complete(self.s1, 500)
        self._complete(self.s2, 400)
        issue_certificates(self.classroom, self.midterm, self.owner)
        first = MidtermCertificate.objects.get(student=self.s2)
        code = first.code
        self.assertEqual(first.rank, 3)

        self._complete(self.s2, 800)  # retake tops the class
        issue_certificates(self.classroom, self.midterm, self.owner, force=True)
        self.assertEqual(MidtermCertificate.objects.count(), 3)
        again = MidtermCertificate.objects.get(student=self.s2)
        self.assertEqual(again.code, code)
        self.assertEqual(again.rank, 1)
        self.assertEqual(again.score, 800)


class PanelCohortTests(MidtermCertificateFixture):
    """The panel's all_finished must track the ASSIGNED cohort (granted ∩ active), not the
    whole roster — otherwise an unassigned roster student blocks the issue button forever."""

    def _panel_url(self):
        return f"/api/classes/{self.classroom.id}/midterms/{self.midterm.id}/panel/"

    def test_all_finished_ignores_unassigned_roster_student(self):
        # A roster student who was never granted this midterm.
        outsider = User.objects.create_user("cert_outsider@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=outsider, role=ClassroomMembership.ROLE_STUDENT
        )
        self._complete(self.s0, 700)
        self._complete(self.s1, 650)
        self._complete(self.s2, 600)  # every GRANTED student finished
        self.client.force_authenticate(self.owner)
        data = self.client.get(self._panel_url()).json()
        self.assertTrue(data["all_finished"])
        self.assertEqual(data["summary"]["assigned"], 3)

    def test_not_all_finished_when_assigned_student_pending(self):
        self._complete(self.s0, 700)
        self._complete(self.s1, 650)  # s2 (granted) has NOT finished
        self.client.force_authenticate(self.owner)
        data = self.client.get(self._panel_url()).json()
        self.assertFalse(data["all_finished"])


class CertificatePdfTests(MidtermCertificateFixture):
    def test_render_returns_pdf_bytes(self):
        for s, sc in ((self.s0, 700), (self.s1, 650), (self.s2, 600)):
            self._complete(s, sc)
        issue_certificates(self.classroom, self.midterm, self.owner)
        cert = MidtermCertificate.objects.get(student=self.s0)
        pdf = render_midterm_certificate_pdf(cert)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 500)


class EndpointTests(MidtermCertificateFixture):
    def _complete_all(self):
        self._complete(self.s0, 750)
        self._complete(self.s1, 700)
        self._complete(self.s2, 700)

    def test_student_cannot_issue(self):
        self._complete_all()
        self.client.force_authenticate(self.s0)
        self.assertEqual(self.client.post(self._issue_url()).status_code, 403)

    def test_issue_409_until_all_finished(self):
        self._complete(self.s0, 700)
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._issue_url())
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json().get("remaining"), 2)

    def test_issue_success(self):
        self._complete_all()
        self.client.force_authenticate(self.owner)
        resp = self.client.post(self._issue_url())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["issued"], 3)

    def test_download_permissions(self):
        self._complete_all()
        issue_certificates(self.classroom, self.midterm, self.owner)
        cert = MidtermCertificate.objects.get(student=self.s0)
        url = f"/api/classes/certificates/midterm/{cert.code}/download/"

        self.assertIn(self.client.get(url).status_code, (401, 403))  # anon

        self.client.force_authenticate(self.s0)  # owner
        ok = self.client.get(url)
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok["Content-Type"], "application/pdf")

        self.client.force_authenticate(self.s1)  # another student
        self.assertEqual(self.client.get(url).status_code, 403)

        self.client.force_authenticate(self.owner)  # staff
        self.assertEqual(self.client.get(url).status_code, 200)

        outsider = User.objects.create_user("outsider@t.com", "secret123")
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_download_all_zip(self):
        self._complete_all()
        issue_certificates(self.classroom, self.midterm, self.owner)
        self.client.force_authenticate(self.owner)
        resp = self.client.get(self._download_all_url())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/zip")
        self.assertTrue(resp.content.startswith(b"PK"))

        self.client.force_authenticate(self.s0)
        self.assertEqual(self.client.get(self._download_all_url()).status_code, 403)

    def test_certificate_detail_json(self):
        self._complete_all()
        issue_certificates(self.classroom, self.midterm, self.owner)
        cert = MidtermCertificate.objects.get(student=self.s0)
        url = f"/api/classes/certificates/midterm/{cert.code}/"

        self.client.force_authenticate(self.s0)  # owner
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["student_name"], "Stu Dent0")
        self.assertEqual(data["subject_label"], "MATHEMATICS")
        self.assertTrue(data["number"].startswith("MS-"))
        self.assertTrue(data["teacher_name"])  # issuing teacher snapshot

        self.client.force_authenticate(self.s1)  # non-owner student
        self.assertEqual(self.client.get(url).status_code, 403)
