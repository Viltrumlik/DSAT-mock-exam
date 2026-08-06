"""One attendance session per (classroom, date).

Production predates the constraint, so duplicates may exist: the create endpoint used a
plain ``create()`` and the UI offers a free date field. Adding the constraint on top of
duplicate rows would abort the migration, so they are merged first.

Merging (rather than deleting the extras) matters because attendance is about to become a
reward trigger: a discarded record is a lesson a student attended and would not be paid for.
"""

from django.conf import settings
from django.db import migrations, models


def merge_duplicate_sessions(apps, schema_editor):
    AttendanceSession = apps.get_model("classes", "AttendanceSession")
    AttendanceRecord = apps.get_model("classes", "AttendanceRecord")

    dupes = (
        AttendanceSession.objects.values("classroom_id", "date")
        .annotate(n=models.Count("id"))
        .filter(n__gt=1)
    )

    for group in dupes:
        sessions = list(
            AttendanceSession.objects.filter(
                classroom_id=group["classroom_id"], date=group["date"]
            ).order_by("id")
        )
        # Keep the most authoritative survivor: a FINALIZED session outranks a draft, then
        # the one carrying the most marks, then the oldest. Ordering is total, so the choice
        # is deterministic across a re-run.
        keeper = sorted(
            sessions,
            key=lambda s: (
                s.status == "FINALIZED",
                AttendanceRecord.objects.filter(session_id=s.id).count(),
                -s.id,
            ),
            reverse=True,
        )[0]

        for loser in sessions:
            if loser.id == keeper.id:
                continue
            for record in AttendanceRecord.objects.filter(session_id=loser.id):
                # The keeper's own mark for this student wins — it is the one the teacher
                # saw on screen. (session, student) is unique, so a blind move would crash.
                if AttendanceRecord.objects.filter(
                    session_id=keeper.id, student_id=record.student_id
                ).exists():
                    record.delete()
                else:
                    record.session_id = keeper.id
                    record.save(update_fields=["session"])
            if not keeper.title and loser.title:
                keeper.title = loser.title
                keeper.save(update_fields=["title"])
            loser.delete()


def noop(apps, schema_editor):
    """Merged sessions cannot be split back apart; dropping the constraint is enough."""


class Migration(migrations.Migration):

    dependencies = [
        ('classes', '0039_assignment_video_file'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(merge_duplicate_sessions, noop),
        migrations.AddConstraint(
            model_name='attendancesession',
            constraint=models.UniqueConstraint(fields=('classroom', 'date'), name='uniq_attendance_session_per_day'),
        ),
    ]
