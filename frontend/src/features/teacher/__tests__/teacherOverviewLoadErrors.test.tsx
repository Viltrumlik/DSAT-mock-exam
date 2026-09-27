import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";

/**
 * A request that fails behind the teacher portal's class overview (`/teacher`) and the three pages drawn
 * from one analytics model (`/teacher/analytics` and `/teacher/homework`; the Students page that also read it
 * was removed at the owner's request).
 *
 * Both hooks caught every rejected request and carried on with an empty answer in its place, so a failure
 * was drawn as data:
 * - the class list → "No classes yet", "No students yet", "No assignments yet";
 * - one class's interventions → every total, average and list without that class, down to "Everyone's on
 *   track" and "No one at risk", and its students listed "On track";
 * - one class's leaderboard → a trend without that class, its students left off the list, and its homework
 *   "Healthy" whatever its group mean.
 *
 * A load that fails is its own state: the page says what did not load and offers "Try again", which runs
 * that load again. A load that only partly came back has failed too. Every number on these pages is taken
 * over all of the teacher's classes and every list is ranked across them, so none of it is drawn from some
 * of the classes.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  getInterventions: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
// Recharts needs layout jsdom does not give it (as in MidtermStatsPage.test.tsx). The charts are not what
// these tests are about, so only the charts themselves are stubbed; their cards stay.
vi.mock("@/components/ui/charts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/components/ui/charts")),
  LineChart: () => <div>line chart</div>,
  BarChart: () => <div>bar chart</div>,
  DonutChart: () => <div>donut chart</div>,
}));

const { useTeacherDashboard } = await import("../useTeacherDashboard");
const { useTeacherAnalytics } = await import("../useTeacherAnalytics");
const { TeacherAnalytics } = await import("../TeacherAnalytics");
const { TeacherHomework } = await import("../TeacherHomework");

const DAY = 86_400_000;
/** A datetime `days` from now, in the past when negative. Both hooks read deadlines against the real clock. */
const fromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/**
 * `GET /api/classes/` rows in the serializer's wire shape. TEACHER is kept by the class filter on main and by
 * the one that reads `my_role` through capabilities, and the interventions endpoint answers it both through
 * main's role list and through the `can_view_class_analytics` capability.
 */
const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };
const GEOMETRY = { id: 2, name: "Geometry", subject: "MATH", lesson_days: "EVEN", join_code: "JOIN2", my_role: "TEACHER" };

type Person = { id: number; first_name: string; last_name: string; email: string };
const FIRST: Person = { id: 11, first_name: "First", last_name: "Student", email: "first@example.com" };
const SECOND: Person = { id: 12, first_name: "Second", last_name: "Student", email: "second@example.com" };
const THIRD: Person = { id: 21, first_name: "Third", last_name: "Student", email: "third@example.com" };

/** How an interventions list names a student. */
function studentRef(p: Person) {
  return { student_id: p.id, email: p.email, first_name: p.first_name, last_name: p.last_name, profile_image_url: null };
}

/**
 * `GET /api/classes/<id>/interventions/`, as `ClassroomViewSet.interventions` builds it.
 *
 * Algebra 2 is doing fine. Geometry is where the teacher is needed: its one student averages 45%, has not been
 * active for 15 days and has not turned in "Triangles", and nobody has turned in "Circles", due in two days.
 */
function interventions(classId: number) {
  if (classId === ALGEBRA.id) {
    return {
      overdue_students: [],
      inactive_students: [],
      low_score_students: [],
      completion_summary: [
        { assignment_id: 101, title: "Linear equations", due_at: fromNow(-5), is_overdue: true, is_assessment: false, submitted_count: 2, student_count: 2, completion_pct: 100.0 },
      ],
      class_stats: { student_count: 2, assignment_count: 1, overall_completion_pct: 100.0, avg_assessment_score_pct: 82.0 },
    };
  }
  return {
    overdue_students: [{ ...studentRef(THIRD), overdue_count: 1, oldest_overdue_due_at: fromNow(-3) }],
    inactive_students: [{ ...studentRef(THIRD), last_activity_at: fromNow(-15), days_inactive: 15 }],
    low_score_students: [{ ...studentRef(THIRD), avg_score_pct: 45.0 }],
    completion_summary: [
      { assignment_id: 201, title: "Triangles", due_at: fromNow(-3), is_overdue: true, is_assessment: false, submitted_count: 0, student_count: 1, completion_pct: 0.0 },
      { assignment_id: 202, title: "Circles", due_at: fromNow(2), is_overdue: false, is_assessment: false, submitted_count: 0, student_count: 1, completion_pct: 0.0 },
    ],
    class_stats: { student_count: 1, assignment_count: 2, overall_completion_pct: 0.0, avg_assessment_score_pct: 45.0 },
  };
}

