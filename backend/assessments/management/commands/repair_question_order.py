from __future__ import annotations

import json
from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from assessments.domain.question_ordering import reindex_set_questions_dense_locked
from assessments.models import AssessmentQuestion, AssessmentSet


class Command(BaseCommand):
    """
    Renumber each AssessmentSet's question ``order`` to a unique, contiguous
    ``0..n-1`` sequence.

    WHY THIS EXISTS
      ``AssessmentQuestion.order`` has historically had no uniqueness guarantee
      and was assigned as ``max(order)+1`` without a row lock, so concurrent
      "Add from Question Bank" calls could race to the same value. The result is
      duplicate / gapped ``order`` values, which make the ``(order, id)`` delivery
      sort wedge later-added questions into the middle — questions appear shuffled.

    WHAT IT DOES
      For each selected set it writes a dense ``0..n-1`` ordering across ALL
      questions (active + inactive, so every row holds a unique order), choosing
      the sequence with ``--by``:

        current  preserve the existing (order, id) sequence, just dedupe/compact
                 (no visible change — use when the displayed order is already right)
        id       creation order by primary key (restores the original authoring
                 sequence when only the order field drifted)
        created  created_at, then id

    SAFETY
      - Dry-run by default; nothing is written without ``--apply``.
      - Each set is renumbered under ``select_for_update`` on the set, via a
        two-phase temp band, inside one transaction (constraint-safe, atomic).
      - Idempotent: a second run is a no-op.
      - Existing attempts are unaffected — each attempt freezes its own
        ``question_order`` (a list of question ids) at start; this only changes
        the live ``order`` field used for future delivery and the builder view.
    """

    help = "Renumber AssessmentQuestion.order to unique contiguous 0..n-1 per set. Dry-run by default."

    def add_arguments(self, parser):
        parser.add_argument("--set", dest="set_ids", default="", help="Comma-separated set id(s). Default: all sets.")
        parser.add_argument(
            "--by",
            choices=("current", "id", "created"),
            default="current",
            help="Sequence to renumber by. Default: current (preserve visible order, just compact).",
        )
        parser.add_argument("--apply", action="store_true", help="Write the changes (default: dry-run).")
        parser.add_argument("--json", action="store_true", help="Emit a machine-readable JSON summary.")

    def _target_ids(self, set_id: int, key: str) -> list[int]:
        rows = list(AssessmentQuestion.objects.filter(assessment_set_id=set_id))
        if key == "id":
            rows.sort(key=lambda q: q.id)
        elif key == "created":
            rows.sort(key=lambda q: (q.created_at, q.id))
        else:  # current
            rows.sort(key=lambda q: (q.order, q.id))
        return [q.id for q in rows]

    def handle(self, *args, **options):
        key = options["by"]
        apply_changes = bool(options["apply"])
        as_json = bool(options["json"])

        qs = AssessmentSet.objects.all().order_by("id")
        ids = [int(x) for x in str(options["set_ids"]).split(",") if x.strip().isdigit()]
        if ids:
            qs = qs.filter(id__in=ids)
        sets = list(qs)
        if not sets:
            raise CommandError("No matching AssessmentSet rows.")

        report: list[dict] = []
        for s in sets:
            current_rows = list(
                AssessmentQuestion.objects.filter(assessment_set_id=s.id).order_by("order", "id")
            )
            current_orders = [q.order for q in current_rows]
            current_ids = [q.id for q in current_rows]
            dups = sorted([o for o, c in Counter(current_orders).items() if c > 1])
            contiguous = current_orders == list(range(len(current_rows)))

            target_ids = self._target_ids(s.id, key)
            # Will this set actually change? Either the field needs compacting
            # (dups/gaps) or the chosen sequence differs from the current one.
            target_is_dense_current = (target_ids == current_ids) and contiguous and not dups
            changed = not target_is_dense_current

            entry = {
                "set_id": s.id,
                "title": s.title,
                "n": len(current_rows),
                "duplicate_orders": dups,
                "contiguous": contiguous,
                "changed": changed,
                "before_ids": current_ids,
                "after_ids": target_ids,
            }

            if changed and apply_changes:
                final_ids = reindex_set_questions_dense_locked(s.id, target_ids)
                entry["after_ids"] = final_ids
                entry["applied"] = True

            report.append(entry)

        out = {
            "by": key,
            "applied": apply_changes,
            "sets_changed": sum(1 for e in report if e["changed"]),
            "sets": report,
        }

        if as_json:
            self.stdout.write(json.dumps(out, indent=2, sort_keys=True, default=str))
            return

        self.stdout.write(f"QUESTION ORDER REPAIR  by={key}  apply={apply_changes}")
        for e in report:
            flag = "" if e["changed"] else "  (already clean)"
            self.stdout.write(
                f"\nset #{e['set_id']} — {e['title']!r}  n={e['n']} "
                f"dups={e['duplicate_orders']} contiguous={e['contiguous']}{flag}"
            )
            if e["changed"]:
                self.stdout.write(f"   before (order,id): {e['before_ids']}")
                self.stdout.write(f"   after  (0..n-1)  : {e['after_ids']}")
        self.stdout.write(f"\nsets_changed={out['sets_changed']}")
        if not apply_changes:
            self.stdout.write("dry_run=True (no changes applied) — re-run with --apply to write.")
