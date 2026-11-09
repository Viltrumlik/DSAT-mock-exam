/**
 * The Ledger tab of /ops/finance: whether the ledger is open, how it compares with lc-up, who differs,
 * one person's rows with the voided ones visible, and a failed read that must not look like "all matches".
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { LedgerPanel } = await import("../LedgerPanel");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function flush() {
  for (let tick = 0; tick < 6; tick++) {
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
  await flush();
}

async function click(label: string) {
  const target = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!target) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => target.click());
  await flush();
}

const SUMMARY = {
  enabled: true,
  opened_at: "2026-11-20T10:00:00+05:00",
  last_tick_at: "2026-11-21T09:05:00+05:00",
  accounts: 502,
  former: 290,
  comparison: {
    day: "2026-11-20",
    ok: true,
    counts: { matched: 498, small: 1, big: 2, unknown: 1, missing: 0 },
    rows: [
      { account_id: 3, name: "Big Difference", ours: -500000, lcup: -400000, diff: -100000 },
      { account_id: 4, name: "Small Difference", ours: -500000, lcup: -499000, diff: -1000 },
      { account_id: null, name: "Not In The Ledger", ours: 0, lcup: -50000, diff: 50000 },
    ],
    alerts: [],
  },
  problems: [],
};

const ACCOUNT = {
  id: 3,
  name: "Big Difference",
  phone: "998901112233",
  balance: -300000,
  seats: [{ id: 1, group_name: "Junior G1", state: "active", price: 500000 }],
  rows: [
    { id: 1, day: "2026-11-20", kind: "opening", label: "Opening balance", amount: -500000, running: -500000, month: "", method: "", note: "", by: "", voided_at: null, void_reason: "" },
    { id: 2, day: "2026-11-21", kind: "payment", label: "Payment", amount: 900000, running: -500000, month: "", method: "Naqd pul", note: "", by: "", voided_at: "2026-11-21T12:00:00+05:00", void_reason: "lc-up changed this payment" },
    { id: 3, day: "2026-11-21", kind: "payment", label: "Payment", amount: 200000, running: -300000, month: "", method: "Naqd pul", note: "", by: "", voided_at: null, void_reason: "" },
  ],
};

const ACCOUNTS = {
  accounts: [
    { id: 3, name: "Most Owed", phone: "998901112233", balance: -900000, former: false },
    { id: 4, name: "Nothing Owed", phone: "998904445566", balance: 0, former: false },
  ],
};

describe("LedgerPanel", () => {
  it("says the ledger is not open yet rather than showing empty figures", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": { ...SUMMARY, opened_at: null, comparison: null, accounts: 0, former: 0 } });
    expect(document.body.textContent).toContain("The ledger is not open yet");
    expect(document.querySelector("table")).toBeNull();
  });

  it("shows how the ledger compares with lc-up", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY });
    const figures = document.body.textContent ?? "";
    expect(figures).toContain("Accounts502");
    expect(figures).toContain("Former students290");
    expect(figures).toContain("Matched498");
    expect(figures).toContain("Small differences1");
    expect(figures).toContain("Big differences2");
    expect(figures).toContain("lc-up balance unknown1");
    expect(figures).toContain("20 Nov 2026");
  });

  it("lists each difference with both balances", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY });
    const row = [...document.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Big Difference"));
    expect(row?.textContent).toContain("-500,000 UZS");
    expect(row?.textContent).toContain("-400,000 UZS");
    expect(row?.textContent).toContain("-100,000 UZS");
  });

  it("does not offer an account for someone the ledger does not know", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY });
    const row = [...document.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Not In The Ledger"));
    expect(row?.querySelector("button")).toBeNull();
    expect(row?.textContent).toContain("Not in the ledger");
  });

  it("says plainly when every balance matches", async () => {
    const clean = { ...SUMMARY, comparison: { ...SUMMARY.comparison, counts: { matched: 500, small: 0, big: 0, unknown: 0, missing: 0 }, rows: [] } };
    await mount(<LedgerPanel />, { "/billing/summary/": clean });
    expect(document.body.textContent).toContain("Every balance matches lc-up");
  });

  it("says when nothing has been compared yet", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": { ...SUMMARY, comparison: null } });
    expect(document.body.textContent).toContain("No comparison yet");
    expect(document.body.textContent).not.toContain("Every balance matches");
  });

  it("does not call a comparison that could not run a match", async () => {
    const failed = { ...SUMMARY, comparison: { day: "2026-11-20", ok: false, counts: {}, rows: [], alerts: ["The last lc-up sync failed or is too old, so nothing was compared."] } };
    await mount(<LedgerPanel />, { "/billing/summary/": failed });
    expect(document.body.textContent).toContain("nothing was compared");
    expect(document.body.textContent).not.toContain("Every balance matches");
  });

  it("says when following lc-up is switched off", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": { ...SUMMARY, enabled: false } });
    expect(document.body.textContent).toContain("Following lc-up is switched off");
  });

  it("shows what went wrong recently", async () => {
    const problems = [{ at: "2026-11-21T09:05:00+05:00", kind: "tick", errors: ["membership 1: boom"], alerts: ["45 seats ended at once"] }];
    await mount(<LedgerPanel />, { "/billing/summary/": { ...SUMMARY, problems } });
    expect(document.body.textContent).toContain("membership 1: boom");
    expect(document.body.textContent).toContain("45 seats ended at once");
  });

  it("shows an error with a retry, not an empty page, when the summary fails", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": new Error("Network Error") });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This did not load");
    await act(async () => {
      get.mockResolvedValue({ data: SUMMARY });
    });
    await click("Retry");
    expect(document.body.textContent).toContain("Accounts502");
  });

  it("opens one person's rows, with the balance after each", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/3/": ACCOUNT });
    await click("Big Difference");
    expect(document.body.textContent).toContain("Junior G1");
    const rows = [...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    expect(rows[0]).toContain("Opening balance");
    expect(rows[2]).toContain("200,000 UZS");
    expect(rows[2]).toContain("-300,000 UZS");
  });

  it("keeps a voided row visible with its reason", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/3/": ACCOUNT });
    await click("Big Difference");
    const voided = [...document.querySelectorAll("tbody tr")][1];
    expect(voided.textContent).toContain("Voided: lc-up changed this payment");
    expect(voided.querySelector(".line-through")?.textContent).toContain("900,000 UZS");
  });

  it("goes back from a person to the list", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/3/": ACCOUNT });
    await click("Big Difference");
    await click("Back to the ledger");
    expect(document.body.textContent).toContain("Accounts502");
  });

  it("shows an error when a person's rows fail to load", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/3/": new Error("Network Error") });
    await click("Big Difference");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This did not load");
  });

  it("lists current students, most owed first as the server sends them", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/": ACCOUNTS });
    await click("Current students");
    expect(get).toHaveBeenCalledWith("/billing/accounts/", { params: { scope: "current" } });
    const names = [...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    expect(names[0]).toContain("Most Owed");
    expect(names[0]).toContain("-900,000 UZS");
  });

  it("asks for former students apart", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/": ACCOUNTS });
    await click("Former students");
    expect(get).toHaveBeenCalledWith("/billing/accounts/", { params: { scope: "former" } });
  });

  it("finds a student by name or phone", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/": ACCOUNTS });
    await click("Current students");
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "4445");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const names = [...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    expect(names).toHaveLength(1);
    expect(names[0]).toContain("Nothing Owed");
  });

  it("shows an error, not an empty list, when the students fail to load", async () => {
    await mount(<LedgerPanel />, { "/billing/summary/": SUMMARY, "/billing/accounts/": new Error("Network Error") });
    await click("Former students");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This did not load");
    expect(document.body.textContent).not.toContain("Nobody here");
  });
});

/**
 * A problem's time is the school's. The server writes it in UTC, so the panel used to slice the
 * UTC date off the string and print the device's hour beside it: on a laptop in Europe/Kyiv a
 * 01:30 tick in Tashkent read "9 Nov 2026, 22:30".
 */
describe("LedgerPanel on a device outside Tashkent", () => {
  /** 16:00 on the 9th in Tashkent — 13:00 on the device. */
  const FOUR_PM = "2026-11-09T16:00:00+05:00";

  let savedTz: string | undefined;

  beforeAll(() => {
    savedTz = process.env.TZ;
    process.env.TZ = "Europe/Kyiv";
  });

  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("dates a recent problem by the school's day and hour", async () => {
    // 20:30 UTC on the 9th is 01:30 on the 10th in Tashkent — and 22:30 on the 9th in Kyiv.
    const problems = [
      { at: FOUR_PM, kind: "tick", errors: ["first"], alerts: [] },
      { at: "2026-11-09T20:30:00+00:00", kind: "tick", errors: ["second"], alerts: [] },
    ];
    await mount(<LedgerPanel />, { "/billing/summary/": { ...SUMMARY, problems } });
    expect(document.body.textContent).toContain("9 Nov 2026, 16:00");
    expect(document.body.textContent).toContain("10 Nov 2026, 01:30");
  });
});
