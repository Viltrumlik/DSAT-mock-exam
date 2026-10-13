"""The one-off split (plan 2026-10-13).

Every active ``student`` who is not a live lc-up member becomes ``public_student`` and loses their
classroom seats; a linked leaver with a negative lc-up balance is frozen for the debt. ``--revert``
puts back exactly what ``--apply`` changed (role, debt freeze, each seat's status), from the
``RoleChange`` rows it wrote. Prints JSON counts.
"""

import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from access import constants as C
from classes.models import ClassroomMembership
from users import audience as A
from users.models import RoleChange, User


class Command(BaseCommand):
    help = "Split learners into centre (live lc-up members) and public. --dry-run | --apply | --revert"

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument("--dry-run", action="store_true")
        g.add_argument("--apply", action="store_true")
        g.add_argument("--revert", action="store_true")

    def handle(self, *args, **opts):
        if opts["revert"]:
            return self._out(self._revert())
        plan = self._plan()
        counts = {"to_public": len(plan), "to_freeze": sum(owes for _, owes in plan)}
        if opts["apply"]:
            for u, owes in plan:
                A.make_public(u, reason=A.REASON_INITIAL_SPLIT, source=A.SOURCE_SPLIT, freeze_for_debt=owes)
            counts["applied"] = True
        self._out(counts)

    def _plan(self):
        from lcup.models import LcupStudentLink
        from lcup.sync import live_student_ids

        live_links = live_student_ids()  # LcupStudentLink pks with a live membership
        links = {link.user_id: link for link in LcupStudentLink.objects.filter(user__isnull=False)}
        plan = []
        for u in User.objects.filter(role=C.ROLE_STUDENT, is_active=True).order_by("pk"):
            link = links.get(u.pk)
            if link is not None and link.pk in live_links and not link.deleted_in_lcup:
                continue  # a learning-center student
            owes = bool(link is not None and link.balance is not None and link.balance < 0)
            plan.append((u, owes))
        return plan

    @transaction.atomic
    def _revert(self):
        n = 0
        rows = (
            RoleChange.objects.select_for_update()
            .filter(reason=A.REASON_INITIAL_SPLIT, reverted_at__isnull=True)
            .select_related("user")
        )
        for ch in rows:
            u = ch.user
            fields = ["role"]
            u.role = ch.from_role
            if ch.froze and u.frozen_reason == A.FROZEN_LCUP_DEBT:
                u.is_frozen, u.frozen_reason = False, ""
                fields += ["is_frozen", "frozen_reason"]
            u.save(update_fields=fields)
            before = {int(pk): status for pk, status in ch.removed_membership_ids}
            for seat in ClassroomMembership.objects.filter(pk__in=before):
                seat.status = before[seat.pk]
                seat.save()  # .save(): the seat's signals fire, as they did on the way out
            ch.reverted_at = timezone.now()
            ch.save(update_fields=["reverted_at"])
            n += 1
        return {"reverted": n}

    def _out(self, data):
        self.stdout.write(json.dumps(data))
