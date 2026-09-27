/**
 * The three readings in the classroom overview that are not obvious, pinned on their own.
 * Each has a plausible wrong answer that would send a teacher after the wrong student.
 */
import { describe, expect, it } from "vitest";
import {
  attentionItems, dueNext, localDay, todayRegister, turnedIn, waitingToGrade,
} from "../classroomOverview/overviewModel";

const TODAY = "2026-09-21";

function homework(id: number, due: string, over: Partial<{ is_auto_graded: boolean; status: string; needs_grading: number }> = {}) {
  return {
    id, title: `Homework ${id}`, status: over.status ?? "PUBLISHED", category: "HOMEWORK",
    due_at: due, is_auto_graded: over.is_auto_graded ?? false, source_label: "Manual", max_score: "100.00",
    counts: { graded: 5, needs_grading: over.needs_grading ?? 0, submitted: 0, needs_revision: 0, missing: 2, total: 12 },
    performance: null,
  };
}
const overview = (assignments: unknown[]) =>
  ({ assignments, needs_grading_total: 0, students: 12 } as never);

describe("turnedIn", () => {
  it("counts work sent back for revision as turned in — the student did hand it over", () => {
    expect(turnedIn({ graded: 5, needs_grading: 2, submitted: 2, needs_revision: 3, missing: 2, total: 12 })).toBe(10);
  });

  it("never goes negative when the server's counts disagree with its total", () => {
    expect(turnedIn({ graded: 0, needs_grading: 0, submitted: 0, needs_revision: 0, missing: 9, total: 4 })).toBe(0);
  });
});

describe("dueNext", () => {
  it("keeps today's homework after its deadline has passed — that is the work being chased", () => {
    const rows = [homework(88, "2026-09-21T18:00:00+05:00"), homework(91, "2026-09-24T18:00:00+05:00")];
    // 21:00 on the due day: the 18:00 deadline is gone, the homework is not.
    expect(dueNext(overview(rows), TODAY)?.id).toBe(88);
  });

  it("leaves yesterday's behind, and never offers homework students cannot open", () => {
    const rows = [
      homework(70, "2026-09-20T18:00:00+05:00"),
      homework(71, "2026-09-22T18:00:00+05:00", { status: "ARCHIVED" }),
      homework(72, "2026-09-23T18:00:00+05:00"),
    ];
    expect(dueNext(overview(rows), TODAY)?.id).toBe(72);
    expect(dueNext(overview([homework(70, "2026-09-20T18:00:00+05:00")]), TODAY)).toBeNull();
  });
});

describe("waitingToGrade", () => {
  it("leaves self-marking work out — a quiz that grades itself is not a job", () => {
    const rows = [
      homework(91, "2026-09-22T18:00:00+05:00", { needs_grading: 3 }),
      homework(70, "2026-09-22T18:00:00+05:00", { needs_grading: 9, is_auto_graded: true }),
    ];
    expect(waitingToGrade(overview(rows))).toEqual([{ id: 91, title: "Homework 91", waiting: 3 }]);
  });
});

describe("todayRegister", () => {
  const session = (over: object) => ({ id: 5, date: TODAY, title: "Lesson 11", lesson_index: 11, ...over } as never);

  it("reads no session for today as no lesson today, not as a job left undone", () => {
    expect(todayRegister([], TODAY).state).toBe("none");
    expect(todayRegister([session({ date: "2026-09-20", status: "OPEN" })], TODAY).state).toBe("none");
  });

  it("tells a finalised register from an unfinalised one, and reads nothing else into it", () => {
    expect(todayRegister([session({ status: "OPEN" })], TODAY).state).toBe("open");
    expect(todayRegister([session({ status: "FINALIZED" })], TODAY).state).toBe("marked");
  });

  // The register's own `counts` is the field this used to read. The endpoint never fills it
  // (`_session_brief` takes it as an optional argument and all five call sites omit it), so
  // these are the shapes that actually arrive — and a teacher who has marked every student is
  // in exactly the same one as a teacher who has marked none. Any state derived from `counts`
  // would be a guess; the one thing this may not do is call a marked register untouched.
  it("does not pretend to know how far an unfinalised register has been marked", () => {
    for (const counts of [undefined, null, {}, { PRESENT: 12 }]) {
      expect(todayRegister([session({ status: "OPEN", counts })], TODAY).state).toBe("open");
    }
  });
});

describe("attentionItems", () => {
  it("gives one row per student however many signals they trip, hardest first", () => {
    const items = attentionItems({
      low_score_students: [{ student_id: 7, first_name: "Aziza", last_name: "Karimova", avg_score_pct: 44 }],
      overdue_students: [
        { student_id: 7, first_name: "Aziza", last_name: "Karimova", overdue_count: 3 },
        { student_id: 8, first_name: "Bekzod", last_name: "Rahimov", overdue_count: 1 },
      ],
      inactive_students: [{ student_id: 7, first_name: "Aziza", last_name: "Karimova", days_inactive: 12 }],
    });
    expect(items.map((i) => `${i.name} · ${i.reason}`)).toEqual([
      "Aziza Karimova · Averaging 44%",
      "Bekzod Rahimov · 1 piece not turned in",
    ]);
  });

  it("is a handful, not a list — a teacher wants people to find in the room", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ student_id: i + 1, email: `s${i}@e.uz`, overdue_count: 2 }));
    expect(attentionItems({ overdue_students: many })).toHaveLength(5);
  });

  it("never lets one signal fill the list and hide the others", () => {
    // Six students under the average threshold, which is more than the whole list holds. The
    // student with eight pieces not turned in must still be on it — that is the one a teacher
    // can do something about before the next lesson.
    const items = attentionItems({
      low_score_students: Array.from({ length: 6 }, (_, i) => ({ student_id: 100 + i, email: `low${i}@e.uz`, avg_score_pct: 40 + i })),
      overdue_students: [{ student_id: 8, first_name: "Bekzod", last_name: "Rahimov", overdue_count: 8 }],
      inactive_students: [{ student_id: 9, first_name: "Malika", last_name: "Rustamova", days_inactive: 14 }],
    });
    expect(items.map((i) => i.name)).toContain("Bekzod Rahimov");
    expect(items.map((i) => i.name)).toContain("Malika Rustamova");
    // And the worst average is still the first thing a teacher reads.
    expect(items[0].reason).toBe("Averaging 40%");
  });
});

describe("localDay", () => {
  it("answers in the reader's own day, which is what the register's date is", () => {
    // Pinned to Asia/Tashkent by the vitest config: 23:30 UTC is already tomorrow here.
    expect(localDay(new Date("2026-09-20T23:30:00Z"))).toBe("2026-09-21");
  });
});
