/**
 * Entering money on a person's page in the Ledger tab: hidden while closed, a preview of the balance before
 * saving, one row however often it is clicked or retried, and voiding with a reason.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The console reads permissions (plan 2026-11-12-crm-roles): an administrator's.
const session = vi.hoisted(() => ({ me: undefined as Record<string, unknown> | undefined }));
vi.mock("@/hooks/useMe", async (importOriginal) => {
  const { ADMIN_ME } = await import("@/features/ops/testing/me");
  return { ...(await importOriginal<typeof import("@/hooks/useMe")>()), useMe: () => ({ me: session.me ?? ADMIN_ME }) };
});

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: vi.fn(), delete: vi.fn() },
}));

const { LedgerPanel } = await import("../LedgerPanel");
const { parseAmount } = await import("../LedgerEntryForm");

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
  for (let tick = 0; tick < 6; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const SUMMARY = {
  enabled: false,
  opened_at: "2026-11-20T10:00:00+05:00",
  last_tick_at: null,
  accounts: 1,
  former: 0,
  comparison: {
    day: "2026-11-20",
    ok: true,
    counts: { matched: 0, small: 0, big: 1, unknown: 0, missing: 0 },
    rows: [{ account_id: 3, name: "A Student", ours: -300000, lcup: -400000, diff: 100000 }],
    alerts: [],
  },
  problems: [],
};

const ROW = { month: "", method: "", note: "", by: "", voided_at: null, void_reason: "", voided_by: "", can_void: false };

function account(over: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: "A Student",
    phone: "998901112233",
    balance: -300000,
    payments_open: true,
    seats: [],
    rows: [
      { ...ROW, id: 1, day: "2026-11-20", kind: "opening", label: "Opening balance", amount: -500000, running: -500000 },
      { ...ROW, id: 2, day: "2026-12-02", kind: "payment", label: "Payment", amount: 200000, running: -300000, method: "Naqd pul", by: "boss", can_void: true },
    ],
    ...over,
  };
}

async function open(body = account()) {
  get.mockImplementation(async (url: string) => {
    if (url === "/billing/summary/") return { data: SUMMARY };
    if (url === "/billing/accounts/3/") return { data: body };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <LedgerPanel />
    </QueryClientProvider>
  );
  await act(async () => root.render(ui));
  await flush();
  await click("A Student");
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
}

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => target.click());
  await flush();
}

function field(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no field "${label}" in: ${document.body.textContent}`);
  return found;
}

async function type(label: string, value: string) {
  const input = field(label);
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function refusal(detail: string) {
  return Object.assign(new Error("Request failed"), { response: { status: 400, data: { detail } } });
}

describe("parseAmount", () => {
  it("reads whole so'm however it was grouped", () => {
    expect(parseAmount("500000")).toBe(500000);
    expect(parseAmount("500 000")).toBe(500000);
    expect(parseAmount("500,000")).toBe(500000);
  });

  it("refuses anything else", () => {
    for (const raw of ["", "0", "-500", "12.5", "abc", "5e5"]) expect(parseAmount(raw)).toBeNull();
  });
});

describe("entering money", () => {
  it("offers nothing while it is closed", async () => {
    await open(account({ payments_open: false }));
    expect(button("Enter a payment")).toBeUndefined();
    expect(button("Void")).toBeUndefined();
  });

  it("saves a payment with the form's own request id", async () => {
    post.mockResolvedValue({ data: { balance: 200000 } });
    await open();
    await click("Enter a payment");
    await type("Amount", "500 000");
    await type("Method", "Plastik karta");
    await type("Note", "November");
    await click("Save payment");
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/billing/accounts/3/entries/");
    expect(body).toMatchObject({ kind: "payment", amount: 500000, method: "Plastik karta", note: "November" });
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows the balance it will leave before anything is saved", async () => {
    await open();
    await click("Enter a payment");
    await type("Amount", "500000");
    expect(document.body.textContent).toContain("Balance after: 200,000 UZS");
    expect(post).not.toHaveBeenCalled();
  });

  it("shows a refund lowering the balance", async () => {
    post.mockResolvedValue({ data: { balance: -400000 } });
    await open();
    await click("Enter a refund");
    await type("Amount", "100000");
    expect(document.body.textContent).toContain("Balance after: -400,000 UZS");
    await click("Save refund");
    expect(post.mock.calls[0][1]).toMatchObject({ kind: "refund", amount: 100000 });
  });

  it("will not save without an amount", async () => {
    await open();
    await click("Enter a payment");
    expect(button("Save payment")?.disabled).toBe(true);
    await type("Amount", "12.5");
    expect(button("Save payment")?.disabled).toBe(true);
  });

  it("will not save an adjustment without a reason", async () => {
    await open();
    await click("Enter an adjustment");
    await type("Amount", "5000");
    expect(button("Save adjustment")?.disabled).toBe(true);
    await type("Reason", "lc-up discount by hand");
    expect(button("Save adjustment")?.disabled).toBe(false);
  });

  it("sends an adjustment that lowers the balance as a negative amount, with no method", async () => {
    post.mockResolvedValue({ data: { balance: -305000 } });
    await open();
    await click("Enter an adjustment");
    await type("Amount", "5000");
    await type("Direction", "-1");
    await type("Reason", "Typed wrong in October");
    expect(document.body.textContent).toContain("Balance after: -305,000 UZS");
    await click("Save adjustment");
    expect(post.mock.calls[0][1]).toMatchObject({ kind: "adjust", amount: -5000, method: "", note: "Typed wrong in October" });
  });

  it("sends one request however often it is clicked", async () => {
    let finish: (value: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await open();
    await click("Enter a payment");
    await type("Amount", "500000");
    await click("Save payment");
    expect(button("Saving…")?.disabled).toBe(true);
    await act(async () => button("Saving…")?.click());
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { balance: 200000 } }));
    await flush();
  });

  it("keeps the form and its request id when the server refuses", async () => {
    post.mockRejectedValueOnce(refusal("That day is in the future."));
    post.mockResolvedValueOnce({ data: { balance: 200000 } });
    await open();
    await click("Enter a payment");
    await type("Amount", "500000");
    await click("Save payment");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("That day is in the future.");
    expect(field("Amount").value).toBe("500000");
    await click("Save payment");
    expect(post.mock.calls[1][1].request_id).toBe(post.mock.calls[0][1].request_id);
  });

  it("closes after saving and reads the account again", async () => {
    post.mockResolvedValue({ data: { balance: 200000 } });
    await open();
    await click("Enter a payment");
    await type("Amount", "500000");
    const reads = get.mock.calls.filter(([url]) => url === "/billing/accounts/3/").length;
    await click("Save payment");
    expect(button("Save payment")).toBeUndefined();
    expect(button("Enter a payment")).toBeDefined();
    expect(get.mock.calls.filter(([url]) => url === "/billing/accounts/3/").length).toBeGreaterThan(reads);
  });

  it("gives a new form a new request id", async () => {
    post.mockResolvedValue({ data: { balance: 200000 } });
    await open();
    for (let time = 0; time < 2; time++) {
      await click("Enter a payment");
      await type("Amount", "500000");
      await click("Save payment");
    }
    expect(post.mock.calls[1][1].request_id).not.toBe(post.mock.calls[0][1].request_id);
  });

  it("can be cancelled without saving", async () => {
    await open();
    await click("Enter a payment");
    await click("Cancel");
    expect(button("Save payment")).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("a personal price", () => {
  const SEAT = { id: 7, group_name: "Junior G1", state: "active", price: 500000, personal_price: null, price_changes: [] };

  it("can be set while entering money is still closed", async () => {
    post.mockResolvedValue({ data: { balance: -400000 } });
    await open(account({ payments_open: false, seats: [SEAT] }));
    await click("Personal price");
    await type("Personal price, UZS", "400 000");
    expect(button("Save price")?.disabled).toBe(true);
    await type("Why this price?", "Agreed with the family");
    await click("Save price");
    expect(post).toHaveBeenCalledWith("/billing/seats/7/price/", { price: 400000, reason: "Agreed with the family" });
    expect(button("Save price")).toBeUndefined();
  });

  it("takes zero as a grant", async () => {
    post.mockResolvedValue({ data: { balance: 0 } });
    await open(account({ seats: [SEAT] }));
    await click("Personal price");
    await type("Personal price, UZS", "0");
    await type("Why this price?", "Grant");
    await click("Save price");
    expect(post.mock.calls[0][1]).toEqual({ price: 0, reason: "Grant" });
  });

  it("will not save without an amount", async () => {
    await open(account({ seats: [SEAT] }));
    await click("Personal price");
    await type("Why this price?", "Agreed");
    expect(button("Save price")?.disabled).toBe(true);
    await type("Personal price, UZS", "12.5");
    expect(button("Save price")?.disabled).toBe(true);
  });

  it("shows the personal price beside the group's, with who changed it and why", async () => {
    const changes = [{ at: "2026-12-03T10:00:00+05:00", old_price: null, new_price: 400000, reason: "Agreed with the family", by: "boss" }];
    await open(account({ seats: [{ ...SEAT, personal_price: 400000, price_changes: changes }] }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("400,000 UZS a month, personal (group 500,000 UZS)");
    expect(text).toContain("boss");
    expect(text).toContain("Agreed with the family");
  });

  it("says a grant is a grant", async () => {
    await open(account({ seats: [{ ...SEAT, personal_price: 0 }] }));
    expect(document.body.textContent).toContain("Grant, nothing charged (group 500,000 UZS)");
  });

  it("goes back to the group's price with a reason", async () => {
    post.mockResolvedValue({ data: { balance: -500000 } });
    await open(account({ seats: [{ ...SEAT, personal_price: 400000 }] }));
    await click("Personal price");
    expect(button("Back to the group's price")?.disabled).toBe(true);
    await type("Why this price?", "The agreement ended");
    await click("Back to the group's price");
    expect(post).toHaveBeenCalledWith("/billing/seats/7/price/", { price: null, reason: "The agreement ended" });
  });

  it("offers no way back when there is no personal price", async () => {
    await open(account({ seats: [SEAT] }));
    await click("Personal price");
    expect(button("Back to the group's price")).toBeUndefined();
  });

  it("shows why it was refused and keeps the form", async () => {
    post.mockRejectedValue(refusal("A personal price needs a reason."));
    await open(account({ seats: [SEAT] }));
    await click("Personal price");
    await type("Personal price, UZS", "400000");
    await type("Why this price?", "Agreed");
    await click("Save price");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("A personal price needs a reason.");
    expect(button("Save price")).toBeDefined();
  });
});

describe("voiding", () => {
  it("is offered only on a row entered by hand", async () => {
    await open();
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Void")).toHaveLength(1);
    const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Payment"));
    expect(row?.querySelector("button")?.textContent).toBe("Void");
  });

  it("needs a reason, then sends it", async () => {
    post.mockResolvedValue({ data: { balance: -500000 } });
    await open();
    await click("Void");
    expect(button("Void this row")?.disabled).toBe(true);
    await type("Why is this row being voided?", "Wrong student");
    await click("Void this row");
    expect(post).toHaveBeenCalledWith("/billing/entries/2/void/", { reason: "Wrong student" });
    expect(button("Void this row")).toBeUndefined();
  });

  it("shows why it was refused", async () => {
    post.mockRejectedValue(refusal("This row is already voided."));
    await open();
    await click("Void");
    await type("Why is this row being voided?", "Wrong student");
    await click("Void this row");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This row is already voided.");
  });

  it("can be cancelled", async () => {
    await open();
    await click("Void");
    await click("Keep this row");
    expect(button("Void this row")).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it("says who voided a row", async () => {
    await open(account({
      rows: [{ ...ROW, id: 2, day: "2026-12-02", kind: "payment", label: "Payment", amount: 200000, running: 0, voided_at: "2026-12-02T12:00:00+05:00", void_reason: "Wrong student", voided_by: "boss" }],
    }));
    expect(document.body.textContent).toContain("Voided by boss: Wrong student");
  });
});

describe("what the viewer's permissions open", () => {
  afterEach(() => {
    session.me = undefined;
  });

  const labels = () => [...document.querySelectorAll("button")].map((b) => b.textContent);

  it("offers an adjustment without take_payment, and no void or personal price without theirs", async () => {
    session.me = { role: "accountant", permissions: ["view_money", "adjust_balance"] };
    await open();
    expect(labels()).toContain("Enter an adjustment");
    expect(labels()).not.toContain("Enter a payment");
    expect(labels()).not.toContain("Enter a refund");
    expect(labels()).not.toContain("Void");
    expect(labels()).not.toContain("Personal price");
  });

  it("offers nothing to change to someone who only reads the money", async () => {
    session.me = { role: "accountant", permissions: ["view_money"] };
    await open();
    expect(labels().filter((l) => l?.startsWith("Enter"))).toEqual([]);
    expect(labels()).not.toContain("Void");
  });
});
