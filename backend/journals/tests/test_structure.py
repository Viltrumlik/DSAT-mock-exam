"""Course-structure rule: total_lessons = 12*months, midterm every 12th lesson."""
from __future__ import annotations

from django.test import TestCase

from journals import structure


class CourseStructureTests(TestCase):
    def test_seven_courses_exist(self):
        self.assertEqual(len(structure.all_courses()), 7)

    def test_lesson_counts_per_course(self):
        expected = {
            ("MATH", "foundation"): 12,
            ("ENGLISH", "junior"): 36,
            ("MATH", "junior"): 36,
            ("ENGLISH", "middle"): 24,
            ("MATH", "middle"): 24,
            ("ENGLISH", "senior"): 24,
            ("MATH", "senior"): 24,
        }
        for (subject, level), total in expected.items():
            plan = structure.lesson_plan(subject, level)
            self.assertEqual(len(plan), total, f"{subject} {level}")

    def test_midterms_every_twelfth(self):
        plan = structure.lesson_plan("ENGLISH", "junior")  # 36 lessons
        midterms = [n for (n, t) in plan if t == structure.LESSON_TYPE_MIDTERM]
        self.assertEqual(midterms, [12, 24, 36])
        homework = [n for (n, t) in plan if t == structure.LESSON_TYPE_HOMEWORK]
        self.assertEqual(len(homework), 33)

    def test_foundation_single_midterm_at_12(self):
        plan = structure.lesson_plan("MATH", "foundation")
        midterms = [n for (n, t) in plan if t == structure.LESSON_TYPE_MIDTERM]
        self.assertEqual(midterms, [12])
        self.assertEqual(sum(1 for _, t in plan if t == structure.LESSON_TYPE_HOMEWORK), 11)

    def test_english_foundation_is_invalid(self):
        with self.assertRaises(structure.InvalidCourse):
            structure.lesson_plan("ENGLISH", "foundation")
        self.assertFalse(structure.is_valid_course("ENGLISH", "foundation"))

    def test_case_insensitive(self):
        self.assertTrue(structure.is_valid_course("math", "FOUNDATION"))
