"""
Re-pin assessment homeworks whose snapshot has gone STALE relative to the live set.

A homework pins an AssessmentSetVersion snapshot. If a teacher edited the set
(added/removed questions) after that version was created, newly-assigned homeworks
kept the old snapshot — students then get e.g. 2 of 24 questions while the board
(live count) shows 24.

This command finds every homework whose pinned snapshot question count differs
from the live active count, publishes a fresh version of each affected set (so the
snapshot matches the live content), and re-pins the stale homeworks that have NO
active attempt (in_progress/submitted/graded). Homeworks with a student already
engaged are LEFT ALONE (listed in the report) so nobody's attempt shifts mid-flight.

Dry-run by default. Pass --apply to make changes.

    python manage.py resync_assessment_homework_versions            # dry-run
    python manage.py resync_assessment_homework_versions --apply
    python manage.py resync_assessment_homework_versions --set-id 13 --apply
"""
from django.core.management.base import BaseCommand

from assessments.models import HomeworkAssignment, AssessmentSet, AssessmentAttempt
from assessments.domain.snapshot_builder import questions_from_snapshot
from assessments.domain.homework_versioning import (
    ensure_current_version,
    resync_stale_homeworks,
    ACTIVE_ATTEMPT_STATUSES,
)


def _snapshot_count(hw) -> int | None:
    if not hw.set_version_id:
        return None
    try:
        return len(questions_from_snapshot(hw.set_version.snapshot_json))
    except Exception:
        return -1


class Command(BaseCommand):
    help = "Re-pin assessment homeworks whose snapshot is stale vs the live set."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Make changes (default: dry-run).")
        parser.add_argument("--set-id", type=int, default=None, help="Limit to one AssessmentSet id.")

    def handle(self, *args, **opts):
        apply = opts["apply"]
        set_id = opts["set_id"]

        hw_qs = HomeworkAssignment.objects.select_related("assessment_set", "set_version")
        if set_id:
            hw_qs = hw_qs.filter(assessment_set_id=set_id)

        # Find stale sets (any homework whose snapshot count != live active count).
        stale_set_ids: set[int] = set()
        stale_rows = []
        for hw in hw_qs:
            live = hw.assessment_set.questions.filter(is_active=True).count()
            snap = _snapshot_count(hw)
            if snap is not None and snap != live:
                stale_set_ids.add(hw.assessment_set_id)
                stale_rows.append((hw.id, hw.assessment_set_id, hw.assessment_set.title, live, snap))

        if not stale_rows:
            self.stdout.write(self.style.SUCCESS("No stale homeworks found. Nothing to do."))
            return

        self.stdout.write(f"Stale homeworks: {len(stale_rows)} across {len(stale_set_ids)} set(s)")
        for hid, sid, title, live, snap in stale_rows:
            self.stdout.write(f"  HW {hid} set {sid} '{title[:40]}' live={live} snap={snap}")

        if not apply:
            self.stdout.write(self.style.WARNING("\nDRY RUN — pass --apply to publish fresh versions and re-pin."))
            # Show which homeworks would be SKIPPED (active attempts).
            for sid in sorted(stale_set_ids):
                active = set(
                    AssessmentAttempt.objects.filter(
                        homework__assessment_set_id=sid, status__in=ACTIVE_ATTEMPT_STATUSES
                    ).values_list("homework_id", flat=True)
                )
                if active:
                    self.stdout.write(f"  set {sid}: {len(active)} homework(s) have active attempts and will be SKIPPED: {sorted(active)}")
            return

        total_repinned = 0
        for sid in sorted(stale_set_ids):
            aset = AssessmentSet.objects.get(pk=sid)
            version = ensure_current_version(set_id=sid, actor=None)
            if version is None:
                self.stdout.write(self.style.ERROR(f"  set {sid}: could not resolve a current version (publish validation failed?) — skipped"))
                continue
            n = resync_stale_homeworks(assessment_set=aset, version=version)
            total_repinned += n
            snap_n = _snapshot_count_for_version(version)
            self.stdout.write(self.style.SUCCESS(
                f"  set {sid} '{aset.title[:40]}': pinned version {version.version_number} "
                f"(snapshot={snap_n} questions) → re-pinned {n} homework(s)"
            ))

        self.stdout.write(self.style.SUCCESS(f"\nDone. Re-pinned {total_repinned} homework(s)."))


def _snapshot_count_for_version(version) -> int:
    try:
        return len(questions_from_snapshot(version.snapshot_json))
    except Exception:
        return -1
