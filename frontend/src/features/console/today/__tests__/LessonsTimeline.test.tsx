/**
 * Lessons today as an 08:00–20:00 strip (design handoff v0.3, AdminToday board): each lesson sits
 * across its own hours by the learning center's clock, lessons at the same hour take separate
 * rows, and a red line marks the current minute.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LessonRow } from "../../lessonsToday";
import { LessonsTimeline, layoutLessons, minutesOfDay } from "../LessonsTimeline";

const lesson = (
  id: number,
  name: string,
  from: string | null,
  to: string | null,
  phase: LessonRow["phase"],
  register: Partial<LessonRow["register"]> = {},
  teacher: LessonRow["teacher"] = { id: 1, name: "Kamola" },
): LessonRow => ({
  classroom: { id, name, room: "2" },
  teacher,
  starts_at: from ? `2026-11-11T${from}:00+05:00` : null,
  ends_at: to ? `2026-11-11T${to}:00+05:00` : null,
  phase,
  register: { roster: 8, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});

describe("where a lesson sits", () => {
  it("reads the time by the learning center's clock, whatever zone the string is in", () => {
    expect(minutesOfDay("2026-11-11T15:10:00+05:00")).toBe(15 * 60 + 10);
    expect(minutesOfDay("2026-11-11T10:10:00Z")).toBe(15 * 60 + 10);
    expect(minutesOfDay("2026-11-11T19:00:00Z")).toBe(0);
  });

  it("spans its own hours as a share of 08:00–20:00", () => {
    const [p] = layoutLessons([lesson(1, "Foundation F3", "09:00", "11:00", "ended")]);
    expect(p.left).toBeCloseTo((60 / 720) * 100);
    expect(p.width).toBeCloseTo((120 / 720) * 100);
  });

  it("gives lessons at the same hour their own rows, and reuses a row once it is free", () => {
    const placed = layoutLessons([
      lesson(1, "Middle M5", "14:00", "16:00", "now"),
      lesson(2, "Senior S4", "15:00", "17:00", "upcoming"),
      lesson(3, "Middle M7", "15:00", "17:00", "upcoming", {}, null),
      lesson(4, "Middle M9", "16:00", "18:00", "upcoming"),
    ]);
    expect(Object.fromEntries(placed.map((p) => [p.lesson.classroom.name, p.lane]))).toEqual({
      "Middle M5": 0,
      "Middle M7": 1,
      "Senior S4": 2,
      "Middle M9": 0,
    });
  });

  it("keeps a lesson outside the strip's hours on the strip, and leaves out one with no time", () => {
    const placed = layoutLessons([lesson(1, "Early", "07:00", "09:00", "ended"), lesson(2, "No time", null, null, "unknown")]);
    expect(placed).toHaveLength(1);
    expect(placed[0].left).toBe(0);
    expect(placed[0].width).toBeCloseTo((60 / 720) * 100);
  });
});

describe("LessonsTimeline", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const DAY = [
    lesson(3, "Foundation F3 · Math", "09:00", "11:00", "ended", { taken: true, marked: 8, state: "closed" }),
    lesson(6, "Junior J6 · Math", "13:00", "15:00", "ended", {}, { id: 2, name: "Shohruh" }),
    lesson(5, "Middle M5 · Math", "14:00", "16:00", "now", { marked: 11, present: 10, late: 1, roster: 12 }),
    lesson(9, "Middle M9 · English", "17:00", "19:00", "upcoming"),
    lesson(7, "Middle M7 · Math", "15:00", "17:00", "upcoming", {}, null),
    lesson(4, "Senior S1 · Math", "14:30", "16:30", "now", {}, null),
  ];

  function render(at: string) {
    vi.setSystemTime(new Date(at));
    act(() => root.render(<LessonsTimeline key={at} lessons={DAY} />));
  }

  it("draws each lesson as a block that says its state and opens its class", () => {
    render("2026-11-11T15:10:00+05:00");
    const blocks = [...host.querySelectorAll<HTMLLIElement>("li[data-look]")];
    const by = Object.fromEntries(blocks.map((b) => [b.querySelector("b")?.textContent, b]));
    expect(by["Foundation F3 · Math"].dataset.look).toBe("done");
    expect(by["Foundation F3 · Math"].textContent).toContain("8 / 8 marked · Kamola");
    expect(by["Junior J6 · Math"].textContent).toContain("Not marked · Shohruh");
    expect(by["Junior J6 · Math"].querySelector("a")?.getAttribute("href")).toBe("/ops/classrooms/6?tab=attendance");
    expect(by["Middle M5 · Math"].dataset.look).toBe("now");
    expect(by["Middle M5 · Math"].textContent).toContain("Now · 11 / 12 came");
    expect(by["Middle M9 · English"].dataset.look).toBe("next");
    expect(by["Middle M9 · English"].querySelector("a")?.getAttribute("href")).toBe("/ops/classrooms/9");
    expect(by["Middle M7 · Math"].dataset.look).toBe("warn");
    expect(by["Middle M7 · Math"].textContent).toContain("No teacher · 15:00");
    // Running with nobody teaching: amber like any unstaffed class, still live, named in words.
    expect(by["Senior S1 · Math"].dataset.look).toBe("warn");
    expect(by["Senior S1 · Math"].textContent).toContain("Now · No teacher");
    expect(by["Senior S1 · Math"].querySelector(".animate-ms-pulse")).not.toBeNull();
  });

  it("marks the current minute with a line, and drops it outside 08:00–20:00", () => {
    render("2026-11-11T15:10:00+05:00");
    const line = host.querySelector<HTMLElement>('[aria-label="Now, 15:10"]');
    expect(line).not.toBeNull();
    // 15:10 is 430 minutes into the 720-minute strip.
    expect(parseFloat(line!.style.left.replace("calc(", ""))).toBeCloseTo((430 / 720) * 100, 3);
    expect(line!.textContent).toBe("15:10");

    render("2026-11-11T21:30:00+05:00");
    expect(host.querySelector('[aria-label^="Now,"]')).toBeNull();
  });

  it("grows each block in, in time order", () => {
    render("2026-11-11T15:10:00+05:00");
    const links = [...host.querySelectorAll<HTMLAnchorElement>("li[data-look] a")];
    expect(links.every((a) => a.className.includes("animate-ms-wipe-in"))).toBe(true);
    const delays = links.map((a) => parseInt(a.style.animationDelay, 10));
    expect(delays).toEqual([...delays].sort((x, y) => x - y));
  });
});
