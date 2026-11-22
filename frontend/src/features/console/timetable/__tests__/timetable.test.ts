/**
 * The timetable's arithmetic (LessonsTimeline board): rooms are rows in natural order with "No room" last, time
 * runs 13:00–20:00 by the learning center's clock and widens for a real lesson outside it, overlapping lessons in
 * one room take their own lanes, and the day tabs are the coming week's days.
 */
import { describe, expect, it } from "vitest";

import type { LessonRow, LessonsToday } from "../../lessonsToday";
import {
  axisOf,
  clock,
  dayCountLine,
  dayTabs,
  duration,
  exportRows,
  minutesOfDay,
  roomLabel,
  roomRows,
  roomUsage,
  roomsIn,
  roomsPhrase,
  soonestOf,
  timeSpan,
} from "../timetable";

const lesson = (
  id: number,
  name: string,
  room: string,
  from: string | null,
  to: string | null,
  phase: LessonRow["phase"] = "upcoming",
  extra: Partial<LessonRow["classroom"]> = {},
): LessonRow => ({
  classroom: { id, name, room, ...extra },
  teacher: { id: 1, name: "Kamola" },
  starts_at: from ? `2026-11-23T${from}:00+05:00` : null,
  ends_at: to ? `2026-11-23T${to}:00+05:00` : null,
  phase,
  register: { roster: 12, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "not_yet", closes_at: null },
});

describe("the clock", () => {
  it("reads a time by the learning center's clock, whatever zone the string is in", () => {
    expect(minutesOfDay("2026-11-23T15:10:00+05:00")).toBe(15 * 60 + 10);
    expect(minutesOfDay("2026-11-23T10:10:00Z")).toBe(15 * 60 + 10);
    expect(clock(13 * 60 + 5)).toBe("13:05");
  });
});

describe("the axis", () => {
  it("runs 13:00–20:00, and widens to the whole hour that takes in a real lesson", () => {
    expect(axisOf([lesson(1, "A", "1", "14:00", "16:00")])).toEqual({ start: 13 * 60, end: 20 * 60 });
    expect(axisOf([lesson(1, "A", "1", "09:30", "11:30"), lesson(2, "B", "1", "19:00", "20:30")])).toEqual({ start: 9 * 60, end: 21 * 60 });
    expect(axisOf([lesson(1, "No time", "1", null, null)])).toEqual({ start: 13 * 60, end: 20 * 60 });
  });
});

