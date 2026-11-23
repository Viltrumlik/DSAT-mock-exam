/**
 * /ops/finance › Expenses (owner 22 Nov 2026: expenses leave lc-up too): the month's expenses with their total, the
 * archive, and what only `manage_expenses` may do — add, void, keep the categories — and only after the cutover.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: vi.fn(),
  },
}));

const { ExpensesPanel } = await import("../ExpensesPanel");

const META = {
  categories: [
    { id: 1, name: "Rent", retired: false, used: 1 },
    { id: 2, name: "Salary", retired: false, used: 1 },
    { id: 3, name: "Old", retired: true, used: 0 },
  ],
  staff: [
    { id: 7, name: "Dilnoza" },
    { id: 8, name: "Owner" },
  ],
  methods: [
    { value: "Naqd pul", label: "Cash" },
    { value: "Bank hisobi", label: "Bank transfer" },
  ],
  can_manage: true,
  open: true,
  me: 7,
};

const ROW = {
  id: 11,
  day: "2026-12-05",
  amount: 4000000,
  category: { id: 1, name: "Rent" },
  method: "Bank hisobi",
  spent_by: { id: 7, name: "Dilnoza" },
  reason: "December rent",
  created_by: "Dilnoza",
  created_at: "2026-12-05T10:00:00+05:00",
  voided_at: null,
  voided_by: "",
  void_reason: "",
};

const LISTING = {
  from: "2026-12-01",
  to: "2026-12-31",
  archived: false,
  rows: [ROW, { ...ROW, id: 12, amount: 1500000, category: { id: 2, name: "Salary" }, reason: "Cleaner" }],
  count: 2,
  truncated: false,
  total: 5500000,
  by_category: [
    { id: 1, name: "Rent", total: 4000000, count: 1 },
    { id: 2, name: "Salary", total: 1500000, count: 1 },
  ],
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
  patch.mockReset();
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

async function mount(meta = META, listing: unknown = LISTING) {
  get.mockImplementation(async (url: string) => {
    if (url === "/billing/expenses/meta/") return { data: meta };
    if (url === "/billing/expenses/") return { data: listing };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ExpensesPanel />
      </QueryClientProvider>,
    );
  });
  await flush();
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);
  if (!found) throw new Error(`no button ${name}`);
  return found as HTMLButtonElement;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

async function fill(label: string, value: string) {
  const el = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("ExpensesPanel", () => {
  it("lists the month's expenses with the total and each category's share", async () => {
    await mount();
    expect(host.textContent).toContain("2 expenses");
    expect(host.textContent).toContain("Total 5 500 000 so’m");
    expect(host.textContent).toContain("Rent 4 000 000 · Salary 1 500 000");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.textContent).toContain("Bank transfer");
    const asked = get.mock.calls.find(([url]) => url === "/billing/expenses/")?.[1];
    expect(asked).toMatchObject({ params: { from: expect.any(String), to: expect.any(String) } });
  });

  it("adds one: whoever is signed in spent it unless changed, and the form keeps one request id", async () => {
    post.mockResolvedValue({ data: ROW });
    await mount();
    await click(button("Add an expense"));
    await fill("Amount", "4 000 000");
    await fill("Category", "1");
    await fill("Method", "Bank hisobi");
    await fill("What for", "December rent");
    // A retired category is not offered for a new expense.
    const offered = [...(host.querySelector('[aria-label="Category"]') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(offered).not.toContain("Old");
    await click(button("Save expense"));
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/billing/expenses/");
    expect(body).toMatchObject({ amount: 4000000, category: 1, method: "Bank hisobi", spent_by: 7, reason: "December rent" });
    expect(typeof body.request_id).toBe("string");
  });

  it("voids one with a reason", async () => {
    post.mockResolvedValue({ data: { ...ROW, voided_at: "2026-12-06T09:00:00+05:00" } });
    await mount();
    const voidButton = [...host.querySelectorAll("button")].find((b) => b.textContent === "Void")!;
    await click(voidButton);
    await fill("Why is this expense being voided?", "Typed twice");
    await click(button("Void this expense"));
    expect(post).toHaveBeenCalledWith("/billing/expenses/11/void/", { reason: "Typed twice" });
  });

  it("the archive asks for the voided ones", async () => {
    await mount();
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Archive")!);
    const last = get.mock.calls.filter(([url]) => url === "/billing/expenses/").at(-1);
    expect(last?.[1]).toMatchObject({ params: { archived: "1" } });
  });

  it("someone without manage_expenses only reads", async () => {
    await mount({ ...META, can_manage: false });
    expect(host.textContent).not.toContain("Add an expense");
    expect(host.textContent).not.toContain("Categories");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Void")).toBe(false);
  });

  it("before the cutover the form waits, and the categories can be set up", async () => {
    patch.mockResolvedValue({ data: { id: 1, name: "Rent", retired: true, used: 1 } });
    await mount({ ...META, open: false });
    expect(button("Add an expense").disabled).toBe(true);
    expect(host.textContent).toContain("until then lc-up keeps them");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Void")).toBe(false);
    await click(button("Categories"));
    const rent = [...host.querySelectorAll("li")].find((li) => li.textContent?.includes("Rent"))!;
    await click([...rent.querySelectorAll("button")].find((b) => b.textContent === "Retire")!);
    expect(patch).toHaveBeenCalledWith("/billing/expense-categories/1/", { retired: true });
  });

  it("a failed read says so, not 'no expenses'", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/billing/expenses/meta/") return { data: META };
      throw Object.assign(new Error("boom"), { response: { status: 500, data: {} } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ExpensesPanel />
        </QueryClientProvider>,
      );
    });
    await flush();
    expect(host.textContent).not.toContain("No expenses");
  });
});
