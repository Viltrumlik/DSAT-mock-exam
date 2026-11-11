/**
 * Today's cards (design handoff v0.3, AdminToday board): what each number is made of — who came today,
 * where "Mark attendance" goes, what the debt bars say, when the SMS balance runs out, the next SAT and
 * mock sitting, this week's events.
 */
import { describe, expect, it } from "vitest";

import type { LessonRow, LessonsToday } from "../../lessonsToday";
import { cameToday, debtFinding, eventsThisWeek, markAttendanceHref, nextExamDate, nextSitting, runsOut } from "../cards";

const lesson = (id: number, phase: LessonRow["phase"], register: Partial<LessonRow["register"]> = {}): LessonRow => ({
  classroom: { id, name: `Class ${id}` },
  teacher: { id: 1, name: "Kamola" },
  starts_at: "2026-11-11T09:00:00+05:00",
  ends_at: "2026-11-11T11:00:00+05:00",
  phase,
  register: { roster: 8, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});
const day = (lessons: LessonRow[]): LessonsToday => ({ date: "2026-11-11", lessons, counts: { lessons: lessons.length, now: 0, not_marked: 0, no_teacher: 0 } });

describe("Came today", () => {
  it("counts present and late of those marked, with the absent and late beside", () => {
    expect(cameToday(day([lesson(1, "ended", { marked: 8, present: 7, late: 1, taken: true }), lesson(2, "now", { marked: 12, present: 9, late: 0, absent: 3 }), lesson(3, "upcoming")]))).toEqual({
      came: 17,
      of: 20,
      absent: 3,
      late: 1,
    });
  });
  it("says nothing before any register is marked", () => {
    expect(cameToday(day([lesson(1, "upcoming")]))).toBeNull();
    expect(cameToday(undefined)).toBeNull();
  });
});

describe("Mark attendance", () => {
  it("opens the first register still to fix, else the lesson on now, else the classrooms", () => {
    expect(markAttendanceHref(day([lesson(4, "now"), lesson(6, "ended")]))).toBe("/ops/classrooms/6?tab=attendance");
    expect(markAttendanceHref(day([lesson(4, "now"), lesson(6, "ended", { taken: true })]))).toBe("/ops/classrooms/4?tab=attendance");
    expect(markAttendanceHref(day([lesson(5, "upcoming")]))).toBe("/ops/classrooms");
  });
});

describe("Where debt sits", () => {
  it("says how concentrated the debt is — what the bars show and the numbers alone don't", () => {
    expect(debtFinding([{ group: "Senior S4", debt: 600 }, { group: "M5", debt: 200 }, { group: "F3", debt: 200 }])).toBe("Senior S4 holds 60 % of the debt.");
    expect(
      debtFinding([
        { group: "A", debt: 300 },
        { group: "B", debt: 250 },
        { group: "C", debt: 200 },
        { group: "D", debt: 150 },
        { group: "E", debt: 100 },
      ]),
    ).toBe("Two groups hold 55 % of the debt.");
    expect(debtFinding([{ group: "A", debt: 100 }])).toBeNull();
  });
});

describe("SMS balance", () => {
  it("runs out at the last days' average spend", () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${29 + i}`, cost: 1500 }));
    expect(runsOut(15_000, days, "2026-11-11")).toEqual({ perDay: 1500, days: 10, date: "2026-11-21" });
  });
  it("counts the days with no messages as zero spend, not as missing", () => {
    // by_day lists only days that had messages: 2 days × 7 000 over a 14-day window = 1 000 a day.
    const days = [
      { day: "2026-11-03", cost: 7000 },
      { day: "2026-11-10", cost: 7000 },
    ];
    expect(runsOut(20_000, days, "2026-11-11")).toEqual({ perDay: 1000, days: 20, date: "2026-12-01" });
  });
  it("makes no forecast without a balance or without any spend", () => {
    expect(runsOut(null, [{ day: "2026-11-11", cost: 100 }], "2026-11-11")).toBeNull();
    expect(runsOut(5000, [{ day: "2026-11-11", cost: 0 }], "2026-11-11")).toBeNull();
  });
});

describe("Platform", () => {
  it("finds the next active SAT date on or after today", () => {
    expect(
      nextExamDate(
        [
          { exam_date: "2026-10-04", is_active: true },
          { exam_date: "2027-03-13", is_active: true, label: "March" },
          { exam_date: "2026-12-06", is_active: false },
        ],
        "2026-11-11",
      ),
    ).toEqual({ exam_date: "2027-03-13", is_active: true, label: "March" });
  });
  it("finds the next mock sitting that has not ended or been cancelled", () => {
    const s = (id: number, session_date: string, status: string) => ({ id, session_date, status, title: `S${id}`, mock_title: "Full Mock 5" }) as never;
    expect(nextSitting([s(1, "2026-11-08", "ENDED"), s(2, "2026-11-20", "CANCELLED"), s(3, "2026-11-14", "OPEN")], "2026-11-11")).toMatchObject({ id: 3 });
  });
  it("counts events starting in the coming seven days", () => {
    const now = new Date("2026-11-11T10:00:00Z");
    expect(eventsThisWeek([{ starts_at: "2026-11-12T10:00:00Z" }, { starts_at: "2026-11-20T10:00:00Z" }, { starts_at: "2026-11-10T10:00:00Z" }], now)).toBe(1);
  });
});
