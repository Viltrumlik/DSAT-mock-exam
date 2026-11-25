/**
 * /ops/classrooms — the Groups list in lc-up's shape (canvas board "Groups") on `GET /classes/admin/classrooms/`:
 * the columns, a row linking to its page with the list remembered, the chips and filters sent from the address,
 * lessons done in lc-up's colours, "New group" only for `manage_groups`, and `?new=1` opening it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomPage } from "../classroomsApi";
import type { GroupRow } from "../ClassroomList";

const state = vi.hoisted(() => ({ me: null as unknown, search: "", replace: vi.fn(), push: vi.fn() }));
const get = vi.fn();

vi.mock("@/hooks/useMe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMe")>()),
  useMe: () => ({ me: state.me }),
}));
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, push: state.push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/ops/classrooms",
}));
vi.mock("../CreateClassroomModal", () => ({
  CreateClassroomModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog">
      Add classroom
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  ),
}));

const { ClassroomList } = await import("../ClassroomList");
const { ADMIN_ME, ACCOUNTANT_ME } = await import("@/features/ops/testing/me");

const ROWS: GroupRow[] = [
  {
    id: 45, name: "Foundation G14 | Math | Bekzod", subject: "MATH", level: "foundation",
    teacher: { id: 3, name: "Bekzod Toshmatov" }, teacher_first_name: "Bekzod", teacher_last_name: "Toshmatov",
    students: 18, trial: 1, lesson_days: "ODD", lesson_time: "14:00", lesson_hours: 2, room_number: "302",
    branch: "Chilonzor", lcup: true, is_active: true, created_at: null, monthly_price: 500000,
    start_date: "2026-11-06", lessons: { done: 12, total: 14 },
  },
  {
    id: 46, name: "Own class", subject: "ENGLISH", level: "", teacher: null, students: 3, trial: 0,
    lesson_days: "EVEN", lesson_time: "", room_number: "", branch: "", lcup: false, is_active: false,
    created_at: null, monthly_price: null, start_date: null, lessons: null,
  },
];

const PAGE: ClassroomPage = {
  count: 2,
  page: 1,
  pages: 1,
  page_size: 50,
  ordering: "-created",
  filters: [
    { key: "subject", label: "Subject", options: [{ value: "ENGLISH", label: "English", count: 1 }, { value: "MATH", label: "Math", count: 1 }], selected: null },
    { key: "days", label: "Days", options: [{ value: "EVEN", label: "Even", count: 1 }, { value: "ODD", label: "Odd", count: 1 }], selected: null },
    {
      key: "show",
      label: "Show",
      options: [
        { value: "all", label: "All", count: 2 },
        { value: "ends", label: "Ends this week", count: 1 },
        { value: "trial", label: "Has demo students", count: 1 },
      ],
      selected: null,
    },
  ],
  results: ROWS,
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
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
        <ClassroomList />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const rows = () => [...host.querySelectorAll("tbody tr")];
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  get.mockResolvedValue({ data: PAGE });
  state.replace.mockReset();
  state.push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Groups list", () => {
  it("draws the board's columns: group, time, course and room, days, lessons done, start", async () => {
    await renderList();
    expect(host.querySelector("h1")?.textContent).toBe("Groups");
    const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(heads).toEqual(["#", "Group", "Time", "Course · room", "Days", "Lessons done", "Started", "Actions"]);
    const [paired, own] = rows().map((tr) => tr.textContent ?? "");
    expect(paired).toContain("Foundation G14 · Math · Bekzod");
    expect(paired).toContain("500 000 so’m a month");
    expect(paired).toContain("14:00–16:00");
    expect(paired).toContain("Foundation Math");
    expect(paired).toContain("Room 302");
    expect(paired).toContain("MonWedFri");
    expect(paired).toContain("12 · 85.7%");
    expect(paired).toContain("Ends in 2");
    expect(paired).toContain("6 Nov 2026");
    // A class without lc-up's name gets its subject; no course length, no lessons figure; archived says so.
    expect(own).toContain("Own class · English");
    expect(own).toContain("Archived");
    expect(own).toContain("TueThuSat");
    expect(rows()[0].querySelector('[data-lessons-tone="late"]')).not.toBeNull();
    expect(rows()[1].querySelector("[data-lessons-tone]")).toBeNull();
  });

  it("links a row's name to its page and remembers the list", async () => {
    await renderList("lcup=paired");
    const link = host.querySelector("tbody a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/ops/classrooms/45?_changelist_filters=lcup%3Dpaired");
    expect(link.textContent).toBe("Foundation G14 · Math · Bekzod");
  });

  it("asks the server with the filters in the address, the board's own too", async () => {
    await renderList("lcup=paired&q=301&junk=1&show=ends&room=302&price=500000&branch=2");
    const [url, config] = get.mock.calls[0];
    expect(url).toBe("/classes/admin/classrooms/");
    expect(config.params).toEqual({
      lcup: "paired", branch: "2", show: "ends", room: "302", price: "500000", q: "301", page_size: 50,
    });
  });

  it("offers the chips with the server's counts and puts the one picked in the address", async () => {
    await renderList("subject=MATH");
    const chips = [...host.querySelectorAll('[role="group"][aria-label="Show"] a')];
    expect(chips.map((a) => a.textContent)).toEqual(["All2", "Math1", "English1", "Ends this week1", "Has demo students1"]);
    expect(chips[1].getAttribute("aria-current")).toBe("true");
    act(() => (chips[3] as HTMLAnchorElement).click());
    const href = String(state.replace.mock.calls.at(-1)?.[0]);
    expect(new URL(href, "http://x").searchParams.get("show")).toBe("ends");
    expect(new URL(href, "http://x").searchParams.get("subject")).toBe("MATH");
  });

  it("New group is for manage_groups; it opens the existing create form", async () => {
    await renderList("", ACCOUNTANT_ME);
    expect(button("New group")).toBeUndefined();
    expect(host.querySelector('a[href="/ops/timetable"]')?.textContent).toBe("Timetable");
    await renderList();
    act(() => button("New group")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Add classroom");
  });

  it("?new=1 opens the create form, and the address forgets it when the form closes", async () => {
    await renderList("new=1&subject=MATH");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
    act(() => button("Cancel")!.click());
    expect(String(state.replace.mock.calls.at(-1)?.[0])).toBe("/ops/classrooms?subject=MATH");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("?new=1 from someone who may not create a group just drops the parameter", async () => {
    await renderList("new=1", ACCOUNTANT_ME);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(String(state.replace.mock.calls.at(-1)?.[0])).toBe("/ops/classrooms");
  });

  it("a failed load is an alert with Retry, and the filters stay", async () => {
    get.mockRejectedValue(new Error("down"));
    await renderList("q=301");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load groups.");
    expect((host.querySelector('input[aria-label="Group name"]') as HTMLInputElement).value).toBe("301");
  });
});
