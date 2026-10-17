/**
 * /ops/classrooms/<id> — a class's change form in tabs. A class that follows lc-up shows lc-up's
 * fields locked and leaves them out of the save, offers no student add/remove, no teacher change,
 * no archive and no delete; its support teachers stay ours. Any other class is fully editable.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a) },
  classesApi: classes,
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
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
    schedule_summary: "",
    is_active: true,
    join_code: "ABC123",
    created_at: "2026-08-20T10:00:00+05:00",
    teacher: { id: 3, name: "Vali Aliyev" },
    tas: [{ id: 4, name: "Sardor TA" }],
    students: 2,
    lcup: { managed: true, group_name: "G21 Math", status: "confirmed", locked_fields: LOCKED },
    glance: { attendance_rate: 64, last_lesson: "2026-10-14", homework: { assignments: 3, handed_in: 4, expected: 6 }, owing: 1 },
    ...over,
  };
}

const UNPAIRED: Partial<ClassroomCore> = { lcup: null, name: "Own class" };

const PARTS: Record<string, unknown> = {
  roster: {
    students: [
      { id: 7, name: "Aziz Tursunov", username: "aziz", avatar_url: null, section: "students", joined_at: null, owes: 250000, attendance_rate: 50, homework_rate: 100 },
      { id: 8, name: "Public Person", username: "pub", avatar_url: null, section: "public", joined_at: null, owes: null, attendance_rate: null, homework_rate: null },
    ],
  },
  attendance: { sessions: [], rate: null },
  homework: { assignments: [] },
  history: { items: [], truncated: false },
  telegram: { configured: false, health: null, counts: { in_group: null, known: 0, managed: 0, frozen_in_group: 0 }, members: [] },
};

function route(room: ClassroomCore) {
  get.mockImplementation((url: string) => {
    if (url === "/classes/admin/classrooms/45/") return Promise.resolve({ data: room });
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a class that follows lc-up", () => {
  it("locks lc-up's fields and saves only ours", async () => {
    route(core());
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage();
    expect(host.querySelector("h1")?.textContent).toBe("Junior G21 Math");
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
    await renderPage();
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(box("Details")!.textContent).toContain("lc-up sets room number for this class.");
  });

  it("has no archive or delete — lc-up owns the class", async () => {
    route(core());
    await renderPage();
    expect(host.textContent).toContain("Managed in lc-up");
    expect(button(host, "Archive")).toBeUndefined();
    expect(host.querySelector('[aria-label="More actions"]')).toBeNull();
  });

  it("says in the form why lc-up's fields are locked", async () => {
    route(core());
    await renderPage();
    expect(box("Details")!.textContent).toContain("This class follows its lc-up group");
    // The group's name is said once, in the Summary, as plain text.
    expect(box("Summary")!.textContent).toContain("G21 Math");
  });

  it("offers no student add or remove", async () => {
    route(core());
    await renderPage("tab=students");
    const students = box("Students")!;
    expect(students.textContent).toContain("Students come from lc-up");
    expect(button(students, "Remove")).toBeUndefined();
    expect(students.querySelector('input[placeholder^="Search"]')).toBeNull();
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
    await renderPage("_changelist_filters=lcup%3Dunpaired");
    expect(control("Name").disabled).toBe(false);
    expect(box("Details")!.textContent).not.toContain("Set in lc-up");

    // Delete is the rare, destructive one: behind "More", not beside Archive.
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

  it("archives from the header", async () => {
    route(core(UNPAIRED));
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage();
    act(() => button(host, "Archive")!.click());
    await settle();
    expect(classes.governanceUpdate).toHaveBeenCalledWith(45, { is_active: false });
  });

  it("counts its support teachers in the header, not again in the Summary", async () => {
    route(core(UNPAIRED));
    await renderPage();
    const header = host.querySelector("h1")!.closest(".rounded-2xl") as HTMLElement;
    expect(header.textContent).toContain("Sardor TA");
    expect(box("Summary")!.textContent).not.toContain("Support teachers");
  });

  it("removes a student from the Students tab", async () => {
    route(core(UNPAIRED));
    classes.removeMember.mockResolvedValue(undefined);
    await renderPage("tab=students");
    const row = [...box("Students")!.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Aziz"))!;
    act(() => button(row, "Remove")!.click());
    await settle();
    expect(classes.removeMember).toHaveBeenCalledWith(45, 7);
  });
});

describe("the header", () => {
  /** The card holding the h1: the class's header. */
  const header = () => host.querySelector("h1")!.closest(".rounded-2xl") as HTMLElement;

  it("says where and when the class meets, and who teaches it", async () => {
    route(core());
    await renderPage();
    const text = header().textContent;
    expect(text).toContain("Odd days 14:00");
    expect(text).toContain("Room 301");
    expect(text).toContain("Chilonzor");
    expect(header().querySelector('a[href="/ops/staff/3"]')?.textContent).toBe("Vali Aliyev");
    expect(text).toContain("Synced from lc-up");
  });

  it("puts the class's figures on the Overview, in the colour of their verdict", async () => {
    route(core());
    await renderPage();
    const text = header().textContent;
    expect(text).toContain("64%"); // attendance, amber
    expect(text).toContain("67%"); // 4 of 6 handed in
    expect(text).toMatch(/Owe lc-up\s*1/);
    // The tile's value, not its icon square (which shares the colour and has no text).
    const owing = [...header().querySelectorAll(".text-danger")].map((el) => el.textContent).filter(Boolean);
    expect(owing).toEqual(["1"]);
  });

  it("leaves the figures off the other tabs", async () => {
    route(core());
    await renderPage("tab=history");
    expect(header().textContent).toContain("Junior G21 Math");
    expect(header().textContent).not.toContain("Attendance");
  });

  it("says Full when the class has no seat left", async () => {
    route(core({ max_students: 2 }));
    await renderPage();
    expect(header().textContent).toContain("Full");
  });
});

