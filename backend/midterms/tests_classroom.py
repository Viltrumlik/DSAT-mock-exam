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
from midterms.tests_api import make_published_midterm, force_expire

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

    def _start_midterm(self):
        """Teacher 'starts' the classroom midterm by generating its 6-digit access code.

        A classroom midterm can't be entered until this happens; returns the code.
        """
        sched = MidtermSchedule.objects.filter(classroom=self.room, midterm=self.mt).first()
        assert sched is not None, "schedule must exist (assign first)"
        if not sched.access_code:
            sched.generate_access_code()
            sched.save(update_fields=["access_code", "access_code_set_at"])
        return sched.access_code

    def _take(self, student, correct_n, code=None):
        c = APIClient(); c.force_authenticate(student)
        qids = [str(q.id) for q in self.mt.questions()]
        # Classroom midterms require the teacher-generated access code before they open.
        if code is None:
            code = self._start_midterm()
        r = c.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        assert r.status_code == 201, r.content
        aid = r.json()["id"]
        c.post(f"/api/midterms/attempts/{aid}/verify_code/", {"code": code}, format="json")
        c.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        ans = {qids[i]: ("a" if i < correct_n else "b") for i in range(4)}
        force_expire(aid)  # midterms only submit once the timer runs out
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

    def test_removed_student_excluded_from_ranking(self):
        # A student removed from the classroom (grant lingers) must NOT be ranked/certified,
        # and must not inflate the cohort size for the students who remain.
        cid = self.room.id
        self.tc.post(f"/api/classes/{cid}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json")
        self._take(self.s1, 4)  # 100
        self._take(self.s2, 2)  # 50 — will be removed
        ClassroomMembership.objects.filter(classroom=self.room, user=self.s2).update(
            status=ClassroomMembership.STATUS_REMOVED
        )
        # All *remaining* members finished, so no force needed.
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/certificates/issue/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["issued"], 1)  # only s1
        self.assertTrue(MidtermCertificate.objects.filter(midterm=self.mt, student=self.s1, flavor="CLASSROOM").exists())
        self.assertFalse(MidtermCertificate.objects.filter(midterm=self.mt, student=self.s2, flavor="CLASSROOM").exists())
        c_s1 = MidtermCertificate.objects.get(midterm=self.mt, student=self.s1, flavor="CLASSROOM")
        self.assertEqual(c_s1.rank, 1)
        self.assertEqual(c_s1.cohort_size, 1)  # removed s2 not counted

    def test_access_code_gate(self):
        cid = self.room.id
        self.tc.post(f"/api/classes/{cid}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json")

        # Teacher generates the 6-digit access code ("Start midterm").
        r = self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/start-code/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        code = r.json()["access_code"]
        self.assertRegex(code, r"^\d{6}$")
        wrong = "111111" if code != "111111" else "222222"

        # Student can create an attempt but can't start without the code.
        c = APIClient(); c.force_authenticate(self.s1)
        aid = c.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json").json()["id"]
        r = c.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.json().get("reason"), "code_required")

        # Wrong code is rejected and does not unlock start.
        r = c.post(f"/api/midterms/attempts/{aid}/verify_code/", {"code": wrong}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(c.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json").status_code, 403)

        # Correct code verifies → start now succeeds.
        r = c.post(f"/api/midterms/attempts/{aid}/verify_code/", {"code": code}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
        r = c.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_state"], "MODULE_1_ACTIVE")

    def test_no_attempt_until_teacher_generates_code(self):
        # Regression: an assigned (open-window) classroom midterm must NOT be enterable
        # until the teacher generates the access code. Previously a student could create
        # an attempt with no code and slip straight into the runner.
        cid = self.room.id
        self.tc.post(f"/api/classes/{cid}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json")
        c = APIClient(); c.force_authenticate(self.s1)

        # No code yet → creating an attempt is blocked, and the list marks it "awaiting code".
        r = c.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.json().get("error"), "midterm_no_code")
        row = next(x for x in c.get("/api/midterms/mine/").json()["results"] if x["midterm_id"] == self.mt.id)
        self.assertTrue(row["awaiting_code"])
        self.assertFalse(row["is_open"])

        # Teacher "starts" the midterm → code exists → the gate opens.
        self.tc.post(f"/api/classes/{cid}/midterms-v2/{self.mt.id}/start-code/", {}, format="json")
        r = c.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        row = next(x for x in c.get("/api/midterms/mine/").json()["results"] if x["midterm_id"] == self.mt.id)
        self.assertFalse(row["awaiting_code"])
        self.assertTrue(row["is_open"])
