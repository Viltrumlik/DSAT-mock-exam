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
        self.assertEqual(split_lcup_name("Madonna"), ("Madonna", ""))
        self.assertEqual(split_lcup_name("  Madonna "), ("Madonna", ""))
        self.assertEqual(split_lcup_name(""), ("", ""))

    def test_the_suffixed_word_is_the_surname_wherever_it_stands(self):
        # The two accounts the first prod run created swapped (2026-10-13).
        self.assertEqual(split_lcup_name("Muhammadyor Holiqjonov"), ("Muhammadyor", "Holiqjonov"))
        self.assertEqual(split_lcup_name("Dostonbek Adxamov "), ("Dostonbek", "Adxamov"))
        for full, last in (
            ("Dilyora Abdullajonova", "Abdullajonova"),
            ("Saidasilxon Mamatxonov", "Mamatxonov"),
            ("Nurzoda Burxonova", "Burxonova"),
            ("Asadbek Nabiyev", "Nabiyev"),
            ("Shabnam Xamraliyeva", "Xamraliyeva"),
            ("Shoxjahon Boriev", "Boriev"),
            ("Mubina Ergasheva", "Ergasheva"),
            ("Mironshox G'olibjoniy", "G'olibjoniy"),
            ("Anna Kovalevskaya", "Kovalevskaya"),
            ("Ivan Smirnoff", "Smirnoff"),
        ):
            self.assertEqual(split_lcup_name(full), (full.split(" ")[0], last), full)

    def test_suffix_ignores_case_and_apostrophes(self):
        self.assertEqual(split_lcup_name("Malika KARIMOVA"), ("Malika", "KARIMOVA"))
        self.assertEqual(split_lcup_name("Muslima Azamato‘va"), ("Muslima", "Azamato'va"))

    def test_no_or_several_suffixed_words_keep_the_first_word_as_surname(self):
        self.assertEqual(split_lcup_name("Kim Sergey"), ("Sergey", "Kim"))
        self.assertEqual(split_lcup_name("Abduraxmonov Abdulboriy"), ("Abdulboriy", "Abduraxmonov"))
        self.assertEqual(split_lcup_name("Aliyev Valiyev"), ("Valiyev", "Aliyev"))

    def test_three_words_keep_the_rest_in_order(self):
        self.assertEqual(split_lcup_name("Vali Aliyev Ali o'g'li"), ("Vali Ali o'g'li", "Aliyev"))
        self.assertEqual(split_lcup_name("Malika Karimova Akmal qizi"), ("Malika Akmal qizi", "Karimova"))
        self.assertEqual(split_lcup_name("Vali Ali o'g'li Aliyev"), ("Vali Ali o'g'li", "Aliyev"))
        self.assertEqual(split_lcup_name("Aliyev Vali Ali o'g'li Karimov"), ("Vali Ali o'g'li Karimov", "Aliyev"))

    def test_tokens_ignore_case_and_apostrophe_variants(self):
        self.assertEqual(name_tokens("O‘g‘iloy  ALIYEVA"), name_tokens("o'g'iloy aliyeva"))
