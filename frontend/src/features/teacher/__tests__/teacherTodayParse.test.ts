/**
 * The teacher dashboard reads its whole day from one payload — classes, the grading queue and
 * the figures behind the charts — so a field the server stops sending must degrade to
 * "nothing to show" in one block rather than throw and take the page with it. These pin that:
 * the parser is the only thing standing between a changed API and a blank dashboard.
 */
import { describe, expect, it } from "vitest";
import { parseTeacherToday } from "../useTeacherToday";

const FULL = {
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
        missing_students: [{ id: 7, name: "Aziza K." }],
      },
    },
  ],
  grading_queue: [
    {
      classroom_id: 1, name: "Math Junior 3", waiting: 9,
      assignments: [
        {
          assignment_id: 88, title: "Quadratics, week 3", waiting: 6,
          students: [{ id: 11, name: "Dilnoza S.", submitted_at: "2026-09-19T19:10:00+05:00" }],
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
    attendance_trend: [{ date: "2026-09-19", present: 77, late: 5, missed: 10 }],
  },
};

describe("parseTeacherToday", () => {
  it("reads a full payload into the shape the dashboard renders", () => {
    const p = parseTeacherToday(FULL);

    expect(p.date).toBe("2026-09-21");
    expect(p.nextLessonDate).toBe("2026-09-22");

    const klass = p.classes[0];
    expect(klass.name).toBe("Math Junior 3");
    expect(klass.room).toBe("22");
    expect(klass.lessonDaysLabel).toBe("Mon, Wed, Fri");
    expect(klass.state).toBe("now");
    expect(klass.homework).toEqual({
      assignmentId: 91, title: "Linear functions, set 4", turnedIn: 11, missing: 3,
      missingStudents: [{ id: 7, name: "Aziza K." }],
    });

    expect(p.gradingQueue[0].waiting).toBe(9);
    expect(p.gradingQueue[0].assignments[0].students[0].name).toBe("Dilnoza S.");
    expect(p.stats.attendanceWeek[0].missed).toBe(5);
    expect(p.stats.homework30d[0].turnedIn).toBe(98);
    expect(p.stats.attendanceTrend[0].present).toBe(77);
    expect(p.upcomingMidterms[0].passMark).toBe(60);
    expect(p.upcomingMidterms[0].className).toBe("Math Junior 3");
  });

  it("keeps a class whose room or lesson time was never filled in", () => {
    const p = parseTeacherToday({
      classes: [{ classroom_id: 2, name: "Math Senior 2", room: "", lesson_time: "  ", student_count: 12, homework: null }],
    });
    expect(p.classes[0].lessonTime).toBeNull();
    expect(p.classes[0].room).toBe("");
    expect(p.classes[0].name).toBe("Math Senior 2");
  });

  it("reads an unknown state as 'off' rather than trusting it into the UI", () => {
    const p = parseTeacherToday({ classes: [{ classroom_id: 3, name: "X", state: "exploded" }] });
    expect(p.classes[0].state).toBe("off");
  });

  it("survives a payload with every list missing", () => {
    const p = parseTeacherToday({ date: "2026-09-21" });
    expect(p.classes).toEqual([]);
    expect(p.gradingQueue).toEqual([]);
    expect(p.stats.attendanceWeek).toEqual([]);
    expect(p.stats.homework30d).toEqual([]);
    expect(p.stats.attendanceTrend).toEqual([]);
    expect(p.upcomingMidterms).toEqual([]);
    expect(p.nextLessonDate).toBeNull();
  });

  it("survives a payload that is not an object at all", () => {
    expect(parseTeacherToday(null).classes).toEqual([]);
    expect(parseTeacherToday("gone").date).toBe("");
    expect(parseTeacherToday(undefined).gradingQueue).toEqual([]);
    expect(parseTeacherToday(42).stats.attendanceTrend).toEqual([]);
  });
});
