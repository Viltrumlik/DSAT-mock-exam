/** Lessons today: each timetable card says its state in words, and the "not marked" item only for registers still fixable. */
import { describe, expect, it } from "vitest";

import { lessonHref, lessonState, nowState } from "../timetable/timetable";
import { isNotMarked, notMarkedItem, type LessonRow, type LessonsToday } from "../lessonsToday";

const row = (phase: LessonRow["phase"], register: Partial<LessonRow["register"]> = {}, teacher: LessonRow["teacher"] = { id: 1, name: "Shohruh" }): LessonRow => ({
  classroom: { id: 6, name: "Junior J6 · Math" },
  teacher,
  starts_at: "2026-11-11T13:30:00+05:00",
  ends_at: "2026-11-11T15:00:00+05:00",
  phase,
  register: { roster: 8, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});

describe("a lesson's card on the timetable", () => {
  it("says the register's real state in words: in progress, not marked, next, and what an ended one held", () => {
    expect(lessonState(row("now"))).toMatchObject({ key: "now", label: "In progress", tone: "info" });
    expect(lessonState(row("ended"))).toMatchObject({ key: "not_marked", label: "Not marked", tone: "attention" });
    expect(lessonState(row("upcoming"))).toMatchObject({ key: "next", label: "Next", tone: "line" });
    expect(lessonState(row("ended", { taken: true, marked: 8, present: 7, late: 1 }))).toMatchObject({ key: "came", label: "Came 8 of 8", tone: "positive" });
    expect(lessonState(row("ended", { state: "closed" }))).toMatchObject({ key: "closed", label: "Closed unmarked", tone: "attention" });
    expect(lessonState(row("ended", { taken: true, roster: 0 }))).toMatchObject({ key: "done", label: "Ended" });
    expect(lessonState(row("unknown"))).toMatchObject({ key: "unknown", label: "No time set" });
  });

  it("opens the group, on its attendance while the register still waits", () => {
    expect(lessonHref(row("ended"))).toBe("/ops/classrooms/6?tab=attendance");
    expect(lessonHref(row("now"))).toBe("/ops/classrooms/6");
    expect(lessonHref(row("ended", { taken: true, marked: 8 }))).toBe("/ops/classrooms/6");
  });

  it("a lesson on now, in Today's list: who came so far, or not marked yet", () => {
    expect(nowState(row("now", { marked: 11, present: 10, late: 1, roster: 12 }))).toEqual({ label: "Came 11 of 12", tone: "positive" });
    expect(nowState(row("now"))).toEqual({ label: "Not marked", tone: "attention" });
    expect(nowState(row("now", { roster: 0, taken: true }))).toEqual({ label: "No students", tone: "neutral" });
  });
});

describe("a register", () => {
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
