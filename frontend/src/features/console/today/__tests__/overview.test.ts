/**
 * What Today's tiles are made of (Shell board): students with lessons later today, when the registers still
 * waiting began, whether every register is in, debtors counted by student, and the active groups.
 */
import { describe, expect, it } from "vitest";

import type { LessonRow, LessonsToday } from "../../lessonsToday";
import { classCounts } from "../cards";
import { allMarked, closedUnmarked, debtTotals, laterToday, notMarkedFrom } from "../overview";

const lesson = (id: number, from: string, phase: LessonRow["phase"], register: Partial<LessonRow["register"]> = {}): LessonRow => ({
  classroom: { id, name: `Class ${id}` },
  teacher: { id: 1, name: "Kamola" },
  starts_at: `2026-11-18T${from}:00+05:00`,
  ends_at: `2026-11-18T${from.replace(/^(\d\d)/, (h) => String(Number(h) + 2).padStart(2, "0"))}:00+05:00`,
  phase,
  register: { roster: 10, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});
const day = (lessons: LessonRow[]): LessonsToday => ({ date: "2026-11-18", lessons, counts: { lessons: lessons.length, now: 0, not_marked: 0, no_teacher: 0 } });

describe("Today's tiles", () => {
  it("counts the students whose lesson is still to come", () => {
    expect(laterToday(day([lesson(1, "14:00", "now"), lesson(2, "16:00", "upcoming", { roster: 12 }), lesson(3, "18:00", "upcoming", { roster: 9 })]))).toBe(21);
    expect(laterToday(undefined)).toBe(0);
  });

  it("says when the registers still waiting began", () => {
    expect(notMarkedFrom(day([lesson(1, "14:00", "ended")]))).toBe("from the 14:00 lesson");
    expect(notMarkedFrom(day([lesson(1, "14:00", "ended"), lesson(2, "14:00", "ended")]))).toBe("from the 14:00 lessons");
    expect(notMarkedFrom(day([lesson(1, "16:00", "ended"), lesson(2, "14:00", "ended")]))).toBe("from the 14:00 and 16:00 lessons");
    expect(notMarkedFrom(day([lesson(1, "14:00", "ended", { taken: true, marked: 9 })]))).toBe("");
  });

  it("all registers marked only once every ended lesson's register is in; a closed empty one is counted apart", () => {
    expect(allMarked(day([lesson(1, "09:00", "ended", { taken: true, marked: 10 }), lesson(2, "14:00", "now")]))).toBe(true);
    expect(allMarked(day([lesson(1, "09:00", "ended", { taken: true }), lesson(2, "11:00", "ended")]))).toBe(false);
    expect(allMarked(day([lesson(2, "14:00", "now")]))).toBe(false);
    expect(closedUnmarked(day([lesson(1, "09:00", "ended", { state: "closed" }), lesson(2, "11:00", "ended")]))).toBe(1);
  });

  it("counts debtors by student, with what they owe, who is frozen and who is in no group", () => {
    expect(
      debtTotals([
        { debt: 153846, frozen: true, in_group: true },
        { debt: 300000, frozen: false, in_group: false },
        { debt: 46154, frozen: false, in_group: true },
      ]),
    ).toEqual({ students: 3, total: 500000, frozen: 1, noGroup: 1 });
  });

  it("reads the active groups off the classroom list's Status facet, else only the total", () => {
    expect(classCounts({ count: 40, filters: [{ key: "status", options: [{ value: "active", count: 34 }, { value: "archived", count: 6 }] }] })).toEqual({ total: 40, active: 34 });
    expect(classCounts({ count: 14 })).toEqual({ total: 14, active: null });
  });
});
