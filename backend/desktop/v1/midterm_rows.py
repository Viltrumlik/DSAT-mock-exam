"""Home's midterm rows: the ``/api/midterms/mine/`` rows, built in a fixed number of queries.

``MyMidtermsView`` answers one midterm at a time: per row it resolves the winning grant (one
query per grant the student holds), the classroom schedule, the release state (schedules,
certificates) and the displayed question count. That is fine for a page a student opens once;
Home is polled every 30 s by a whole class while a midterm is about to open, so here the same
rules run over rows loaded once:

    grants · grant ids → midterms (≤ 2) · attempts · midterms · open re-sits
    · schedules · certificates · versions · question counts per module

About ten queries whatever the student's history. The rules are the website's, line for line —
``midterms.access.{resolve_accessible_midterm_ids, winning_grant, grant_flavor,
midterm_results_state}``, ``MidtermSchedule.{is_open, is_before_start, available_at,
requires_code}`` and ``Midterm.display_question_count`` — and
``desktop/v1/tests/test_home.py`` pins every row against ``/api/midterms/mine/`` field for
field, so the two cannot drift silently.
"""

from __future__ import annotations

from collections import defaultdict

from django.db.models import Count, Q

from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from exams.models import Question
from midterms.access import FLAVOR_CLASSROOM, _active_resource_grants, grant_flavor
from midterms.models import Midterm, MidtermAttempt, MidtermResit, MidtermVersion


def _grant_midterm_ids(grants) -> dict[int, int | None]:
    """``_grant_midterm_id`` for every grant at once: a resource id that is a Midterm id is
    that midterm; otherwise it is a legacy MockExam id the midterm mirrors."""
    rids = {int(g.resource_id) for g in grants if g.resource_id is not None}
    if not rids:
        return {}
    direct = set(Midterm.objects.filter(pk__in=rids).values_list("id", flat=True))
    rest = rids - direct
    legacy = (
        dict(Midterm.objects.filter(legacy_mock_exam_id__in=rest).values_list("legacy_mock_exam_id", "id"))
        if rest
        else {}
    )
    out: dict[int, int | None] = {}
    for g in grants:
        rid = g.resource_id
        if rid is None:
            out[g.id] = None
        elif int(rid) in direct:
            out[g.id] = int(rid)
        else:
            mid = legacy.get(int(rid))
            out[g.id] = int(mid) if mid is not None else None
    return out


def _winning(candidates):
    """``winning_grant``: a classroom grant beats a standalone one, newest first."""
    if not candidates:
        return None
    return sorted(candidates, key=lambda g: (0 if g.classroom_id else 1, -int(g.id)))[0]


def _results_state(*, midterm, grant, student_id, schedules, certificates) -> dict:
    """``midterm_results_state`` over preloaded rows (the same branches, in the same order)."""
    classroom_id = grant.classroom_id if grant is not None else None
    classroom_flavored = bool(classroom_id)
    standalone_flavored = grant is not None and not classroom_id
    legacy_id = midterm.legacy_mock_exam_id

    def _same_midterm(row) -> bool:
        return row.midterm_id == midterm.id or bool(legacy_id and row.mock_exam_id == legacy_id)

    scheds = [s for s in schedules if _same_midterm(s)]
    schedule_exists = bool(scheds)
    relevant = [s for s in scheds if s.classroom_id == classroom_id] if classroom_flavored else scheds
    schedule_released = any(bool(s.results_released) for s in relevant)

    certs = [
        c
        for c in certificates
        if c.student_id == student_id and _same_midterm(c) and (not classroom_flavored or c.classroom_id == classroom_id)
    ]
    cert = certs[0] if certs else None  # already newest first
    classroom_cert_released = cert is not None and cert.flavor == MidtermCertificate.FLAVOR_CLASSROOM
    released = schedule_released or classroom_cert_released

    if classroom_flavored:
        results_visible = released
    elif standalone_flavored:
        results_visible = True
    elif schedule_exists:
        results_visible = released
    else:
        results_visible = True

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


