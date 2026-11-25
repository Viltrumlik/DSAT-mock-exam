"""A lesson day that does not happen as the timetable says (owner, 2026-11-25): called off, moved, or a centre holiday.

The rules and the money live in ``classes.lesson_changes``; this is only the table.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class LessonChange(models.Model):
    """A lesson day that does not happen as the timetable says (owner, 2026-11-25): called off, or moved to
    another day. No classroom = every group with a lesson that day (a centre holiday). Never deleted: undone."""

    class Kind(models.TextChoices):
        CANCEL = "cancel", "Cancelled"
        MOVE = "move", "Moved"

    classroom = models.ForeignKey(
        "classes.Classroom", null=True, blank=True, on_delete=models.CASCADE, related_name="lesson_changes"
    )
    day = models.DateField()
    kind = models.CharField(max_length=10, choices=Kind.choices)
    new_day = models.DateField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now)
    undone_at = models.DateTimeField(null=True, blank=True)
    undone_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "day"],
                condition=Q(undone_at__isnull=True, classroom__isnull=False),
                name="lesson_change_one_live_per_class_day",
            ),
            models.UniqueConstraint(
                fields=["day"],
                condition=Q(undone_at__isnull=True, classroom__isnull=True),
                name="lesson_change_one_live_holiday_per_day",
            ),
            models.CheckConstraint(
                condition=Q(kind="move", new_day__isnull=False, classroom__isnull=False)
                | Q(kind="cancel", new_day__isnull=True),
                name="lesson_change_move_has_a_class_and_a_new_day",
            ),
        ]
        indexes = [models.Index(fields=["day"]), models.Index(fields=["new_day"])]

    def __str__(self) -> str:
        where = self.classroom_id or "centre"
        return f"{self.kind} {where} {self.day}"
