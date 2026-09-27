import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * A request that fails in the teacher portal's gradebook (`/teacher/gradebook`) and grading queue
 * (`/teacher/grading`).
 *
 * Both hooks caught every rejected request and carried on with an empty answer in its place, so a
 * failure was drawn as data:
 * - the class list → "No classes yet";
 * - a class's people or homework → "No students yet", or a gradebook with no columns;
 * - one homework's submissions → every student "missing" it, in their "N!" badge and in "Not turned in";
 * - any of the queue's requests → a queue without that work, and "All caught up" when none came back.
 *
 * A load that fails is its own state: the page says what did not load and offers "Try again", which runs
 * that load again. A load that only partly came back has failed too. A class's gradebook is not drawn
 * from some of its homework, because its averages, trends and "Not turned in" are taken over all of it.
 * The queue is not listed from some of its requests, because it would stop short of work that is waiting.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  people: vi.fn(),
  listAssignments: vi.fn(),
  listSubmissions: vi.fn(),
  gradeSubmission: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { useGradebook } = await import("../useGradebook");
const { TeacherGradebook } = await import("../TeacherGradebook");

/**
 * `GET /api/classes/` rows in the serializer's wire shape. TEACHER is kept both by the class filter on
 * main and by the one that reads `my_role` through capabilities.
 */
const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };
const GEOMETRY = { id: 2, name: "Geometry", subject: "MATH", lesson_days: "EVEN", join_code: "JOIN2", my_role: "TEACHER" };

type Person = { id: number; first_name: string; last_name: string };
const TEACHER: Person = { id: 9, first_name: "The", last_name: "Teacher" };
const FIRST: Person = { id: 11, first_name: "First", last_name: "Student" };
const SECOND: Person = { id: 12, first_name: "Second", last_name: "Student" };
const THIRD: Person = { id: 21, first_name: "Third", last_name: "Student" };

const STUDENTS: Record<number, Person[]> = { 1: [FIRST, SECOND], 2: [THIRD] };
/** Each class's homework, newest-given first, as the list sends it. */
const HOMEWORK: Record<number, number[]> = { 1: [102, 101], 2: [201] };
/** Everyone turned in all of their homework, and none of it is graded yet. */
const TURNED_IN: Record<number, Person[]> = { 101: [FIRST, SECOND], 102: [FIRST, SECOND], 201: [THIRD] };

/** A `GET /api/classes/<id>/assignments/<id>/submissions/` row: turned in and waiting for a grade. */
function submission(assignmentId: number, student: Person) {
  return {
    id: assignmentId * 100 + student.id,
    status: "SUBMITTED",
    workflow_status: "SUBMITTED",
    revision: 1,
    submitted_at: "2026-09-12T20:00:00+05:00",
    student,
    review: null,
  };
}

/** Every request answers, the lists through the real contract parsers. */
function serve() {
  api.list.mockImplementation(async () => parseClassroomList([ALGEBRA, GEOMETRY], "GET /classes/"));
  api.people.mockImplementation(async (classId: number) => [
    { id: 900 + classId, role: "TEACHER", status: "ACTIVE", user: TEACHER },
    ...STUDENTS[classId].map((user) => ({ id: 1000 + user.id, role: "STUDENT", status: "ACTIVE", user })),
  ]);
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(
      HOMEWORK[classId].map((id) => ({ id, title: `Homework ${id}`, status: "PUBLISHED", created_at: "2026-09-10T09:00:00+05:00" })),
      `GET /classes/${classId}/assignments/`,
    ),
  );
  api.listSubmissions.mockImplementation(async (_classId: number, assignmentId: number) =>
    TURNED_IN[assignmentId].map((student) => submission(assignmentId, student)),
  );
}

/** Answer `fn` as `serve()` does, except where `fails` names the call: that one rejects with `error`. */
function failWhere(fn: typeof api.list, fails: (...args: number[]) => boolean, error: () => unknown) {
  const answer = fn.getMockImplementation()!;
  fn.mockImplementation(async (...args: number[]) => {
    if (fails(...args)) throw error();
    return answer(...args);
  });
}

/** How axios rejects when the server answers with an error status. Django's own 500 page is HTML. */
function httpError(status: number, data: unknown = "<!doctype html><title>Server Error (500)</title>") {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

/** How axios rejects when no answer comes back at all. */
function networkError() {
  return Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
}

const FORBIDDEN = { detail: "You do not have permission to perform this action." };

/** Fail `fn`'s next call, then hold the one after it until the returned `release` is called. */
function failThenHold(fn: typeof api.list, error: () => unknown) {
  const answer = fn.getMockImplementation()!;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  fn.mockImplementationOnce(async () => {
    throw error();
  }).mockImplementationOnce(async (...args: number[]) => {
    await held;
    return answer(...args);
  });
  return () => release();
}

let host: HTMLDivElement;
let root: Root;

async function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}

/** Turn the event loop until `done` holds. */
async function until(done: () => boolean) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("never settled");
}

