import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";

/**
 * Each student's homework grades on the teacher's analytics model, which `/teacher/students`, `/teacher/analytics` and
 * `/teacher/homework` are drawn from.
 *
 * `GET /api/classes/<id>/leaderboard/` sends the homework grade board as `homework_grade_leaderboard.rows`, one row per
 * student, and has since the board was added (`7bdc73be`). The hook read `homework_grade_leaderboard.students`, a key the
 * board never had, so every student read "Grade avg —" and "Completion —", the drawer said "No grades yet", and the rules
 * built on those two numbers never flagged anyone: a grade average under 60 (at risk) or under 70 (watch), and under 40%
 * of the homework turned in (watch).
 *
 * The board sends null, not 0, for a student with nothing graded yet, and for the turn-in rate of a class with no
 * homework. Neither is a failing grade.
 *
 * `classesApi.getLeaderboard` and `getInterventions` hand back the response body untouched, so the mocks answer with the
 * bodies `ClassroomViewSet` builds. The class list goes through the real contract parser.
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
// Recharts needs layout jsdom does not give it (as in MidtermStatsPage.test.tsx). Only the charts are stubbed; their
// cards stay.
vi.mock("@/components/ui/charts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/components/ui/charts")),
  LineChart: () => <div>line chart</div>,
  BarChart: () => <div>bar chart</div>,
  DonutChart: () => <div>donut chart</div>,
}));

const { useTeacherAnalytics } = await import("../useTeacherAnalytics");
const { TeacherStudents } = await import("../TeacherStudents");
const { TeacherAnalytics } = await import("../TeacherAnalytics");

const DAY = 86_400_000;
/** A datetime `days` from now. */
const fromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** `GET /api/classes/` rows in the serializer's wire shape. The teacher teaches both, so every class filter keeps them. */
const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };
const GEOMETRY = { id: 2, name: "Geometry", subject: "MATH", lesson_days: "EVEN", join_code: "JOIN2", my_role: "TEACHER" };

type Person = { id: number; first_name: string; last_name: string; email: string };
function person(id: number, first_name: string, last_name: string): Person {
  return { id, first_name, last_name, email: `${first_name}.${last_name}@example.com`.toLowerCase() };
}
const nameOf = (p: Person) => `${p.first_name} ${p.last_name}`;

// Algebra 2 has four homework, none due yet. Two of them are practice tests; nobody has finished the second.
const STRONG = person(11, "Strong", "Grades"); // graded 92 and 91, turned in 3 of 4, practice test 1: 1310
const FAILING = person(12, "Failing", "Grades"); // graded 50 and 54, turned in 3 of 4, practice test 1: 1020
const SLIPPING = person(13, "Slipping", "Grades"); // graded 60 and 70, turned in 2 of 4
const BEHIND = person(14, "Behind", "Homework"); // graded 88, turned in 1 of 4
const UNGRADED = person(15, "Nothing", "Graded"); // turned in 2 of 4, none of it graded yet
// Geometry has no homework yet.
const NEWCOMER = person(21, "No", "Homework");

/** A row of `homework_grade_leaderboard.rows`: the teacher's grades on one student's homework, and how much of it they turned in. */
function homeworkRow(
  p: Person,
  row: { average: number | null; graded: number; turnedIn: number; completion: number | null; ordinal: number; rank: number | null },
) {
  return {
    user_id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email, profile_image_url: null,
    average_review_grade: row.average, graded_submission_count: row.graded, classwork_turn_in_count: row.turnedIn,
    homework_completion_rate_pct: row.completion,
    rank_ordinal: row.ordinal, rank_confidence: row.rank == null ? "low" : "high", rank: row.rank,
  };
}

/** A row of the leaderboard's `students`: one student's practice tests. The board repeats the grade average here. */
function practiceRow(
  p: Person,
  row: { practiceAverage: number | null; completed: number; assigned: number; average: number | null; graded: number; rank: number; latest: unknown },
) {
  return {
    user_id: p.id, first_name: p.first_name, last_name: p.last_name, username: "", email: p.email, profile_image_url: null,
    latest_practice: row.latest, practice_average: row.practiceAverage, practice_completed_count: row.completed,
    practice_total_assigned: row.assigned, average_review_grade: row.average, review_graded_count: row.graded, rank: row.rank,
  };
}

/**
 * `GET /api/classes/<id>/leaderboard/`, as `ClassroomViewSet.leaderboard` builds it. The practice rows are ranked by
 * practice average and the homework rows by grade average, so the two lists name the students in different orders.
 */
