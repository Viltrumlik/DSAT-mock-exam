"""The seating invariant: nobody can read a useful paper from a neighbour.

These are pure — no database — because the property being tested is arithmetic, and the
arithmetic is the whole feature. If ``version_index_for`` is wrong, every other safeguard in
the stack is decoration: the room looks correct on screen and two students sitting together
get identical papers.
"""

from django.test import SimpleTestCase

from .seating import (
    DEFAULT_COLUMNS,
    MAX_COLUMNS,
    SeatSlot,
    SeatingPlan,
    build_seating_plan,
    clamp_columns,
    columns_from_seat_cols,
    next_free_seat,
    validate_plan,
    version_index_for,
)

# The shapes worth sweeping: empty, single, odd/even, the user's 18-student room, and enough
# beyond it that a second and third row are exercised at every width.
COHORT_SIZES = [0, 1, 2, 3, 4, 5, 8, 9, 17, 18, 19, 30, 45]
VERSION_COUNTS = [2, 3, 4]
COLUMN_CHOICES = [1, 2, 3, 4, 5]


def _by_position(plan: SeatingPlan) -> dict[tuple[int, int], SeatSlot]:
    return {(s.row, s.seat_col): s for s in plan.occupied_seats()}


class AdjacencyInvariantTests(SimpleTestCase):
    """The four neighbours that matter, across every shape the room can take."""

    def test_no_horizontal_neighbour_shares_a_version(self):
        # Includes the ACROSS-THE-AISLE pair (seat_col 1 next to seat_col 2): seat_col is
        # global for the row precisely so desk partners and aisle neighbours are one check.
        for k in VERSION_COUNTS:
            for columns in COLUMN_CHOICES:
                for n in COHORT_SIZES:
                    plan = build_seating_plan(range(n), k, columns=columns, shuffle=False)
                    seats = _by_position(plan)
                    for (row, col), seat in seats.items():
                        right = seats.get((row, col + 1))
                        if right is not None:
                            self.assertNotEqual(
                                seat.version_index, right.version_index,
                                f"n={n} k={k} cols={columns}: row {row} seats {col}/{col + 1} match",
                            )

    def test_no_vertical_neighbour_shares_a_version(self):
        for k in VERSION_COUNTS:
            for columns in COLUMN_CHOICES:
                for n in COHORT_SIZES:
                    plan = build_seating_plan(range(n), k, columns=columns, shuffle=False)
                    seats = _by_position(plan)
                    for (row, col), seat in seats.items():
                        behind = seats.get((row + 1, col))
                        if behind is not None:
                            self.assertNotEqual(
                                seat.version_index, behind.version_index,
                                f"n={n} k={k} cols={columns}: rows {row}/{row + 1} at seat {col} match",
                            )

    def test_desk_partners_never_share_a_version(self):
        for k in VERSION_COUNTS:
            for columns in COLUMN_CHOICES:
                for n in COHORT_SIZES:
                    plan = build_seating_plan(range(n), k, columns=columns, shuffle=False)
                    for desk in plan.desks:
                        if desk.left.is_empty or desk.right.is_empty:
                            continue
                        self.assertNotEqual(
                            desk.left.version_index, desk.right.version_index,
                            f"n={n} k={k} cols={columns}: desk {desk.number} partners match",
                        )

    def test_the_invariant_survives_shuffling(self):
        # Versions belong to seats, so shuffling students can never break the pattern. This
        # is the reason the design puts the version on the chair rather than on the person.
        for _ in range(50):
            plan = build_seating_plan(range(18), 4, columns=3)
            self.assertEqual(validate_plan(plan, 4), [])

    def test_four_versions_also_separate_diagonals(self):
        plan = build_seating_plan(range(45), 4, columns=4, shuffle=False)
        seats = _by_position(plan)
        for (row, col), seat in seats.items():
            for d_col in (-1, 1):
                other = seats.get((row + 1, col + d_col))
                if other is not None:
                    self.assertNotEqual(seat.version_index, other.version_index)


