"""Resending what did not arrive (by hand), the journal's CSV export, and one student's SMS."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupStudentLink
from sms.delivery import RESENDABLE
from sms.eskiz import FAILED
from sms.models import SmsMessage
from sms.resend import refusal, resend
from sms.testing import FakeEskiz
from sms.tests_api import ApiFixture

S = SmsMessage
DEBT_ON = {"SMS_DEBT_WARNINGS_ENABLED": True, "LCUP_DEBT_FREEZE_ENABLED": True, "LCUP_DEBT_FREEZE_DAY": 6}


def row(status, key="k:101", *, kind=S.KIND_TEST, run_on=None, phone="998901234567", user=None, lcup_student_id=101,
        eskiz_status="", text="Salom"):
    return S.objects.create(
        kind=kind, run_on=run_on or timezone.localdate(), dedupe_key=key, phone=phone, text=text, status=status,
        user=user, lcup_student_id=lcup_student_id, eskiz_status=eskiz_status, parts=1, unit_price=170,
    )


class ResendTests(TestCase):
    def test_resendable_statuses(self):
        self.assertEqual(set(RESENDABLE), {S.STATUS_UNDELIVERED, S.STATUS_REJECTED, S.STATUS_FAILED})

    def test_resend_twice_sends_once(self):
        msg = row(S.STATUS_UNDELIVERED)
        fake = FakeEskiz()
        first = resend(fake, msg.pk)
        second = resend(fake, msg.pk)
        self.assertIsNone(second)
        self.assertEqual(len(fake.sent), 1)
        first.refresh_from_db()
        self.assertEqual((first.pk, first.status, first.attempts), (msg.pk, S.STATUS_SENT, 2))

    def test_a_concurrent_second_flip_still_sends_once(self):
        """Run B flips the row between run A's flip and A's claim: deliver's claim lets one through."""
        msg = row(S.STATUS_REJECTED)
        fake = FakeEskiz()
        S.objects.filter(pk=msg.pk).update(status=S.STATUS_FAILED)  # A's flip
        self.assertIsNotNone(resend(fake, msg.pk))  # B re-flips FAILED and sends
        self.assertIsNone(resend(fake, msg.pk))  # A, late: the row is SENT now
        self.assertEqual(len(fake.sent), 1)

    def test_delivered_sent_and_uncertain_are_never_resent(self):
        fake = FakeEskiz()
        for i, status in enumerate((S.STATUS_DELIVERED, S.STATUS_SENT, S.STATUS_UNCERTAIN, S.STATUS_PENDING)):
            self.assertIsNone(resend(fake, row(status, key=f"k{i}").pk))
        self.assertEqual(fake.sent, [])

    def test_the_current_lcup_phone_is_used(self):
        LcupStudentLink.objects.create(lcup_student_id=101, name="Ali", phone="+998 99 111 22 33")
        msg = row(S.STATUS_UNDELIVERED)
        fake = FakeEskiz()
        resend(fake, msg.pk)
        self.assertEqual(fake.sent[0][0], "998991112233")

    def test_a_failed_resend_stays_resendable(self):
        msg = row(S.STATUS_UNDELIVERED)
        resend(FakeEskiz(FAILED), msg.pk)
        msg.refresh_from_db()
        self.assertEqual(msg.status, S.STATUS_FAILED)
        self.assertIsNotNone(resend(FakeEskiz(), msg.pk))

    def test_a_campaign_sms_may_go_again_on_a_later_day(self):
        msg = row(S.STATUS_UNDELIVERED, kind=S.KIND_CAMPAIGN, run_on=timezone.localdate() - timedelta(days=3))
        self.assertIsNotNone(resend(FakeEskiz(), msg.pk))

    def test_forbidden_words_are_scrubbed_from_the_name_first(self):
        LcupStudentLink.objects.create(lcup_student_id=101, name="Ali Shavkat", phone="998901234567")
        msg = row(S.STATUS_REJECTED, text="Ali Shavkat, sizda qarz bor.")
        fake = FakeEskiz(forbidden=["shavkat"])
        resend(fake, msg.pk)
        self.assertEqual(fake.sent[0][1], "Ali, sizda qarz bor.")

    def test_a_text_eskiz_still_forbids_is_not_sent_and_stays_as_it_was(self):
        msg = row(S.STATUS_REJECTED, text="Shavkat aka, salom.", lcup_student_id=None)
        fake = FakeEskiz(forbidden=["salom"])
        self.assertIsNone(resend(fake, msg.pk))
        self.assertEqual(fake.sent, [])
        msg.refresh_from_db()
        self.assertEqual(msg.status, S.STATUS_REJECTED)