/** A `students` row of the leaderboard: one student's practice tests. */
function practiceRow(p: Person, practiceAverage: number, rank: number) {
  return {
    user_id: p.id, first_name: p.first_name, last_name: p.last_name, username: "", email: p.email, profile_image_url: null,
    latest_practice: null, practice_average: practiceAverage, practice_completed_count: 1, practice_total_assigned: 1,
    average_review_grade: null, review_graded_count: 0, rank,
  };
}

/**
 * `GET /api/classes/<id>/leaderboard/`, as `ClassroomViewSet.leaderboard` builds it. Algebra 2's "Linear
 * equations" has a group mean below the class's practice average, which the homework page calls "Challenging".
 */
function leaderboard(classId: number) {
  const algebra = classId === ALGEBRA.id;
  const students = algebra ? [practiceRow(FIRST, 1250, 1), practiceRow(SECOND, 1150, 2)] : [practiceRow(THIRD, 900, 1)];
  const summary = algebra
    ? { assignment_id: 101, title: "Linear equations", created_at: "2026-09-01T09:00:00+05:00", group_mean_score: 1100.0 }
    : { assignment_id: 201, title: "Triangles", created_at: "2026-09-05T09:00:00+05:00", group_mean_score: 900.0 };
  return {
    classroom_id: classId,
    classroom_name: algebra ? ALGEBRA.name : GEOMETRY.name,
    student_count: students.length,
    practice_assignment_count: 1,
    class_practice_average: algebra ? 1200.0 : 900.0,
    overall_group_mean_of_assignments: summary.group_mean_score,
    assignments_summary: [
      { ...summary, due_at: null, practice_test_id: 7, practice_test_title: "Practice test", subject: "MATH", completed_count: students.length, student_headcount: students.length, completion_rate_pct: 100.0 },
    ],
    students,
    homework_grade_leaderboard: { class_average_review_grade: null, classwork_assignment_count: algebra ? 1 : 2, effective_min_reviewed_for_rank: 2, rows: [] },
  };
}

/** Every request answers, the class list through the real contract parser. */
function serve() {
  api.list.mockImplementation(async () => parseClassroomList([ALGEBRA, GEOMETRY], "GET /classes/"));
  api.getInterventions.mockImplementation(async (classId: number) => interventions(classId));
  api.getLeaderboard.mockImplementation(async (classId: number) => leaderboard(classId));
}

/** A teacher with no classes at all. */
function serveNoClasses() {
  api.list.mockImplementation(async () => parseClassroomList([], "GET /classes/"));
}

/** Answer `fn` as `serve()` does, except where `fails` names the call: that one rejects with `error`. */
function failWhere(fn: typeof api.list, fails: (classId: number) => boolean, error: () => unknown) {
  const answer = fn.getMockImplementation()!;
  fn.mockImplementation(async (classId: number) => {
    if (fails(classId)) throw error();
    return answer(classId);
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
  }).mockImplementationOnce(async (...args: unknown[]) => {
    await held;
    return answer(...args);
  });
  return () => release();
}

/** Hold `fn`'s next call until the returned `reject` fails it; later calls answer as before. */
function holdToFail(fn: typeof api.list) {
  const answer = fn.getMockImplementation()!;
  let reject: (error: unknown) => void = () => {};
  fn.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail))).mockImplementation(answer);
  return (error: unknown) => reject(error);
}

let host: HTMLDivElement;
let root: Root;

async function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}

