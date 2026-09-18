"""Pin a paper, scale and pass mark onto midterm sittings that started before pinning existed.

A sitting now pins what it was given the moment it starts (``MidtermAttempt.paper_*``).
Sittings from before that have nothing pinned, so they still read the midterm's CURRENT paper,
scale and pass mark — which is exactly how 2026-09-18 went wrong: six Junior Math midterms were
rebuilt on the 800 scale, and 215 finished 0-100 papers turned into "0%, failed".

    python manage.py pin_midterm_papers                  # dry run: counts only
    python manage.py pin_midterm_papers --commit
    python manage.py pin_midterm_papers --commit --midterm-id 9

Scale and pass mark, in order of authority:
  1. the verdict frozen for this very sitting (``MidtermOutcome.attempt`` = it);
  2. otherwise the scale is read off the score — a 100-scale score never exceeds 100 and an
     800-scale one never drops below 200 — and the pass mark is the midterm's own if it is
     still on that scale, else that scale's default; a pre-midterm gets none;
  3. a sitting with no score yet (still in progress) takes the midterm's current ones — the
     ones it would have been pinned with, had it started a minute ago.

Paper: pinned only while the questions this sitting was scored on (its frozen per-question
rows; for one still in progress, the questions it has answered) are all on the midterm's
current modules. A sitting whose questions an old sync already deleted is left unpinned
rather than pinned to somebody else's paper; its score, verdict and breakdown are frozen and
unaffected either way.

Idempotent — a sitting whose scale is already pinned is skipped. Run it BEFORE re-saving a
midterm whose type or scale changed under existing sittings, so those sittings are pinned under
the rules they were actually sat on.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Q

from exams.models import Question
from midterms.models import MidtermAttempt, MidtermOutcome, MidtermQuestionResult
from midterms.outcomes import default_pass_mark
from midterms.scoring import SCALE_100, SCALE_800
from midterms.state_machine import STATE_NOT_STARTED

_PAPER_PINNED = "paper pinned"
_PAPER_MISSING = "paper gone, left unpinned"


class Command(BaseCommand):
    help = "Pin paper/scale/pass mark onto midterm sittings that started before pinning existed."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Write. Without it, a dry run.")
        parser.add_argument("--midterm-id", type=int, default=None, help="Only this midterm.")

    def handle(self, *args, **opts):
        commit = bool(opts["commit"])
        qs = (
            MidtermAttempt.objects.filter(paper_scale="")
            .exclude(current_state=STATE_NOT_STARTED)
            .filter(Q(started_at__isnull=False) | Q(is_completed=True) | Q(score__isnull=False))
        )
        if opts.get("midterm_id"):
            qs = qs.filter(midterm_id=opts["midterm_id"])
        attempts = list(qs.select_related("midterm", "version").order_by("midterm_id", "pk"))
        outcomes = {
            o.attempt_id: o
            for o in MidtermOutcome.objects.filter(attempt_id__in=[a.pk for a in attempts])
        }

        per_midterm: dict[int, Counter] = defaultdict(Counter)
        titles: dict[int, str] = {}
        pinned = 0
        for att in attempts:
            pins, paper_ok = self._pins(att, outcomes.get(att.pk))
            tally = per_midterm[att.midterm_id]
            titles[att.midterm_id] = att.midterm.title
            tally[_PAPER_PINNED if paper_ok else _PAPER_MISSING] += 1
            tally[f"{pins['paper_scale']} pass={pins['paper_pass_mark']}"] += 1
            if commit:
                # Filtered on the empty scale so a concurrent start or a second run never
                # overwrites what is already pinned.
                pinned += MidtermAttempt.objects.filter(pk=att.pk, paper_scale="").update(**pins)
            else:
                pinned += 1

        for mid, tally in sorted(per_midterm.items()):
            parts = ", ".join(f"{k}: {v}" for k, v in sorted(tally.items()))
            self.stdout.write(f"midterm {mid} '{titles[mid]}': {parts}")
        mode = "COMMITTED" if commit else "DRY RUN (nothing written; pass --commit)"
        missing = sum(t[_PAPER_MISSING] for t in per_midterm.values())
        self.stdout.write(f"{mode}: pinned {pinned} sittings; {missing} with their paper already gone.")

    # ── one sitting ──────────────────────────────────────────────────────────
    def _pins(self, att, outcome) -> tuple[dict, bool]:
        midterm = att.midterm
        if outcome is not None and outcome.scoring_scale:
            scale, pass_mark = outcome.scoring_scale, int(outcome.pass_mark)
        else:
            if att.score is None:
                scale = midterm.scoring_scale
            else:
                scale = SCALE_100 if int(att.score) <= 100 else SCALE_800
            if not midterm.is_graded:
                pass_mark = None
            elif scale == midterm.scoring_scale:
                pass_mark = midterm.effective_pass_mark
            else:
                pass_mark = default_pass_mark(scale)
        pins = {"paper_scale": scale, "paper_pass_mark": pass_mark}

        if att.paper_module_id:
            return pins, True
        src = att.version if att.version_id else midterm
        m1 = src.question_module_id
        m2 = src.question_module_2_id if src.question_module_2_id and src.questions_for_order(2).exists() else None
        if m1 and self._paper_intact(att, [m for m in (m1, m2) if m]):
            pins.update(paper_module_id=m1, paper_module_2_id=m2)
            return pins, True
        return pins, False

    @staticmethod
    def _paper_intact(att, module_ids) -> bool:
        live = set(Question.objects.filter(module_id__in=module_ids).values_list("id", flat=True))
        scored_on = set(
            MidtermQuestionResult.objects.filter(attempt_id=att.pk).values_list("question_id", flat=True)
        )
        if not scored_on:
            scored_on = {int(k) for k in (att.answers or {}) if str(k).isdigit()}
        return scored_on <= live
