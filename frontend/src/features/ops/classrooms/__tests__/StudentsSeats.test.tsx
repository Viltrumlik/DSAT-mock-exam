/**
 * The class page's Students once lc-up is off: a badge per seat, the actions that fit it, each asking for a date
 * with today as the default and showing the server's reason. While lc-up runs none of it is offered.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomCore, ClassroomRoster } from "../classroomsApi";

const get = vi.fn();
const post = vi.fn();
const toast = vi.fn();
const classes = { addMember: vi.fn(), removeMember: vi.fn() };

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  classesApi: classes,
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/ops/classrooms/45",
}));

const { StudentsSection } = await import("../sections/StudentsSection");
const { todayIso } = await import("../seatsApi");

const ROOM = {
  id: 45, name: "Junior G1", lcup: null, seats_open: true, monthly_price: 500_000,
} as unknown as ClassroomCore;

const row = (id: number, name: string, seat_status: "active" | "trial" | "frozen") => ({
  id, name, username: name, avatar_url: null, section: "students" as const, joined_at: null, seat_status,
  seat_start_date: "2026-10-12", owes: null, attendance_rate: null, homework_rate: null,
});
const ROSTER: ClassroomRoster = {
  students: [row(1, "Ali Trial", "trial"), row(2, "Vali Active", "active"), row(3, "Sara Frozen", "frozen")],
  left: [{ id: 4, name: "Olim Left", section: "public", seat_left_on: "2026-10-05" }],
};

let host: HTMLElement;
let root: Root;
const onChanged = vi.fn();

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function route({ roster = ROSTER as unknown, rooms = true }: { roster?: unknown; rooms?: boolean } = {}) {
  get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === "/classes/admin/classrooms/45/roster/") {
      return roster instanceof Error ? Promise.reject(roster) : Promise.resolve({ data: roster });
    }
    if (url === "/classes/admin/classrooms/") {
      if (!rooms) return Promise.reject(new Error("down"));
      return Promise.resolve({
        data: { results: [{ id: 45, name: "Junior G1" }, { id: 46, name: "Middle G2" }], pages: 1, page: 1 },
      });
    }
    if (url === "/users/admin/people/") {
      const section = config?.params?.section;
      const results =
        section === "students"
          ? [{ id: 9, name: "New Friend", username: "nf", groups: [], avatar_url: null }]
          : [{ id: 10, name: "Back Again", username: "ba", avatar_url: null }];
      return Promise.resolve({ data: { results } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function mount(room: ClassroomCore = ROOM) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <StudentsSection room={room} onChanged={onChanged} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const buttonsIn = (el: Element) => Array.from(el.querySelectorAll("button")).map((b) => b.textContent?.trim());
const rowOf = (name: string) => Array.from(host.querySelectorAll("tr")).find((tr) => tr.textContent?.includes(name))!;
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const button = (el: Element, label: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const dateInput = () => dialog()!.querySelector('input[type="date"]') as HTMLInputElement;
const menu = () => document.body.querySelector('[role="menu"]') as HTMLElement | null;
const more = (name: string) => rowOf(name).querySelector(`button[aria-label="More actions for ${name}"]`) as HTMLButtonElement | null;

async function click(el: HTMLElement | undefined) {
  await act(async () => {
    el!.click();
  });
  await settle();
}

/** An action on a row: its own button, or the one behind its menu. */
async function choose(name: string, label: string) {
  const direct = button(rowOf(name), label);
  if (direct) return click(direct);
  await click(more(name)!);
  await click(button(menu()!, label));
}

