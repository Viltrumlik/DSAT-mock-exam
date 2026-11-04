from datetime import date, datetime, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from billing import ledger, shadow
from billing.models import Account, BillingRun, BillingState, Entry, EntryKind, Seat, SeatState
from lcup.models import LcupGroupLink, LcupMembership, LcupPayment, LcupStudentLink, LcupSyncRun
from lcup.models_archive import ArchiveEntity, LcupArchiveRecord


def at(year, month, day, hour=10):
    return timezone.make_aware(datetime(year, month, day, hour, 0))


NOW = at(2026, 11, 4)


class Fixture:
    """November 2026 on Mon/Wed/Fri: 2 4 6 9 11 13 16 18 20 23 25 27 30, 13 lessons."""

    def healthy_sync(self, now=NOW):
        return LcupSyncRun.objects.create(started_at=now - timedelta(minutes=5), finished_at=now - timedelta(minutes=4), ok=True)

    def group(self, lcup_id=10, name="Junior G1", cost=500_000, days=(1, 3, 5), deleted_at=None):
        return LcupGroupLink.objects.create(
            lcup_group_id=lcup_id, name=name, snapshot={"cost": cost, "days": list(days)}, deleted_in_lcup_at=deleted_at
        )

    def student(self, lcup_id=1, balance=0, name="A Student", phone="998901112233", deleted=False):
        return LcupStudentLink.objects.create(
            lcup_student_id=lcup_id, name=name, phone=phone, balance=balance, balance_seen_at=NOW, deleted_in_lcup=deleted
        )

    def member(self, group, student, status="active", start=date(2026, 9, 1), left_at=None):
        return LcupMembership.objects.create(group=group, student=student, lcup_status=status, start_date=start, left_at=left_at)

    def payment(self, lcup_id, student_id, amount, kind="payment", day=date(2026, 11, 4), method="Naqd pul"):
        return LcupPayment.objects.create(
            lcup_payment_id=lcup_id, lcup_student_id=student_id, kind=kind, amount=amount, paid_on=day, method=method, synced_at=NOW
        )

    def archived_student(self, lcup_id, balance, name="Old Student", phone="998900000000"):
        payload = {"id": lcup_id, "name": name, "phone": phone, "balance": balance}
        return LcupArchiveRecord.objects.create(entity=ArchiveEntity.STUDENT, lcup_id=str(lcup_id), payload=payload, payload_hash="x")

    def account(self, lcup_id=1):
        return Account.objects.get(lcup_student_id=lcup_id)


