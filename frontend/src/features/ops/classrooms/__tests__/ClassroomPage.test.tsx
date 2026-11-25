/**
 * /ops/classrooms/<id> — a group's page in lc-up's shape (Group board, 22 Nov 2026): the header card, the roster on
 * the left, lc-up's tabs on the right (Attendance first) and our own Details (the class's form). A class that
 * follows lc-up shows lc-up's fields locked and leaves them out of the save, offers no student add/remove, no
 * teacher change, no archive and no delete; its support teachers stay ours. Any other class is fully editable.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ME, TEACHER_ME } from "@/features/ops/testing/me";

import type { ClassroomCore } from "../classroomsApi";

const get = vi.fn();
const toast = vi.fn();
const replace = vi.fn();
const routerPush = vi.fn();
const classes = {
  governanceUpdate: vi.fn(),
  governanceDelete: vi.fn(),
  removeMember: vi.fn(),
  addMember: vi.fn(),
  assignTeacher: vi.fn(),
  transferOwnership: vi.fn(),
  assignSupportTeacher: vi.fn(),
  removeSupportTeacher: vi.fn(),
};
let search = "";
let me: Record<string, unknown> | null = { role: "admin", permissions: ADMIN_ME.permissions };

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a) },
  classesApi: classes,
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));
vi.mock("@/features/org/orgHooks", () => ({
  useRegions: () => ({ data: [{ id: 1, name: "Tashkent" }] }),
  useBranches: () => ({ data: [{ id: 2, name: "Chilonzor", region: 1, is_active: true }] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: routerPush, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ops/classrooms/45",
}));

const { ClassroomPage } = await import("../ClassroomPage");

const LOCKED = [
  "name", "subject", "level", "lesson_days", "lesson_time", "lesson_hours", "branch", "room_number", "start_date", "is_active",
  "monthly_price",
];

function core(over: Partial<ClassroomCore> = {}): ClassroomCore {
  return {
    id: 45,
    name: "Junior G21 Math",
    subject: "MATH",
    level: "JUNIOR",
    description: "",
    lesson_days: "ODD",
    lesson_time: "14:00",
    lesson_hours: 2,
    start_date: "2026-09-01",
    room_number: "301",
    branch: { id: 2, name: "Chilonzor" },
    telegram_chat_id: "",
    telegram_group_url: "",
    max_students: null,
    monthly_price: 500000,
    seats_open: false,
    schedule_summary: "",
    is_active: true,
    join_code: "ABC123",
    created_at: "2026-08-20T10:00:00+05:00",
    teacher: { id: 3, name: "Vali Aliyev" },
    tas: [{ id: 4, name: "Sardor TA" }],
    students: 2,
    lcup: { managed: true, group_name: "G21 Math", status: "confirmed", locked_fields: LOCKED },
    glance: { attendance_rate: 64, last_lesson: "2026-10-14", homework: { assignments: 3, handed_in: 4, expected: 6 }, owing: 1, today: null },
    ...over,
  };
}

const UNPAIRED: Partial<ClassroomCore> = { lcup: null, name: "Own class" };

const PARTS: Record<string, unknown> = {
  roster: {
    students: [
      { id: 7, name: "Aziz Tursunov", username: "aziz", avatar_url: null, section: "students", phone: "998935182046", joined_at: null, owes: 250000, attendance_rate: 50, homework_rate: 100 },
      { id: 8, name: "Public Person", username: "pub", avatar_url: null, section: "public", phone: "", joined_at: null, owes: null, attendance_rate: null, homework_rate: null },
    ],
    left: [],
  },
  register: {
    month: "2026-11",
    months: ["2026-10", "2026-11"],
    today: "2026-11-18",
    dates: [
      { date: "2026-11-02", held: true },
      { date: "2026-11-16", held: true },
      { date: "2026-11-20", held: false },
    ],
    students: [
      { id: 7, name: "Aziz Tursunov", section: "students", joined: "2026-10-01", seat_status: "active", frozen_on: null, left: false, marks: { "2026-11-02": "PRESENT", "2026-11-16": "EXCUSED" } },
      { id: 8, name: "Public Person", section: "public", joined: "2026-11-09", seat_status: "frozen", frozen_on: null, left: false, marks: {} },
    ],
  },
  attendance: { sessions: [], rate: null },
  homework: { assignments: [] },
  history: { items: [], truncated: false },
  telegram: { configured: false, health: null, counts: { in_group: null, known: 0, managed: 0, frozen_in_group: 0 }, members: [] },
};

const SESSIONS = { sessions: [{ id: 9, date: "2026-10-14", title: "", lesson_index: null, status: "OPEN" }], schedule_is_usable: true };
const SESSION = {
  id: 9, date: "2026-10-14", title: "", lesson_index: null, status: "OPEN",
  marking: { state: "LOCKED", opens_at: "", closes_at: "", can_mark: true, is_override: true, reason: null },
  roster: [{ student_id: 7, name: "Aziz Tursunov", status: "PRESENT", note: "" }],
};

function route(room: ClassroomCore) {
  get.mockImplementation((url: string) => {
    if (url === "/classes/admin/classrooms/45/") return Promise.resolve({ data: room });
    if (url === "/classes/45/attendance/sessions/") return Promise.resolve({ data: SESSIONS });
    if (url === "/classes/45/attendance/sessions/9/") return Promise.resolve({ data: SESSION });
    const part = /^\/classes\/admin\/classrooms\/45\/(\w+)\/$/.exec(url)?.[1];
    if (part && part in PARTS) return Promise.resolve({ data: PARTS[part] });
    if (url === "/users/admin/people/") return Promise.resolve({ data: { results: [] } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

const partCalls = () =>
  get.mock.calls.map(([u]) => u as string).filter((u) => /^\/classes\/admin\/classrooms\/45\/\w+\/$/.test(u));

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderPage(query = "") {
  search = query;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ClassroomPage id={45} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const box = (title: string) =>
  ([...host.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === title) as HTMLElement | undefined) ??
  null;
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

function control(label: string): HTMLInputElement {
  const el = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(label));
  const id = el?.getAttribute("for");
  return (id ? document.getElementById(id) : null) as HTMLInputElement;
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  toast.mockReset();
  replace.mockReset();
  routerPush.mockReset();
  for (const fn of Object.values(classes)) fn.mockReset();
  search = "";
  me = { role: "admin", permissions: ADMIN_ME.permissions };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a class that follows lc-up", () => {
  it("locks lc-up's fields on Details and saves only ours", async () => {
    route(core());
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage("tab=details");
    expect(host.querySelector("h1")?.textContent).toBe("Junior G21 Math · Aliyev");
    for (const label of ["Name", "Level", "Lesson days", "Lesson time", "Lesson hours", "Start date", "Room", "Branch"]) {
      expect(control(label).disabled).toBe(true);
    }
    expect(box("Details")!.textContent).toContain("Set in lc-up");
    for (const label of ["Description", "Telegram chat id", "Telegram link", "Max students"]) {
      expect(control(label).disabled).toBe(false);
    }

    typeInto(control("Description") as unknown as HTMLTextAreaElement, "Morning group");
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    const [id, payload] = classes.governanceUpdate.mock.calls[0];
    expect(id).toBe(45);
    expect(payload).toMatchObject({ description: "Morning group" });
    for (const field of LOCKED) expect(payload).not.toHaveProperty(field);
  });

  it("shows the server's reason when a save is refused", async () => {
    route(core());
    classes.governanceUpdate.mockRejectedValue({ response: { data: { detail: "lc-up sets room number for this class." } } });
    await renderPage("tab=details");
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(box("Details")!.textContent).toContain("lc-up sets room number for this class.");
  });

  it("has no archive or delete — lc-up owns the class", async () => {
    route(core());
    await renderPage();
    expect(host.textContent).toContain("Managed in lc-up");
    act(() => (host.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click());
    const items = [...host.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items).toEqual(["Group details"]);
  });

  it("says in the form why lc-up's fields are locked", async () => {
    route(core());
    await renderPage("tab=details");
    expect(box("Details")!.textContent).toContain("This class follows its lc-up group");
    // The group's name is said once, in the Summary, as plain text.
    expect(box("Summary")!.textContent).toContain("G21 Math");
  });

  it("offers no student add or remove", async () => {
    route(core());
    await renderPage();
    const students = host.querySelector('aside[aria-label="Students"]') as HTMLElement;
    expect(students.textContent).toContain("Students come from lc-up");
    expect(button(students, "Add")).toBeUndefined();
    act(() => (students.querySelector('[aria-label="More actions for Aziz Tursunov"]') as HTMLButtonElement).click());
    expect([...students.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(["Open profile"]);
  });

  it("keeps the teacher lc-up's and the support teachers ours", async () => {
    route(core());
    classes.removeSupportTeacher.mockResolvedValue(undefined);
    await renderPage("tab=staff");
    const staff = box("Staff")!;
    expect(staff.textContent).toContain("Set in lc-up");
    expect(button(staff, "Make teacher")).toBeUndefined();
    act(() => button(staff, "Remove")!.click());
    await settle();
    expect(classes.removeSupportTeacher).toHaveBeenCalledWith(45, 4);
  });
});

describe("any other class", () => {
  it("is editable throughout and can be deleted after a confirm", async () => {
    route(core(UNPAIRED));
    classes.governanceDelete.mockResolvedValue(undefined);
    await renderPage("_changelist_filters=lcup%3Dunpaired&tab=details");
    expect(control("Name").disabled).toBe(false);
    expect(box("Details")!.textContent).not.toContain("Set in lc-up");

    // Delete is the rare, destructive one: behind ⋮.
    expect(button(host, "Delete class")).toBeUndefined();
    act(() => (host.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click());
    act(() => button(host, "Delete class")!.click());
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("cannot be undone");
    act(() => button(dialog, "Delete")!.click());
    await settle();
    expect(classes.governanceDelete).toHaveBeenCalledWith(45);
    expect(routerPush).toHaveBeenCalledWith("/ops/classrooms?lcup=unpaired");
  });

  it("archives from ⋮", async () => {
    route(core(UNPAIRED));
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage();
    act(() => (host.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click());
    act(() => button(host, "Archive")!.click());
    await settle();
    expect(classes.governanceUpdate).toHaveBeenCalledWith(45, { is_active: false });
  });

  it("names its support teachers in the header, not again in the Summary", async () => {
    route(core(UNPAIRED));
    await renderPage("tab=details");
    const header = host.querySelector("h1")!.closest("section") as HTMLElement;
    expect(header.querySelector('a[href="/ops/staff/4"]')?.textContent).toBe("Sardor TA");
    expect(box("Summary")!.textContent).not.toContain("Support teachers");
  });

  it("removes a student from the roster's ⋮", async () => {
    route(core(UNPAIRED));
    classes.removeMember.mockResolvedValue(undefined);
    await renderPage();
    const students = host.querySelector('aside[aria-label="Students"]') as HTMLElement;
    act(() => (students.querySelector('[aria-label="More actions for Aziz Tursunov"]') as HTMLButtonElement).click());
    act(() => [...students.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((i) => i.textContent === "Remove")!.click());
    await settle();
    expect(classes.removeMember).toHaveBeenCalledWith(45, 7);
  });

  it("adds a student from the roster's Add, in a sheet", async () => {
    route(core(UNPAIRED));
    await renderPage();
    const students = host.querySelector('aside[aria-label="Students"]') as HTMLElement;
    act(() => button(students, "Add")!.click());
    await settle();
    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain("Add a student");
    expect(sheet.querySelector('input[placeholder^="Search"]')).not.toBeNull();
  });
});

describe("the header", () => {
  /** The card holding the h1: the class's header. */
  const header = () => host.querySelector("h1")!.closest("section") as HTMLElement;

  it("titles the group with its teacher's surname and says its facts as badges", async () => {
    route(core());
    await renderPage();
    const text = header().textContent;
    expect(host.querySelector("h1")?.textContent).toBe("Junior G21 Math · Aliyev");
    expect(header().querySelector('[data-course="junior"]')?.textContent).toBe("Junior Math");
    expect(text).toContain("Mon Wed Fri · 14:00");
    expect(text).toContain("Room 301");
    expect(text).toContain("Chilonzor");
    expect(text).toContain("500 000 so'm a month");
    expect(text).toContain("Started 1 Sep 2026");
    expect(header().querySelector('a[href="/ops/staff/3"]')?.textContent).toBe("Vali Aliyev");
    expect(text).toContain("Synced from lc-up");
  });

  it("keeps the price to view_money", async () => {
    me = { role: "admin", permissions: ADMIN_ME.permissions.filter((p) => p !== "view_money") };
    route(core());
    await renderPage();
    expect(header().textContent).not.toContain("a month");
  });

  it("says whether today's lesson is marked", async () => {
    route(core({ glance: { ...core().glance, today: { lesson_time: "14:00", students: 2, marked: null } } }));
    await renderPage();
    expect(header().textContent).toContain("Today 14:00 · not marked yet");
    act(() => root.unmount());
    root = createRoot(host);
    route(core({ glance: { ...core().glance, today: { lesson_time: "14:00", students: 2, marked: { present: 1, late: 0, absent: 1, excused: 0 } } } }));
    await renderPage();
    expect(header().textContent).toContain("Today 14:00 · 2 of 2 students marked");
  });

  it("says a cancelled lesson is cancelled, with the reason, instead of counting marks", async () => {
    const change = { kind: "cancel" as const, reason: "Teacher ill", new_day: null, text: "Lesson cancelled: Teacher ill" };
    route(core({ glance: { ...core().glance, today: { lesson_time: "20:00-22:00", students: 4, marked: null, change } } }));
    await renderPage();
    expect(header().textContent).toContain("Lesson cancelled: Teacher ill");
    expect(header().textContent).not.toContain("marked");
    expect(header().textContent).not.toContain("Today");
  });

  it("marks the last lesson from the header for an admin, and not for a teacher", async () => {
    route(core());
    await renderPage();
    expect(button(header(), "Mark Wednesday’s lesson")).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    me = { role: "teacher", permissions: TEACHER_ME.permissions };
    route(core());
    await renderPage();
    expect([...header().querySelectorAll("button")].some((b) => b.textContent?.startsWith("Mark "))).toBe(false);
  });

  it("opens the classroom register itself in a sheet", async () => {
    route(core());
    await renderPage();
    act(() => button(header(), "Mark Wednesday’s lesson")!.click());
    await settle();
    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain("Mark Wednesday’s lesson");
    expect(get).toHaveBeenCalledWith("/classes/45/attendance/sessions/");
    expect(sheet.textContent).toContain("Aziz Tursunov");
  });

  it("offers SMS all to the desk, prefilled with this class", async () => {
    route(core());
    await renderPage();
    const link = [...header().querySelectorAll("a")].find((a) => a.textContent === "SMS all");
    expect(link?.getAttribute("href")).toBe("/ops/sms/campaigns/new?classroom=45");
    act(() => root.unmount());
    root = createRoot(host);
    me = { role: "teacher", permissions: TEACHER_ME.permissions };
    route(core());
    await renderPage();
    expect([...header().querySelectorAll("a")].some((a) => a.textContent === "SMS all")).toBe(false);
  });

  it("counts what the tabs hold on the tabs", async () => {
    route(core());
    await renderPage();
    const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(name))!;
    expect(tab("Attendance").textContent).toBe("Attendance64%");
    expect(tab("Homework").textContent).toBe("Homework3");
  });

  it("says Full when the class has no seat left", async () => {
    route(core({ max_students: 2 }));
    await renderPage();
    expect(header().textContent).toContain("Full");
  });
});