def midterm_rows(user) -> list[dict]:
    """``/api/midterms/mine/``'s ``results`` (raw: ``isoformat()`` timestamps, engine state
    names) plus ``requires_code`` — whether the 6-digit code screen comes before the lockdown
    handshake (a classroom schedule with a code; a standalone midterm never has one)."""
    if not user or not getattr(user, "is_authenticated", False):
        return []
    grants = list(_active_resource_grants(user).only("id", "resource_id", "classroom_id"))
    grant_mid = _grant_midterm_ids(grants)
    granted = {mid for mid in grant_mid.values() if mid is not None}

    # Oldest first, so the last one per midterm wins — the view's "last (latest) wins".
    attempts = list(MidtermAttempt.objects.filter(student=user).order_by("created_at"))
    attempted = {a.midterm_id for a in attempts}

    loaded = {m.id: m for m in Midterm.objects.filter(id__in=granted | attempted)}
    ids = {mid for mid in granted if mid in loaded and loaded[mid].is_published} | (attempted & set(loaded))
    if not ids:
        return []
    # In the view's order (Midterm.Meta: newest first) so equal titles sort the same way.
    midterms = {mid: m for mid, m in loaded.items() if mid in ids}
    latest: dict[int, MidtermAttempt] = {}
    for a in attempts:
        if a.midterm_id in midterms:
            a.midterm = midterms[a.midterm_id]  # no per-row midterm fetch for scoring_scale
            latest[a.midterm_id] = a

    resit_open_ids = set(
        MidtermResit.objects.filter(student=user, midterm_id__in=ids, consumed_at__isnull=True).values_list(
            "midterm_id", flat=True
        )
    )
    legacy_ids = {m.legacy_mock_exam_id for m in midterms.values() if m.legacy_mock_exam_id}
    identity = Q(midterm_id__in=ids)
    if legacy_ids:
        identity |= Q(mock_exam_id__in=legacy_ids)
    schedules = list(MidtermSchedule.objects.filter(identity).order_by("pk"))
    certificates = list(
        MidtermCertificate.objects.filter(identity, student=user)
        .only("id", "code", "rank", "cohort_size", "flavor", "classroom_id", "midterm_id", "mock_exam_id", "student_id", "issued_at")
        .order_by("-issued_at", "-pk")
    )

    # display_question_count: the first version's paper when the midterm has versions.
    first_version: dict[int, MidtermVersion] = {}
    for v in MidtermVersion.objects.filter(midterm_id__in=ids).order_by("midterm_id", "version_number"):
        first_version.setdefault(v.midterm_id, v)
    sources = {mid: first_version.get(mid, m) for mid, m in midterms.items()}
    module_ids = {
        mod for src in sources.values() for mod in (src.question_module_id, src.question_module_2_id) if mod
    }
    counts = dict(
        Question.objects.filter(module_id__in=module_ids)
        .values_list("module_id")
        .annotate(n=Count("id"))
        .values_list("module_id", "n")
    ) if module_ids else {}

    by_midterm: dict[int, list] = defaultdict(list)
    for g in grants:
        mid = grant_mid.get(g.id)
        if mid is not None:
            by_midterm[mid].append(g)

    rows = []
    for mid, m in midterms.items():
        grant = _winning(by_midterm.get(mid))
        flavor = grant_flavor(grant)
        att = latest.get(mid)

        is_open = True
        available_at = None
        is_before_start = False
        deadline = None
        awaiting_code = False
        requires_code = False
        if flavor == FLAVOR_CLASSROOM and grant is not None and grant.classroom_id:
            sched = next(
                (s for s in schedules if s.classroom_id == grant.classroom_id and s.midterm_id == mid), None
            )
            if sched is not None:
                is_open = sched.is_open()
                available_at = sched.available_at
                is_before_start = sched.is_before_start()
                deadline = sched.deadline
                if is_open and not sched.access_code:
                    awaiting_code = True
                    is_open = False
                requires_code = sched.requires_code()

        if att is not None:
            state = _results_state(
                midterm=m, grant=grant, student_id=user.id, schedules=schedules, certificates=certificates
            )
        else:
            state = {"results_visible": flavor != FLAVOR_CLASSROOM, "certificate": None}
        submitted = bool(att and att.is_completed)
        visible = bool(state["results_visible"])
        src = sources[mid]
        question_count = counts.get(src.question_module_id, 0) if src.question_module_id else 0
        if src.question_module_2_id:
            question_count += counts.get(src.question_module_2_id, 0)

        rows.append(
            {
                "midterm_id": mid,
                "title": m.title,
                "subject": m.subject,
                "scoring_scale": att.scoring_scale if submitted else m.scoring_scale,
                "score_ceiling": att.score_ceiling if submitted else m.score_ceiling,
                "duration_minutes": m.duration_minutes,
                "question_count": question_count,
                "flavor": flavor,
                "attempt_id": att.id if att else None,
                "state": att.current_state if att else "NOT_STARTED",
                "submitted": submitted,
                "resit_open": mid in resit_open_ids,
                "is_open": is_open,
                "is_before_start": is_before_start,
                "awaiting_code": awaiting_code,
                "available_at": available_at.isoformat() if available_at else None,
                "deadline": deadline.isoformat() if deadline else None,
                "results_visible": visible,
                "score": att.score if (submitted and visible) else None,
                "certificate": state.get("certificate"),
                "requires_code": requires_code,
            }
        )
    rows.sort(key=lambda r: r["title"])
    return rows
