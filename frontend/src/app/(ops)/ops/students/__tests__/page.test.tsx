/**
 * /ops/students on `GET /users/admin/people/?section=students` (lc-up's Students board): a balance is a signed
 * number tinted by its verdict, groups are tags, and a row links to its student page, carrying the list's
 * address so Back returns to the same search, filters and page.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeoplePage, StudentRow } from "@/features/ops/changelist/peopleApi";

const get = vi.fn();
const post = vi.fn();
const push = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push }) }));
// The desk's administrator: every CRM permission, money included.
vi.mock("@/hooks/useMe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMe")>()),
  useMe: () => ({ me: { id: 9, role: "admin", permissions: ["view_people", "view_money", "send_sms", "edit_people"] } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: routerPush, prefetch: vi.fn() }),
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
  const index = heads.findIndex((th) => th.textContent?.replace(/[▲▼↑↓]/g, "").trim() === label);
  return row(name).querySelectorAll("td")[index] as HTMLTableCellElement;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/ops/students");
  get.mockReset();
  post.mockReset();
  push.mockReset();
  routerPush.mockReset();
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
      params: expect.objectContaining({ section: "students", status: "frozen_debt", o: "debt", page_size: 50 }),
    });
    expect(get.mock.calls[0][1].params).not.toHaveProperty("bogus");
    // lc-up's title row: the plain name, the count beside it.
    expect(host.querySelector("h1")?.textContent).toBe("Students");
    expect(host.textContent).toContain("3");
  });

  it("writes a balance as a signed number only, tinted by its verdict", async () => {
    await renderPage();
    const owes = cell("Aziz Tursunov", "Balance, so’m");
    expect(owes.textContent?.trim()).toBe("−250 000");
    expect(owes.getAttribute("data-verdict")).toBe("critical");
    // In credit: the number, green — never "Paid" or "Ahead".
    const credit = cell("Malika Karimova", "Balance, so’m");
    expect(credit.textContent?.trim()).toBe("120 000");
    expect(credit.getAttribute("data-verdict")).toBe("positive");
    expect(host.textContent).not.toMatch(/\b(Owes|Paid|Ahead)\b/);
    // Not linked at all: nothing to say.
    expect(cell("Bekzod Rahimov", "Balance, so’m").getAttribute("data-verdict")).toBeNull();
  });

  it("shows the groups as tags and an account freeze in words under the name", async () => {
    await renderPage();
    expect(cell("Aziz Tursunov", "Groups").textContent).toContain("SAT Math 1");
    expect(cell("Malika Karimova", "Student").textContent).toContain("Frozen — unpaid");
  });

  it("a row's name links to its student page", async () => {
    await renderPage();
    const a = cell("Malika Karimova", "Student").querySelector("a");
    expect(a?.getAttribute("href")).toBe("/ops/students/2");
    expect(a?.textContent).toContain("Malika Karimova");
  });

  it("the link carries the list's address, as Django's _changelist_filters", async () => {
    window.history.replaceState(null, "", "/ops/students?status=frozen_debt&p=2");
    await renderPage();
    expect(cell("Malika Karimova", "Student").querySelector("a")?.getAttribute("href")).toBe(
      "/ops/students/2?_changelist_filters=status%3Dfrozen_debt%26p%3D2",
    );
  });

  it("a click elsewhere on the row opens the same page; no editor pops up over the list", async () => {
    await renderPage();
    act(() => cell("Malika Karimova", "Phone").click());
    expect(routerPush).toHaveBeenCalledWith("/ops/students/2");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
