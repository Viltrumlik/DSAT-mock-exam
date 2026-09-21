import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * Unpublished homework on the homework grading hub (`/teacher/homework/grading`).
 *
 * The teaching team's assignment list leaves archived homework out but keeps drafts, and a draft has
 * a deadline from the moment it is saved: `create` gives homework the start of the class's next
 * lesson whatever its status, and only publishing replaces it. Once that lesson began, the hub
 * called the draft overdue with every student missing it, listed it first, counted it in the
 * "past due with work not turned in" banner and asked whether it had been communicated to students —
 * about homework no student can see or turn in.
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
// Sunday noon in Tashkent. The class below meets on Monday, Wednesday and Friday at 18:00.
const NOW = new Date("2026-09-13T12:00:00+05:00");

/**
 * A `GET /api/classes/` row, in the serializer's wire shape, for a class the user teaches: 20 students,
 * their teacher and a TA. It carries both `members_count` and `student_count`, and each homework both
 * `submissions_count` and `turned_in_count`, so nothing here depends on how the hub counts who is
 * missing.
 */
const ALGEBRA = {
  id: 1,
  name: "Algebra 2",
  subject: "MATH",
  lesson_days: "ODD",
  join_code: "JOIN1",
  my_role: "ADMIN",
  members_count: 22,
  student_count: 20,
};

/** A `GET /api/classes/<id>/assignments/` row as the teaching team receives it. */
function homework(
  id: number,
  title: string,
  status: "DRAFT" | "PUBLISHED",
  fields: { created_at: string; due_at: string; submissions_count: number; turned_in_count: number },
) {
  return { id, title, status, ...fields };
}

// Published after Friday's lesson and due at Monday's. 16 of the 20 students turned it in.
const WORKSHEET = homework(101, "Worksheet", "PUBLISHED", {
  created_at: "2026-09-04T19:00:00+05:00",
  due_at: "2026-09-07T18:00:00+05:00",
  submissions_count: 16,
  turned_in_count: 16,
});

// Saved as a draft after Wednesday's lesson and never published. It was still given Friday's lesson
// as a deadline, which has passed; no student has been able to see it, let alone turn it in.
const DRAFT = homework(102, "Unit 3 review", "DRAFT", {
  created_at: "2026-09-09T19:00:00+05:00",
  due_at: "2026-09-11T18:00:00+05:00",
  submissions_count: 0,
  turned_in_count: 0,
});

// Published after Friday's lesson and due at tomorrow's. 5 students have turned it in so far.
const READING = homework(103, "Reading", "PUBLISHED", {
  created_at: "2026-09-11T19:00:00+05:00",
  due_at: "2026-09-14T18:00:00+05:00",
  submissions_count: 5,
  turned_in_count: 5,
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

/** The homework rows from top to bottom, by the page each one opens. */
function order(): string[] {
  return [...host.querySelectorAll(`a[href^="${BASE}/"]`)].map((a) => a.getAttribute("href") ?? "");
}

/** The overdue banner's headline, or null when there is no banner. */
function banner(): string | null {
  return [...host.querySelectorAll("p")].map(text).find((t) => t.includes("past due with work not turned in")) ?? null;
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

describe("HomeworkGradingHub — homework that has not reached students", () => {
  it("leaves a draft out, though the deadline it was saved with has passed", async () => {
    await renderHub([ALGEBRA], { 1: [WORKSHEET, DRAFT, READING] });

    // Not listed, so neither first nor marked overdue with everyone missing.
    expect(order()).toEqual([`${BASE}/1/101`, `${BASE}/1/103`]);
    expect(host.textContent).not.toContain("Unit 3 review");
    // The worksheet is still overdue with work missing, and alone in the banner.
    expect(banner()).toBe("1 assignment past due with work not turned in");
    // Nor is anyone asked whether the draft reached students.
    expect(host.textContent).not.toContain("was this assignment communicated to students?");
  });

  it("shows the empty state when every homework is still a draft", async () => {
    await renderHub([ALGEBRA], { 1: [DRAFT] });

    expect(order()).toEqual([]);
    expect(banner()).toBeNull();
    expect(host.textContent).toContain("No assignments to grade yet");
  });

  it("leaves out only what says it is a draft: a row that names no status is still listed", async () => {
    // The contract does not require `status`. Hiding homework whose row lacks it would turn a missing
    // field into "No assignments to grade yet".
    const { id, title, created_at, due_at, submissions_count, turned_in_count } = READING;
    await renderHub([ALGEBRA], { 1: [{ id, title, created_at, due_at, submissions_count, turned_in_count }] });

    expect(order()).toEqual([`${BASE}/1/103`]);
  });
});