/** Mount a hook. The function it resolves to reads the hook's latest value. */
async function mountHook<T>(useHook: () => T): Promise<() => T> {
  const seen: { value?: T } = {};
  function Probe() {
    seen.value = useHook();
    return null;
  }
  await mount(<Probe />);
  return () => seen.value as T;
}

// Both hooks read "ready" from the first render, and `loading` is true until their load has finished.
const settled = (value: { loading: boolean }) => !value.loading;

const text = () => host.textContent ?? "";
/** No loading placeholder is left on the page. */
const pageSettled = () => host.querySelector(".ds-skeleton") === null;
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}
/** The value on the gradebook's stat card with this label. */
function stat(label: string) {
  return [...host.querySelectorAll("p")].find((p) => p.textContent === label)?.previousElementSibling?.textContent ?? null;
}
/** Everything inside the chart card with this title. */
function chartCard(title: string) {
  return [...host.querySelectorAll("section")].find((s) => s.querySelector("h3")?.textContent === title)?.textContent ?? null;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  serve();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  localStorage.clear();
});

describe("useGradebook — a request that failed is not a gradebook", () => {
  it("a class list that did not load is an error, not a teacher with no classes", async () => {
    api.list.mockRejectedValue(httpError(500));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    // Django's HTML error page is not a reason.
    expect(read().classListError).toEqual({ detail: null });
    expect(api.people).not.toHaveBeenCalled();
  });

  it("tries the class list again, and opens the first class once it loads", async () => {
    api.list.mockRejectedValueOnce(networkError());
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));
    expect(read().status).toBe("error");

    await act(async () => read().retryClassList());
    await until(() => settled(read()) && read().model != null);

    expect(read().status).toBe("ready");
    expect(read().classListError).toBeNull();
    expect(read().classes.map((c) => c.id)).toEqual([1, 2]);
    expect(read().selectedClassId).toBe(1);
    expect(read().model?.students.map((s) => s.id)).toEqual([11, 12]);
  });

  it.each([
    ["people", () => api.people.mockRejectedValue(httpError(503))],
    ["homework", () => api.listAssignments.mockRejectedValue(networkError())],
  ])("a class whose %s did not load has no gradebook drawn, and says so", async (_part, fail) => {
    fail();
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    expect(read().status).toBe("ready");
    expect(read().selectedClassId).toBe(1);
    expect(read().model).toBeNull();
    expect(read().matrixError).toEqual({ detail: null });
  });

  it("one homework's submissions not loading marks no student missing it", async () => {
    // Everyone turned in both homework. Only homework 102's submissions do not come back.
    failWhere(api.listSubmissions, (_classId, assignmentId) => assignmentId === 102, () => httpError(500));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    const missing = (read().model?.students ?? []).flatMap((s) =>
      s.cells.filter((c) => c.status === "missing").map((c) => [s.id, c.assignmentId]),
    );
    expect(missing).toEqual([]);
    expect(read().model?.missingCount ?? 0).toBe(0);
    // None of the class is drawn: its averages, trends and "Not turned in" are taken over all of its homework.
    expect(read().model).toBeNull();
    expect(read().matrixError).toEqual({ detail: null });
  });

  it("keeps the server's reason when it gave one", async () => {
    api.listSubmissions.mockRejectedValue(httpError(403, FORBIDDEN));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    expect(read().model).toBeNull();
    expect(read().matrixError).toEqual({ detail: FORBIDDEN.detail });
  });

  it("tries the class again, and draws its gradebook once it loads", async () => {
    api.people.mockRejectedValueOnce(httpError(502));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));
    expect(read().model).toBeNull();

    await act(async () => read().retryMatrix());
    await until(() => settled(read()) && read().model != null);

    expect(read().matrixError).toBeNull();
    expect(read().model?.students.map((s) => [s.id, s.cells.map((c) => c.status)])).toEqual([
      [11, ["submitted", "submitted"]],
      [12, ["submitted", "submitted"]],
    ]);
    expect(read().model?.missingCount).toBe(0);
    expect(api.people.mock.calls).toEqual([[1], [1]]);
  });

  it("opens another class normally after one that did not load", async () => {
    failWhere(api.people, (classId) => classId === 1, () => httpError(500));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));
    expect(read().matrixError).toEqual({ detail: null });

    await act(async () => read().setSelectedClassId(2));
    await until(() => settled(read()) && read().model != null);

    expect(read().matrixError).toBeNull();
    expect(read().model?.assignments.map((a) => a.id)).toEqual([201]);
    expect(read().model?.students.map((s) => s.id)).toEqual([21]);
  });

  it("does not leave the previous class's gradebook up when the next class fails to load", async () => {
    failWhere(api.listAssignments, (classId) => classId === 2, networkError);
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()) && read().model != null);

    await act(async () => read().setSelectedClassId(2));
    await until(() => settled(read()));

    expect(read().selectedClassId).toBe(2);
    expect(read().model).toBeNull();
    expect(read().matrixError).toEqual({ detail: null });
  });

  it("a class left while it loads cannot put its failure over the class opened next", async () => {
    let failClass1: (error: unknown) => void = () => {};
    const answer = api.people.getMockImplementation()!;
    api.people.mockImplementation((classId: number) =>
      classId === 1 ? new Promise((_resolve, reject) => (failClass1 = reject)) : answer(classId),
    );
    const read = await mountHook(() => useGradebook());
    await until(() => api.people.mock.calls.length === 1);

    await act(async () => read().setSelectedClassId(2));
    await until(() => settled(read()) && read().model != null);
    await act(async () => failClass1(httpError(500)));
    await until(() => true);

    expect(read().selectedClassId).toBe(2);
    expect(read().matrixError ?? null).toBeNull();
    expect(read().model?.assignments.map((a) => a.id)).toEqual([201]);
  });

  it("still reads a class with no students as one", async () => {
    api.people.mockResolvedValue([{ id: 901, role: "TEACHER", status: "ACTIVE", user: TEACHER }]);
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    expect(read().status).toBe("ready");
    expect(read().matrixError ?? null).toBeNull();
    expect(read().model?.students).toEqual([]);
  });

  it("still reads a teacher with no classes as one", async () => {
    api.list.mockResolvedValue(parseClassroomList([], "GET /classes/"));
    const read = await mountHook(() => useGradebook());
    await until(() => settled(read()));

    expect(read().status).toBe("empty");
    expect(read().classListError ?? null).toBeNull();
  });
});

