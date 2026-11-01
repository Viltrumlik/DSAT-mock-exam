import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { SmsOverview, SmsStats } from "../smsApi";

/**
 * The Overview (plan 2026-11-01-sms-v2, Task 8): four figures that count up, delivery by day and by
 * operator, the cost, what the debt warning makes people do, what did not arrive — and, from before,
 * whether eskiz answers and when the debt warning goes next.
 */

const overview = vi.fn();
const stats = vi.fn();
const replace = vi.fn();
let search = "";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ops/sms",
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsOverview: () => overview(),
  useSmsStats: (range: unknown) => stats(range),
  useSmsTemplates: () => ({ data: { templates: [], synced_at: null }, isPending: false, isError: false }),
  useSendTestSms: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/ops/sms/UndeliveredList", () => ({
  UndeliveredList: ({ filter }: { filter: Record<string, string> }) => (
    <div data-testid="undelivered">{JSON.stringify(filter)}</div>
  ),
}));
vi.mock("@/features/ops/sms/charts/DeliveryChart", () => ({
  DeliveryChart: ({ data }: { data: unknown[] }) => <div data-testid="delivery-chart">{data.length} days</div>,
}));
vi.mock("@/features/ops/sms/charts/OperatorChart", () => ({
  OperatorChart: ({ data }: { data: { operator: string }[] }) => (
    <div data-testid="operator-chart">{data.map((d) => d.operator).join(",")}</div>
  ),
}));
vi.mock("@/components/ui/charts", () => ({
  StackedBarChart: () => <div data-testid="cost-chart" />,
  LineChart: () => <div data-testid="cost-day-chart" />,
}));

const { OverviewPanel } = await import("@/features/ops/sms/OverviewPanel");

function data(over: Partial<SmsOverview> = {}): SmsOverview {
  return {
    configured: true,
    balance: 63460,
    price_per_part: 170,
    sender: "4546",
    eskiz: { token_cached: true, login_refused: false, last_error: "" },
    debt: {
      enabled: true, env_enabled: true, db_enabled: true, freeze_enabled: true, hour: 10, next_day: "2026-11-01",
      next_count: 12,
      today_sent: 0,
      today_left: 0,
    },
    today: { total: 2, by_status: { DELIVERED: 2 } },
    last7: { total: 9, by_status: { DELIVERED: 6, UNDELIVERED: 1, FAILED: 1, SENT: 1 } },
    forecast: { debt: 2040, campaigns: 0, automations: 0, total: 2040, balance: 63460, short: false },
    month: { sent: 190, rate: 0.937, cost: 32300 },
    ...over,
  };
}

function statsData(over: Partial<SmsStats> = {}): SmsStats {
  const totals = { sent: 190, delivered: 178, undelivered: 11, rejected: 1, failed: 0, pending: 0, rate: 0.937, cost: 32300 };
  return {
    from: "2026-10-03",
    to: "2026-11-01",
    totals,
    by_day: [{ day: "2026-11-01", ...totals }],
    by_operator: [
      { operator: "Beeline", total: 100, delivered: 98, rate: 0.98 },
      { operator: "Uzmobile", total: 60, delivered: 51, rate: 0.85 },
    ],
    cost_by_month: [{ month: "2026-11", debt_warning: 32300, campaign: 0, automation: 0, test: 340, total: 32640 }],
    debt_effect: [{ month: "2026-11", warned: 194, paid_1: 40, paid_3: 88, paid_5: 120, unpaid: 74 }],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

async function render(state: Record<string, unknown>, statsState: Record<string, unknown> = { data: statsData() }) {
  overview.mockReturnValue({ isPending: false, isError: false, refetch, ...state });
  stats.mockReturnValue({ isPending: false, isError: false, refetch: vi.fn(), ...statsState });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<OverviewPanel />));
}

const refetch = vi.fn();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refetch.mockReset();
  replace.mockReset();
  stats.mockReset();
  search = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("OverviewPanel: the four figures", () => {
  it("leads with the balance and what it covers, today, this month's delivery and its cost", async () => {
    await render({ data: data({ debt: { ...data().debt, today_sent: 195, today_left: 3 } }) });
    expect(text()).toContain(money(63460));
    expect(text()).toContain("≈ 373 SMS");
    expect(text()).toContain(`${money(170)} a part`);
    expect(text()).toContain("2 delivered");
    expect(text()).toContain("3 left");
    expect(text()).toContain("94%");
    expect(text()).toContain(money(32300));
  });

  it("says the balance could not be read, not zero", async () => {
    await render({ data: data({ configured: false, balance: null }) });
    expect(text()).toContain("eskiz is not configured on this server");
    expect(text()).toContain("Couldn't ask eskiz");
  });
});

