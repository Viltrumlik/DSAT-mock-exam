"""A full copy of everything lc-up's External API gives us, kept after lc-up is gone.

The owner (2026-10-30): the centre will leave lc-up, so "API orqali barcha ma'lumotlarni o'zimizni
databasega olishingiz kerak". The link tables in ``models.py`` keep only what the sync acts on; these keep
lc-up's own rows, as lc-up sent them, for every kind of record the API has.

One ``LcupArchiveRecord`` per lc-up record holds its latest payload. A payload that changes is never
written over: each distinct payload is one ``LcupArchiveVersion``, so a student's balance, a group's
price or a membership's status has its whole history here. A record lc-up stops returning is marked
``gone_at``, never deleted.

Nothing here is read by the rest of the platform, and nothing here is ever sent to lc-up (``archive.py``).
"""

from django.db import models
from django.utils import timezone


class ArchiveEntity(models.TextChoices):
    FILIAL = "filial", "Filial"
    COURSE = "course", "Course"
    PAYMENT_METHOD = "payment_method", "Payment method"
    ABSENCE_REASON = "absence_reason", "Absence reason"
    TEACHER = "teacher", "Teacher"
    GROUP = "group", "Group"
    STUDENT = "student", "Student"
    #: One student's seat in one group: ``lcup_id`` is "<group id>:<student id>".
    GROUP_MEMBER = "group_member", "Group member"
    ATTENDANCE = "attendance", "Attendance"
    PAYMENT = "payment", "Payment"


class LcupArchiveRecord(models.Model):
    entity = models.CharField(max_length=20, choices=ArchiveEntity.choices)
    lcup_id = models.CharField(max_length=40)
    #: The lesson day of an attendance row, the date of a payment; null otherwise. A night's pull re-reads a
    #: window of these days, and only records inside it can be found gone.
    day = models.DateField(null=True, blank=True)
    payload = models.JSONField(default=dict)
    payload_hash = models.CharField(max_length=64)
    versions_count = models.PositiveIntegerField(default=1)
    first_seen_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    #: lc-up stopped returning it in a complete pull. Cleared if it comes back.
    gone_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["entity", "lcup_id"], name="lcup_archive_record_unique")]
        indexes = [models.Index(fields=["entity", "day"], name="lcup_archive_entity_day")]

    def __str__(self) -> str:
        return f"{self.entity} {self.lcup_id}"


class LcupArchiveVersion(models.Model):
    record = models.ForeignKey(LcupArchiveRecord, on_delete=models.CASCADE, related_name="versions")
    payload = models.JSONField(default=dict)
    payload_hash = models.CharField(max_length=64)
    seen_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["record_id", "seen_at", "id"]


class LcupArchiveMark(models.Model):
    """Small facts the archive keeps between runs: a backfill window that is done, named by its first day
    ("window:attendance:2026-01-01"); a student lc-up no longer lists but still serves by id
    ("unlisted:student:123"); or one it answered 404 for ("missing:student:123"), not asked again."""

    key = models.CharField(max_length=80, unique=True)
    done_at = models.DateTimeField(default=timezone.now)
    info = models.JSONField(default=dict, blank=True)


class LcupArchiveRun(models.Model):
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    dry_run = models.BooleanField(default=False)
    ok = models.BooleanField(default=False)
    #: Per entity: {"seen", "new", "changed", "gone", "back"}; plus "requests".
    counts = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]
