/**
 * Opening a classroom as a teacher: "what needs me today", in place of the rankings board.
 *
 * What the slice promised, read back as assertions: every number comes from a request the
 * workspace already makes; each block ends in the tab that acts on it; a block whose request
 * failed says so and keeps its retry while the rest of the overview still renders; and a class
 * with nothing outstanding reads as calm rather than as broken.
 *
 * The last two are the pair this product keeps getting wrong — a failed request drawn as "there
 * is nothing here" tells a teacher their class is clear when the server merely said no.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const getInterventions = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  classesApi: {
    getInterventions: (classId: number) => getInterventions(classId),
    gradeSubmission: vi.fn(),
    returnSubmission: vi.fn(),
  },
}));

const { TeacherClassroomOverview } = await import("../classroomOverview");

/** 09:00 on a Monday in Tashkent — the suite's pinned zone, so "Tomorrow" means Sep 22. */
const NOW = new Date("2026-09-21T09:00:00+05:00");

const CLASSROOM = { id: 34, name: "Math Junior 3", my_role: "TEACHER", subject: "MATH" };

/** `GET /classes/34/lessons/` — a lesson tomorrow and a midterm at the end of the week. */
const PLAN = {
  bound: true,
  reason: "",
  focus_lesson_id: 12,
  focus: "next",
  journal: { id: 3, title: "Math Junior", subject: "MATH", level: "junior" },
  lessons: [
    { lesson_id: 11, lesson_number: 11, lesson_type: "HOMEWORK", title: "Linear functions", scheduled_for: "2026-09-19", is_ready: true, grants: [] },
    { lesson_id: 12, lesson_number: 12, lesson_type: "HOMEWORK", title: "Quadratics", scheduled_for: "2026-09-22", is_ready: true, grants: [] },
    {
      lesson_id: 16, lesson_number: 16, lesson_type: "MIDTERM", title: "Midterm week", scheduled_for: "2026-09-26",
      is_ready: false, grants: [], midterm: { exam_id: 5, title: "Math Midterm 3", granted: true, has_start_code: false, start_code: "", access_days_before: 1, starts_at: null },
    },
  ],
};

/** `GET /classes/34/attendance/sessions/` — today's register is open and untouched. */
const SESSIONS = {
  schedule_is_usable: true,
  sessions: [{ id: 5, date: "2026-09-21", title: "Lesson 11", lesson_index: 11, status: "OPEN", counts: {} }],
};

/** `GET /classes/34/gradebook/` — one homework due tomorrow, one overdue, one self-marking quiz. */
const GRADEBOOK = {
  students: 12,
  needs_grading_total: 6,
  assignments: [
    {
      id: 91, title: "Quadratics, set 4", status: "PUBLISHED", category: "HOMEWORK",
      due_at: "2026-09-22T18:00:00+05:00", is_auto_graded: false, source_label: "Manual", max_score: "100.00",
      counts: { graded: 5, needs_grading: 3, submitted: 3, needs_revision: 0, missing: 4, total: 12 },
      performance: null,
    },
    {
      id: 88, title: "Circles, week 4", status: "PUBLISHED", category: "HOMEWORK",
      due_at: "2026-09-15T18:00:00+05:00", is_auto_graded: false, source_label: "Manual", max_score: "100.00",
      counts: { graded: 10, needs_grading: 1, submitted: 1, needs_revision: 0, missing: 1, total: 12 },
      performance: null,
    },
    {
      id: 70, title: "Vocabulary check", status: "PUBLISHED", category: "HOMEWORK",
      due_at: "2026-09-24T18:00:00+05:00", is_auto_graded: true, source_label: "Quiz", max_score: "20.00",
      counts: { graded: 8, needs_grading: 2, submitted: 2, needs_revision: 0, missing: 2, total: 12 },
      performance: null,
    },
  ],
};

/** `GET /classes/34/gradebook/assignments/91/` — only the four who have not turned it in matter here. */
const GRADES = {
  assignment: GRADEBOOK.assignments[0],
  counts: GRADEBOOK.assignments[0].counts,
  performance: null,
  roster: [
    { student_id: 1, name: "Sardor Tursunov", email: "s@e.uz", status: "GRADED", grade: "88.00", max_score: "100.00", source: "TEACHER", submission_id: 1 },
    { student_id: 7, name: "Aziza Karimova", email: "a@e.uz", status: "MISSING", grade: null, max_score: null, source: null, submission_id: null },
    { student_id: 8, name: "Bekzod Rahimov", email: "b@e.uz", status: "MISSING", grade: null, max_score: null, source: null, submission_id: null },
    { student_id: 9, name: "Malika Rustamova", email: "m@e.uz", status: "MISSING", grade: null, max_score: null, source: null, submission_id: null },
    { student_id: 10, name: "Nodira Yusupova", email: "n@e.uz", status: "MISSING", grade: null, max_score: null, source: null, submission_id: null },
  ],
};

