/**
 * /ops — Today (lc-up structure canvas, Shell board). A desk admin sees a plain dated title, the day's four
 * numbers, the daily lists, what needs them and the lessons on now, then every card the page had; "Lessons
 * today" opens the timetable in a dialog. A teacher sees only what their role may read; money only for
 * view_money; a failed source says so and is never shown as zero.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ME, TEACHER_ME } from "@/features/ops/testing/me";

const get = vi.fn();
let me: Record<string, unknown> = {};
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));

const { TodayPage, todayDate } = await import("../TodayPage");

const LESSON = (id: number, name: string, phase: string, register: Record<string, unknown>, teacher: { id: number; name: string } | null = { id: 1, name: "Muxlisa" }) => ({
  classroom: { id, name, room: "3" },
  teacher,
  starts_at: "2026-11-11T10:00:00+05:00",
  ends_at: "2026-11-11T11:30:00+05:00",
  phase,
  register: { roster: 8, marked: 0, present: 0, late: 0, absent: 0, excused: 0, taken: false, state: "open", closes_at: null, ...register },
});
const DATA: Record<string, unknown> = {
  "/classes/admin/lessons/today/": {
    date: "2026-11-11",
    lessons: [
      LESSON(6, "Junior J6 · Math", "ended", {}),
      LESSON(3, "Foundation F3 · Math", "ended", { marked: 8, present: 8, taken: true, state: "closed" }),
    ],
    counts: { lessons: 2, now: 0, not_marked: 1, no_teacher: 0 },
  },
  "/sms/admin/overview/": { today: { total: 30, by_status: { UNDELIVERED: 22 } }, eskiz: { last_error: "" }, forecast: { short: false, total: 0 }, balance: 182400 },
  "/lcup/followups/": { pending: 16, trials: [], not_on_list: [] },
  "/lcup/finance/summary/": {
    debtors: 13,
    total_debt: 9450000,
    frozen: 3,
    exempt: 1,
    by_group: [
      { group: "Senior S4 · English", debt: 2400000 },
      { group: "Middle M5 · Math", debt: 2050000 },
      { group: "Paid group", debt: 0 },
    ],
  },
  "/lcup/status/": { counts: { groups_pending: 3 } },
  "/classes/admin/classrooms/": { count: 14, filters: [{ key: "teacher", options: [{ value: "1", label: "A", count: 13 }] }] },
  "/users/admin/population/": { centre: 47, public: 13, frozen_debt: 3, frozen_admin: 0, signups_7d: 2 },
  "/lcup/finance/debtors/": [
    { link_id: 1, lcup_student_id: 11, name: "A", user: null, groups: ["Junior J6 · Math"], teachers: [], in_group: true, debt: 1200000, last_payment_on: null, frozen: true, exempt: false },
    { link_id: 2, lcup_student_id: 12, name: "B", user: null, groups: [], teachers: [], in_group: false, debt: 800000, last_payment_on: null, frozen: false, exempt: false },
  ],
};

let host: HTMLDivElement;
let root: Root;
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TodayPage />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (!(url in DATA)) throw new Error(`unexpected ${url}`);
    return { data: DATA[url] };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TodayPage", () => {
  it("opens on a plain dated title, the day's numbers, the daily lists and what needs a desk admin now", async () => {
    me = { id: 4, role: "admin", permissions: ADMIN_ME.permissions, first_name: "Dilnoza" };
    await render();
    const text = host.textContent ?? "";
    expect(host.querySelector("h1")?.textContent).toBe(`Today · ${todayDate()}`);
    expect(text).not.toMatch(/Good (morning|afternoon|evening)/);
    expect(host.querySelector("[data-needs-count]")?.textContent).toBe("6");
    const order = ["Junior J6 · Math attendance not marked", "22 SMS did not arrive today", "13 students owe 9 450 000 so'm", "16 trial students to call back", "3 lc-up groups to pair", "1 class has no teacher"];
    const at = order.map((t) => text.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    // The header: Lessons today with its count, and Mark attendance to the register still waiting.
    expect(host.querySelector("[data-lessons-count]")?.textContent).toBe("2");
    expect([...host.querySelectorAll("a")].find((a) => a.textContent === "Mark attendance")?.getAttribute("href")).toBe("/ops/classrooms/6?tab=attendance");

    // The four tiles.
    const tile = (label: string) => host.querySelector<HTMLElement>(`[data-stat="${label}"]`)?.textContent ?? "";
    expect(tile("Came today")).toContain("8of 8");
    expect(tile("Owe money")).toContain("2students");
    expect(tile("Owe money")).toContain("2 000 000 so'm in total");
    expect(tile("Lessons now")).toContain("No more lessons today");
    expect(tile("Registers not marked")).toContain("from the 10:00 lesson");
    expect(host.querySelector('[data-stat="Owe money"]')?.getAttribute("style")).toContain("--ms-critical");

    // The daily lists, each with its real count and where it goes.
    const list = (label: string) => host.querySelector<HTMLAnchorElement>(`[data-list="${label}"]`);
    expect(list("Students")?.getAttribute("href")).toBe("/ops/students");
    expect(list("Students")?.textContent).toContain("47");
    expect(list("Groups")?.textContent).toContain("14");
    expect(list("Groups")?.textContent).toContain("0 in a lesson now");
    expect(list("Debtors")?.getAttribute("href")).toBe("/ops/finance?tab=debtors");
    expect(list("Debtors")?.textContent).toContain("1 frozen · 1 not in a group");
    expect(list("Archive")?.getAttribute("href")).toBe("/ops/archive");

    // Lessons now, and every card the page had below.
    expect(text).toContain("No lesson is on right now. No more lessons today.");
    expect(host.querySelector('a[href="/ops/timetable"]')).not.toBeNull();
    expect(text).toContain("Senior S4 · English");
    expect(text).not.toContain("Paid group");
    for (const card of ["Learners", "Recently opened", "Where debt sits", "SMS", "Shortcuts"]) expect(text).toContain(card);
  });

  it("opens the timetable of today in a dialog from Lessons today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00+05:00"));
    try {
      me = { id: 4, role: "admin", permissions: ADMIN_ME.permissions };
      await render();
      const open = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Lessons today"))!;
      await act(async () => open.click());
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.querySelector("h2")?.textContent).toBe("Lessons · Wednesday, 11 November");
      expect(dialog?.textContent).toContain("2 lessons · 1 room");
      expect(dialog?.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Today");
      expect(dialog?.querySelectorAll("a[data-lesson]")).toHaveLength(2);
      expect(dialog?.querySelector('a[data-lesson="6"]')?.getAttribute("href")).toBe("/ops/classrooms/6?tab=attendance");
      expect(dialog?.querySelector('a[data-lesson="3"]')?.textContent).toContain("Came 8 of 8");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows money only to view_money: no Owe money tile, no Debtors list, no debtors asked", async () => {
    me = { id: 7, role: "admin", permissions: ["view_people"] };
    await render();
    expect(host.querySelector('[data-stat="Owe money"]')).toBeNull();
    expect(host.querySelector('[data-list="Debtors"]')).toBeNull();
    expect(host.querySelector('[data-stat="Came today"]')).not.toBeNull();
    expect(get.mock.calls.map(([url]) => url)).not.toContain("/lcup/finance/debtors/");
  });

  it("says a failed source failed — never zero — and keeps the rest", async () => {
    me = { id: 4, role: "admin", permissions: ADMIN_ME.permissions, first_name: "Dilnoza" };
    get.mockImplementation(async (url: string) => {
      if (url === "/lcup/finance/summary/") throw new Error("lc-up timed out");
      return { data: DATA[url] };
    });
    await render();
    const text = host.textContent ?? "";
    expect(text).toContain("Couldn’t check debts.");
    expect(text).toContain("Couldn’t load debts from lc-up");
    expect(text).toContain("This is not zero.");
    expect(text).toContain("22 SMS did not arrive today");
    expect(text).not.toContain("No one owes");
  });

  it("says the debtors failed in their tile — never zero", async () => {
    me = { id: 4, role: "admin", permissions: ADMIN_ME.permissions };
    get.mockImplementation(async (url: string) => {
      if (url === "/lcup/finance/debtors/") throw new Error("down");
      return { data: DATA[url] };
    });
    await render();
    expect(host.querySelector('[data-stat="Owe money"]')?.textContent).toContain("Couldn’t load the debtors. This is not zero.");
    expect(host.querySelector('[data-list="Debtors"]')?.textContent).toContain("Couldn’t load the count");
  });

  it("asks a teacher for nothing: every card is the desk's (teachers are sent to the portal anyway)", async () => {
    me = { id: 9, role: "teacher", permissions: TEACHER_ME.permissions, first_name: "Kamola" };
    await render();
    const asked = get.mock.calls.map(([url]) => url);
    expect(asked).toEqual([]);
    expect(host.textContent).not.toContain("Needs you");
    expect(host.textContent).not.toContain("Lessons today");
    expect(host.textContent).not.toContain("Daily lists");
    expect(host.textContent).toContain("Shortcuts");
  });

  it("dates the title by the learning center's clock", () => {
    expect(todayDate(new Date("2026-11-11T14:00:00Z"))).toBe("Wednesday, 11 November");
    expect(todayDate(new Date("2026-11-21T20:30:00Z"))).toBe("Sunday, 22 November"); // 01:30 in Tashkent
  });
});
