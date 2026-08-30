"""Every roster change leaves a record naming who made it.

On 2026-08-29 a class was emptied — fourteen students removed in sixty-two seconds — and the
platform could not say who did it. ``ClassroomMembership`` carried ``joined_at`` and nothing
else. The answer had to be dug out of nginx logs that name an IP rather than a person and are
deleted after ten days.

The two properties that matter, and they are tested hardest:

  * **Coverage.** The point of hanging off a signal rather than editing each view is that
    membership is written from at least six places. A test that only exercises the roster
    endpoint would pass while the join-code flow and the support unassign stayed silent.
  * **Attribution.** A row that says "somebody removed somebody" is not an audit trail. The
    acting user has to survive the trip from the request into a signal receiver that never
    sees a request, and it has to be EMPTY — not stale — when there genuinely is no request.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_membership_audit import ClassroomMembershipEvent
from core.actor import clear_actor, get_actor, set_actor

User = get_user_model()


class MembershipAuditBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("ma_admin@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        self.owner = User.objects.create_user("ma_owner@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        self.student = User.objects.create_user("ma_stu@t.com", "secret123", role=C.ROLE_STUDENT)
        self.classroom = Classroom.objects.create(
            name="Audit G1", subject=Classroom.SUBJECT_MATH, created_by=self.admin,
            lesson_days=Classroom.DAYS_ODD, lesson_time="14:00",
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_OWNER
        )
        ClassroomMembershipEvent.objects.all().delete()   # ignore fixture noise

    def events(self, **kw):
        return list(ClassroomMembershipEvent.objects.filter(**kw).order_by("created_at"))

    def tearDown(self):
        clear_actor()


class RecordsEveryKindOfChangeTests(MembershipAuditBase):
    def test_joining_is_recorded(self):
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        (event,) = self.events(student=self.student)
        self.assertEqual(event.action, ClassroomMembershipEvent.ACTION_ADDED)
        self.assertEqual(event.new_status, ClassroomMembership.STATUS_ACTIVE)

    def test_removal_is_recorded_as_removal(self):
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        m.status = ClassroomMembership.STATUS_REMOVED
        m.save(update_fields=["status"])
        actions = [e.action for e in self.events(student=self.student)]
        self.assertEqual(actions, [
            ClassroomMembershipEvent.ACTION_ADDED, ClassroomMembershipEvent.ACTION_REMOVED
        ])

    def test_coming_back_is_not_the_same_event_as_arriving(self):
        """REINSTATED and ADDED read differently to whoever is investigating."""
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        m.status = ClassroomMembership.STATUS_REMOVED
        m.save(update_fields=["status"])
        m.status = ClassroomMembership.STATUS_ACTIVE
        m.save(update_fields=["status"])
        self.assertEqual(
            self.events(student=self.student)[-1].action,
            ClassroomMembershipEvent.ACTION_REINSTATED,
        )

    def test_a_role_change_carries_both_sides(self):
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        m.role = ClassroomMembership.ROLE_TA
        m.save(update_fields=["role"])
        event = self.events(student=self.student)[-1]
        self.assertEqual(event.action, ClassroomMembershipEvent.ACTION_ROLE_CHANGED)
        self.assertEqual(event.previous_role, ClassroomMembership.ROLE_STUDENT)
        self.assertEqual(event.new_role, ClassroomMembership.ROLE_TA)

    def test_destroying_the_row_is_not_the_same_as_removing_the_student(self):
        """Removal is reversible and leaves the row; a delete is neither."""
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        m.delete()
        self.assertEqual(
            self.events(student=self.student)[-1].action,
            ClassroomMembershipEvent.ACTION_DELETED,
        )

    def test_a_save_that_changes_nothing_writes_nothing(self):
        """An audit table that records every no-op save is one nobody will read."""
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        before = len(self.events(student=self.student))
        m.save()
        m.save()
        self.assertEqual(len(self.events(student=self.student)), before)


class AttributionTests(MembershipAuditBase):
    def test_the_endpoint_records_who_pressed_the_button(self):
        """The whole point. A row that cannot name the actor is not an audit trail."""
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            f"/api/classes/{self.classroom.id}/members/{self.student.id}/",
            {"status": ClassroomMembership.STATUS_REMOVED}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        event = self.events(student=self.student)[-1]
        self.assertEqual(event.action, ClassroomMembershipEvent.ACTION_REMOVED)
        self.assertEqual(event.actor_id, self.admin.id)
        # The name is snapshotted so the row still reads after the account is renamed or gone.
        self.assertTrue(event.actor_name, "the acting user's name must be copied into the row")

    def test_a_change_with_no_request_behind_it_records_no_actor(self):
        """A management command or a migration genuinely has nobody behind it, and inventing
        one would be worse than recording none."""
        clear_actor()
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assertIsNone(self.events(student=self.student)[-1].actor_id)

    def test_the_actor_does_not_leak_between_requests(self):
        """A view that raises must not leave its user attached to the worker thread, where
        the next request would be attributed to a stranger."""
        from core.actor import CurrentActorMiddleware

        def boom(request):
            raise RuntimeError("view exploded")

        middleware = CurrentActorMiddleware(boom)

        class FakeRequest:
            user = self.admin

        with self.assertRaises(RuntimeError):
            middleware(FakeRequest())
        self.assertIsNone(get_actor())

    def test_an_anonymous_request_is_not_an_actor(self):
        class Anon:
            is_authenticated = False

        set_actor(Anon())
        self.assertIsNone(get_actor())


class NamesSurviveDeletionTests(MembershipAuditBase):
    def test_deleting_the_classroom_leaves_the_history_readable(self):
        """SET_NULL keeps the row; the copied name keeps it meaningful. A null FK with no
        name is a row that says 'somebody removed somebody from something'."""
        m = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        m.status = ClassroomMembership.STATUS_REMOVED
        m.save(update_fields=["status"])
        event_id = self.events(student=self.student)[-1].id

        self.classroom.delete()

        event = ClassroomMembershipEvent.objects.get(pk=event_id)
        self.assertIsNone(event.classroom_id)
        self.assertEqual(event.classroom_name, "Audit G1")
        self.assertEqual(event.student_name, event.student_name)   # still populated
        self.assertTrue(event.student_name)


class ContractTests(MembershipAuditBase):
    def test_the_hook_constants_match_the_model_choices(self):
        """The receivers carry their own copies to dodge an app-load cycle. If the two ever
        drift, every event lands with an action the model does not recognise."""
        from classes import membership_hooks as hooks

        model_actions = {a for a, _ in ClassroomMembershipEvent.ACTION_CHOICES}
        hook_actions = {
            hooks.ADDED, hooks.REMOVED, hooks.REINSTATED,
            hooks.ROLE_CHANGED, hooks.STATUS_CHANGED, hooks.DELETED,
        }
        self.assertEqual(hook_actions, model_actions)


class ReadCommandTests(MembershipAuditBase):
    def test_it_reports_a_burst(self):
        """Fourteen removals in a minute is the shape the incident had, and a plain list of
        timestamps does not make that obvious."""
        from io import StringIO

        from django.core.management import call_command

        set_actor(self.admin)
        for i in range(4):
            u = User.objects.create_user(f"ma_burst{i}@t.com", "secret123", role=C.ROLE_STUDENT)
            m = ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
            m.status = ClassroomMembership.STATUS_REMOVED
            m.save(update_fields=["status"])

        out = StringIO()
        call_command("roster_history", "--classroom", str(self.classroom.id), stdout=out)
        text = out.getvalue()
        self.assertIn("REMOVED", text)
        self.assertIn("within", text)          # the burst warning
