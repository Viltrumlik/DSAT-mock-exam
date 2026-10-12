from django.test import TestCase

from classes.models import Classroom
from lcup.matching import (
    SUGGEST_THRESHOLD,
    days_from,
    level_from,
    match_student,
    match_teacher,
    subject_from,
    suggest_classroom,
)
from lcup.models import LinkStatus, LcupStudentLink, LcupTeacherLink
from users.models import User


def student(username, phone=None, first="", last=""):
    return User.objects.create_user(
        None, password=None, username=username, role="student", phone_number=phone, first_name=first, last_name=last
    )


def teacher(username, phone=None, first="", last="", subject="math"):
    return User.objects.create_user(
        None,
        password=None,
        username=username,
        role="teacher",
        subject=subject,
        phone_number=phone,
        first_name=first,
        last_name=last,
    )


class TeacherMatchTests(TestCase):
    def test_unique_phone_links_automatically(self):
        t = teacher("t1", phone="+998 90 111 11 11", first="Vali", last="Aliyev")
        link = LcupTeacherLink.objects.create(lcup_teacher_id=1, name="Aliyev Vali", phone="998901111111")
        result = match_teacher(link)
        self.assertEqual((result.status, result.user_id, result.reason), (LinkStatus.AUTO, t.pk, "phone"))

    def test_name_only_goes_to_review(self):
        t = teacher("t1", first="Vali", last="Aliyev")
        link = LcupTeacherLink.objects.create(lcup_teacher_id=1, name="Aliyev Vali", phone="998909999999")
        result = match_teacher(link)
        self.assertEqual((result.status, result.user_id, result.reason), (LinkStatus.NEEDS_REVIEW, None, "name only"))
        self.assertEqual([c["user_id"] for c in result.candidates], [t.pk])

    def test_no_match(self):
        link = LcupTeacherLink.objects.create(lcup_teacher_id=1, name="Nobody Here", phone="998909999999")
        result = match_teacher(link)
        self.assertEqual((result.status, result.reason), (LinkStatus.UNMATCHED, "no match"))

    def test_students_are_never_teacher_candidates(self):
        student("s1", phone="998901111111")
        link = LcupTeacherLink.objects.create(lcup_teacher_id=1, name="X Y", phone="998901111111")
        self.assertEqual(match_teacher(link).status, LinkStatus.UNMATCHED)


class StudentMatchTests(TestCase):
    def test_phone_and_name_link_automatically(self):
        s = student("s1", phone="901234567", first="Malika", last="Karimova")
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        result = match_student(link, shared_phones=set(), class_user_ids=set())
        self.assertEqual((result.status, result.user_id, result.reason), (LinkStatus.AUTO, s.pk, "phone + name"))

    def test_phone_with_a_different_name_goes_to_review(self):
        s = student("s1", phone="998901234567", first="Aziza", last="Tursunova")
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        result = match_student(link, shared_phones=set(), class_user_ids=set())
        self.assertEqual((result.status, result.user_id), (LinkStatus.NEEDS_REVIEW, None))
        self.assertEqual(result.reason, "phone matches, name differs")
        self.assertEqual([c["user_id"] for c in result.candidates], [s.pk])

    def test_a_phone_shared_by_siblings_in_lcup_always_goes_to_review(self):
        student("s1", phone="998901234567", first="Malika", last="Karimova")
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        result = match_student(link, shared_phones={"998901234567"}, class_user_ids=set())
        self.assertEqual((result.status, result.reason), (LinkStatus.NEEDS_REVIEW, "phone shared by siblings in lc-up"))

    def test_name_in_the_paired_class_goes_to_review(self):
        s = student("s1", first="Malika", last="Karimova")
        student("s2", first="Aziza", last="Tursunova")
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998907777777")
        result = match_student(link, shared_phones=set(), class_user_ids={s.pk})
        self.assertEqual((result.status, result.reason), (LinkStatus.NEEDS_REVIEW, "name in paired class"))
        self.assertEqual([c["user_id"] for c in result.candidates], [s.pk])

    def test_no_match(self):
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998907777777")
        result = match_student(link, shared_phones=set(), class_user_ids=set())
        self.assertEqual((result.status, result.reason), (LinkStatus.UNMATCHED, "no match"))

    def test_a_user_linked_to_another_lcup_student_is_never_a_candidate(self):
        s = student("s1", phone="998901234567", first="Malika", last="Karimova")
        LcupStudentLink.objects.create(lcup_student_id=99, name="Karimova Malika", phone="998901234567", user=s)
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Karimova Malika", phone="998901234567")
        self.assertEqual(match_student(link, shared_phones=set(), class_user_ids={s.pk}).status, LinkStatus.UNMATCHED)


SNAPSHOT = {
    "name": "Junior G21 | Math | Abdulaziz",
    "course": {"id": 301, "name": "Junior Math"},
    "days": [1, 3, 5],
    "start_time": "18:00:00",
}


class GroupSuggestionTests(TestCase):
    def setUp(self):
        self.t = teacher("t1")

    def classroom(self, name, **kw):
        defaults = {"subject": "MATH", "level": "junior", "lesson_days": "ODD", "lesson_time": "18:00", "created_by": self.t}
        defaults.update(kw)
        return Classroom.objects.create(name=name, **defaults)

    def test_parsers(self):
        self.assertEqual(subject_from(SNAPSHOT), "MATH")
        self.assertEqual(level_from(SNAPSHOT), "junior")
        self.assertEqual(days_from(SNAPSHOT), "ODD")
        self.assertEqual(days_from({"days": [2, 4, 6]}), "EVEN")
        self.assertIsNone(days_from({"days": [1, 2]}))
        self.assertEqual(subject_from({"course": {"name": "Senior English "}}), "ENGLISH")
        self.assertIsNone(subject_from({"course": {"name": "Individualniy"}, "name": "Group"}))

    def test_the_matching_class_is_suggested_with_its_reasons(self):
        right = self.classroom("Junior G21 Math", teacher=self.t)
        self.classroom("Junior G22 Math")
        self.classroom("Senior G1 English", subject="ENGLISH", level="senior", lesson_days="EVEN")
        result = suggest_classroom(SNAPSHOT, teacher_user_ids={self.t.pk}, branch_id=None, taken_classroom_ids=set())
        self.assertEqual(result.classroom_id, right.pk)
        self.assertGreaterEqual(result.score, SUGGEST_THRESHOLD)
        self.assertEqual(result.reasons, ["subject", "level", "days", "time", "teacher", "number G21"])

    def test_a_weak_candidate_is_not_suggested(self):
        self.classroom("Senior G1 English", subject="ENGLISH", level="senior", lesson_days="EVEN", lesson_time="10:00")
        result = suggest_classroom(SNAPSHOT, teacher_user_ids=set(), branch_id=None, taken_classroom_ids=set())
        self.assertIsNone(result.classroom_id)

    def test_taken_and_inactive_classes_are_skipped(self):
        taken = self.classroom("Junior G21 Math")
        self.classroom("Junior G21 Math (old)", is_active=False)
        result = suggest_classroom(SNAPSHOT, teacher_user_ids=set(), branch_id=None, taken_classroom_ids={taken.pk})
        self.assertIsNone(result.classroom_id)
