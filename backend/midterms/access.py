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
from access.resources import RT_MIDTERM_V2

from .models import Midterm, MidtermAttempt

FLAVOR_CLASSROOM = "CLASSROOM"
FLAVOR_STANDALONE = "STANDALONE"


def _active_resource_grants(user):
    now = timezone.now()
    return ResourceAccessGrant.objects.filter(
        user=user,
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2,
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
        return True, "resume"  # an in-progress attempt is always resumable
    if has_completed_attempt(user, midterm):
        return False, "midterm_completed"
    grant = winning_grant(user, midterm)
    if grant is None:
        return False, "no_access"
    # Classroom flavor respects the scheduled access window (standalone has no schedule).
    if grant.classroom_id:
        try:
            from classes.models_schedule import MidtermSchedule

            sched = MidtermSchedule.objects.filter(
                classroom_id=grant.classroom_id, midterm=midterm
            ).first()
            if sched is not None and not sched.is_open():
                return False, ("midterm_not_open" if sched.is_before_start() else "midterm_closed")
        except Exception:  # pragma: no cover - defensive
            pass
    return True, "ok"


def midterm_results_state(attempt) -> dict:
    """Whether the student may see their score, plus any issued certificate.

    A per-student **certificate is the definitive release signal**: the teacher issues
    certificates and releasing results is part of the SAME action, so a student who has
    a certificate has, by definition, had their classroom's results released — show it.

    A classroom-scheduled midterm stays hidden ("awaiting result") until that student
    has a certificate; a standalone / unscheduled midterm is visible once completed.

    DUAL IDENTITY: certificate issuance lives in the legacy classes app and writes the
    schedule + certificate under the ``mock_exam`` FK (``exams.MockExam``); the new
    ``midterms`` app reads by the ``midterm`` FK. We match by EITHER — resolving this
    midterm's ``legacy_mock_exam_id`` — so a cert issued under the legacy identity still
    releases the student's result here. (This was the "teacher issued a certificate but
    the student still saw 'awaiting result'" bug.)
    """
    results_visible = True
    certificate = None

    # The legacy MockExam id this midterm mirrors (None for natively-new midterms).
    legacy_id = (
        Midterm.objects.filter(id=attempt.midterm_id)
        .values_list("legacy_mock_exam_id", flat=True)
        .first()
    )

    def _both_identities() -> Q:
        q = Q(midterm_id=attempt.midterm_id)
        if legacy_id:
            q |= Q(mock_exam_id=legacy_id)
        return q

    # Schedule gate — a classroom midterm hides the score until results are released.
    # Match by EITHER identity and treat "released if ANY matching schedule is
    # released", because certificate issuance flips the flag on the schedule keyed by
    # the LEGACY ``mock_exam`` FK, while a separate ``midterm``-keyed access-window row
    # may still read unreleased. Filtering only by ``midterm_id`` + requiring ALL rows
    # released was the "teacher issued a certificate but the student still saw 'awaiting
    # result'" bug.
    try:
        from classes.models_schedule import MidtermSchedule

        if "midterm" in {f.name for f in MidtermSchedule._meta.get_fields()}:
            scheds = list(MidtermSchedule.objects.filter(_both_identities()))
            if scheds and not any(getattr(s, "results_released", False) for s in scheds):
                results_visible = False
    except Exception:  # pragma: no cover - defensive during transition
        pass

    # Certificate (either identity) — attached for display / download.
    try:
        from classes.models_certificates import MidtermCertificate

        if "midterm" in {f.name for f in MidtermCertificate._meta.get_fields()}:
            cert = (
                MidtermCertificate.objects.filter(Q(student_id=attempt.student_id) & _both_identities())
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
