"""Settle the past papers that were finished before the finish was ever announced.

**What went wrong.** ``TestAttempt.complete_test`` records the finish with a conditional
queryset ``UPDATE`` (``exams.engine_db_guard``) — the concurrency guard that compares state and
version in the WHERE clause. A queryset update sends no ``post_save``, so all three receivers
waiting on a finished attempt never ran:

* ``classes.pastpaper_signals``        — the certificate
* ``classes.homework_attempt_signals`` — the class Submission (the homework handed in)
* ``rewards.hooks._on_test_attempt_saved`` — the points and the XP

On 2026-09-18 production held 976 finished past papers, 0 certificates, 0 handed-in rows and
0 points. ``exams.models.TestAttempt._announce_completion`` fixes it from now on. This command
is for the papers finished before that line existed.

    python manage.py backfill_finished_pastpapers --dry-run
    python manage.py backfill_finished_pastpapers --dry-run --since=2026-08-01
    python manage.py backfill_finished_pastpapers --since=2026-08-01

**It is silent to students, and that is a decision, not a side effect.** These facts are weeks
old. Settling them is right; telling a student in September that they earned 15 points for a
paper they sat in August is not — forty of those in one minute teaches them that the bell is
noise, after which the homework deadline never reaches them either. So the whole run happens
inside ``core.quiet.quiet_delivery()``, which makes two things no-ops for the duration:

* ``notifications.services.notify`` / ``notify_many`` — the in-app bell, and with it the push
  fan-out that hangs off it. (``REWARD_EARNED`` is not a push event in any case, and nothing on
  this path sends email at all: the only ``send_mail`` in ``classes`` is ``classes.alerting``,
  reachable from the storage sweep and from nothing here.)
* ``realtime.services.emit_to_user`` / ``emit_to_users`` — the nudge that makes an open tab
  refetch, and the one ``emit_to_classroom_members`` funnels through.

**What this path does *not* produce, despite the name of the feed.** A settled past paper does
not put an item in the class stream, and neither does a live one. ``ClassroomStreamItem`` is
written for a submission only while its status is ``SUBMITTED``
(``classes.stream_signals._ensure_stream_submission``), and a practice/pastpaper homework is
``is_auto_graded``, so the sync takes ``_auto_grade`` and the row lands on ``REVIEWED`` without
ever passing through ``SUBMITTED``. Nothing on this path reaches a realtime emit at all: the
only notification it can produce is the reward bell, and that is stopped at ``notify`` above.
The realtime half of the quiet is therefore belt to that braces — it guards the chokepoint, not
this route — and it is pinned directly in
``classes.tests_pastpaper_completion_settles.QuietSilencesRealtimeTests`` rather than by a
backfill assertion that would pass with the guard deleted.

The rows themselves are written normally. A student sees their certificate, their handed-in
homework and their points the next time they open the page — they are simply not interrupted
about it. **This is not a dry run:** ``--dry-run`` is, and it is a different flag.

**Why it calls the three effects rather than re-sending the signal.** Re-sending ``post_save``
would be the more faithful thing and it is what the live path does, but ``rewards.hooks``
settles through ``transaction.on_commit`` — and Django discards on-commit callbacks registered
inside an atomic block that is then rolled back, which is exactly how ``--dry-run`` works here.
A dry run would therefore have reported every award as "nothing to do" and then a real run would
have paid them: the one lie an operator must not be told before they commit to a backfill. The
three calls below are the three receivers, in the order the live path runs them (see the note
above ``_settle_one``), and a fourth receiver on a finished ``TestAttempt`` has to be added here
too.

**``--dry-run`` accumulates.** It runs the whole sweep inside one transaction and unwinds it at
the end, rather than rolling back after each paper, because two papers routinely settle the same
award — one homework targeting an RW section and a Math section is the ordinary shape. Measuring
each paper against the un-settled world printed that award once per section. See ``handle``.

**Safe to run twice**, because every effect it triggers is idempotent: the certificate upserts
on the attempt, the submission on assignment+student (and refuses to overwrite a teacher's own
grade), the award on its ``homework:<assignment>:<student>`` key. A second run reports zeroes.

**Scope: past papers only** — ``PracticeTest`` with no ``mock_exam``. That is the 976, and it is
what ``PastpaperCertificate`` is for. Mock and midterm *sections* reach ``complete_test`` through
the same model and are fixed going forward by the same line, but settling their history is a
different decision with a different blast radius and is not made here.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.quiet import quiet_delivery


class _Rollback(Exception):
    """Raised to unwind a --dry-run's transaction once the whole sweep has been measured."""