describe("the tabs", () => {
  it("fetch a part only when its tab opens", async () => {
    route(core());
    await renderPage();
    expect(partCalls()).toEqual([]);
    act(() => root.unmount());
    root = createRoot(host);
    get.mockClear();
    await renderPage("tab=students");
    expect(partCalls()).toEqual(["/classes/admin/classrooms/45/roster/"]);
  });

  it("link each student to their own list's page and show a debt in red", async () => {
    route(core());
    await renderPage("tab=students");
    const students = box("Students")!;
    expect(students.querySelector('a[href="/ops/students/7"]')?.textContent).toBe("Aziz Tursunov");
    expect(students.querySelector('a[href="/ops/public/8"]')?.textContent).toBe("Public Person");
    const owed = [...students.querySelectorAll(".text-danger")].map((el) => el.textContent).filter((t) => t?.endsWith("UZS"));
    // Once under the name (a phone's) and once in the Owes column (from sm up).
    expect(owed).toEqual(["owes 250,000 UZS", "250,000 UZS"]);
  });

  it("put a debt under the name for a phone, where the Owes column is hidden", async () => {
    route(core());
    await renderPage("tab=students");
    const row = [...box("Students")!.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Aziz"))!;
    const phoneDebt = row.querySelector("td span.sm\\:hidden");
    expect(phoneDebt?.textContent).toBe("owes 250,000 UZS");
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
      expect(cell("Not due yet").className).not.toContain("text-danger");
      expect(cell("Past due").className).toContain("text-danger");
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

  it("say a missing class does not exist", async () => {
    get.mockImplementation(() => Promise.reject({ response: { status: 404 } }));
    await renderPage();
    expect(host.textContent).toContain("This class does not exist.");
  });
});

describe("the Telegram chat id", () => {
  // Word for word what the server says (classes/serializers.py), so the field and a refusal agree.
  const MESSAGE = "Telegram chat id must be the number /chatid gave you (e.g. -1001234567890).";

  it("says at the field that a pasted id is not a number, and does not send it", async () => {
    route(core(UNPAIRED));
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage();
    const chat = control("Telegram chat id");
    expect(chat.getAttribute("aria-invalid")).toBeNull();

    // The 2026-10-17 paste: /chatid's answer with a stray letter on the end.
    typeInto(chat, "-1001234569860v");
    expect(chat.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(chat.getAttribute("aria-describedby")!)?.textContent).toBe(MESSAGE);
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(classes.governanceUpdate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chat);

    typeInto(chat, "  -1001234569860 ");
    expect(box("Details")!.textContent).not.toContain(MESSAGE);
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(classes.governanceUpdate.mock.calls[0][1]).toMatchObject({ telegram_chat_id: "-1001234569860" });
  });

  it("lets an emptied id through — the class has no group", async () => {
    route(core({ ...UNPAIRED, telegram_chat_id: "-1001234567890" }));
    classes.governanceUpdate.mockResolvedValue({});
    await renderPage();
    typeInto(control("Telegram chat id"), "   ");
    expect(box("Details")!.textContent).not.toContain(MESSAGE);
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(classes.governanceUpdate.mock.calls[0][1]).toMatchObject({ telegram_chat_id: "" });
  });

  it("still shows the server's word when it refuses one", async () => {
    route(core(UNPAIRED));
    classes.governanceUpdate.mockRejectedValue({ response: { data: { telegram_chat_id: ["That chat id is refused."] } } });
    await renderPage();
    typeInto(control("Telegram chat id"), "-1001234567890");
    act(() => button(box("Details")!, "Save")!.click());
    await settle();
    expect(box("Details")!.querySelector('[role="alert"]')?.textContent).toBe("That chat id is refused.");
  });
});
