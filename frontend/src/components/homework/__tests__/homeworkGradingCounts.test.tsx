import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * What the homework grading hub (`/teacher/homework/grading`) says about each homework: its
 * "N missing" and "All in" badges, the "N / M submitted" line, the overdue banner, and which
 * homework it lists first.
 *
 * All of them were `members_count - submissions_count`, and neither number is the one they need.
 * `members_count` is every member of the class who has not been removed, the teacher and any TA
 * included; the class row's `student_count` is its active students. `submissions_count` is every
 * submission row: a draft the student never turned in, work returned for revision, and the work of
 * a student who has since left the class. The assignment row now carries `turned_in_count` —
 * SUBMITTED or REVIEWED, from the class's active students — which is what the grading page lists
 * as submitted.
 *
 * So a class of 20 students with a teacher and a TA, every one of whom had turned the homework in,
 * read "2 missing" and could never read "All in".
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listAssignments: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
// The hub refreshes on server-sent events; there is no EventSource in jsdom.
vi.mock("@/lib/realtime", () => ({ subscribeRealtime: () => () => {} }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { default: HomeworkGradingHub } = await import("../HomeworkGradingHub");

const BASE = "/teacher/homework/grading";
// Noon in Tashkent. Every deadline below is days away from it, on one side or the other.
const NOW = new Date("2026-09-13T12:00:00+05:00");

/** A `GET /api/classes/` row, in the serializer's wire shape, for a class the user teaches. */
function classRow(id: number, name: string, counts: { members_count: number; student_count: number }) {
  return { id, name, subject: "MATH", lesson_days: "ODD", join_code: `JOIN${id}`, my_role: "ADMIN", ...counts };
}

/** A `GET /api/classes/<id>/assignments/` row as the teaching team receives it. */
function homework(
  id: number,
  title: string,
  fields: { due_at: string; created_at: string; submissions_count: number; turned_in_count?: number },
) {
  return { id, title, status: "PUBLISHED", ...fields };
}

// 20 students, their teacher and a TA: `members_count` is 22, `student_count` is 20.
const ALGEBRA = classRow(1, "Algebra 2", { members_count: 22, student_count: 20 });

// Due two days ago, and all 20 students turned it in.
const ESSAY = homework(101, "Essay", {
  due_at: "2026-09-11T09:00:00+05:00",
  created_at: "2026-09-08T09:00:00+05:00",
  submissions_count: 20,
  turned_in_count: 20,
});

// Due five days ago. 16 students turned it in; two only saved a draft, one has work returned for
// revision and one never started. A student who has since left the class had turned it in too, so
// there are 20 submission rows.
const WORKSHEET = homework(102, "Worksheet", {
  due_at: "2026-09-08T09:00:00+05:00",
  created_at: "2026-09-05T09:00:00+05:00",
  submissions_count: 20,
  turned_in_count: 16,
});

// Due in five days. Three students have started a draft.
const READING = homework(103, "Reading", {
  due_at: "2026-09-18T09:00:00+05:00",
  created_at: "2026-09-12T09:00:00+05:00",
  submissions_count: 3,
  turned_in_count: 0,
});

// Nobody is enrolled yet: the teacher is the class's only member.
const GEOMETRY = classRow(2, "Geometry", { members_count: 1, student_count: 0 });

// Due three days ago, in that class.
const DIAGNOSTIC = homework(201, "Diagnostic", {
  due_at: "2026-09-10T09:00:00+05:00",
  created_at: "2026-09-09T09:00:00+05:00",
  submissions_count: 0,
  turned_in_count: 0,
});

let host: HTMLDivElement;
let root: Root;

/** Serve `classes` and their homework through the real contract parsers, and mount the hub. */
async function renderHub(classes: object[], homeworkByClass: Record<number, object[]>) {
  api.list.mockImplementation(async () => parseClassroomList(classes, "GET /classes/"));
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(homeworkByClass[classId] ?? [], `GET /classes/${classId}/assignments/`),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HomeworkGradingHub basePath={BASE} homeworkManagementHref="/teacher/homework" homeworkManagementLabel="Homework" />,
    ),
  );
  const loading = () => host.querySelector(".animate-spin") != null;
  for (let tick = 0; tick < 50 && loading(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (loading()) throw new Error("the hub never finished loading");
  if (host.textContent?.includes("Could not load homework.")) throw new Error("the hub failed to load");
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The row that opens homework `id` of class `classId`. */
function row(classId: number, id: number): Element {
  const link = host.querySelector(`a[href="${BASE}/${classId}/${id}"]`);
  if (!link) throw new Error(`no row for homework ${id}`);
  return link;
}

/** The badges on a row: "N missing" and "All in". */
function badges(el: Element): string[] {
  return [...el.querySelectorAll("span")].map(text).filter((t) => /^\d+ missing$/.test(t) || t === "All in");
}

/** A row's "N / M submitted" line, or null when it has none. */
function submittedLine(el: Element): string | null {
  return [...el.querySelectorAll("span")].map(text).find((t) => t.endsWith(" submitted")) ?? null;
}

/** The overdue banner's headline, or null when there is no banner. */
function banner(): string | null {
  return [...host.querySelectorAll("p")].map(text).find((t) => t.includes("overdue with missing submissions")) ?? null;
}

/** The homework rows from top to bottom, by the page each one opens. */
function order(): string[] {
  return [...host.querySelectorAll(`a[href^="${BASE}/"]`)].map((a) => a.getAttribute("href") ?? "");
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `Date` only: faking the timer functions too would freeze the queues `act` waits on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("HomeworkGradingHub — who has turned the homework in", () => {
  it("reads All in when every student turned it in, and never counts the teacher or the TA as owing it", async () => {
    await renderHub([ALGEBRA], { 1: [ESSAY, WORKSHEET, READING] });

    expect(badges(row(1, 101))).toEqual(["All in"]);
    expect(submittedLine(row(1, 101))).toBe("20 / 20 submitted");
  });

  it("counts a draft or work returned for revision as missing, and not the work of a student who left", async () => {
    await renderHub([ALGEBRA], { 1: [ESSAY, WORKSHEET, READING] });

    expect(badges(row(1, 102))).toEqual(["4 missing"]);
    expect(submittedLine(row(1, 102))).toBe("16 / 20 submitted");
    expect(submittedLine(row(1, 103))).toBe("0 / 20 submitted");
  });

  it("raises the banner for, and lists first, only the overdue homework that is really missing work", async () => {
    await renderHub([ALGEBRA], { 1: [ESSAY, WORKSHEET, READING] });

    expect(banner()).toBe("1 assignment overdue with missing submissions");
    // Worksheet is overdue and missing four. The rest follow, latest deadline first.
    expect(order()).toEqual([`${BASE}/1/102`, `${BASE}/1/103`, `${BASE}/1/101`]);
  });

  it("calls homework in a class with no students neither All in nor missing anyone", async () => {
    await renderHub([GEOMETRY], { 2: [DIAGNOSTIC] });

    expect(badges(row(2, 201))).toEqual([]);
    expect(submittedLine(row(2, 201))).toBe("0 / 0 submitted");
    expect(banner()).toBeNull();
  });

  it("does not fall back to submissions_count when the server sends no turned_in_count", async () => {
    const fromAnOlderServer = homework(101, "Essay", {
      due_at: ESSAY.due_at,
      created_at: ESSAY.created_at,
      submissions_count: ESSAY.submissions_count,
    });
    await renderHub([ALGEBRA], { 1: [fromAnOlderServer] });

    expect(badges(row(1, 101))).toEqual([]);
    expect(submittedLine(row(1, 101))).toBeNull();
    expect(banner()).toBeNull();
  });
});
