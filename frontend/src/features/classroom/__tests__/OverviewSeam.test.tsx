/**
 * The seam. `features/classroom/**` is mounted by BOTH hosts — the student site at
 * `/classes/[classId]`, which passes `consumer` and so rewrites `my_role` to STUDENT before
 * capabilities are derived, and the teacher portal at `/teacher/classrooms/[classId]`.
 *
 * Overview is the one slot that now differs between them: a teacher gets "what needs me today",
 * everyone else gets the rankings board exactly as before. The branch is on `caps.isStaff`, and
 * these tests are why — a branch on the route would be a branch on nothing, because it is the
 * same component tree on both hosts, and `consumer` is precisely the case where the route says
 * teacher and the viewer must be served as a student.
 *
 * A student must not be able to tell this slice happened.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const get = vi.fn();
const getInterventions = vi.fn();
const replace = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  classesApi: {
    get: async (classId: number) => (await get(`/classes/${classId}/`)).data,
    getInterventions: (classId: number) => getInterventions(classId),
    gradeSubmission: vi.fn(),
    returnSubmission: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/classrooms/34",
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ classId: "34" }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me: { role: "teacher" }, bootState: "AUTHENTICATED" }) }));

const { ClassroomWorkspace } = await import("../ClassroomWorkspace");
// The workspace loads the teacher overview with `React.lazy`, so the teacher kit stays out of
// the chunk a student's browser downloads. Warm it here: transforming that module on demand
// takes longer than the settle loop's ticks when the whole directory runs at once, and the
// assertions below are about which branch renders, not about how fast a chunk arrives.
await import("@/features/teacher/classroomOverview");

const NOW = new Date("2026-09-21T09:00:00+05:00");

/** Every line of copy that belongs to the teacher overview and to nothing else. */
const TEACHER_ONLY = [
  "Today's register",
  "Homework due next",
  "Waiting to be graded",
  "Next lesson",
  "Students who need you",
  "Not turned in",
  "Open attendance",
  "Open grading",
  "Open the class list",
];

const BOARD = {
  kind: "ACADEMIC",
  period_key: "2026-09",
  config: { leaderboard_mode: "FULL", hide_score_values: false },
  can_configure: false,
  can_recompute: false,
  my: { rank: 2, is_me: true, name: "Bekzod Rahimov", score: 940, previous_rank: 3, rank_change: 1, trend: "IMPROVING", percentile: 80, confidence: "HIGH", components: null },
  rows: [
    { rank: 1, is_me: false, name: "Aziza Karimova", score: 1180, previous_rank: 1, rank_change: 0, trend: "STABLE", percentile: 95, confidence: "HIGH", components: null },
    { rank: 2, is_me: true, name: "Bekzod Rahimov", score: 940, previous_rank: 3, rank_change: 1, trend: "IMPROVING", percentile: 80, confidence: "HIGH", components: null },
    { rank: 3, is_me: false, name: "Malika Rustamova", score: 720, previous_rank: 2, rank_change: -1, trend: "DECLINING", percentile: 60, confidence: "MEDIUM", components: null },
    { rank: 4, is_me: false, name: "Sardor Tursunov", score: 610, previous_rank: 4, rank_change: 0, trend: "STABLE", percentile: 40, confidence: "LOW", components: null },
  ],
};

