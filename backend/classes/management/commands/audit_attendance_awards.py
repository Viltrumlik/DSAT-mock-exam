"""Find — and optionally undo — attendance marked for lessons a student was not enrolled for.

    python manage.py audit_attendance_awards                 # report only
    python manage.py audit_attendance_awards --fix           # delete the marks, refund the points
    python manage.py audit_attendance_awards --classroom 42  # narrow it

**What it looks for.** An ``AttendanceRecord`` whose lesson happened *before* the student's
membership of that class began — or whose student has no membership of that class at all.
Neither can be a record of somebody attending anything.

**Why it exists.** On 2026-08-26 a student was added to two classes and, within two minutes,
marked PRESENT across both of their back-registers: sixteen lessons, all of them held before
he had joined. Attendance pays the moment a mark is saved, so that was 80 points and 80 XP,
and it put him top of the school leaderboard. Three changes now make it impossible — the
register only offers the roster as it stood on the lesson's date, it closes two hours after
the lesson ends, and ``rewards.hooks`` refuses to pay a mark that predates the membership —
but none of them clean up what is already in the database, and none of them would notice a
row written by some future path nobody thought about. This command is the sweep and the
standing check.

**How ``--fix`` undoes it.** By deleting the record, not by editing the ledger.
``rewards.hooks._on_attendance_record_deleted`` fires on the delete and revokes the award,
which zeroes points *and* XP and writes a ``PointAwardAudit`` row saying why. So the ledger
keeps the whole history — the earning, and its withdrawal — while the register stops claiming
a student was somewhere they were not. Editing ``PointAward`` by hand would leave the false
mark standing behind a corrected balance, which is the worst of both.

Safe to run repeatedly: a second pass finds nothing.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord


def _display(user) -> str:
    return (f"{user.first_name} {user.last_name}".strip() or user.username or user.email)


class Command(BaseCommand):
    help = "Report (or undo) attendance marked for lessons held before the student joined."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fix", action="store_true",
            help="Delete the offending marks, which refunds their points and XP.",
        )
        parser.add_argument("--classroom", type=int, default=None, help="Limit to one classroom id.")
        parser.add_argument("--student", type=int, default=None, help="Limit to one student id.")

    def handle(self, *args, **options):
        records = (
            AttendanceRecord.objects
            .select_related("session", "session__classroom", "student")
            .order_by("session__classroom_id", "student_id", "session__date")
        )
        if options["classroom"]:
            records = records.filter(session__classroom_id=options["classroom"])
        if options["student"]:
            records = records.filter(student_id=options["student"])

        # One query for every membership in play, rather than one per record. A record's
        # (classroom, student) pair is what decides it, and a school-wide run walks thousands.
        joined: dict[tuple[int, int], object] = {
            (classroom_id, user_id): joined_at
            for classroom_id, user_id, joined_at in ClassroomMembership.objects.filter(
                role=ClassroomMembership.ROLE_STUDENT
            ).values_list("classroom_id", "user_id", "joined_at")
        }

        offenders = []
        for record in records:
            key = (record.session.classroom_id, record.student_id)
            joined_at = joined.get(key)
            if joined_at is None:
                offenders.append((record, None))
            elif timezone.localdate(joined_at) > record.session.date:
                offenders.append((record, timezone.localdate(joined_at)))

        if not offenders:
            self.stdout.write(self.style.SUCCESS("No attendance found for lessons before a student joined."))
            return

        # Grouped by (classroom, student) because that is how a person reads it: "this student
        # was marked for six lessons in this class before they were in it" is one fact, not six.
        groups: dict[tuple[int, int], list] = {}
        for record, joined_date in offenders:
            groups.setdefault((record.session.classroom_id, record.student_id), []).append(
                (record, joined_date)
            )

        self.stdout.write(self.style.WARNING(
            f"{len(offenders)} mark(s) across {len(groups)} student/class pair(s):"
        ))
        for (classroom_id, student_id), rows in groups.items():
            first_record, joined_date = rows[0]
            classroom = first_record.session.classroom
            student = first_record.student
            when = joined_date.isoformat() if joined_date else "never a member"
            self.stdout.write(
                f"  {_display(student)} (id={student_id}) in {classroom.name!r} "
                f"(id={classroom_id}) — joined {when}"
            )
            for record, _ in rows:
                self.stdout.write(
                    f"      {record.session.date} {record.status:8s} record={record.id}"
                )

        if not options["fix"]:
            self.stdout.write("")
            self.stdout.write("Nothing was changed. Re-run with --fix to delete these marks.")
            return

        with transaction.atomic():
            # Deleted one at a time, deliberately. A queryset delete would fast-path the rows
            # and the post_delete receiver that refunds them would never fire — see
            # rewards.hooks._on_attendance_record_deleted, which exists to be that receiver.
            for record, _ in offenders:
                record.delete()

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Deleted {len(offenders)} mark(s); their points and XP have been refunded."
        ))