function leaderboard(classId: number) {
  if (classId === ALGEBRA.id) {
    const latest = {
      assignment_id: 104, assignment_title: "Practice test 2", practice_test_title: "Practice Test 2", subject: "MATH",
      score: null, submitted_at: null, attempt_id: null, in_progress: false,
    };
    return {
      classroom_id: ALGEBRA.id,
      classroom_name: ALGEBRA.name,
      student_count: 5,
      practice_assignment_count: 2,
      class_practice_average: 1165.0,
      overall_group_mean_of_assignments: 1165.0,
      assignments_summary: [
        { assignment_id: 104, title: "Practice test 2", due_at: fromNow(6), created_at: "2026-09-08T09:00:00+05:00", practice_test_id: 72, practice_test_title: "Practice Test 2", subject: "MATH", group_mean_score: null, completed_count: 0, student_headcount: 5, completion_rate_pct: 0.0 },
        { assignment_id: 103, title: "Practice test 1", due_at: fromNow(2), created_at: "2026-09-01T09:00:00+05:00", practice_test_id: 71, practice_test_title: "Practice Test 1", subject: "MATH", group_mean_score: 1165, completed_count: 2, student_headcount: 5, completion_rate_pct: 40.0 },
      ],
      students: [
        practiceRow(STRONG, { practiceAverage: 1310.0, completed: 1, assigned: 2, average: 91.5, graded: 2, rank: 1, latest }),
        practiceRow(FAILING, { practiceAverage: 1020.0, completed: 1, assigned: 2, average: 52.0, graded: 2, rank: 2, latest }),
        practiceRow(BEHIND, { practiceAverage: null, completed: 0, assigned: 2, average: 88.0, graded: 1, rank: 3, latest }),
        practiceRow(UNGRADED, { practiceAverage: null, completed: 0, assigned: 2, average: null, graded: 0, rank: 4, latest }),
        practiceRow(SLIPPING, { practiceAverage: null, completed: 0, assigned: 2, average: 65.0, graded: 2, rank: 5, latest }),
      ],
      homework_grade_leaderboard: {
        class_average_review_grade: 74.12,
        classwork_assignment_count: 4,
        effective_min_reviewed_for_rank: 2,
        rows: [
          homeworkRow(STRONG, { average: 91.5, graded: 2, turnedIn: 3, completion: 75.0, ordinal: 1, rank: 1 }),
          homeworkRow(BEHIND, { average: 88.0, graded: 1, turnedIn: 1, completion: 25.0, ordinal: 2, rank: null }),
          homeworkRow(SLIPPING, { average: 65.0, graded: 2, turnedIn: 2, completion: 50.0, ordinal: 3, rank: 3 }),
          homeworkRow(FAILING, { average: 52.0, graded: 2, turnedIn: 3, completion: 75.0, ordinal: 4, rank: 4 }),
          homeworkRow(UNGRADED, { average: null, graded: 0, turnedIn: 2, completion: 50.0, ordinal: 5, rank: null }),
        ],
      },
    };
  }
  return {
    classroom_id: GEOMETRY.id,
    classroom_name: GEOMETRY.name,
    student_count: 1,
    practice_assignment_count: 0,
    class_practice_average: null,
    overall_group_mean_of_assignments: null,
    assignments_summary: [],
    students: [practiceRow(NEWCOMER, { practiceAverage: null, completed: 0, assigned: 0, average: null, graded: 0, rank: 1, latest: null })],
    homework_grade_leaderboard: {
      // Nothing to grade and nothing to turn in, so no grade average and no turn-in rate.
      class_average_review_grade: null,
      classwork_assignment_count: 0,
      effective_min_reviewed_for_rank: 2,
      rows: [homeworkRow(NEWCOMER, { average: null, graded: 0, turnedIn: 0, completion: null, ordinal: 1, rank: null })],
    },
  };
}

/** How an interventions list names a student. */
function studentRef(p: Person) {
  return { student_id: p.id, email: p.email, first_name: p.first_name, last_name: p.last_name, profile_image_url: null };
}

/**
 * `GET /api/classes/<id>/interventions/`, as `ClassroomViewSet.interventions` builds it. In Algebra 2 nothing is due
 * yet, there are no assessments and everyone turned something in this week, so nothing here flags anyone and the
 * homework board alone decides who is. Geometry's student has had nothing to do there, which the server lists as
 * inactive with no date.
 */
