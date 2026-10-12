from django.test import SimpleTestCase

from lcup.phones import name_tokens, normalize_phone, split_lcup_name


class NormalizePhoneTests(SimpleTestCase):
    def test_accepts_every_local_spelling(self):
        for raw in ("998901234567", "+998 90 123 45 67", "(90) 123-45-67", "901234567", " +998901234567 "):
            self.assertEqual(normalize_phone(raw), "998901234567", raw)

    def test_rejects_non_uzbek_or_short(self):
        for raw in (None, "", "12345", "79001234567", "9989012345678", "abc"):
            self.assertIsNone(normalize_phone(raw), raw)


class NameTests(SimpleTestCase):
    def test_lcup_order_is_last_then_first(self):
        self.assertEqual(split_lcup_name("Karimova Malika"), ("Malika", "Karimova"))
        self.assertEqual(split_lcup_name("Aliyev Vali Ali o'g'li"), ("Vali Ali o'g'li", "Aliyev"))
        self.assertEqual(split_lcup_name("  Madonna "), ("Madonna", ""))
        self.assertEqual(split_lcup_name(""), ("", ""))

    def test_tokens_ignore_case_and_apostrophe_variants(self):
        self.assertEqual(name_tokens("O‘g‘iloy  ALIYEVA"), name_tokens("o'g'iloy aliyeva"))
