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

    CLASSROOM-flavored access is PUBLISH-GATED: the score (and certificate) stay hidden
    ("awaiting result") until the teacher publishes — publishing releases the classroom's
    schedule AND issues the class-ranked certificates in one action. STANDALONE access is
    visible as soon as the attempt is completed.

    The flavor is decided from the student's WINNING grant (a classroom grant beats a
    standalone one) — NOT merely from whether a ``MidtermSchedule`` row happens to exist.
    A classroom midterm granted without a schedule row (e.g. via the admin access page)
    must still be gated; keying off the schedule alone let those scores leak.

    Release signals, SCOPED TO THE STUDENT'S OWN CLASSROOM (a release of the same midterm
    in a different classroom must never leak here) and matched across the DUAL IDENTITY
    (this midterm's own FK ∪ the legacy ``mock_exam`` FK it mirrors, so a release written
    under the legacy identity still counts):
      * that classroom's ``MidtermSchedule`` has ``results_released=True``, OR
      * a CLASSROOM-flavor certificate for this student in that classroom.
    A STANDALONE auto-certificate is deliberately NOT a release signal — otherwise a
    classroom student's own submit-time auto-cert would unlock their score before publish.
    """
    student_id = attempt.student_id
    midterm_id = attempt.midterm_id

    # The legacy MockExam id this midterm mirrors (None for natively-new midterms).
    legacy_id = (
        Midterm.objects.filter(id=midterm_id)
        .values_list("legacy_mock_exam_id", flat=True)
        .first()
    )

    def _both_identities() -> Q:
        q = Q(midterm_id=midterm_id)
        if legacy_id:
            q |= Q(mock_exam_id=legacy_id)
        return q

    # Flavor + the student's OWN classroom (release must be scoped to it — a release in a
    # DIFFERENT classroom that happens to run the same midterm must never leak here).
    grant = winning_grant(attempt.student, midterm_id)
    classroom_id = grant.classroom_id if grant is not None else None
    classroom_flavored = bool(classroom_id)
    standalone_flavored = grant is not None and not classroom_id

    # Release signal 1 — a released schedule. For a classroom student, only THEIR classroom's
    # schedule counts (any() over the dual-identity rows within that one classroom); with no
    # classroom to scope to (legacy / grant removed) fall back to any matching schedule.
    schedule_released = False
    schedule_exists = False
    try:
        from classes.models_schedule import MidtermSchedule

        if "midterm" in {f.name for f in MidtermSchedule._meta.get_fields()}:
            scheds = list(MidtermSchedule.objects.filter(_both_identities()))
            schedule_exists = bool(scheds)
            relevant = [s for s in scheds if s.classroom_id == classroom_id] if classroom_flavored else scheds
            schedule_released = any(getattr(s, "results_released", False) for s in relevant)
    except Exception:  # pragma: no cover - defensive during transition
        pass

    # Release signal 2 — a CLASSROOM-flavor certificate for this student (scoped to their
    # classroom). A standalone auto-cert must NOT release a classroom result.
    cert = None
    classroom_cert_released = False
    try:
        from classes.models_certificates import MidtermCertificate

        fields = {f.name for f in MidtermCertificate._meta.get_fields()}
        if "midterm" in fields:
            cert_q = Q(student_id=student_id) & _both_identities()
            if classroom_flavored and "classroom" in fields:
                cert_q &= Q(classroom_id=classroom_id)
            cert = MidtermCertificate.objects.filter(cert_q).order_by("-issued_at").first()
            # If the model predates the flavor field, any cert counts.
            if cert is not None:
                classroom_cert_released = (
                    "flavor" not in fields
                    or getattr(cert, "flavor", None) == MidtermCertificate.FLAVOR_CLASSROOM
                )
    except Exception:  # pragma: no cover - defensive during transition
        pass

    released = schedule_released or classroom_cert_released

    if classroom_flavored:
        results_visible = released
    elif standalone_flavored:
        results_visible = True
    elif schedule_exists:
        # No live grant, but a schedule governs this midterm (legacy / grant later removed).
        results_visible = released
    else:
        results_visible = True

    # Surface the certificate only once results are visible — so a gated classroom student
    # never sees a stray standalone auto-cert issued before the classroom issuance guard.
    certificate = None
    if results_visible and cert is not None:
        certificate = {
            "available": True,
            "code": cert.code,
            "download_url": f"/classes/certificates/midterm/{cert.code}/download/",
            "rank": cert.rank,
            "cohort_size": cert.cohort_size,
        }

    return {"results_visible": results_visible, "certificate": certificate}
