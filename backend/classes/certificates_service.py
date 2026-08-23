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

Issuance also NOTIFIES: ``MIDTERM_RESULT`` to every finisher whose score the release
actually revealed, and ``CERTIFICATE_READY`` to the same student as a separate message about
a separate page. Both are re-checked against ``exams.views._midterm_results_state`` — the gate
the legacy review endpoint itself reads — so the platform never announces a result it then
refuses to show. This is the mock-exam twin of ``midterms.certificate_service``; the two
publish paths serve different halves of the school and both have to speak.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM
from users.email_utils import display_email

from .models import ClassroomMembership
from .models_certificates import MidtermCertificate
from .models_schedule import MidtermSchedule

logger = logging.getLogger(__name__)
User = get_user_model()


def _display_name(user) -> str:
    name = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    # Never fall through to a synthetic address: Telegram signups carry
    # tg12345@telegram.mastersat.local and it would be printed on the certificate.
    return (
        name
        or getattr(user, "username", None)
        or display_email(getattr(user, "email", None))
        or "Student"
    )


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
    """Flip an EXISTING schedule's results_released flag so students can see their score.

    Never creates the row. A schedule created here would carry no ``starts_at``, and a NULL
    start does not mean "not configured yet" — it means the midterm is open to the whole
    class from this moment (see ``classes.models_schedule``), so publishing results would
    reopen the paper to anyone who had not sat it. With no schedule at all, results are
    already visible (the legacy/unscheduled default), so there is nothing to release.
    """
    schedule = MidtermSchedule.objects.filter(classroom=classroom, mock_exam=mock_exam).first()
    if schedule is None:
        return
    if not schedule.results_released:
        schedule.results_released = True
        schedule.results_released_at = timezone.now()
        schedule.released_by = actor if getattr(actor, "is_authenticated", False) else None
        schedule.save(update_fields=["results_released", "results_released_at", "released_by", "updated_at"])


def _deliver_publish_notifications(*, mock_exam_id: int, title: str, attempts: dict, certs: dict) -> None:
    """Tell each finisher their score is out, and (separately) that their certificate is up.

    ``attempts`` maps ``student_id -> TestAttempt.pk``; ``certs`` maps
    ``student_id -> (certificate_pk, certificate_code)``.

    **The gate is asked, never re-derived.** ``exams.views._midterm_results_state`` is what
    decides whether the legacy review endpoint hands this student a score or withholds it,
    and it is stricter than "we just flipped a flag": it fails closed across EVERY classroom
    the student belongs to, so a student enrolled in two rooms sitting the same paper stays
    gated until both have published. Announcing a result to that student before their other
    room publishes would send them to a page that still says "awaiting result" — the exact
    failure this school has already been burned by once, from the other direction (see
    ``midterms.access.midterm_results_state``'s dual-identity note). If the gate cannot be
    evaluated the student is skipped: silence beats a broken promise.
    """
    from django.contrib.auth import get_user_model

    # The gate itself, not a copy of it. Imported here rather than at module scope because
    # ``exams.views`` is a heavy module that imports back into this app.
    from exams.views import _midterm_results_state
    from notifications import constants as note_const
    from notifications.services import notify

    try:
        students = {u.pk: u for u in get_user_model().objects.filter(pk__in=attempts.keys())}
    except Exception:
        logger.exception("midterm_publish_notify_lookup_failed mock_exam=%s", mock_exam_id)
        return

    for student_id, attempt_id in attempts.items():
        student = students.get(student_id)
        if student is None:
            continue
        try:
            visible = bool(_midterm_results_state(student_id, mock_exam_id).get("results_visible"))
        except Exception:
            logger.exception(
                "midterm_publish_notify_gate_failed mock_exam=%s student=%s", mock_exam_id, student_id
            )
            continue
        if not visible:
            continue

        notify(
            student,
            event=note_const.EVENT_MIDTERM_RESULT,
            title="Your midterm result is ready",
            body=f"{title} — see how you did and what to work on next."[:400],
            # A legacy midterm attempt is an ``exams.TestAttempt``, so its result lives on the
            # exams review page. NOT /midterm/result/<id>: that route resolves its id against
            # ``midterms.MidtermAttempt``, a different table with its own id space, and would
            # open somebody else's paper or nothing at all.
            link_url=f"/review/{attempt_id}",
            dedupe_key=f"midterm-result:legacy{mock_exam_id}:{student_id}",
        )

        # A SECOND notification, not a sentence appended to the first: the breakdown to study
        # and the sheet to print are different things at different addresses.
        cert = certs.get(student_id)
        if not cert:
            continue
        cert_pk, cert_code = cert
        notify(
            student,
            event=note_const.EVENT_CERTIFICATE_READY,
            title="Your certificate is ready",
            body=f"{title} — open it, download it, keep it."[:400],
            link_url=f"/certificate/{cert_code}",
            dedupe_key=f"certificate:{cert_pk}",
        )


def _notify_publish(mock_exam, title: str, attempts: dict, certificates: list) -> None:
    """Queue the publish notifications for after the transaction commits.

    ``issue_certificates`` is ``@transaction.atomic``, so the release flip and the certificate
    rows the gate reads are uncommitted while it runs. Firing inline would announce a publish
    that a later exception rolls back, and point those students at a page still gated.

    Deliberately hooked here and not inside ``_release_results``. That function is a private
    step of exactly this one caller — it is not an independent "results are out" event — so a
    hook there would fire a second time for every publish and split one announcement across
    two sites that would then drift apart.
    """
    payload = dict(
        mock_exam_id=mock_exam.id,
        title=title,
        attempts={sid: att.pk for sid, att in attempts.items()},
        certs={c.student_id: (c.pk, c.code) for c in certificates},
    )
    transaction.on_commit(lambda: _deliver_publish_notifications(**payload))


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

    actor_valid = actor if getattr(actor, "is_authenticated", False) else None
    actor_name = _display_name(actor) if actor_valid else ""
    users = {u.id: u for u in User.objects.filter(id__in=latest.keys())}
    # The new-app Midterm mirroring this legacy MockExam, so the certificate is
    # written under BOTH identities — the student area reads by ``midterm`` FK and
    # would otherwise never see a cert issued under only the ``mock_exam`` FK.
    midterm_mirror = None
    try:
        from midterms.models import Midterm
        midterm_mirror = Midterm.objects.filter(legacy_mock_exam_id=mock_exam.id).first()
    except Exception:  # pragma: no cover - defensive during transition
        midterm_mirror = None
    certificates = []
    for student_id, attempt in latest.items():
        user = users.get(student_id)
        cert, _created = MidtermCertificate.objects.update_or_create(
            classroom=classroom,
            mock_exam=mock_exam,
            student_id=student_id,
            defaults={
                "attempt": attempt,
                "midterm": midterm_mirror,
                "student_name": _display_name(user) if user else f"Student #{student_id}",
                "midterm_title": title,
                "subject": subject,
                "score": attempt.score if attempt.score is not None else 0,
                "scoring_scale": scale,
                "rank": ranks[student_id],
                "cohort_size": cohort_size,
                "issued_by": actor_valid,
                "issued_by_name": actor_name,
            },
        )
        certificates.append(cert)

    # Issuing certificates releases the results so students can see their score.
    _release_results(classroom, mock_exam, actor)

    # ...and tells them so. A publish is silent otherwise: the student has to guess when to
    # look, and the ones who guess wrong find their score a week late.
    _notify_publish(mock_exam, title, latest, certificates)

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
