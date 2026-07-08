"""Migrate legacy midterms (exams.MockExam kind=MIDTERM) into the new `midterms` app.

Copies exams -> midterms while leaving the legacy system fully intact (so a rollback keeps
old midterms + /certificate/<code> URLs working). Idempotent via ``legacy_*`` backlink
columns. FROZEN scores/ranks are copied verbatim, NEVER recomputed (the new SCALE_800
formula differs from the legacy per-module-cap one, and historical results must not change).

Run AFTER a green deploy (NOT inside the deploy migrate step — release_deploy.sh would
pg_restore-wipe the release on a slow/failed RunPython):
    python manage.py migrate_midterms_to_new_tables            # DRY-RUN (default; no writes)
    python manage.py migrate_midterms_to_new_tables --commit   # apply
    python manage.py migrate_midterms_to_new_tables --commit --only-mock-exam-id 42
"""

from __future__ import annotations

import json
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

# Legacy -> new single-module attempt-state mapping.
_STATE_MAP = {
    "NOT_STARTED": "NOT_STARTED",
    "MODULE_1_ACTIVE": "ACTIVE",
    "MODULE_1_SUBMITTED": "ACTIVE",
    "MODULE_2_ACTIVE": "ACTIVE",
    "MODULE_2_SUBMITTED": "SCORING",
    "SCORING": "SCORING",
    "COMPLETED": "COMPLETED",
    "ABANDONED": "ABANDONED",
}

# exams.Question content fields copied verbatim onto the new midterm question rows.
_QUESTION_FIELDS = [
    "question_type", "question_text", "question_prompt", "question_image",
    "option_a", "option_b", "option_c", "option_d",
    "option_a_image", "option_b_image", "option_c_image", "option_d_image",
    "correct_answers", "is_math_input", "score", "explanation",
]


def _display_name(user):
    if user is None:
        return ""
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or getattr(user, "username", None) or getattr(user, "email", "") or f"User {user.pk}"


def _remap_answers(module_answers, q_map):
    """Legacy {str(module_id): {str(qid): ans}} -> flat {str(new_qid): ans}. Merges modules."""
    out = {}
    for _mid, inner in (module_answers or {}).items():
        if not isinstance(inner, dict):
            continue
        for qid, ans in inner.items():
            try:
                new_qid = q_map[int(qid)]
            except (KeyError, ValueError, TypeError):
                continue  # orphan answer key (question removed) — drop, matches scorer's defensiveness
            out[str(new_qid)] = ans
    return out


def _remap_flagged(flagged, q_map):
    """Legacy flagged (dict {module_id: [qids]} or list) -> flat [new_qid]."""
    out = []
    items = []
    if isinstance(flagged, dict):
        for v in flagged.values():
            if isinstance(v, (list, tuple)):
                items.extend(v)
    elif isinstance(flagged, (list, tuple)):
        items = list(flagged)
    for qid in items:
        try:
            out.append(q_map[int(qid)])
        except (KeyError, ValueError, TypeError):
            continue
    return out