class OpenTests(Fixture, TestCase):
    def setUp(self):
        self.healthy_sync()

    def test_a_dry_run_writes_nothing_and_reports_what_it_would(self):
        self.member(self.group(), self.student(balance=-500_000))
        report = shadow.open_ledger(NOW, apply=False)
        self.assertEqual((report["accounts"], report["owed_count"], report["owed_total"]), (1, 1, -500_000))
        self.assertEqual(Account.objects.count(), 0)
        self.assertIsNone(BillingState.get().opened_at)

    def test_the_opening_row_is_lcups_balance(self):
        self.member(self.group(), self.student(balance=-500_000))
        shadow.open_ledger(NOW, apply=True)
        row = self.account().entries.get()
        self.assertEqual((row.kind, row.amount, row.day), (EntryKind.OPENING, -500_000, date(2026, 11, 4)))

    def test_a_live_member_with_no_balance_opens_without_a_row(self):
        self.member(self.group(), self.student(balance=0))
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(self.account().entries.count(), 0)

    def test_a_former_student_with_a_balance_opens(self):
        self.student(lcup_id=2, balance=-120_000)
        report = shadow.open_ledger(NOW, apply=True)
        self.assertEqual(ledger.balance(self.account(2)), -120_000)
        self.assertEqual(report["former"], 1)

    def test_a_former_student_in_credit_opens(self):
        self.student(lcup_id=2, balance=80_000)
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(ledger.balance(self.account(2)), 80_000)

    def test_a_former_student_at_zero_does_not_open(self):
        self.student(lcup_id=2, balance=0)
        shadow.open_ledger(NOW, apply=True)
        self.assertFalse(Account.objects.exists())

    def test_someone_only_the_archive_knows_opens_from_the_archive(self):
        self.archived_student(5, -75_000, name="Old Student")
        shadow.open_ledger(NOW, apply=True)
        account = self.account(5)
        self.assertEqual((account.name, ledger.balance(account)), ("Old Student", -75_000))

    def test_lc_up_dropping_a_student_makes_the_archive_the_fresher_balance(self):
        self.student(lcup_id=6, balance=-10_000, deleted=True)
        self.archived_student(6, -90_000)
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(ledger.balance(self.account(6)), -90_000)

    def test_an_active_seat_gets_a_span_but_no_charge_for_this_month(self):
        self.member(self.group(), self.student(balance=-500_000))
        shadow.open_ledger(NOW, apply=True)
        seat = Seat.objects.get()
        self.assertEqual((seat.state, seat.price, seat.days), (SeatState.ACTIVE, 500_000, [1, 3, 5]))
        self.assertEqual(seat.spans.get().opening_month, "2026-11")
        self.assertFalse(Entry.objects.filter(kind=EntryKind.CHARGE).exists())

    def test_trial_and_frozen_seats_open_without_a_span(self):
        group = self.group()
        self.member(group, self.student(lcup_id=1), status="trial")
        self.member(group, self.student(lcup_id=2), status="frozen")
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(Seat.objects.count(), 2)
        self.assertFalse(Seat.objects.filter(spans__isnull=False).exists())

    def test_a_seat_in_a_deleted_group_does_not_open(self):
        self.member(self.group(deleted_at=NOW), self.student(balance=-1000))
        shadow.open_ledger(NOW, apply=True)
        self.assertFalse(Seat.objects.exists())

    def test_it_opens_once(self):
        shadow.open_ledger(NOW, apply=True)
        with self.assertRaises(shadow.NotReady):
            shadow.open_ledger(NOW, apply=True)

    def test_a_failed_sync_refuses(self):
        LcupSyncRun.objects.all().update(ok=False)
        with self.assertRaises(shadow.NotReady):
            shadow.open_ledger(NOW, apply=False)

    def test_an_old_sync_refuses(self):
        LcupSyncRun.objects.all().update(finished_at=NOW - timedelta(hours=3))
        with self.assertRaises(shadow.NotReady):
            shadow.open_ledger(NOW, apply=False)

    def test_payments_before_the_opening_are_inside_the_balance(self):
        self.student(balance=-100_000)
        self.payment(77, 1, 400_000)
        shadow.open_ledger(NOW, apply=True)
        self.assertEqual(BillingState.get().opening_max_payment_id, 77)
        shadow.mirror_payments(shadow.Result())
        self.assertEqual(ledger.balance(self.account()), -100_000)


class Opened(Fixture):
    def setUp(self):
        self.healthy_sync()
        self.grp = self.group()
        self.link = self.student(balance=-500_000)
        self.seat_row = self.member(self.grp, self.link)
        shadow.open_ledger(NOW, apply=True)

    def seat(self):
        return Seat.objects.get(account=self.account(), lcup_group_id=10)


class MirrorPaymentsTests(Opened, TestCase):
    def test_a_new_payment_is_copied(self):
        self.payment(5, 1, 500_000)
        shadow.mirror_payments(shadow.Result())
        row = self.account().entries.get(kind=EntryKind.PAYMENT)
        self.assertEqual((row.amount, row.method, row.day), (500_000, "Naqd pul", date(2026, 11, 4)))
        self.assertEqual(ledger.balance(self.account()), 0)

    def test_a_refund_counts_as_lc_up_signs_it(self):
        self.payment(5, 1, -100_000, kind="refund")
        shadow.mirror_payments(shadow.Result())
        self.assertEqual(self.account().entries.get(kind=EntryKind.REFUND).amount, -100_000)

    def test_copying_twice_writes_one_row(self):
        self.payment(5, 1, 500_000)
        shadow.mirror_payments(shadow.Result())
        shadow.mirror_payments(shadow.Result())
        self.assertEqual(self.account().entries.filter(kind=EntryKind.PAYMENT).count(), 1)

    def test_a_payment_lc_up_changed_voids_the_old_row_and_writes_a_new_one(self):
        payment = self.payment(5, 1, 500_000)
        shadow.mirror_payments(shadow.Result())
        LcupPayment.objects.filter(pk=payment.pk).update(amount=450_000)
        shadow.mirror_payments(shadow.Result())
        rows = self.account().entries.filter(kind=EntryKind.PAYMENT)
        self.assertEqual(rows.count(), 2)
        self.assertEqual(rows.get(voided_at__isnull=True).amount, 450_000)

    def test_a_payment_lc_up_deleted_is_voided(self):
        payment = self.payment(5, 1, 500_000)
        shadow.mirror_payments(shadow.Result())
        payment.delete()
        shadow.mirror_payments(shadow.Result())
        self.assertIsNotNone(self.account().entries.get(kind=EntryKind.PAYMENT).voided_at)
        self.assertEqual(ledger.balance(self.account()), -500_000)

    def test_a_payment_from_someone_with_no_account_opens_one(self):
        self.student(lcup_id=9, name="Back Again")
        self.payment(5, 9, 100_000)
        shadow.mirror_payments(shadow.Result())
        self.assertEqual((self.account(9).name, ledger.balance(self.account(9))), ("Back Again", 100_000))


