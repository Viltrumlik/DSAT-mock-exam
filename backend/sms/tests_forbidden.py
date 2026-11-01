"""eskiz's word list (2026-11-01: it refused "Shavkatova Xusnida" for the keyword "shavkat").

A flagged word is dropped from the student's NAME only — the approved template around it never changes,
and a word outside the name is never touched. Nothing is sent when eskiz still refuses the text or the
name would be left empty; an unanswered check sends the text as it is."""

from django.test import SimpleTestCase

from sms.forbidden import scrub
from sms.testing import FakeEskiz

WARN = "MASTER SAT'dan yozyabmiz. {name} sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!"


class ScrubTests(SimpleTestCase):
    def test_an_allowed_text_goes_as_it_is(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        text = WARN.format(name="Karimova Malika,")
        self.assertEqual(scrub(fake, text, "Karimova Malika"), (text, []))

    def test_a_flagged_surname_is_dropped(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        text, flagged = scrub(fake, WARN.format(name="Shavkatova Xusnida,"), "Shavkatova Xusnida")
        self.assertEqual(text, WARN.format(name="Xusnida,"))
        self.assertEqual(flagged, ["shavkat"])

    def test_a_flagged_last_word_hands_its_comma_to_the_word_before(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        text, _ = scrub(fake, WARN.format(name="Xusnida Shavkatova,"), "Xusnida Shavkatova")
        self.assertEqual(text, WARN.format(name="Xusnida,"))

    def test_a_flagged_word_in_a_longer_name(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        text, _ = scrub(fake, WARN.format(name="Ali Shavkat o'g'li,"), "Ali Shavkat o'g'li")
        self.assertEqual(text, WARN.format(name="Ali o'g'li,"))

    def test_nothing_is_sent_when_the_whole_name_is_flagged(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        self.assertEqual(scrub(fake, WARN.format(name="Shavkat,"), "Shavkat"), (None, ["shavkat"]))

    def test_a_flagged_word_outside_the_name_is_never_touched(self):
        fake = FakeEskiz(forbidden={"qarzdorlik"})
        self.assertEqual(scrub(fake, WARN.format(name="Karimova Malika,"), "Karimova Malika"), (None, ["qarzdorlik"]))

    def test_an_unanswered_check_sends_the_text_as_it_is(self):
        fake = FakeEskiz(forbidden={"shavkat"}, check_error=True)
        text = WARN.format(name="Shavkatova Xusnida,")
        self.assertEqual(scrub(fake, text, "Shavkatova Xusnida"), (text, []))

    def test_a_curly_apostrophe_in_the_lcup_name_still_matches_the_rendered_word(self):
        fake = FakeEskiz(forbidden={"shavkat"})
        text, _ = scrub(fake, WARN.format(name="Shavkatova Ra'no,"), "Shavkatova Ra’no")
        self.assertEqual(text, WARN.format(name="Ra'no,"))
