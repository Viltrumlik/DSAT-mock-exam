"""Certificate issuance for the new midterm system (writes classes.MidtermCertificate).

Two flavors:
  * STANDALONE — ``issue_standalone_certificate(attempt_id)`` auto-runs on submit. Instructor =
    the teacher who granted access (grant.granted_by); NO rank / cohort.
  * CLASSROOM  — ``issue_classroom_certificates(midterm, classroom, actor)`` runs when the
    teacher publishes; competition class ranking; flips the schedule's ``results_released``.

Scores are copied FROZEN from ``MidtermAttempt.score`` (never recomputed). The certificate
PDF (``classes.certificate_pdf``) is reused verbatim (already rank-free).

A classroom publish also NOTIFIES: ``MIDTERM_RESULT`` to every student whose score the
publish actually revealed, and ``CERTIFICATE_READY`` to the subset who came away with a
certificate. Both are re-checked against ``midterms.access.midterm_results_state`` — the same
gate the student's own result page reads — so the platform can never announce a result it
then refuses to show. See ``_deliver_publish_notifications``.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from users.email_utils import display_email

from .models import Midterm, MidtermAttempt

logger = logging.getLogger(__name__)


def _display_name(user) -> str:
    if user is None:
        return ""
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    # The email fallback prints whatever is in the column onto a printed certificate.
    # For a Telegram signup that column holds tg12345@telegram.mastersat.local, and for
    # a released account a placeholder — neither is a name.
    return (
        full
        or getattr(user, "username", None)
        or display_email(getattr(user, "email", ""))
        or f"User {user.pk}"
    )


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
    """Students in this classroom assigned this midterm — active classroom-scoped grants
    INTERSECTED with current (non-removed) student members.

    A student removed from the classroom must NOT be ranked or certified: their grant can
    linger after removal, and counting them would skew everyone else's rank and inflate the
    cohort size. Normal assignment grants every active member, so this intersection is a
    no-op there and only drops removed / non-member grant-holders.
    """
    from classes.models import ClassroomMembership

    granted = set(
        ResourceAccessGrant.objects.filter(
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM_V2,
            resource_id=midterm.id,
            classroom=classroom,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        ).values_list("user_id", flat=True)
    )
    active_members = set(
        ClassroomMembership.objects.filter(
            classroom=classroom, role=ClassroomMembership.ROLE_STUDENT
        ).exclude(status=ClassroomMembership.STATUS_REMOVED).values_list("user_id", flat=True)
    )
    return granted & active_members


def students_still_to_sit(midterm: Midterm, student_ids) -> set:
    """Who the room is still waiting on — never just "has no completed attempt".

    A student who FAILED and has been granted a re-sit already has a completed attempt, so a
    naive check calls them finished. Publishing then freezes their rank and certificate from
    the sitting they are about to replace, and flips ``results_released`` so they are shown
    that failed score — and nothing recomputes afterwards, because certificates are only ever
    issued by an explicit teacher publish.

    Still to sit, then, is any of: never finished it, holding an unspent re-sit, or currently
    part-way through one.
    """
    from .models import MidtermAttempt, MidtermResit

    ids = set(student_ids)
    if not ids:
        return set()
    finished = set(
        MidtermAttempt.objects.filter(
            midterm=midterm, student_id__in=ids, is_completed=True
        ).values_list("student_id", flat=True)
    )
    owed_a_resit = set(
        MidtermResit.objects.filter(
            midterm=midterm, student_id__in=ids, consumed_at__isnull=True
        ).values_list("student_id", flat=True)
    )
    mid_sitting = set(
        MidtermAttempt.objects.filter(midterm=midterm, student_id__in=ids, is_completed=False)
        .exclude(current_state=MidtermAttempt.STATE_ABANDONED)
        .values_list("student_id", flat=True)
    )
    return (ids - finished) | (ids & (owed_a_resit | mid_sitting))


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


def _deliver_publish_notifications(*, midterm_title: str, attempt_ids: list[int], certs: dict) -> None:
    """Tell each student the publish reached them — score first, certificate second.

    ``certs`` maps ``student_id -> (certificate_pk, certificate_code)``; a student may be
    absent from it and still belong here (see the caller).

    **Every recipient is re-checked against the real gate.** This is not belt-and-braces, it
    is the whole point. The live bug this codebase already paid for
    (``midterms.access.midterm_results_state``'s docstring, and the release-gate suite) was a
    publish that flipped one identity's row while the student area read the other, leaving
    students on "awaiting result" after their teacher had published. A notification saying
    "your result is ready" that lands on a gated page is that bug made louder — the student
    now has a message telling them the platform is broken. So instead of re-deriving who
    ought to be able to see their score, we ask the exact function the result page and
    ``/midterms/mine/`` ask, per student, and notify only where it says yes. If it cannot
    answer, the student is skipped: silence beats a broken promise.
    """
    from notifications import constants as note_const
    from notifications.services import notify

    from .access import midterm_results_state

    try:
        attempts = list(
            MidtermAttempt.objects.filter(pk__in=attempt_ids).select_related("student")
        )
    except Exception:
        logger.exception("midterm_publish_notify_lookup_failed attempts=%s", attempt_ids)
        return

    for attempt in attempts:
        try:
            visible = bool(midterm_results_state(attempt).get("results_visible"))
        except Exception:
            logger.exception("midterm_publish_notify_gate_failed attempt=%s", attempt.pk)
            continue
        if not visible:
            continue

        notify(
            attempt.student,
            event=note_const.EVENT_MIDTERM_RESULT,
            title="Your midterm result is ready",
            body=f"{midterm_title} — see how you did and what to work on next."[:400],
            link_url=f"/midterm/result/{attempt.pk}",
            dedupe_key=f"midterm-result:{attempt.midterm_id}:{attempt.student_id}",
        )

        # A SECOND notification, not a sentence appended to the first. The score and the
        # certificate are different things at different addresses — one is a breakdown to
        # study, the other is a sheet to print — and, as the caller's ``eligible`` filter
        # shows, a student can legitimately have their result released without having a
        # certificate issued from this publish.
        cert = certs.get(attempt.student_id)
        if not cert:
            continue
        cert_pk, cert_code = cert
        notify(
            attempt.student,
            event=note_const.EVENT_CERTIFICATE_READY,
            title="Your certificate is ready",
            body=f"{midterm_title} — open it, download it, keep it."[:400],
            link_url=f"/certificate/{cert_code}",
            dedupe_key=f"certificate:{cert_pk}",
        )


def _notify_publish(midterm: Midterm, attempts_by_student: dict, certificates: list) -> None:
    """Queue the publish notifications for after the transaction commits.

    ``issue_classroom_certificates`` is ``@transaction.atomic``, so everything the gate reads
    — the release flip, the freshly-written certificates — is uncommitted while it runs. Firing
    inline would mean notifying about a publish that a later exception rolls back, and pointing
    every one of those students at a result page that is still gated.
    """
    payload = dict(
        midterm_title=midterm.title or f"Midterm #{midterm.pk}",
        attempt_ids=[att.pk for att in attempts_by_student.values()],
        certs={c.student_id: (c.pk, c.code) for c in certificates},
    )
    transaction.on_commit(lambda: _deliver_publish_notifications(**payload))


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
    still_to_sit = students_still_to_sit(midterm, cohort)
    if still_to_sit and not force:
        return {"ok": False, "reason": "not_all_finished", "remaining": len(still_to_sit)}

    # A force publish issues to the finishers now (a never-shown-up absentee simply has no
    # completed attempt, so they fall out here on their own). But a student who is OWED a
    # re-sit, or is part-way through one, DOES have an old completed attempt — and issuing
    # them a certificate now would freeze the rank and paper they are about to replace, and
    # rank the rest of the class against a mark that is on its way out. Leave them out until
    # they hand the new paper in; a later "Re-calculate" folds them in. (Without --force this
    # never runs: still_to_sit already refused above.)
    eligible = {sid: att for sid, att in latest.items() if sid not in still_to_sit}

    finishers = [(sid, att.score) for sid, att in eligible.items()]
    ranks, cohort_size = _competition_ranks(finishers)
    instructor_name = _display_name(actor)

    certs = []
    for sid, attempt in eligible.items():
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
    #
    # Only ever UPDATE an existing schedule — never create one. A row created here would
    # have no starts_at, and a NULL start is not "unset", it means the exam is open to the
    # whole class right now (see classes.models_schedule): publishing results would hand
    # the paper to anyone who had not sat it. Nothing is lost by skipping it, because an
    # issued CLASSROOM certificate is itself a release signal in midterm_results_state.
    sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
    if sched is not None and not sched.results_released:
        sched.results_released = True
        sched.results_released_at = timezone.now()
        sched.released_by = actor
        sched.save(update_fields=["results_released", "results_released_at", "released_by", "updated_at"])

    # Told, not left to check. A publish is silent to a student otherwise — they have to
    # guess when to look, and the ones who guess wrong find their score a week late.
    #
    # Over ``latest``, deliberately, and not over ``eligible``: a force-published student who
    # is owed a re-sit is dropped from ``eligible`` (their certificate would freeze a paper
    # they are about to replace) but the schedule flip above still reveals the score they
    # already have. Their result IS out; only their certificate is not. Notifying over
    # ``eligible`` would leave exactly those students staring at a newly-visible score nobody
    # mentioned. The gate inside decides each case on its own.
    _notify_publish(midterm, latest, certs)

    certs.sort(key=lambda c: (c.rank if c.rank is not None else 10**9))
    return {"ok": True, "issued": len(certs), "certificates": certs}
