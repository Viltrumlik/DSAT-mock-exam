"""The seating endpoint: preview, commit, reload, and the ways it must refuse.

The generator is proved in ``tests_seating``. What is proved here is that the chart the
teacher sees is the chart that gets stored, that reopening the panel returns the SAME room,
and that the endpoint will not persist an arrangement it cannot defend — including one a
hand-written payload proposes.

    python manage.py test midterms.tests_seating_api --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from midterms.models import Midterm, MidtermAttempt, MidtermVersion, MidtermVersionAssignment
from midterms.seating import SEATS_PER_DESK, version_index_for
from midterms.tests_api import grant
from midterms.tests_classroom import enroll, make_classroom
from midterms.tests_versions import _add_version

User = get_user_model()


class SeatingApiTests(TestCase):
    """A room of 18 students, 4 versions, 3 desks per row — the shape the user described."""

    COHORT = 18
    VERSIONS = 4

    def setUp(self):
        self.teacher = User.objects.create(username="seat-teach", email="st@x.io", is_staff=True)
        self.room = make_classroom(self.teacher)
        self.mt = Midterm.objects.create(
            title="Seated Midterm", subject=Midterm.READING_WRITING,
            scoring_scale=Midterm.SCALE_100, duration_minutes=30, is_published=True,
        )
        self.versions = [
            _add_version(self.mt, n, key)
            for n, key in enumerate("abcd"[: self.VERSIONS], start=1)
        ]
        self.students = []
        for i in range(self.COHORT):
            s = User.objects.create(username=f"seat-s{i:02d}", email=f"s{i:02d}@x.io", first_name=f"Student{i:02d}")
            enroll(self.room, s)
            grant(s, self.mt, classroom=self.room)
            self.students.append(s)
        self.api = APIClient()
        self.api.force_authenticate(self.teacher)
        self.url = f"/api/classes/{self.room.id}/midterms-v2/{self.mt.id}/versions/"

    # ── helpers ──────────────────────────────────────────────────────────────

    def _preview(self, **body):
        return self.api.post(self.url, {"action": "preview", **body}, format="json")

    def _commit_from(self, seating, *, columns=3, **overrides):
        seats = [
            {"student_id": s["student_id"], "version_id": s["version_id"], "row": d["row"], "col": s["seat_col"]}
            for d in seating["desks"] for s in d["seats"] if s["student_id"]
        ]
        return self.api.post(
            self.url, {"action": "commit", "columns": columns, "seats": seats, **overrides}, format="json"
        )

    def _neighbour_check(self, seating):
        """No horizontal or vertical neighbour shares a version, read off the response."""
        by_pos = {
            (d["row"], s["seat_col"]): s
            for d in seating["desks"] for s in d["seats"] if s["student_id"]
        }
        for (row, col), seat in by_pos.items():
            for d_row, d_col in ((0, 1), (1, 0)):
                other = by_pos.get((row + d_row, col + d_col))
                if other is not None:
                    self.assertNotEqual(
                        seat["version_id"], other["version_id"],
                        f"({row},{col}) and ({row + d_row},{col + d_col}) share a version",
                    )

    # ── preview ──────────────────────────────────────────────────────────────

    def test_preview_returns_a_full_grid_and_saves_nothing(self):
        data = self._preview(columns=3).json()
        seating = data["seating"]
        self.assertEqual((seating["rows"], seating["columns"], seating["desk_count"]), (3, 3, 9))
        self.assertEqual(seating["student_count"], self.COHORT)
        self.assertEqual(len(data["assignments"]), self.COHORT)
        self._neighbour_check(seating)
        self.assertEqual(MidtermVersionAssignment.objects.count(), 0)

    def test_preview_pairs_every_student_with_a_desk_partner(self):
        # "The system itself decides who sits with whom."
        seating = self._preview(columns=3).json()["seating"]
        for desk in seating["desks"]:
            left, right = desk["seats"]
            self.assertIsNotNone(left["student_id"], f"desk {desk['desk_number']} has no one on the left")
            self.assertIsNotNone(right["student_id"])
            self.assertNotEqual(left["version_id"], right["version_id"])

    def test_reshuffling_moves_people_but_never_breaks_the_pattern(self):
        seen = set()
        for _ in range(6):
            seating = self._preview(columns=3).json()["seating"]
            self._neighbour_check(seating)
            seen.add(tuple(
                s["student_id"] for d in seating["desks"] for s in d["seats"]
            ))
        self.assertGreater(len(seen), 1, "re-shuffle produced the same chart every time")

    def test_four_versions_produce_the_expected_split(self):
        seating = self._preview(columns=3).json()["seating"]
        self.assertEqual(sorted(seating["version_counts"].values()), [4, 4, 5, 5])
        self.assertEqual(seating["warnings"], [])

    def test_columns_change_the_room_shape(self):
        seating = self._preview(columns=5).json()["seating"]
        self.assertEqual((seating["columns"], seating["rows"], seating["desk_count"]), (5, 2, 9))
        self._neighbour_check(seating)

    # ── commit + reload ──────────────────────────────────────────────────────

    def test_commit_persists_seats_and_a_reload_returns_the_identical_chart(self):
        previewed = self._preview(columns=3).json()["seating"]
        res = self._commit_from(previewed)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(MidtermVersionAssignment.objects.count(), self.COHORT)

        reloaded = self.api.get(self.url).json()["seating"]
        self.assertEqual(_chart(reloaded), _chart(previewed))
        self.assertEqual(reloaded["columns"], previewed["columns"])
        self.assertEqual(reloaded["rows"], previewed["rows"])

    def test_a_committed_plan_holds_the_invariant_when_read_back_from_the_database(self):
        self._commit_from(self._preview(columns=3).json()["seating"])
        self._neighbour_check(self.api.get(self.url).json()["seating"])

    def test_committed_seats_match_what_the_database_stores(self):
        seating = self._preview(columns=3).json()["seating"]
        self._commit_from(seating)
        stored = {a.student_id: (a.seat_row, a.seat_col, a.version_id)
                  for a in MidtermVersionAssignment.objects.all()}
        for desk in seating["desks"]:
            for seat in desk["seats"]:
                if seat["student_id"]:
                    self.assertEqual(
                        stored[seat["student_id"]], (desk["row"], seat["seat_col"], seat["version_id"])
                    )

    def test_a_non_default_column_count_round_trips(self):
        self._commit_from(self._preview(columns=4).json()["seating"], columns=4)
        self.assertEqual(self.api.get(self.url).json()["seating"]["columns"], 4)

    def test_the_roster_panel_reports_each_students_seat(self):
        self._commit_from(self._preview(columns=3).json()["seating"])
        panel = self.api.get(f"/api/classes/{self.room.id}/midterms-v2/{self.mt.id}/panel/").json()
        rows = {r["student_id"]: r for r in panel["students"]}
        stored = MidtermVersionAssignment.objects.first()
        row = rows[stored.student_id]
        self.assertEqual((row["seat_row"], row["seat_col"]), (stored.seat_row, stored.seat_col))
        self.assertEqual(row["side"], stored.seat_col % SEATS_PER_DESK)
        self.assertEqual(row["desk_number"], stored.seat_row * 3 + stored.seat_col // SEATS_PER_DESK + 1)

    def test_recommitting_clears_a_removed_students_stale_seat(self):
        self._commit_from(self._preview(columns=3).json()["seating"])
        ghost = self.students[0]
        # The student leaves the class but their row survives, holding a chair.
        ghost.class_memberships.update(status="REMOVED")
        res = self._commit_from(self._preview(columns=3).json()["seating"])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(MidtermVersionAssignment.objects.count(), self.COHORT - 1)
        self.assertFalse(MidtermVersionAssignment.objects.filter(student=ghost).exists())

    # ── refusals ─────────────────────────────────────────────────────────────

    def test_commit_rejects_a_plan_that_seats_the_same_version_side_by_side(self):
        seating = self._preview(columns=3).json()["seating"]
        left, right = seating["desks"][0]["seats"]
        right["version_id"] = left["version_id"]  # hand-broken payload
        res = self._commit_from(seating)
        self.assertEqual(res.status_code, 400, res.data)
        self.assertTrue(res.data["violations"])
        self.assertEqual(MidtermVersionAssignment.objects.count(), 0)

    def test_commit_rejects_a_plan_that_seats_the_same_version_front_and_behind(self):
        seating = self._preview(columns=3).json()["seating"]
        by_pos = {(d["row"], s["seat_col"]): s for d in seating["desks"] for s in d["seats"]}
        by_pos[(1, 0)]["version_id"] = by_pos[(0, 0)]["version_id"]
        res = self._commit_from(seating)
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("behind", " ".join(res.data["violations"]))

    def test_commit_rejects_two_students_in_one_seat_without_a_500(self):
        seating = self._preview(columns=3).json()["seating"]
        seats = [
            {"student_id": s["student_id"], "version_id": s["version_id"], "row": 0, "col": 0}
            for d in seating["desks"] for s in d["seats"] if s["student_id"]
        ][:2]
        res = self.api.post(self.url, {"action": "commit", "columns": 3, "seats": seats}, format="json")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("same seat", res.data["detail"])
        self.assertEqual(MidtermVersionAssignment.objects.count(), 0)

    def test_an_unversioned_midterm_is_refused(self):
        plain = Midterm.objects.create(
            title="Plain", subject=Midterm.READING_WRITING, scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, is_published=True,
        )
        res = self.api.post(
            f"/api/classes/{self.room.id}/midterms-v2/{plain.id}/versions/",
            {"action": "preview"}, format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("no versions", res.data["detail"])

    def test_an_empty_version_is_not_offered(self):
        # "Add version" leaves a blank form behind; seating a student on it is worse than
        # not seating them.
        blank_module = self.versions[0].question_module.__class__.objects.create(
            practice_test=None, module_order=1, time_limit_minutes=30
        )
        MidtermVersion.objects.create(
            midterm=self.mt, version_number=9, label="Version I", question_module=blank_module
        )
        self.assertEqual(len(self.api.get(self.url).json()["versions"]), self.VERSIONS)
        self.assertEqual(len(self._preview(columns=3).json()["versions"]), self.VERSIONS)

    # ── a sitting already under way ──────────────────────────────────────────

    def test_reshuffling_is_refused_once_someone_has_started(self):
        self._commit_from(self._preview(columns=3).json()["seating"])
        MidtermAttempt.objects.create(midterm=self.mt, student=self.students[0], version=self.versions[0])
        res = self._preview(columns=3)
        self.assertEqual(res.status_code, 409, res.data)
        self.assertIn("already started", res.data["detail"])

    def test_commit_refuses_to_change_the_paper_of_a_student_who_has_started(self):
        seating = self._preview(columns=3).json()["seating"]
        self._commit_from(seating)
        seat = next(s for d in seating["desks"] for s in d["seats"] if s["student_id"])
        other = next(v for v in self.versions if v.id != seat["version_id"])
        MidtermAttempt.objects.create(midterm=self.mt, student_id=seat["student_id"], version=other)

        res = self._commit_from(seating)
        self.assertEqual(res.status_code, 409, res.data)
        self.assertIn("cannot be changed", res.data["detail"])

    def test_the_grid_flags_who_has_already_started(self):
        self._commit_from(self._preview(columns=3).json()["seating"])
        started = self.students[0]
        MidtermAttempt.objects.create(midterm=self.mt, student=started, version=self.versions[0])
        seating = self.api.get(self.url).json()["seating"]
        self.assertTrue(seating["any_started"])
        seat = next(s for d in seating["desks"] for s in d["seats"] if s["student_id"] == started.id)
        self.assertTrue(seat["locked"])

    # ── permissions ──────────────────────────────────────────────────────────

    def test_a_student_cannot_see_the_seating_plan(self):
        client = APIClient()
        client.force_authenticate(self.students[0])
        self.assertEqual(client.get(self.url).status_code, 403)
        self.assertEqual(client.post(self.url, {"action": "preview"}, format="json").status_code, 403)


class OddCohortSeatingTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="odd-teach", email="ot@x.io", is_staff=True)
        self.room = make_classroom(self.teacher)
        self.mt = Midterm.objects.create(
            title="Odd", subject=Midterm.READING_WRITING, scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, is_published=True,
        )
        self.versions = [_add_version(self.mt, n, key) for n, key in enumerate("abcd", start=1)]
        self.students = []
        for i in range(17):
            s = User.objects.create(username=f"odd-s{i:02d}", email=f"o{i:02d}@x.io", first_name=f"Odd{i:02d}")
            enroll(self.room, s)
            grant(s, self.mt, classroom=self.room)
            self.students.append(s)
        self.api = APIClient()
        self.api.force_authenticate(self.teacher)
        self.url = f"/api/classes/{self.room.id}/midterms-v2/{self.mt.id}/versions/"

    def test_an_odd_class_leaves_one_chair_empty(self):
        seating = self.api.post(self.url, {"action": "preview", "columns": 3}, format="json").json()["seating"]
        empties = [s for d in seating["desks"] for s in d["seats"] if s["student_id"] is None]
        self.assertEqual(len(empties), 1)
        self.assertEqual(seating["student_count"], 17)
        self.assertEqual(seating["desk_count"], 9)

    def test_a_latecomer_takes_the_free_chair_and_its_version(self):
        # The teacher commits the plan, THEN an 18th student joins and starts.
        seating = self.api.post(self.url, {"action": "preview", "columns": 3}, format="json").json()["seating"]
        self.api.post(self.url, {
            "action": "commit", "columns": 3,
            "seats": [
                {"student_id": s["student_id"], "version_id": s["version_id"], "row": d["row"], "col": s["seat_col"]}
                for d in seating["desks"] for s in d["seats"] if s["student_id"]
            ],
        }, format="json")

        latecomer = User.objects.create(username="late", email="late@x.io", first_name="Late")
        enroll(self.room, latecomer)
        grant(latecomer, self.mt, classroom=self.room)
        client = APIClient()
        client.force_authenticate(latecomer)
        res = client.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(res.status_code, 201, res.data)

        row = MidtermVersionAssignment.objects.get(midterm=self.mt, student=latecomer)
        self.assertIsNotNone(row.seat_row, "the latecomer was given a version but no seat")
        expected = self.versions[version_index_for(row.seat_row, row.seat_col, len(self.versions))]
        self.assertEqual(row.version_id, expected.id)

        # And crucially: they do not collide with anyone they can see.
        placed = {
            (a.seat_row, a.seat_col): a.version_id
            for a in MidtermVersionAssignment.objects.filter(midterm=self.mt, seat_row__isnull=False)
        }
        for d_row, d_col in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            neighbour = placed.get((row.seat_row + d_row, row.seat_col + d_col))
            if neighbour is not None:
                self.assertNotEqual(row.version_id, neighbour)

    def test_a_latecomer_with_no_committed_plan_still_gets_a_version(self):
        # The old random path must survive: never block a student over seating.
        latecomer = User.objects.create(username="late2", email="late2@x.io")
        enroll(self.room, latecomer)
        grant(latecomer, self.mt, classroom=self.room)
        client = APIClient()
        client.force_authenticate(latecomer)
        res = client.post("/api/midterms/attempts/", {"midterm": self.mt.id}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        att = MidtermAttempt.objects.get(pk=res.json()["id"])
        self.assertIsNotNone(att.version_id)


def _chart(seating) -> list:
    """(row, seat_col, student, version) for every occupied chair — the comparable identity."""
    return sorted(
        (d["row"], s["seat_col"], s["student_id"], s["version_id"])
        for d in seating["desks"] for s in d["seats"] if s["student_id"]
    )
