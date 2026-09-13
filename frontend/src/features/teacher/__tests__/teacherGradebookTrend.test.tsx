import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * The Trend column of the teacher portal's gradebook (`/teacher/gradebook`): how far a student's grade moved,
 * from the oldest homework they were graded on to the newest.
 *
 * The columns are the class's homework in the order the teaching team's `GET /api/classes/<id>/assignments/`
 * sends it: newest-given first. The trend took the last graded column minus the first, which in that order is
 * the oldest grade minus the newest. A student who went from 60 to 90 read as down 30, in the warning colour,
 * and one who slid from 80 to 55 read as up 25.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  people: vi.fn(),
  listAssignments: vi.fn(),
  listSubmissions: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { useGradebook } = await import("../useGradebook");

/** A `GET /api/classes/` row, in the serializer's wire shape. */
const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };

type Student = { id: number; first_name: string; last_name: string };
const FIRST: Student = { id: 11, first_name: "First", last_name: "Student" };
const SECOND: Student = { id: 12, first_name: "Second", last_name: "Student" };

/**
 * The rows `GET /api/classes/<id>/assignments/` sends the teaching team for published homework, in the order it
 * sends them: newest-given first, a day apart. So `newestFirst[0]` was given last.
 */
function assignmentRows(newestFirst: number[]) {
  return newestFirst.map((id, i) => {
    const at = new Date(Date.UTC(2026, 8, 13 - i, 14)).toISOString();
    return { id, title: `Homework ${id}`, status: "PUBLISHED", created_at: at, published_at: at };
  });
}

/** A `GET /api/classes/<id>/assignments/<id>/submissions/` row: graded, or turned in and waiting for a grade. */
function turnedIn(id: number, student: Student, grade?: string) {
  return {
    id,
    status: grade == null ? "SUBMITTED" : "REVIEWED",
    workflow_status: grade == null ? "SUBMITTED" : "GRADED",
    revision: 1,
    submitted_at: "2026-09-12T20:00:00+05:00",
    student,
    review: grade == null ? null : { grade, max_score: "100", feedback: "", is_auto: false, review_context: "current" },
  };
}

/** Serve ALGEBRA, its students and its homework, the lists through the real contract parsers. */
function serve(newestFirst: number[], submissions: Record<number, object[]>, students: Student[]) {
  api.list.mockImplementation(async () => parseClassroomList([ALGEBRA], "GET /classes/"));
  api.people.mockImplementation(async () => [
    { id: 90, role: "TEACHER", status: "ACTIVE", user: { id: 9, first_name: "The", last_name: "Teacher" } },
    ...students.map((user) => ({ id: 90 + user.id, role: "STUDENT", status: "ACTIVE", user })),
  ]);
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(assignmentRows(newestFirst), `GET /classes/${classId}/assignments/`),
  );
  api.listSubmissions.mockImplementation(async (_classId: number, assignmentId: number) => submissions[assignmentId] ?? []);
}

let host: HTMLDivElement;
let root: Root;

/** Mount a hook and let it run until `done` says it has finished loading. */
async function settle<T>(useHook: () => T, done: (value: T) => boolean): Promise<T> {
  const seen: { value?: T } = {};
  function Probe() {
    seen.value = useHook();
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
  for (let tick = 0; tick < 50 && !(seen.value !== undefined && done(seen.value)); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (seen.value === undefined || !done(seen.value)) throw new Error("the hook never finished loading");
  return seen.value;
}

// The gradebook reads "ready" from the first render, so wait for the matrix it loads instead.
const matrixLoaded = (value: { loading: boolean; model: unknown }) => !value.loading && value.model != null;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("useGradebook — a student's trend", () => {
  it("reads a student who went from 60 to 90 as up 30, and one who went from 80 to 55 as down 25", async () => {
    // Homework 101 was given first, 102 a day later.
    serve(
      [102, 101],
      {
        101: [turnedIn(1011, FIRST, "60.00"), turnedIn(1012, SECOND, "80.00")],
        102: [turnedIn(1021, FIRST, "90.00"), turnedIn(1022, SECOND, "55.00")],
      },
      [FIRST, SECOND],
    );
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    // The columns keep the server's order, newest first.
    expect(model?.assignments.map((a) => a.id)).toEqual([102, 101]);
    expect(model?.students.map((s) => [s.id, s.trendDelta])).toEqual([
      [11, 30],
      [12, -25],
    ]);
  });

  it("runs from the oldest graded homework to the newest, past work that is missing or waiting for a grade", async () => {
    // Given in order 101 … 106. The student skipped the first and the latest, and 104 has no grade yet, so the
    // trend runs from 102's 60 to 105's 75. The 40 in between is not an end.
    serve(
      [106, 105, 104, 103, 102, 101],
      {
        102: [turnedIn(1021, FIRST, "60.00")],
        103: [turnedIn(1031, FIRST, "40.00")],
        104: [turnedIn(1041, FIRST)],
        105: [turnedIn(1051, FIRST, "75.00")],
      },
      [FIRST],
    );
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    expect(model?.students.map((s) => [s.id, s.cells.map((c) => c.status), s.trendDelta])).toEqual([
      [11, ["missing", "graded", "submitted", "graded", "graded", "missing"], 15],
    ]);
  });

  it("shows no trend for a student graded only once", async () => {
    serve([102, 101], { 101: [turnedIn(1011, FIRST, "70.00")], 102: [turnedIn(1021, FIRST)] }, [FIRST]);
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    expect(model?.students.map((s) => [s.id, s.average, s.trendDelta])).toEqual([[11, 70, null]]);
  });
});
