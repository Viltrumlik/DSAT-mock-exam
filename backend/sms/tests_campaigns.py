"""Manual sends from /ops/sms: who gets one (decided when it goes out), what it says, and never twice."""

from datetime import datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink, LinkStatus
from sms import campaigns
from sms import templates as T
from sms.campaigns import CampaignRefused
from sms.eskiz import ACCEPTED, FAILED, UNCERTAIN
from sms.models import EskizTemplate, SmsCampaign, SmsMessage
from sms.testing import FakeEskiz
from users.models import User

NOW = timezone.make_aware(datetime(2026, 10, 20, 15, 0))
ORIGINAL_64942 = (
    "MASTER SAT'dan yozyabmiz. (STUDENT), sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan "
    "administratsiyaga uchrang!"
)
MALIKA_64942 = (
    "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik "
    "bilan administratsiyaga uchrang!"
)


class Fixture(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin", first_name="Bo", last_name="Ss")
        EskizTemplate.objects.create(
            eskiz_id=64942, pattern=T.DEBT_WARNING.text, original=ORIGINAL_64942, status="service", synced_at=NOW,
        )
        EskizTemplate.objects.create(
            eskiz_id=70000, pattern="Hurmatli %w{1,4} %d so'm qarzingiz bor. %w{1,10}",
            original="Hurmatli (STUDENT) (SUM) so'm qarzingiz bor. (TEXT)", status="reklama", synced_at=NOW,
        )
        EskizTemplate.objects.create(eskiz_id=80000, pattern="Kutilmoqda %w", status="moderation", synced_at=NOW)
        self.room = Classroom.objects.create(
            name="Junior G21 | Math", subject=Classroom.SUBJECT_MATH, level="junior", lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )

    def learner(self, lcup_id, username, *, balance=-150000, phone="998901234567", name=None, room=None,
                link=True, **link_extra):
        user = User.objects.create_user(
            None, password=None, username=username, role="student", first_name=username.title(), last_name="Karimova",
        )
        if room is not None:
            ClassroomMembership.objects.create(classroom=room, user=user, role=ClassroomMembership.ROLE_STUDENT)
        if link:
            LcupStudentLink.objects.create(
                lcup_student_id=lcup_id, name=name or f"Karimova {username.title()}", user=user,
                status=LinkStatus.CONFIRMED, phone=phone, balance=None if balance is None else Decimal(balance),
                balance_seen_at=NOW, **link_extra,
            )
        return user

    def draft(self, **extra):
        data = {
            "template_id": 64942, "slot_roles": ["student"], "slot_texts": [""],
            "audience": "debtors", "audience_ids": [], "scheduled_at": None,
        }
        data.update(extra)
        return data

    def create(self, **extra):
        with self.captureOnCommitCallbacks(execute=False):
            return campaigns.create(self.draft(**extra), self.admin, now=NOW)


class ResolveTests(Fixture):
    def resolve(self, **extra):
        return campaigns.resolve(campaigns.clean(self.draft(**extra), now=NOW))

    def test_students_by_id(self):
        malika = self.learner(101, "malika")
        self.learner(102, "aziza", phone="998902222222")
        recipients, skipped = self.resolve(audience="student", audience_ids=[malika.pk])
        self.assertEqual([(r.user, r.phone, r.text) for r in recipients], [(malika, "998901234567", MALIKA_64942)])
        self.assertEqual(
            skipped, {"no_link": [], "no_phone": [], "stale_balance": [], "not_debtor": [], "bad_text": []},
        )

    def test_a_group_is_its_active_students(self):
        malika = self.learner(101, "malika", room=self.room)
        gone = self.learner(102, "gone", room=self.room, phone="998902222222")
        ClassroomMembership.objects.filter(user=gone).update(status=ClassroomMembership.STATUS_REMOVED)
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        ClassroomMembership.objects.create(classroom=self.room, user=teacher, role=ClassroomMembership.ROLE_TEACHER)
        recipients, _ = self.resolve(audience="group", audience_ids=[self.room.pk])
        self.assertEqual([r.user for r in recipients], [malika])

    def test_debtors_include_the_frozen(self):
        frozen = self.learner(101, "frozen")
        User.objects.filter(pk=frozen.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.learner(102, "paid", balance=0, phone="998902222222")
        self.learner(103, "left", deleted_in_lcup=True, phone="998903333333")
        LcupStudentLink.objects.create(lcup_student_id=104, name="No Account", phone="998904444444", balance=Decimal(-5))
        recipients, _ = self.resolve()
        self.assertEqual([r.link.lcup_student_id for r in recipients], [101])

    def test_who_is_skipped_and_why(self):
        nolink = self.learner(101, "nolink", link=False)
        nophone = self.learner(102, "nophone", phone="")
        paid = self.learner(103, "paid", balance=0, phone="998903333333")
        ok = self.learner(104, "ok", phone="998904444444")
        ids = [nolink.pk, nophone.pk, paid.pk, ok.pk]
        # #64942 names no debt: a student who paid still gets it.
        recipients, skipped = self.resolve(audience="student", audience_ids=ids)
        self.assertEqual([r.user for r in recipients], [paid, ok])
        self.assertEqual(skipped["no_link"], [{"user_id": nolink.pk, "name": "Nolink Karimova"}])
        self.assertEqual(skipped["no_phone"], [{"user_id": nophone.pk, "name": "Nophone Karimova"}])
        # With a debt slot, the one who paid is not a debtor.
        recipients, skipped = self.resolve(
            template_id=70000, slot_roles=["student", "debt", "text"], slot_texts=["", "", "Rahmat"],
            audience="student", audience_ids=ids,
        )
        self.assertEqual([r.user for r in recipients], [ok])
        self.assertEqual(skipped["not_debtor"], [{"user_id": paid.pk, "name": "Paid Karimova"}])

    def test_siblings_on_one_phone_with_the_same_text_get_one(self):
        self.learner(101, "malika", name="Karimova")
        self.learner(102, "aziza", name="Karimova")
        recipients, skipped = self.resolve()
        self.assertEqual(len(recipients), 1)
        self.assertEqual(len(skipped["same_phone"]), 1)

    def test_the_rendered_text_with_the_role_suffix(self):
        malika = self.learner(101, "malika")
        recipients, _ = self.resolve(audience="student", audience_ids=[malika.pk])
        self.assertEqual(recipients[0].text, MALIKA_64942)

    def test_debt_and_typed_text(self):
        malika = self.learner(101, "malika", balance="-150000.40")
        recipients, _ = self.resolve(
            template_id=70000, slot_roles=["student", "debt", "text"], slot_texts=["x", "y", "Iltimos to'lang"],
            audience="student", audience_ids=[malika.pk],
        )
        self.assertEqual(recipients[0].text, "Hurmatli Karimova Malika 150000 so'm qarzingiz bor. Iltimos to'lang")


class CleanTests(Fixture):
    def refused(self, **extra):
        with self.assertRaises(CampaignRefused) as caught:
            campaigns.clean(self.draft(**extra), now=NOW)
        return caught.exception.code

    def test_the_refusals(self):
        self.assertEqual(self.refused(template_id=80000), "template")  # not usable yet
        self.assertEqual(self.refused(template_id=1), "template")
        self.assertEqual(self.refused(slot_roles=[]), "slots")
        self.assertEqual(self.refused(slot_roles=["boss"]), "slots")
        self.assertEqual(self.refused(slot_texts=[]), "slots")
        self.assertEqual(self.refused(slot_roles=["text"], slot_texts=["  "]), "slots")
        self.assertEqual(self.refused(audience="everyone"), "audience")
        self.assertEqual(self.refused(audience="student", audience_ids=[]), "audience")
        self.assertEqual(self.refused(audience="student", audience_ids=[self.admin.pk]), "audience")  # not a learner
        self.assertEqual(self.refused(audience="student", audience_ids=list(range(1, 302))), "over_limit")
        self.assertEqual(self.refused(audience="group", audience_ids=[999]), "audience")
        self.assertEqual(self.refused(scheduled_at=(NOW - timedelta(minutes=2)).isoformat()), "past")
        self.assertEqual(self.refused(scheduled_at="soon"), "past")

    def test_a_number_slot_takes_digits_only(self):
        self.assertEqual(
            self.refused(template_id=70000, slot_roles=["student", "text", "text"], slot_texts=["", "abc", "x"]), "slots",
        )

    def test_a_minute_late_is_still_now(self):
        draft = campaigns.clean(self.draft(scheduled_at=(NOW - timedelta(seconds=50)).isoformat()), now=NOW)
        self.assertIsNotNone(draft.scheduled_at)


@override_settings(SMS_PRICE_PER_PART=170)
class PreviewTests(Fixture):
    def test_count_samples_and_cost(self):
        for i in range(5):
            self.learner(101 + i, f"s{i}", phone=f"99890111111{i}")
        result = campaigns.preview(self.draft(), now=NOW)
        self.assertEqual((result["count"], result["over_limit"], result["limit"]), (5, False, 300))
        self.assertEqual(len(result["samples"]), 3)
        self.assertEqual(result["samples"][0]["parts"], 1)
        self.assertEqual((result["parts_total"], result["cost"]), (5, 5 * 170))

    def test_over_the_limit_shows(self):
        with mock.patch("sms.campaigns.LIMIT", 1):
            self.learner(101, "a", phone="998901111111")
            self.learner(102, "b", phone="998902222222")
            self.assertTrue(campaigns.preview(self.draft(), now=NOW)["over_limit"])


class CreateTests(Fixture):
    def test_a_now_campaign_is_due_at_once_and_queues_the_send(self):
        self.learner(101, "malika")
        with self.captureOnCommitCallbacks() as callbacks:
            campaign = campaigns.create(self.draft(), self.admin, now=NOW)
        self.assertEqual((campaign.status, campaign.scheduled_at, campaign.created_by), (SmsCampaign.STATUS_SCHEDULED, NOW, self.admin))
        self.assertEqual((campaign.pattern, campaign.original), (T.DEBT_WARNING.text, ORIGINAL_64942))
        self.assertEqual(len(callbacks), 1)

    def test_a_later_campaign_queues_nothing(self):
        self.learner(101, "malika")
        with self.captureOnCommitCallbacks() as callbacks:
            campaigns.create(self.draft(scheduled_at=(NOW + timedelta(hours=2)).isoformat()), self.admin, now=NOW)
        self.assertEqual(callbacks, [])

    def test_nobody_is_refused(self):
        with self.assertRaises(CampaignRefused) as caught:
            self.create()
        self.assertEqual(caught.exception.code, "empty")

    def test_more_than_300_is_refused(self):
        with mock.patch("sms.campaigns.LIMIT", 1):
            self.learner(101, "a", phone="998901111111")
            self.learner(102, "b", phone="998902222222")
            with self.assertRaises(CampaignRefused) as caught:
                self.create()
        self.assertEqual(caught.exception.code, "over_limit")


class SendTests(Fixture):
    def test_a_future_campaign_waits_for_its_time(self):
        self.learner(101, "malika")
        self.create(scheduled_at=(NOW + timedelta(hours=1)).isoformat())
        fake = FakeEskiz()
        self.assertEqual(campaigns.dispatch_due(fake, NOW), 0)
        self.assertEqual(fake.sent, [])
        self.assertEqual(campaigns.dispatch_due(fake, NOW + timedelta(hours=1)), 1)
        self.assertEqual(len(fake.sent), 1)

    def test_dispatch_claims_once(self):
        self.learner(101, "malika")
        campaign = self.create()
        fake = FakeEskiz()
        self.assertEqual(campaigns.dispatch_due(fake, NOW), 1)
        self.assertEqual(campaigns.dispatch_due(fake, NOW), 0)
        self.assertEqual(len(fake.sent), 1)
        campaign.refresh_from_db()
        self.assertEqual(campaign.status, SmsCampaign.STATUS_DONE)
        msg = SmsMessage.objects.get()
        self.assertEqual((msg.kind, msg.dedupe_key, msg.campaign, msg.created_by, msg.text), (
            "campaign", f"campaign:{campaign.pk}:student:101", campaign, self.admin, MALIKA_64942,
        ))
        self.assertEqual(campaign.result["sent"], 1)
        self.assertEqual((campaign.started_at, campaign.finished_at), (NOW, NOW))

    def test_a_debtor_who_paid_before_the_time_is_skipped(self):
        malika = self.learner(101, "malika")
        campaign = self.create(scheduled_at=(NOW + timedelta(hours=1)).isoformat())
        LcupStudentLink.objects.filter(user=malika).update(balance=Decimal(0))
        fake = FakeEskiz()
        campaigns.dispatch_due(fake, NOW + timedelta(hours=1))
        self.assertEqual(fake.sent, [])
        campaign.refresh_from_db()
        self.assertEqual(campaign.status, SmsCampaign.STATUS_DONE)
        self.assertEqual(campaign.result["sent"], 0)

    def test_a_group_that_grew_past_the_limit_fails_and_sends_nothing(self):
        self.learner(101, "a", phone="998901111111", room=self.room)
        campaign = self.create(audience="group", audience_ids=[self.room.pk])
        self.learner(102, "b", phone="998902222222", room=self.room)
        fake = FakeEskiz()
        with mock.patch("sms.campaigns.LIMIT", 1):
            campaigns.dispatch_due(fake, NOW)
        campaign.refresh_from_db()
        self.assertEqual(campaign.status, SmsCampaign.STATUS_FAILED)
        self.assertIn("more than 1", campaign.error)
        self.assertEqual(fake.sent, [])

    def test_one_recipient_going_wrong_does_not_stop_the_rest(self):
        self.learner(101, "a", phone="998901111111")
        self.learner(102, "b", phone="998902222222")
        campaign = self.create()
        real = campaigns.deliver

        def flaky(client, **fields):
            if fields["lcup_student_id"] == 101:
                raise RuntimeError("the database went away")
            return real(client, **fields)

        fake = FakeEskiz()
        with mock.patch("sms.campaigns.deliver", side_effect=flaky):
            campaigns.dispatch_due(fake, NOW)
        campaign.refresh_from_db()
        self.assertEqual((campaign.result["errors"], campaign.result["sent"]), (1, 1))
        self.assertEqual([p for p, _, _ in fake.sent], ["998902222222"])


class CancelAndRetryTests(Fixture):
    def test_cancel_only_while_scheduled(self):
        self.learner(101, "malika")
        campaign = self.create(scheduled_at=(NOW + timedelta(hours=1)).isoformat())
        campaigns.cancel(campaign, now=NOW)
        campaign.refresh_from_db()
        self.assertEqual(campaign.status, SmsCampaign.STATUS_CANCELLED)
        self.assertEqual(campaigns.dispatch_due(FakeEskiz(), NOW + timedelta(hours=2)), 0)
        with self.assertRaises(CampaignRefused) as caught:
            campaigns.cancel(campaign, now=NOW)
        self.assertEqual(caught.exception.code, "not_scheduled")

    def retry(self, campaign, client, now=NOW):
        """What the API does (count and claim), then what the queued task does (send)."""
        queued = campaigns.retry(campaign, now=now)
        campaigns.resume(client, campaign.pk, now=now)
        campaign.refresh_from_db()
        return queued

    def test_retry_resends_failed_and_never_uncertain(self):
        self.learner(101, "a", phone="998901111111")
        self.learner(102, "b", phone="998902222222")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED), NOW)
        SmsMessage.objects.filter(lcup_student_id=102).update(status=SmsMessage.STATUS_UNCERTAIN)
        campaign.refresh_from_db()
        fake = FakeEskiz()
        self.assertEqual(self.retry(campaign, fake), 1)
        self.assertEqual([p for p, _, _ in fake.sent], ["998901111111"])
        self.assertEqual(campaign.status, SmsCampaign.STATUS_DONE)
        self.assertEqual((campaign.result["sent"], campaign.result["failed"], campaign.result["uncertain"]), (1, 0, 1))
        self.assertEqual(SmsMessage.objects.get(lcup_student_id=101).attempts, 2)

    def test_retry_only_when_done_or_failed(self):
        self.learner(101, "malika")
        campaign = self.create(scheduled_at=(NOW + timedelta(hours=1)).isoformat())
        for status in (SmsCampaign.STATUS_SCHEDULED, SmsCampaign.STATUS_SENDING, SmsCampaign.STATUS_CANCELLED):
            SmsCampaign.objects.filter(pk=campaign.pk).update(status=status)
            campaign.refresh_from_db()
            with self.subTest(status=status), self.assertRaises(CampaignRefused) as caught:
                campaigns.retry(campaign, now=NOW)
            self.assertEqual(caught.exception.code, "not_done")

    def test_a_retry_claims_the_campaign_so_a_second_click_is_refused(self):
        self.learner(101, "malika")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED), NOW)
        campaign.refresh_from_db()
        self.assertEqual(campaigns.retry(campaign, now=NOW), 1)
        campaign.refresh_from_db()
        self.assertEqual((campaign.status, campaign.started_at, campaign.finished_at), (SmsCampaign.STATUS_SENDING, NOW, None))
        with self.assertRaises(CampaignRefused) as caught:
            campaigns.retry(campaign, now=NOW)
        self.assertEqual(caught.exception.code, "not_done")

    def test_retry_resumes_a_stopped_campaign_where_it_stopped(self):
        for i in range(9):
            self.learner(101 + i, f"s{i}", phone=f"9989011111{i:02d}")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED, outcomes=[ACCEPTED] * 2), NOW)
        campaign.refresh_from_db()
        self.assertEqual(campaign.status, SmsCampaign.STATUS_FAILED)
        # 5 FAILED to send again, and the 2 the stop never reached.
        fake = FakeEskiz()
        self.assertEqual(self.retry(campaign, fake), 7)
        self.assertEqual(len(fake.sent), 7)
        self.assertEqual((campaign.status, campaign.error, campaign.result["sent"]), (SmsCampaign.STATUS_DONE, "", 9))
        self.assertEqual(SmsMessage.objects.filter(campaign=campaign).count(), 9)

    def test_a_debtor_who_paid_since_is_not_retried(self):
        self.learner(101, "a", phone="998901111111")
        paid = self.learner(102, "b", phone="998902222222")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED), NOW)
        LcupStudentLink.objects.filter(user=paid).update(balance=Decimal(0))
        campaign.refresh_from_db()
        fake = FakeEskiz()
        self.assertEqual(self.retry(campaign, fake), 1)
        self.assertEqual([p for p, _, _ in fake.sent], ["998901111111"])
        self.assertEqual(SmsMessage.objects.get(lcup_student_id=102).status, SmsMessage.STATUS_FAILED)

    def test_a_retry_writes_the_text_again(self):
        malika = self.learner(101, "malika")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED), NOW)
        LcupStudentLink.objects.filter(user=malika).update(name="Karimova Malika Aliyevna")
        campaign.refresh_from_db()
        fake = FakeEskiz()
        self.retry(campaign, fake)
        self.assertIn("Karimova Malika Aliyevna, sizda", fake.sent[0][1])
        self.assertEqual(SmsMessage.objects.get().text, fake.sent[0][1])

    def test_a_retry_the_next_day_still_finds_what_went_out(self):
        self.learner(101, "a", phone="998901111111")
        self.learner(102, "b", phone="998902222222")
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(FAILED, outcomes=[ACCEPTED]), NOW)
        campaign.refresh_from_db()
        fake = FakeEskiz()
        self.assertEqual(self.retry(campaign, fake, now=NOW + timedelta(hours=20)), 1)  # 11:00 the next day
        self.assertEqual([p for p, _, _ in fake.sent], ["998902222222"])
        self.assertEqual(SmsMessage.objects.count(), 2)


