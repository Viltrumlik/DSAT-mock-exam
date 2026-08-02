"""Give already-assigned retakes to the students who were ABSENT from the parent midterm.

A retake used to be granted only to students with a recorded FAIL on its parent. An absentee
has no ``MidtermOutcome`` row at all — the row is written only by ``MidtermAttempt.complete()``
— so the students who missed the sitting were silently skipped: no grant, no summons email, and
a 403 at the door if a teacher granted one by hand.

``midterms.access`` now reads the rule as "did not pass the parent", which fixes every FUTURE
assignment. This command repairs the retakes already sitting in the database, so a teacher does
not have to re-assign each one by hand to pick up the students who were off sick.

    python manage.py backfill_retake_grants --dry-run          # every published retake
    python manage.py backfill_retake_grants --midterm 42
    python manage.py backfill_retake_grants --classroom 7

Idempotent: a student who already holds an ACTIVE grant is skipped by the assignment service.
Only classrooms that were ALREADY assigned the retake are touched — this never assigns a retake
to a new class, and it never grants to a student who passed the parent or was never in its
cohort.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from access.engine.assignment_service import AssignmentService
from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from midterms.access import retake_eligible_students
from midterms.models import Midterm


class Command(BaseCommand):
    help = "Grant already-assigned retakes to students who were absent from the parent midterm."

    def add_arguments(self, parser):
        parser.add_argument("--midterm", type=int, default=None, help="Only this retake midterm id.")
        parser.add_argument("--classroom", type=int, default=None, help="Only this classroom id.")
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")

    def handle(self, *args, **opts):
        dry = bool(opts["dry_run"])
        retakes = Midterm.objects.filter(midterm_type=Midterm.TYPE_RETAKE, retake_of__isnull=False)
        if opts["midterm"]:
            retakes = retakes.filter(pk=int(opts["midterm"]))

        total_granted = 0
        touched = 0
        for midterm in retakes.order_by("pk"):
            eligible_ids = set(retake_eligible_students(midterm).values_list("pk", flat=True))
            if not eligible_ids:
                continue

            # Only classrooms this retake was ALREADY assigned to. The existing grants are the
            # record of "a teacher assigned this here"; we are filling a hole in that set, not
            # creating a new assignment.
            classroom_ids = set(
                ResourceAccessGrant.objects.filter(
                    scope=ResourceAccessGrant.SCOPE_RESOURCE,
                    resource_type=RT_MIDTERM_V2,
                    resource_id=midterm.pk,
                    classroom__isnull=False,
                ).values_list("classroom_id", flat=True)
            )
            if opts["classroom"]:
                classroom_ids &= {int(opts["classroom"])}

            for classroom_id in sorted(classroom_ids):
                missing = self._missing_for(midterm, classroom_id, eligible_ids)
                if not missing:
                    continue
                touched += 1
                if dry:
                    self.stdout.write(
                        f"[dry-run] midterm {midterm.pk} ({midterm.title}) classroom {classroom_id}: "
                        f"would grant to {len(missing)} student(s) {sorted(missing)}"
                    )
                    total_granted += len(missing)
                    continue
                with transaction.atomic():
                    result = self._grant(midterm, classroom_id, missing)
                created = int(result.get("created", 0))
                total_granted += created
                self.stdout.write(
                    f"midterm {midterm.pk} ({midterm.title}) classroom {classroom_id}: granted {created}"
                )

        verb = "Would grant" if dry else "Granted"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {total_granted} retake grant(s) across {touched} classroom assignment(s).")
        )

    @staticmethod
    def _missing_for(midterm, classroom_id, eligible_ids) -> set[int]:
        """Eligible students on this classroom's roster who hold no grant for the retake."""
        from classes.models import ClassroomMembership

        roster = set(
            ClassroomMembership.objects.filter(
                classroom_id=classroom_id, role=ClassroomMembership.ROLE_STUDENT
            )
            .exclude(status=ClassroomMembership.STATUS_REMOVED)
            .values_list("user_id", flat=True)
        )
        already = set(
            ResourceAccessGrant.objects.filter(
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
                resource_id=midterm.pk,
                classroom_id=classroom_id,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            ).values_list("user_id", flat=True)
        )
        return (roster & eligible_ids) - already

    @staticmethod
    def _grant(midterm, classroom_id, user_ids):
        from django.contrib.auth import get_user_model

        from classes.models import Classroom

        User = get_user_model()
        return AssignmentService.bulk_assign_resource(
            list(User.objects.filter(pk__in=user_ids)),
            RT_MIDTERM_V2,
            midterm.pk,
            source=ResourceAccessGrant.SOURCE_CLASSROOM,
            classroom=Classroom.objects.filter(pk=classroom_id).first(),
            note="retake backfill — absent from the original midterm",
        )
