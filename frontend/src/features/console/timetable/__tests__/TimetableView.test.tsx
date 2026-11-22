/**
 * The timetable (LessonsTimeline board): rooms × hours with a red line at the minute on today, cards that say
 * their register's state and open their group; the day tabs and Even / Odd days ask the endpoint for that day;
 * Sunday is empty and says why; a failure is never an empty day; Room usage and the untimed lessons are shown.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LessonRow, LessonsToday } from "../../lessonsToday";

const get = vi.fn();
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const { RoomTimeline } = await import("../RoomTimeline");
const { TimetableView, useTimetable } = await import("../TimetableView");

const lesson = (
  id: number,
  name: string,
  room: string,
  from: string | null,
  to: string | null,
  phase: LessonRow["phase"],
  register: Partial<LessonRow["register"]> = {},
  teacher: LessonRow["teacher"] = { id: 1, name: "Kamola" },
  day = "2026-11-18",
): LessonRow => ({
  classroom: { id, name, room, level: "" },
  teacher,
  starts_at: from ? `${day}T${from}:00+05:00` : null,
  ends_at: to ? `${day}T${to}:00+05:00` : null,
  phase,
  register: { roster: 12, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});

const TODAY: LessonsToday = {
  date: "2026-11-18",
  lessons: [
    lesson(5, "Junior G21 · Math", "302", "14:00", "16:00", "now", { marked: 11, present: 10, late: 1 }),
    lesson(6, "Middle G24 · Math", "301", "11:00", "13:00", "ended"),
    lesson(7, "Senior G4 · Math", "301", "16:00", "18:00", "upcoming", {}, null),
    lesson(8, "Foundation G3 · Math", "", "18:00", "20:00", "upcoming"),
    lesson(9, "Night class", "303", null, null, "unknown"),
  ],
  counts: { lessons: 5, now: 1, not_marked: 1, no_teacher: 1 },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T15:10:00+05:00")); // a Wednesday
  get.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const cards = () => Object.fromEntries([...host.querySelectorAll<HTMLAnchorElement>("a[data-lesson]")].map((a) => [a.dataset.lesson, a]));

describe("RoomTimeline", () => {
  it("draws a row per room, No room last, and each card across its hours with its state", () => {
    act(() => root.render(<RoomTimeline lessons={TODAY.lessons} isToday />));
    const rooms = [...host.querySelectorAll("ul[aria-label]")].map((u) => u.getAttribute("aria-label"));
    expect(rooms).toEqual(["Room 301", "Room 302", "No room"]);
    const c = cards();
    expect(c["5"].dataset.state).toBe("now");
    expect(c["5"].textContent).toContain("In progress");
    expect(c["5"].textContent).toContain("14:00–16:00");
    expect(c["5"].textContent).toContain("12 st.");
    expect(c["5"].getAttribute("href")).toBe("/ops/classrooms/5");
    expect(c["6"].dataset.state).toBe("not_marked");
    expect(c["6"].getAttribute("href")).toBe("/ops/classrooms/6?tab=attendance");
    expect(c["7"].textContent).toContain("No teacher");
    expect(c["7"].textContent).toContain("Next");
    // The 11:00 lesson widens the axis to 11:00–20:00 (540 minutes); 14:00 is 180 minutes in.
    expect(parseFloat(c["5"].style.left.replace("calc(", ""))).toBeCloseTo((180 / 540) * 100, 3);
    expect(host.textContent).toContain("11:00");
    // The untimed lesson has no card.
    expect(c["9"]).toBeUndefined();
  });

  it("marks the minute on today with a red line and its time, and not on another day", () => {
    act(() => root.render(<RoomTimeline lessons={TODAY.lessons} isToday />));
    expect(host.querySelector("[data-now-label]")?.textContent).toBe("15:10");
    expect(host.querySelectorAll("[data-now-line]")).toHaveLength(3);
    act(() => root.render(<RoomTimeline lessons={TODAY.lessons} isToday={false} />));
    expect(host.querySelector("[data-now-label]")).toBeNull();
  });

  it("tints a card by its course", () => {
    const tagged = { ...lesson(1, "Whatever", "301", "14:00", "16:00", "upcoming"), classroom: { id: 1, name: "Whatever", room: "301", level: "junior" } };
    act(() => root.render(<RoomTimeline lessons={[tagged]} isToday={false} />));
    const a = cards()["1"];
    expect(a.style.boxShadow).toContain("var(--ms-course-junior)");
    expect(a.style.backgroundColor).toContain("11%");
  });
});

function Harness() {
  const t = useTimetable();
  return <TimetableView t={t} idPrefix="t" />;
}

async function renderView() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name);
const radio = (name: string) => [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === name);

describe("TimetableView", () => {
  beforeEach(() => {
    get.mockImplementation(async (_url: string, cfg?: { params?: { date?: string } }) => {
      const date = cfg?.params?.date;
      if (!date) return { data: TODAY };
      if (date === "2026-11-22") return { data: { date, lessons: [], counts: { lessons: 0, now: 0, not_marked: 0, no_teacher: 0 } } };
      return { data: { date, lessons: [lesson(7, "Senior G4 · Math", "301", "16:00", "18:00", "upcoming", { state: "not_yet" }, undefined, date)], counts: { lessons: 1, now: 0, not_marked: 0, no_teacher: 0 } } };
    });
  });

  it("opens on today, with the untimed lesson named under the grid", async () => {
    await renderView();
    expect(get).toHaveBeenCalledWith("/classes/admin/lessons/today/");
    expect(tab("Today")?.getAttribute("aria-selected")).toBe("true");
    expect(radio("Odd days")?.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("No time set:");
    expect(host.querySelector('a[href="/ops/classrooms/9"]')?.textContent).toBe("Night class");
    expect(host.textContent).toContain("Red line = now. Colour = course. A card opens its group");
  });

  it("asks for another day by its date, and Even days jumps to the soonest even day", async () => {
    await renderView();
    await click(tab("Mon"));
    expect(get).toHaveBeenLastCalledWith("/classes/admin/lessons/today/", { params: { date: "2026-11-23" } });
    expect(host.querySelector("[data-now-label]")).toBeNull();
    expect(cards()["7"].dataset.state).toBe("next");
    await click(radio("Even days"));
    expect(get).toHaveBeenLastCalledWith("/classes/admin/lessons/today/", { params: { date: "2026-11-19" } });
    expect(tab("Thu")?.getAttribute("aria-selected")).toBe("true");
  });

  it("says a Sunday has no lessons, and why", async () => {
    await renderView();
    await click(tab("Sun"));
    expect(host.textContent).toContain("No lessons on Sundays.");
    expect(host.textContent).toContain("odd days (Mon, Wed, Fri) or even days (Tue, Thu, Sat)");
  });

  it("shows each room's usage on demand", async () => {
    await renderView();
    const usage = [...host.querySelectorAll("button")].find((b) => b.textContent === "Room usage")!;
    await click(usage);
    expect(usage.getAttribute("aria-pressed")).toBe("true");
    const rows = [...host.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["Room 301", "2", "4 h", "44 %"],
      ["Room 302", "1", "2 h", "22 %"],
      ["No room", "1", "2 h", "22 %"],
    ]);
  });

  it("says a failure failed — never an empty day", async () => {
    get.mockRejectedValue(new Error("down"));
    await renderView();
    expect(host.textContent).toContain("Couldn’t load the lessons of Wednesday, 18 November. This is not zero.");
    expect(host.textContent).not.toContain("No lessons");
  });
});
