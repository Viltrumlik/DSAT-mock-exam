/**
 * The teacher dashboard reads its whole day from one payload, so a field the server stops
 * sending must degrade to "nothing to show" in one block rather than throw and take the page
 * with it. These pin that: the parser is the only thing standing between a changed API and a
 * blank dashboard.
 */
import { describe, expect, it } from "vitest";
import { parseTeacherToday } from "../useTeacherToday";

describe("parseTeacherToday", () => {
  it("reads a full payload into the shape the dashboard renders", () => {
    const parsed = parseTeacherToday({
      date: "2026-09-21",
      next_lesson_date: "2026-09-22",
      lessons: [
        {
          classroom_id: 1, name: "Math Junior 3", subject: "MATH", lesson_time: "10:00", student_count: 14,
          homework: {
            assignment_id: 91, title: "Linear functions, set 4", turned_in: 11, missing: 3,
            missing_students: [{ id: 7, name: "Aziza K." }],
          },
        },
      ],
      waiting_to_check: [{ classroom_id: 1, name: "Math Junior 3", count: 7 }],
      upcoming_midterms: [
        { midterm_id: 5, title: "September midterm", classroom_id: 1, name: "Math Junior 3", starts_at: "2026-09-24T10:00:00+05:00", pass_mark: 60 },
      ],
    });

    expect(parsed.date).toBe("2026-09-21");
    expect(parsed.nextLessonDate).toBe("2026-09-22");
    expect(parsed.lessons).toHaveLength(1);
    expect(parsed.lessons[0].homework).toEqual({
      assignmentId: 91,
      title: "Linear functions, set 4",
      turnedIn: 11,
      missing: 3,
      missingStudents: [{ id: 7, name: "Aziza K." }],
    });
    expect(parsed.waitingToCheck[0].count).toBe(7);
    expect(parsed.upcomingMidterms[0].passMark).toBe(60);
    expect(parsed.upcomingMidterms[0].className).toBe("Math Junior 3");
  });

  it("keeps a lesson whose time is blank, as a lesson with no time", () => {
    const parsed = parseTeacherToday({
      lessons: [{ classroom_id: 2, name: "Math Senior 2", lesson_time: "  ", student_count: 12, homework: null }],
    });
    expect(parsed.lessons[0].lessonTime).toBeNull();
    expect(parsed.lessons[0].name).toBe("Math Senior 2");
  });

  it("reads an ungraded midterm's pass mark as absent, never as zero", () => {
    const parsed = parseTeacherToday({
      upcoming_midterms: [{ midterm_id: 6, title: "Diagnostic", classroom_id: 3, name: "Math Senior 2", starts_at: "2026-09-29T10:00:00+05:00", pass_mark: null }],
    });
    expect(parsed.upcomingMidterms[0].passMark).toBeNull();
  });

  it("survives a payload with every list missing", () => {
    const parsed = parseTeacherToday({ date: "2026-09-21" });
    expect(parsed.lessons).toEqual([]);
    expect(parsed.waitingToCheck).toEqual([]);
    expect(parsed.upcomingMidterms).toEqual([]);
    expect(parsed.nextLessonDate).toBeNull();
  });

  it("survives a payload that is not an object at all", () => {
    expect(parseTeacherToday(null).lessons).toEqual([]);
    expect(parseTeacherToday("gone").date).toBe("");
    expect(parseTeacherToday(undefined).waitingToCheck).toEqual([]);
  });
});
