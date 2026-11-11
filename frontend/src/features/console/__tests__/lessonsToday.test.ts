/** Lessons today: one verdict per lesson, and the "not marked" item only for registers still fixable. */
import { describe, expect, it } from "vitest";

import { lessonVerdict } from "../today/LessonsTodayCard";
import { isNotMarked, notMarkedItem, type LessonRow, type LessonsToday } from "../lessonsToday";

const row = (phase: LessonRow["phase"], register: Partial<LessonRow["register"]> = {}, teacher: LessonRow["teacher"] = { id: 1, name: "Shohruh" }): LessonRow => ({
  classroom: { id: 6, name: "Junior J6 · Math" },
  teacher,
  starts_at: "2026-11-11T13:30:00+05:00",
  ends_at: "2026-11-11T15:00:00+05:00",
  phase,
  register: { roster: 8, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});

describe("a lesson's verdict", () => {
  it("names each state in words", () => {
    expect(lessonVerdict(row("now", { marked: 11, present: 10, late: 1, roster: 12 })).text).toBe("Now · 11 / 12 came");
    expect(lessonVerdict(row("ended")).text).toBe("Not marked");
    expect(lessonVerdict(row("ended", { taken: true, marked: 8 })).text).toBe("8 / 8 marked");
    expect(lessonVerdict(row("upcoming", {}, null)).text).toBe("No teacher");
    expect(lessonVerdict(row("upcoming")).text).toBe("Starts 13:30");
    expect(lessonVerdict(row("ended", { state: "closed" })).text).toBe("Closed unmarked");
    expect(lessonVerdict({ ...row("unknown"), starts_at: null }).text).toBe("Time not set");
  });

  it("counts a register as fixable only when ended, unmarked and still open", () => {
    expect(isNotMarked(row("ended"))).toBe(true);
    expect(isNotMarked(row("ended", { state: "open" }))).toBe(true);
    expect(isNotMarked(row("ended", { state: "closed" }))).toBe(false);
    expect(isNotMarked(row("ended", { taken: true }))).toBe(false);
    expect(isNotMarked(row("now"))).toBe(false);
  });
});

describe("the not-marked item", () => {
  const today = (lessons: LessonRow[], not_marked: number): LessonsToday => ({ date: "2026-11-11", lessons, counts: { lessons: lessons.length, now: 0, not_marked, no_teacher: 0 } });

  it("names the class when there is one, links to its register, and says when it ended", () => {
    const item = notMarkedItem(today([row("ended")], 1))!;
    expect(item.title).toBe("Junior J6 · Math attendance not marked");
    expect(item.detail).toBe("Lesson ended 15:00 · Shohruh");
    expect(item.action.href).toBe("/ops/classrooms/6?tab=attendance");
  });

  it("counts several, and says nothing when every register is fine", () => {
    expect(notMarkedItem(today([row("ended"), row("ended")], 2))!.title).toBe("2 registers not marked");
    expect(notMarkedItem(today([row("ended", { taken: true })], 0))).toBeNull();
  });
});
