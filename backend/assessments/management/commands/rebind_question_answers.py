from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from assessments.domain.snapshot_builder import questions_from_snapshot
from assessments.models import (
    AssessmentQuestion,
    AssessmentSet,
    AssessmentSetVersion,
)


def _choice_ids(choices: Any) -> list[str]:
    """Normalised list of choice ids from a JSON choices array."""
    out: list[str] = []
    if isinstance(choices, list):
        for c in choices:
            if isinstance(c, dict):
                cid = str(c.get("id") or "").strip()
                if cid:
                    out.append(cid)
    return out


def _answer_str(correct_answer: Any) -> str:
    """String form of a correct_answer for MC membership checks."""
    if correct_answer is None:
        return ""
    if isinstance(correct_answer, str):
        return correct_answer.strip()
    return str(correct_answer)


def _is_self_inconsistent(question_type: str, choices: Any, correct_answer: Any) -> bool:
    """
    True when an MC question's stored ``correct_answer`` is not one of its own
    ``choices`` — i.e. the answer is NOT bound to this question's options.
    Non-MC types (numeric / short_text / boolean) have no choice list to bind
    against, so they are never flagged here.
    """
    if question_type != "multiple_choice":
        return False
    ids = set(_choice_ids(choices))
    ans = _answer_str(correct_answer)
    return (not ans) or (ans not in ids)


