import json
from collections import Counter

from django.core.management.base import BaseCommand

from lcup.profiles import mirrored_links, plan


def _mask(value: str) -> str:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return f"••{digits[-2:]}" if digits else "-"


class Command(BaseCommand):
    help = (
        "What the lc-up profile sync would change if it ran now, switched on (show this before "
        "LCUP_PROFILE_SYNC_ENABLED): names, phones and logins, and the phones another account holds. "
        "Changes nothing; phones are masked."
    )

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20, help="Examples of each kind to print.")

    def handle(self, *args, **options):
        counts, names, phones, taken = Counter(), [], [], []
        limit = options["limit"]
        for link in mirrored_links():
            counts["linked"] += 1
            change = plan(link)
            if change.phone_taken_by:
                counts["phone_taken"] += 1
                if len(taken) < limit:
                    taken.append({"user": link.user_id, "lcup_phone": _mask(link.phone), "held_by": change.phone_taken_by})
            if not change.fields:
                continue
            counts["accounts_to_update"] += 1
            for name in change.fields:
                counts[name] += 1
            if ("first_name" in change.fields or "last_name" in change.fields) and len(names) < limit:
                u = link.user
                names.append({"user": u.pk, "ours": f"{u.first_name} | {u.last_name}", "lcup": link.name.strip()})
            if "phone_number" in change.fields and len(phones) < limit:
                old, new = change.fields["phone_number"]
                phones.append({"user": link.user_id, "ours": _mask(old), "lcup": _mask(new), "login_follows": "username" in change.fields})
        self.stdout.write(json.dumps(
            {"counts": dict(counts), "names": names, "phones": phones, "phone_taken": taken},
            ensure_ascii=False, indent=2,
        ))
