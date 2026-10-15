"""``GET /api/desktop/v1/home`` — everything Home shows, in one response.

Replaces five website calls (``/users/me/``, ``/midterms/mine/``, ``/exams/``,
``/exams/attempts/``, ``/classes/pastpapers/reopened/``)::

    {schema, server_now, student, app, midterms: [...], pastpapers: [...]}

* ``app`` is the console's Windows release policy (``mobile.policy.get_policy("windows")``),
  judged against the build in ``X-MasterSAT-Client: windows/<semver>``.
* ``midterms`` are the ``/api/midterms/mine/`` rows — the same rules over rows loaded once
  (``midterm_rows``; a test pins them against that view) — with v1 timestamps, the wire state
  names, and ``requires_code``.
* ``pastpapers`` are the student's library — the website library's gate (assigned, standalone,
  has questions) — each with a slim server-computed state (new / progress / reopened /
  completed, so the 0.1.0 "assigned again" bug cannot come back) and its finished sittings.

Query cost is fixed whatever the student's history: the midterm half is about ten queries
(``midterm_rows``), the past-paper half three (paper rows, module counts, attempt rows) plus
the website's reopened check (``reopened_papers``) only when a finished paper has no open
sitting. ``tests/test_home.py`` holds the budget.

``ETag`` is ``"sha256:<hex>"`` of the body WITHOUT ``server_now`` (the one field that changes
on every request), so ``If-None-Match`` answers 304 until something the student would see
changes. The app polls with it every 30 s while a midterm is about to open.
"""

from __future__ import annotations

import hashlib
import json

from django.db.models import Count, F
from django.http import HttpResponseNotModified
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated

from classes.pastpaper_retake import finished_at
from exams.models import Module, PracticeTest, TestAttempt
from midterms.state_machine import WIRE_STATE
from mobile.policy import get_policy
from mobile.versioning import PLATFORM_WINDOWS, format_version

from .conventions import SCHEMA, V1APIView, client_version, iso, iso_date, iso_from_string, ok
from .midterm_rows import midterm_rows as build_midterm_rows

STATUS_NEW = "new"
STATUS_PROGRESS = "progress"
STATUS_REOPENED = "reopened"
STATUS_COMPLETED = "completed"


# ── blocks ───────────────────────────────────────────────────────────────────────────────
def student_block(user) -> dict:
    return {"id": user.id, "first_name": user.first_name or "", "last_name": user.last_name or ""}


def app_block(request) -> dict:
    policy = get_policy(PLATFORM_WINDOWS)
    return {
        "latest_version": format_version(policy.latest) or None,
        "minimum_version": format_version(policy.minimum) or None,
        "update_url": policy.update_url,
        "update": policy.verdict(client_version(request)),
        "message": policy.message,
    }


def midterm_rows(request) -> list[dict]:
    """The ``/api/midterms/mine/`` rows (``midterm_rows.midterm_rows``, the same rules in a
    fixed number of queries) with v1 timestamps and the wire state names."""
    out = []
    for row in build_midterm_rows(request.user):
        row = dict(row)
        row["available_at"] = iso_from_string(row.get("available_at"))
        row["deadline"] = iso_from_string(row.get("deadline"))
        row["state"] = WIRE_STATE.get(row.get("state"), row.get("state"))
        out.append(row)
    return out


def _finished_order(row: dict):
    return (finished_at(row), row["id"])


