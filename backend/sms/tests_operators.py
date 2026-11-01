from datetime import date

from django.test import SimpleTestCase, TestCase

from sms.models import SmsMessage
from sms.operators import NAMES, operator_of, operator_q


class OperatorOfTests(SimpleTestCase):
    def test_the_code_after_998_names_the_operator(self):
        self.assertEqual(operator_of("998991234567"), "Uzmobile")
        self.assertEqual(operator_of("998901234567"), "Beeline")
        self.assertEqual(operator_of("998501234567"), "Ucell")
        self.assertEqual(operator_of("998981234567"), "Perfectum")
        self.assertEqual(operator_of("998881234567"), "Mobiuz")
        self.assertEqual(operator_of("998331234567"), "Humans")

    def test_an_unknown_code_or_no_phone_is_other(self):
        self.assertEqual(operator_of("998201234567"), "Other")
        self.assertEqual(operator_of(""), "Other")
        self.assertEqual(operator_of(None), "Other")

    def test_names_are_in_a_fixed_order(self):
        self.assertEqual(NAMES, ("Beeline", "Ucell", "Uzmobile", "Mobiuz", "Perfectum", "Humans"))


class OperatorQTests(TestCase):
    def test_matches_only_its_prefixes(self):
        for i, phone in enumerate(("998901234567", "998991234567", "998771234567")):
            SmsMessage.objects.create(kind="test", run_on=date(2026, 11, 1), dedupe_key=f"k{i}", phone=phone, text="x")
        self.assertEqual(
            set(SmsMessage.objects.filter(operator_q("Uzmobile")).values_list("phone", flat=True)),
            {"998991234567", "998771234567"},
        )

    def test_an_unknown_name_is_none(self):
        self.assertIsNone(operator_q("Nokia"))

    def test_other_is_every_phone_no_operator_claims(self):
        for i, phone in enumerate(("998901234567", "998201234567", "")):
            SmsMessage.objects.create(kind="test", run_on=date(2026, 11, 1), dedupe_key=f"o{i}", phone=phone, text="x")
        self.assertEqual(
            set(SmsMessage.objects.filter(operator_q("Other")).values_list("phone", flat=True)), {"998201234567", ""}
        )
