import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import { costRows, deliveryRows } from "../charts/rows";
import { parseRange, rangeDates, serializeRange } from "../RangePicker";
import type { SmsMessagePage } from "../smsApi";
import { message } from "./fixtures";

/** The Overview's parts: the range, the balance banner, and the list of what did not arrive. */

const messages = vi.fn();
const resend = vi.fn();
const toast = vi.fn();

vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsMessages: (params: unknown) => messages(params),
  useResendMessages: () => ({ mutate: resend, isPending: false }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  useToast: () => toast,
}));

const { BalanceBanner } = await import("@/features/ops/sms/BalanceBanner");
const { UndeliveredList } = await import("@/features/ops/sms/UndeliveredList");

describe("chart rows", () => {
  const day = (d: string, delivered: number, undelivered = 0, rejected = 0) => ({
    day: d, sent: delivered + undelivered, delivered, undelivered, rejected, failed: 0, pending: 0,
    rate: delivered + undelivered + rejected ? delivered / (delivered + undelivered + rejected) : null, cost: 0,
  });

  it("draws the delivered % only for days with enough SMS to mean something", () => {
    const rows = deliveryRows([day("2026-11-01", 180, 9, 1), day("2026-11-02", 1, 1), day("2026-11-03", 0)]);
    expect(rows.map((r) => r.percent)).toEqual([95, null, null]);
    expect(rows[0].label).toBe("1 Nov");
  });

  it("counts the cost in thousands of so'm, months by name", () => {
    expect(costRows([{ month: "2026-11", debt_warning: 32300, campaign: 0, automation: 0, test: 510, total: 32810 }])).toEqual([
      { month: "Nov 2026", debt_warning: 32.3, campaign: 0, automation: 0, test: 0.5, total: 32.8 },
    ]);
  });
});

describe("the range", () => {
  it("reads and writes the address form", () => {
    expect(parseRange(null)).toBe("30d");
    expect(parseRange("junk")).toBe("30d");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("2026-10-01_2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(serializeRange({ from: "2026-10-01", to: "2026-10-31" })).toBe("2026-10-01_2026-10-31");
    expect(serializeRange("month")).toBe("month");
  });

  it("turns a range into Tashkent days, inclusive", () => {
    expect(rangeDates("7d", "2026-11-03")).toEqual({ from: "2026-10-28", to: "2026-11-03" });
    expect(rangeDates("30d", "2026-11-03")).toEqual({ from: "2026-10-05", to: "2026-11-03" });
    expect(rangeDates("month", "2026-11-03")).toEqual({ from: "2026-11-01", to: "2026-11-03" });
    expect(rangeDates({ from: "2026-10-01", to: "2026-10-31" }, "2026-11-03")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const text = () => document.body.textContent ?? "";

async function render(node: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => r.render(node));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resend.mockReset();
  toast.mockReset();
  messages.mockReset();
});

afterEach(async () => {
  const r = root;
  if (r) await act(async () => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("BalanceBanner", () => {
  const forecast = { debt: 2040, campaigns: 340, automations: 0, total: 2380, balance: 50, short: true };

  it("says what the next 24 hours need when the balance is short", async () => {
    await render(<BalanceBanner forecast={forecast} />);
    expect(text()).toContain(
      `Balance ${money(50)} does not cover the next 24 hours (~${money(2380)}): debt warnings ${money(2040)}, campaigns ${money(340)}, automations ${money(0)}.`,
    );
  });

  it("says nothing while the balance covers it", async () => {
    await render(<BalanceBanner forecast={{ ...forecast, short: false }} />);
    expect(text()).toBe("");
  });
});

describe("UndeliveredList", () => {
  const page = (results = [
    message({ id: 11, status: "UNDELIVERED", eskiz_status: "REJECTED", parts: 1, user: { id: 5, name: "Malika Karimova" }, can_resend: true }),
    message({ id: 12, status: "FAILED", parts: 2, user: { id: 6, name: "Aziz Valiyev" }, operator: "Uzmobile", can_resend: true }),
  ]): SmsMessagePage => ({ count: results.length, page: 1, pages: 1, page_size: 50, results, filters: [] });

  it("asks the journal for what may be resent, in its range", async () => {
    messages.mockReturnValue({ data: page(), isPending: false, isError: false, refetch: vi.fn() });
    await render(<UndeliveredList filter={{ from: "2026-10-03", to: "2026-11-01" }} pricePerPart={170} />);
    const params = messages.mock.calls[0][0] as { filters: Record<string, string> };
    expect(params.filters).toEqual({ resendable: "1", from: "2026-10-03", to: "2026-11-01" });
    expect(text()).toContain("Malika Karimova");
    expect(text()).toContain("Operator rejected");
    expect(text()).toContain("eskiz not reached");
  });

  it("confirms the count and the price, then resends once", async () => {
    messages.mockReturnValue({ data: page(), isPending: false, isError: false, refetch: vi.fn() });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render(<UndeliveredList filter={{}} pricePerPart={170} />);
    const all = document.querySelector<HTMLInputElement>("input[aria-label='Select all']")!;
    await act(async () => all.click());
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Resend 2")!;
    await act(async () => button.click());
    expect(confirm).toHaveBeenCalledWith(`Resend 2 SMS, ~${money(510)}?`);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend.mock.calls[0][0]).toEqual([11, 12]);
    confirm.mockRestore();
  });

  it("sends nothing when the confirm is declined", async () => {
    messages.mockReturnValue({ data: page(), isPending: false, isError: false, refetch: vi.fn() });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render(<UndeliveredList filter={{}} pricePerPart={170} />);
    const one = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Resend")!;
    await act(async () => one.click());
    expect(resend).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("names each SMS's source, and offers no Resend for one that may not go again now", async () => {
    const stale = message({
      id: 13, status: "UNDELIVERED", eskiz_status: "REJECTED", user: { id: 7, name: "Bekzod Rahimov" }, can_resend: false,
      kind: "debt_warning", source: { type: "debt_warning", id: null, label: "Debt warning" },
    });
    messages.mockReturnValue({ data: page([stale]), isPending: false, isError: false, refetch: vi.fn() });
    await render(<UndeliveredList filter={{}} pricePerPart={170} />);
    expect(text()).toContain("Debt warning");
    expect(text()).toContain("Only on its day");
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Resend")).toBe(false);
    expect(document.querySelector<HTMLInputElement>("input[aria-label='Select Bekzod Rahimov']")?.disabled).toBe(true);
  });

  it("says when everything arrived", async () => {
    messages.mockReturnValue({ data: page([]), isPending: false, isError: false, refetch: vi.fn() });
    await render(<UndeliveredList filter={{}} pricePerPart={170} />);
    expect(text()).toContain("Everything in this range arrived.");
  });

  it("says when the list did not load, not that everything arrived", async () => {
    messages.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render(<UndeliveredList filter={{}} pricePerPart={170} />);
    expect(text()).not.toContain("Everything in this range arrived.");
    expect(text()).toContain("didn't load");
  });
});