/** Turn the event loop once. */
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Turn the event loop until `done` holds. */
async function until(done: () => boolean) {
  for (let turn = 0; turn < 100 && !done(); turn++) await tick();
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

// Both hooks read "booting" until their load has finished.
const settled = (value: { status: string }) => value.status !== "booting";

const text = () => host.textContent ?? "";
/**
 * No loading placeholder is left on the page. Both markers are matched on purpose: every
 * placeholder in the product, including the teacher kit's `Skeleton`, carries `.ds-skeleton` —
 * it is the shared shimmer and the settle signal — and two teacher pages additionally mark the
 * region they are filling `aria-busy`. Either one left behind means the page is still loading.
 *
 * The kit's skeleton did NOT carry the class when this selector was widened, and a test that
 * asked only about `.ds-skeleton` called a half-loaded teacher page settled. The class is there
 * now; the second clause stays because `aria-busy` is the marker for a region that is being
 * filled in place rather than replaced by placeholders.
 */
const pageSettled = () => host.querySelector('.ds-skeleton, [aria-busy="true"]') === null;
const heading = () => host.querySelector("h1")?.textContent ?? null;
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}
/** The value on the KPI card with this label, or null when there is no such card. */
function kpi(label: string) {
  return [...host.querySelectorAll("span.ds-overline")].find((s) => s.textContent === label)?.parentElement?.nextElementSibling?.textContent ?? null;
}
/** Everything a student's or an assignment's card says, found by the name it leads with; null when there is no card. */
function card(name: string) {
  return [...host.querySelectorAll("button, a")].find((el) => el.querySelector("p")?.textContent === name)?.textContent ?? null;
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

describe("useTeacherDashboard — a request that failed is not a class overview", () => {
  it("a class list that did not load is an error, not a teacher with no classes", async () => {
    api.list.mockRejectedValue(httpError(500));
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    // Django's HTML error page is not a reason.
    expect(read().error).toEqual({ detail: null });
    expect(read().model).toBeNull();
    expect(api.getInterventions).not.toHaveBeenCalled();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });

  it("one class's interventions not loading is an error, not totals without that class", async () => {
    failWhere(api.getInterventions, (classId) => classId === GEOMETRY.id, () => httpError(500));
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: null });
    // Not Algebra 2's two students passed off as all of the teacher's.
    expect(read().model).toBeNull();
  });

  it("one class's leaderboard not loading is an error, not a trend without that class", async () => {
    failWhere(api.getLeaderboard, (classId) => classId === ALGEBRA.id, networkError);
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: null });
    expect(read().model).toBeNull();
  });

  it("keeps the server's reason when it gave one", async () => {
    failWhere(api.getInterventions, (classId) => classId === GEOMETRY.id, () => httpError(403, FORBIDDEN));
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: FORBIDDEN.detail });
  });

  it("tries again, and adds up every class once they load", async () => {
    api.list.mockRejectedValueOnce(networkError());
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));
    expect(read().status).toBe("error");

    await act(async () => read().retry());
    await until(() => settled(read()));

    expect(read().status).toBe("ready");
    expect(read().error).toBeNull();
    expect([read().model?.classCount, read().model?.totalStudents]).toEqual([2, 3]);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("a load that fails after one that worked leaves none of the earlier numbers up", async () => {
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));
    expect(read().model?.totalStudents).toBe(3);

    failWhere(api.getInterventions, (classId) => classId === ALGEBRA.id, () => httpError(502));
    await act(async () => read().retry());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().model).toBeNull();
  });

  it("a load overtaken by a newer one cannot put its failure over the newer one's overview", async () => {
    const failFirst = holdToFail(api.list);
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => api.list.mock.calls.length === 1);

    await act(async () => read().retry());
    await until(() => settled(read()));
    expect(read().model?.totalStudents).toBe(3);
    await act(async () => failFirst(httpError(500)));
    await tick();

    expect(read().status).toBe("ready");
    expect(read().error ?? null).toBeNull();
    expect(read().model?.totalStudents).toBe(3);
  });

  it("still reads a teacher with no classes as one", async () => {
    serveNoClasses();
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    expect(read().status).toBe("empty");
    expect(read().error ?? null).toBeNull();
  });

  it("adds up every class when every request answers", async () => {
    const read = await mountHook(() => useTeacherDashboard());
    await until(() => settled(read()));

    const m = read().model;
    expect(read().status).toBe("ready");
    expect([m?.classCount, m?.totalStudents, m?.activeStudents, m?.avgScore, m?.submissionRate]).toEqual([2, 3, 2, 64, 50]);
    expect(m?.classAvgTrend.map((point) => point.score)).toEqual([1100, 900]);
    expect(m?.needsAttention.map((s) => s.reason)).toEqual(["Average 45% · Geometry"]);
    expect(m?.upcoming.map((u) => u.dueLabel)).toEqual(["Due in 2d"]);
  });
});

