/**
 * PR 10a — the student page's graphics: nine weeks × the days a class meets (past days with no mark stay
 * "none", days to come are "coming"), and the history read as timeline events.
 */
import { describe, expect, it } from "vitest";

import { attendanceGrid, historyEvents } from "../graphics";

describe("attendanceGrid", () => {
  const marks = [
    { date: "2026-11-09", class_id: 5, status: "PRESENT" },
    { date: "2026-11-04", class_id: 5, status: "ABSENT" },
    { date: "2026-11-06", class_id: 5, status: "LATE" },
    { date: "2026-11-10", class_id: 9, status: "PRESENT" }, // another class
  ];

  it("lays out nine weeks ending this week, by the class's own days", () => {
    const g = attendanceGrid(marks, { id: 5, weekdays: [0, 2, 4] }, "2026-11-11");
    expect(g.weeks).toHaveLength(9);
    expect(g.weeks.at(-1)).toBe("9 Nov");
    expect(g.weeks[0]).toBe("14 Sep"); // Monday 9 Nov − 8 weeks
    expect(g.rows.map((r) => r.day)).toEqual(["Mon", "Wed", "Fri"]);
    const [mon, wed, fri] = g.rows;
    expect(mon.marks.at(-1)).toBe("present"); // Mon 9 Nov
    expect(wed.marks.at(-1)).toBe("none"); // Wed 11 Nov: today, not marked yet
    expect(wed.marks.at(-2)).toBe("absent"); // Wed 4 Nov
    expect(fri.marks.at(-2)).toBe("late"); // Fri 6 Nov
    expect(fri.marks.at(-1)).toBe("coming"); // Fri 13 Nov
  });

  it("keeps the marks of a class that moved days: its old days stay as rows", () => {
    // Marked on Tue/Thu (5 and 3 Nov… ) but now meets Mon/Wed/Fri.
    const moved = [
      { date: "2026-11-03", class_id: 5, status: "ABSENT" },
      { date: "2026-11-05", class_id: 5, status: "PRESENT" },
    ];
    const g = attendanceGrid(moved, { id: 5, weekdays: [0, 2, 4] }, "2026-11-11");
    expect(g.rows.map((r) => r.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    const tue = g.rows[1];
    expect(tue.marks.at(-2)).toBe("absent"); // Tue 3 Nov
    expect(tue.marks.at(-1)).toBe("none"); // Tue 10 Nov: past, no mark
    expect(g.rows[3].marks.at(-1)).toBe("none"); // Thu 12 Nov: no longer a lesson day, not "coming"
    expect(g.rows[4].marks.at(-1)).toBe("coming"); // Fri 13 Nov: a lesson day still to come
  });

  it("falls back to the days it has marks on when the server names none", () => {
    const g = attendanceGrid(marks, { id: 5 }, "2026-11-11");
    expect(g.rows.map((r) => r.day)).toEqual(["Mon", "Wed", "Fri"]);
  });
});

describe("historyEvents", () => {
  it("reads newest first, each kind under its chip", () => {
    const events = historyEvents([
      { at: "2026-10-01T09:30:00+05:00", kind: "group", title: "Added to Junior G21 Math", by: "" },
      { at: "2026-10-15T14:05:00+05:00", kind: "payment", title: "Payment 650,000 UZS", by: "lc-up", all_day: true },
    ]);
    expect(events.map((e) => [e.kind, e.title])).toEqual([
      ["money", "Payment 650,000 UZS"],
      ["seat", "Added to Junior G21 Math"],
    ]);
    expect(events[0].meta).toBe("by lc-up · Oct 15, 2026");
  });
});