class Killed(BaseException):
    """The worker is killed mid-send: not an ``Exception``, so nothing after it runs."""


class StuckCampaignTests(Fixture):
    """A worker killed mid-send leaves its campaign SENDING; the minute beat picks it up again."""

    def three(self):
        for i in range(3):
            self.learner(101 + i, f"s{i}", phone=f"99890111111{i}")
        return self.create()

    def kill_after(self, k):
        real, calls = campaigns.deliver, []

        def dying(client, **fields):
            if len(calls) == k:
                raise Killed
            calls.append(fields["lcup_student_id"])
            return real(client, **fields)

        return mock.patch("sms.campaigns.deliver", side_effect=dying)

    def test_the_reaper_sends_only_what_a_killed_worker_left(self):
        campaign = self.three()
        first = FakeEskiz()
        with self.kill_after(2), self.assertRaises(Killed):
            campaigns.dispatch_due(first, NOW)
        campaign.refresh_from_db()
        self.assertEqual((campaign.status, len(first.sent)), (SmsCampaign.STATUS_SENDING, 2))
        later = FakeEskiz()
        # Fresh (started 14 min ago): a worker may still be on it.
        self.assertEqual(campaigns.resume_stuck(later, NOW + timedelta(minutes=14)), 0)
        self.assertEqual(later.sent, [])
        self.assertEqual(campaigns.resume_stuck(later, NOW + timedelta(minutes=20)), 1)
        self.assertEqual([p for p, _, _ in later.sent], ["998901111112"])
        campaign.refresh_from_db()
        self.assertEqual((campaign.status, campaign.result["sent"]), (SmsCampaign.STATUS_DONE, 3))
        self.assertEqual(campaigns.resume_stuck(later, NOW + timedelta(hours=1)), 0)

    def test_a_fresh_sending_campaign_is_not_touched(self):
        campaign = self.three()
        SmsCampaign.objects.filter(pk=campaign.pk).update(
            status=SmsCampaign.STATUS_SENDING, started_at=NOW - timedelta(minutes=5),
        )
        fake = FakeEskiz()
        self.assertEqual(campaigns.resume_stuck(fake, NOW), 0)
        self.assertEqual(fake.sent, [])
        campaign.refresh_from_db()
        self.assertEqual((campaign.status, campaign.started_at), (SmsCampaign.STATUS_SENDING, NOW - timedelta(minutes=5)))

    def test_the_reaper_claims_once(self):
        campaign = self.three()
        SmsCampaign.objects.filter(pk=campaign.pk).update(
            status=SmsCampaign.STATUS_SENDING, started_at=NOW - timedelta(minutes=20),
        )
        real, claims = campaigns.send_campaign, []

        def second_beat_meanwhile(client, campaign, now=None):
            claims.append(campaigns.resume_stuck(FakeEskiz(), now))  # finds it fresh: claimed a moment ago
            return real(client, campaign, now)

        with mock.patch("sms.campaigns.send_campaign", side_effect=second_beat_meanwhile):
            self.assertEqual(campaigns.resume_stuck(FakeEskiz(), NOW), 1)
        self.assertEqual(claims, [0])

    def test_a_long_send_keeps_its_heartbeat(self):
        campaign = self.three()
        later = NOW + timedelta(minutes=30)
        seen, real = [], campaigns.deliver

        def spy(client, **fields):
            seen.append(SmsCampaign.objects.get(pk=campaign.pk).started_at)
            return real(client, **fields)

        with mock.patch("sms.campaigns.HEARTBEAT_EVERY", 2), mock.patch("sms.campaigns.deliver", side_effect=spy), \
                mock.patch("sms.campaigns.timezone.now", return_value=later):
            campaigns.dispatch_due(FakeEskiz(), NOW)
        self.assertEqual(seen, [NOW, NOW, later])


