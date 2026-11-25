/**
 * A lesson day cancelled or moved from the group page's register grid (owner, 2026-11-25): a "⋯" on a day only for
 * whoever holds manage_lessons, a struck-through cancelled column, where a moved lesson went or came from, and dialogs
 * that post the day and the reason, then say what the money did.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomRegister } from "../classroomsApi";

const get = vi.fn();
const post = vi.fn();
let me: Record<string, unknown> | null = null;

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));

const { RegisterGrid } = await import("../sections/RegisterGrid");

const REGISTER: ClassroomRegister = {
  month: "2026-12",
  months: ["2026-12"],
  today: "2026-12-09",
  dates: [
    { date: "2026-12-07", held: true, change: null },
    { date: "2026-12-09", held: false, change: { id: 11, kind: "cancel", reason: "Teacher ill", holiday: false } },
    { date: "2026-12-11", held: false, change: { id: 12, kind: "move", reason: "Room taken", holiday: false, new_day: "2026-12-12" } },
    { date: "2026-12-12", held: false, change: { id: 12, kind: "move", reason: "Room taken", holiday: false, from_day: "2026-12-11" } },
    { date: "2026-12-14", held: false, change: { id: 13, kind: "cancel", reason: "Independence Day", holiday: true } },
    { date: "2026-12-16", held: false, change: null },
  ],
  students: [
    {
      id: 1, name: "Ali Valiyev", section: "students", joined: "2026-11-01", seat_status: "active", frozen_on: null,
      left: false, marks: { "2026-12-07": "PRESENT" },
    },
  ],
};

const MONEY = { voided: 2, students: 2, amount: 77_000, unfrozen: 0 };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === "/classes/admin/classrooms/45/register/") return Promise.resolve({ data: REGISTER });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  me = { permissions: ["view_people", "manage_lessons"] };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RegisterGrid roomId={45} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function click(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dayMenu = (day: string) => host.querySelector(`button[aria-label="Change the lesson of ${day}"]`);
const menuItems = () => [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
const item = (label: string) => [...document.body.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === label);
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const button = (label: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label);
const head = (day: string) => [...host.querySelectorAll("thead th")].find((th) => th.textContent?.startsWith(day)) as HTMLElement;

describe("Register grid — lesson changes", () => {
  it("offers no day menu without manage_lessons", async () => {
    me = { permissions: ["view_people", "manage_groups"] };
    await mount();
    expect(host.querySelectorAll('button[aria-label^="Change the lesson of"]').length).toBe(0);
  });

  it("offers Cancel and Move on a day as the timetable has it, Undo on a changed one, nothing on a centre holiday", async () => {
    await mount();
    const days = [...host.querySelectorAll('button[aria-label^="Change the lesson of"]')].map((b) => b.getAttribute("aria-label"));
    expect(days).toEqual(["7 Dec", "9 Dec", "11 Dec", "12 Dec", "16 Dec"].map((d) => `Change the lesson of ${d}`));
    await click(dayMenu("7 Dec"));
    expect(menuItems()).toEqual(["Cancel lesson…", "Move lesson…"]);
  });

  it("offers Undo on a changed day", async () => {
    await mount();
    await click(dayMenu("9 Dec"));
    expect(menuItems()).toEqual(["Undo"]);
  });

  it("strikes a cancelled column through and says where a moved lesson went and came from", async () => {
    await mount();
    const struck = (day: string) => head(day).querySelector(".line-through")?.textContent;
    expect(struck("9 Dec")).toBe("9 Dec");
    expect(head("9 Dec").textContent).toContain("Cancelled: Teacher ill");
    expect(head("9 Dec").querySelector("[title]")?.getAttribute("title")).toBe("Cancelled: Teacher ill");
    expect(struck("11 Dec")).toBeUndefined();
    expect(head("11 Dec").textContent).toContain("Moved to 12 Dec");
    expect(head("12 Dec").textContent).toContain("Moved from 11 Dec");
    expect(struck("14 Dec")).toBe("14 Dec");
    expect(head("14 Dec").textContent).toContain("Cancelled: Independence Day");
    // Nobody had a lesson on a day off; the lesson moved in is there to be marked.
    const cells = [...host.querySelectorAll("tbody td span[role='img']")].map((c) => c.getAttribute("title"));
    expect(cells).toEqual(["Came", "No lesson", "No lesson", "Not marked yet", "No lesson", "Not marked yet"]);
  });

  it("cancels a lesson with a reason, then says what came back", async () => {
    post.mockResolvedValue({ data: { change: { id: 21 }, money: MONEY } });
    await mount();
    await click(dayMenu("7 Dec"));
    await click(item("Cancel lesson…"));
    expect(dialog()?.textContent).toContain("Cancel the lesson of 7 Dec?");
    await click(button("Cancel lesson"));
    expect(dialog()?.textContent).toContain("A lesson change needs a reason.");
    expect(post).not.toHaveBeenCalled();
    setValue(dialog()!.querySelector("textarea")!, "Teacher ill");
    await click(button("Cancel lesson"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/lessons/cancel/", { day: "2026-12-07", reason: "Teacher ill" });
    expect(dialog()?.textContent).toContain("Given back to 2 students: 77 000 so'm");
    get.mockClear();
    await click(button("Done"));
    expect(dialog()).toBeNull();
    expect(get).toHaveBeenCalledWith("/classes/admin/classrooms/45/register/", expect.anything());
  });

  it("says so when nothing had been charged", async () => {
    post.mockResolvedValue({ data: { change: { id: 21 }, money: { voided: 0, students: 0, amount: 0, unfrozen: 0 } } });
    await mount();
    await click(dayMenu("16 Dec"));
    await click(item("Cancel lesson…"));
    setValue(dialog()!.querySelector("textarea")!, "Teacher ill");
    await click(button("Cancel lesson"));
    expect(dialog()?.textContent).toContain("Nothing had been charged for it, so nothing is given back.");
  });

  it("moves a lesson to a new day, then says when it is charged", async () => {
    post.mockResolvedValue({ data: { change: { id: 22, new_day: "2026-12-17" }, money: MONEY } });
    await mount();
    await click(dayMenu("16 Dec"));
    await click(item("Move lesson…"));
    setValue(dialog()!.querySelector('input[type="date"]') as HTMLInputElement, "2026-12-17");
    setValue(dialog()!.querySelector("textarea")!, "Teacher at a seminar");
    await click(button("Move lesson"));
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/lessons/move/", {
      day: "2026-12-16", new_day: "2026-12-17", reason: "Teacher at a seminar",
    });
    expect(dialog()?.textContent).toContain("Charged on 17 Dec");
  });

  it("keeps the server's refusal on screen", async () => {
    post.mockRejectedValue({ response: { data: { detail: "Junior G1 already has a lesson on 9 Dec. Choose a day it does not meet." } } });
    await mount();
    await click(dayMenu("16 Dec"));
    await click(item("Move lesson…"));
    setValue(dialog()!.querySelector('input[type="date"]') as HTMLInputElement, "2026-12-09");
    setValue(dialog()!.querySelector("textarea")!, "r");
    await click(button("Move lesson"));
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Junior G1 already has a lesson on 9 Dec. Choose a day it does not meet.",
    );
  });

  it("undoes a change by its id", async () => {
    post.mockResolvedValue({ data: { change: { id: 12 }, money: MONEY } });
    await mount();
    await click(dayMenu("12 Dec"));
    await click(item("Undo"));
    expect(dialog()?.textContent).toContain("The lesson goes back to 11 Dec and is charged then, not on 12 Dec.");
    await click(button("Undo"));
    expect(post).toHaveBeenCalledWith("/classes/admin/lesson-changes/12/undo/", {});
    expect(dialog()).toBeNull();
  });
});
