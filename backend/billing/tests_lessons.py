from datetime import date

from django.test import SimpleTestCase

from billing.lessons import lessons_in_month, month_amount

MWF, TTS = [1, 3, 5], [2, 4, 6]
PRICE = 500_000
OCT = "2026-10"


class LessonsInMonthTests(SimpleTestCase):
    def test_october_2026_has_13_lessons_on_mon_wed_fri(self):
        self.assertEqual(len(lessons_in_month(OCT, MWF)), 13)

    def test_october_2026_has_14_lessons_on_tue_thu_sat(self):
        self.assertEqual(len(lessons_in_month(OCT, TTS)), 14)

    def test_a_group_with_no_days_has_no_lessons(self):
        self.assertEqual(lessons_in_month(OCT, []), [])


class MonthAmountTests(SimpleTestCase):
    """The amounts are lc-up's, measured on prod on 2026-11-04 (net payments − balance per join date)."""

    def test_the_whole_month_is_the_exact_price(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT), PRICE)

    def test_a_start_on_the_first_lesson_is_still_the_whole_month(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, start=date(2026, 10, 1)), PRICE)

    def test_join_on_the_26th_pays_its_3_of_13_lessons(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, start=date(2026, 10, 26)), 115_000)

    def test_join_on_the_30th_pays_its_1_of_13_lessons(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, start=date(2026, 10, 30)), 38_000)

    def test_join_on_the_31st_pays_its_1_of_14_lessons(self):
        self.assertEqual(month_amount(PRICE, TTS, OCT, start=date(2026, 10, 31)), 36_000)

    def test_leaving_on_the_19th_keeps_its_8_of_13_lessons(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, end=date(2026, 10, 19)), 308_000)

    def test_the_leave_day_itself_is_counted(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, end=date(2026, 10, 2)), 38_000)

    def test_a_span_inside_the_month_counts_only_its_lessons(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, start=date(2026, 10, 12), end=date(2026, 10, 16)), 115_000)

    def test_no_lesson_in_the_span_is_nothing(self):
        self.assertEqual(month_amount(PRICE, MWF, OCT, start=date(2026, 10, 31)), 0)

    def test_a_group_with_no_days_is_nothing(self):
        self.assertEqual(month_amount(PRICE, [], OCT), 0)

    def test_a_partial_month_rounds_to_the_nearest_thousand(self):
        self.assertEqual(month_amount(450_000, MWF, OCT, end=date(2026, 10, 2)), 35_000)
