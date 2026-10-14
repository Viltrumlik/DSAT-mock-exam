/**
 * /ops/finance: the overview's totals and groups, the debtor list with its filters and the
 * freeze exemption, a month's payments with refunds marked, and a failed read that must not
 * look like "nothing here".
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { DebtorsPanel, FinanceOverviewPanel, PaymentsPanel } = await import("../FinancePanels");

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

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
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

function debtor(overrides: object) {
  return {
    link_id: 1,
    lcup_student_id: 101,
    name: "Aziz Tursunov",
    user: { id: 9, name: "Aziz Tursunov", username: "aziz" },
    groups: ["Junior G21 | Math"],
    teachers: ["Vali Karimov"],
    in_group: true,
    debt: 600_000,
    last_payment_on: "2026-09-04",
    frozen: false,
    exempt: false,
    ...overrides,
  };
}

describe("finance overview", () => {
  it("shows the totals, the freeze, the methods and a group row", async () => {
    await mount(<FinanceOverviewPanel month="2026-10" />, { "/lcup/finance/summary/": SUMMARY });
    expect(get).toHaveBeenCalledWith("/lcup/finance/summary/", { params: { month: "2026-10" } });
    const text = host.textContent ?? "";
    expect(text).toContain("Debt freeze: on — from day 6 of each month");
    expect(text).toContain("Total debt");
    expect(text).toContain("2,500,000 UZS");
    expect(text).toContain("4,200,000 UZS");
    expect(text).toContain("300,000 UZS");
    expect(text).toContain("Cash");
    expect(text).toContain("Card");
    const row = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Junior G21 | Math"));
    expect(row?.textContent).toContain("Vali Karimov");
    expect(row?.textContent).toContain("600,000 UZS");
    expect(row?.textContent).toContain("3,900,000 UZS");
  });

  it("says when the freeze is off", async () => {
    await mount(<FinanceOverviewPanel month="2026-10" />, {
      "/lcup/finance/summary/": { ...SUMMARY, freeze: { enabled: false, day: 6 } },
    });
    expect(host.textContent).toContain("Debt freeze: off");
  });
});

describe("debtors", () => {
  const DEBTORS = [
    debtor({ link_id: 1, name: "Aziz Tursunov", debt: 900_000 }),
    debtor({
      link_id: 2,
      lcup_student_id: 102,
      name: "Malika Saidova",
      user: null,
      groups: [],
      teachers: [],
      in_group: false,
      debt: 400_000,
      last_payment_on: null,
    }),
  ];

  it("hides a student not in a group until the filter is turned off", async () => {
    await mount(<DebtorsPanel />, { "/lcup/finance/debtors/": DEBTORS });
    expect(host.textContent).toContain("Aziz Tursunov");
    expect(host.textContent).not.toContain("Malika Saidova");
    expect(host.textContent).toContain("1 student · 900,000 UZS owed");

    const only = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(only?.checked).toBe(true);
    await click(only!);

    expect(host.textContent).toContain("Malika Saidova");
    expect(host.textContent).toContain("Not in a group");
    expect(host.textContent).toContain("No account");
    expect(host.textContent).toContain("2 students · 1,300,000 UZS owed");
  });

  it("asks first, then exempts the student from the freeze", async () => {
    post.mockResolvedValue({ data: { link_id: 7, exempt: true } });
    await mount(<DebtorsPanel />, {
      "/lcup/finance/debtors/": [debtor({ link_id: 7, name: "Bobur Aliev", frozen: true })],
    });
    expect(host.textContent).toContain("Frozen");

    await click(button("Exempt from freeze"));
    expect(post).not.toHaveBeenCalled();
    expect(host.textContent).toContain("They are frozen now and will be unfrozen right away.");

    await click(button("Yes, exempt"));
    expect(post).toHaveBeenCalledWith("/lcup/finance/exempt/7/", { exempt: true });
  });

  it("removes an exemption", async () => {
    post.mockResolvedValue({ data: { link_id: 3, exempt: false } });
    await mount(<DebtorsPanel />, {
      "/lcup/finance/debtors/": [debtor({ link_id: 3, exempt: true })],
    });
    expect(host.textContent).toContain("Exempt");
    await click(button("Remove exemption"));
    expect(post).toHaveBeenCalledWith("/lcup/finance/exempt/3/", { exempt: false });
  });

  it("shows an error, not the empty state, when the list does not load", async () => {
    await mount(<DebtorsPanel />, { "/lcup/finance/debtors/": new Error("boom") });
    expect(host.textContent).toContain("This did not load");
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).not.toContain("Nobody owes money right now");
  });

  it("is calm when nobody owes anything", async () => {
    await mount(<DebtorsPanel />, { "/lcup/finance/debtors/": [] });
    expect(host.textContent).toContain("Nobody owes money right now");
    expect(host.textContent).not.toContain("This did not load");
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
    expect(refund?.textContent).toContain("-150,000 UZS");
    expect(refund?.textContent).toContain("Bank transfer");

    const unknownMethod = [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Bobur Aliev"));
    expect(unknownMethod?.textContent).toContain("Payme");

    const text = host.textContent ?? "";
    expect(text).toContain("Payments 650,000 UZS");
    expect(text).toContain("Refunds -150,000 UZS");
    expect(text).toContain("Net 500,000 UZS");
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