/** Everything a row offers, the menu's items after the button. */
async function offered(name: string) {
  const own = buttonsIn(rowOf(name)).filter(Boolean);
  await click(more(name)!);
  const inside = buttonsIn(menu()!);
  await click(more(name)!);
  return [...own, ...inside];
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  post.mockReset();
  toast.mockReset();
  onChanged.mockReset();
  classes.addMember.mockReset();
  classes.removeMember.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("while lc-up runs", () => {
  it("a class that follows it offers none of this", async () => {
    route();
    await mount({ ...ROOM, seats_open: false, lcup: { managed: true, group_name: "G1", status: "confirmed", locked_fields: [] } });
    expect(host.textContent).toContain("Students come from lc-up");
    expect(button(host, "New student")).toBeUndefined();
    for (const label of ["Activate", "Freeze", "Return", "Move", "Leave", "Fix date"]) {
      expect(button(host, label)).toBeUndefined();
    }
  });

  it("any other class keeps the old add and remove, with no money", async () => {
    route();
    await mount({ ...ROOM, seats_open: false });
    expect(button(host, "New student")).toBeUndefined();
    expect(button(rowOf("Vali Active"), "Remove")).toBeDefined();
    expect(button(rowOf("Vali Active"), "Freeze")).toBeUndefined();
  });

  it("still shows the badges", async () => {
    route();
    await mount({ ...ROOM, seats_open: false });
    expect(rowOf("Ali Trial").textContent).toContain("Trial");
    expect(rowOf("Sara Frozen").textContent).toContain("Frozen");
  });
});

describe("once lc-up is off", () => {
  it("offers on each row the actions that fit its seat", async () => {
    route();
    await mount();
    expect(await offered("Ali Trial")).toEqual(["Activate", "Move", "Leave", "Fix date"]);
    expect(await offered("Vali Active")).toEqual(["Freeze", "Move", "Leave", "Fix date"]);
    expect(await offered("Sara Frozen")).toEqual(["Return", "Leave", "Fix date"]);
  });

  it("keeps one action on the row, and the rest out of the table that would cut them off", async () => {
    route();
    await mount();
    expect(buttonsIn(rowOf("Vali Active")).filter(Boolean)).toEqual(["Freeze"]);
    await click(more("Vali Active")!);
    expect(menu()).not.toBeNull();
    expect(host.contains(menu())).toBe(false);
  });

  it("closes the menu once an action in it is chosen", async () => {
    route();
    await mount();
    await choose("Vali Active", "Leave");
    expect(menu()).toBeNull();
    expect(dialog()!.textContent).toContain("Vali Active leaves this group?");
  });

  it("names the student in full for when the row cuts the name short", async () => {
    route();
    await mount();
    expect(rowOf("Vali Active").querySelector("a")!.getAttribute("title")).toBe("Vali Active");
  });

  it("asks for a date with today as the default and sends it", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    await click(button(rowOf("Vali Active"), "Freeze"));
    expect(dialog()!.textContent).toContain("Freeze Vali Active?");
    expect(dateInput().value).toBe(todayIso());
    await click(button(dialog()!, "Freeze"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/2/freeze/", { date: todayIso() });
    expect(dialog()).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("sends the date the admin chose", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    await click(button(rowOf("Ali Trial"), "Activate"));
    setValue(dateInput(), "2026-10-21");
    await click(button(dialog()!, "Activate"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/1/activate/", { date: "2026-10-21" });
  });

  it.each([
    ["Return", "Sara Frozen", "return", 3],
    ["Leave", "Vali Active", "leave", 2],
  ])("%s goes to its own endpoint", async (label, name, action, id) => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    await choose(name, label);
    await click(button(dialog()!, label));
    expect(post).toHaveBeenCalledWith(`/classes/admin/classrooms/45/seats/${id}/${action}/`, { date: todayIso() });
  });

  it("speaks of money when a paying seat leaves", async () => {
    route();
    await mount();
    await choose("Vali Active", "Leave");
    expect(dialog()!.textContent).toContain("goes back to their balance");
  });

  it.each(["Leave", "Fix date"])("speaks of no money when a trial seat chooses %s", async (label) => {
    route();
    await mount();
    await choose("Ali Trial", label);
    expect(dialog()!.textContent).toContain("A trial costs nothing");
    expect(dialog()!.textContent).not.toContain("balance");
    expect(dialog()!.textContent).not.toContain("voided");
  });

  it("starts Fix date from the date being fixed", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    await choose("Vali Active", "Fix date");
    expect(dateInput().value).toBe("2026-10-12");
    setValue(dateInput(), "2026-10-14");
    await click(button(dialog()!, "Fix date"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/2/fix-date/", { date: "2026-10-14" });
  });

  it("shows the server's reason and stays open", async () => {
    route();
    post.mockRejectedValue({ response: { data: { detail: "Junior G1 has no monthly price." } } });
    await mount();
    await click(button(rowOf("Ali Trial"), "Activate"));
    await click(button(dialog()!, "Activate"));
    expect(dialog()!.textContent).toContain("Junior G1 has no monthly price.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("moves to a group chosen from the others", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    await choose("Vali Active", "Move");
    const select = dialog()!.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["— Choose a group —", "Middle G2"]);
    setValue(select, "46");
    await click(button(dialog()!, "Move"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/2/move/", { date: todayIso(), to_classroom: 46 });
  });

  it("says so with a retry when the groups cannot be read", async () => {
    route({ rooms: false });
    await mount();
    await choose("Vali Active", "Move");
    expect(dialog()!.textContent).toContain("Could not load the groups.");
    route();
    await click(button(dialog()!, "Retry"));
    expect(dialog()!.querySelector("select")).not.toBeNull();
  });

  it("adds a student found by search, asking trial or active and the date", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    setValue(host.querySelector('input[placeholder^="Search"]') as HTMLInputElement, "fr");
    await settle();
    await click(button(host, "Add"));
    const status = dialog()!.querySelector("select") as HTMLSelectElement;
    expect(status.value).toBe("trial");
    setValue(status, "active");
    setValue(dateInput(), "2026-10-21");
    await click(button(dialog()!, "Add to group"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/", { user_id: 9, status: "active", date: "2026-10-21" });
    expect(classes.addMember).not.toHaveBeenCalled();
  });

  it("finds someone coming back among the public accounts too", async () => {
    route();
    await mount();
    setValue(host.querySelector('input[placeholder^="Search"]') as HTMLInputElement, "ba");
    await settle();
    expect(host.textContent).toContain("Back Again");
  });

  it("lets a leaving date typed wrong be fixed", async () => {
    route();
    post.mockResolvedValue({ data: {} });
    await mount();
    expect(host.textContent).toContain("Olim Left");
    await click(button(rowOf("Olim Left"), "Fix date"));
    expect(dateInput().value).toBe("2026-10-05");
    setValue(dateInput(), "2026-10-07");
    await click(button(dialog()!, "Fix date"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/4/fix-date/", { date: "2026-10-07" });
  });
});

describe("a new student", () => {
  async function fill() {
    await click(button(host, "New student"));
    const by = (id: string) => dialog()!.querySelector(`#${id}`) as HTMLInputElement;
    setValue(by("new-student-name"), "Karimova Malika");
    setValue(by("new-student-phone"), "90 555 00 11");
    setValue(by("new-student-parent"), "Karim");
    setValue(by("new-student-parent-phone"), "90 777 77 77");
    setValue(dialog()!.querySelector("select") as HTMLSelectElement, "active");
    setValue(by("new-student-date"), "2026-10-21");
  }

  it("sends what the admin entered and says how they first sign in", async () => {
    route();
    post.mockResolvedValue({ data: { login: { phone: "998905550011", code: "0011" } } });
    await mount();
    await fill();
    await click(button(dialog()!, "Create student"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/seats/new-student/", {
      full_name: "Karimova Malika", phone: "90 555 00 11", parent_name: "Karim", parent_phone: "90 777 77 77",
      status: "active", date: "2026-10-21",
    });
    expect(onChanged).toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("0011");
  });

  it("shows whose phone it is and can add that person instead", async () => {
    route();
    post.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          detail: "This phone is on Sara Karimova's account. Add them to this group, or type a different phone for a sibling.",
          code: "phone_taken",
          account: { id: 12, name: "Sara Karimova", section: "students", groups: ["Middle G2"], can_add: true },
        },
      },
    });
    post.mockResolvedValueOnce({ data: {} });
    await mount();
    await fill();
    await click(button(dialog()!, "Create student"));
    expect(dialog()!.textContent).toContain("type a different phone for a sibling");
    expect(dialog()!.textContent).toContain("Middle G2");
    expect(dialog()!.querySelector('a[href="/ops/students/12"]')).not.toBeNull();
    await click(button(dialog()!, "Add Sara Karimova to this group"));
    expect(post).toHaveBeenLastCalledWith("/classes/admin/classrooms/45/seats/", { user_id: 12, status: "active", date: "2026-10-21" });
    expect(dialog()).toBeNull();
  });

  it("offers no add for an account that cannot simply be added", async () => {
    route();
    post.mockRejectedValue({
      response: {
        status: 409,
        data: { detail: "Type a different phone.", code: "phone_taken", account: { id: 13, name: "Pub", section: "public", groups: [], can_add: false } },
      },
    });
    await mount();
    await fill();
    await click(button(dialog()!, "Create student"));
    expect(dialog()!.textContent).toContain("Type a different phone.");
    expect(button(dialog()!, "Add Pub to this group")).toBeUndefined();
  });

  it("shows any other refusal in words", async () => {
    route();
    post.mockRejectedValue({ response: { status: 400, data: { detail: "That is not an Uzbek phone number." } } });
    await mount();
    await fill();
    await click(button(dialog()!, "Create student"));
    expect(dialog()!.textContent).toContain("That is not an Uzbek phone number.");
  });
});

describe("a failed read", () => {
  it("is an error with a retry, never an empty class", async () => {
    route({ roster: new Error("down") });
    await mount();
    expect(host.textContent).toContain("Could not load.");
    expect(host.textContent).not.toContain("Nothing");
    route();
    await click(button(host, "Retry"));
    expect(host.textContent).toContain("Vali Active");
  });

  it("offers a retry on the student search", async () => {
    route();
    get.mockImplementation((url: string) =>
      url === "/users/admin/people/" ? Promise.reject(new Error("down")) : Promise.resolve({ data: ROSTER }),
    );
    await mount();
    setValue(host.querySelector('input[placeholder^="Search"]') as HTMLInputElement, "fr");
    await settle();
    expect(host.textContent).toContain("Could not search.");
    expect(button(host, "Retry")).toBeDefined();
  });
});