def _parse_since(raw: str | None):
    if not raw:
        return None
    try:
        day = datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError as exc:  # noqa: BLE001
        raise CommandError("--since must be a date, as YYYY-MM-DD.") from exc
    # Start of that day in the learning center's own timezone: an operator typing a date means
    # the day as it was lived here, not as UTC happened to slice it.
    return timezone.make_aware(datetime.combine(day, datetime.min.time()))


class Command(BaseCommand):
    help = (
        "Produce the certificate, handed-in homework and points that a finished past paper "
        "should have produced on the day. Silent to students. Safe to run twice."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be settled and change nothing at all.",
        )
        parser.add_argument(
            "--since",
            default=None,
            metavar="YYYY-MM-DD",
            help="Only papers finished on or after this date. Omit for all of history.",
        )

    # ── the three effects, in the order the live path runs them ──────────────
    #
    # The order is the dispatch order of the three ``post_save`` receivers on a finished
    # ``TestAttempt``: ``classes`` is ahead of ``rewards`` in ``INSTALLED_APPS``, and inside
    # ``classes.apps.ready`` ``homework_attempt_signals`` is imported before
    # ``pastpaper_signals``. So live it is sync → certificate → rewards, and that is the order
    # below. Nothing depends on it — the certificate reads the attempt, the sync reads the
    # attempts, neither reads the other's rows — but a command whose docstring claims to
    # reproduce the live path should reproduce it, not approximately.

    def _settle_one(self, attempt) -> dict:
        """Run the three receivers' work for one attempt and measure what moved.

        Measured by reading the rows back rather than by trusting a return value: the sync and
        the reward service both have several "nothing to do" exits, and the owner is going to
        read these numbers before deciding to run this for real.
        """
        from classes.homework_auto_submit import sync_homework_after_test_attempt_saved
        from classes.models import Submission
        from classes.models_certificates import PastpaperCertificate
        from classes.pastpaper_certificate import maybe_issue
        from rewards.homework import recompute_bundle
        # The reward receiver's own selector, borrowed rather than re-derived. It resolves a
        # section reached through a plain FK, a JSON id list, a pack or a mock shell, and a
        # second copy of that here would drift from the live path the first time one of those
        # four shapes changed.
        from rewards.hooks import _assignments_targeting_practice_test
        from rewards.models import PointAward

        student = attempt.student

        def _submissions() -> dict:
            return {
                row["assignment_id"]: (row["status"], row["attempt_id"], row["revision"])
                for row in Submission.objects.filter(student_id=student.pk).values(
                    "assignment_id", "status", "attempt_id", "revision"
                )
            }

        def _awards() -> dict:
            return {
                row["idempotency_key"]: (row["event"], row["points"], row["xp"])
                for row in PointAward.objects.filter(
                    student_id=student.pk, idempotency_key__startswith="homework:"
                ).values("idempotency_key", "event", "points", "xp")
            }

        cert_before = PastpaperCertificate.objects.filter(attempt_id=attempt.pk).exists()
        subs_before = _submissions()
        awards_before = _awards()

        sync_homework_after_test_attempt_saved(attempt)
        maybe_issue(attempt)
        for assignment in _assignments_targeting_practice_test(student, attempt.practice_test_id):
            recompute_bundle(assignment, student)

        cert_after = PastpaperCertificate.objects.filter(attempt_id=attempt.pk).exists()
        subs_after = _submissions()
        awards_after = _awards()

        moved_submissions = [
            assignment_id
            for assignment_id, row in subs_after.items()
            if subs_before.get(assignment_id) != row
        ]
        moved_awards = {
            key: row for key, row in awards_after.items() if awards_before.get(key) != row
        }
        # Points the student did not have before this attempt was settled. A correction that
        # lowers an award contributes a negative here, which is the honest number to print.
        points_delta = sum(
            row[1] - (awards_before.get(key) or ("", 0, 0))[1] for key, row in moved_awards.items()
        )
        by_kind: dict[str, int] = defaultdict(int)
        for event, _points, _xp in moved_awards.values():
            by_kind[event] += 1
        return {
            "certificate": 1 if (cert_after and not cert_before) else 0,
            "submissions": len(moved_submissions),
            "awards_by_kind": by_kind,
            "awards": len(moved_awards),
            "points": points_delta,
        }

    # ── the run ──────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from classes.pastpaper_retake import finished_at_expr
        from exams.models import TestAttempt

        dry_run = bool(options["dry_run"])
        since = _parse_since(options.get("since"))

        attempts = (
            TestAttempt.objects.filter(
                is_completed=True,
                current_state=TestAttempt.STATE_COMPLETED,
                practice_test__mock_exam_id__isnull=True,
                practice_test__isnull=False,
                student__isnull=False,
            )
            .annotate(_finished_at=finished_at_expr())
            .order_by("pk")
        )
        if since is not None:
            attempts = attempts.filter(_finished_at__gte=since)
        # The ids first, then one row at a time. ``.iterator()`` would hold a server-side cursor
        # open on Postgres across the commits this loop makes, and a committed transaction is
        # exactly what invalidates one. A few hundred integers is not worth that risk.
        attempt_ids = list(attempts.values_list("pk", flat=True))

        by_class: dict[str, dict] = defaultdict(
            lambda: {"attempts": 0, "certificates": 0, "submissions": 0, "awards": 0, "points": 0}
        )
        by_kind: dict[str, int] = defaultdict(int)
        totals = {
            "attempts": 0,
            "touched": 0,
            "certificates": 0,
            "submissions": 0,
            "awards": 0,
            "points": 0,
            "failed": 0,
        }

        with quiet_delivery():
            if dry_run:
                # ONE transaction around the whole dry run, unwound once at the end — not one
                # rollback per attempt.
                #
                # Two in-scope attempts routinely resolve to the same award key. The standard
                # SAT homework is a single Assignment targeting an RW section and a Math
                # section (``assignment_target_practice_test_ids``), and both sittings settle
                # the one ``homework:<assignment>:<student>`` award; a retake of the same
                # paper does it too. A real run settles the first attempt and then finds the
                # work already done when it reaches the second, so it pays once. Rolling back
                # per attempt measured every attempt against the un-settled world and counted
                # that award once per section: a 40-student class of two-section bundles
                # printed "+600 points" for a real run that pays +300, and the owner decides
                # from this report. Accumulating inside one transaction makes the dry run's
                # state evolve exactly as the real run's does.
                #
                # The cost is a long-lived transaction holding the whole sweep's row locks.
                # That is acceptable *because* it is the dry run: it writes nothing anybody
                # keeps, and it is the run an operator makes deliberately, once, before
                # committing. The real run below still commits per attempt.
                try:
                    with transaction.atomic():
                        self._sweep(attempt_ids, totals=totals, by_class=by_class, by_kind=by_kind)
                        raise _Rollback
                except _Rollback:
                    pass
            else:
                self._sweep(attempt_ids, totals=totals, by_class=by_class, by_kind=by_kind)

        self._report(dry_run=dry_run, since=since, totals=totals, by_class=by_class, by_kind=by_kind)
        if totals["failed"]:
            # Printed first, then failed: a sweep that could not settle part of its window is
            # a partial sweep, and an operator (or a cron line, or a deploy step) reading only
            # the exit code must not be told it finished.
            raise CommandError(
                f"{totals['failed']} paper(s) could not be settled — see the errors above."
            )

    def _sweep(self, attempt_ids, *, totals, by_class, by_kind) -> None:
        """Walk the window, settling each attempt and accumulating what moved."""
        from exams.models import TestAttempt

        for attempt_id in attempt_ids:
            attempt = (
                TestAttempt.objects.select_related("practice_test", "student")
                .filter(pk=attempt_id)
                .first()
            )
            if attempt is None:
                # Deleted while the backfill was running. It was never examined, so counting
                # it as examined would make "papers examined" disagree with the window.
                continue
            totals["attempts"] += 1
            try:
                result = self._run_one(attempt)
            except Exception as exc:  # noqa: BLE001
                totals["failed"] += 1
                self.stderr.write(
                    f"attempt {attempt.pk} (student {attempt.student_id}) could not be "
                    f"settled: {exc}"
                )
                continue

            if not (result["certificate"] or result["submissions"] or result["awards"]):
                continue

            totals["touched"] += 1
            totals["certificates"] += result["certificate"]
            totals["submissions"] += result["submissions"]
            totals["awards"] += result["awards"]
            totals["points"] += result["points"]
            for kind, n in result["awards_by_kind"].items():
                by_kind[kind] += n

            label = self._class_label(attempt)
            row = by_class[label]
            row["attempts"] += 1
            row["certificates"] += result["certificate"]
            row["submissions"] += result["submissions"]
            row["awards"] += result["awards"]
            row["points"] += result["points"]

    def _run_one(self, attempt) -> dict:
        """Settle one attempt inside its own atomic block.

        On a real run that block is a transaction and commits on its own: a paper whose report
        cannot be built must not take the other 975 down with it, and the work already done
        stays done. On a dry run the caller has already opened a transaction, so the same
        block is a savepoint inside it — same isolation for a failing paper, while everything
        that succeeds stays visible to the attempts that follow.
        """
        with transaction.atomic():
            return self._settle_one(attempt)

    def _class_label(self, attempt) -> str:
        """Which class list this student's settled work belongs to, for the owner's summary.

        A student can be in more than one class; the papers they sit are not owned by any of
        them. Naming every class they are an active member of is the honest answer and is what
        the owner needs to see, so the label is the joined list rather than a guess at one.
        """
        from classes.models import ClassroomMembership

        names = list(
            ClassroomMembership.objects.filter(
                user_id=attempt.student_id,
                role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            )
            .select_related("classroom")
            .values_list("classroom__name", flat=True)
            .order_by("classroom__name")
        )
        return " + ".join(names) if names else "(no class)"

    def _report(self, *, dry_run, since, totals, by_class, by_kind) -> None:
        w = self.stdout.write
        window = f"finished on or after {since:%Y-%m-%d}" if since else "all of history"
        head = "WOULD SETTLE (dry run — nothing was written)" if dry_run else "SETTLED"
        w("")
        w(f"{head} · past papers, {window}")
        w(f"  papers examined                {totals['attempts']}")
        w(f"  papers that needed settling    {totals['touched']}")
        w("")
        w("  certificates issued            %d" % totals["certificates"])
        w("  homework handed in             %d" % totals["submissions"])
        w("  awards written or corrected    %d" % totals["awards"])
        w("  points moved                   %+d" % totals["points"])
        if totals["failed"]:
            w("")
            w(f"  papers that failed             {totals['failed']}  (listed above)")

        if by_kind:
            w("")
            w("  By award kind")
            for kind in sorted(by_kind):
                w(f"    {kind:<24} {by_kind[kind]}")

        if by_class:
            w("")
            w("  By class list")
            w(f"    {'class':<34}{'papers':>8}{'certs':>8}{'handed in':>12}{'awards':>8}{'points':>9}")
            for label in sorted(by_class):
                r = by_class[label]
                w(
                    f"    {label[:33]:<34}{r['attempts']:>8}{r['certificates']:>8}"
                    f"{r['submissions']:>12}{r['awards']:>8}{r['points']:>+9}"
                )

        w("")
        if dry_run:
            w(self.style.WARNING("Nothing was written. Re-run without --dry-run to settle."))
        elif totals["touched"]:
            w(self.style.SUCCESS("Settled. Students were not notified — see this command's docstring."))
        else:
            w(self.style.SUCCESS("Nothing to settle — every paper in the window is already settled."))
