"""Append-only record of every change to who is in a classroom.

**Why this exists.** On 2026-08-29 a whole classroom — ``Junior G15 | English | Amirbek`` —
was emptied: fourteen students removed in sixty-two seconds. Asked who did it and when,
the platform could not say. ``ClassroomMembership`` carries ``joined_at`` and nothing else:
no ``removed_at``, no actor, no history. The answer had to be reconstructed from nginx
access logs, which name an IP rather than a person and are deleted after ten days. Anything
older than that window is simply unanswerable, for ever.

So this is the record that should have existed. One row per change, never updated, never
deleted — the shape ``AccessGrantEvent`` and ``PointAwardAudit`` already use in this
codebase.

**Names are copied in, not just referenced.** ``student``, ``actor`` and ``classroom`` are
all ``SET_NULL``: deleting an account or a class must never destroy the history of what was
done to it, and a foreign key that cascades would do exactly that. But a null FK with no
name is a row that says "somebody removed somebody from something", which is not an audit
trail. So the display names are written into the row at the moment it happens. They are a
snapshot on purpose — a person renamed next term should still read, in this table, under the
name the change was made against.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class ClassroomMembershipEvent(models.Model):
    ACTION_ADDED = "ADDED"
    ACTION_REMOVED = "REMOVED"
    ACTION_REINSTATED = "REINSTATED"
    ACTION_ROLE_CHANGED = "ROLE_CHANGED"
    ACTION_STATUS_CHANGED = "STATUS_CHANGED"
    ACTION_DELETED = "DELETED"
    ACTION_CHOICES = [
        (ACTION_ADDED, "Added to the class"),
        (ACTION_REMOVED, "Removed from the class"),
        (ACTION_REINSTATED, "Put back in the class"),
        (ACTION_ROLE_CHANGED, "Role changed"),
        (ACTION_STATUS_CHANGED, "Status changed"),
        # The membership ROW was destroyed, not soft-removed. Rare and worth its own name:
        # removal is reversible and leaves the row, a delete does not.
        (ACTION_DELETED, "Membership row deleted"),
    ]

    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="membership_events",
    )
    classroom_name = models.CharField(max_length=200, blank=True)

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="membership_events",
    )
    student_name = models.CharField(max_length=200, blank=True)

    #: Null means nobody clicked — a management command, a migration, a Celery task. See
    #: ``core.actor``: an empty actor is a real answer there, not a missing one.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="membership_events_authored",
    )
    actor_name = models.CharField(max_length=200, blank=True)

    action = models.CharField(max_length=16, choices=ACTION_CHOICES, db_index=True)
    previous_role = models.CharField(max_length=10, blank=True)
    new_role = models.CharField(max_length=10, blank=True)
    previous_status = models.CharField(max_length=10, blank=True)
    new_status = models.CharField(max_length=10, blank=True)

    note = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "classroom_membership_events"
        ordering = ["-created_at", "-id"]
        indexes = [
            # The three questions this table is asked, in the order it will be asked them:
            # "what happened in this class", "what happened to this student", "what did this
            # person do". Each is a scan of one index rather than of the table.
            models.Index(fields=["classroom", "-created_at"], name="cme_classroom_created"),
            models.Index(fields=["student", "-created_at"], name="cme_student_created"),
            models.Index(fields=["actor", "-created_at"], name="cme_actor_created"),
        ]

    def __str__(self) -> str:
        who = self.actor_name or "system"
        return f"{who} {self.action} {self.student_name} @ {self.classroom_name}"