class CircuitBreakerTests(Fixture):
    """eskiz failing over and over is not 300 failures: the campaign stops and waits for a person."""

    def learners(self, n):
        for i in range(n):
            self.learner(101 + i, f"s{i}", phone=f"9989011111{i:02d}")

    def test_five_failures_in_a_row_stop_the_campaign(self):
        self.learners(9)
        campaign = self.create()
        fake = FakeEskiz(FAILED, outcomes=[ACCEPTED] * 2)
        campaigns.dispatch_due(fake, NOW)
        campaign.refresh_from_db()
        self.assertEqual(len(fake.sent), 7)  # two out, then five failures
        self.assertEqual(campaign.status, SmsCampaign.STATUS_FAILED)
        self.assertEqual(campaign.error, "eskiz kept failing — stopped after 2 sent; press Retry to continue")
        self.assertEqual((campaign.result["sent"], campaign.result["failed"]), (2, 5))
        # The last two were never claimed: a retry sends them.
        self.assertEqual(SmsMessage.objects.filter(campaign=campaign).count(), 7)

    def test_uncertain_counts_and_an_accepted_one_starts_the_count_again(self):
        self.learners(12)
        campaign = self.create()
        fake = FakeEskiz(UNCERTAIN, outcomes=[FAILED] * 4 + [ACCEPTED] + [UNCERTAIN] * 4)
        campaigns.dispatch_due(fake, NOW)
        campaign.refresh_from_db()
        self.assertEqual(len(fake.sent), 10)  # 4 failed, 1 out, then 5 uncertain/failed in a row
        self.assertEqual(campaign.status, SmsCampaign.STATUS_FAILED)
        self.assertIn("stopped after 1 sent", campaign.error)

    def test_four_in_a_row_do_not_stop_it(self):
        self.learners(5)
        campaign = self.create()
        campaigns.dispatch_due(FakeEskiz(ACCEPTED, outcomes=[FAILED] * 4), NOW)
        campaign.refresh_from_db()
        self.assertEqual((campaign.status, campaign.result["failed"], campaign.result["sent"]), (SmsCampaign.STATUS_DONE, 4, 1))


