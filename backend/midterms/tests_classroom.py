"""Classroom-flavor integration: assign -> students take -> panel -> publish -> ranked certs.

    python manage.py test midterms.tests_classroom --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from midterms.models import Midterm
from midterms.tests_api import make_published_midterm

User = get_user_model()


def make_classroom(teacher):
    room = Classroom.objects.create(
        name="ENG-101",
        subject=Classroom.SUBJECT_ENGLISH,  # -> midterm subject READING_WRITING
        level="junior",
        description="x",
        lesson_days="ODD",
        teacher=teacher,
        created_by=teacher,
    )
    ClassroomMembership.objects.create(
        classroom=room, user=teacher, role=ClassroomMembership.ROLE_TEACHER,
        status=ClassroomMembership.STATUS_ACTIVE,
    )
    return room


def enroll(room, student):
    ClassroomMembership.objects.create(
        classroom=room, user=student, role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    )


class ClassroomMidtermTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="teach", email="teach@x.io", is_staff=True)
        self.s1 = User.objects.create(username="a1", email="a1@x.io")
        self.s2 = User.objects.create(username="a2", email="a2@x.io")
        self.room = make_classroom(self.teacher)
        enroll(self.room, self.s1)
        enroll(self.room, self.s2)
        self.mt = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.tc = APIClient(); self.tc.force_authenticate(self.teacher)

    def _take(self, student, correct_n):
        c = APIClient(); c.force_authenticate(student)
        qids = [str(q.id) for q in self.mt.questions()]
        r = c.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        assert r.status_code == 201, r.content
        aid = r.json()["id"]
        c.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        ans = {qids[i]: ("a" if i < correct_n else "b") for i in range(4)}
        c.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": ans}, format="json")
        return c, aid

    def test_full_classroom_flow(self):
        cid = self.room.id
        # Assign to the whole class.
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(MidtermSchedule.objects.filter(classroom=self.room, midterm=self.mt).exists())

        # The "given midterms" list surfaces the newly-assigned midterm.
        gl = self.tc.get(f"/api/classes/{cid}/midterms-v2/")
        self.assertEqual(gl.status_code, 200, gl.content)
        self.assertTrue(any(x["midterm_id"] == self.mt.id for x in gl.json()["midterms"]))

        # Students take it (s1: 4/4=100, s2: 2/4=50).
        c1, a1 = self._take(self.s1, 4)
        c2, a2 = self._take(self.s2, 2)

        # Before publish: score is gated for the student.
        r = c1.get(f"/api/midterms/attempts/{a1}/review/")
        self.assertFalse(r.json()["released"])
        self.assertNotIn("total_score", r.json())
        # my-midterms hides the score too
        mine = c1.get("/api/midterms/mine/").json()["results"]
        row = next(x for x in mine if x["midterm_id"] == self.mt.id)
        self.assertEqual(row["flavor"], "CLASSROOM")
        self.assertTrue(row["submitted"])
        self.assertIsNone(row["score"])

        # Teacher panel shows the roster with scores + all finished.
        r = self.tc.get(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/panel/")
        self.assertEqual(r.status_code, 200, r.content)
        panel = r.json()
        self.assertTrue(panel["all_finished"])
        self.assertEqual(panel["stats"]["completed"], 2)
        self.assertEqual(panel["stats"]["highest"], 100)

        # Publish -> issue class-ranked certificates + release results.
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/certificates/issue/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["issued"], 2)
        c_s1 = MidtermCertificate.objects.get(midterm=self.mt, student=self.s1, flavor="CLASSROOM")
        c_s2 = MidtermCertificate.objects.get(midterm=self.mt, student=self.s2, flavor="CLASSROOM")
        self.assertEqual(c_s1.rank, 1)  # top score
        self.assertEqual(c_s2.rank, 2)
        self.assertEqual(c_s1.cohort_size, 2)
        self.assertTrue(MidtermSchedule.objects.get(classroom=self.room, midterm=self.mt).results_released)

        # After publish: student sees released score + rank.
        r = c1.get(f"/api/midterms/attempts/{a1}/review/")
        body = r.json()
        self.assertTrue(body["released"])
        self.assertEqual(body["total_score"], 100)
        self.assertEqual(body["certificate"]["rank"], 1)
        self.assertEqual(body["certificate"]["cohort_size"], 2)

    def test_issue_blocked_until_all_finished(self):
        cid = self.room.id
        self.tc.post(f"/api/classes/{cid}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json")
        self._take(self.s1, 4)  # only s1 finishes
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/certificates/issue/", {}, format="json")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()["reason"], "not_all_finished")
        self.assertEqual(r.json()["remaining"], 1)
        # force issues anyway
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/certificates/issue/?force=1", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["issued"], 1)
