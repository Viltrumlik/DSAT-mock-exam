"""Classroom-flavor integration: assign -> students take -> panel -> publish -> ranked certs.

    python manage.py test midterms.tests_classroom --settings=config.settings_test_nomigrations
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from classes.models import Classroom, ClassroomMembership
from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from midterms.models import Midterm, MidtermOutcome
from midterms.tests_api import make_published_midterm, force_expire

User = get_user_model()


def open_window():
    """A start time that is already past, so the assigned midterm is open right now.

    Assigning is schedule-mandatory (a NULL ``starts_at`` means "open to the whole class
    immediately"), so every teacher assign in these tests has to carry a start.
    """
    return (timezone.now() - timedelta(minutes=5)).isoformat()


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

    def _assign(self, **extra):
        return self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/",
            {"midterm_id": self.mt.id, "starts_at": open_window(), **extra},
            format="json",
        )

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
        r = self._assign()
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
        self._assign()
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
        self._assign()
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
        self._assign()

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
        self._assign()
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

    def test_assign_without_a_start_time_is_refused(self):
        # The schedule is mandatory: a schedule with no starts_at is an exam open to the
        # whole class right now, so no teacher path may leave one behind.
        r = self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/", {"midterm_id": self.mt.id}, format="json"
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("starts_at", r.json())
        self.assertFalse(MidtermSchedule.objects.filter(classroom=self.room, midterm=self.mt).exists())

    def test_issuing_certificates_never_creates_an_open_schedule(self):
        # Certificate issuance used to get_or_create() the schedule with no defaults, which
        # manufactured a NULL-start (= wide open) row from a teacher endpoint.
        cid = self.room.id
        self._assign()
        self._take(self.s1, 4)
        self._take(self.s2, 2)
        MidtermSchedule.objects.filter(classroom=self.room, midterm=self.mt).delete()

        r = self.tc.post(
            f"/api/classes/{cid}/midterms-v2/{self.mt.id}/certificates/issue/", {}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(MidtermSchedule.objects.filter(classroom=self.room, midterm=self.mt).exists())
        # Results still reach the student: the issued classroom certificate is itself the
        # release signal, so refusing to create the row costs nothing.
        att = self.mt.attempts.filter(student=self.s1).first()
        from midterms.access import midterm_results_state

        self.assertTrue(midterm_results_state(att)["results_visible"])


class RetakeClassroomAssignTests(TestCase):
    """A retake is granted to the students who FAILED its parent — never to the whole class."""

    def setUp(self):
        self.teacher = User.objects.create(username="rt", email="rt@x.io", is_staff=True)
        self.failer = User.objects.create(username="f1", email="f1@x.io")
        self.passer = User.objects.create(username="p1", email="p1@x.io")
        self.absentee = User.objects.create(username="n1", email="n1@x.io")
        self.room = make_classroom(self.teacher)
        for s in (self.failer, self.passer, self.absentee):
            enroll(self.room, s)

        self.parent = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.parent.pass_mark = 60
        self.parent.save(update_fields=["pass_mark"])
        self.retake = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.retake.midterm_type = Midterm.TYPE_RETAKE
        self.retake.retake_of = self.parent
        self.retake.pass_mark = 60
        self.retake.save(update_fields=["midterm_type", "retake_of", "pass_mark"])

        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.failer, score=40, pass_mark=60, passed=False
        )
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.passer, score=90, pass_mark=60, passed=True
        )
        # self.absentee has no verdict at all — nothing to retake.
        self.tc = APIClient(); self.tc.force_authenticate(self.teacher)

    def _assign_retake(self):
        return self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/",
            {"midterm_id": self.retake.id, "starts_at": open_window()},
            format="json",
        )

    def _granted_ids(self, midterm):
        return set(
            ResourceAccessGrant.objects.filter(
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
                resource_id=midterm.id,
                classroom=self.room,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            ).values_list("user_id", flat=True)
        )

    def test_only_failers_are_granted_the_retake(self):
        r = self._assign_retake()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._granted_ids(self.retake), {self.failer.id})
        body = r.json()
        self.assertEqual(body["retake"], {"granted": 1, "skipped_passed": 1, "skipped_no_result": 1})
        self.assertIn("already passed", body["detail"])

    def test_a_student_who_passed_cannot_enter_the_retake(self):
        self._assign_retake()
        sched = MidtermSchedule.objects.get(classroom=self.room, midterm=self.retake)
        sched.generate_access_code()
        sched.save(update_fields=["access_code", "access_code_set_at"])

        c = APIClient(); c.force_authenticate(self.passer)
        r = c.post("/api/midterms/attempts/", {"midterm": self.retake.id}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

        c = APIClient(); c.force_authenticate(self.failer)
        r = c.post("/api/midterms/attempts/", {"midterm": self.retake.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_an_ordinary_midterm_still_goes_to_the_whole_class(self):
        r = self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/",
            {"midterm_id": self.parent.id, "starts_at": open_window()},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertNotIn("retake", r.json())
        self.assertEqual(
            self._granted_ids(self.parent), {self.failer.id, self.passer.id, self.absentee.id}
        )

    def test_a_retake_with_no_parent_degrades_to_an_ordinary_assignment(self):
        # An authoring mistake (retake type, no parent) must not lock the whole class out.
        orphan = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        orphan.midterm_type = Midterm.TYPE_RETAKE
        orphan.save(update_fields=["midterm_type"])
        r = self.tc.post(
            f"/api/classes/{self.room.id}/midterms-v2/assign/",
            {"midterm_id": orphan.id, "starts_at": open_window()},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(self._granted_ids(orphan)), 3)

    def test_only_failers_are_emailed_about_a_retake(self):
        from classes.mail_midterm import _recipients

        self._assign_retake()
        sched = MidtermSchedule.objects.get(classroom=self.room, midterm=self.retake)
        self.assertEqual([u.id for u in _recipients(sched)], [self.failer.id])
