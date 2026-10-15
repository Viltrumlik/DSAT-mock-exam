"""/ops Classrooms as a Django-admin changelist and change form (plan 2026-10-15-ops-detail-pages)."""

from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_attendance import AttendanceRecord, AttendanceSession
from lcup.guards import LCUP_OWNED_CLASS_FIELDS
from lcup.models import GroupLinkStatus, LcupAttendancePush, LcupGroupLink, LcupStudentLink, LinkStatus
from users.models import User

URL = "/api/classes/admin/classrooms/"
HOST = "admin.mastersat.uz"
STUDENT, TA = ClassroomMembership.ROLE_STUDENT, ClassroomMembership.ROLE_TA


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(LCUP_ENABLED=True, ALLOWED_HOSTS=["testserver", HOST])
class ClassroomFixture(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("vali", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.other = make("olim", C.ROLE_TEACHER, subject="english", first_name="Olim", last_name="Karimov")
        self.paired = Classroom.objects.create(
            name="G21 Math", subject="MATH", lesson_days="ODD", created_by=self.teacher, teacher=self.teacher,
            room_number="205",
        )
        self.unpaired = Classroom.objects.create(
            name="G7 Math", subject="MATH", lesson_days="EVEN", created_by=self.teacher, teacher=self.teacher,
            room_number="301", level="junior",
        )
        self.archived = Classroom.objects.create(
            name="Old English", subject="ENGLISH", lesson_days="ODD", created_by=self.other, is_active=False,
        )
        self.link = LcupGroupLink.objects.create(
            lcup_group_id=10, name="G21 Math lc-up", classroom=self.paired, status=GroupLinkStatus.CONFIRMED
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov")
        self.malika = make("malika", first_name="Malika", last_name="Karimova")
        self.gone = make("gone", first_name="Gone", last_name="Student")
        self.solo = make("solo", first_name="Solo", last_name="Learner")
        self.ta = make("ta", C.ROLE_SUPPORT_TEACHER, subject="math")
        for u in (self.aziz, self.malika):
            ClassroomMembership.objects.create(classroom=self.paired, user=u, role=STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.paired, user=self.gone, role=STUDENT, status=ClassroomMembership.STATUS_REMOVED
        )
        ClassroomMembership.objects.create(classroom=self.paired, user=self.ta, role=TA)
        ClassroomMembership.objects.create(classroom=self.unpaired, user=self.solo, role=STUDENT)

    def client_for(self, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api

    def get(self, url=URL, user=None, **params):
        return self.client_for(user).get(url, params, HTTP_HOST=HOST)


class ClassroomChangeListTests(ClassroomFixture):
    def ids(self, body):
        return [r["id"] for r in body["results"]]

    def facet(self, body, key):
        f = next(f for f in body["filters"] if f["key"] == key)
        return {o["value"]: o["count"] for o in f["options"]}

    def test_every_class_newest_first(self):
        r = self.get()
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(self.ids(body), [self.archived.pk, self.unpaired.pk, self.paired.pk])
        self.assertEqual((body["count"], body["page"], body["pages"], body["ordering"]), (3, 1, 1, "-created"))

    def test_a_teacher_is_refused(self):
        self.assertEqual(self.get(user=self.teacher).status_code, 403)

    def test_the_lcup_filter_and_its_counts(self):
        body = self.get(lcup="paired").json()
        self.assertEqual(self.ids(body), [self.paired.pk])
        self.assertEqual(self.facet(body, "lcup"), {"paired": 1, "unpaired": 2})
        self.assertEqual(self.ids(self.get(lcup="unpaired").json()), [self.archived.pk, self.unpaired.pk])

    def test_status_archived(self):
        body = self.get(status="archived").json()
        self.assertEqual(self.ids(body), [self.archived.pk])
        self.assertEqual(self.facet(body, "status"), {"active": 2, "archived": 1})

    def test_search_covers_room_and_teacher(self):
        self.assertEqual(self.ids(self.get(q="301").json()), [self.unpaired.pk])
        self.assertEqual(self.ids(self.get(q="aliyev").json()), [self.unpaired.pk, self.paired.pk])

    def test_ordering_by_students_counts_active_student_seats_only(self):
        body = self.get(o="-students").json()
        self.assertEqual(self.ids(body), [self.paired.pk, self.unpaired.pk, self.archived.pk])
        self.assertEqual([r["students"] for r in body["results"]], [2, 1, 0])

    def test_a_page_past_the_end_clamps_to_the_last(self):
        body = self.get(page_size=25, page=9).json()
        self.assertEqual((body["page"], body["page_size"], body["pages"]), (1, 25, 1))

    def test_the_row_shape(self):
        rows = {r["id"]: r for r in self.get().json()["results"]}
        self.assertEqual(rows[self.paired.pk]["teacher"], {"id": self.teacher.pk, "name": "Vali Aliyev"})
        self.assertIs(rows[self.paired.pk]["lcup"], True)
        self.assertIs(rows[self.unpaired.pk]["lcup"], False)
        self.assertIsNone(rows[self.archived.pk]["teacher"])
        self.assertEqual(rows[self.archived.pk]["branch"], "")
        self.assertEqual(
            set(rows[self.paired.pk]),
            {"id", "name", "subject", "level", "teacher", "students", "lesson_days", "lesson_time", "room_number",
             "branch", "lcup", "is_active", "created_at"},
        )

    def test_the_other_facets(self):
        body = self.get(subject="MATH").json()
        self.assertEqual(self.ids(body), [self.unpaired.pk, self.paired.pk])
        self.assertEqual(self.facet(body, "subject"), {"ENGLISH": 1, "MATH": 2})
        self.assertEqual(self.facet(body, "level"), {"junior": 1, "untagged": 1})
        self.assertEqual(self.facet(body, "teacher"), {str(self.teacher.pk): 2})
        self.assertEqual(self.facet(body, "days"), {"EVEN": 1, "ODD": 1})
        self.assertEqual(self.ids(self.get(level="untagged").json()), [self.archived.pk, self.paired.pk])
        self.assertEqual(self.ids(self.get(teacher=self.teacher.pk, days="ODD").json()), [self.paired.pk])


class ClassroomChangeFormTests(ClassroomFixture):
    def url(self, room_id, part=None):
        return f"{URL}{room_id}/" + (f"{part}/" if part else "")

    def part(self, room, name):
        r = self.get(self.url(room.pk, name))
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_the_core_of_a_paired_class_names_the_fields_lcup_owns(self):
        r = self.get(self.url(self.paired.pk))
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(
            body["lcup"],
            {"managed": True, "group_name": "G21 Math lc-up", "status": "confirmed",
             "locked_fields": list(LCUP_OWNED_CLASS_FIELDS)},
        )
        self.assertEqual(body["teacher"], {"id": self.teacher.pk, "name": "Vali Aliyev"})
        self.assertEqual([t["id"] for t in body["tas"]], [self.ta.pk])
        self.assertEqual(body["students"], 2)
        self.assertIsNone(body["branch"])
        self.assertIsNone(body["start_date"])
        self.assertEqual((body["room_number"], body["lesson_days"], body["join_code"]),
                         ("205", "ODD", self.paired.join_code))

    def test_an_unpaired_class_has_no_lcup_block(self):
        self.assertIsNone(self.get(self.url(self.unpaired.pk)).json()["lcup"])

    def test_a_group_deleted_in_lcup_is_shown_but_no_longer_locks(self):
        LcupGroupLink.objects.filter(pk=self.link.pk).update(deleted_in_lcup_at=timezone.now())
        lcup = self.get(self.url(self.paired.pk)).json()["lcup"]
        self.assertEqual((lcup["managed"], lcup["locked_fields"]), (False, []))

    def test_the_roster_rates_and_debt(self):
        session_a = AttendanceSession.objects.create(classroom=self.paired, date=date(2026, 10, 1))
        session_b = AttendanceSession.objects.create(classroom=self.paired, date=date(2026, 10, 3))
        AttendanceRecord.objects.create(session=session_a, student=self.aziz, status=AttendanceRecord.STATUS_PRESENT)
        AttendanceRecord.objects.create(session=session_b, student=self.aziz, status=AttendanceRecord.STATUS_ABSENT)
        LcupStudentLink.objects.create(
            lcup_student_id=5, name="Karimova Malika", user=self.malika, status=LinkStatus.AUTO,
            balance=Decimal("-100000"),
        )
        hw = Assignment.objects.create(
            classroom=self.paired, created_by=self.teacher, title="HW1", category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED, due_at=timezone.now() - timedelta(days=1),
        )
        Submission.objects.create(assignment=hw, student=self.aziz, status=Submission.STATUS_SUBMITTED)

        students = {s["id"]: s for s in self.part(self.paired, "roster")["students"]}
        self.assertEqual(sorted(students), sorted([self.aziz.pk, self.malika.pk]))  # no TA, no removed seat
        aziz, malika = students[self.aziz.pk], students[self.malika.pk]
        self.assertEqual((aziz["attendance_rate"], aziz["owes"], aziz["homework_rate"]), (50.0, None, 100.0))
        self.assertEqual((malika["attendance_rate"], malika["owes"], malika["homework_rate"]), (None, 100000, 0.0))
        self.assertEqual((aziz["section"], aziz["username"], aziz["name"]), ("students", "aziz", "Aziz Tursunov"))

    def test_a_roster_with_nothing_published_has_no_homework_rate(self):
        student = self.part(self.unpaired, "roster")["students"][0]
        self.assertEqual((student["id"], student["homework_rate"], student["attendance_rate"]),
                         (self.solo.pk, None, None))

    def test_attendance_counts_each_session(self):
        session = AttendanceSession.objects.create(classroom=self.paired, date=date(2026, 10, 1))
        AttendanceRecord.objects.create(session=session, student=self.aziz, status=AttendanceRecord.STATUS_PRESENT)
        AttendanceRecord.objects.create(session=session, student=self.malika, status=AttendanceRecord.STATUS_ABSENT)
        AttendanceSession.objects.create(classroom=self.paired, date=date(2026, 10, 3))
        LcupAttendancePush.objects.create(group=self.link, date=date(2026, 10, 1), state=LcupAttendancePush.STATE_SENT)

        body = self.part(self.paired, "attendance")
        self.assertEqual([s["date"] for s in body["sessions"]], ["2026-10-03", "2026-10-01"])
        first = body["sessions"][1]
        self.assertEqual(
            first, {"date": "2026-10-01", "present": 1, "late": 0, "absent": 1, "excused": 0, "lcup_push": "sent"}
        )
        self.assertIsNone(body["sessions"][0]["lcup_push"])
        self.assertEqual(body["rate"], 50.0)

    def test_homework_counts_who_turned_it_in(self):
        hw = Assignment.objects.create(
            classroom=self.paired, created_by=self.teacher, title="HW2", category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED, due_at=timezone.now(),
        )
        Assignment.objects.create(
            classroom=self.paired, created_by=self.teacher, title="Draft", status=Assignment.STATUS_DRAFT,
        )
        Assignment.objects.create(
            classroom=self.paired, created_by=self.teacher, title="In class", category=Assignment.CATEGORY_CLASSWORK,
            status=Assignment.STATUS_PUBLISHED,
        )
        Submission.objects.create(assignment=hw, student=self.aziz, status=Submission.STATUS_SUBMITTED)
        Submission.objects.create(assignment=hw, student=self.malika, status=Submission.STATUS_DRAFT)

        rows = self.part(self.paired, "homework")["assignments"]
        self.assertEqual([(a["id"], a["title"], a["turned_in"], a["students"]) for a in rows], [(hw.pk, "HW2", 1, 2)])

    def test_history_lists_the_seats(self):
        body = self.part(self.paired, "history")
        titles = [i["title"] for i in body["items"]]
        self.assertIn("Added — Aziz Tursunov", titles)
        self.assertFalse(body["truncated"])

    def test_unknown_part_missing_class_and_a_teacher(self):
        self.assertEqual(self.get(self.url(self.paired.pk, "grades")).status_code, 404)
        self.assertEqual(self.get(self.url(999999)).status_code, 404)
        self.assertEqual(self.get(self.url(999999, "roster")).status_code, 404)
        self.assertEqual(self.get(self.url(self.paired.pk), user=self.teacher).status_code, 403)
        self.assertEqual(self.get(self.url(self.paired.pk, "roster"), user=self.teacher).status_code, 403)