class WatchTests(Opened, TestCase):
    def test_nothing_changed_writes_nothing(self):
        before = Entry.objects.count()
        shadow.watch(at(2026, 11, 5))
        self.assertEqual(Entry.objects.count(), before)

    def test_a_new_active_member_pays_from_lc_ups_start_date(self):
        self.member(self.grp, self.student(lcup_id=2, name="New One"), start=date(2026, 11, 16))
        shadow.watch(at(2026, 11, 16))
        self.assertEqual(ledger.balance(self.account(2)), -269_000)

    def test_a_trial_member_pays_nothing(self):
        self.member(self.grp, self.student(lcup_id=2), status="trial", start=date(2026, 11, 16))
        shadow.watch(at(2026, 11, 16))
        self.assertEqual(ledger.balance(self.account(2)), 0)

    def test_leaving_a_trial_pays_nothing(self):
        row = self.member(self.grp, self.student(lcup_id=2), status="trial", start=date(2026, 11, 16))
        shadow.watch(at(2026, 11, 16))
        LcupMembership.objects.filter(pk=row.pk).update(left_at=at(2026, 11, 18))
        shadow.watch(at(2026, 11, 18))
        self.assertEqual(ledger.balance(self.account(2)), 0)

    def test_after_a_trial_lc_up_moves_the_start_date_and_payment_starts_there(self):
        row = self.member(self.grp, self.student(lcup_id=2), status="trial", start=date(2026, 11, 13))
        shadow.watch(at(2026, 11, 13))
        LcupMembership.objects.filter(pk=row.pk).update(lcup_status="active", start_date=date(2026, 11, 16))
        shadow.watch(at(2026, 11, 18))
        self.assertEqual(ledger.balance(self.account(2)), -269_000)

    def test_after_a_trial_with_the_same_start_date_payment_starts_the_day_it_is_seen(self):
        row = self.member(self.grp, self.student(lcup_id=2), status="trial", start=date(2026, 11, 13))
        shadow.watch(at(2026, 11, 13))
        LcupMembership.objects.filter(pk=row.pk).update(lcup_status="active")
        shadow.watch(at(2026, 11, 18))
        self.assertEqual(ledger.balance(self.account(2)), -231_000)

    def test_leaving_gives_back_the_lessons_after_lc_ups_date(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 9))
        shadow.watch(at(2026, 11, 10))
        self.assertEqual(ledger.balance(self.account()), -154_000)
        self.assertEqual(self.seat().state, SeatState.LEFT)

    def test_a_deleted_group_is_leaving_on_that_day(self):
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(deleted_in_lcup_at=at(2026, 11, 9))
        shadow.watch(at(2026, 11, 10))
        self.assertEqual(ledger.balance(self.account()), -154_000)

    def test_a_freeze_gives_back_the_lessons_after_the_day_it_is_seen(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(lcup_status="frozen")
        shadow.watch(at(2026, 11, 9))
        self.assertEqual(ledger.balance(self.account()), -154_000)
        self.assertEqual(self.seat().state, SeatState.FROZEN)

    def test_a_frozen_seat_pays_nothing_next_month(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(lcup_status="frozen")
        shadow.watch(at(2026, 11, 9))
        ledger.bill_open_spans(today=date(2026, 12, 1))
        self.assertEqual(ledger.balance(self.account()), -154_000)

    def test_coming_back_pays_the_lessons_left(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(lcup_status="frozen")
        shadow.watch(at(2026, 11, 9))
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(lcup_status="active")
        shadow.watch(at(2026, 11, 16))
        self.assertEqual(ledger.balance(self.account()), -154_000 - 269_000)

    def test_a_corrected_leave_date_voids_and_rewrites(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 9))
        shadow.watch(at(2026, 11, 10))
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 6))
        shadow.watch(at(2026, 11, 11))
        self.assertEqual(ledger.balance(self.account()), -115_000)
        self.assertEqual(self.account().entries.filter(voided_at__isnull=False).count(), 1)

    def test_a_corrected_start_date_voids_and_rewrites(self):
        row = self.member(self.grp, self.student(lcup_id=2), start=date(2026, 11, 16))
        shadow.watch(at(2026, 11, 16))
        LcupMembership.objects.filter(pk=row.pk).update(start_date=date(2026, 11, 18))
        shadow.watch(at(2026, 11, 18))
        self.assertEqual(ledger.balance(self.account(2)), -231_000)

    def test_watching_twice_writes_nothing_twice(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 9))
        shadow.watch(at(2026, 11, 10))
        shadow.watch(at(2026, 11, 10))
        self.assertEqual(self.account().entries.filter(kind=EntryKind.CREDIT).count(), 1)

    def test_a_new_price_reaches_the_seat_and_the_next_charge(self):
        LcupGroupLink.objects.filter(pk=self.grp.pk).update(snapshot={"cost": 600_000, "days": [1, 3, 5]})
        shadow.watch(at(2026, 11, 20))
        ledger.bill_open_spans(today=date(2026, 12, 1))
        self.assertEqual(ledger.balance(self.account()), -1_100_000)

    def test_a_seat_that_left_before_the_opening_is_not_followed(self):
        self.member(self.grp, self.student(lcup_id=2), left_at=at(2026, 10, 1))
        shadow.watch(at(2026, 11, 5))
        self.assertFalse(Account.objects.filter(lcup_student_id=2).exists())

    @mock.patch("billing.shadow.MAX_ENDS_PER_TICK", 1)
    def test_too_many_ends_at_once_waits_for_a_person(self):
        other = self.member(self.grp, self.student(lcup_id=2, balance=-500_000))
        shadow.watch(at(2026, 11, 5))
        LcupMembership.objects.filter(pk__in=[self.seat_row.pk, other.pk]).update(left_at=at(2026, 11, 9))
        result = shadow.watch(at(2026, 11, 10))
        self.assertEqual(result.counts.get("ended", 0), 0)
        self.assertIn("2 seats ended at once", result.alerts[0])
        self.assertEqual(self.seat().state, SeatState.ACTIVE)

    @mock.patch("billing.shadow.MAX_ENDS_PER_TICK", 1)
    def test_a_person_can_let_them_through(self):
        other = self.member(self.grp, self.student(lcup_id=2, balance=-500_000))
        shadow.watch(at(2026, 11, 5))
        LcupMembership.objects.filter(pk__in=[self.seat_row.pk, other.pk]).update(left_at=at(2026, 11, 9))
        result = shadow.watch(at(2026, 11, 10), allow_mass=True)
        self.assertEqual(result.counts["ended"], 2)

    def test_one_failure_stops_only_that_seat(self):
        other = self.member(self.grp, self.student(lcup_id=2, balance=-500_000))
        shadow.watch(at(2026, 11, 5))
        LcupMembership.objects.filter(pk__in=[self.seat_row.pk, other.pk]).update(left_at=at(2026, 11, 9))
        real, calls = ledger.end_span, []

        def fail_once(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom")
            return real(*args, **kwargs)

        with mock.patch("billing.ledger.end_span", fail_once):
            result = shadow.watch(at(2026, 11, 10))
        self.assertEqual(result.counts["ended"], 1)
        self.assertEqual(len(result.errors), 1)
        states = sorted(Seat.objects.values_list("state", flat=True))
        self.assertEqual(states, [SeatState.ACTIVE, SeatState.LEFT])


class TickTests(Opened, TestCase):
    def test_off_by_default(self):
        self.assertEqual(shadow.tick(at(2026, 11, 5)), {"skipped": "disabled"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_before_the_opening_it_waits(self):
        BillingState.objects.update(opened_at=None)
        self.assertEqual(shadow.tick(NOW), {"skipped": "not opened"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_a_failed_sync_is_not_believed(self):
        LcupSyncRun.objects.all().update(ok=False)
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 9))
        self.assertEqual(shadow.tick(NOW), {"skipped": "sync not healthy"})
        self.assertEqual(self.seat().state, SeatState.ACTIVE)

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_a_tick_copies_payments_follows_seats_and_bills_the_month(self):
        self.healthy_sync(at(2026, 12, 1))
        self.payment(5, 1, 500_000, day=date(2026, 12, 1))
        shadow.tick(at(2026, 12, 1))
        self.assertEqual(ledger.balance(self.account()), -500_000)
        self.assertIsNotNone(BillingState.get().last_tick_at)
        self.assertEqual(BillingRun.objects.filter(kind="tick").count(), 1)

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_an_account_follows_lc_ups_link_to_another_user(self):
        user = get_user_model().objects.create_user(email="s@example.com", username="s", password="x")
        LcupStudentLink.objects.filter(pk=self.link.pk).update(user=user, name="Renamed", phone="998909999999")
        self.healthy_sync(at(2026, 11, 5))
        shadow.tick(at(2026, 11, 5))
        account = self.account()
        self.assertEqual((account.user_id, account.name, account.phone), (user.pk, "Renamed", "998909999999"))

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_a_quiet_tick_keeps_no_row(self):
        self.healthy_sync(at(2026, 11, 5))
        shadow.tick(at(2026, 11, 5))
        self.assertEqual(BillingRun.objects.filter(kind="tick").count(), 0)


class CompareTests(Opened, TestCase):
    def test_right_after_opening_everyone_matches(self):
        run = shadow.compare(NOW)
        self.assertEqual(run.counts, {"matched": 1, "small": 0, "big": 0, "unknown": 0, "missing": 0})
        self.assertEqual(run.rows, [])
        self.assertEqual(run.day, date(2026, 11, 4))

    def test_a_thousand_is_a_small_difference(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=-499_000)
        run = shadow.compare(NOW)
        self.assertEqual(run.counts["small"], 1)
        self.assertEqual(run.rows[0]["diff"], -1_000)

    def test_more_is_a_big_difference_with_both_balances(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=-400_000)
        run = shadow.compare(NOW)
        self.assertEqual(run.counts["big"], 1)
        row = run.rows[0]
        self.assertEqual((row["name"], row["ours"], row["lcup"], row["diff"]), ("A Student", -500_000, -400_000, -100_000))
        self.assertEqual(row["account_id"], self.account().pk)

    def test_the_biggest_difference_comes_first(self):
        self.member(self.grp, self.student(lcup_id=2, balance=-500_000))
        shadow.watch(at(2026, 11, 5))
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=-400_000)
        LcupStudentLink.objects.filter(lcup_student_id=2).update(balance=-100_000)
        self.healthy_sync(at(2026, 11, 5))
        run = shadow.compare(at(2026, 11, 5))
        self.assertGreater(abs(run.rows[0]["diff"]), abs(run.rows[1]["diff"]))

    def test_an_unknown_lc_up_balance_is_not_called_a_match(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=None)
        run = shadow.compare(NOW)
        self.assertEqual((run.counts["matched"], run.counts["unknown"]), (0, 1))

    def test_someone_with_money_in_lc_up_and_no_account_here_is_listed(self):
        self.student(lcup_id=8, balance=-50_000, name="Not Here")
        run = shadow.compare(NOW)
        self.assertEqual(run.counts["missing"], 1)
        self.assertEqual((run.rows[0]["name"], run.rows[0]["account_id"]), ("Not Here", None))

    def test_a_failed_sync_compares_nothing(self):
        LcupSyncRun.objects.all().update(ok=False)
        run = shadow.compare(NOW)
        self.assertFalse(run.ok)
        self.assertEqual(run.counts, {})
        self.assertIn("sync", run.alerts[0])
