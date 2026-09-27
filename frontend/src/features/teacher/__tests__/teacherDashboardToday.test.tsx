/**
 * The teacher dashboard: what a teacher sees on opening.
 *
 * The owner's requirements, read back as assertions — the class whose lesson is running
 * stands first and its row opens that classroom; every class shows its day, time and room;
 * the grading queue nests class → homework → student; the figures are stated in text as well
 * as drawn. The last cases pin the rule this product keeps breaking: a request that failed
 * says so, in its own block, and never renders as "there is nothing here".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const teacherToday = vi.fn();

vi.mock("@/lib/api", () => ({ classesApi: { teacherToday: () => teacherToday() } }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { TeacherDashboard } = await import("../TeacherDashboard");

const PAYLOAD = {
  date: "2026-09-21",
  now: "2026-09-21T10:35:00+05:00",
  next_lesson_date: "2026-09-22",
  classes: [
    {
      classroom_id: 1, name: "Math Junior 3", subject: "MATH", room: "22",
      lesson_days: "ODD", lesson_days_label: "Mon, Wed, Fri", lesson_time: "10:00",
      student_count: 14, next_lesson_at: "2026-09-21T10:00:00+05:00", state: "now",
      homework: {
        assignment_id: 91, title: "Linear functions, set 4", turned_in: 11, missing: 3,
        missing_students: [{ id: 7, name: "Aziza K." }, { id: 8, name: "Bekzod T." }, { id: 9, name: "Malika R." }],
      },
    },
    {
      classroom_id: 3, name: "Math Senior 2", subject: "MATH", room: "6",
      lesson_days: "EVEN", lesson_days_label: "Tue, Thu, Sat", lesson_time: "18:00",
      student_count: 12, next_lesson_at: "2026-09-22T18:00:00+05:00", state: "upcoming", homework: null,
    },
    {
      classroom_id: 4, name: "Reading Junior 2", subject: "ENGLISH", room: "",
      lesson_days: "", lesson_days_label: "", lesson_time: null,
      student_count: 9, next_lesson_at: null, state: "off", homework: null,
    },
  ],
  grading_queue: [
    {
      classroom_id: 1, name: "Math Junior 3", waiting: 9,
      assignments: [
        {
          assignment_id: 88, title: "Quadratics, week 3", waiting: 6,
          students: [
            { id: 11, name: "Dilnoza S.", submitted_at: "2026-09-19T19:10:00+05:00" },
            { id: 12, name: "Eldor U.", submitted_at: "2026-09-20T08:02:00+05:00" },
          ],
        },
      ],
    },
  ],
  upcoming_midterms: [
    { midterm_id: 5, title: "September midterm", classroom_id: 1, name: "Math Junior 3", starts_at: "2026-09-24T10:00:00+05:00", pass_mark: 60 },
  ],
  stats: {
    attendance_week: [{ classroom_id: 1, name: "Math Junior 3", present: 38, late: 3, missed: 5, excused: 1 }],
    homework_30d: [{ classroom_id: 1, name: "Math Junior 3", expected: 126, turned_in: 98 }],
    attendance_trend: [
      { date: "2026-09-17", present: 83, late: 4, missed: 6 },
      { date: "2026-09-19", present: 77, late: 5, missed: 10 },
    ],
  },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  teacherToday.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeacherDashboard />
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
}

const text = () => host.textContent ?? "";
const links = () => [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));

describe("the teacher dashboard — the classes", () => {
  it("lists them in the order the server sent, the running lesson first", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    const names = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
    const first = names.findIndex((t) => t.includes("Math Junior 3"));
    const second = names.findIndex((t) => t.includes("Math Senior 2"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
    expect(text()).toContain("In the lesson now");
  });

  it("shows each class's time, room and lesson days", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("10:00");
    expect(text()).toContain("Room 22");
    expect(text()).toContain("Mon, Wed, Fri");
    expect(text()).toContain("18:00");
    expect(text()).toContain("Room 6");
    expect(text()).toContain("Tue, Thu, Sat");
    expect(text()).toContain("14 students");
  });

  it("opens the classroom from the class row", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();
    expect(links()).toContain("/teacher/classrooms/1");
    expect(links()).toContain("/teacher/classrooms/3");
  });

  it("still lists a class with no room, no time and no lesson day", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();
    expect(text()).toContain("Reading Junior 2");
    expect(text()).toContain("Time not set");
    expect(text()).toContain("No lesson day set");
  });

  it("names the students who have not turned homework in", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();
    expect(text()).toContain("11/14 turned in");
    expect(text()).toContain("3 not turned in");
    expect(text()).toContain("Aziza K.");
    expect(text()).toContain("Malika R.");
    expect(text()).toContain("Linear functions, set 4");
  });
});

describe("the teacher dashboard — manual grading", () => {
  it("nests class, then homework, then the students waiting", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("Waiting for you to check");
    expect(text()).toContain("Math Junior 3");
    expect(text()).toContain("Quadratics, week 3");
    expect(text()).toContain("Dilnoza S.");
    expect(text()).toContain("Eldor U.");
    // Into that homework on the one grading screen, not into a second grading surface.
    expect(links()).toContain("/teacher/grading?class=1&homework=88");
  });

  it("says how many are hidden when the server capped the list", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();
    // Six are waiting on that homework and two names came back.
    expect(text()).toContain("6 to check");
    expect(text()).toContain("+4 more");
  });
});

describe("the teacher dashboard — the figures", () => {
  it("states the numbers in words, not only in colour", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("Where the marking sits");
    expect(text()).toContain("Who came this week");
    // 38 present + 3 late of 47 marks
    expect(text()).toContain("87% came");
    // 98 of 126 expected
    expect(text()).toContain("78% · 98/126");
    expect(text()).toContain("Is attendance holding up");
  });

  it("shows the midterm coming and the mark that counts as a pass", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();
    expect(text()).toContain("September midterm");
    expect(text()).toContain("Pass mark");
    expect(text()).toContain("60");
  });
});

describe("the teacher dashboard — when a load fails", () => {
  it("says so in every block and never as an empty state", async () => {
    teacherToday.mockRejectedValue(new Error("network"));
    await mount();

    expect(text()).toContain("Your classes didn't load");
    expect(host.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);
    expect(text()).not.toContain("No classes yet");
    expect(text()).not.toContain("Nothing waiting");
  });

  it("tells a teacher with no classes the one true thing, once", async () => {
    teacherToday.mockResolvedValue({ ...PAYLOAD, classes: [], grading_queue: [], stats: {} });
    await mount();

    expect(text()).toContain("No classes yet");
    expect(text()).not.toContain("Waiting for you to check");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