function interventions(classId: number) {
  if (classId === ALGEBRA.id) {
    return {
      overdue_students: [],
      inactive_students: [],
      low_score_students: [],
      completion_summary: [
        { assignment_id: 101, title: "Linear equations", due_at: fromNow(1), is_overdue: false, is_assessment: false, submitted_count: 5, student_count: 5, completion_pct: 100.0 },
        { assignment_id: 103, title: "Practice test 1", due_at: fromNow(2), is_overdue: false, is_assessment: false, submitted_count: 2, student_count: 5, completion_pct: 40.0 },
        { assignment_id: 102, title: "Quadratics", due_at: fromNow(3), is_overdue: false, is_assessment: false, submitted_count: 4, student_count: 5, completion_pct: 80.0 },
        { assignment_id: 104, title: "Practice test 2", due_at: fromNow(6), is_overdue: false, is_assessment: false, submitted_count: 0, student_count: 5, completion_pct: 0.0 },
      ],
      class_stats: { student_count: 5, assignment_count: 4, overall_completion_pct: 55.0, avg_assessment_score_pct: null },
    };
  }
  return {
    overdue_students: [],
    inactive_students: [{ ...studentRef(NEWCOMER), last_activity_at: null, days_inactive: null }],
    low_score_students: [],
    completion_summary: [],
    class_stats: { student_count: 1, assignment_count: 0, overall_completion_pct: 0.0, avg_assessment_score_pct: null },
  };
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
  for (let turn = 0; turn < 100 && !done(); turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("never settled");
}

/** Mount the hook, wait until it has stopped booting, and hand back what it settled on. */
async function loadAnalytics() {
  const seen: { value?: ReturnType<typeof useTeacherAnalytics> } = {};
  function Probe() {
    seen.value = useTeacherAnalytics();
    return null;
  }
  await mount(<Probe />);
  await until(() => seen.value !== undefined && seen.value.status !== "booting");
  return seen.value!;
}

/** Students in id order: Algebra 2's five, then Geometry's one. */
const inIdOrder = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => a.id - b.id);

/** No loading placeholder is left on the page. */
const pageSettled = () => host.querySelector(".ds-skeleton") === null;
/** A student's card on the students page, found by the name it leads with. */
function card(p: Person) {
  return [...host.querySelectorAll("button")].find((b) => b.querySelector("p")?.textContent === nameOf(p)) ?? null;
}
/** The risk badge on a student's card. */
function badge(p: Person) {
  const text = card(p)?.textContent ?? "";
  return ["At risk", "Watch", "On track"].find((label) => text.includes(label)) ?? null;
}
/** The value printed under `label`: cards, the drawer and the at-risk list each put a label and its value in sibling paragraphs. */
function stat(scope: ParentNode | null, label: string) {
  return [...(scope?.querySelectorAll("p") ?? [])].find((p) => p.textContent === label)?.nextElementSibling?.textContent ?? null;
}
/** Open a student's drawer and hand it back. */
async function openDrawer(p: Person) {
  await act(async () => card(p)!.click());
  return document.body.querySelector('[role="dialog"]');
}
/** The value on the analytics KPI card with this label. */
function kpi(label: string) {
  return [...host.querySelectorAll("span.ds-overline")].find((s) => s.textContent === label)?.parentElement?.nextElementSibling?.textContent ?? null;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  api.list.mockImplementation(async () => parseClassroomList([ALGEBRA, GEOMETRY], "GET /classes/"));
  api.getInterventions.mockImplementation(async (classId: number) => interventions(classId));
  api.getLeaderboard.mockImplementation(async (classId: number) => leaderboard(classId));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  localStorage.clear();
});

