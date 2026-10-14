/**
 * /ops/students on `GET /users/admin/people/?section=students`: a debt is red and only a debt
 * (lc-up's balance below zero), the lc-up column says who is linked, and a row opens the editor.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeoplePage, StudentRow } from "@/features/ops/changelist/peopleApi";

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
const push = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => "/ops/students",
}));

const { default: OpsStudentsPage } = await import("../page");

function student(over: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 1,
    username: "aziz",
    name: "Aziz Tursunov",
    email: "aziz@example.com",
    phone: "998901234567",
    role: "student",
    status: "centre",
    is_frozen: false,
    date_joined: "2026-09-01T10:00:00+05:00",
    last_seen: null,
    groups: [{ id: 59, name: "SAT Math 1" }],
    lcup: { linked: true, balance: -250000 },
    ...over,
  };
}

const PAGE: PeoplePage<StudentRow> = {
  section: "students",
  count: 3,
  page: 1,
  page_size: 50,
  pages: 1,
  ordering: "-joined",
  results: [
    student(),
    student({
      id: 2,
      username: "malika",
      name: "Malika Karimova",
      status: "frozen_debt",
      is_frozen: true,
      lcup: { linked: true, balance: 120000 },
    }),
    student({ id: 3, username: "bekzod", name: "Bekzod Rahimov", groups: [], lcup: { linked: false, balance: null } }),
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active", count: 2 },
        { value: "frozen_debt", label: "Frozen — unpaid", count: 1 },
      ],
      selected: null,
    },
  ],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <OpsStudentsPage />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const row = (name: string) =>
  [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name)) as HTMLTableRowElement;
/** A row's cell under the column headed `label`. */
function cell(name: string, label: string): HTMLTableCellElement {
  const heads = [...host.querySelectorAll("thead th")];
  const index = heads.findIndex((th) => th.textContent?.replace(/[▲▼]/g, "").trim() === label);
  return row(name).querySelectorAll("td")[index] as HTMLTableCellElement;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/ops/students");
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  push.mockReset();
  get.mockResolvedValue({ data: PAGE });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/ops/students", () => {
  it("asks the people endpoint for the students section, with the address's filters", async () => {
    window.history.replaceState(null, "", "/ops/students?status=frozen_debt&o=debt&bogus=1");
    await renderPage();
    expect(get).toHaveBeenCalledWith("/users/admin/people/", {
      params: { section: "students", status: "frozen_debt", o: "debt", page_size: 50 },
    });
    expect(host.querySelector("h1")?.textContent).toBe("Students · 3");
  });

  it("shows a debt in red only when lc-up's balance is below zero", async () => {
    await renderPage();
    const owes = cell("Aziz Tursunov", "Debt");
    expect(owes.textContent).toBe("250,000 UZS");
    expect(owes.querySelector("span")?.className).toContain("text-danger");

    // In credit: no amount, nothing red.
    const credit = cell("Malika Karimova", "Debt");
    expect(credit.textContent).toBe("—");
    expect(credit.innerHTML).not.toContain("text-danger");
    expect(credit.textContent).not.toContain("120,000");

    // Not linked at all.
    expect(cell("Bekzod Rahimov", "Debt").textContent).toBe("—");
  });

  it("says who is linked to lc-up, which groups they sit in, and the status in words", async () => {
    await renderPage();
    expect(cell("Aziz Tursunov", "lc-up").querySelector('[aria-label="Linked"]')?.textContent?.trim()).toBe("✓");
    expect(cell("Bekzod Rahimov", "lc-up").querySelector('[aria-label="Not linked"]')).not.toBeNull();
    expect(cell("Aziz Tursunov", "Groups").textContent).toBe("SAT Math 1");
    expect(cell("Aziz Tursunov", "Status").textContent).toBe("Active");
    expect(cell("Malika Karimova", "Status").textContent).toBe("Frozen — unpaid");
    expect(cell("Aziz Tursunov", "Last seen").textContent).toBe("Never");
  });

  it("opens the editor on a row click", async () => {
    await renderPage();
    expect(host.querySelector('[role="dialog"][aria-label="Edit user"]')).toBeNull();
    act(() => cell("Malika Karimova", "Joined").click());
    const dialog = host.querySelector('[role="dialog"][aria-label="Edit user"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Malika Karimova");
    expect(dialog?.textContent).toContain("Save changes");
  });

  it("does not rewrite a name it only guessed from the one-line name", async () => {
    patch.mockResolvedValue({ data: {} });
    await renderPage();
    act(() => cell("Aziz Tursunov", "Joined").click());
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Save changes"))!;
    await act(async () => {
      save.click();
    });
    expect(patch).toHaveBeenCalledTimes(1);
    const [url, payload] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/users/1/update/");
    expect(payload).not.toHaveProperty("first_name");
    expect(payload).not.toHaveProperty("last_name");
    expect(payload).toMatchObject({ username: "aziz", role: "student", is_frozen: false });
  });
});