/** `GET /classes/34/interventions/` — the three signals the panel already computes. */
const INTERVENTIONS = {
  low_score_students: [{ student_id: 7, first_name: "Aziza", last_name: "Karimova", avg_score_pct: 44 }],
  overdue_students: [{ student_id: 8, first_name: "Bekzod", last_name: "Rahimov", overdue_count: 2 }],
  inactive_students: [{ student_id: 9, first_name: "Malika", last_name: "Rustamova", days_inactive: 9 }],
  completion_summary: [],
  class_stats: { student_count: 12, assignment_count: 3, overall_completion_pct: 71, avg_assessment_score_pct: 64 },
};

/** A class between terms: a plan with no dates left, no register, no homework, nobody flagged. */
const CALM = {
  plan: { bound: true, reason: "", focus_lesson_id: null, focus: "undated", journal: null, lessons: [] },
  sessions: { schedule_is_usable: true, sessions: [] },
  gradebook: { students: 12, needs_grading_total: 0, assignments: [] },
  interventions: { low_score_students: [], overdue_students: [], inactive_students: [], completion_summary: [], class_stats: {} },
};

/** An axios rejection the way the server sends one, reason included when it gave one. */
function httpError(status: number, detail?: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: detail ? { detail } : {} },
  });
}

let host: HTMLElement;
let root: Root;
const opened: string[] = [];

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Date only: the settle loop below still needs a real setTimeout to hand control back.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  getInterventions.mockReset();
  opened.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function settle(ticks = 20) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

type Fixtures = { plan?: unknown; sessions?: unknown; gradebook?: unknown; grades?: unknown; interventions?: unknown };