@override_settings(**DEBT_ON)
class DebtWarningResendTests(TestCase):
    def test_todays_debt_warning_may_go_again(self):
        msg = row(S.STATUS_UNDELIVERED, kind=S.KIND_DEBT_WARNING)
        self.assertIsNone(refusal(msg, timezone.localdate()))
        self.assertIsNotNone(resend(FakeEskiz(), msg.pk))

    def test_stale_debt_warning_not_resendable(self):
        """It names its day ("Bugun oxirgi kun!") and the student may have paid since."""
        msg = row(S.STATUS_UNDELIVERED, kind=S.KIND_DEBT_WARNING, run_on=timezone.localdate() - timedelta(days=1))
        fake = FakeEskiz()
        self.assertEqual(refusal(msg, timezone.localdate()), "stale")
        self.assertIsNone(resend(fake, msg.pk))
        self.assertEqual(fake.sent, [])

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False)
    def test_resend_respects_master_switch(self):
        msg = row(S.STATUS_UNDELIVERED, kind=S.KIND_DEBT_WARNING)
        fake = FakeEskiz()
        self.assertEqual(refusal(msg, timezone.localdate()), "switched_off")
        self.assertIsNone(resend(fake, msg.pk))
        self.assertEqual(fake.sent, [])


class ResendApiTests(ApiFixture):
    def setUp(self):
        super().setUp()
        patcher = mock.patch("sms.tasks.resend_messages.delay")
        self.queued_resend = patcher.start()
        self.addCleanup(patcher.stop)

    def test_queues_only_the_resendable(self):
        bad = row(S.STATUS_UNDELIVERED, "a")
        good = row(S.STATUS_DELIVERED, "b")
        stale = row(S.STATUS_UNDELIVERED, "c", kind=S.KIND_DEBT_WARNING, run_on=timezone.localdate() - timedelta(days=2))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("messages/resend/", {"ids": [bad.pk, good.pk, stale.pk, 99999]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"queued": [bad.pk], "not_resendable": [good.pk, stale.pk, 99999]})
        self.queued_resend.assert_called_once_with([bad.pk])

    def test_nothing_resendable_queues_nothing(self):
        good = row(S.STATUS_DELIVERED, "b")
        with self.captureOnCommitCallbacks(execute=True):
            self.post("messages/resend/", {"ids": [good.pk]})
        self.queued_resend.assert_not_called()

    def test_ids_must_be_1_to_300_whole_numbers(self):
        for body in ({"ids": []}, {"ids": list(range(1, 302))}, {"ids": ["x"]}, {"ids": "1"}, {}):
            response = self.post("messages/resend/", body)
            self.assertEqual((response.status_code, response.json().get("code")), (400, "ids"), body)

    def test_teachers_are_refused(self):
        self.assertEqual(self.post("messages/resend/", {"ids": [1]}, user=self.teacher).status_code, 403)


@override_settings(**DEBT_ON)
class CanResendFieldTests(ApiFixture):
    def test_the_row_says_whether_it_may_go_again_now(self):
        today_debt = row(S.STATUS_UNDELIVERED, "a", kind=S.KIND_DEBT_WARNING)
        stale_debt = row(S.STATUS_UNDELIVERED, "b", kind=S.KIND_DEBT_WARNING, run_on=timezone.localdate() - timedelta(days=1))
        delivered = row(S.STATUS_DELIVERED, "c")
        failed_test = row(S.STATUS_FAILED, "d")
        rows = {r["id"]: r["can_resend"] for r in self.get("messages/").json()["results"]}
        self.assertEqual(
            rows, {today_debt.pk: True, stale_debt.pk: False, delivered.pk: False, failed_test.pk: True}
        )


class ExportTests(ApiFixture):
    def test_bom_header_and_the_filtered_rows(self):
        row(S.STATUS_UNDELIVERED, "a", phone="998991234567", user=self.malika, eskiz_status="REJECTED")
        row(S.STATUS_DELIVERED, "b", phone="998901234567")
        response = self.get("messages/export/", operator="Uzmobile")
        self.assertEqual(response.status_code, 200)
        self.assertIn("sms-journal-", response["Content-Disposition"])
        body = response.content.decode("utf-8")
        self.assertTrue(body.startswith("﻿Date,Name,Phone,Groups,Operator,Kind,Source,Template,Status,Reason,Parts,Cost,Text"))
        lines = body.strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn("Malika Karimova", lines[1])
        self.assertIn("Operator rejected", lines[1])
        self.assertIn("Junior G21 | Math", lines[1])

    def test_teachers_are_refused(self):
        self.assertEqual(self.get("messages/export/", user=self.teacher).status_code, 403)


class StudentMessagesTests(ApiFixture):
    def test_only_that_students_sms_newest_first(self):
        mine_old = row(S.STATUS_DELIVERED, "a", user=self.malika)
        mine_new = row(S.STATUS_UNDELIVERED, "b", user=self.malika)
        S.objects.filter(pk=mine_old.pk).update(created_at=timezone.now() - timedelta(days=2))
        other = self.learner(102, "aziz", balance=0)
        row(S.STATUS_DELIVERED, "c", user=other)
        data = self.get(f"students/{self.malika.pk}/messages/").json()
        self.assertEqual([r["id"] for r in data["results"]], [mine_new.pk, mine_old.pk])
        self.assertEqual(data["summary"], {"DELIVERED": 1, "UNDELIVERED": 1})

    def test_teachers_are_refused(self):
        self.assertEqual(self.get(f"students/{self.malika.pk}/messages/", user=self.teacher).status_code, 403)