describe("the roster", () => {
  const aside = () => host.querySelector('aside[aria-label="Students"]') as HTMLElement;

  it("numbers each student with a dot, their phone and what they owe, signed", async () => {
    route(core());
    await renderPage();
    const rows = [...aside().querySelectorAll('[data-testid="roster-row"]')];
    expect(rows.map((r) => r.querySelector('[role="img"]')?.getAttribute("aria-label"))).toEqual(["Owes", "Active"]);
    expect(rows[0].textContent).toContain("+998 93 518 20 46");
    expect(rows[0].textContent).toContain("−250 000");
    expect(aside().querySelector('a[href="/ops/students/7"]')?.textContent).toBe("Aziz Tursunov");
    expect(aside().querySelector('a[href="/ops/public/8"]')?.textContent).toBe("Public Person");
    expect(aside().textContent).toContain("Owes1");
  });

  it("hides the debt from a viewer without view_money", async () => {
    me = { role: "admin", permissions: ADMIN_ME.permissions.filter((p) => p !== "view_money") };
    route(core());
    await renderPage();
    expect(aside().textContent).not.toContain("250 000");
    expect(aside().textContent).not.toContain("Owes");
  });

  it("sorts Z to A and back", async () => {
    route(core());
    await renderPage();
    act(() => (aside().querySelector('[aria-label="Sort Z to A"]') as HTMLButtonElement).click());
    const names = [...aside().querySelectorAll('[data-testid="roster-row"] a')].map((a) => a.textContent);
    expect(names).toEqual(["Public Person", "Aziz Tursunov"]);
  });
});

