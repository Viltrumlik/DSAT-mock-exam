"""Where the school physically is: regions, and the branches inside them.

Neither existed before. The platform knew a classroom's name, subject, level, lesson days and
room number, and nothing at all about which building it met in — so "how is my branch doing?"
had no data to stand on.

**A student's branch is derived, never stored.** It comes from the classroom they study in,
which is the school's own rule and also the only one that stays true on its own: a student who
transfers moves classroom, and their branch follows without anyone remembering to update a
second field. The cost is that the derivation needs a tie-break for a student enrolled in two
classrooms at two branches, which :func:`branch_for_student` spells out.

Region contains Branch contains Classroom. Both levels are administered rather than
free-texted, because the whole point is grouping — two branches spelled "Chilonzor" and
"chilonzor " would split a leaderboard in half and nobody would notice for a term.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class Region(models.Model):
    """A city or area holding one or more branches."""

    name = models.CharField(max_length=120, unique=True)
    # Short form for dense UI — a leaderboard filter chip has no room for "Tashkent City".
    code = models.CharField(
        max_length=16, blank=True, default="",
        help_text="Optional short label for filter chips, e.g. TAS.",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "org_regions"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Branch(models.Model):
    """One physical school site. Classrooms hang off this; students inherit it."""

    region = models.ForeignKey(
        Region, on_delete=models.PROTECT, related_name="branches",
        # PROTECT rather than CASCADE: deleting a region must not silently take every branch
        # and every classroom's location with it. Deactivate instead.
    )
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=16, blank=True, default="")
    address = models.CharField(max_length=240, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "org_branches"
        ordering = ["region__name", "name"]
        constraints = [
            # Two branches with the same name in one region is a data-entry mistake, and it
            # splits that branch's leaderboard in two without anything looking wrong.
            models.UniqueConstraint(fields=["region", "name"], name="uniq_branch_name_per_region"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.region.name})"


def branch_for_student(student):
    """The branch a student belongs to, derived from where they study. ``None`` if unknowable.

    The tie-break, for a student enrolled in classrooms at two branches: **the most recently
    joined active membership wins**. Deterministic, and it matches what a transfer actually
    looks like — the new class is the recent one, so the student appears on their new
    branch's board the day they join it rather than the day somebody remembers to edit them.

    ``None`` is a real answer, not a failure: a student between classes, or in a classroom
    nobody has assigned a branch to yet, has no branch. Callers must render that as "no
    branch" and never as branch zero.
    """
    from .models import ClassroomMembership

    membership = (
        ClassroomMembership.objects.filter(
            user=student,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            classroom__branch__isnull=False,
        )
        .select_related("classroom__branch__region")
        .order_by("-joined_at", "-id")
        .first()
    )
    return membership.classroom.branch if membership else None


def branch_ids_for_students(student_ids) -> dict[int, int]:
    """``{student_id: branch_id}`` for a cohort, in one query.

    Same tie-break as :func:`branch_for_student` and it has to stay that way — a board that
    grouped students differently from the way their own profile names their branch would be
    unarguable-with. Students with no branch are absent from the mapping rather than mapped
    to ``None``, so a caller cannot accidentally group them together.
    """
    from .models import ClassroomMembership

    if not student_ids:
        return {}
    rows = (
        ClassroomMembership.objects.filter(
            user_id__in=student_ids,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            classroom__branch__isnull=False,
        )
        .order_by("user_id", "-joined_at", "-id")
        .values_list("user_id", "classroom__branch_id")
    )
    out: dict[int, int] = {}
    for user_id, branch_id in rows:   # first per user wins, matching the ordering above
        out.setdefault(user_id, branch_id)
    return out
