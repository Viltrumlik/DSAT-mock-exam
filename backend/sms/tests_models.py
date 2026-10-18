from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase

from sms.models import SmsMessage


def row(**extra):
    fields = dict(
        kind=SmsMessage.KIND_DEBT_WARNING, run_on=date(2026, 11, 1), dedupe_key="student:101",
        phone="998901234567", text="x",
    )
    fields.update(extra)
    return SmsMessage.objects.create(**fields)


class UniquePerDayTests(TestCase):
    def test_one_row_per_kind_day_and_key(self):
        row()
        with self.assertRaises(IntegrityError), transaction.atomic():
            row()

    def test_the_next_day_is_a_new_sms(self):
        row()
        row(run_on=date(2026, 11, 2))
        self.assertEqual(SmsMessage.objects.count(), 2)

    def test_another_kind_is_counted_apart(self):
        row()
        row(kind=SmsMessage.KIND_TEST)
        self.assertEqual(SmsMessage.objects.count(), 2)
