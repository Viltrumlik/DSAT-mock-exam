"""Pastpaper certificate + error report endpoints.

Three surfaces, one ownership rule: a student reads their own, class staff and global staff
read anyone's. The rule lives in `_readable`, so adding a fourth endpoint cannot accidentally
ship without it.

There is no *issue* endpoint. A pastpaper certificate is minted when the paper is completed —
nobody approves it, so nothing needs a button. Only the repair path (`?force=1` for staff)
re-freezes one, and that exists for the case the platform has already seen: an answer key
corrected after students had sat the paper.
"""

from __future__ import annotations

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from access.services import is_global_scope_staff, normalized_role

from .models_certificates import PastpaperCertificate
from .pastpaper_certificate import issue_for_attempt
from .pastpaper_certificate_pdf import render_pdf_safe
from .pastpaper_report import build_error_report


def _is_staff(user) -> bool:
    return bool(getattr(user, "is_superuser", False)) or normalized_role(user) in (
        acc_const.ROLE_SUPER_ADMIN,
        acc_const.ROLE_ADMIN,
        acc_const.ROLE_TEACHER,
    )


def _readable(user, cert) -> bool:
    """Owner, or staff. The single ownership rule for everything in this module."""
    return cert.student_id == user.pk or is_global_scope_staff(user) or _is_staff(user)


def _serialize(cert, *, report=None) -> dict:
    payload = {
        "code": cert.code,
        "number": cert.number,
        "student_name": cert.student_name,
        "paper_title": cert.paper_title,
        "collection_name": cert.collection_name,
        "subject": cert.subject,
        "subject_label": cert.subject_label,
        "score": cert.score,
        "score_ceiling": PastpaperCertificate.SCORE_CEILING,
        "questions_total": cert.questions_total,
        "questions_correct": cert.questions_correct,
        "accuracy": cert.accuracy,
        "issued_at": cert.issued_at,
        "date_display": cert.date_display,
        "attempt_id": cert.attempt_id,
        **cert.tier_info,
    }
    if report is not None:
        payload["report"] = report
    return payload


class PastpaperCertificateDetailView(APIView):
    """One certificate, with its error report, by public code."""

    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        cert = get_object_or_404(
            PastpaperCertificate.objects.select_related("attempt", "student"), code=code
        )
        if not _readable(request.user, cert):
            return Response({"detail": "Not yours."}, status=http.HTTP_403_FORBIDDEN)
        return Response(_serialize(cert, report=build_error_report(cert.attempt)))


class PastpaperCertificateDownloadView(APIView):
    """The PDF — certificate on page 1, error report on page 2."""

    permission_classes = [IsAuthenticated]

    def get(self, request, code):
        cert = get_object_or_404(
            PastpaperCertificate.objects.select_related("attempt", "student"), code=code
        )
        if not _readable(request.user, cert):
            return Response({"detail": "Not yours."}, status=http.HTTP_403_FORBIDDEN)

        pdf = render_pdf_safe(cert)
        if pdf is None:
            # 503, not 500: the certificate exists and the data is fine — the box cannot
            # render right now, and "try again" is honest advice.
            return Response(
                {"detail": "The PDF couldn't be produced right now. Your result is safe."},
                status=http.HTTP_503_SERVICE_UNAVAILABLE,
            )
        response = HttpResponse(pdf, content_type="application/pdf")
        filename = f"MasterSAT-{cert.number}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class AttemptErrorReportView(APIView):
    """The error report for one attempt, whether or not a certificate exists.

    Separate from the certificate because the two answer different questions and a student
    wants the report far more often. It is also the endpoint the review screen uses, so it has
    to work for an attempt that never earned a certificate — a mock section, say.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, attempt_id):
        from exams.models import TestAttempt

        attempt = get_object_or_404(
            TestAttempt.objects.select_related("practice_test", "student"), pk=attempt_id
        )
        if not (attempt.student_id == request.user.pk or _is_staff(request.user)
                or is_global_scope_staff(request.user)):
            return Response({"detail": "Not yours."}, status=http.HTTP_403_FORBIDDEN)
        if not attempt.is_completed:
            # An unfinished paper has no report — showing one mid-sitting would hand a
            # student the answer key to the questions they have not submitted yet.
            return Response(
                {"detail": "This paper isn't finished yet."}, status=http.HTTP_400_BAD_REQUEST
            )

        cert = PastpaperCertificate.objects.filter(attempt=attempt).first()
        return Response({
            "attempt_id": attempt.pk,
            "score": attempt.score,
            "paper_title": getattr(attempt.practice_test, "collection_name", "") or "",
            "certificate_code": cert.code if cert else None,
            **build_error_report(attempt),
        })


class PastpaperCertificateReissueView(APIView):
    """Staff: re-freeze a certificate from the attempt as it stands now.

    The repair path for a corrected answer key. Not a student action — re-issuing changes the
    printed score, and a student pressing it after a downward correction would be watching
    their own certificate get worse.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, attempt_id):
        from exams.models import TestAttempt

        if not (_is_staff(request.user) or is_global_scope_staff(request.user)):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        attempt = get_object_or_404(TestAttempt, pk=attempt_id)
        cert = issue_for_attempt(attempt, force=True)
        if cert is None:
            return Response(
                {"detail": "That attempt doesn't qualify for a certificate."}, status=400
            )
        return Response(_serialize(cert))
