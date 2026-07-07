"""Midterm certificate issuance — cohort resolution, ranking, upsert, results release.

The teacher triggers ``issue_certificates`` once every assigned student has finished a
midterm. It computes each finisher's class rank, writes a frozen
:class:`~classes.models_certificates.MidtermCertificate` snapshot per student, and
**releases the results** (flips the :class:`~classes.models_schedule.MidtermSchedule`
``results_released`` flag) so students can finally see their score. PDFs are rendered on
demand at download time, so issuance is a fast, purely-DB operation.

"Assigned" is anchored on the persistent ``RT_MIDTERM`` :class:`ResourceAccessGrant`
(which survives the post-result access revoke), so viewing a result never shrinks the
cohort mid-flight.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM

from .models import ClassroomMembership
from .models_certificates import MidtermCertificate
from .models_schedule import MidtermSchedule

logger = logging.getLogger(__name__)
User = get_user_model()


def _display_name(user) -> str:
    name = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    return name or getattr(user, "username", None) or getattr(user, "email", None) or "Student"


def _active_student_ids(classroom) -> set[int]:
    return set(
        classroom.memberships.filter(
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE
        ).values_list("user_id", flat=True)
    )


def _granted_student_ids(classroom, mock_exam) -> set[int]:
    """Students holding a persistent RESOURCE grant for this midterm in this classroom."""
    return set(
        ResourceAccessGrant.objects.filter(
            classroom_id=classroom.pk,
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM,
            resource_id=mock_exam.id,
        ).values_list("user_id", flat=True)
    )


def _latest_completed_attempts(mock_exam, student_ids: set[int]) -> dict[int, object]:
    """Map student_id -> their latest completed TestAttempt for this midterm."""
    from exams.models import TestAttempt

    latest: dict[int, object] = {}
    if not student_ids:
        return latest
    # Ascending created_at → last write per student wins (the latest attempt).
    for a in (
        TestAttempt.objects.filter(
            mock_exam=mock_exam, student_id__in=student_ids, is_completed=True
        ).order_by("created_at")
    ):
        latest[a.student_id] = a
    return latest


def _assigned_cohort(classroom, mock_exam) -> set[int]:
    """Active students who were actually given this midterm.

    Prefer the persistent access grant intersected with the active roster. If no grants
    exist (legacy/edge), fall back to active students who have an attempt for it.
    """
    active = _active_student_ids(classroom)
    granted = _granted_student_ids(classroom, mock_exam)
    assigned = active & granted
    if assigned:
        return assigned
    from exams.models import TestAttempt

    with_attempts = set(
        TestAttempt.objects.filter(mock_exam=mock_exam, student_id__in=active).values_list(
            "student_id", flat=True
        )
    )
    return active & with_attempts


def _rank_by_student(latest: dict[int, object]) -> tuple[dict[int, int], int]:
    """Competition ranking (ties share a rank) by TestAttempt.score descending."""
    ordered = sorted(
        latest.values(), key=lambda a: (a.score if a.score is not None else -1), reverse=True
    )
    ranks: dict[int, int] = {}
    prev_score = object()  # sentinel that never equals a real score
    current_rank = 0
    for idx, a in enumerate(ordered, start=1):
        sc = a.score if a.score is not None else -1
        if sc != prev_score:
            current_rank = idx
            prev_score = sc
        ranks[a.student_id] = current_rank
    return ranks, len(ordered)


def _release_results(classroom, mock_exam, actor) -> None:
    """Flip the schedule's results_released flag so students can see their score."""
    schedule, _ = MidtermSchedule.objects.get_or_create(
        classroom=classroom, mock_exam=mock_exam,
        defaults={"created_by": actor if getattr(actor, "is_authenticated", False) else None},
    )
    if not schedule.results_released:
        schedule.results_released = True
        schedule.results_released_at = timezone.now()
        schedule.released_by = actor if getattr(actor, "is_authenticated", False) else None
        schedule.save(update_fields=["results_released", "results_released_at", "released_by", "updated_at"])


@transaction.atomic
def issue_certificates(classroom, mock_exam, actor, *, force: bool = False) -> dict:
    """Compute rankings, (re)issue certificates for every finisher, and release results.

    Returns ``{"ok": True, "issued": n, "certificates": [MidtermCertificate, ...]}`` on
    success, or ``{"ok": False, "reason": "...", ...}`` when a guard fails.
    """
    from exams.models import MockExam

    if getattr(mock_exam, "kind", None) != MockExam.KIND_MIDTERM:
        return {"ok": False, "reason": "not_a_midterm"}

    assigned = _assigned_cohort(classroom, mock_exam)
    if not assigned:
        return {"ok": False, "reason": "no_students"}

    latest = _latest_completed_attempts(mock_exam, assigned)
    remaining = len(assigned - set(latest))
    if remaining and not force:
        return {"ok": False, "reason": "not_all_finished", "remaining": remaining}

    ranks, cohort_size = _rank_by_student(latest)
    scale = getattr(mock_exam, "midterm_scoring_scale", MockExam.SCALE_100)
    title = mock_exam.title or f"Midterm #{mock_exam.id}"
    subject = getattr(mock_exam, "midterm_subject", "") or ""

    users = {u.id: u for u in User.objects.filter(id__in=latest.keys())}
    certificates = []
    for student_id, attempt in latest.items():
        user = users.get(student_id)
        cert, _created = MidtermCertificate.objects.update_or_create(
            classroom=classroom,
            mock_exam=mock_exam,
            student_id=student_id,
            defaults={
                "attempt": attempt,
                "student_name": _display_name(user) if user else f"Student #{student_id}",
                "midterm_title": title,
                "subject": subject,
                "score": attempt.score if attempt.score is not None else 0,
                "scoring_scale": scale,
                "rank": ranks[student_id],
                "cohort_size": cohort_size,
                "issued_by": actor if getattr(actor, "is_authenticated", False) else None,
            },
        )
        certificates.append(cert)

    # Issuing certificates releases the results so students can see their score.
    _release_results(classroom, mock_exam, actor)

    logger.info(
        "midterm certificates issued classroom=%s midterm=%s count=%s by=%s",
        classroom.pk, mock_exam.id, len(certificates), getattr(actor, "id", None),
    )
    certificates.sort(key=lambda c: c.rank)
    return {"ok": True, "issued": len(certificates), "certificates": certificates}


def certificate_codes_for(classroom, mock_exam_ids: list[int]) -> dict:
    """Issued-state summary for teacher views (one query, no N+1).

    Returns ``{mock_exam_id: {"issued": bool, "issued_at": iso|None,
    "by_student": {student_id: code}}}``.
    """
    out: dict[int, dict] = {
        mid: {"issued": False, "issued_at": None, "by_student": {}} for mid in mock_exam_ids
    }
    if not mock_exam_ids:
        return out
    qs = MidtermCertificate.objects.filter(
        classroom_id=classroom.pk, mock_exam_id__in=mock_exam_ids
    ).values("mock_exam_id", "student_id", "code", "issued_at")
    for row in qs:
        entry = out[row["mock_exam_id"]]
        entry["issued"] = True
        entry["by_student"][row["student_id"]] = row["code"]
        ts = row["issued_at"]
        if ts and (entry["issued_at"] is None or ts.isoformat() > entry["issued_at"]):
            entry["issued_at"] = ts.isoformat()
    return out
