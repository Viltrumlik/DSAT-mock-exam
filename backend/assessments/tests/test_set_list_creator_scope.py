"""Set-list creator scoping + creator attribution + delete audit.

- A test_admin only sees / can open the AssessmentSets THEY authored.
- super_admin (and admin) see every author's sets; only super_admin gets the
  creator fields in the list payload.
- Deleting a set emits an immutable GovernanceEvent naming the deleter, so a
  future "who deleted this set?" question is answerable (previously nothing was
  recorded).
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet, GovernanceEvent

User = get_user_model()


def _mk_set(owner, title, subject="math"):
    return AssessmentSet.objects.create(
        subject=subject, category="Algebra", title=title,
        source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=owner,
    )


def _rows(resp):
    data = resp.data
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


class SetListCreatorScopeTests(TestCase):
    def setUp(self):
        self.super_admin = User.objects.create_user("sa_scope@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN)
        self.admin = User.objects.create_user("ad_scope@test.com", "secret123", role=acc_const.ROLE_ADMIN)
        self.ta1 = User.objects.create_user("ta1_scope@test.com", "secret123", role=acc_const.ROLE_TEST_ADMIN)
        self.ta2 = User.objects.create_user("ta2_scope@test.com", "secret123", role=acc_const.ROLE_TEST_ADMIN)
        self.s_sa = _mk_set(self.super_admin, "SA set")
        self.s_ta1 = _mk_set(self.ta1, "TA1 set")
        self.s_ta2 = _mk_set(self.ta2, "TA2 set")

    def _list(self, user):
        c = APIClient()
        c.force_authenticate(user)
        r = c.get("/api/assessments/admin/sets/")
        self.assertEqual(r.status_code, 200, r.content)
        return _rows(r)

    def test_test_admin_sees_only_own_sets(self):
        ids = {row["id"] for row in self._list(self.ta1)}
        self.assertEqual(ids, {self.s_ta1.id})

    def test_super_admin_sees_all_sets(self):
        ids = {row["id"] for row in self._list(self.super_admin)}
        self.assertTrue({self.s_sa.id, self.s_ta1.id, self.s_ta2.id} <= ids)

    def test_admin_sees_all_sets(self):
        ids = {row["id"] for row in self._list(self.admin)}
        self.assertTrue({self.s_sa.id, self.s_ta1.id, self.s_ta2.id} <= ids)

    def test_super_admin_gets_creator_fields(self):
        rows = {row["id"]: row for row in self._list(self.super_admin)}
        self.assertEqual(rows[self.s_ta1.id]["created_by_email"], "ta1_scope@test.com")
        self.assertTrue(rows[self.s_ta1.id].get("created_by_name"))

    def test_admin_does_not_get_creator_fields(self):
        rows = {row["id"]: row for row in self._list(self.admin)}
        self.assertIsNone(rows[self.s_ta1.id]["created_by_email"])
        self.assertIsNone(rows[self.s_ta1.id]["created_by_name"])

    def test_test_admin_cannot_open_other_authors_set(self):
        c = APIClient()
        c.force_authenticate(self.ta1)
        self.assertEqual(c.get(f"/api/assessments/admin/sets/{self.s_ta2.id}/").status_code, 404)
        # ...but can open their own.
        self.assertEqual(c.get(f"/api/assessments/admin/sets/{self.s_ta1.id}/").status_code, 200)

    def test_test_admin_cannot_delete_other_authors_set(self):
        c = APIClient()
        c.force_authenticate(self.ta1)
        self.assertEqual(c.delete(f"/api/assessments/admin/sets/{self.s_ta2.id}/").status_code, 404)
        self.assertTrue(AssessmentSet.objects.filter(pk=self.s_ta2.id).exists())

    def test_test_admin_cannot_mutate_other_authors_set_via_sibling_endpoints(self):
        """Isolation must cover the question/reorder/publish endpoints too, not just
        list + set detail — otherwise a test_admin could tamper with another author's
        set by guessing its id."""
        c = APIClient()
        c.force_authenticate(self.ta1)
        other = self.s_ta2.id
        # add a question to Bob's set
        self.assertEqual(
            c.post(f"/api/assessments/admin/sets/{other}/questions/", {}, format="json").status_code, 404
        )
        # reorder Bob's set
        self.assertEqual(
            c.post(f"/api/assessments/admin/sets/{other}/questions/reorder/",
                   {"ordered_ids": []}, format="json").status_code, 404
        )
        # publish Bob's set
        self.assertEqual(
            c.post(f"/api/assessments/admin/sets/{other}/publish/", {}, format="json").status_code, 404
        )
        # version history + validate for Bob's set
        self.assertEqual(c.get(f"/api/assessments/admin/sets/{other}/versions/").status_code, 404)
        self.assertEqual(c.get(f"/api/assessments/admin/sets/{other}/validate-publish/").status_code, 404)
        # ...but ta1 CAN add a question to their OWN set (guard doesn't over-block).
        self.assertNotEqual(
            c.post(f"/api/assessments/admin/sets/{self.s_ta1.id}/questions/reorder/",
                   {"ordered_ids": []}, format="json").status_code, 404
        )


class SetDeleteAuditTests(TestCase):
    def setUp(self):
        self.super_admin = User.objects.create_user("del_audit@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN)

    def test_delete_emits_governance_event_naming_the_deleter(self):
        s = _mk_set(self.super_admin, "Doomed set")
        c = APIClient()
        c.force_authenticate(self.super_admin)
        r = c.delete(f"/api/assessments/admin/sets/{s.id}/")
        self.assertEqual(r.status_code, 204, r.content)
        self.assertFalse(AssessmentSet.objects.filter(pk=s.id).exists())

        ev = GovernanceEvent.objects.filter(
            event_type=GovernanceEvent.EVENT_SET_DELETE, entity_type="AssessmentSet", entity_id=s.id,
        ).first()
        self.assertIsNotNone(ev, "set deletion must be audited")
        self.assertEqual(ev.actor_id, self.super_admin.id)
        self.assertEqual(ev.actor_email, "del_audit@test.com")
        self.assertEqual(ev.payload.get("title"), "Doomed set")
        self.assertFalse(ev.payload.get("force"))
