from django.test import SimpleTestCase

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