describe("the register grid", () => {
  it("draws the month's lessons by student, each cell its mark", async () => {
    route(core());
    await renderPage();
    const grid = box("Register")!;
    const heads = [...grid.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Student", "2 Nov", "16 Nov", "20 Nov"]);
    const cells = (name: string) =>
      [...[...grid.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!.querySelectorAll('[role="img"]')].map((c) =>
        c.getAttribute("aria-label"),
      );
    expect(cells("Aziz")).toEqual(["Came", "Excused", "Not marked yet"]);
    // Joined on 9 Nov: the 2nd was before them; frozen since: the rest is frozen.
    expect(cells("Public")).toEqual(["Not in the group yet", "Frozen", "Frozen"]);
  });

  it("asks for another month", async () => {
    route(core());
    await renderPage();
    const october = [...box("Register")!.querySelectorAll('[role="radio"]')].find((r) => r.textContent === "Oct") as HTMLElement;
    act(() => october.click());
    await settle();
    expect(get).toHaveBeenCalledWith("/classes/admin/classrooms/45/register/", { params: { month: "2026-10" } });
  });

  it("says a failed load failed, with a retry", async () => {
    route(core());
    const base = get.getMockImplementation()!;
    get.mockImplementation((url: string, config?: unknown) =>
      url === "/classes/admin/classrooms/45/register/" ? Promise.reject(new Error("down")) : base(url, config),
    );
    await renderPage();
    const grid = box("Register")!;
    expect(grid.textContent).toContain("Could not load the register.");
    expect(button(grid, "Retry")).toBeDefined();
  });
});

describe("the tabs", () => {
  it("open on Attendance, and fetch a part only when its tab opens", async () => {
    route(core());
    await renderPage();
    expect(partCalls().sort()).toEqual([
      "/classes/admin/classrooms/45/attendance/",
      "/classes/admin/classrooms/45/register/",
      "/classes/admin/classrooms/45/roster/",
    ]);
    act(() => root.unmount());
    root = createRoot(host);
    get.mockClear();
    await renderPage("tab=homework");
    expect(partCalls().sort()).toEqual(["/classes/admin/classrooms/45/homework/", "/classes/admin/classrooms/45/roster/"]);
  });

  it("are lc-up's, then Details; the old Overview opens Details", async () => {
    route(core());
    await renderPage("tab=overview");
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.replace(/\d+%?$/, ""));
    expect(tabs).toEqual(["Attendance", "Homework", "Rating", "History", "Notes", "Telegram", "Staff", "Details"]);
    expect(box("Details")).not.toBeNull();
  });

  it("rank the students on Rating by attendance, and say the marks rating is not kept", async () => {
    route(core());
    await renderPage("tab=rating");
    const rating = box("Rating")!;
    expect(rating.textContent).toContain("Marks are not kept in this system yet");
    expect([...rating.querySelectorAll("tbody tr")].map((tr) => tr.children[1].textContent)).toEqual(["Aziz Tursunov", "Public Person"]);
  });

  it("say Notes are not kept", async () => {
    route(core());
    await renderPage("tab=notes");
    expect(host.querySelector('[data-testid="not-kept"]')?.textContent).toBe("Notes on a group are not kept in this system yet.");
  });

  it("colour a homework's share only once it is due", async () => {
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const earlier = new Date(Date.now() - 3 * 86_400_000).toISOString();
    PARTS.homework = {
      assignments: [
        { id: 1, title: "Not due yet", due_at: later, turned_in: 1, students: 7 },
        { id: 2, title: "Past due", due_at: earlier, turned_in: 1, students: 7 },
      ],
    };
    try {
      route(core());
      await renderPage("tab=homework");
      const cell = (title: string) =>
        [...box("Homework")!.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(title))!.lastElementChild!;
      expect(cell("Not due yet").className).not.toContain("text-ms-critical-fg");
      expect(cell("Past due").className).toContain("text-ms-critical-fg");
    } finally {
      PARTS.homework = { assignments: [] };
    }
  });

  it("open in the address and keep the list it came from", async () => {
    route(core());
    await renderPage("_changelist_filters=q%3D301");
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === "History")!;
    act(() => tab.click());
    expect(replace).toHaveBeenCalledWith("/ops/classrooms/45?_changelist_filters=q%3D301&tab=history", { scroll: false });
  });

  it("on a phone, put the roster in a Students tab after the Register", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 767px"), media: query, addEventListener: () => {}, removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      route(core());
      await renderPage("tab=students");
      const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.replace(/\d+%?$/, ""));
      expect(tabs.slice(0, 4)).toEqual(["Register", "Students", "Homework", "History"]);
      expect(host.querySelector('aside[aria-label="Students"]')).toBeNull();
      expect(box("Students")!.querySelector('a[href="/ops/students/7"]')?.textContent).toBe("Aziz Tursunov");
    } finally {
      window.matchMedia = original;
    }
  });

  it("say a missing class does not exist", async () => {
    get.mockImplementation(() => Promise.reject({ response: { status: 404 } }));
    await renderPage();
    expect(host.textContent).toContain("This class does not exist.");
  });
});
