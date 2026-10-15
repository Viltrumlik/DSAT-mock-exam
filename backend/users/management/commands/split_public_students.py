"""The one-off split (plans 2026-10-13 and 2026-10-14).

The seat rule (owner, 2026-10-14: "guruhi yo'q studentlar to'g'ridan to'g'ri public bo'lib qolsin"):
every active ``student`` with no seat in an active class becomes ``public_student`` — frozen for the
debt when lc-up shows one — and a public learner who has a seat becomes a student again. ``--revert``
puts back exactly what ``--apply`` changed (role, debt freeze, each seat's status), from the
``RoleChange`` rows it wrote. Prints JSON counts.
"""

import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from classes.models import ClassroomMembership
from users import audience as A
from users.models import RoleChange


class Command(BaseCommand):
    help = "Split learners into centre (a seat in a class) and public. --dry-run | --apply | --revert"

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument("--dry-run", action="store_true")
        g.add_argument("--apply", action="store_true")
        g.add_argument("--revert", action="store_true")

    def handle(self, *args, **opts):
        if opts["revert"]:
            return self._out(self._revert())
        to_public, to_centre = A.seat_plan()
        counts = {
            "to_public": len(to_public),
            "to_freeze": sum(owes for _, owes in to_public),
            "to_centre": len(to_centre),
        }
        if opts["apply"]:
            for u, owes in to_public:
                A.make_public(u, reason=A.REASON_INITIAL_SPLIT, source=A.SOURCE_SPLIT, freeze_for_debt=owes)
            for u in to_centre:
                A.make_centre(u, reason=A.REASON_INITIAL_SPLIT, source=A.SOURCE_SPLIT)
            counts["applied"] = True
        self._out(counts)

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
