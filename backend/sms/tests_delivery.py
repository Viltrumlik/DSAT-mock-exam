from datetime import date, datetime, timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from sms import switchboard
from sms.delivery import check_statuses, deliver, mask_phone
from sms.eskiz import FAILED, NO_BALANCE_WORDS, REJECTED, UNCERTAIN
from sms.models import SmsMessage
from sms.testing import EskizAccount, FakeEskiz

DAY = date(2026, 11, 1)
NOW = timezone.make_aware(datetime(2026, 11, 1, 11, 30))


def send(fake, key="student:101"):
    return deliver(
        fake, kind=SmsMessage.KIND_DEBT_WARNING, run_on=DAY, dedupe_key=key,
        phone="998901234567", text="Bu Eskiz dan test", lcup_student_id=101,
    )


class DeliverTests(TestCase):
    def test_an_accepted_sms_is_recorded_as_sent(self):
        fake = FakeEskiz()
        msg = send(fake)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.request_id), (SmsMessage.STATUS_SENT, "req-1"))
        self.assertIsNotNone(msg.sent_at)
        self.assertEqual(fake.sent, [("998901234567", "Bu Eskiz dan test", f"m{msg.pk}")])

    def test_the_same_key_on_the_same_day_is_never_sent_twice(self):
        fake = FakeEskiz()
        send(fake)
        self.assertIsNone(send(fake))
        self.assertEqual(len(fake.sent), 1)

    def test_a_new_row_records_its_price_parts_and_template(self):
        msg = deliver(
            FakeEskiz(), kind=SmsMessage.KIND_TEST, run_on=DAY, dedupe_key="k", phone="998901234567",
            text="Salom", template_eskiz_id=64942,
        )
        msg.refresh_from_db()
        self.assertEqual((msg.unit_price, msg.parts, msg.template_eskiz_id), (switchboard.price_per_part(), 1, 64942))

    def test_a_reclaimed_failed_row_keeps_its_price(self):
        first = send(FakeEskiz(FAILED))
        SmsMessage.objects.filter(pk=first.pk).update(unit_price=150)
        again = send(FakeEskiz())
        again.refresh_from_db()
        self.assertEqual((again.pk, again.unit_price, again.attempts), (first.pk, 150, 2))

    def test_outcomes_map_to_statuses(self):
        for outcome, status in (
            (REJECTED, SmsMessage.STATUS_REJECTED),
            (FAILED, SmsMessage.STATUS_FAILED),
            (UNCERTAIN, SmsMessage.STATUS_UNCERTAIN),
        ):
            msg = send(FakeEskiz(outcome), key=f"student:{outcome}")
            msg.refresh_from_db()
            self.assertEqual(msg.status, status)
            self.assertIsNone(msg.sent_at)
            self.assertEqual(msg.error, "refused by the fake")


class CheckStatusesTests(TestCase):
    def sent(self, request_id, *, at=NOW - timedelta(hours=1)):
        return SmsMessage.objects.create(
            kind=SmsMessage.KIND_DEBT_WARNING, run_on=DAY, dedupe_key=f"student:{request_id}", phone="998901234567",
            text="x", status=SmsMessage.STATUS_SENT, request_id=request_id, sent_at=at,
        )

    def test_final_answers_are_recorded(self):
        delivered, expired, waiting = self.sent("a"), self.sent("b"), self.sent("c")
        fake = FakeEskiz(statuses={"a": "DELIVERED", "b": "EXPIRED", "c": "ACCEPTED"})
        check_statuses(fake, NOW)
        for msg in (delivered, expired, waiting):
            msg.refresh_from_db()
        self.assertEqual(delivered.status, SmsMessage.STATUS_DELIVERED)
        self.assertEqual(expired.status, SmsMessage.STATUS_UNDELIVERED)
        self.assertEqual((waiting.status, waiting.eskiz_status), (SmsMessage.STATUS_SENT, "ACCEPTED"))
        self.assertEqual(delivered.checked_at, NOW)

    def test_older_than_two_days_is_left_alone(self):
        old = self.sent("a", at=NOW - timedelta(hours=49))
        check_statuses(FakeEskiz(statuses={"a": "DELIVERED"}), NOW)
        old.refresh_from_db()
        self.assertEqual(old.status, SmsMessage.STATUS_SENT)

    def test_an_unanswered_check_changes_nothing(self):
        msg = self.sent("a")
        check_statuses(FakeEskiz(statuses={}), NOW)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.checked_at), (SmsMessage.STATUS_SENT, None))