class StaleBalanceTests(Fixture):
    """lc-up's sync stopped: an old balance may be paid. A debtor list, or a text naming the debt, skips it."""

    def stale(self, user, age=timedelta(hours=25)):
        LcupStudentLink.objects.filter(user=user).update(balance_seen_at=NOW - age if age else None)

    def test_debtors_with_an_old_or_unknown_balance_are_skipped(self):
        fresh = self.learner(101, "fresh")
        old = self.learner(102, "old", phone="998902222222")
        unknown = self.learner(103, "unknown", phone="998903333333")
        self.stale(old)
        self.stale(unknown, age=None)
        recipients, skipped = campaigns.resolve(campaigns.clean(self.draft(), now=NOW), now=NOW)
        self.assertEqual([r.user for r in recipients], [fresh])
        self.assertEqual([p["user_id"] for p in skipped["stale_balance"]], [old.pk, unknown.pk])
        preview = campaigns.preview(self.draft(), now=NOW)
        self.assertEqual((preview["count"], len(preview["skipped"]["stale_balance"])), (1, 2))

    def test_a_debt_slot_skips_an_old_balance_whatever_the_audience(self):
        malika = self.learner(101, "malika")
        self.stale(malika)
        draft = self.draft(
            template_id=70000, slot_roles=["student", "debt", "text"], slot_texts=["", "", "Rahmat"],
            audience="student", audience_ids=[malika.pk],
        )
        _, skipped = campaigns.resolve(campaigns.clean(draft, now=NOW), now=NOW)
        self.assertEqual([p["user_id"] for p in skipped["stale_balance"]], [malika.pk])

    def test_a_text_without_the_debt_to_students_does_not_care(self):
        malika = self.learner(101, "malika")
        self.stale(malika)
        recipients, _ = campaigns.resolve(
            campaigns.clean(self.draft(audience="student", audience_ids=[malika.pk]), now=NOW), now=NOW,
        )
        self.assertEqual([r.user for r in recipients], [malika])

    def test_create_refuses_when_only_old_balances_are_left(self):
        self.stale(self.learner(101, "malika"))
        with self.assertRaises(CampaignRefused) as caught:
            self.create()
        self.assertEqual(caught.exception.code, "empty")

    def test_a_balance_that_went_old_before_the_send_is_skipped(self):
        self.learner(101, "malika")
        campaign = self.create(scheduled_at=(NOW + timedelta(hours=30)).isoformat())
        fake = FakeEskiz()
        campaigns.dispatch_due(fake, NOW + timedelta(hours=30))
        self.assertEqual(fake.sent, [])
        campaign.refresh_from_db()
        self.assertEqual(len(campaign.result["skipped"]["stale_balance"]), 1)


class AudienceLabelTests(Fixture):
    def test_labels(self):
        malika = self.learner(101, "malika")
        aziza = self.learner(102, "aziza", phone="998902222222")
        label = lambda audience, ids: campaigns.audience_label(SmsCampaign(audience=audience, audience_ids=ids))  # noqa: E731
        self.assertEqual(label("debtors", []), "Debtors")
        self.assertEqual(label("group", [self.room.pk]), "Group: Junior G21 | Math")
        self.assertEqual(label("student", [malika.pk]), "Student: Malika Karimova")
        self.assertEqual(label("student", [malika.pk, aziza.pk]), "2 students")