describe("OverviewPanel: the charts", () => {
  it("asks for the last 30 days by default and draws them", async () => {
    await render({ data: data() });
    const range = stats.mock.calls.at(-1)?.[0] as { from: string; to: string };
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
    expect(days).toBe(30);
    expect(document.querySelector("[data-testid='delivery-chart']")?.textContent).toBe("1 days");
    expect(document.querySelector("[data-testid='operator-chart']")?.textContent).toBe("Beeline,Uzmobile");
    expect(document.querySelector("[data-testid='cost-chart']")).not.toBeNull();
  });

  it("asks for the range in the address", async () => {
    search = "tab=overview&range=7d";
    await render({ data: data() });
    const range = stats.mock.calls.at(-1)?.[0] as { from: string; to: string };
    expect((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1).toBe(7);
  });

  it("puts a new range in the address", async () => {
    await render({ data: data() });
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "90 days")!;
    await act(async () => button.click());
    expect(replace).toHaveBeenCalledWith("/ops/sms?range=90d", { scroll: false });
  });

  it("says when the range had no SMS instead of drawing an empty chart", async () => {
    await render({ data: data() }, { data: statsData({ by_day: [], by_operator: [], cost_by_month: [] }) });
    expect(text()).toContain("No SMS in this range.");
    expect(document.querySelector("[data-testid='delivery-chart']")).toBeNull();
  });

  it("offers a retry when the statistics did not load", async () => {
    await render({ data: data() }, { isError: true, data: undefined });
    expect(text()).toContain("The statistics didn't load.");
  });

  it("shows what the debt warning made people do", async () => {
    await render({ data: data() });
    expect(text()).toContain("194 warned");
    expect(text()).toContain("40");
    expect(text()).toContain("88");
    expect(text()).toContain("120");
    expect(text()).toContain("74 did not pay");
  });

  it("lists what did not arrive in the range", async () => {
    await render({ data: data() });
    const filter = JSON.parse(document.querySelector("[data-testid='undelivered']")!.textContent!);
    expect(filter.from).toBeTruthy();
    expect(filter.to).toBeTruthy();
  });
});

describe("OverviewPanel: the account, from before", () => {
  it("shows the sender and eskiz's health", async () => {
    await render({ data: data() });
    expect(text()).toContain("4546");
    expect(text()).toContain("Signed in");
  });

  it("says when and to how many the debt warning goes next", async () => {
    await render({ data: data() });
    expect(text()).toContain("Sends at 10:00");
    expect(text()).toContain("Next: 1 Nov 2026 · 12 students");
  });

  it("warns when the server's master switch keeps the debt warning off", async () => {
    await render({ data: data({ debt: { ...data().debt, enabled: false, env_enabled: false } }) });
    expect(text()).toContain("master switch is off on this server");
    expect(text()).toContain("the server's master switch is off");
  });

  it("says the warning is switched off, not that no day is ahead, while it is off", async () => {
    await render({
      data: data({ debt: { ...data().debt, enabled: false, db_enabled: false, next_day: null, next_count: 0 } }),
    });
    expect(text()).toContain("Switched off");
    expect(text()).not.toContain("No warning day ahead");
  });

  it("names a refused login and the last error", async () => {
    await render({
      data: data({ eskiz: { token_cached: false, login_refused: true, last_error: "HTTP 422: mobile_phone" } }),
    });
    expect(text()).toContain("Login refused");
    expect(text()).toContain("HTTP 422: mobile_phone");
  });

  it("shows what today's warning run did", async () => {
    await render({ data: data({ debt: { ...data().debt, today_sent: 0, today_left: 5 } }) });
    expect(text()).toContain("Today: 0 sent · 5 left");
  });

  it("offers a retry when the overview did not load, not an empty page", async () => {
    await render({ isError: true, data: undefined });
    expect(text()).toContain("The overview didn't load.");
    const retry = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("shows it is loading", async () => {
    await render({ isPending: true, data: undefined });
    expect(text()).toContain("Loading…");
  });
});
