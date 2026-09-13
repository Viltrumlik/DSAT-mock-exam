/**
 * The teacher Overview's Completion and Needs attention cards, read off the real response.
 *
 * The Overview read `completion_rate`, `overdue`, `inactive` and `low_scores`, keys
 * GET /classes/{id}/interventions/ has never sent, so Completion was always "—" and Needs
 * attention always 0. `PAYLOAD` is written key for key from `ClassroomViewSet.interventions`;
 * `classesApi.getInterventions` hands the body to the hook unmapped, so it is exactly what the
 * component receives. The numbers agree with each other: seven students, three assignments.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classCompletionPct, needsAttention } from "../interventions";
import type { ClassroomWithRole, InterventionStudent, Interventions, Member } from "../types";

const useInterventions = vi.fn();
const useClassMembers = vi.fn();

vi.mock("../hooks", () => ({
  useInterventions: (...a: unknown[]) => useInterventions(...a),
  useClassMembers: (...a: unknown[]) => useClassMembers(...a),
  useStudentWorkspace: () => ({ data: undefined, isLoading: true }),
}));
// Only the student view reads these.
vi.mock("../rankingsHooks", () => ({ useRankings: () => ({ data: undefined, isLoading: true }) }));
vi.mock("../attendanceHooks", () => ({ useMyAttendance: () => ({ data: undefined, isLoading: true }) }));

const { ClassroomOverview } = await import("../pages/Overview");

function student(id: number, first_name: string, last_name: string): InterventionStudent {
  return { student_id: id, email: `${first_name.toLowerCase()}@example.com`, first_name, last_name, profile_image_url: null };
}

const AZIZA = student(7, "Aziza", "Karimova");
const BEKZOD = student(9, "Bekzod", "Tursunov");
const DILNOZA = student(11, "Dilnoza", "Rahimova");
const JASUR = student(13, "Jasur", "Aliyev");

/**
 * Aziza turned in only the assessment (41.5%), twelve days ago. Dilnoza has never done anything.
 * Bekzod skipped the reading set; Jasur turned everything in at 55%. Students 15, 17 and 19 are
 * on track and appear in no list.
 */
const PAYLOAD: Interventions = {
  overdue_students: [
    { ...DILNOZA, overdue_count: 2, oldest_overdue_due_at: "2026-08-20T18:00:00+05:00" },
    { ...AZIZA, overdue_count: 1, oldest_overdue_due_at: "2026-09-05T18:00:00+05:00" },
    { ...BEKZOD, overdue_count: 1, oldest_overdue_due_at: "2026-09-05T18:00:00+05:00" },
  ],
  inactive_students: [
    { ...DILNOZA, last_activity_at: null, days_inactive: null },
    { ...AZIZA, last_activity_at: "2026-09-01T10:00:00+05:00", days_inactive: 12 },
  ],
  low_score_students: [
    { ...AZIZA, avg_score_pct: 41.5 },
    { ...JASUR, avg_score_pct: 55 },
  ],
  completion_summary: [
    { assignment_id: 31, title: "Linear equations", due_at: "2026-08-20T18:00:00+05:00", is_overdue: true, is_assessment: true, submitted_count: 6, student_count: 7, completion_pct: 85.7 },
    { assignment_id: 32, title: "Reading set 4", due_at: "2026-09-05T18:00:00+05:00", is_overdue: true, is_assessment: false, submitted_count: 4, student_count: 7, completion_pct: 57.1 },
    { assignment_id: 33, title: "Vocabulary review", due_at: "2026-09-20T18:00:00+05:00", is_overdue: false, is_assessment: false, submitted_count: 1, student_count: 7, completion_pct: 14.3 },
  ],
  class_stats: { student_count: 7, assignment_count: 3, overall_completion_pct: 52.4, avg_assessment_score_pct: 66.8 },
};

/** A response with nobody flagged. With no arguments, exactly what a class with no students gets. */
function quiet(class_stats: Partial<Interventions["class_stats"]> = {}): Interventions {
  return {
    overdue_students: [],
    inactive_students: [],
    low_score_students: [],
    completion_summary: [],
    class_stats: { student_count: 0, assignment_count: 0, overall_completion_pct: 0, avg_assessment_score_pct: null, ...class_stats },
  };
}

describe("classCompletionPct", () => {
  it("reads overall_completion_pct as the percentage it already is", () => {
    expect(classCompletionPct(PAYLOAD)).toBe(52);
  });

  it("does not turn a class at 1% into 100%", () => {
    // The old reading multiplied anything <= 1 by 100, guessing it might be a fraction.
    expect(classCompletionPct(quiet({ student_count: 7, assignment_count: 3, overall_completion_pct: 1 }))).toBe(1);
  });

  it("has no completion to show when nothing is assigned", () => {
    // The server sends 0 here, which would say nobody turned anything in.
    expect(classCompletionPct(quiet({ student_count: 7 }))).toBeNull();
    expect(classCompletionPct(quiet())).toBeNull();
  });

  it("has no completion to show before the response arrives", () => {
    expect(classCompletionPct(undefined)).toBeNull();
  });
});

