"""Resending what did not arrive (by hand), the journal's CSV export, and one student's SMS."""

from __future__ import annotations

from datetime import date, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from lcup.models import LcupStudentLink
from sms.delivery import RESENDABLE, resend
from sms.eskiz import FAILED
from sms.models import SmsMessage
from sms.testing import FakeEskiz
from sms.tests_api import ApiFixture

S = SmsMessage
DAY = date(2026, 11, 1)


def row(status, key="student:101", *, phone="998901234567", user=None, lcup_student_id=101, eskiz_status=""):
    return S.objects.create(
        kind=S.KIND_DEBT_WARNING, run_on=DAY, dedupe_key=key, phone=phone, text="Salom", status=status,
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


class ResendApiTests(ApiFixture):
    def setUp(self):
        super().setUp()
        patcher = mock.patch("sms.tasks.resend_messages.delay")
        self.queued_resend = patcher.start()
        self.addCleanup(patcher.stop)

    def test_queues_only_the_resendable(self):
        bad = row(S.STATUS_UNDELIVERED, "a")
        good = row(S.STATUS_DELIVERED, "b")
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("messages/resend/", {"ids": [bad.pk, good.pk, 99999]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"queued": [bad.pk], "not_resendable": [good.pk, 99999]})
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