class CanonicalPatternTests(SimpleTestCase):
    def test_the_four_version_three_desk_room(self):
        """The chart the user drew, pinned exactly."""
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        letters = [
            ["".join("ABCD"[s.version_index] for s in desk.seats) for desk in plan.desks if desk.row == r]
            for r in range(plan.rows)
        ]
        self.assertEqual(letters, [["AB", "CD", "AB"], ["CD", "AB", "CD"], ["AB", "CD", "AB"]])
        self.assertEqual((plan.rows, plan.desk_count), (3, 9))

    def test_three_versions_still_separate_both_axes(self):
        plan = build_seating_plan(range(18), 3, columns=3, shuffle=False)
        self.assertEqual(validate_plan(plan, 3), [])

    def test_two_versions_alternate_per_seat_and_per_row(self):
        plan = build_seating_plan(range(12), 2, columns=3, shuffle=False)
        self.assertEqual(validate_plan(plan, 2), [])
        first_row = [s.version_index for d in plan.desks if d.row == 0 for s in d.seats]
        self.assertEqual(first_row, [0, 1, 0, 1, 0, 1])
        second_row = [s.version_index for d in plan.desks if d.row == 1 for s in d.seats]
        self.assertEqual(second_row, [1, 0, 1, 0, 1, 0])

    def test_a_single_version_warns_instead_of_crashing(self):
        plan = build_seating_plan(range(6), 1, columns=3, shuffle=False)
        self.assertTrue(any("only one version" in w for w in plan.warnings))
        # Nothing to validate against — refusing to seat the class would be worse than
        # seating it and saying so.
        self.assertEqual(validate_plan(plan, 1), [])

    def test_fewer_than_four_versions_warns_about_diagonals(self):
        for k in (2, 3):
            plan = build_seating_plan(range(18), k, columns=3, shuffle=False)
            self.assertTrue(any("diagonally" in w for w in plan.warnings), k)
        self.assertEqual(build_seating_plan(range(18), 4, columns=3, shuffle=False).warnings, ())

    def test_version_index_is_a_property_of_the_seat_not_the_formula_caller(self):
        self.assertEqual(version_index_for(0, 0, 4), 0)
        self.assertEqual(version_index_for(0, 3, 4), 3)
        self.assertEqual(version_index_for(1, 0, 4), 2)
        self.assertEqual(version_index_for(2, 0, 4), 0)  # two rows apart may repeat — not adjacent
        self.assertEqual(version_index_for(5, 7, 1), 0)


