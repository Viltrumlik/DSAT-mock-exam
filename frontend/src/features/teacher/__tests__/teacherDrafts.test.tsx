import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * Unpublished homework in the teacher portal's gradebook (`/teacher/gradebook`) and grading queue
 * (`/teacher/grading`).
 *
 * Both read the teaching team's `GET /api/classes/<id>/assignments/`. It leaves archived homework out
 * but keeps drafts, and it lists newest-given first, where a draft counts as given when it was saved:
 * a fresh draft heads the list. Students are only ever given published homework, so no student can see
 * a draft, let alone turn it in. Yet the gradebook made each draft a column in which every student was
 * missing it, counted in their "N!" badge and in "Not turned in". And both screens take only the first
 * 12 homework of a class, so drafts used up those slots and pushed out older homework that students
 * were given: off the gradebook, and its waiting work out of the grading queue.
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
const { useGradingQueue } = await import("../useGradingQueue");

/**
 * A `GET /api/classes/` row, in the serializer's wire shape. TEACHER is kept both by the class filter on
 * main and by the one that reads `my_role` through capabilities.
 */
const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };

type Student = { id: number; first_name: string; last_name: string };
const FIRST: Student = { id: 11, first_name: "First", last_name: "Student" };
const SECOND: Student = { id: 12, first_name: "Second", last_name: "Student" };

type Homework = { id: number; status?: "DRAFT" | "PUBLISHED" };
const drafts = (...ids: number[]): Homework[] => ids.map((id) => ({ id, status: "DRAFT" }));
const published = (...ids: number[]): Homework[] => ids.map((id) => ({ id, status: "PUBLISHED" }));
/** `from`, `from - 1`, … `to`. */
const countDown = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

/**
 * The rows `GET /api/classes/<id>/assignments/` sends the teaching team, in the order it sends them:
 * newest-given first, a day apart. A draft has no `published_at`, so it is dated by when it was saved.
 */
function assignmentRows(homework: Homework[]) {
  return homework.map(({ id, status }, i) => {
    const at = new Date(Date.UTC(2026, 8, 13 - i, 14)).toISOString();
    return { id, title: `Homework ${id}`, ...(status ? { status } : {}), created_at: at, published_at: status === "DRAFT" ? null : at };
  });
}

/** A `GET /api/classes/<id>/assignments/<id>/submissions/` row: turned in and waiting for a grade, or graded. */
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
function serve(homework: Homework[], submissions: Record<number, object[]>, students: Student[] = []) {
  api.list.mockImplementation(async () => parseClassroomList([ALGEBRA], "GET /classes/"));
  api.people.mockImplementation(async () => [
    { id: 90, role: "TEACHER", status: "ACTIVE", user: { id: 9, first_name: "The", last_name: "Teacher" } },
    ...students.map((user) => ({ id: 90 + user.id, role: "STUDENT", status: "ACTIVE", user })),
  ]);
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(assignmentRows(homework), `GET /classes/${classId}/assignments/`),
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

// Both hooks read "ready" from the first render, so wait for what they load instead.
const matrixLoaded = (value: { loading: boolean; model: unknown }) => !value.loading && value.model != null;
const queueLoaded = (value: { loading: boolean }) => !value.loading;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("useGradebook — homework that has not reached students", () => {
  it("makes no column of a draft, so no student is missing it", async () => {
    serve(
      [...drafts(103), ...published(102, 101)],
      {
        101: [turnedIn(1011, FIRST, "90.00"), turnedIn(1012, SECOND)],
        102: [turnedIn(1021, FIRST)],
      },
      [FIRST, SECOND],
    );
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    expect(model?.assignments.map((a) => a.id)).toEqual([102, 101]);
    // The second student has not turned in homework 102: a real gap, and the only one.
    expect(model?.students.map((s) => [s.id, s.cells.map((c) => c.status), s.missing])).toEqual([
      [11, ["submitted", "graded"], 0],
      [12, ["missing", "submitted"], 1],
    ]);
    expect(model?.missingCount).toBe(1);
  });

  it("keeps its 12 columns for homework students were given when newer drafts exist", async () => {
    // Two drafts saved since the last twelve homework went out. The student turned in all but the oldest.
    const given = countDown(212, 201);
    serve(
      [...drafts(214, 213), ...published(...given)],
      Object.fromEntries(given.filter((id) => id !== 201).map((id) => [id, [turnedIn(id * 10, FIRST)]])),
      [FIRST],
    );
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    expect(model?.assignments.map((a) => a.id)).toEqual(given);
    // The gap on the oldest homework shows, and nothing else counts as missing.
    expect(model?.students.map((s) => [s.id, s.missing])).toEqual([[11, 1]]);
    expect(model?.missingCount).toBe(1);
  });

  it("leaves out only what says it is a draft: a row that names no status is still a column", async () => {
    // The contract does not require `status`. Dropping homework whose row lacks it would empty the
    // gradebook over a missing field.
    serve([{ id: 101 }], { 101: [turnedIn(1011, FIRST)] }, [FIRST]);
    const { model } = await settle(() => useGradebook(), matrixLoaded);

    expect(model?.assignments.map((a) => a.id)).toEqual([101]);
    expect(model?.students.map((s) => [s.id, s.cells.map((c) => c.status)])).toEqual([[11, ["submitted"]]]);
  });
});

describe("useGradingQueue — homework that has not reached students", () => {
  it("still queues an older homework's waiting work when twelve newer drafts exist", async () => {
    serve([...drafts(...countDown(312, 301)), ...published(300)], { 300: [turnedIn(3001, FIRST)] });
    const { items } = await settle(() => useGradingQueue(), queueLoaded);

    expect(items.map((item) => [item.assignmentId, item.submission.id])).toEqual([[300, 3001]]);
    // The drafts' submissions are not even asked for.
    expect(api.listSubmissions.mock.calls).toEqual([[1, 300]]);
  });

  it("leaves out only what says it is a draft: a row that names no status still has its work queued", async () => {
    serve([{ id: 300 }], { 300: [turnedIn(3001, FIRST)] });
    const { items } = await settle(() => useGradingQueue(), queueLoaded);

    expect(items.map((item) => [item.assignmentId, item.submission.id])).toEqual([[300, 3001]]);
  });
});
