/**
 * /ops/finance: the overview's totals and groups, a month's payments with refunds marked, and a failed read that
 * must not look like "nothing here". Amounts are signed numbers only — "−150 000", "3 000" — with "so’m" in the
 * column's head (owner, 22 Nov 2026). The Debtors tab has its own file (DebtorsPanel.test.tsx).
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The console reads permissions (plan 2026-11-12-crm-roles): an administrator's.
vi.mock("@/hooks/useMe", async (importOriginal) => {
  const { ADMIN_ME: me } = await import("@/features/ops/testing/me");
  return { ...(await importOriginal<typeof import("@/hooks/useMe")>()), useMe: () => ({ me }) };
});

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { FinanceOverviewPanel, PaymentsPanel, debtFinding, methodFinding } = await import("../FinancePanels");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
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

async function mount(ui: ReactElement, routes: Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    if (!(url in routes)) throw new Error(`unexpected GET ${url}`);
    const body = routes[url];
    if (body instanceof Error) throw body;
    return { data: body };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  for (let tick = 0; tick < 50 && get.mock.calls.length === 0; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await flush();
}

const SUMMARY = {
  month: "2026-10",
  total_debt: 2_500_000,
  debtors: 3,
  frozen: 1,
  exempt: 1,
  paid: 4_200_000,
  refunded: 300_000,
  other: 0,
  by_method: { "Naqd pul": 1_200_000, "Plastik karta": 3_000_000 },
  by_group: [
    {
      group: "Junior G21 | Math",
      teachers: ["Vali Karimov"],
      monthly_cost: 600_000,
      students: 12,
      debtors: 2,
      debt: 1_200_000,
      income: 3_900_000,
    },
  ],
  freeze: { enabled: true, day: 6 },
};

describe("finance overview", () => {
  it("shows the totals, the freeze, the methods and a group row", async () => {
    await mount(<FinanceOverviewPanel month="2026-10" />, { "/lcup/finance/summary/": SUMMARY });
    expect(get).toHaveBeenCalledWith("/lcup/finance/summary/", { params: { month: "2026-10" } });
    const text = host.textContent ?? "";
    expect(text).toContain("Debt freeze: on — from day 6 of each month");
    expect(text).toContain("Owed in total");
    expect(text).toMatch(/2 500 000\s*so’m/); // a tile: the number, its unit beside it
    expect(text).toMatch(/4 200 000\s*so’m/);
    expect(text).toMatch(/300 000\s*so’m/);
    // A total is not a balance: no "Paid" word beside it.
    expect(text).not.toContain("Paid in");
    expect(text).toContain("Cash");
    expect(text).toContain("Card");
    const row = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Junior G21 | Math"));
    expect(row?.textContent).toContain("Vali Karimov");
    expect(row?.textContent).toContain("600 000");
    expect(row?.textContent).toContain("3 900 000");
    // What its debtors owe is their balance: below zero, tinted as a verdict.
    const owed = [...(row?.querySelectorAll("td") ?? [])].find((td) => td.textContent === "−1 200 000");
    expect(owed?.getAttribute("data-verdict")).toBe("critical");
  });

  it("says when the freeze is off", async () => {
    await mount(<FinanceOverviewPanel month="2026-10" />, {
      "/lcup/finance/summary/": { ...SUMMARY, freeze: { enabled: false, day: 6 } },
    });
    expect(host.textContent).toContain("Debt freeze: off");
  });
});

describe("the overview's findings", () => {
  it("names the group that owes the most, and the method most money came by", () => {
    expect(debtFinding([{ label: "G1", value: 300_000 }, { label: "G2", value: 900_000 }, { label: "G3", value: 0 }])).toBe(
      "G2 is owed the most: 900 000 so’m, 75% of the whole.",
    );
    expect(debtFinding([{ label: "G1", value: 300_000 }])).toBe("Only G1 is owed: 300 000 so’m.");
    expect(debtFinding([{ label: "G1", value: 0 }])).toBe("No group is owed anything.");
    expect(methodFinding([{ label: "Cash", value: 600 }, { label: "Card", value: 200 }])).toBe("Cash brought 75% of the month's payments.");
    expect(methodFinding([])).toBe("");
  });
});

describe("payments", () => {
  const PAYMENTS = [
    { id: 1, date: "2026-10-03", amount: 600_000, kind: "payment", method: "Naqd pul", month: "2026-10", group: "Junior G21 | Math", student: "Aziz Tursunov", user_id: 9 },
    { id: 2, date: "2026-10-10", amount: 150_000, kind: "refund", method: "Bank hisobi", month: "2026-10", group: "Junior G21 | Math", student: "Malika Saidova", user_id: null },
    { id: 3, date: "2026-10-11", amount: 50_000, kind: "payment", method: "Payme", month: "2026-10", group: "", student: "Bobur Aliev", user_id: null },
  ];

  it("marks a refund as a refund and below zero, and totals the month", async () => {
    await mount(<PaymentsPanel month="2026-10" />, { "/lcup/finance/payments/": PAYMENTS });
    expect(get).toHaveBeenCalledWith("/lcup/finance/payments/", { params: { month: "2026-10" } });

    const refund = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Malika Saidova"));
    expect(refund?.textContent).toContain("Refund");
    expect(refund?.textContent).toContain("−150 000");
    expect(refund?.textContent).toContain("Bank transfer");

    const unknownMethod = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Bobur Aliev"));
    expect(unknownMethod?.textContent).toContain("Payme");

    const text = host.textContent ?? "";
    expect(text).toContain("Payments 650 000");
    expect(text).toContain("Refunds −150 000");
    expect(text).toContain("Net 500 000");
  });

  it("shows an error, not the empty state, when the month does not load", async () => {
    await mount(<PaymentsPanel month="2026-10" />, { "/lcup/finance/payments/": new Error("boom") });
    expect(host.textContent).toContain("This did not load");
    expect(host.textContent).not.toContain("No payments in");
  });

  it("is calm when a month has no payments", async () => {
    await mount(<PaymentsPanel month="2026-09" />, { "/lcup/finance/payments/": [] });
    expect(host.textContent).toContain("No payments in September 2026");
  });
});
