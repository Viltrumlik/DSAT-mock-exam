/**
 * /ops/finance › Reports (owner 22 Nov 2026: reports leave lc-up too): a period's money in and out, the net, what the
 * lessons earned, the students each day, and the debt as the period ended.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { ReportsPanel, periodBounds } = await import("../ReportsPanel");

const REPORT = {
  from: "2026-12-01",
  to: "2026-12-31",
  money_in: {
    paid: 660000,
    refunded: -50000,
    payments: 2,
    by_method: [
      { method: "Naqd pul", total: 500000 },
      { method: "Plastik karta", total: 160000 },
    ],
  },
  money_out: { total: 4000000, count: 1, by_category: [{ name: "Rent", total: 4000000, count: 1 }] },
  net: -3390000,
  ledger_opened: "2026-11-04",
  earned: { lessons: 38500, first_months: 500000, monthly: 500000, other: 0, given_back: 115500, total: 923000, adjustments: 10000 },
  students: {
    active_per_day: [
      { day: "2026-12-01", count: 3 },
      { day: "2026-12-02", count: 4 },
    ],
    active_at_end: 4,
    new: 1,
    left: 1,
    froze: 1,
    frozen_for_debt_now: 2,
  },
  debt: { as_of: "2026-12-10", debtors: 1, total: 200000 },
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  get.mockResolvedValue({ data: REPORT });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function flush() {
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ReportsPanel />
      </QueryClientProvider>,
    );
  });
  await flush();
}

describe("periodBounds", () => {
  it("today, a Monday-to-Sunday week and the whole month", () => {
    const wednesday = new Date(2026, 11, 9);
    expect(periodBounds("today", wednesday)).toEqual({ from: "2026-12-09", to: "2026-12-09" });
    expect(periodBounds("week", wednesday)).toEqual({ from: "2026-12-07", to: "2026-12-13" });
    expect(periodBounds("week", new Date(2026, 11, 13))).toEqual({ from: "2026-12-07", to: "2026-12-13" }); // a Sunday
    expect(periodBounds("month", wednesday)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("ReportsPanel", () => {
  it("opens on this month and shows the money, what was earned and the students", async () => {
    await mount();
    const params = get.mock.calls[0][1].params;
    expect(get.mock.calls[0][0]).toBe("/billing/report/");
    expect(params.from.endsWith("-01")).toBe(true);
    const text = host.textContent ?? "";
    expect(text).toContain("Money in");
    expect(text).toContain("660 000");
    expect(text).toContain("−3 390 000"); // the net, below zero
    expect(text).toContain("Money out by category");
    expect(text).toContain("Rent");
    expect(text).toContain("923 000");
    expect(text).toContain("Adjustments in this period, not counted above");
    expect(text).toContain("Students in a paid seat, each day");
    expect(text).toContain("1 student owes");
  });

  it("asks again for today when the period changes", async () => {
    await mount();
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Today")!.click();
    });
    await flush();
    const last = get.mock.calls.at(-1)![1].params;
    expect(last.from).toBe(last.to);
  });

  it("before the ledger opened there is no debt figure, and it says why", async () => {
    get.mockResolvedValue({ data: { ...REPORT, from: "2026-10-01", to: "2026-10-31", debt: { as_of: "2026-10-31", debtors: null, total: null } } });
    await mount();
    expect(host.textContent).toContain("before the ledger opened");
    expect(host.textContent).toContain("This period starts before the ledger opened on");
  });

  it("a failed report says so", async () => {
    get.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500, data: {} } }));
    await mount();
    expect(host.textContent).toContain("The report did not load.");
  });
});