describe("needsAttention", () => {
  it("lists each student once, with every reason, most reasons first", () => {
    expect(needsAttention(PAYLOAD).map((r) => [r.student.student_id, r.detail])).toEqual([
      [7, "1 missing · Inactive 12d · Average 41.5%"],
      [11, "2 missing · No activity yet"],
      [9, "1 missing"],
      [13, "Average 55%"],
    ]);
  });

  it("keeps the server's order among students with as many reasons", () => {
    const iv: Interventions = {
      ...quiet({ student_count: 7, assignment_count: 3 }),
      overdue_students: [
        { ...BEKZOD, overdue_count: 3, oldest_overdue_due_at: null },
        { ...AZIZA, overdue_count: 1, oldest_overdue_due_at: null },
      ],
      low_score_students: [{ ...JASUR, avg_score_pct: 30 }],
    };
    expect(needsAttention(iv).map((r) => r.detail)).toEqual(["3 missing", "1 missing", "Average 30%"]);
  });

  it("tells two students with the same name apart", () => {
    const iv: Interventions = {
      ...quiet({ student_count: 2, assignment_count: 1 }),
      overdue_students: [
        { ...student(21, "Aziza", "Karimova"), overdue_count: 1, oldest_overdue_due_at: null },
        { ...student(22, "Aziza", "Karimova"), overdue_count: 1, oldest_overdue_due_at: null },
      ],
    };
    expect(needsAttention(iv).map((r) => r.student.student_id)).toEqual([21, 22]);
  });

  it("is empty when nobody is flagged, or before the response arrives", () => {
    expect(needsAttention(quiet({ student_count: 7, assignment_count: 3, overall_completion_pct: 100 }))).toEqual([]);
    expect(needsAttention(undefined)).toEqual([]);
  });
});

describe("ClassroomOverview, for a teacher", () => {
  const CLASSROOM: ClassroomWithRole = {
    id: 12,
    name: "SAT Math — Evening",
    subject: "MATH",
    lesson_days: "ODD",
    teacher_details: null,
    join_code: "K7Q2PX",
    created_at: "2026-06-01T09:00:00+05:00",
    members_count: 8,
    student_count: 7,
    my_role: "TEACHER",
  };

  const MEMBERS: Member[] = [7, 9, 11, 13, 15, 17, 19].map((id) => ({
    id,
    user: { id, email: `s${id}@example.com` },
    role: "STUDENT",
  }));

  let host: HTMLElement;
  let root: Root;

  function query(overrides: Record<string, unknown> = {}) {
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), ...overrides };
  }

  async function render() {
    await act(async () => root.render(<ClassroomOverview classroom={CLASSROOM} onNavigate={() => {}} />));
  }

  /** The value under a stat card's label. */
  function stat(label: string) {
    const el = [...host.querySelectorAll("p")].find((p) => p.textContent === label);
    if (!el) throw new Error(`no "${label}" stat card`);
    return el.nextElementSibling?.textContent;
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    useClassMembers.mockReturnValue(query({ data: MEMBERS }));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("shows the class's real completion and the students who need attention", async () => {
    useInterventions.mockReturnValue(query({ data: PAYLOAD }));
    await render();

    expect(stat("Completion")).toBe("52%");
    expect(stat("Needs attention")).toBe("4");

    const text = host.textContent ?? "";
    expect(text).toContain("1 missing · Inactive 12d · Average 41.5%");
    expect(text).toContain("2 missing · No activity yet");
    expect(text).not.toContain("Everyone's on track");
    const order = ["Aziza Karimova", "Dilnoza Rahimova", "Bekzod Tursunov", "Jasur Aliyev"].map((n) => text.indexOf(n));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("says everyone is on track only when the server flagged nobody", async () => {
    useInterventions.mockReturnValue(query({ data: quiet({ student_count: 7, assignment_count: 3, overall_completion_pct: 100 }) }));
    await render();

    expect(stat("Completion")).toBe("100%");
    expect(stat("Needs attention")).toBe("0");
    expect(host.textContent).toContain("Everyone's on track");
  });

  it("shows a failed load as an error, never as everyone on track", async () => {
    const refetch = vi.fn();
    useInterventions.mockReturnValue(query({ isError: true, refetch }));
    await render();

    expect(host.textContent).toContain("We couldn't check in on students.");
    expect(host.textContent).not.toContain("Everyone's on track");
    expect(stat("Completion")).toBe("—");
    expect(stat("Needs attention")).toBe("—");

    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Try again"));
    if (!retry) throw new Error("no retry button");
    await act(async () => retry.click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows no numbers while the response is on its way", async () => {
    useInterventions.mockReturnValue(query({ isLoading: true }));
    await render();

    expect(stat("Completion")).toBe("—");
    expect(stat("Needs attention")).toBe("—");
    expect(host.textContent).not.toContain("Everyone's on track");
  });
});