class GridArithmeticTests(SimpleTestCase):
    def test_desk_and_row_counts(self):
        for n, columns, desks, rows in [
            (0, 3, 0, 0), (1, 3, 1, 1), (2, 3, 1, 1), (3, 3, 2, 1),
            (18, 3, 9, 3), (17, 3, 9, 3), (19, 3, 10, 4), (18, 4, 9, 3), (18, 1, 9, 9),
        ]:
            plan = build_seating_plan(range(n), 4, columns=columns, shuffle=False)
            self.assertEqual((plan.desk_count, plan.rows), (desks, rows), f"n={n} cols={columns}")

    def test_an_odd_cohort_leaves_one_empty_seat_at_the_last_desk(self):
        plan = build_seating_plan(range(17), 4, columns=3, shuffle=False)
        empties = [s for s in plan.all_seats() if s.is_empty]
        self.assertEqual(len(empties), 1)
        self.assertEqual(empties[0], plan.desks[-1].right)
        self.assertEqual(plan.student_count, 17)

    def test_an_empty_seat_still_carries_a_version(self):
        # So a latecomer dropped into it inherits the right paper.
        plan = build_seating_plan(range(17), 4, columns=3, shuffle=False)
        seat = plan.desks[-1].right
        self.assertEqual(seat.version_index, version_index_for(seat.row, seat.seat_col, 4))

    def test_zero_students_returns_an_empty_plan(self):
        plan = build_seating_plan([], 4, columns=3)
        self.assertEqual((plan.desks, plan.rows, plan.desk_count), ((), 0, 0))
        self.assertTrue(any("No students" in w for w in plan.warnings))

    def test_desk_numbers_run_in_reading_order(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        self.assertEqual([d.number for d in plan.desks], list(range(1, 10)))
        self.assertEqual([(d.row, d.desk_col) for d in plan.desks[:4]], [(0, 0), (0, 1), (0, 2), (1, 0)])

    def test_columns_are_clamped(self):
        self.assertEqual(clamp_columns(0), 1)
        self.assertEqual(clamp_columns(-4), 1)
        self.assertEqual(clamp_columns(999), MAX_COLUMNS)
        self.assertEqual(clamp_columns(None), DEFAULT_COLUMNS)
        self.assertEqual(clamp_columns("nonsense"), DEFAULT_COLUMNS)
        self.assertEqual(build_seating_plan(range(4), 4, columns=99).columns, MAX_COLUMNS)


class ShuffleTests(SimpleTestCase):
    def test_every_student_is_seated_exactly_once(self):
        for _ in range(50):
            plan = build_seating_plan(range(19), 4, columns=3)
            seated = [s.student_id for s in plan.occupied_seats()]
            self.assertEqual(sorted(seated), list(range(19)))

    def test_shuffle_off_is_deterministic(self):
        a = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        b = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        self.assertEqual(a, b)
        self.assertEqual([s.student_id for s in a.occupied_seats()], list(range(18)))

    def test_shuffle_actually_permutes(self):
        # An injected randbelow that always returns 0 reverses a Fisher-Yates pass, which is
        # enough to prove the shuffle is wired without depending on chance.
        plan = build_seating_plan(range(6), 4, columns=3, shuffle=True, randbelow=lambda n: 0)
        self.assertNotEqual([s.student_id for s in plan.occupied_seats()], list(range(6)))
        self.assertEqual(sorted(s.student_id for s in plan.occupied_seats()), list(range(6)))

    def test_the_caller_order_is_respected(self):
        plan = build_seating_plan([70, 10, 40], 4, columns=3, shuffle=False)
        self.assertEqual([s.student_id for s in plan.occupied_seats()], [70, 10, 40])


class ValidatePlanTests(SimpleTestCase):
    def test_a_generated_plan_is_always_clean(self):
        for k in VERSION_COUNTS:
            for columns in COLUMN_CHOICES:
                for n in COHORT_SIZES:
                    plan = build_seating_plan(range(n), k, columns=columns, shuffle=False)
                    self.assertEqual(validate_plan(plan, k), [], f"n={n} k={k} cols={columns}")

    def test_a_hand_broken_horizontal_pair_is_caught(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        desk = plan.desks[0]
        broken = plan.__class__(
            columns=plan.columns, rows=plan.rows, warnings=plan.warnings,
            desks=(desk.__class__(
                row=desk.row, desk_col=desk.desk_col, number=desk.number,
                left=desk.left,
                right=desk.right.__class__(**{**desk.right.__dict__, "version_index": desk.left.version_index}),
            ),) + plan.desks[1:],
        )
        problems = validate_plan(broken, 4)
        self.assertTrue(problems)
        self.assertIn("next to", problems[0])

    def test_a_hand_broken_vertical_pair_is_caught(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        front, behind = plan.desks[0], plan.desks[3]  # same desk_col, next row
        self.assertEqual(front.desk_col, behind.desk_col)
        broken = plan.__class__(
            columns=plan.columns, rows=plan.rows, warnings=plan.warnings,
            desks=plan.desks[:3] + (behind.__class__(
                row=behind.row, desk_col=behind.desk_col, number=behind.number,
                left=behind.left.__class__(**{**behind.left.__dict__, "version_index": front.left.version_index}),
                right=behind.right,
            ),) + plan.desks[4:],
        )
        problems = validate_plan(broken, 4)
        self.assertTrue(problems)
        self.assertIn("behind", problems[0])


class SeatLookupTests(SimpleTestCase):
    def test_seat_of_and_version_counts(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        seat = plan.seat_of(0)
        self.assertEqual((seat.row, seat.seat_col, seat.side), (0, 0, 0))
        self.assertIsNone(plan.seat_of(9999))
        # The pattern decides the split, so it is near-even but not exactly even. Surfacing
        # the counts is the honest answer; rebalancing would break adjacency.
        self.assertEqual(sorted(plan.version_counts().values()), [4, 4, 5, 5])
        self.assertEqual(sum(plan.version_counts().values()), 18)

    def test_version_counts_ignore_empty_seats(self):
        plan = build_seating_plan(range(17), 4, columns=3, shuffle=False)
        self.assertEqual(sum(plan.version_counts().values()), 17)


class ColumnRecoveryTests(SimpleTestCase):
    def test_columns_recover_from_persisted_seat_columns(self):
        for columns in COLUMN_CHOICES:
            plan = build_seating_plan(range(30), 4, columns=columns, shuffle=False)
            self.assertEqual(columns_from_seat_cols(s.seat_col for s in plan.all_seats()), columns)

    def test_no_seats_falls_back_to_the_default(self):
        self.assertEqual(columns_from_seat_cols([]), DEFAULT_COLUMNS)
        self.assertEqual(columns_from_seat_cols([None, None]), DEFAULT_COLUMNS)

    def test_a_single_partial_row_recovers_the_width_actually_drawn(self):
        # 4 students at 2 desks in a 3-wide room: only 2 desks exist, so 2 is what renders.
        plan = build_seating_plan(range(4), 4, columns=3, shuffle=False)
        self.assertEqual(columns_from_seat_cols(s.seat_col for s in plan.all_seats()), 2)


class NextFreeSeatTests(SimpleTestCase):
    def test_the_first_hole_wins(self):
        self.assertEqual(next_free_seat(set(), 3), (0, 0))
        self.assertEqual(next_free_seat({(0, 0), (0, 1)}, 3), (0, 2))

    def test_a_half_empty_last_desk_is_reused(self):
        plan = build_seating_plan(range(17), 4, columns=3, shuffle=False)
        occupied = {(s.row, s.seat_col) for s in plan.occupied_seats()}
        self.assertEqual(next_free_seat(occupied, 3), (2, 5))

    def test_a_hole_left_by_a_removed_student_is_reused(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        occupied = {(s.row, s.seat_col) for s in plan.occupied_seats()} - {(1, 2)}
        self.assertEqual(next_free_seat(occupied, 3), (1, 2))

    def test_a_full_room_extends_into_a_new_row(self):
        plan = build_seating_plan(range(18), 4, columns=3, shuffle=False)
        occupied = {(s.row, s.seat_col) for s in plan.occupied_seats()}
        self.assertEqual(next_free_seat(occupied, 3), (3, 0))

    def test_the_seat_it_returns_keeps_the_invariant(self):
        # A latecomer must not collide with the partner they end up next to.
        plan = build_seating_plan(range(17), 4, columns=3, shuffle=False)
        occupied = {(s.row, s.seat_col) for s in plan.occupied_seats()}
        row, col = next_free_seat(occupied, 3)
        latecomer = version_index_for(row, col, 4)
        by_pos = _by_position(plan)
        for d_row, d_col in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            neighbour = by_pos.get((row + d_row, col + d_col))
            if neighbour is not None:
                self.assertNotEqual(latecomer, neighbour.version_index)
