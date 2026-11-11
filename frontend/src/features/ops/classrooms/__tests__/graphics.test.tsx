/**
 * The class page's graphics (PR 11a): what "Lessons" and "Handed in" say in their one line, and which
 * assignments the homework chart draws (only those already due, by the centre's day).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandedInChart, LessonsChart, fullDay, homeworkFinding, lessonsFinding, shortDay, tashkentDay } from "../graphics";

const lesson = (date: string, present: number, absent: number, late = 0, excused = 0) => ({
  date,
  present,
  late,
  absent,
  excused,
  lcup_push: null,
});

describe("lessonsFinding", () => {
  it("names the lesson most were missing from, the latest on a tie", () => {
    expect(lessonsFinding([lesson("2026-11-03", 10, 4), lesson("2026-11-05", 12, 2), lesson("2026-11-07", 10, 4)])).toBe(
      "Most missed: Sat 7 Nov, 4 of 14 absent.",
    );
  });

  it("says attendance held when no lesson lost a quarter", () => {
    expect(lessonsFinding([lesson("2026-11-03", 13, 1), lesson("2026-11-05", 12, 2)])).toBe(
      "Attendance held: at most 2 absent in a lesson.",
    );
  });

  it("says so when nobody was absent", () => {
    expect(lessonsFinding([lesson("2026-11-03", 14, 0, 1)])).toBe("No one was absent in the last 1 lesson.");
    expect(lessonsFinding([])).toBe("");
  });
});

describe("homeworkFinding", () => {
  it("counts the assignments under half handed in", () => {
    expect(homeworkFinding([{ turned_in: 3, students: 14 }, { turned_in: 7, students: 14 }, { turned_in: 12, students: 14 }])).toBe(
      "1 of 3 assignments had under half handed in.",
    );
  });

  it("says when every one reached half", () => {
    expect(homeworkFinding([{ turned_in: 7, students: 14 }, { turned_in: 9, students: 14 }])).toBe("All 2 had at least half handed in.");
    expect(homeworkFinding([{ turned_in: 9, students: 14 }])).toBe("At least half handed it in.");
  });
});

describe("days", () => {
  it("reads a date and a due moment the centre's way", () => {
    expect(shortDay("2026-11-04")).toBe("4 Nov");
    expect(fullDay("2026-11-04")).toBe("Wed 4 Nov");
    // 20:30 UTC on the 3rd is already the 4th in Tashkent (UTC+5).
    expect(tashkentDay("2026-11-03T20:30:00Z")).toBe("2026-11-04");
  });
});

describe("the charts", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("draws the last 12 lessons, oldest first", () => {
    const sessions = Array.from({ length: 15 }, (_, i) => lesson(`2026-10-${String(30 - i).padStart(2, "0")}`, 10, 1));
    act(() => root.render(<LessonsChart sessions={sessions} />));
    const tips = [...host.querySelectorAll("svg title")].map((t) => t.textContent);
    expect(tips).toHaveLength(12);
    expect(tips[0]).toMatch(/^Mon 19 Oct:/);
    expect(tips.at(-1)).toMatch(/^Fri 30 Oct:/);
  });

  it("draws only assignments already due, and nothing when none is", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const assignments = [
      { id: 3, title: "Next week", due_at: "2026-11-18T10:00:00Z", turned_in: 0, students: 14 },
      { id: 2, title: "Ratios", due_at: "2026-11-06T10:00:00Z", turned_in: 5, students: 14 },
      { id: 1, title: "Quadratics", due_at: "2026-11-02T10:00:00Z", turned_in: 12, students: 14 },
      { id: 0, title: "Undated", due_at: null, turned_in: 3, students: 14 },
    ];
    act(() => root.render(<HandedInChart assignments={assignments} now={now} />));
    expect([...host.querySelectorAll("svg title")].map((t) => t.textContent)).toEqual([
      "Quadratics · due Mon 2 Nov: 12 handed in, 2 not handed in",
      "Ratios · due Fri 6 Nov: 5 handed in, 9 not handed in",
    ]);
    expect(host.textContent).toContain("1 of 2 assignments had under half handed in.");
    act(() => root.render(<HandedInChart assignments={assignments.slice(0, 1)} now={now} />));
    expect(host.textContent).toBe("");
  });
});
