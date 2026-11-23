"""lc-up's payments from before the ledger opened stay ours (owner, 2026-11-23: "1-dekabrdan o'zimizni sistemada
ishlaymiz, api orqali barcha ma'lumotlarni ovolishingiz kerak")."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from billing import ledger
from billing.history import NotOpen, copy_past_payments
from billing.models import Account, BillingRun, BillingState, EntryKind, PastPayment
from billing.tests_seat_class import make_room
from lcup import finance
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupStudentLink
from lcup.models_archive import ArchiveEntity, LcupArchiveRecord
from users.people_parts import history_part

User = get_user_model()
OURS = override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False, BILLING_MODE="lesson")
CUTOFF = 1000


def archived(entity, lcup_id, payload, day=None, gone=False):
    return LcupArchiveRecord.objects.create(
        entity=entity, lcup_id=str(lcup_id), payload=dict(payload, id=lcup_id), payload_hash="x", day=day,
        gone_at=timezone.now() if gone else None,
    )


def paid(lcup_id, student_id, amount, day, kind="payment", method="Naqd pul", group_id=10, gone=False):
    payload = {
        "type": kind, "amount": amount, "date": day.isoformat(), "month": day.strftime("%Y-%m"),
        "method": {"id": 1, "name": method}, "group_id": group_id, "student_id": student_id, "note": None,
    }
    return archived(ArchiveEntity.PAYMENT, lcup_id, payload, day=day, gone=gone)


class Fixture(TestCase):
    def setUp(self):
        BillingState.objects.update_or_create(pk=1, defaults={"opened_at": timezone.now(), "opening_max_payment_id": CUTOFF})
        self.user = User.objects.create_user(None, password=None, username="ali", role="student", first_name="Ali")
        self.account = Account.objects.create(name="Ali Valiyev", user=self.user, lcup_student_id=7)
        ledger.post(self.account, EntryKind.OPENING, -100_000, date(2026, 11, 4), "opening:7")
        LcupStudentLink.objects.create(lcup_student_id=7, name="Ali Valiyev", user=self.user, status="confirmed")
        self.room = make_room("Junior G1")
        LcupGroupLink.objects.create(
            lcup_group_id=10, name="Junior G1 | Math | T", classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        archived(ArchiveEntity.STUDENT, 8, {"name": "Old Student"})
        archived(ArchiveEntity.GROUP, 11, {"name": "Junior G0 | Math | T"})
        paid(1, 7, 500_000, date(2026, 3, 2))
        paid(2, 7, -92_000, date(2026, 3, 26), kind="refund", method="Plastik karta")
        paid(3, 8, 300_000, date(2026, 3, 5), group_id=11)  # a former student, never on the platform
        paid(4, 7, 0, date(2026, 3, 6))  # lc-up keeps zero rows; they moved nothing
        paid(5, 7, 1, date(2026, 3, 7), gone=True)  # deleted in lc-up
        paid(CUTOFF + 1, 7, 200_000, date(2026, 11, 10))  # after the opening: the ledger's own


class CopyTests(Fixture):
    def test_a_dry_run_keeps_nothing_and_says_what_it_would_write(self):
        report = copy_past_payments(apply=False)
        self.assertEqual((report["new"], report["skipped_empty"], report["applied"]), (3, 1, False))
        self.assertFalse(PastPayment.objects.exists())
        self.assertTrue(BillingRun.objects.filter(kind=BillingRun.Kind.HISTORY).exists())

    def test_it_copies_only_the_payments_inside_the_opening(self):
        report = copy_past_payments(apply=True)
        rows = {p.lcup_payment_id: p for p in PastPayment.objects.all()}
        self.assertEqual(sorted(rows), [1, 2, 3])
        self.assertEqual((report["paid"], report["refunded"], report["without_user"]), (800_000, -92_000, 1))
        mine = rows[1]
        self.assertEqual(
            (mine.account, mine.user, mine.kind, mine.method, mine.group_name, mine.classroom, mine.month),
            (self.account, self.user, EntryKind.PAYMENT, "Naqd pul", "Junior G1", self.room, "2026-03"),
        )
        self.assertEqual((rows[2].kind, rows[2].amount, rows[2].method), (EntryKind.REFUND, -92_000, "Plastik karta"))
        former = rows[3]
        self.assertEqual((former.name, former.account, former.user, former.group_name, former.classroom), ("Old Student", None, None, "Junior G0 | Math | T", None))

    def test_it_never_moves_a_balance(self):
        copy_past_payments(apply=True)
        self.assertEqual(ledger.balance(self.account), -100_000)

    def test_a_second_run_changes_nothing_and_follows_lc_ups_later_edits(self):
        copy_past_payments(apply=True)
        self.assertEqual((copy_past_payments(apply=True)["new"], copy_past_payments(apply=True)["changed"]), (0, 0))
        record = LcupArchiveRecord.objects.get(entity=ArchiveEntity.PAYMENT, lcup_id="1")
        record.payload = dict(record.payload, amount=450_000)
        record.save()
        LcupArchiveRecord.objects.filter(entity=ArchiveEntity.PAYMENT, lcup_id="3").update(gone_at=timezone.now())
        report = copy_past_payments(apply=True)
        self.assertEqual((report["changed"], report["removed"]), (1, 1))
        self.assertEqual(sorted(PastPayment.objects.values_list("lcup_payment_id", "amount")), [(1, 450_000), (2, -92_000)])

    def test_nothing_is_past_before_the_ledger_opens(self):
        BillingState.objects.update(opened_at=None)
        with self.assertRaises(NotOpen):
            copy_past_payments(apply=True)
        with self.assertRaises(CommandError):
            call_command("billing_copy_history")


@OURS
class ReadsTests(Fixture):
    def setUp(self):
        super().setUp()
        copy_past_payments(apply=True)
        ledger.post(self.account, EntryKind.PAYMENT, 200_000, date(2026, 11, 10), "lcup-payment:1001", method="Naqd pul")

    def test_the_students_page_lists_lc_ups_past_payments_after_the_ledgers(self):
        rows = finance.student_finance(self.user)["payments"]
        self.assertEqual([(r["date"], r["amount"]) for r in rows], [("2026-11-10", 200_000), ("2026-03-26", -92_000), ("2026-03-02", 500_000)])
        self.assertEqual(rows[2]["id"], 1)  # lc-up's id, as before the cutover

    def test_a_past_month_still_has_its_payments_and_totals(self):
        self.assertEqual([(r["student"], r["amount"]) for r in finance.payments_in("2026-03")],
                         [("Ali Valiyev", 500_000), ("Old Student", 300_000), ("Ali Valiyev", -92_000)])
        s = finance.summary("2026-03")
        self.assertEqual((s["paid"], s["refunded"], s["by_method"]), (800_000, -92_000, {"Naqd pul": 800_000}))
        self.assertEqual({row["group"]: row["income"] for row in s["by_group"]}, {"Junior G1": 408_000})

    def test_a_debtors_last_payment_may_be_from_before_the_ledger(self):
        other = Account.objects.create(name="Vali", lcup_student_id=9)
        ledger.post(other, EntryKind.OPENING, -50_000, date(2026, 11, 4), "opening:9")
        paid(6, 9, 100_000, date(2026, 2, 1))
        copy_past_payments(apply=True)
        last = {row["name"]: row["last_payment_on"] for row in finance.debtors()}
        self.assertEqual(last["Vali"], "2026-02-01")

    def test_the_persons_history_shows_them_by_lc_up(self):
        items = [(i["title"], i["by"]) for i in history_part(self.user)["items"] if i["kind"] == "payment"]
        self.assertEqual(items, [("Payment 200,000 UZS (Naqd pul)", ""), ("Refund 92,000 UZS (Plastik karta)", "lc-up"),
                                 ("Payment 500,000 UZS (Naqd pul)", "lc-up")])
