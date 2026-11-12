/**
 * /ops — Today (design handoff v0.3, AdminToday board). A desk admin sees what needs them, where
 * the debt sits and the learners; a teacher sees only what their role may read; a failed source
 * says so and is never shown as zero.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
let me: Record<string, unknown> = {};
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));

const { TodayPage, todayHeading } = await import("../TodayPage");

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
  it("opens on what needs a desk admin now, most urgent first", async () => {
    me = { id: 4, role: "admin", permissions: [], first_name: "Dilnoza" };
    await render();
    const text = host.textContent ?? "";
    expect(text).toMatch(/Good (morning|afternoon|evening), Dilnoza/);
    expect(text).toContain("6 things need you");
    const order = ["Junior J6 · Math attendance not marked", "22 SMS did not arrive today", "13 students owe 9 450 000 so'm", "16 trial students to call back", "3 lc-up groups to pair", "1 class has no teacher"];
    const at = order.map((t) => text.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain("Senior S4 · English");
    expect(text).toContain("Lessons today");
    expect(text).toContain("8 / 8 marked");
    expect(host.querySelector('a[href="/ops/classrooms/6?tab=attendance"]')).not.toBeNull();
    expect(text).not.toContain("Paid group");
    expect(text).toContain("47");
  });

  it("says a failed source failed — never zero — and keeps the rest", async () => {
    me = { id: 4, role: "admin", permissions: [], first_name: "Dilnoza" };
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

  it("asks a teacher only for what a teacher may read", async () => {
    me = { id: 9, role: "teacher", permissions: [], first_name: "Kamola" };
    await render();
    const asked = get.mock.calls.map(([url]) => url);
    expect(asked).toEqual(["/users/admin/population/"]);
    expect(host.textContent).not.toContain("Needs you");
    expect(host.textContent).toContain("Shortcuts");
  });

  it("greets by the learning center's clock", () => {
    expect(todayHeading(new Date("2026-11-11T03:30:00Z")).greeting).toBe("Good morning"); // 08:30 in Tashkent
    expect(todayHeading(new Date("2026-11-11T10:00:00Z")).greeting).toBe("Good afternoon"); // 15:00
    expect(todayHeading(new Date("2026-11-11T14:00:00Z"))).toEqual({ greeting: "Good evening", date: "Wednesday, 11 November" });
  });
});