/** Mount the overview with each block's request answered — or, for a `Error`, refused. */
async function mount(fx: Fixtures = {}) {
  const serve = async (value: unknown) => {
    if (value instanceof Error) throw value;
    return { data: value };
  };
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/lessons/") return serve(fx.plan ?? PLAN);
    if (url === "/classes/34/attendance/sessions/") return serve(fx.sessions ?? SESSIONS);
    if (url === "/classes/34/gradebook/") return serve(fx.gradebook ?? GRADEBOOK);
    if (url === "/classes/34/gradebook/assignments/91/") return serve(fx.grades ?? GRADES);
    if (url === "/classes/34/rankings/academic/") return serve({ kind: "ACADEMIC", period_key: null, config: { leaderboard_mode: "FULL", hide_score_values: false }, can_configure: true, can_recompute: true, my: null, rows: [] });
    throw new Error(`unexpected GET ${url}`);
  });
  getInterventions.mockImplementation(async () => {
    const value = fx.interventions ?? INTERVENTIONS;
    if (value instanceof Error) throw value;
    return value;
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeacherClassroomOverview
          classroom={CLASSROOM as never}
          onOpenTab={(tab) => opened.push(tab)}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);

async function press(label: string) {
  const el = button(label);
  if (!el) throw new Error(`no button labelled "${label}"`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the teacher's classroom overview", () => {
  it("answers what needs me today, from what the workspace already fetches", async () => {
    await mount();

    // Turned in = everyone who handed something over: 12 students less the 4 who have not.
    expect(host.textContent).toContain("Homework due next");
    expect(host.textContent).toContain("8");
    expect(host.textContent).toContain("/ 12");
    expect(host.textContent).toContain("Quadratics, set 4");
    expect(host.textContent).toContain("Due Tomorrow");
    // Who has not, by name — the count comes from the summary, the names from the grades.
    expect(host.textContent).toContain("Not turned in: Aziza Karimova, Bekzod Rahimov, Malika Rustamova +1 more");

    // The register opened by itself this morning and has not been finalised. The payload does
    // not say how much of it has been marked (its `counts` is null on every response), so the
    // card must not claim either way.
    expect(host.textContent).toContain("Today's register");
    expect(host.textContent).toContain("Not finalised yet");
    expect(host.textContent).not.toContain("Not marked yet");

    // Waiting to be graded leaves the self-marking quiz out — it is not a job for a teacher.
    expect(host.textContent).toContain("Waiting to be graded");
    expect(host.textContent).toContain("3 to grade");
    expect(host.textContent).toContain("1 to grade");
    expect(host.textContent).not.toContain("Vocabulary check");

    // The next lesson, and the midterm after it.
    expect(host.textContent).toContain("Next lesson");
    expect(host.textContent).toContain("Lesson 12 · Quadratics");
    expect(host.textContent).toContain("Midterm coming");
    expect(host.textContent).toContain("Math Midterm 3");

    // The handful of students to speak to, hardest signal first, one row each.
    expect(host.textContent).toContain("Students who need you");
    expect(host.textContent).toContain("Aziza Karimova");
    expect(host.textContent).toContain("Averaging 44%");
    expect(host.textContent).toContain("2 pieces not turned in");
    expect(host.textContent).toContain("No activity for 9 days");
  });

  it("keeps the panel's words: nothing is 'missing', and no class list is a 'roster'", async () => {
    await mount();
    expect(host.textContent).not.toContain("Missing");
    expect(host.textContent?.toLowerCase()).not.toContain("roster");
    expect(host.textContent?.toLowerCase()).not.toContain("school");
  });

  it("is a place to leave: every block opens the tab that acts on it", async () => {
    await mount();

    await press("Open attendance");
    await press("Open the homework");
    await press("Open grading");
    await press("Open lessons");
    await press("Open midterms");
    await press("Open the class list");

    expect(opened).toEqual(["attendance", "assignments", "grading", "lessons", "midterms", "people"]);
  });

  it("keeps the rankings one press away, and does not fetch the board until asked", async () => {
    await mount();

    expect(host.textContent).toContain("The XP board");
    expect(get).not.toHaveBeenCalledWith("/classes/34/rankings/academic/");

    await press("Show rankings");
    await settle();

    expect(get).toHaveBeenCalledWith("/classes/34/rankings/academic/");
    expect(button("Hide rankings")).toBeTruthy();
  });

  it("lets one refused block say so, with its retry, while the rest still renders", async () => {
    await mount({ interventions: httpError(403, "You do not have permission to perform this action.") });

    // The block that failed says it failed, and gives the server's reason.
    expect(host.textContent).toContain("We couldn't load the class signals");
    expect(host.textContent).toContain("You do not have permission to perform this action.");
    expect(button("Try again")).toBeTruthy();
    // It must never read as "there is nobody to worry about".
    expect(host.textContent).not.toContain("Everyone is keeping up");

    // Everything else is untouched.
    expect(host.textContent).toContain("Not finalised yet");
    expect(host.textContent).toContain("Quadratics, set 4");
    expect(host.textContent).toContain("3 to grade");
    expect(host.textContent).toContain("Lesson 12 · Quadratics");
  });

  it("still gives the count when only the names of who has not turned it in fail", async () => {
    await mount({ grades: httpError(500) });

    expect(host.textContent).toContain("4 not turned in");
    expect(host.textContent).toContain("the names didn't load, try again");
    // The figure the teacher acts on is from the summary, so it survives.
    expect(host.textContent).toContain("/ 12");
  });

  it("does not promise a register that will never open", async () => {
    // `schedule_is_usable` false: the server cannot work out this class's lesson days at all,
    // so nothing materialises on its own — ever. "A register opens by itself on each lesson
    // day" would be a teacher waiting for something that is not coming.
    await mount({ sessions: { schedule_is_usable: false, sessions: [] } });

    expect(host.textContent).toContain("No register opens on its own");
    expect(host.textContent).toContain("Add today's register from Attendance");
    expect(host.textContent).not.toContain("A register opens by itself");
    // The way out is the button that was already there.
    expect(button("Open attendance")).toBeTruthy();
  });

  it("still says no lesson today when the schedule is fine and the day is simply empty", async () => {
    await mount({ sessions: { schedule_is_usable: true, sessions: [] } });

    expect(host.textContent).toContain("No lesson today");
    expect(host.textContent).toContain("A register opens by itself");
    expect(host.textContent).not.toContain("No register opens on its own");
  });

  it("reads as calm, not as broken, for a class with nothing outstanding", async () => {
    await mount({ ...CALM, grades: httpError(500) });

    expect(host.textContent).toContain("No lesson today");
    expect(host.textContent).toContain("Nothing due at the next lesson");
    expect(host.textContent).toContain("Nothing waiting");
    expect(host.textContent).toContain("Everyone is keeping up");
    expect(host.textContent).toContain("No lesson scheduled");
    // No midterm card at all — most classes have none most of the time.
    expect(host.textContent).not.toContain("Midterm coming");
    // And nothing anywhere claims a request went wrong.
    expect(host.textContent).not.toContain("We couldn't load");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