describe("TeacherGradebook — what the teacher sees when a load fails", () => {
  it("a class list that did not load says so, with Try again — not 'No classes yet'", async () => {
    api.list.mockRejectedValueOnce(httpError(500));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(text()).not.toContain("No classes yet");
    expect(text()).toContain("Couldn’t load your classes");
    expect(text()).toContain("Your classes and their grades are unchanged — only this page failed to load.");
    expect(text()).not.toContain("doctype");
    expect(buttons()).toContain("Try again");

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Couldn’t load");
    expect(text()).toContain("First Student");
  });

  it("while Try again waits on the class list, the page is loading — not 'No classes yet' or 'No students yet'", async () => {
    const release = failThenHold(api.list, networkError);
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    await act(async () => button("Try again").click());
    await until(() => api.list.mock.calls.length === 2);
    await until(() => true);

    expect(pageSettled()).toBe(false);
    expect(text()).not.toContain("No classes yet");
    expect(text()).not.toContain("No students yet");
    expect(text()).not.toContain("Couldn’t load");

    await act(async () => release());
    await until(pageSettled);
    expect(text()).toContain("First Student");
  });

  it("a class that did not load says so in its gradebook's place, with Try again — not 'No students yet'", async () => {
    api.people.mockRejectedValueOnce(httpError(503));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(text()).not.toContain("No students yet");
    expect(chartCard("How is the class distributed?")).not.toContain("No graded work yet");
    expect(stat("Students")).toBe("—");
    expect(stat("Not turned in")).toBe("—");
    expect(text()).toContain("Couldn’t load the gradebook for Algebra 2");
    expect(text()).toContain("Grades and submissions are unchanged — only this view failed to load.");
    // The other class is still one click away.
    expect(buttons()).toEqual(expect.arrayContaining(["Algebra 2", "Geometry", "Try again"]));

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(text()).not.toContain("Couldn’t load");
    expect(stat("Students")).toBe("2");
    expect(stat("Not turned in")).toBe("0");
  });

  it("while Try again waits on the class, its gradebook's place is loading — not 'No students yet'", async () => {
    const release = failThenHold(api.people, () => httpError(503));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    await act(async () => button("Try again").click());
    await until(() => api.people.mock.calls.length === 2);
    await until(() => true);

    expect(pageSettled()).toBe(false);
    expect(text()).not.toContain("No students yet");
    expect(text()).not.toContain("Couldn’t load");

    await act(async () => release());
    await until(pageSettled);
    expect(stat("Students")).toBe("2");
  });

  it("one homework's submissions not loading puts no '!' on anyone and no number in “Not turned in”", async () => {
    let failing = true;
    failWhere(api.listSubmissions, (_classId, assignmentId) => failing && assignmentId === 102, networkError);
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(text()).not.toMatch(/\d!/);
    expect(stat("Not turned in")).toBe("—");
    expect(text()).toContain("Couldn’t load the gradebook for Algebra 2");

    failing = false;
    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(text()).not.toMatch(/\d!/);
    expect(stat("Not turned in")).toBe("0");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("shows the server's reason when it gave one", async () => {
    api.listSubmissions.mockRejectedValue(httpError(403, FORBIDDEN));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(text()).toContain("Couldn’t load the gradebook for Algebra 2");
    expect(text()).toContain(FORBIDDEN.detail);
    expect(text()).not.toContain("only this view failed to load");
  });

  it("still says 'No graded work yet' once a class has loaded with nothing graded", async () => {
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(chartCard("How is the class distributed?")).toContain("No graded work yet");
    expect(stat("Not turned in")).toBe("0");
  });
});
