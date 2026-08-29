"""The reading a student does before the homework.

Two halves that have to agree, and the seam between them is where this feature can go wrong:

* AUTHORING (``/api/journals/…/roadmap/``) — admin-only, declarative about its sections;
* READING (``/api/classes/roadmap/<delivery>/reading/``) — a student, in their own class,
  who gets the homework id only once they have earned it.

The single rule worth stating out loud: **the homework id is WITHHELD, not hidden.** A button
the client decides not to draw is a button anybody can draw for themselves.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model

from access import constants as acc_const
from classes.models import ClassroomMembership
from journals import delivery, services
from journals.models import JournalRoadmapSection, RoadmapRead

from .test_delivery import DeliveryTestBase

User = get_user_model()


class RoadmapTestBase(DeliveryTestBase):
    def _roadmap_session(self, *, confirm=True):
        """A published session with two roadmap sections and released homework."""
        session = self._session()
        roadmap = services.ensure_roadmap(session)
        roadmap.title = "Linear equations"
        roadmap.summary = "Read this before the homework."
        roadmap.estimated_minutes = 8
        roadmap.require_read_confirmation = confirm
        roadmap.save()
        JournalRoadmapSection.objects.create(
            roadmap=roadmap, order=0, kind=JournalRoadmapSection.KIND_TEXT,
            heading="What a slope is", body="A slope is rise over run.",
        )
        JournalRoadmapSection.objects.create(
            roadmap=roadmap, order=1, kind=JournalRoadmapSection.KIND_VIDEO,
            heading="Worked example", video_url="https://youtu.be/abc123",
        )
        self._publish()
        return session

    def _deliver(self, session):
        delivery.release_homework(self.classroom, session, actor=self.teacher)
        from journals.models import ClassroomLesson

        return ClassroomLesson.objects.get(classroom=self.classroom, journal_lesson=session)


class AuthoringTests(RoadmapTestBase):
    def url(self, session):
        return f"/api/journals/{self.journal.id}/lessons/{session.id}/roadmap/"

    def test_a_session_starts_with_an_empty_roadmap_rather_than_a_404(self):
        """Created on first touch, like the classwork plan. A 404 would make the editor
        have to POST-then-PATCH to write one line."""
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.get(self.url(session))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["sections"], [])
        self.assertFalse(r.json()["has_content"])

    def test_the_section_list_is_declarative(self):
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.patch(self.url(session), {
            "title": "Slopes",
            "sections": [
                {"kind": "TEXT", "heading": "One", "body": "First paragraph."},
                {"kind": "TEXT", "heading": "Two", "body": "Second paragraph."},
            ],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([s["heading"] for s in r.json()["sections"]], ["One", "Two"])

        # Sending a shorter list DELETES what it leaves out.
        keep = r.json()["sections"][1]["id"]
        r = self.client.patch(self.url(session), {
            "sections": [{"id": keep, "kind": "TEXT", "body": "Second paragraph."}],
        }, format="json")
        self.assertEqual([s["id"] for s in r.json()["sections"]], [keep])

    def test_order_comes_from_the_list_position(self):
        """A client sending its own numbers can send two of the same, and the tie is broken
        by primary key — which puts a paragraph moved to the top back at the bottom."""
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.patch(self.url(session), {"sections": [
            {"kind": "TEXT", "body": "A"}, {"kind": "TEXT", "body": "B"},
        ]}, format="json")
        first, second = [s["id"] for s in r.json()["sections"]]
        r = self.client.patch(self.url(session), {"sections": [
            {"id": second, "kind": "TEXT", "body": "B"},
            {"id": first, "kind": "TEXT", "body": "A"},
        ]}, format="json")
        self.assertEqual([s["id"] for s in r.json()["sections"]], [second, first])
        self.assertEqual([s["order"] for s in r.json()["sections"]], [0, 1])

    def test_a_video_link_must_be_http(self):
        """This view writes sections with `objects.create`/`update`, and neither runs model
        field validation — so the URLField on the column is documentation, not a guard. The
        value ends up in a `src` attribute on a student's page."""
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.patch(
            self.url(session),
            {"sections": [{"kind": "VIDEO", "video_url": "javascript:alert(1)"}]},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_an_ordinary_video_link_is_kept(self):
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.patch(
            self.url(session),
            {"sections": [{"kind": "VIDEO", "video_url": "https://youtu.be/abc123"}]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["sections"][0]["video_url"], "https://youtu.be/abc123")

    def test_an_unknown_kind_is_refused(self):
        session = self._session()
        self.client.force_authenticate(self.admin)
        r = self.client.patch(
            self.url(session), {"sections": [{"kind": "PODCAST"}]}, format="json"
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_midterm_session_has_no_roadmap(self):
        """A midterm is a sitting, not a topic — there is nothing to read beforehand."""
        session = self._session()
        session.lesson_type = session.TYPE_MIDTERM
        session.save(update_fields=["lesson_type"])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.url(session)).status_code, 400)

    def test_a_student_cannot_reach_the_authoring_endpoint(self):
        session = self._session()
        self.client.force_authenticate(self.student)
        self.assertIn(self.client.get(self.url(session)).status_code, (401, 403))

    def test_an_empty_roadmap_does_not_block_publishing(self):
        """The reading is OPTIONAL. A session that is pure practice has nothing to read, and
        refusing to publish it would make this feature a tax on every existing journal."""
        session = self._session()
        services.ensure_roadmap(session)
        self.assertEqual(session.roadmap_validation_reasons(), [])
        self.assertEqual(session.validation_reasons(), [])

    def test_a_half_written_section_does_block_publishing(self):
        session = self._session()
        roadmap = services.ensure_roadmap(session)
        JournalRoadmapSection.objects.create(
            roadmap=roadmap, order=0, kind=JournalRoadmapSection.KIND_TEXT, heading="Title only"
        )
        session.refresh_from_db()
        self.assertTrue(session.roadmap_validation_reasons())

    def test_duplicating_a_journal_brings_the_roadmap_with_it(self):
        """A duplicate that silently loses one of the three authored blocks is worse than one
        that fails — nobody notices until a student opens an empty page."""
        session = self._roadmap_session()
        target, _report = services.duplicate_journal(
            self.journal, target_subject="MATH", target_level="senior", actor=self.admin
        )
        copied = target.lessons.get(lesson_number=session.lesson_number)
        self.assertEqual(copied.roadmap.title, "Linear equations")
        self.assertEqual(
            [s.kind for s in copied.roadmap.sections.all()], ["TEXT", "VIDEO"]
        )


class ReadingTests(RoadmapTestBase):
    def url(self, delivery_row):
        return f"/api/classes/roadmap/{delivery_row.id}/reading/"

    def test_the_student_reads_the_sections_in_order(self):
        session = self._roadmap_session()
        row = self._deliver(session)
        self.client.force_authenticate(self.student)
        body = self.client.get(self.url(row)).json()
        self.assertEqual(body["title"], "Linear equations")
        self.assertEqual(body["estimated_minutes"], 8)
        self.assertEqual([s["kind"] for s in body["sections"]], ["TEXT", "VIDEO"])

    def test_the_homework_is_withheld_until_they_confirm(self):
        session = self._roadmap_session()
        row = self._deliver(session)
        self.client.force_authenticate(self.student)
        before = self.client.get(self.url(row)).json()
        self.assertTrue(before["homework_released"])
        self.assertFalse(before["read"])
        # Released, and still not sent: withheld on the server, not hidden in the client.
        self.assertIsNone(before["homework_assignment_id"])

        after = self.client.post(self.url(row)).json()
        self.assertTrue(after["read"])
        self.assertEqual(after["homework_assignment_id"], row.assignment_id)

    def test_an_author_can_switch_the_confirmation_off(self):
        session = self._roadmap_session(confirm=False)
        row = self._deliver(session)
        self.client.force_authenticate(self.student)
        body = self.client.get(self.url(row)).json()
        self.assertEqual(body["homework_assignment_id"], row.assignment_id)

    def test_confirming_twice_is_one_row_and_not_an_error(self):
        session = self._roadmap_session()
        row = self._deliver(session)
        self.client.force_authenticate(self.student)
        self.client.post(self.url(row))
        r = self.client.post(self.url(row))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(RoadmapRead.objects.filter(classroom_lesson=row).count(), 1)

    def test_reading_it_does_not_unlock_homework_that_was_never_released(self):
        session = self._roadmap_session()
        from journals.models import ClassroomLesson

        row = ClassroomLesson.objects.create(
            classroom=self.classroom, journal_lesson=session,
            lesson_number=session.lesson_number,
        )
        self.client.force_authenticate(self.student)
        body = self.client.post(self.url(row)).json()
        self.assertTrue(body["read"])
        self.assertFalse(body["homework_released"])
        self.assertIsNone(body["homework_assignment_id"])

    def test_a_student_from_another_class_gets_a_404(self):
        """404, not 403 — they should not learn that a lesson with this id exists, and to
        them the two answers are the same thing anyway."""
        session = self._roadmap_session()
        row = self._deliver(session)
        outsider = User.objects.create_user(
            email="rm_outsider@test.com", password="x", role=acc_const.ROLE_STUDENT
        )
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url(row)).status_code, 404)
        self.assertEqual(self.client.post(self.url(row)).status_code, 404)

    def test_a_removed_student_loses_access(self):
        session = self._roadmap_session()
        row = self._deliver(session)
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url(row)).status_code, 404)

    def test_an_invited_student_may_still_read(self):
        """The rule stated on ClassroomMembership: any query deciding whether a user may see
        a classroom excludes REMOVED and nothing else. They can already see the assignment
        list, so withholding the reading that explains it would be the odd one out."""
        session = self._roadmap_session()
        row = self._deliver(session)
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_INVITED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(self.url(row)).status_code, 200)


