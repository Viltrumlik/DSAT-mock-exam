import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";

/**
 * Which classes the teacher portal gathers its numbers from.
 *
 * `GET /api/classes/` lists every class the signed-in user belongs to, and `my_role` is the
 * membership role exactly as `ClassroomMembership` stores it: UPPERCASE — ADMIN, OWNER,
 * TEACHER, TA, STUDENT. The hooks used to keep every class whose role was not `"student"`,
 * which no role ever is, so a class the user only sits in was fetched and counted as one they
 * teach. Its interventions request fails and quietly becomes null; its leaderboard does not,
 * because any member may read it, and so that class's roster and homework means arrived as
 * the teacher's own.
 *
 * A TA stays on the list: the server grants `can_view_class_analytics` to the whole teaching
 * team, and a TA reads interventions like a teacher does.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  getInterventions: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { useTeacherDashboard } = await import("../useTeacherDashboard");
const { useTeacherAnalytics } = await import("../useTeacherAnalytics");

/** A `GET /api/classes/` row in the serializer's wire shape. */
function classRow(id: number, myRole: string) {
  return { id, name: `${myRole} class`, subject: "MATH", lesson_days: "ODD", join_code: `JOIN${id}`, my_role: myRole };
}

const SITS_IN = classRow(5, "STUDENT");
const TEACHES = [classRow(1, "OWNER"), classRow(2, "ADMIN"), classRow(3, "TEACHER"), classRow(4, "TA")];

/** Serve the class list through the real contract parser, which passes `my_role` through untouched. */
function listClasses(rows: ReturnType<typeof classRow>[]) {
  api.list.mockImplementation(async () => parseClassroomList(rows, "GET /classes/"));
}

function interventions() {
  return {
    overdue_students: [],
    inactive_students: [],
    low_score_students: [],
    completion_summary: [],
    class_stats: { student_count: 1, assignment_count: 1, overall_completion_pct: 100, avg_assessment_score_pct: null },
  };
}

/** Class N's leaderboard: one student with id N01, and one homework dated 2026-09-0N whose group mean is 70 + N. */
function leaderboard(classId: number) {
  return {
    class_practice_average: null,
    students: [{ user_id: classId * 100 + 1, first_name: "Student", last_name: `of class ${classId}` }],
    assignments_summary: [
      {
        assignment_id: classId * 100,
        title: `Homework ${classId}`,
        created_at: `2026-09-0${classId}T09:00:00+05:00`,
        group_mean_score: 70 + classId,
      },
    ],
    homework_grade_leaderboard: { students: [], class_average_review_grade: null },
  };
}

/** The ids a class-scoped request was made for, in order. */
function requested(fn: typeof api.getInterventions): number[] {
  return fn.mock.calls.map(([classId]) => classId as number).sort((a, b) => a - b);
}

let host: HTMLDivElement;
let root: Root;

/** Mount a hook and let it finish loading. */
async function settle<T extends { status: string }>(useHook: () => T): Promise<T> {
  const seen: { value?: T } = {};
  function Probe() {
    seen.value = useHook();
    return null;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
  for (let tick = 0; tick < 50 && seen.value?.status === "booting"; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!seen.value || seen.value.status === "booting") throw new Error("the hook never finished loading");
  return seen.value;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The server's gates: interventions answers the teaching team only; the leaderboard answers any member.
  api.getInterventions.mockImplementation(async (classId: number) => {
    if (classId === SITS_IN.id) throw Object.assign(new Error("Request failed with status code 403"), { response: { status: 403 } });
    return interventions();
  });
  api.getLeaderboard.mockImplementation(async (classId: number) => leaderboard(classId));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("useTeacherDashboard — the classes it adds up", () => {
  it("leaves out a class the user sits in as a student, and keeps OWNER, ADMIN, TEACHER and TA", async () => {
    listClasses([SITS_IN, ...TEACHES]);
    const { status, model } = await settle(() => useTeacherDashboard());

    expect(status).toBe("ready");
    expect(requested(api.getInterventions)).toEqual([1, 2, 3, 4]);
    expect(requested(api.getLeaderboard)).toEqual([1, 2, 3, 4]);
    expect(model?.classCount).toBe(4);
    // The student class's homework mean (75) is not part of the teacher's trend.
    expect(model?.classAvgTrend.map((point) => point.score)).toEqual([71, 72, 73, 74]);
  });

  it("shows the empty state when the only class is one the user sits in", async () => {
    listClasses([SITS_IN]);
    const { status, model } = await settle(() => useTeacherDashboard());

    expect(status).toBe("empty");
    expect(model).toBeNull();
    expect(api.getInterventions).not.toHaveBeenCalled();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});

describe("useTeacherAnalytics — the classes it reads", () => {
  it("leaves out a class the user sits in as a student, and keeps OWNER, ADMIN, TEACHER and TA", async () => {
    listClasses([SITS_IN, ...TEACHES]);
    const { status, model } = await settle(() => useTeacherAnalytics());

    expect(status).toBe("ready");
    expect(requested(api.getInterventions)).toEqual([1, 2, 3, 4]);
    expect(requested(api.getLeaderboard)).toEqual([1, 2, 3, 4]);
    expect(model?.classCount).toBe(4);
    expect(model?.classes.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    // Classmates read off the student class's leaderboard (id 501) are not the teacher's students.
    expect(model?.students.map((s) => s.id).sort((a, b) => a - b)).toEqual([101, 201, 301, 401]);
  });

  it("shows the empty state when the only class is one the user sits in", async () => {
    listClasses([SITS_IN]);
    const { status, model } = await settle(() => useTeacherAnalytics());

    expect(status).toBe("empty");
    expect(model).toBeNull();
    expect(api.getInterventions).not.toHaveBeenCalled();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});
