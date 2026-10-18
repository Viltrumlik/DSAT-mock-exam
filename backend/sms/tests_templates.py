from django.test import SimpleTestCase

from sms import templates as T
from sms.templates import SmsTemplate, TemplateError, is_gsm_safe, render

WARN = SmsTemplate(
    "debt_warning",
    "Hurmatli ota-ona, %w ning %d so'm qarzi bor. %d-sanada akkaunt muzlatiladi.",
    ("first_name", "debt", "freeze_day"),
)
VALUES = {"first_name": "Aziz", "debt": 150000, "freeze_day": 6}


class RenderTests(SimpleTestCase):
    def test_fills_the_slots_in_order(self):
        self.assertEqual(
            render(WARN, VALUES),
            "Hurmatli ota-ona, Aziz ning 150000 so'm qarzi bor. 6-sanada akkaunt muzlatiladi.",
        )

    def test_a_word_slot_takes_one_word_with_an_ascii_apostrophe(self):
        text = render(WARN, dict(VALUES, first_name="Ra’no Karimova"))
        self.assertIn("Ra'no ning", text)

    def test_a_ranged_word_slot_takes_up_to_its_count(self):
        template = SmsTemplate("t", "Salom %w{1,2}!", ("first_name",))
        self.assertEqual(render(template, {"first_name": "Ali Vali Soli"}), "Salom Ali Vali!")

    def test_a_number_slot_refuses_anything_but_digits(self):
        with self.assertRaises(TemplateError):
            render(WARN, dict(VALUES, debt="150 000"))

    def test_an_empty_word_is_refused(self):
        with self.assertRaises(TemplateError):
            render(WARN, dict(VALUES, first_name="  "))

    def test_a_missing_value_is_refused(self):
        with self.assertRaises(TemplateError):
            render(WARN, {"first_name": "Aziz", "debt": 1})

    def test_slots_and_names_must_agree(self):
        with self.assertRaises(TemplateError):
            SmsTemplate("bad", "Salom %w, %d", ("first_name",))

    def test_names_a_student(self):
        self.assertTrue(WARN.names_a_student)
        self.assertFalse(SmsTemplate("n", "To'lov %d-sanagacha", ("freeze_day",)).names_a_student)


class GsmTests(SimpleTestCase):
    def test_an_ascii_apostrophe_is_gsm(self):
        self.assertTrue(is_gsm_safe("To'lov qiling"))

    def test_an_uzbek_okina_is_not(self):
        # One U+02BB turns the whole SMS into UCS-2: 70 characters a part, about twice the price.
        self.assertFalse(is_gsm_safe("Toʻlov qiling"))


class ApprovedTemplatesTests(SimpleTestCase):
    """eskiz's moderated patterns #64942 and #52393, as ``manage.py eskiz_account`` read them on 2026-10-18;
    the texts below are the owner's preview, character for character."""

    def test_the_warning(self):
        self.assertEqual(render(T.DEBT_WARNING, {"student": "Karimova Malika,"}), "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!")

    def test_the_last_day(self):
        self.assertEqual(
            render(T.DEBT_LAST_DAY, {"student": "Karimova Malika,"}),
            "Bugun oxirgi kun! MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. Guruhdan chetlatilishingiz mumkin. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
        )

    def test_both_are_plain_ascii_and_go_to_each_student(self):
        for template in (T.DEBT_WARNING, T.DEBT_LAST_DAY):
            self.assertTrue(is_gsm_safe(template.text))
            self.assertTrue(template.names_a_student)

    def test_the_sample_fills_both(self):
        for template in (T.DEBT_WARNING, T.DEBT_LAST_DAY):
            self.assertIn("Test Testov, sizda", render(template, T.SAMPLE_VALUES))
