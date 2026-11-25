/**
 * /ops/students in lc-up's shape (canvas board "Students"): groups as course tags with their rooms, signed balances
 * for `view_money` only, the chips and filter card in the address, the quick card from a group chip, and the bulk
 * bar's Send SMS.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeoplePage, StudentRow } from "@/features/ops/changelist/peopleApi";
import type { PersonAttendance } from "@/features/ops/people/personApi";

const state = vi.hoisted(() => ({ me: null as unknown, search: "", replace: vi.fn(), push: vi.fn() }));
const get = vi.fn();

vi.mock("@/hooks/useMe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMe")>()),
  useMe: () => ({ me: state.me }),
}));
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, push: state.push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/ops/students",
}));

const { StudentsList } = await import("../StudentsList");
const { ADMIN_ME, TEACHER_ME } = await import("@/features/ops/testing/me");

const AZIZ: StudentRow = {
  id: 7, username: "aziz", name: "Aziz Karimov", email: "", phone: "998935182046", role: "student", status: "centre",
  is_frozen: false, date_joined: null, last_seen: null, avatar_url: null,
  groups: [
    {
      id: 45, name: "Junior G21 | Math | Bekzod", level: "junior", subject: "MATH", room: "304",
      teacher: { id: 3, name: "Bekzod Toshmatov", first_name: "Bekzod", last_name: "Toshmatov" },
      seat_status: "active", joined: "2026-09-02",
    },
    {
      id: 46, name: "Middle G4", level: "middle", subject: "ENGLISH", room: "", teacher: null,
      seat_status: "trial", joined: "2026-11-10",
    },
  ],
  lcup: { linked: true, balance: -153846 },
  parent_phone: "998903001172",
};
const DEMO_ONLY: StudentRow = {
  ...AZIZ, id: 9, username: "dema", name: "Dema Only", is_demo_only: true,
  groups: [], lcup: { linked: false, balance: null }, parent_phone: "",
};
const LAYLO: StudentRow = {
  ...AZIZ, id: 8, username: "laylo", name: "Laylo Saidova", phone: "", is_frozen: true, status: "frozen_debt",
  groups: [], lcup: { linked: true, balance: 3000 }, parent_phone: "",
};

const PAGE: PeoplePage<StudentRow> = {
  section: "students",
  count: 2,
  page: 1,
  pages: 1,
  page_size: 50,
  ordering: "-joined",
  results: [AZIZ, LAYLO],
  filters: [
    { key: "group", label: "Group", options: [{ value: "45", label: "Junior G21 | Math | Bekzod", count: 1 }], selected: null },
    {
      key: "show",
      label: "Show",
      options: [
        { value: "all", label: "All", count: 2 },
        { value: "owes", label: "Owe money", count: 1 },
        { value: "trial", label: "Demo", count: 1 },
        { value: "frozen", label: "Frozen", count: 0 },
        { value: "nogroup", label: "No group", count: 1 },
      ],
      selected: null,
    },
  ],
};

const ATTENDANCE: PersonAttendance = {
  classes: [
    { id: 45, name: "Junior G21", active: true, rate: 90, present: 9, late: 0, absent: 1, excused: 0, counted: 10, weekdays: [0, 2, 4], lesson_time: "16:00" },
  ],
  recent: [
    { date: "2026-11-02", class_id: 45, class_name: "Junior G21", status: "PRESENT", note: "", reason: "", lcup_push: null },
    { date: "2026-11-04", class_id: 45, class_name: "Junior G21", status: "ABSENT", note: "", reason: "", lcup_push: null },
    { date: "2026-11-04", class_id: 46, class_name: "Middle G4", status: "PRESENT", note: "", reason: "", lcup_push: null },
  ],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderList(query = "", me: unknown = ADMIN_ME) {
  state.search = query;
  state.me = me;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <StudentsList />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const rows = () => [...host.querySelectorAll("tbody tr")];
const heads = () => [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
const lastAddress = () => new URL(String(state.replace.mock.calls.at(-1)?.[0]), "http://x");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T10:00:00+05:00"));
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url === "/users/admin/people/") return { data: PAGE };
    if (url === "/users/admin/people/7/") return { data: { id: 7, parent: { name: "Karim", phone: "998903001172" } } };
    if (url === "/users/admin/people/7/attendance/") return { data: ATTENDANCE };
    throw new Error(`unexpected ${url}`);
  });
  state.replace.mockReset();
  state.push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the Students list", () => {
  it("draws the board's columns with groups as course tags and a signed balance", async () => {
    await renderList();
    expect(heads()).toEqual(["", "#", "Student", "Phone", "Groups", "Balance, so’m", "Teachers", "Actions"]);
    const [aziz, laylo] = rows();
    expect(aziz.textContent).toContain("+998 93 518 20 46");
    const tags = [...aziz.querySelectorAll("[data-course]")].map((t) => [t.getAttribute("data-course"), t.textContent]);
    expect(tags).toEqual([
      ["junior", "Junior G21 · Math · Bekzod"],
      ["middle", "Middle G4 · English"],
    ]);
    expect(aziz.textContent).toContain("Room 304");
    expect(aziz.textContent).toContain("DEMO");
    expect(aziz.textContent).not.toContain("Trial");
    expect(aziz.textContent).toContain("Bekzod Toshmatov Junior Math");
    const balance = aziz.querySelector("td[data-verdict]");
    expect(balance?.getAttribute("data-verdict")).toBe("critical");
    expect(balance?.textContent).toBe("−153 846");
    expect(laylo.querySelector("td[data-verdict]")?.getAttribute("data-verdict")).toBe("positive");
    // Never the words beside a balance.
    expect(host.querySelector("table")?.textContent).not.toMatch(/Owes|Paid|Ahead|In debt|Debt-free/);
    expect(laylo.textContent).toContain("No group");
    expect(laylo.textContent).toContain("Frozen — unpaid");
    expect(host.querySelector("[data-list-count]")?.textContent).toBe("2");
  });

  it("puts the parent's phone on the student's second line, as lc-up does", async () => {
    await renderList();
    const [aziz, laylo] = rows();
    const student = (row: Element) => row.querySelectorAll("td")[2];
    expect(student(aziz).querySelector("[data-parent-phone]")?.textContent).toBe("Parent +998 90 300 11 72");
    // No phone kept: no empty "Parent" line.
    expect(student(laylo).querySelector("[data-parent-phone]")).toBeNull();
    expect(student(laylo).textContent).toContain("Frozen — unpaid");
  });

  it("draws no parent line when the server sends none (a viewer without view_people, an older server)", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/users/admin/people/") return { data: { ...PAGE, results: [{ ...AZIZ, parent_phone: null }, { ...LAYLO, parent_phone: undefined }] } };
      throw new Error(`unexpected ${url}`);
    });
    await renderList();
    expect(host.querySelector("[data-parent-phone]")).toBeNull();
  });

  it("keeps money from anyone without view_money: no balance column, no Owe money chip", async () => {
    await renderList("", { ...TEACHER_ME, permissions: ["view_people"] });
    expect(heads()).not.toContain("Balance, so’m");
    const chips = [...host.querySelectorAll('[role="group"][aria-label="Show"] a')].map((a) => a.textContent);
    expect(chips).toEqual(["All2", "Demo1", "Frozen0", "No group1"]);
  });

  it("badges someone whose only seats are demo ones next to the name", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/users/admin/people/") return { data: { ...PAGE, count: 1, results: [DEMO_ONLY] } };
      throw new Error(`unexpected ${url}`);
    });
    await renderList("show=trial");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Dema Only");
    expect(rows()[0].textContent).toContain("DEMO");
  });

  it("puts a chip and the typed filters in the address", async () => {
    await renderList();
    const owes = [...host.querySelectorAll('[role="group"][aria-label="Show"] a')][1] as HTMLAnchorElement;
    expect(owes.textContent).toBe("Owe money1");
    act(() => owes.click());
    expect(lastAddress().searchParams.get("show")).toBe("owes");

    const phone = host.querySelector('input[aria-label="Phone"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(phone, "93 518");
      phone.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      phone.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(lastAddress().searchParams.get("phone")).toBe("93 518");
  });

  it("asks the server with the board's filters", async () => {
    await renderList("show=trial&course=junior%3AMATH&parent_phone=300&ps=25");
    const [, config] = get.mock.calls.find(([url]) => url === "/users/admin/people/")!;
    expect(config.params).toEqual({
      section: "students", show: "trial", course: "junior:MATH", parent_phone: "300", page_size: 25,
    });
  });

  it("an empty result names what is in force and offers to clear it", async () => {
    get.mockImplementation(async () => ({ data: { ...PAGE, count: 0, results: [] } }));
    await renderList("q=zzzz&show=frozen&group=45");
    expect(host.textContent).toContain("No students match these filters");
    expect(host.textContent).toContain("The search “zzzz”, “Frozen” and Group “Junior G21 | Math | Bekzod” are on.");
    const clear = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Clear filters").at(-1)!;
    act(() => clear.click());
    expect(lastAddress().search).toBe("");
  });

  it("opens the quick card from a group chip: phones, balance, the seat and this month's marks", async () => {
    await renderList();
    const chip = rows()[0].querySelector("[data-course]")!.closest("button")!;
    act(() => chip.click());
    await settle();
    expect(state.push).not.toHaveBeenCalled(); // the chip does not open the row
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Aziz Karimov");
    expect(dialog.textContent).toContain("+998 93 518 20 46 · parent +998 90 300 11 72");
    expect(dialog.querySelector("[data-balance]")?.textContent).toBe("−153 846");
    expect(dialog.textContent).toContain("Active");
    expect(dialog.textContent).toContain("Joined 2 Sep 2026");
    expect(dialog.textContent).toContain("Mon Wed Fri 16:00");
    expect(dialog.textContent).toContain("November 2026");
    expect([...dialog.querySelectorAll("[data-mark]")].map((m) => m.getAttribute("data-mark"))).toEqual(["PRESENT", "ABSENT"]);
    expect(dialog.querySelector('a[href="/ops/students/7"]')?.textContent).toBe("Open student page");
    // An earlier month the attendance part covers has no marks for this group.
    act(() => (dialog.querySelector('button[aria-label="Previous month"]') as HTMLButtonElement).click());
    expect(dialog.textContent).toContain("No marks in October 2026.");
  });

  it("sends the ticked students to the SMS composer", async () => {
    await renderList();
    const boxes = [...host.querySelectorAll('tbody input[type="checkbox"]')] as HTMLInputElement[];
    act(() => boxes[0].click());
    act(() => boxes[1].click());
    const send = [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Send SMS to the selected students")!;
    await act(async () => send.click());
    expect(state.push).toHaveBeenCalledWith("/ops/sms/campaigns/new?students=7,8");
  });
});
