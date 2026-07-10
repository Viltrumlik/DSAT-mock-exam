"""Certificate issuance for the new midterm system (writes classes.MidtermCertificate).

Two flavors:
  * STANDALONE — ``issue_standalone_certificate(attempt_id)`` auto-runs on submit. Instructor =
    the teacher who granted access (grant.granted_by); NO rank / cohort.
  * CLASSROOM  — ``issue_classroom_certificates(midterm, classroom, actor)`` runs when the
    teacher publishes; competition class ranking; flips the schedule's ``results_released``.

Scores are copied FROZEN from ``MidtermAttempt.score`` (never recomputed). The certificate
PDF (``classes.certificate_pdf``) is reused verbatim (already rank-free).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2

from .models import Midterm, MidtermAttempt


def _display_name(user) -> str:
    if user is None:
        return ""
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or getattr(user, "username", None) or getattr(user, "email", "") or f"User {user.pk}"


def _standalone_instructor(student_id: int, midterm_id: int):
    """The teacher who granted this student standalone access (grant.granted_by)."""
    grant = (
        ResourceAccessGrant.objects.filter(
            user_id=student_id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM_V2,
            resource_id=midterm_id,
            classroom__isnull=True,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        .select_related("granted_by")
        .order_by("-id")
        .first()
    )
    return grant.granted_by if grant is not None else None


def _snapshot(*, cert_defaults, midterm: Midterm, student, attempt: MidtermAttempt):
    cert_defaults.update(
        midterm_attempt=attempt,
        student_name=_display_name(student),
        midterm_title=midterm.title,
        subject=midterm.subject,
        score=attempt.score,
        scoring_scale=midterm.scoring_scale,
    )
    return cert_defaults


def issue_standalone_certificate(attempt_id: int):
    """Auto-issue a STANDALONE certificate for a completed midterm attempt. Idempotent."""
    from classes.models_certificates import MidtermCertificate

    attempt = (
        MidtermAttempt.objects.select_related("midterm", "student").filter(pk=attempt_id).first()
    )
    if attempt is None or not attempt.is_completed:
        return None
    midterm = attempt.midterm
    student = attempt.student

    # Only STANDALONE access auto-issues here. A classroom student's certificate is issued
    # by the teacher at publish (class-ranked, publish-gated); auto-issuing a standalone
    # cert for them would be wrong and would leak their score before publish.
    from .access import winning_grant

    grant = winning_grant(student, midterm.id)
    if grant is None or grant.classroom_id:
        return None

    instructor = _standalone_instructor(student.id, midterm.id)
    defaults = _snapshot(
        cert_defaults={
            "classroom": None,
            "mock_exam": None,
            "rank": None,
            "cohort_size": None,
            "issued_by": instructor,
            "issued_by_name": _display_name(instructor),
        },
        midterm=midterm,
        student=student,
        attempt=attempt,
    )
    cert, _created = MidtermCertificate.objects.update_or_create(
        midterm=midterm,
        student=student,
        flavor=MidtermCertificate.FLAVOR_STANDALONE,
        defaults=defaults,
    )
    return cert


def _classroom_cohort_ids(midterm: Midterm, classroom) -> set[int]:
    """Students assigned this midterm in this classroom (active classroom-scoped grants)."""
    return set(
        ResourceAccessGrant.objects.filter(
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM_V2,
            resource_id=midterm.id,
            classroom=classroom,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        ).values_list("user_id", flat=True)
    )


def _latest_completed_attempts(midterm: Midterm, student_ids):
    latest = {}
    qs = MidtermAttempt.objects.filter(
        midterm=midterm, student_id__in=student_ids, is_completed=True
    ).order_by("created_at")
    for att in qs:
        latest[att.student_id] = att  # last write wins
    return latest


def _competition_ranks(finishers):
    """finishers: list of (student_id, score). Ties share a rank (competition ranking)."""
    ordered = sorted(finishers, key=lambda t: -(t[1] if t[1] is not None else -1))
    ranks = {}
    prev_score = object()
    prev_rank = 0
    for i, (sid, score) in enumerate(ordered, start=1):
        if score != prev_score:
            prev_rank = i
            prev_score = score
        ranks[sid] = prev_rank
    return ranks, len(ordered)


@transaction.atomic
def issue_classroom_certificates(midterm: Midterm, classroom, actor, *, force=False) -> dict:
    """Class-ranked issuance + results release for a classroom midterm.

    Requires every assigned student to have finished (unless ``force``). Returns
    ``{ok, issued, certificates}`` or ``{ok: False, reason, ...}``.
    """
    from classes.models_certificates import MidtermCertificate
    from classes.models_schedule import MidtermSchedule

    cohort = _classroom_cohort_ids(midterm, classroom)
    if not cohort:
        return {"ok": False, "reason": "no_students"}
    latest = _latest_completed_attempts(midterm, cohort)
    remaining = len(cohort - set(latest.keys()))
    if remaining and not force:
        return {"ok": False, "reason": "not_all_finished", "remaining": remaining}

    finishers = [(sid, att.score) for sid, att in latest.items()]
    ranks, cohort_size = _competition_ranks(finishers)
    instructor_name = _display_name(actor)

    certs = []
    for sid, attempt in latest.items():
        student = attempt.student
        defaults = _snapshot(
            cert_defaults={
                "mock_exam": None,
                "rank": ranks.get(sid),
                "cohort_size": cohort_size,
                "issued_by": actor,
                "issued_by_name": instructor_name,
            },
            midterm=midterm,
            student=student,
            attempt=attempt,
        )
        cert, _ = MidtermCertificate.objects.update_or_create(
            classroom=classroom,
            midterm=midterm,
            student=student,
            flavor=MidtermCertificate.FLAVOR_CLASSROOM,
            defaults=defaults,
        )
        certs.append(cert)

    # Release results (issuing = revealing scores for the classroom flavor).
    sched, _ = MidtermSchedule.objects.get_or_create(classroom=classroom, midterm=midterm)
    if not sched.results_released:
        sched.results_released = True
        sched.results_released_at = timezone.now()
        sched.released_by = actor
        sched.save(update_fields=["results_released", "results_released_at", "released_by", "updated_at"])

    certs.sort(key=lambda c: (c.rank if c.rank is not None else 10**9))
    return {"ok": True, "issued": len(certs), "certificates": certs}