describe("rooms as rows", () => {
  it("one row per room, in natural order, with No room last; a lesson with no time is not placed", () => {
    const rows = roomRows([
      lesson(1, "A", "302", "14:00", "16:00"),
      lesson(2, "B", "", "14:00", "16:00"),
      lesson(3, "C", "1001", "14:00", "16:00"),
      lesson(4, "D", "301", "16:00", "18:00"),
      lesson(5, "E", "301", null, null),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Room 301", "Room 302", "Room 1001", "No room"]);
    expect(rows[0].lessons.map((p) => p.lesson.classroom.id)).toEqual([4]);
  });

  it("places a lesson across its own hours as a share of the axis", () => {
    const [row] = roomRows([lesson(1, "A", "301", "14:00", "16:00")]);
    expect(row.lessons[0].left).toBeCloseTo((60 / 420) * 100);
    expect(row.lessons[0].width).toBeCloseTo((120 / 420) * 100);
  });

  it("gives two lessons that overlap in one room their own lanes, and reuses a lane once it is free", () => {
    const [row] = roomRows([
      lesson(1, "A", "301", "14:00", "16:00"),
      lesson(2, "B", "301", "15:00", "17:00"),
      lesson(3, "C", "301", "16:00", "18:00"),
    ]);
    expect(row.lanes).toBe(2);
    expect(row.lessons.map((p) => [p.lesson.classroom.name, p.lane])).toEqual([["A", 0], ["B", 1], ["C", 0]]);
  });

  it("takes the course from the level field first, else the first word of the group's name", () => {
    const [row] = roomRows([
      lesson(1, "Junior G21 · Math", "301", "14:00", "16:00", "upcoming", { level: "senior" }),
      lesson(2, "Foundation G3 · Math", "301", "16:00", "18:00"),
      lesson(3, "Night class", "301", "18:00", "20:00"),
    ]);
    expect(row.lessons.map((p) => p.level)).toEqual(["senior", "foundation", null]);
  });

  it("names a bare number as a room and keeps any other name as written", () => {
    expect(roomLabel("301")).toBe("Room 301");
    expect(roomLabel("12a")).toBe("Room 12a");
    expect(roomLabel("Big hall")).toBe("Big hall");
    expect(roomLabel("  ")).toBe("No room");
  });
});

describe("what the day says in words", () => {
  const now = [lesson(1, "A", "302", "14:00", "16:00", "now"), lesson(2, "B", "301", "14:30", "16:30", "now")];

  it("the span from the first start to the last end, and the rooms in use", () => {
    expect(timeSpan(now)).toBe("14:00–16:30");
    expect(timeSpan([])).toBe("");
    expect(roomsIn([...now, lesson(3, "C", "", "16:00", "18:00")])).toEqual(["301", "302"]);
  });

  it("an unbroken run of rooms as a range, others listed, many shortened", () => {
    expect(roomsPhrase(["301"])).toBe("room 301");
    expect(roomsPhrase(["301", "302", "303"])).toBe("rooms 301–303");
    expect(roomsPhrase(["301", "303"])).toBe("rooms 301, 303");
    expect(roomsPhrase(["1", "3", "5", "7", "9"])).toBe("rooms 1, 3, 5 +2");
    expect(roomsPhrase([])).toBe("");
  });

  it("N lessons · M rooms", () => {
    const d: LessonsToday = { date: "2026-11-23", lessons: now, counts: { lessons: 2, now: 2, not_marked: 0, no_teacher: 0 } };
    expect(dayCountLine(d)).toBe("2 lessons · 2 rooms");
  });
});

describe("room usage", () => {
  it("counts each room's busy minutes once, however its lessons overlap, as a share of the axis", () => {
    const lessons = [lesson(1, "A", "301", "14:00", "16:00"), lesson(2, "B", "301", "15:00", "17:00"), lesson(3, "C", "302", "18:00", "19:30")];
    const axis = axisOf(lessons);
    const usage = roomUsage(roomRows(lessons, axis), axis);
    expect(usage.map((u) => [u.label, u.lessons, u.minutes])).toEqual([["Room 301", 2, 180], ["Room 302", 1, 90]]);
    expect(usage[0].share).toBeCloseTo(180 / 420);
    expect(duration(180)).toBe("3 h");
    expect(duration(90)).toBe("1 h 30 min");
    expect(duration(45)).toBe("45 min");
  });
});

describe("the day tabs", () => {
  it("are Today, then each weekday's next day on or after today", () => {
    // 2026-11-18 is a Wednesday.
    const tabs = dayTabs("2026-11-18");
    expect(tabs.map((t) => `${t.short} ${t.date}`)).toEqual([
      "Today 2026-11-18",
      "Mon 2026-11-23",
      "Tue 2026-11-24",
      "Wed 2026-11-18",
      "Thu 2026-11-19",
      "Fri 2026-11-20",
      "Sat 2026-11-21",
      "Sun 2026-11-22",
    ]);
    expect(tabs[1].long).toBe("Monday, 23 November");
    expect(tabs.map((t) => t.parity)).toEqual(["odd", "odd", "even", "odd", "even", "odd", "even", null]);
  });

  it("Odd days and Even days jump to the soonest day of that pattern", () => {
    const wednesday = dayTabs("2026-11-18");
    expect(soonestOf(wednesday, "odd")).toBe("today");
    expect(soonestOf(wednesday, "even")).toBe("thu");
    const sunday = dayTabs("2026-11-22");
    expect(sunday[0].parity).toBeNull();
    expect(soonestOf(sunday, "odd")).toBe("mon");
    expect(soonestOf(sunday, "even")).toBe("tue");
  });
});

describe("the export", () => {
  it("a header, then each lesson by room and start, untimed last in its room", () => {
    const d: LessonsToday = {
      date: "2026-11-23",
      lessons: [
        lesson(1, "Junior G21 · Math", "302", "14:00", "16:00"),
        lesson(2, "Senior G4 · Math", "301", "16:00", "18:00"),
        { ...lesson(3, "Middle G2 · English", "301", "14:00", "16:00"), teacher: null },
        lesson(4, "No time", "301", null, null, "unknown"),
      ],
      counts: { lessons: 4, now: 0, not_marked: 0, no_teacher: 1 },
    };
    expect(exportRows(d)).toEqual([
      ["Date", "Room", "Start", "End", "Group", "Teacher", "Students", "State"],
      ["2026-11-23", "Room 301", "14:00", "16:00", "Middle G2 · English", "No teacher", 12, "Next"],
      ["2026-11-23", "Room 301", "16:00", "18:00", "Senior G4 · Math", "Kamola", 12, "Next"],
      ["2026-11-23", "Room 301", "", "", "No time", "Kamola", 12, "No time set"],
      ["2026-11-23", "Room 302", "14:00", "16:00", "Junior G21 · Math", "Kamola", 12, "Next"],
    ]);
  });
});
