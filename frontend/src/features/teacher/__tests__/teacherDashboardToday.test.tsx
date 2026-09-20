/**
 * The teacher dashboard, rebuilt: what a teacher sees on opening.
 *
 * Two teachers asked for the same two things — today's lessons with their times, and who has
 * not uploaded homework — so these tests read the rendered list, not merely that something
 * rendered. The last two pin the rule this product keeps breaking: a request that failed says
 * so, in its own block, while the rest of the page still works. It never renders as "nothing
 * here", which would tell a teacher their class is empty when the server simply said no.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const teacherToday = vi.fn();
const list = vi.fn();
const getInterventions = vi.fn();

vi.mock("@/lib/api", () => ({
  classesApi: {
    teacherToday: () => teacherToday(),
    list: () => list(),
    getInterventions: (id: number) => getInterventions(id),
  },
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { TeacherDashboard } = await import("../TeacherDashboard");

const PAYLOAD = {
  date: "2026-09-21",
  next_lesson_date: "2026-09-22",
  lessons: [
    {
      classroom_id: 1, name: "Math Junior 3", subject: "MATH", lesson_time: "10:00", student_count: 14,
      homework: {
        assignment_id: 91, title: "Linear functions, set 4", turned_in: 11, missing: 3,
        missing_students: [{ id: 7, name: "Aziza K." }, { id: 8, name: "Bekzod T." }, { id: 9, name: "Malika R." }],
      },
    },
    {
      classroom_id: 2, name: "Reading Senior 1", subject: "ENGLISH", lesson_time: "14:30", student_count: 18,
      homework: { assignment_id: 92, title: "Inference set 7", turned_in: 18, missing: 0, missing_students: [] },
    },
    { classroom_id: 3, name: "Math Senior 2", subject: "MATH", lesson_time: "", student_count: 12, homework: null },
  ],
  waiting_to_check: [{ classroom_id: 1, name: "Math Junior 3", count: 7 }],
  upcoming_midterms: [
    { midterm_id: 5, title: "September midterm", classroom_id: 1, name: "Math Junior 3", starts_at: "2026-09-24T10:00:00+05:00", pass_mark: 60 },
  ],
};

const CLASSES = { items: [{ id: 1, name: "Math Junior 3", my_role: "TEACHER" }] };
const INTERVENTIONS = {
  low_score_students: [{ student_id: 7, first_name: "Aziza", last_name: "K.", avg_score_pct: 48 }],
  overdue_students: [{ student_id: 8, first_name: "Bekzod", last_name: "T.", overdue_count: 3 }],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  teacherToday.mockReset();
  list.mockReset();
  getInterventions.mockReset();
  list.mockResolvedValue(CLASSES);
  getInterventions.mockResolvedValue(INTERVENTIONS);
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

describe("the teacher dashboard — today", () => {
  it("lists every lesson today with its time, its class and how much homework is in", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("10:00");
    expect(text()).toContain("Math Junior 3");
    expect(text()).toContain("14:30");
    expect(text()).toContain("Reading Senior 1");
    expect(text()).toContain("11/14 turned in");
    expect(text()).toContain("18/18 turned in");
    // The class with no homework due says so rather than showing an empty count.
    expect(text()).toContain("No homework due");
  });

  it("names the students who have not turned homework in", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("3 not turned in");
    expect(text()).toContain("Aziza K.");
    expect(text()).toContain("Bekzod T.");
    expect(text()).toContain("Malika R.");
    // It is the homework's own title under the names, so the teacher knows which work it is.
    expect(text()).toContain("Linear functions, set 4");
  });

  it("still lists a class whose lesson time was never filled in", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("Math Senior 2");
    expect(text()).toContain("Time not set");
  });

  it("shows the work waiting to be checked and the midterm coming, with its pass mark", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    await mount();

    expect(text()).toContain("Waiting");
    expect(text()).toContain("September midterm");
    expect(text()).toContain("60");
  });

  it("on a day with no lesson, names the next lesson day instead of showing nothing", async () => {
    teacherToday.mockResolvedValue({ ...PAYLOAD, lessons: [] });
    await mount();

    expect(text()).toContain("No lesson today");
    expect(text()).toContain("Your next lesson is Tuesday, Sep 22");
  });

  it("says the lessons did not load, and still renders the rest of the page", async () => {
    teacherToday.mockRejectedValue(new Error("network"));
    await mount();

    expect(text()).toContain("Today's lessons didn't load");
    expect(host.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);
    // Not an empty state: the words that would tell a teacher they have no lesson must not appear.
    expect(text()).not.toContain("No lesson today");
    // The block that did load is untouched.
    expect(text()).toContain("Aziza K.");
  });

  it("keeps today's lessons when the students block is the one that failed", async () => {
    teacherToday.mockResolvedValue(PAYLOAD);
    list.mockRejectedValue({ response: { data: { detail: "You do not have permission." } } });
    await mount();

    expect(text()).toContain("Math Junior 3");
    expect(text()).toContain("11/14 turned in");
    expect(text()).toContain("You do not have permission.");
    // And not the "everyone is on track" line, which would be a lie about students it never read.
    expect(text()).not.toContain("Everyone is on track");
  });
});