const PLAN = {
  bound: true, reason: "", focus_lesson_id: 12, focus: "next", journal: null,
  lessons: [{ lesson_id: 12, lesson_number: 12, lesson_type: "HOMEWORK", title: "Quadratics", scheduled_for: "2026-09-22", is_ready: true, grants: [] }],
};
const SESSIONS = {
  schedule_is_usable: true,
  sessions: [{ id: 5, date: "2026-09-21", title: "Lesson 11", lesson_index: 11, status: "OPEN", counts: {} }],
};
const GRADEBOOK = {
  students: 12,
  needs_grading_total: 3,
  assignments: [{
    id: 91, title: "Quadratics, set 4", status: "PUBLISHED", category: "HOMEWORK",
    due_at: "2026-09-22T18:00:00+05:00", is_auto_graded: false, source_label: "Manual", max_score: "100.00",
    counts: { graded: 5, needs_grading: 3, submitted: 3, needs_revision: 0, missing: 4, total: 12 },
    performance: null,
  }],
};
const GRADES = {
  assignment: GRADEBOOK.assignments[0], counts: GRADEBOOK.assignments[0].counts, performance: null,
  roster: [{ student_id: 7, name: "Aziza Karimova", email: "a@e.uz", status: "MISSING", grade: null, max_score: null, source: null, submission_id: null }],
};
const INTERVENTIONS = {
  low_score_students: [], overdue_students: [], inactive_students: [],
  completion_summary: [], class_stats: { student_count: 12 },
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  getInterventions.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function settle(ticks = 25) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the workspace on Overview as `role`, on the student site when `consumer`. */
async function mount({ role, consumer }: { role: string; consumer?: boolean }) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/") return { data: { id: 34, name: "Math Junior 3", my_role: role, subject: "MATH", student_count: 12, join_code: "ABC123" } };
    if (url === "/classes/34/rankings/academic/") return { data: BOARD };
    if (url === "/classes/34/telegram/") return { data: { managed: false, status: "NONE" } };
    if (url === "/classes/34/lessons/") return { data: PLAN };
    if (url === "/classes/34/attendance/sessions/") return { data: SESSIONS };
    if (url === "/classes/34/gradebook/") return { data: GRADEBOOK };
    if (url === "/classes/34/gradebook/assignments/91/") return { data: GRADES };
    throw new Error(`unexpected GET ${url}`);
  });
  getInterventions.mockImplementation(async () => INTERVENTIONS);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ClassroomWorkspace classId={34} consumer={consumer} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const urlsFetched = () => get.mock.calls.map((c) => String(c[0]));

describe("the Overview slot, on both hosts", () => {
  it("gives a student the rankings board, and none of the teacher overview", async () => {
    await mount({ role: "STUDENT" });

    expect(host.textContent).toContain("Class rankings");
    expect(host.textContent).toContain("Aziza Karimova");
    expect(host.textContent).toContain("1,180 XP");
    for (const line of TEACHER_ONLY) expect(host.textContent).not.toContain(line);
  });

  it("gives a TEACHER account on the student site the same board — the rewrite decides, not the route", async () => {
    // `consumer` is the student site mounting the same component tree at /classes/34. The
    // account is a teacher; `my_role` is rewritten to STUDENT before capabilities are derived,
    // so the staff branch must not fire even though the pathname says /teacher/.
    await mount({ role: "TEACHER", consumer: true });

    expect(host.textContent).toContain("Class rankings");
    expect(host.textContent).toContain("Aziza Karimova");
    for (const line of TEACHER_ONLY) expect(host.textContent).not.toContain(line);
  });

  it("asks for nothing a student's account may not read", async () => {
    await mount({ role: "TEACHER", consumer: true });

    expect(getInterventions).not.toHaveBeenCalled();
    expect(urlsFetched()).not.toContain("/classes/34/lessons/");
    expect(urlsFetched()).not.toContain("/classes/34/attendance/sessions/");
    expect(urlsFetched()).not.toContain("/classes/34/gradebook/");
  });

  it("gives a teacher what needs them today, with the board one press away", async () => {
    await mount({ role: "TEACHER" });

    expect(host.textContent).toContain("Today's register");
    expect(host.textContent).toContain("Homework due next");
    expect(host.textContent).toContain("Waiting to be graded");
    expect(host.textContent).toContain("Students who need you");
    // The board is still reachable, but it is not the page any more. The card is titled "The
    // XP board" because Rankings renders its own "Class rankings" heading once opened.
    expect(host.textContent).toContain("The XP board");
    expect(host.textContent).not.toContain("1,180 XP");
  });

  it("serves a TA the same overview — every staff seat, not just the class's teacher", async () => {
    await mount({ role: "TA" });
    expect(host.textContent).toContain("Today's register");
    expect(host.textContent).toContain("Waiting to be graded");
  });
});
