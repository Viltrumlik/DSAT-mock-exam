"""Midterm certificate endpoints (teacher issuance + PDF/ZIP download).

  POST /api/classes/<pk>/midterms/<mock_exam_id>/certificates/issue/          (staff)
  GET  /api/classes/<pk>/midterms/<mock_exam_id>/certificates/download-all/   (staff)
  GET  /api/classes/certificates/midterm/<code>/download/                     (owner|staff|admin)

Issuance computes class rankings, writes frozen certificate snapshots, and releases the
results; PDFs are rendered on demand from those snapshots (``classes/certificate_pdf.py``).
"""

from __future__ import annotations

import io
import re
import zipfile

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from exams.models import MockExam

from .capabilities import classroom_capabilities
from .certificate_pdf import render_midterm_certificate_pdf
from .certificates_service import issue_certificates
from .models_certificates import MidtermCertificate
from .views_rankings import _ClassroomScopedView


def cert_api_path(code: str) -> str:
    """Path (relative to the frontend's ``/api`` axios base) that downloads a certificate."""
    return f"/classes/certificates/midterm/{code}/download/"


def serialize_certificate(cert: MidtermCertificate) -> dict:
    return {
        "code": cert.code,
        "student_id": cert.student_id,
        "student_name": cert.student_name,
        "midterm_title": cert.midterm_title,
        "score": cert.score,
        "score_display": cert.score_display(),
        "rank": cert.rank,
        "cohort_size": cert.cohort_size,
        "download_url": cert_api_path(cert.code),
    }


def _safe_filename(text: str, fallback: str = "certificate") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (text or "").strip()).strip("_")
    return cleaned or fallback


class IssueMidtermCertificatesView(_ClassroomScopedView):
    """Teacher computes rankings, issues certificates, and releases results."""

    def post(self, request, classroom_pk, mock_exam_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response(
                {"detail": "Only the teaching team can issue certificates."},
                status=http.HTTP_403_FORBIDDEN,
            )

        mock_exam = MockExam.objects.filter(pk=mock_exam_id, kind=MockExam.KIND_MIDTERM).first()
        if mock_exam is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        force = str(
            request.data.get("force") or request.query_params.get("force") or ""
        ).strip().lower() in ("1", "true", "yes")

        result = issue_certificates(classroom, mock_exam, request.user, force=force)
        if not result.get("ok"):
            reason = result.get("reason")
            if reason == "not_all_finished":
                return Response(
                    {
                        "detail": "Not all assigned students have finished this midterm yet.",
                        "reason": reason,
                        "remaining": result.get("remaining"),
                    },
                    status=http.HTTP_409_CONFLICT,
                )
            if reason == "no_students":
                return Response(
                    {"detail": "No assigned students to certify.", "reason": reason},
                    status=http.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"detail": "Could not issue certificates.", "reason": reason},
                status=http.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "detail": f"Issued {result['issued']} certificate(s).",
                "issued": result["issued"],
                "certificates": [serialize_certificate(c) for c in result["certificates"]],
            },
            status=http.HTTP_200_OK,
        )


class MidtermCertificatesDownloadAllView(_ClassroomScopedView):
    """Teacher downloads every issued certificate for a midterm as one ZIP."""

    def get(self, request, classroom_pk, mock_exam_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)

        certs = list(
            MidtermCertificate.objects.filter(
                classroom=classroom, mock_exam_id=mock_exam_id
            ).select_related("classroom").order_by("rank")
        )
        if not certs:
            return Response(
                {"detail": "No certificates have been issued for this midterm."},
                status=http.HTTP_404_NOT_FOUND,
            )

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            used: set[str] = set()
            for cert in certs:
                name = f"{cert.rank:02d}_{_safe_filename(cert.student_name, 'student')}.pdf"
                if name in used:
                    name = f"{cert.rank:02d}_{_safe_filename(cert.student_name, 'student')}_{cert.code[:6]}.pdf"
                used.add(name)
                zf.writestr(name, render_midterm_certificate_pdf(cert))

        title = _safe_filename(certs[0].midterm_title, "midterm")
        resp = HttpResponse(buf.getvalue(), content_type="application/zip")
        resp["Content-Disposition"] = f'attachment; filename="certificates-{title}.zip"'
        return resp


class MidtermCertificateDownloadView(APIView):
    """Download a single certificate PDF by its code.

    Allowed for the owning student, any staff member of the certificate's classroom, or a
    global admin (``classroom_capabilities`` treats global admins as staff).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        cert = get_object_or_404(
            MidtermCertificate.objects.select_related("classroom", "mock_exam"), code=code
        )
        user = request.user
        is_owner = user.id == cert.student_id
        is_staff = classroom_capabilities(user, cert.classroom).is_staff
        if not (is_owner or is_staff):
            return Response({"detail": "Not allowed."}, status=http.HTTP_403_FORBIDDEN)

        pdf = render_midterm_certificate_pdf(cert)
        filename = _safe_filename(
            f"certificate-{cert.midterm_title}-{cert.student_name}", "certificate"
        )
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
        return resp