class RoadmapOnTheLadderTests(RoadmapTestBase):
    def test_the_ladder_says_which_lessons_have_reading_and_which_were_read(self):
        session = self._roadmap_session()
        row = self._deliver(session)
        self.client.force_authenticate(self.student)

        payload = self.client.get("/api/classes/roadmap/").json()
        track = [t for t in payload["tracks"] if t["subject"] == "math"][0]
        own = [lv for lv in track["levels"] if lv["is_own_level"]][0]
        lesson = [l for l in own["lessons"] if l["lesson_number"] == session.lesson_number][0]
        self.assertTrue(lesson["has_roadmap"])
        self.assertFalse(lesson["roadmap_read"])
        self.assertEqual(lesson["delivery_id"], row.id)

        self.client.post(f"/api/classes/roadmap/{row.id}/reading/")
        payload = self.client.get("/api/classes/roadmap/").json()
        track = [t for t in payload["tracks"] if t["subject"] == "math"][0]
        own = [lv for lv in track["levels"] if lv["is_own_level"]][0]
        lesson = [l for l in own["lessons"] if l["lesson_number"] == session.lesson_number][0]
        self.assertTrue(lesson["roadmap_read"])

    def test_a_locked_level_never_carries_a_delivery_id(self):
        """The omission IS the boundary — there is nothing to open and nothing to mark."""
        self._roadmap_session()
        self.client.force_authenticate(self.student)
        payload = self.client.get("/api/classes/roadmap/").json()
        track = [t for t in payload["tracks"] if t["subject"] == "math"][0]
        for level in track["levels"]:
            if level["is_own_level"]:
                continue
            for lesson in level["lessons"]:
                self.assertNotIn("delivery_id", lesson)