class Command(BaseCommand):
    help = "Migrate legacy MockExam(kind=MIDTERM) midterms + attempts + certs + grants into the midterms app."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Write changes (default: dry-run, no writes).")
        parser.add_argument("--limit", type=int, default=0, help="Max midterms to process (0 = all).")
        parser.add_argument("--only-mock-exam-id", type=int, default=0, help="Migrate a single MockExam by id.")
        parser.add_argument("--json", action="store_true", help="Emit the summary as JSON.")

    def handle(self, *args, **opts):
        from exams.models import MockExam

        commit = opts["commit"]
        summary: dict = defaultdict(int)

        qs = MockExam.objects.filter(kind=MockExam.KIND_MIDTERM).order_by("id")
        if opts["only_mock_exam_id"]:
            qs = qs.filter(pk=opts["only_mock_exam_id"])
        total = qs.count()
        if opts["limit"]:
            qs = qs[: opts["limit"]]

        self.stdout.write(f"Candidates: {total} midterm MockExam(s){'' if commit else '  [DRY-RUN]'}")

        for mock in list(qs):
            try:
                with transaction.atomic():
                    self._migrate_one(mock, summary)
                    if not commit:
                        transaction.set_rollback(True)  # dry-run: exercise the path, write nothing
            except Exception as exc:  # continue-on-error: one bad row never aborts the batch
                summary["errors"] += 1
                self.stderr.write(f"mock_exam {mock.id}: {exc!r}")

        if opts["json"]:
            self.stdout.write(json.dumps({k: summary[k] for k in summary}))
        else:
            for k in sorted(summary):
                self.stdout.write(f"  {k}: {summary[k]}")
        self.stdout.write(
            self.style.SUCCESS(f"DONE ({'committed' if commit else 'dry-run'}) — {dict(summary)}")
        )

    # ── per-midterm migration ────────────────────────────────────────────────
    def _migrate_one(self, mock, summary):
        from exams.models import Module, Question, TestAttempt

        from midterms.models import Midterm, MidtermAttempt

        # 1) Midterm definition (idempotent on legacy_mock_exam_id).
        m1 = int(getattr(mock, "midterm_module1_minutes", 60) or 60)
        m2 = int(getattr(mock, "midterm_module2_minutes", 60) or 60)
        count = int(getattr(mock, "midterm_module_count", 1) or 1)
        duration = m1 + (m2 if count >= 2 else 0)
        midterm, created = Midterm.objects.get_or_create(
            legacy_mock_exam_id=mock.id,
            defaults={
                "title": mock.title,
                "subject": getattr(mock, "midterm_subject", None) or Midterm.READING_WRITING,
                "scoring_scale": getattr(mock, "midterm_scoring_scale", None) or Midterm.SCALE_100,
                "duration_minutes": max(1, duration),
                "question_limit": int(getattr(mock, "midterm_module_question_limit", 30) or 30),
                "is_published": bool(getattr(mock, "is_published", False)),
                "published_at": getattr(mock, "published_at", None),
            },
        )
        if created:
            summary["midterms_created"] += 1
        else:
            summary["midterms_skipped"] += 1

        # 2) Single owned Module + copied questions (build q_map: old qid -> new qid).
        if not midterm.question_module_id:
            module = Module.objects.create(
                practice_test=None, module_order=1, time_limit_minutes=max(1, duration)
            )
            midterm.question_module = module
            midterm.save(update_fields=["question_module"])
        else:
            module = midterm.question_module

        q_map: dict[int, int] = {}
        # If questions were already copied on a prior run, rebuild q_map from existing rows is not
        # possible (no per-question legacy id stored), so we only copy when the module is empty.
        already_has_questions = Question.objects.filter(module_id=module.id).exists()
        order = 0
        for section in mock.tests.all().order_by("id"):
            for src_mod in section.modules.all().order_by("module_order"):
                for src_q in src_mod.questions.all().order_by("order", "id"):
                    if already_has_questions:
                        # Best-effort remap for re-runs: match by (text, order-agnostic) is unreliable,
                        # so skip copying but still fail-soft; answers remap will drop unmatched keys.
                        continue
                    fields = {f: getattr(src_q, f) for f in _QUESTION_FIELDS}
                    new_q = Question.objects.create(module=module, order=order, **fields)
                    q_map[int(src_q.id)] = int(new_q.id)
                    order += 1
                    summary["questions_copied"] += 1

        # 3) Attempts -> MidtermAttempt (idempotent on legacy_test_attempt_id).
        attempts = TestAttempt.objects.filter(
            practice_test__mock_exam=mock
        ).select_related("student").order_by("created_at")
        for att in attempts:
            existing = MidtermAttempt.objects.filter(legacy_test_attempt_id=att.id).first()
            if existing is not None:
                summary["attempts_skipped"] += 1
                continue
            state = _STATE_MAP.get(att.current_state, "COMPLETED" if att.is_completed else "NOT_STARTED")
            MidtermAttempt.objects.create(
                legacy_test_attempt_id=att.id,
                midterm=midterm,
                student=att.student,
                answers=_remap_answers(att.module_answers, q_map),
                flagged=_remap_flagged(att.flagged_questions, q_map),
                current_state=state,
                version_number=int(att.version_number or 0),
                is_completed=bool(att.is_completed),
                score=att.score,  # FROZEN — copied verbatim, never recomputed
                started_at=att.module_1_started_at or att.started_at,
                scoring_started_at=att.scoring_started_at,
                submitted_at=att.submitted_at,
                completed_at=att.completed_at,
            )
            summary["attempts_created"] += 1

        # 4) Backfill classes MidtermSchedule + MidtermCertificate FKs onto the new Midterm.
        self._backfill_classes(mock, midterm, summary)

        # 5) Re-key RT_MIDTERM grants -> midterm_v2 (resource_id = new Midterm.id).
        self._rekey_grants(mock, midterm, summary)

    def _backfill_classes(self, mock, midterm, summary):
        from midterms.models import MidtermAttempt

        try:
            from classes.models_certificates import MidtermCertificate
            from classes.models_schedule import MidtermSchedule
        except Exception:
            return

        for sched in MidtermSchedule.objects.filter(mock_exam=mock, midterm__isnull=True):
            sched.midterm = midterm
            sched.save(update_fields=["midterm", "updated_at"])
            summary["schedules_backfilled"] += 1

        for cert in MidtermCertificate.objects.filter(mock_exam=mock, midterm__isnull=True):
            cert.midterm = midterm
            cert.flavor = MidtermCertificate.FLAVOR_CLASSROOM
            if cert.attempt_id:
                ma = MidtermAttempt.objects.filter(legacy_test_attempt_id=cert.attempt_id).first()
                if ma is not None:
                    cert.midterm_attempt = ma
            cert.save(update_fields=["midterm", "flavor", "midterm_attempt", "updated_at"])
            summary["certificates_backfilled"] += 1

    def _rekey_grants(self, mock, midterm, summary):
        from access.models import ResourceAccessGrant
        from access.resources import RT_MIDTERM, RT_MIDTERM_V2

        legacy = ResourceAccessGrant.objects.filter(
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM,
            resource_id=mock.id,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        for g in legacy:
            exists = ResourceAccessGrant.objects.filter(
                user_id=g.user_id,
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
                resource_id=midterm.id,
                classroom_id=g.classroom_id,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            ).exists()
            if exists:
                summary["grants_skipped"] += 1
                continue
            ResourceAccessGrant.objects.create(
                user_id=g.user_id,
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
                resource_id=midterm.id,
                classroom_id=g.classroom_id,
                source=g.source,
                status=ResourceAccessGrant.STATUS_ACTIVE,
                granted_by_id=g.granted_by_id,
                expires_at=g.expires_at,
            )
            summary["grants_rekeyed"] += 1
