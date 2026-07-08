"""Midterm access resolution — the single start-gate + results-visibility source.

Replaces the three duplicated union queries of the legacy midterm system. Access is
carried by ``access.ResourceAccessGrant`` with ``resource_type='midterm'``. During the
cutover a grant's ``resource_id`` may still be a legacy ``MockExam.id`` — we resolve it
via ``Midterm.legacy_mock_exam_id`` so there is ZERO access gap before the re-key runs.

Two flavors:
  * CLASSROOM  — grant has ``classroom`` set (source=CLASSROOM); class-ranked, publish-gated.
  * STANDALONE — grant has ``classroom = NULL``; instructor = ``granted_by``; no rank; results
                 visible immediately on submit.
"""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM

from .models import Midterm, MidtermAttempt

FLAVOR_CLASSROOM = "CLASSROOM"
FLAVOR_STANDALONE = "STANDALONE"


def _active_resource_grants(user):
    now = timezone.now()
    return ResourceAccessGrant.objects.filter(
        user=user,
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM,
        status=ResourceAccessGrant.STATUS_ACTIVE,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))


def _grant_midterm_id(grant) -> int | None:
    """Resolve a grant's resource_id to a Midterm.id (direct id, else legacy_mock_exam_id)."""
    rid = grant.resource_id
    if rid is None:
        return None
    if Midterm.objects.filter(pk=rid).exists():
        return int(rid)
    m = Midterm.objects.filter(legacy_mock_exam_id=rid).values_list("id", flat=True).first()
    return int(m) if m is not None else None


def granted_midterm_ids(user) -> set[int]:
    """Midterm ids the user currently holds an effective grant for (id-space normalized)."""
    if not user or not getattr(user, "is_authenticated", False):
        return set()
    out: set[int] = set()
    for grant in _active_resource_grants(user).only("resource_id"):
        mid = _grant_midterm_id(grant)
        if mid is not None:
            out.add(mid)
    return out


def resolve_accessible_midterm_ids(user) -> set[int]:
    """All midterm ids the user may see: (published & granted) ∪ (already attempted)."""
    if not user or not getattr(user, "is_authenticated", False):
        return set()
    granted = granted_midterm_ids(user)
    attempted = set(MidtermAttempt.objects.filter(student=user).values_list("midterm_id", flat=True))
    published_granted = set(
        Midterm.objects.filter(id__in=granted, is_published=True).values_list("id", flat=True)
    )
    return published_granted | attempted


def winning_grant(user, midterm) -> "ResourceAccessGrant | None":
    """The grant that governs this (user, midterm) — a classroom grant wins over standalone."""
    candidates = []
    for grant in _active_resource_grants(user):
        if _grant_midterm_id(grant) == int(midterm.id if hasattr(midterm, "id") else midterm):
            candidates.append(grant)
    if not candidates:
        return None
    # Classroom grant (rank cohort) takes precedence over a standalone grant.
    candidates.sort(key=lambda g: (0 if g.classroom_id else 1, -int(g.id)))
    return candidates[0]


def grant_flavor(grant) -> str:
    return FLAVOR_CLASSROOM if (grant is not None and grant.classroom_id) else FLAVOR_STANDALONE


def has_completed_attempt(user, midterm) -> bool:
    return MidtermAttempt.objects.filter(
        student=user, midterm=midterm, is_completed=True
    ).exists()


def can_start_midterm(user, midterm) -> tuple[bool, str]:
    """Whether ``user`` may create/start an attempt for ``midterm``.

    Returns ``(ok, reason)``. Enforces: published, effective grant, and NO-RETAKE (a completed
    attempt refuses a new one). The classroom scheduling window (open/closed) is layered on in
    the certificate/schedule re-home; an in-progress attempt is always resumable.
    """
    if not midterm.is_published:
        return False, "midterm_unpublished"
    active = MidtermAttempt.objects.filter(student=user, midterm=midterm, is_completed=False).exclude(
        current_state=MidtermAttempt.STATE_ABANDONED
    ).first()
    if active is not None:
        return True, "resume"
    if has_completed_attempt(user, midterm):
        return False, "midterm_completed"
    if int(midterm.id) not in granted_midterm_ids(user):
        return False, "no_access"
    return True, "ok"


def midterm_results_state(attempt) -> dict:
    """Whether the student may see their score, plus any issued certificate.

    Standalone (no classroom schedule gating this midterm) -> visible once completed.
    Classroom -> gated by the re-homed ``MidtermSchedule.results_released``.

    Written defensively so it activates automatically once the schedule/certificate re-home
    adds the ``midterm`` FK to those classes-app tables; until then it defaults to visible
    (only ungated standalone midterms exist in the new system).
    """
    results_visible = True
    certificate = None
    try:
        from classes.models_schedule import MidtermSchedule

        sched_fields = {f.name for f in MidtermSchedule._meta.get_fields()}
        if "midterm" in sched_fields:
            scheds = list(MidtermSchedule.objects.filter(midterm_id=attempt.midterm_id))
            if scheds and not all(getattr(s, "results_released", False) for s in scheds):
                results_visible = False
    except Exception:  # pragma: no cover - defensive during transition
        pass

    try:
        from classes.models_certificates import MidtermCertificate

        cert_fields = {f.name for f in MidtermCertificate._meta.get_fields()}
        if "midterm" in cert_fields:
            cert = (
                MidtermCertificate.objects.filter(
                    midterm_id=attempt.midterm_id, student_id=attempt.student_id
                )
                .order_by("-issued_at")
                .first()
            )
            if cert is not None:
                certificate = {
                    "available": True,
                    "code": cert.code,
                    "download_url": f"/classes/certificates/midterm/{cert.code}/download/",
                    "rank": cert.rank,
                    "cohort_size": cert.cohort_size,
                }
    except Exception:  # pragma: no cover - defensive during transition
        pass

    return {"results_visible": results_visible, "certificate": certificate}