class MaskTests(SimpleTestCase):
    def test_mask_phone(self):
        self.assertEqual(mask_phone("998901234567"), "99890***4567")


class RetryTests(TestCase):
    def test_an_sms_that_never_left_goes_again_on_the_next_run(self):
        send(FakeEskiz(FAILED))
        fake = FakeEskiz()
        msg = send(fake)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.attempts, msg.error), (SmsMessage.STATUS_SENT, 2, ""))
        self.assertEqual(len(fake.sent), 1)

    def test_one_that_may_have_left_never_goes_again(self):
        send(FakeEskiz(UNCERTAIN))
        fake = FakeEskiz()
        self.assertIsNone(send(fake))
        self.assertEqual(fake.sent, [])


class NoBalanceTests(TestCase):
    def test_a_refusal_for_no_balance_goes_again_after_a_top_up_and_only_once(self):
        account = EskizAccount()
        client = account.client()
        msg = send(client)
        msg.refresh_from_db()
        self.assertEqual(
            (msg.status, msg.error, msg.sent_at), (SmsMessage.STATUS_FAILED, "HTTP 400: Please, fill the balance", None)
        )
        account.top_up()
        again = send(client)
        again.refresh_from_db()
        self.assertEqual((again.pk, again.status, again.error), (msg.pk, SmsMessage.STATUS_SENT, ""))
        self.assertIsNone(send(client))
        self.assertEqual(account.taken, ["998901234567"])

    def test_a_try_refused_for_want_of_balance_is_not_counted_as_a_try(self):
        # No operator saw it, so it must not use up the one more try an operator's rejection earns.
        account = EskizAccount()
        client = account.client()
        send(client)
        send(client)
        self.assertEqual(SmsMessage.objects.get().attempts, 1)
        account.top_up()
        msg = send(client)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.attempts), (SmsMessage.STATUS_SENT, 1))

    def test_each_of_eskizs_words_for_no_balance_keeps_the_try_uncounted(self):
        for i, words in enumerate(NO_BALANCE_WORDS):
            with self.subTest(words=words):
                key = f"student:{i}"
                send(FakeEskiz(FAILED), key=key)
                SmsMessage.objects.filter(dedupe_key=key).update(error=f"HTTP 400: {words.upper()}")
                msg = send(FakeEskiz(), key=key)
                msg.refresh_from_db()
                self.assertEqual((msg.status, msg.attempts), (SmsMessage.STATUS_SENT, 1))

    def test_a_failed_try_that_only_mentions_the_balance_still_counts(self):
        send(FakeEskiz(FAILED))
        SmsMessage.objects.update(error="HTTP 400: Balance account is blocked")
        msg = send(FakeEskiz())
        msg.refresh_from_db()
        self.assertEqual(msg.attempts, 2)

    def test_any_other_refusal_stays_rejected_and_is_not_claimed_again(self):
        account = EskizAccount(refused={"998901234567": "perfectum: Not allowed"})
        client = account.client()
        msg = send(client)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.error), (SmsMessage.STATUS_REJECTED, "HTTP 400: perfectum: Not allowed"))
        account.top_up()
        self.assertIsNone(send(client))
        self.assertEqual(account.asked, 1)


class CampaignFieldsTests(TestCase):
    def test_the_campaign_and_who_sent_it_are_recorded(self):
        from sms.models import SmsCampaign
        from users.models import User

        admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        campaign = SmsCampaign.objects.create(
            template_eskiz_id=1, pattern="x", audience=SmsCampaign.AUDIENCE_DEBTORS, scheduled_at=NOW,
        )
        msg = deliver(
            FakeEskiz(), kind=SmsMessage.KIND_CAMPAIGN, run_on=DAY, dedupe_key=f"campaign:{campaign.pk}:student:1",
            phone="998901234567", text="x", campaign=campaign, created_by=admin,
        )
        msg.refresh_from_db()
        self.assertEqual((msg.campaign, msg.created_by), (campaign, admin))
