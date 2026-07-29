"""Deterministic desk-grid seating for a versioned midterm.

The exam room is a grid of two-seat desks. The system decides who sits with whom AND which
version each seat gets, holding one invariant:

    no two students who can read each other's paper sit the same version

"Can read each other's paper" means the four neighbours that matter in a real room — desk
partner, the person across the aisle, the person in front, the person behind.

Versions belong to SEATS, not students. Shuffling moves people between seats; the version
pattern stays put. That is what makes the invariant hold no matter how the shuffle lands.

With four versions the pattern is::

    Board — front of the room
       [A|B]  [C|D]  [A|B]
       [C|D]  [A|B]  [C|D]
       [A|B]  [C|D]  [A|B]

which also separates diagonals. Three or two versions still separate every horizontal and
vertical neighbour, but diagonals repeat — there are not enough papers to do better, and
``build_seating_plan`` says so in ``warnings``.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

DEFAULT_COLUMNS = 3
MAX_COLUMNS = 8
SEATS_PER_DESK = 2

LEFT, RIGHT = 0, 1


def version_index_for(row: int, seat_col: int, version_count: int) -> int:
    """Which version (0-based index) belongs to the seat at ``(row, seat_col)``.

    ``seat_col`` is the GLOBAL seat column across the whole row — desk 0's seats are columns
    0 and 1, desk 1's are 2 and 3 — so the formula separates partners and across-the-aisle
    neighbours with the same arithmetic.

    * k >= 4 — ``(c + 2*(r % 2)) % 4``. Horizontal step is 1 (mod 4); vertical step is 2
      (mod 4); diagonal steps are 1 or 3. None is 0, so all eight neighbours differ.
    * k = 2 or 3 — ``(c + r) % k``. Horizontal and vertical steps are both 1 (mod k) ≠ 0.
      Diagonals collide, unavoidably. (The k >= 4 formula would be WRONG here: mod 2 the
      ``2*(r % 2)`` term vanishes and every vertical neighbour would match.)
    * k <= 1 — nothing to separate.
    """
    if version_count <= 1:
        return 0
    if version_count >= 4:
        return (seat_col + 2 * (row % 2)) % 4
    return (seat_col + row) % version_count


@dataclass(frozen=True)
class SeatSlot:
    """One chair. ``student_id`` is None for an empty seat; the version is still defined."""

    row: int
    desk_col: int
    side: int
    seat_col: int
    student_id: int | None
    version_index: int

    @property
    def is_empty(self) -> bool:
        return self.student_id is None


@dataclass(frozen=True)
class DeskSlot:
    row: int
    desk_col: int
    number: int  # 1-based, reading order — what the teacher writes on the desk
    left: SeatSlot
    right: SeatSlot

    @property
    def seats(self) -> tuple[SeatSlot, SeatSlot]:
        return (self.left, self.right)


@dataclass(frozen=True)
class SeatingPlan:
    columns: int
    rows: int
    desks: tuple[DeskSlot, ...]
    warnings: tuple[str, ...]

    def all_seats(self) -> list[SeatSlot]:
        return [s for d in self.desks for s in d.seats]

    def occupied_seats(self) -> list[SeatSlot]:
        return [s for s in self.all_seats() if not s.is_empty]

    def seat_of(self, student_id: int) -> SeatSlot | None:
        for seat in self.occupied_seats():
            if seat.student_id == student_id:
                return seat
        return None

    def version_counts(self) -> dict[int, int]:
        """version_index -> how many STUDENTS sit it (empty seats do not count)."""
        counts: dict[int, int] = {}
        for seat in self.occupied_seats():
            counts[seat.version_index] = counts.get(seat.version_index, 0) + 1
        return counts

    @property
    def desk_count(self) -> int:
        return len(self.desks)

    @property
    def student_count(self) -> int:
        return len(self.occupied_seats())


def clamp_columns(columns: int | None) -> int:
    try:
        value = int(columns)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_COLUMNS
    return max(1, min(MAX_COLUMNS, value))


def _shuffled(items: list[int], randbelow: Callable[[int], int]) -> list[int]:
    """Fisher-Yates. ``secrets.randbelow`` keeps it unbiased, matching the version preview
    this replaced."""
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = randbelow(i + 1)
        out[i], out[j] = out[j], out[i]
    return out


def build_seating_plan(
    student_ids: Sequence[int],
    version_count: int,
    *,
    columns: int | None = DEFAULT_COLUMNS,
    shuffle: bool = True,
    randbelow: Callable[[int], int] = secrets.randbelow,
) -> SeatingPlan:
    """Seat ``student_ids`` at ``ceil(n / 2)`` two-seat desks and give each seat a version.

    ``student_ids`` must arrive in a DETERMINISTIC order — the caller sorts it. The cohort
    helper returns an unordered ``set``, whose iteration order drifts as it grows, and an
    unstable base under a shuffle means "Re-shuffle" is not the only thing that moves people.

    Odd cohorts leave exactly one empty seat: the right seat of the last desk.
    """
    columns = clamp_columns(columns)
    ordered = [int(s) for s in student_ids]
    if shuffle:
        ordered = _shuffled(ordered, randbelow)

    n = len(ordered)
    desk_count = -(-n // SEATS_PER_DESK)  # ceil
    rows = -(-desk_count // columns) if desk_count else 0

    desks: list[DeskSlot] = []
    for desk_index in range(desk_count):
        row, desk_col = divmod(desk_index, columns)
        seats = []
        for side in (LEFT, RIGHT):
            flat = desk_index * SEATS_PER_DESK + side
            seat_col = desk_col * SEATS_PER_DESK + side
            seats.append(
                SeatSlot(
                    row=row,
                    desk_col=desk_col,
                    side=side,
                    seat_col=seat_col,
                    student_id=ordered[flat] if flat < n else None,
                    version_index=version_index_for(row, seat_col, version_count),
                )
            )
        desks.append(
            DeskSlot(row=row, desk_col=desk_col, number=desk_index + 1, left=seats[0], right=seats[1])
        )

    return SeatingPlan(columns=columns, rows=rows, desks=tuple(desks), warnings=tuple(_warn(n, version_count)))


def _warn(student_count: int, version_count: int) -> list[str]:
    out: list[str] = []
    if student_count == 0:
        out.append("No students are assigned this midterm yet.")
    if version_count <= 1:
        out.append(
            "This midterm has only one version — desk partners will sit the same paper. "
            "Author more forms in the builder to separate them."
        )
    elif version_count < 4:
        out.append(
            f"With {version_count} versions, neighbours and the rows in front and behind are "
            "separated, but students sitting diagonally may share a paper. Four forms "
            "separate every direction."
        )
    return out


def validate_plan(plan: SeatingPlan, version_count: int) -> list[str]:
    """Re-derive the neighbour pairs from the plan's OWN coordinates and report collisions.

    Deliberately does not consult ``version_index_for`` — this is the check that a chart is
    safe, including one a client hand-crafted, so it must not assume the chart came from our
    generator.
    """
    if version_count <= 1:
        return []
    by_pos = {(s.row, s.seat_col): s for s in plan.occupied_seats()}
    problems: list[str] = []
    for (row, col), seat in sorted(by_pos.items()):
        for d_row, d_col, how in ((0, 1, "next to"), (1, 0, "behind")):
            other = by_pos.get((row + d_row, col + d_col))
            if other is not None and other.version_index == seat.version_index:
                problems.append(
                    f"Row {row + 1}, seat {col + 1} sits the same version as the student "
                    f"{how} them (row {other.row + 1}, seat {other.seat_col + 1})."
                )
    return problems


def columns_from_seat_cols(seat_cols: Iterable[int]) -> int:
    """Recover the grid width from persisted seats.

    Exact whenever the plan has more than one row, because row 0 is always full. For a
    single partial row it returns the number of desks actually drawn, which renders the same.
    """
    cols = [int(c) for c in seat_cols if c is not None]
    if not cols:
        return DEFAULT_COLUMNS
    return clamp_columns(max(cols) // SEATS_PER_DESK + 1)


def next_free_seat(occupied: set[tuple[int, int]], columns: int) -> tuple[int, int]:
    """The first unused ``(row, seat_col)`` in reading order, extending into a new row.

    Reuses the empty right seat of a half-full last desk, and any hole left by a student who
    was removed from the class.
    """
    columns = clamp_columns(columns)
    width = columns * SEATS_PER_DESK
    row = 0
    while True:
        for seat_col in range(width):
            if (row, seat_col) not in occupied:
                return row, seat_col
        row += 1