describe("useTeacherAnalytics — each student's homework grades", () => {
  it("reads each student's grade average and turn-in rate from the homework board's rows", async () => {
    const { status, model } = await loadAnalytics();

    expect(status).toBe("ready");
    expect(inIdOrder(model!.students).map((s) => [s.name, s.className, s.reviewAvg, s.completionPct])).toEqual([
      ["Strong Grades", "Algebra 2", 91.5, 75],
      ["Failing Grades", "Algebra 2", 52, 75],
      ["Slipping Grades", "Algebra 2", 65, 50],
      ["Behind Homework", "Algebra 2", 88, 25],
      ["Nothing Graded", "Algebra 2", null, 50],
      ["No Homework", "Geometry", null, null],
    ]);
  });

  it("flags a grade average under 60 at risk, one under 70 to watch, and under 40% turned in to watch", async () => {
    const { model } = await loadAnalytics();

    const algebra = model!.students.filter((s) => s.classId === ALGEBRA.id);
    expect(inIdOrder(algebra).map((s) => [s.name, s.riskLevel, s.riskReasons])).toEqual([
      ["Strong Grades", "on-track", []],
      ["Failing Grades", "at-risk", ["Grade avg 52%"]],
      ["Slipping Grades", "watch", ["Grade avg 65%"]],
      ["Behind Homework", "watch", ["25% turned in"]],
      ["Nothing Graded", "on-track", []],
    ]);
  });

  it("counts those students in the at-risk and watch totals, and leads with a check-in", async () => {
    const { model } = await loadAnalytics();

    expect([model!.atRiskCount, model!.watchCount]).toEqual([1, 2]);
    expect(model!.recommendations[0]).toEqual({
      id: "atrisk",
      title: "Check in with 1 at-risk student",
      detail: "Low averages, work not turned in, or inactivity.",
      href: "/teacher/students",
    });
  });

  it("nothing graded yet is no grade average rather than 0%, and a class with no homework has no turn-in rate", async () => {
    const { model } = await loadAnalytics();

    // Read as 0, the board's nulls would put both students at risk for a "Grade avg 0%", and Geometry's for "0% turned in".
    const ungraded = model!.students.find((s) => s.id === UNGRADED.id)!;
    const newcomer = model!.students.find((s) => s.id === NEWCOMER.id)!;
    expect(ungraded.reviewAvg).toBeNull();
    expect([newcomer.reviewAvg, newcomer.completionPct]).toEqual([null, null]);
    expect([...ungraded.riskReasons, ...newcomer.riskReasons].filter((r) => /Grade avg|turned in/.test(r))).toEqual([]);
  });

  it("no practice test finished yet is no practice average and no group mean, rather than 0", async () => {
    const { model } = await loadAnalytics();

    expect(inIdOrder(model!.students).map((s) => [s.name, s.practiceAverage])).toEqual([
      ["Strong Grades", 1310],
      ["Failing Grades", 1020],
      ["Slipping Grades", null],
      ["Behind Homework", null],
      ["Nothing Graded", null],
      ["No Homework", null],
    ]);
    // Practice test 2 has no "Avg score" on the homework page, and no point on the class trend.
    expect(model!.assignments.map((a) => [a.title, a.groupMean])).toEqual([
      ["Linear equations", null],
      ["Practice test 1", 1165],
      ["Quadratics", null],
      ["Practice test 2", null],
    ]);
    expect(model!.classAvgTrend).toEqual([{ label: "Sep 1", score: 1165 }]);
  });
});

describe("TeacherStudents — the grades a teacher sees", () => {
  it("each card shows the student's grade average, completion and risk", async () => {
    await mount(<TeacherStudents />);
    await until(pageSettled);

    expect([STRONG, FAILING, SLIPPING, BEHIND, UNGRADED, NEWCOMER].map((p) => [nameOf(p), stat(card(p), "Grade avg"), stat(card(p), "Completion"), badge(p)])).toEqual([
      ["Strong Grades", "91.5%", "75%", "On track"],
      ["Failing Grades", "52%", "75%", "At risk"],
      ["Slipping Grades", "65%", "50%", "Watch"],
      ["Behind Homework", "88%", "25%", "Watch"],
      ["Nothing Graded", "—", "50%", "On track"],
      ["No Homework", "—", "—", "On track"],
    ]);
  });

  it("the drawer gives the average grade, completion and practice average, and why the student is flagged", async () => {
    await mount(<TeacherStudents />);
    await until(pageSettled);
    const drawer = await openDrawer(FAILING);

    expect(["Why flagged", "Average grade", "Assignment completion", "Practice average"].map((label) => stat(drawer, label))).toEqual([
      "Grade avg 52%",
      "52%",
      "75%",
      "1020",
    ]);
  });

  it("the drawer says a student has no grades and no practice yet, not 0", async () => {
    await mount(<TeacherStudents />);
    await until(pageSettled);
    const drawer = await openDrawer(UNGRADED);

    expect(["Why flagged", "Average grade", "Assignment completion", "Practice average"].map((label) => stat(drawer, label))).toEqual([
      null,
      "No grades yet",
      "50%",
      "No practice yet",
    ]);
  });
});

describe("TeacherAnalytics — grade signals in the totals", () => {
  it("counts a failing grade average at risk and a slipping one to watch, and says why", async () => {
    await mount(<TeacherAnalytics />);
    await until(pageSettled);

    expect([kpi("Students"), kpi("At risk"), kpi("Watch")]).toEqual(["6", "1", "2"]);
    // The at-risk list names the student and the reason.
    expect(stat(host, nameOf(FAILING))).toBe("Grade avg 52%");
    expect(stat(host, "Check in with 1 at-risk student")).toBe("Low averages, work not turned in, or inactivity.");
  });
});