// The teacher Dashboard used to be tested here, against the class list and the per-class
// interventions it once fanned out. Rebuilt on 2026-09-20 it reads ONE endpoint and none of
// these, so its own failure cases live in `teacherDashboardToday.test.tsx`. What the pages
// below still share with it is the rule: a request that failed is never drawn as data.

describe("useTeacherAnalytics — a request that failed is not class analytics", () => {
  it("a class list that did not load is an error, not a teacher with no classes", async () => {
    api.list.mockRejectedValue(networkError());
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: null });
    expect(read().model).toBeNull();
    expect(api.getInterventions).not.toHaveBeenCalled();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });

  it("one class's interventions not loading is an error, not that class's students on track", async () => {
    failWhere(api.getInterventions, (classId) => classId === GEOMETRY.id, () => httpError(500));
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: null });
    expect(read().model).toBeNull();
  });

  it("one class's leaderboard not loading is an error, not a class without its students", async () => {
    failWhere(api.getLeaderboard, (classId) => classId === GEOMETRY.id, () => httpError(503));
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: null });
    expect(read().model).toBeNull();
  });

  it("keeps the server's reason when it gave one", async () => {
    failWhere(api.getLeaderboard, (classId) => classId === ALGEBRA.id, () => httpError(403, FORBIDDEN));
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().error).toEqual({ detail: FORBIDDEN.detail });
  });

  it("tries again, and reads every class once they load", async () => {
    api.list.mockRejectedValueOnce(httpError(502));
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));
    expect(read().status).toBe("error");

    await act(async () => read().retry());
    await until(() => settled(read()));

    expect(read().status).toBe("ready");
    expect(read().error).toBeNull();
    expect(read().model?.students.map((s) => s.id).sort((a, b) => a - b)).toEqual([11, 12, 21]);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("a load that fails after one that worked leaves none of the earlier numbers up", async () => {
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));
    expect(read().model?.totalStudents).toBe(3);

    failWhere(api.getLeaderboard, (classId) => classId === GEOMETRY.id, networkError);
    await act(async () => read().retry());
    await until(() => settled(read()));

    expect(read().status).toBe("error");
    expect(read().model).toBeNull();
  });

  it("a load overtaken by a newer one cannot put its failure over the newer one's analytics", async () => {
    const failFirst = holdToFail(api.list);
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => api.list.mock.calls.length === 1);

    await act(async () => read().retry());
    await until(() => settled(read()));
    expect(read().model?.totalStudents).toBe(3);
    await act(async () => failFirst(httpError(500)));
    await tick();

    expect(read().status).toBe("ready");
    expect(read().error ?? null).toBeNull();
    expect(read().model?.totalStudents).toBe(3);
  });

  it("still reads a teacher with no classes as one", async () => {
    serveNoClasses();
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    expect(read().status).toBe("empty");
    expect(read().error ?? null).toBeNull();
  });

  it("reads every class when every request answers", async () => {
    const read = await mountHook(() => useTeacherAnalytics());
    await until(() => settled(read()));

    const m = read().model;
    expect(read().status).toBe("ready");
    expect([m?.classCount, m?.totalStudents, m?.atRiskCount, m?.watchCount]).toEqual([2, 3, 1, 0]);
    expect(m?.students.map((s) => [s.id, s.riskLevel])).toEqual([[21, "at-risk"], [11, "on-track"], [12, "on-track"]]);
    expect(m?.assignments.map((a) => [a.title, a.effectiveness])).toEqual([
      ["Linear equations", "challenging"],
      ["Triangles", "low-completion"],
      ["Circles", "low-completion"],
    ]);
  });
});

