/**
 * /ops/archive (Archive board, owner 22 Nov 2026): the students who left a group — the group as a course tag, the
 * day and who removed them, the balance NOW for the money's holders only — the archived groups, the filters sent
 * to the server, Return only through the group's own Add, and an error that is not "nobody left".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ me: null as unknown, search: "" }));

vi.mock("@/hooks/useMe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMe")>()),
  useMe: () => ({ me: state.me }),
}));

const replace = vi.fn((url: string) => {
  state.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/ops/archive",
}));

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

const { ADMIN_ME } = await import("@/features/ops/testing/me");
const { ArchivePage, dayText } = await import("../ArchivePage");

const MINUS = "−";
const STUDENTS = "/classes/admin/archive/students/";
const GROUPS = "/classes/admin/archive/groups/";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.me = ADMIN_ME;
  state.search = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
  replace.mockClear();
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

let client: QueryClient;

async function mount(routes: Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    if (!(url in routes)) throw new Error(`unexpected GET ${url}`);
    const body = routes[url];
    if (body instanceof Error) throw body;
    return { data: body };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ArchivePage />
      </QueryClientProvider>,
    );
  });
  await flush();
}

async function rerender() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ArchivePage />
      </QueryClientProvider>,
    );
  });
  await flush();
}

const rows = () => [...host.querySelectorAll("table tbody tr")].map((tr) => tr.textContent ?? "");

const TOTALS = { students: 2, groups: 1 };

function row(over: object) {
  return {
    id: 1,
    student: { id: 9, name: "Aziz Tursunov", section: "students", phone: "+998901112233" },
    group: { id: 21, name: "Junior G21 · Math", level: "junior", subject: "MATH", is_active: true, teacher: "Vali Aliyev" },
    started_on: "2026-09-01",
    left_on: "2026-11-13",
    removed_by: "Sevara Hamidova",
    balance: -375000,
    ...over,
  };
}

function page(results: object[], over: object = {}) {
  return {
    count: results.length,
    page: 1,
    page_size: 50,
    pages: 1,
    results,
    totals: TOTALS,
    filters: [
      { key: "classroom", label: "Group", options: [{ value: "21", label: "Junior G21 · Math", count: 2 }], selected: null },
      { key: "teacher", label: "Teacher", options: [{ value: "5", label: "Vali Aliyev", count: 2 }], selected: null },
      { key: "owing", label: "Owes money now", options: [{ value: "1", label: "Owes money now", count: 1 }], selected: null },
    ],
    money: true,
    seats_open: false,
    ...over,
  };
}

const MALIKA = row({
  id: 2,
  student: { id: 10, name: "Malika Saidova", section: "public", phone: "" },
  group: { id: 30, name: "Senior G4 · English", level: "senior", subject: "ENGLISH", is_active: false, teacher: "" },
  left_on: null,
  removed_by: "",
  balance: 146429,
});

describe("students who left", () => {
  it("lists them with the group as a course tag, the day and who, and the tab counts", async () => {
    await mount({ [STUDENTS]: page([row({}), MALIKA]) });
    expect(host.querySelector("h1")?.textContent).toBe("Archive");
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Students2", "Groups1"]);

    const [aziz, malika] = rows();
    expect(aziz).toContain("Aziz Tursunov");
    expect(aziz).toContain("+998 90 111 22 33");
    expect(aziz).toContain("13 Nov 2026");
    expect(aziz).toContain("by Sevara Hamidova");
    expect(aziz).toContain(dayText("2026-09-01"));
    // No day kept, nobody named: nothing made up.
    expect(malika).toContain("—");
    expect(malika).not.toContain("by ");

    const tag = host.querySelector<HTMLElement>('table [data-course="junior"]');
    expect(tag?.closest("a")?.getAttribute("href")).toBe("/ops/classrooms/21");
    expect(host.querySelector<HTMLAnchorElement>('table a[href="/ops/public/10"]')?.textContent).toBe("Malika Saidova");
  });

  it("says the balance is today's, signed and tinted, for the money's holders", async () => {
    await mount({ [STUDENTS]: page([row({}), MALIKA]) });
    const head = [...host.querySelectorAll("th")].map((th) => th.textContent);
    expect(head).toContain("Balance now, so’m");
    const cells = [...host.querySelectorAll<HTMLElement>("td[data-verdict]")];
    expect(cells.map((td) => [td.textContent, td.getAttribute("data-verdict")])).toEqual([
      [`${MINUS}375 000`, "critical"],
      ["146 429", "positive"],
    ]);
    expect(rows().join(" ")).not.toMatch(/Owes|Paid|In debt|Ahead/);
  });

  it("has no balance column and no balance filter without the money", async () => {
    const { balance: _b, ...noMoney } = row({});
    void _b;
    await mount({ [STUDENTS]: page([noMoney], { money: false, filters: [] }) });
    expect([...host.querySelectorAll("th")].map((th) => th.textContent)).not.toContain("Balance now, so’m");
    expect(host.textContent).not.toContain("Owes money now");
  });

  it("sends the filters to the server and starts again on page 1", async () => {
    await mount({ [STUDENTS]: page([row({})]) });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Group"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["All groups", "Junior G21 · Math (2)"]);
    await act(async () => {
      select.value = "21";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(get).toHaveBeenLastCalledWith(STUDENTS, { params: { page: 1, page_size: 50, classroom: "21" } });

    await act(async () => {
      host.querySelector<HTMLInputElement>('input[aria-label="Owes money now"]')!.click();
    });
    await flush();
    expect(get).toHaveBeenLastCalledWith(STUDENTS, { params: { page: 1, page_size: 50, classroom: "21", owing: "1" } });
  });

  it("offers no Return while lc-up runs the seats", async () => {
    await mount({ [STUDENTS]: page([row({}), MALIKA], { seats_open: false }) });
    expect(host.textContent).not.toContain("Return");
  });

  it("offers Return to who may enrol, into a group still running, through the group's own Add", async () => {
    await mount({ [STUDENTS]: page([row({}), MALIKA], { seats_open: true }) });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("table button")].filter((b) => b.textContent?.includes("Return"));
    // Malika's group is archived: there is nothing to return her to.
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Return Aziz Tursunov to Junior G21 · Math"]);

    // The group's own Add does the work.
    await act(async () => buttons[0].click());
    await flush();
    expect(document.body.textContent).toContain("Add Aziz Tursunov to this group?");
  });

  it("shows no Return to someone who may not enrol", async () => {
    state.me = { ...ADMIN_ME, permissions: ADMIN_ME.permissions.filter((p) => p !== "enroll") };
    await mount({ [STUDENTS]: page([row({})], { seats_open: true }) });
    expect(host.textContent).not.toContain("Return");
  });

  it("is calm when nobody left", async () => {
    await mount({ [STUDENTS]: page([]) });
    expect(host.textContent).toContain("Nobody has left a group");
  });

  it("shows an error with Retry, not the empty state, when the archive does not load", async () => {
    await mount({ [STUDENTS]: new Error("boom") });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load the archive.");
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).not.toContain("Nobody has left a group");
  });
});

describe("archived groups", () => {
  const GROUP_PAGE = {
    count: 2,
    page: 1,
    page_size: 50,
    pages: 1,
    totals: TOTALS,
    results: [
      { id: 40, name: "Foundation G2 · Math", level: "foundation", subject: "MATH", teacher: "Vali Aliyev", start_date: "2026-03-01", created_at: "2026-02-20", archived_on: "2026-10-20", left: 7 },
      { id: 41, name: "Middle G9 · English", level: "", subject: "ENGLISH", teacher: "", start_date: null, created_at: "2026-01-05", archived_on: null, left: 0 },
    ],
  };

  it("lists them with their dates, a day not kept as a dash", async () => {
    state.search = "tab=groups";
    await mount({ [GROUPS]: GROUP_PAGE });
    const [old, byHand] = rows();
    expect(old).toContain("Foundation G2 · Math");
    expect(old).toContain("20 Oct 2026");
    expect(old).toContain("7");
    expect(byHand).toContain("—");
    expect(host.querySelector('table [data-course="middle"]')?.closest("a")?.getAttribute("href")).toBe("/ops/classrooms/41");
  });

  it("is calm when no group is archived", async () => {
    state.search = "tab=groups";
    await mount({ [GROUPS]: { ...GROUP_PAGE, count: 0, results: [] } });
    expect(host.textContent).toContain("No archived groups");
  });

  it("switches tabs through the address", async () => {
    await mount({ [STUDENTS]: page([row({})]), [GROUPS]: GROUP_PAGE });
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Groups"))!.click();
    });
    expect(replace).toHaveBeenCalledWith("/ops/archive?tab=groups", { scroll: false });
    await rerender();
    expect(rows()[0]).toContain("Foundation G2 · Math");
  });
});

describe("dates", () => {
  it("reads a day without a time zone shift", () => {
    expect(dayText("2026-11-13")).toBe("13 Nov 2026");
    expect(dayText(null)).toBe("—");
  });
});
