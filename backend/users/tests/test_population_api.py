"""The admin's view of the split: kind on every user row, ?kind= on the list, the population card."""

from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from users import audience as A
from users.models import User


class PopulationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("a@example.com", password="x", username="adm", role="super_admin")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        User.objects.create_user(None, password=None, username="c", role=C.ROLE_STUDENT)
        User.objects.create_user(None, password=None, username="p", role=C.ROLE_PUBLIC_STUDENT)
        self.debtor = User.objects.create_user(None, password=None, username="d", role=C.ROLE_STUDENT)
        A.make_public(self.debtor, reason=A.REASON_LEFT_WITH_DEBT, source=A.SOURCE_SYNC, freeze_for_debt=True)

    def rows(self, **params):
        body = self.api.get("/api/users/admin/list/", params).json()
        return body["results"] if isinstance(body, dict) else body

    def test_counts(self):
        body = self.api.get("/api/users/admin/population/").json()
        self.assertEqual(
            (body["centre"], body["public"], body["frozen_debt"], body["frozen_admin"], body["left_30d"]),
            (1, 1, 1, 0, 1),
        )
        self.assertGreaterEqual(body["signups_30d"], 3)
        self.assertEqual(body["joined_30d"], 0)

    def test_kind_filter_and_field(self):
        rows = self.rows(kind="public")
        self.assertEqual([r["username"] for r in rows], ["p"])
        self.assertEqual(rows[0]["kind"], "public")
        self.assertEqual([r["username"] for r in self.rows(kind="frozen_debt")], ["d"])
        self.assertEqual([r["username"] for r in self.rows(kind="centre")], ["c"])

    def test_an_unknown_kind_narrows_to_nothing(self):
        self.assertEqual(self.rows(kind="nonsense"), [])

    def test_a_learner_cannot_read_the_population(self):
        api = APIClient()
        api.force_authenticate(User.objects.get(username="c"))
        self.assertEqual(api.get("/api/users/admin/population/").status_code, 403)

    def test_a_staff_freeze_is_the_staffs_and_never_reads_as_debt(self):
        resp = self.api.patch(f"/api/users/{self.debtor.pk}/update/", {"is_frozen": False}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.debtor.refresh_from_db()
        self.assertEqual((self.debtor.is_frozen, self.debtor.frozen_reason), (False, ""))
        self.api.patch(f"/api/users/{self.debtor.pk}/update/", {"is_frozen": True}, format="json")
        self.debtor.refresh_from_db()
        self.assertEqual(A.kind_of(self.debtor), "frozen_admin")

    def test_the_bulk_freeze_is_the_staffs_too(self):
        resp = self.api.post("/api/users/admin/bulk/", {"action": "unfreeze", "ids": [self.debtor.pk]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.debtor.refresh_from_db()
        self.assertEqual((self.debtor.is_frozen, self.debtor.frozen_reason), (False, ""))