describe("TeacherAnalytics — what the teacher sees when a load fails", () => {
  it("a class list that did not load says so, with Try again — not 'No classes yet'", async () => {
    api.list.mockRejectedValueOnce(httpError(500));
    await mount(<TeacherAnalytics />);
    await until(pageSettled);

    expect(text()).not.toContain("No classes yet");
    expect(text()).toContain("Couldn’t load your class analytics");
    expect(text()).toContain("Your classes and their students are unchanged — only this page failed to load.");
    expect(text()).not.toContain("doctype");
    expect(buttons()).toContain("Try again");

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Couldn’t load");
    expect(heading()).toBe("Class analytics");
    expect(kpi("At risk")).toBe("1");
  });

  it("one class's interventions not loading says so — never 'No one at risk'", async () => {
    failWhere(api.getInterventions, (classId) => classId === GEOMETRY.id, networkError);
    await mount(<TeacherAnalytics />);
    await until(pageSettled);

    expect(text()).not.toContain("No one at risk");
    expect(kpi("At risk")).toBeNull();
    expect(text()).toContain("Couldn’t load your class analytics");
  });

  it("shows the server's reason when it gave one", async () => {
    api.list.mockRejectedValue(httpError(403, FORBIDDEN));
    await mount(<TeacherAnalytics />);
    await until(pageSettled);

    expect(text()).toContain("Couldn’t load your class analytics");
    expect(text()).toContain(FORBIDDEN.detail);
    expect(text()).not.toContain("only this page failed to load");
  });

  it("still says 'No classes yet' to a teacher with no classes", async () => {
    serveNoClasses();
    await mount(<TeacherAnalytics />);
    await until(pageSettled);

    expect(text()).toContain("No classes yet");
    expect(text()).not.toContain("Couldn’t load");
    expect(buttons()).not.toContain("Try again");
  });
});

describe("TeacherHomework — what the teacher sees when a load fails", () => {
  it("a class list that did not load says so, with Try again — not 'No assignments yet'", async () => {
    api.list.mockRejectedValueOnce(httpError(500));
    await mount(<TeacherHomework />);
    await until(pageSettled);

    expect(text()).not.toContain("No assignments yet");
    expect(text()).toContain("Couldn’t load your assignments");
    expect(text()).toContain("Your assignments and their submissions are unchanged — only this page failed to load.");
    expect(text()).not.toContain("doctype");
    expect(buttons()).toContain("Try again");

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Couldn’t load");
    expect(card("Linear equations")).toContain("Challenging");
  });

  it("one class's leaderboard not loading says so — its homework is not called 'Healthy'", async () => {
    failWhere(api.getLeaderboard, (classId) => classId === ALGEBRA.id, networkError);
    await mount(<TeacherHomework />);
    await until(pageSettled);

    // Without Algebra 2's group means, "Linear equations" read "Healthy" rather than "Challenging".
    expect(card("Linear equations") ?? "").not.toContain("Healthy");
    expect(text()).toContain("Couldn’t load your assignments");
  });

  it("shows the server's reason when it gave one", async () => {
    failWhere(api.getInterventions, (classId) => classId === GEOMETRY.id, () => httpError(403, FORBIDDEN));
    await mount(<TeacherHomework />);
    await until(pageSettled);

    expect(text()).toContain("Couldn’t load your assignments");
    expect(text()).toContain(FORBIDDEN.detail);
    expect(text()).not.toContain("only this page failed to load");
  });

  it("still says 'No assignments yet' to a teacher with no classes", async () => {
    serveNoClasses();
    await mount(<TeacherHomework />);
    await until(pageSettled);

    expect(text()).toContain("No assignments yet");
    expect(text()).not.toContain("Couldn’t load");
    expect(buttons()).not.toContain("Try again");
  });
});