class Command(BaseCommand):
    """
    Audit — and optionally repair — the binding between each AssessmentQuestion
    and its own answer (``choices`` + ``correct_answer``).

    WHY THIS EXISTS
      A bulk content operation can leave a live AssessmentQuestion row whose
      stored ``choices`` / ``correct_answer`` no longer match its own prompt
      (the "answers got swapped between questions" symptom in the builder and
      in the live assessment). The authoring code itself binds strictly by row
      id, so this command does NOT change that path — it realigns DATA that has
      already drifted.

    SOURCE OF TRUTH
      Each published set has an immutable ``AssessmentSetVersion.snapshot_json``
      that is self-sufficient (INV-S04) and keyed by question ``id``. It holds
      the authored ``prompt`` / ``choices`` / ``correct_answer`` frozen at
      publish time. Re-copying those fields onto the live row, matched by id,
      rebinds each answer to exactly its own question.

    SAFETY
      - Dry-run by default. Nothing is written without ``--apply``.
      - Only the requested ``--fields`` are touched (default: choices +
        correct_answer). Prompts/images/order are left alone unless asked.
      - Each write is matched by question id and taken under select_for_update.
      - Idempotent: a second run after a successful repair is a no-op.
      - If the chosen snapshot is itself self-inconsistent for a question, that
        question is reported as ``needs_manual_review`` and never auto-written.
    """

    help = (
        "Audit/repair each question's answer binding (choices + correct_answer). "
        "Read-only by default; restores from the version snapshot with --apply."
    )

    VALID_FIELDS = ("choices", "correct_answer", "prompt")

    def add_arguments(self, parser):
        parser.add_argument(
            "--set",
            dest="set_ids",
            default="",
            help="Comma-separated AssessmentSet id(s). Default: all sets.",
        )
        parser.add_argument(
            "--from-version",
            dest="from_version",
            type=int,
            default=None,
            help="Use a specific AssessmentSetVersion id as the source of truth. "
            "Default: the latest version of each set.",
        )
        parser.add_argument(
            "--source",
            choices=("snapshot", "bank"),
            default="snapshot",
            help="Where to read the authoritative answer from. Default: snapshot.",
        )
        parser.add_argument(
            "--fields",
            default="choices,correct_answer",
            help="Comma-separated fields to restore on repair "
            f"(any of: {', '.join(self.VALID_FIELDS)}). "
            "Default: choices,correct_answer.",
        )
        parser.add_argument(
            "--include-inactive",
            action="store_true",
            help="Also scan is_active=False questions (default: active only).",
        )
        parser.add_argument(
            "--list-versions",
            action="store_true",
            help="List each set's versions with their self-inconsistent question "
            "count (helps pick the last clean snapshot) and exit.",
        )
        parser.add_argument("--apply", action="store_true", help="Write the repairs (default: dry-run).")
        parser.add_argument("--json", action="store_true", help="Emit a machine-readable JSON summary.")

    # ── helpers ────────────────────────────────────────────────────────────────

    def _sets_qs(self, set_ids: str):
        qs = AssessmentSet.objects.all().order_by("id")
        ids = [int(x) for x in set_ids.split(",") if x.strip().isdigit()]
        if ids:
            qs = qs.filter(id__in=ids)
        return qs

    def _latest_version(self, set_id: int) -> AssessmentSetVersion | None:
        return (
            AssessmentSetVersion.objects.filter(assessment_set_id=set_id)
            .order_by("-version_number", "-id")
            .first()
        )

    def _snapshot_map(self, version: AssessmentSetVersion) -> dict[int, dict]:
        out: dict[int, dict] = {}
        for entry in questions_from_snapshot(version.snapshot_json):
            try:
                out[int(entry["id"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def _bank_truth(self, q: AssessmentQuestion) -> dict | None:
        """Authoritative {choices, correct_answer, prompt} from the linked bank question."""
        if not q.bank_question_id or q.bank_question is None:
            return None
        from assessments.domain.bank_integration import _choices_from_bank

        bank = q.bank_question
        return {
            "choices": _choices_from_bank(bank),
            "correct_answer": bank.correct_answer,
            "prompt": bank.question_text,
        }

    # ── --list-versions ─────────────────────────────────────────────────────────

    def _list_versions(self, sets, as_json: bool):
        report: dict[str, Any] = {}
        for s in sets:
            versions = (
                AssessmentSetVersion.objects.filter(assessment_set_id=s.id)
                .order_by("version_number", "id")
            )
            rows = []
            for v in versions:
                bad = 0
                for e in questions_from_snapshot(v.snapshot_json):
                    if _is_self_inconsistent(
                        e.get("question_type", ""), e.get("choices"), e.get("correct_answer")
                    ):
                        bad += 1
                rows.append(
                    {
                        "version_id": v.id,
                        "version_number": v.version_number,
                        "published_at": str(getattr(v, "published_at", "") or ""),
                        "question_count": v.question_count,
                        "self_inconsistent": bad,
                    }
                )
            report[str(s.id)] = {"title": s.title, "versions": rows}

        if as_json:
            self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
            return
        self.stdout.write("VERSION INVENTORY (pick the last snapshot with self_inconsistent=0)")
        for sid, info in report.items():
            self.stdout.write(f"\nset #{sid} — {info['title']}")
            if not info["versions"]:
                self.stdout.write("  (no published versions — nothing to rebind from)")
            for r in info["versions"]:
                self.stdout.write(
                    f"  v{r['version_number']} (id={r['version_id']}) "
                    f"questions={r['question_count']} "
                    f"self_inconsistent={r['self_inconsistent']} "
                    f"{r['published_at']}"
                )

    # ── main ────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        set_ids = str(options["set_ids"] or "")
        source = options["source"]
        apply_changes = bool(options["apply"])
        as_json = bool(options["json"])
        include_inactive = bool(options["include_inactive"])

        fields = [f.strip() for f in str(options["fields"]).split(",") if f.strip()]
        bad_fields = [f for f in fields if f not in self.VALID_FIELDS]
        if bad_fields:
            raise CommandError(f"Unknown --fields: {', '.join(bad_fields)} (valid: {', '.join(self.VALID_FIELDS)})")
        if not fields:
            raise CommandError("--fields cannot be empty.")

        sets = list(self._sets_qs(set_ids))
        if not sets:
            raise CommandError("No matching AssessmentSet rows.")

        if options["list_versions"]:
            self._list_versions(sets, as_json)
            return

        summary = defaultdict(lambda: {"count": 0, "examples": []})

        def _bump(kind: str, detail: Any = None):
            summary[kind]["count"] += 1
            if detail is not None and len(summary[kind]["examples"]) < 25:
                summary[kind]["examples"].append(detail)

        per_set_report: list[dict] = []

        for s in sets:
            version = None
            snap: dict[int, dict] = {}
            if source == "snapshot":
                if options["from_version"]:
                    version = AssessmentSetVersion.objects.filter(
                        id=options["from_version"], assessment_set_id=s.id
                    ).first()
                else:
                    version = self._latest_version(s.id)
                if version is None:
                    _bump("set.no_snapshot", s.id)
                else:
                    snap = self._snapshot_map(version)

            q_qs = AssessmentQuestion.objects.filter(assessment_set_id=s.id)
            if not include_inactive:
                q_qs = q_qs.filter(is_active=True)
            q_qs = q_qs.select_related("bank_question", "bank_version").order_by("order", "id")

            set_changes: list[dict] = []

            for q in q_qs:
                live_inconsistent = _is_self_inconsistent(q.question_type, q.choices, q.correct_answer)
                if live_inconsistent:
                    _bump("question.answer_unbound", q.id)

                # Resolve the authoritative truth for this question.
                truth: dict | None
                if source == "bank":
                    truth = self._bank_truth(q)
                    if truth is None:
                        if live_inconsistent:
                            _bump("question.no_bank_link", q.id)
                        continue
                else:
                    truth = snap.get(q.id)
                    if truth is None:
                        if live_inconsistent:
                            _bump("question.no_snapshot_entry", q.id)
                        continue

                truth_inconsistent = _is_self_inconsistent(
                    truth.get("question_type", q.question_type),
                    truth.get("choices"),
                    truth.get("correct_answer"),
                )

                # Does the live row diverge from the source of truth on any
                # field we'd restore?
                diff_fields = []
                for f in fields:
                    if q.__dict__.get(f) != truth.get(f, q.__dict__.get(f)):
                        diff_fields.append(f)
                if not diff_fields:
                    continue  # already aligned

                # The source itself is broken for this question — never write a
                # bad answer over a (possibly) good one; surface for a human.
                if truth_inconsistent:
                    _bump("question.needs_manual_review", q.id)
                    continue

                change = {
                    "set_id": s.id,
                    "question_id": q.id,
                    "order": q.order,
                    "fields": diff_fields,
                    "live": {f: q.__dict__.get(f) for f in diff_fields},
                    "truth": {f: truth.get(f) for f in diff_fields},
                    "was_unbound": live_inconsistent,
                }
                set_changes.append(change)
                _bump("question.rebind", q.id)

                if apply_changes:
                    with transaction.atomic():
                        locked = AssessmentQuestion.objects.select_for_update().get(pk=q.id)
                        for f in diff_fields:
                            setattr(locked, f, truth.get(f))
                        locked.save(update_fields=diff_fields + ["updated_at"])

            if set_changes:
                per_set_report.append(
                    {
                        "set_id": s.id,
                        "title": s.title,
                        "version_id": getattr(version, "id", None),
                        "changes": set_changes,
                    }
                )

        out = {
            "source": source,
            "fields": fields,
            "applied": apply_changes,
            "summary": {k: v for k, v in summary.items()},
            "sets": per_set_report,
        }

        if as_json:
            self.stdout.write(json.dumps(out, indent=2, sort_keys=True, default=str))
            return

        self.stdout.write("ANSWER ↔ QUESTION REBIND")
        self.stdout.write(f"source={source} fields={','.join(fields)} apply={apply_changes}")
        self.stdout.write(json.dumps({k: v["count"] for k, v in summary.items()}, indent=2, sort_keys=True))
        for sr in per_set_report:
            self.stdout.write(
                f"\nset #{sr['set_id']} — {sr['title']} "
                f"(snapshot version id={sr['version_id']})"
            )
            for c in sr["changes"]:
                flag = " [WAS UNBOUND]" if c["was_unbound"] else ""
                self.stdout.write(f"  Q id={c['question_id']} order={c['order']} fields={c['fields']}{flag}")
                for f in c["fields"]:
                    self.stdout.write(f"      {f}: live={c['live'][f]!r}")
                    self.stdout.write(f"      {f}: truth={c['truth'][f]!r}")
        if not apply_changes:
            self.stdout.write("\ndry_run=True (no changes applied) — re-run with --apply to write.")
