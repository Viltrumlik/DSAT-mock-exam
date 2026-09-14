import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";

/**
 * Who the homework grading screens let in — `/teacher/homework/grading` and the assignment page
 * under it.
 *
 * `my_role` is the membership role as `ClassroomMembership` stores it: ADMIN (the legacy owner),
 * OWNER, TEACHER, TA or STUDENT. The server lets the whole teaching team grade: `can_grade` is
 * `is_staff`, which is ADMIN, OWNER, TEACHER and TA. Both screens used to let in ADMIN alone.
 * Prod has real OWNER, TEACHER and TA memberships — an ownership transfer makes the class's
 * teacher its OWNER and its creator a TEACHER, and a support teacher joins as a TA — so those
 * people found no homework in the hub, and "Only class teachers can grade this homework." on an
 * assignment the server would have let them grade.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  listAssignments: vi.fn(),
  listSubmissions: vi.fn(),
  people: vi.fn(),
  gradeSubmission: vi.fn(),
  returnSubmission: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
// The hub refreshes on server-sent events; there is no EventSource in jsdom.
vi.mock("@/lib/realtime", () => ({ subscribeRealtime: () => () => {} }));
vi.mock("@/hooks/useAuthCriticalGate", () => ({
  useAuthCriticalGate: () => ({ assertCriticalAuth: () => true, criticalAuthReady: true }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { default: HomeworkGradingHub } = await import("../HomeworkGradingHub");
const { default: HomeworkGradingAssignmentView } = await import("../HomeworkGradingAssignmentView");

const BASE = "/teacher/homework/grading";
const REFUSED = "Only class teachers can grade this homework.";

/** A `GET /api/classes/` row in the serializer's wire shape. */
function classRow(id: number, myRole: string) {
  return {
    id,
    name: `${myRole} class`,
    subject: "MATH",
    lesson_days: "ODD",
    join_code: `JOIN${id}`,
    members_count: 2,
    my_role: myRole,
  };
}

// Listed first, so a filter that keeps "any class" shows up here.
const SITS_IN = classRow(5, "STUDENT");
const TEACHES = [classRow(1, "OWNER"), classRow(2, "ADMIN"), classRow(3, "TEACHER"), classRow(4, "TA")];

/** Class N's only homework has id N00. */
function assignments(classId: number) {
  return {
    items: [
      {
        id: classId * 100,
        title: `Homework ${classId}`,
        created_at: "2026-09-01T09:00:00+05:00",
        due_at: null,
        submissions_count: 1,
      },
    ],
  };
}

const STUDENT = { id: 501, first_name: "Aziza", last_name: "Karimova" };

let host: HTMLDivElement;
let root: Root;

/** Mount `element` and let it run until `done` says it has finished loading. */
async function settle(element: React.ReactElement, done: () => boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("the screen never finished loading");
}

const spinnerGone = () => host.querySelector(".animate-spin") == null;

/** The class ids a class-scoped request was made for, in order. */
function requested(fn: typeof api.list): number[] {
  return fn.mock.calls.map(([classId]) => classId as number).sort((a, b) => a - b);
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  api.listAssignments.mockImplementation(async (classId: number) => assignments(classId));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("HomeworkGradingHub — the classes it lists homework from", () => {
  it("lists homework from OWNER, ADMIN, TEACHER and TA classes, and none from a class the user sits in", async () => {
    // Served through the real contract parser, which passes `my_role` through untouched.
    api.list.mockImplementation(async () => parseClassroomList([SITS_IN, ...TEACHES], "GET /classes/"));
    await settle(
      <HomeworkGradingHub basePath={BASE} homeworkManagementHref="/teacher/homework" homeworkManagementLabel="Homework" />,
      spinnerGone,
    );

    expect(requested(api.listAssignments)).toEqual([1, 2, 3, 4]);
    const opens = [...host.querySelectorAll("a")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith(`${BASE}/`))
      .sort();
    expect(opens).toEqual([`${BASE}/1/100`, `${BASE}/2/200`, `${BASE}/3/300`, `${BASE}/4/400`]);
    expect(host.textContent).not.toContain("Homework 5");
    expect(host.textContent).not.toContain("No assignments to grade yet");
  });

  it("shows the empty state when the only class is one the user sits in", async () => {
    api.list.mockImplementation(async () => parseClassroomList([SITS_IN], "GET /classes/"));
    await settle(
      <HomeworkGradingHub basePath={BASE} homeworkManagementHref="/teacher/homework" homeworkManagementLabel="Homework" />,
      spinnerGone,
    );

    expect(api.listAssignments).not.toHaveBeenCalled();
    expect(host.textContent).toContain("No assignments to grade yet");
  });
});

describe("HomeworkGradingAssignmentView — who may open an assignment to grade", () => {
  /** Class 7's homework 700, with one student who has turned it in. */
  function serveClass(myRole: string) {
    api.get.mockImplementation(async () => ({ id: 7, name: "Algebra 2", my_role: myRole }));
    api.listAssignments.mockImplementation(async () => ({
      items: [{ id: 700, title: "Week 4 — Algebra", locks_file_upload: false }],
    }));
    api.listSubmissions.mockImplementation(async () => [
      { id: 9001, status: "SUBMITTED", revision: 1, student: STUDENT, files: [], attempt: null, review: null },
    ]);
    api.people.mockImplementation(async () => [
      { role: myRole === "STUDENT" ? "TEACHER" : myRole, user: { id: 9, first_name: "The", last_name: "Teacher" } },
      { role: "STUDENT", user: STUDENT },
    ]);
  }

  it.each(["OWNER", "ADMIN", "TEACHER", "TA"])("opens the grading page for a %s of the class", async (myRole) => {
    serveClass(myRole);
    await settle(<HomeworkGradingAssignmentView basePath={BASE} classId={7} assignmentId={700} />, spinnerGone);

    expect(host.textContent).not.toContain(REFUSED);
    expect(api.listSubmissions).toHaveBeenCalledWith(7, 700);
    expect(host.querySelector("h1")?.textContent).toBe("Week 4 — Algebra");
    expect(host.textContent).toContain("Submitted (1)");
    expect(host.textContent).toContain("Aziza Karimova");
  });

  it("refuses a student of the class, and never asks for the class's submissions", async () => {
    serveClass("STUDENT");
    await settle(<HomeworkGradingAssignmentView basePath={BASE} classId={7} assignmentId={700} />, spinnerGone);

    expect(host.textContent).toContain(REFUSED);
    expect(api.listSubmissions).not.toHaveBeenCalled();
    expect(api.people).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Aziza Karimova");
  });

  it("refuses a user the class response names no role for", async () => {
    serveClass("STUDENT");
    api.get.mockImplementation(async () => ({ id: 7, name: "Algebra 2", my_role: null }));
    await settle(<HomeworkGradingAssignmentView basePath={BASE} classId={7} assignmentId={700} />, spinnerGone);

    expect(host.textContent).toContain(REFUSED);
    expect(api.listSubmissions).not.toHaveBeenCalled();
  });
});
