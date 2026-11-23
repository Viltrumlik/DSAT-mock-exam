"""lc-up's payments from before the ledger opened, copied into ``PastPayment`` (owner, 2026-11-23: "1-dekabrdan
o'zimizni sistemada ishlaymiz, api orqali barcha ma'lumotlarni ovolishingiz kerak").

The ledger opened on 4 Nov from lc-up's balances, so every payment up to ``BillingState.opening_max_payment_id`` is
inside an opening row and the ledger holds none of them; after that id it copies each one itself. Once lc-up is gone
the money pages read the ledger, so without this copy everything paid from January to 4 Nov would vanish from them.

The source is the archive (``lcup.archive``), the fullest copy of lc-up's payments: it reads every window back to
``LCUP_ARCHIVE_SINCE`` and never forgets one. A copy is history only — never counted toward a balance — and may be run
again: a payment lc-up changed is updated and one it deleted is dropped, so the last run before lc-up goes off is
the one that stays.
"""

from __future__ import annotations

from collections import Counter

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from lcup.models import GroupLinkStatus, LcupGroupLink, LcupStudentLink
from lcup.models_archive import ArchiveEntity, LcupArchiveRecord

from .models import Account, BillingRun, BillingState, EntryKind, PastPayment

#: The fields a copy is compared on: a row whose values all match is left as it is.
FIELDS = (
    "lcup_student_id", "account_id", "user_id", "name", "kind", "amount", "day", "month", "method",
    "group_name", "classroom_id", "note",
)
_LINKED = ("auto", "confirmed", "created")


class NotOpen(Exception):
    """The ledger has not opened, so there is no line between lc-up's past and the ledger's own rows."""


def _int(value) -> int | None:
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return None


def _method(value) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or "")[:60]
    return str(value or "")[:60]


def _names() -> dict[int, str]:
    """lc-up's own name for each student it ever listed, for a payer the platform never knew."""
    rows = LcupArchiveRecord.objects.filter(entity=ArchiveEntity.STUDENT).values_list("lcup_id", "payload")
    return {int(lcup_id): str((payload or {}).get("name") or "").strip() for lcup_id, payload in rows.iterator()}


def _groups() -> dict[int, tuple[str, int | None]]:
    """lc-up group id → (the name to show, our class). A paired group shows our class's own name."""
    out = {}
    for lcup_id, payload in LcupArchiveRecord.objects.filter(entity=ArchiveEntity.GROUP).values_list("lcup_id", "payload"):
        out[int(lcup_id)] = (str((payload or {}).get("name") or "").strip(), None)
    for link in LcupGroupLink.objects.select_related("classroom"):
        paired = link.status == GroupLinkStatus.CONFIRMED and link.classroom_id
        name = link.classroom.name if paired else (link.name or out.get(link.lcup_group_id, ("", None))[0])
        out[link.lcup_group_id] = (name, link.classroom_id if paired else None)
    return out


def wanted_rows(cutoff: int) -> tuple[dict[int, dict], Counter]:
    """lcup payment id → the row a copy should hold, for every live archived payment up to ``cutoff``."""
    counts = Counter()
    accounts = {a.lcup_student_id: a for a in Account.objects.filter(lcup_student_id__isnull=False)}
    links = {
        link.lcup_student_id: link
        for link in LcupStudentLink.objects.only("lcup_student_id", "name", "user", "status")
    }
    names, groups = _names(), _groups()
    out = {}
    records = LcupArchiveRecord.objects.filter(entity=ArchiveEntity.PAYMENT, gone_at__isnull=True)
    for lcup_id, payload, day in records.values_list("lcup_id", "payload", "day").iterator():
        payment_id = _int(lcup_id)
        if payment_id is None or payment_id > cutoff:
            continue  # after the opening: the ledger copied it itself
        amount, student_id = _int(payload.get("amount")), _int(payload.get("student_id"))
        if not amount or student_id is None or day is None:
            counts["skipped_empty"] += 1  # lc-up keeps a few zero rows; they moved no money
            continue
        account, link = accounts.get(student_id), links.get(student_id)
        user_id = (account.user_id if account else None) or (
            link.user_id if link and link.status in _LINKED else None
        )
        group_name, classroom_id = groups.get(_int(payload.get("group_id")) or 0, ("", None))
        out[payment_id] = {
            "lcup_student_id": student_id,
            "account_id": account.pk if account else None,
            "user_id": user_id,
            "name": ((link.name if link else "") or names.get(student_id) or (account.name if account else ""))[:200].strip(),
            "kind": EntryKind.REFUND if payload.get("type") == "refund" else EntryKind.PAYMENT,
            "amount": amount,
            "day": day,
            "month": str(payload.get("month") or day.strftime("%Y-%m"))[:7],
            "method": _method(payload.get("method")),
            "group_name": group_name[:200],
            "classroom_id": classroom_id,
            "note": str(payload.get("note") or "")[:300],
        }
    return out, counts


def copy_past_payments(now=None, *, apply: bool) -> dict:
    """Bring ``PastPayment`` in line with the archive. Without ``apply`` it does all of it and rolls it back, so the
    counts are exactly what a real run would write."""
    now = now or timezone.now()
    state = BillingState.get()
    if state.opened_at is None:
        raise NotOpen("The ledger has not opened yet, so nothing is lc-up's past.")
    with transaction.atomic():
        wanted, counts = wanted_rows(state.opening_max_payment_id)
        held = {p.lcup_payment_id: p for p in PastPayment.objects.all()}
        fresh, changed = [], []
        for payment_id, values in wanted.items():
            row = held.get(payment_id)
            if row is None:
                fresh.append(PastPayment(lcup_payment_id=payment_id, copied_at=now, **values))
                continue
            if all(getattr(row, name) == values[name] for name in FIELDS):
                continue
            for name, value in values.items():
                setattr(row, name, value)
            row.copied_at = now
            changed.append(row)
        PastPayment.objects.bulk_create(fresh, batch_size=500)
        PastPayment.objects.bulk_update(changed, [*FIELDS, "copied_at"], batch_size=500)
        gone = [row.pk for payment_id, row in held.items() if payment_id not in wanted]
        PastPayment.objects.filter(pk__in=gone).delete()
        totals = dict(PastPayment.objects.values_list("kind").annotate(total=Sum("amount")))
        counts.update({
            "new": len(fresh),
            "changed": len(changed),
            "removed": len(gone),
            "held": PastPayment.objects.count(),
            "paid": totals.get(EntryKind.PAYMENT, 0),
            "refunded": totals.get(EntryKind.REFUND, 0),
            "without_account": PastPayment.objects.filter(account__isnull=True).count(),
            "without_user": PastPayment.objects.filter(user__isnull=True).count(),
        })
        if not apply:
            transaction.set_rollback(True)
    report = dict(counts, applied=apply, up_to_payment=state.opening_max_payment_id)
    BillingRun.objects.create(kind=BillingRun.Kind.HISTORY, started_at=now, finished_at=timezone.now(), counts=report)
    return report