def pastpaper_rows(user) -> list[dict]:
    papers = list(
        PracticeTest.objects.filter(
            mock_exam__isnull=True, modules__questions__isnull=False, assigned_users=user,
            is_practice_test=False,  # practice tests reach the Windows app in PR 2
        )
        .distinct()
        .order_by(F("practice_date").desc(nulls_last=True), "-id")
        .only("id", "title", "practice_date", "subject", "label", "form_type", "collection_name")
    )
    if not papers:
        return []
    ids = [p.id for p in papers]

    modules: dict[int, list[dict]] = {pid: [] for pid in ids}
    for m in (
        Module.objects.filter(practice_test_id__in=ids)
        .annotate(question_count=Count("questions"))
        .order_by("practice_test_id", "module_order", "id")
        .values("practice_test_id", "module_order", "time_limit_minutes", "question_count")
    ):
        if m["question_count"]:
            modules[m["practice_test_id"]].append(
                {
                    "order": int(m["module_order"]),
                    "time_limit_minutes": int(m["time_limit_minutes"] or 0),
                    "question_count": int(m["question_count"]),
                }
            )

    attempts: dict[int, list[dict]] = {pid: [] for pid in ids}
    for a in (
        TestAttempt.objects.filter(student=user, practice_test_id__in=ids)
        .order_by("id")
        .values("id", "practice_test_id", "current_state", "is_completed", "score", "completed_at", "submitted_at", "created_at")
    ):
        attempts[a["practice_test_id"]].append(a)

    states: dict[int, dict] = {}
    needs_reopened_check = False
    for pid in ids:
        rows = attempts[pid]
        finished = sorted(
            (a for a in rows if a["is_completed"] and a["current_state"] == TestAttempt.STATE_COMPLETED),
            key=_finished_order,
            reverse=True,
        )
        last = finished[0] if finished else None
        # The app's cardState rule: the newest unfinished sitting newer than the last finished
        # one. ABANDONED counts — v1 `open` restores it from its checkpoint.
        open_attempt = next(
            (a for a in reversed(rows) if not a["is_completed"] and (last is None or a["id"] > last["id"])),
            None,
        )
        states[pid] = {"finished": finished, "last": last, "open": open_attempt}
        if open_attempt is None and last is not None:
            needs_reopened_check = True

    reopened = {}
    if needs_reopened_check:
        from classes.pastpaper_retake import reopened_papers

        reopened = reopened_papers(user)

    out = []
    for paper in papers:
        st = states[paper.id]
        last, open_attempt, finished = st["last"], st["open"], st["finished"]
        again = reopened.get(paper.id) if (open_attempt is None and last is not None) else None
        if open_attempt is not None:
            status = STATUS_PROGRESS
        elif again is not None:
            status = STATUS_REOPENED
        elif last is not None:
            status = STATUS_COMPLETED
        else:
            status = STATUS_NEW
        out.append(
            {
                "id": paper.id,
                "title": paper.title or "",
                "practice_date": iso_date(paper.practice_date),
                "subject": paper.subject,
                "label": paper.label or "",
                "form_type": paper.form_type or "",
                "collection_name": paper.collection_name or "",
                "modules": modules[paper.id],
                "state": {
                    "status": status,
                    "open_attempt_id": open_attempt["id"] if open_attempt else None,
                    "open_state": open_attempt["current_state"] if open_attempt else None,
                    "last_attempt_id": last["id"] if last else None,
                    "last_score": last["score"] if last else None,
                    "last_completed_at": iso(finished_at(last)) if last else None,
                    "sittings": len(finished),
                    "reopened": (
                        {
                            "assignment_id": again["assignment_id"],
                            "assignment_title": again["assignment_title"] or "",
                            "classroom_name": again["classroom_name"] or "",
                            "set_at": iso(again["set_at"]),
                            "due_at": iso(again["due_at"]),
                        }
                        if again is not None
                        else None
                    ),
                },
                "history": [
                    {"attempt_id": a["id"], "score": a["score"], "completed_at": iso(finished_at(a))} for a in finished
                ],
            }
        )
    return out


# ── ETag ─────────────────────────────────────────────────────────────────────────────────
def etag_for(body: dict) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return '"sha256:' + hashlib.sha256(canonical.encode("utf-8")).hexdigest() + '"'


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate == "*" or candidate == etag:
            return True
    return False


class HomeView(V1APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        body = {
            "schema": SCHEMA,
            "student": student_block(user),
            "app": app_block(request),
            "midterms": midterm_rows(request),
            "pastpapers": pastpaper_rows(user),
        }
        etag = etag_for(body)
        headers = {"ETag": etag, "Cache-Control": "private, no-cache", "Vary": "Authorization"}
        if _matches(request.META.get("HTTP_IF_NONE_MATCH"), etag):
            response = HttpResponseNotModified()
            for name, value in headers.items():
                response[name] = value
            return response
        payload = {"server_now": iso(timezone.now())}
        payload.update({k: v for k, v in body.items() if k != "schema"})
        return ok(payload, headers=headers)
