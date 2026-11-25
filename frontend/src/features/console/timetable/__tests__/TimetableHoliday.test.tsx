/**
 * The timetable's lesson changes (owner, 2026-11-25): "Holiday…" for whoever holds manage_lessons, a dialog that posts
 * the day and the reason and says what came back, and a ruled "Lesson changes" list of every live change from a month
 * back to two months ahead (centre holidays first, then by day, as the server orders them), each with Undo.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LessonChangeList } from "@/features/ops/classrooms/lessonChangesApi";
import type { LessonsToday } from "../../lessonsToday";

const get = vi.fn();
const post = vi.fn();
let me: Record<string, unknown> | null = null;

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));

const { TimetablePage } = await import("../TimetablePage");

const DAY: LessonsToday = {
  date: "2026-11-18",
  lessons: [],
  counts: { lessons: 0, now: 0, not_marked: 0, no_teacher: 0 },
  changes: [],
};

const LIST: LessonChangeList = {
  from: "2026-10-18",
  to: "2027-01-17",
  changes: [
    { id: 7, classroom_id: null, classroom: null, kind: "cancel", reason: "Independence Day", day: "2026-11-18", new_day: null },
    { id: 8, classroom_id: 45, classroom: "Junior G1", kind: "move", reason: "Room taken", day: "2026-11-17", new_day: "2026-11-19" },
    { id: 9, classroom_id: 46, classroom: "Middle G2", kind: "cancel", reason: "Teacher ill", day: "2026-12-04", new_day: null },
  ],
};

const NONE = { voided: 0, students: 0, amount: 0, charged: 0, charged_amount: 0, unfrozen: 0 };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T15:10:00+05:00")); // a Wednesday
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === "/classes/admin/lessons/today/") return Promise.resolve({ data: DAY });
    if (url === "/classes/admin/lesson-changes/") return Promise.resolve({ data: LIST });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  me = { permissions: ["view_people", "manage_lessons"] };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
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
        <TimetablePage />
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

const byText = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
const list = () => host.querySelector('section[aria-label="Lesson changes"]') as HTMLElement;
const rows = () =>
  [...list().querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim()));

describe("Timetable — lesson changes", () => {
  it("lists every live change of the window as the server orders it, each with Undo", async () => {
    await mount();
    expect(get).toHaveBeenCalledWith("/classes/admin/lesson-changes/");
    expect(rows()).toEqual([
      ["18 Nov", "Centre holiday", "Cancelled", "Independence Day", "Undo"],
      ["17 Nov", "Junior G1", "Moved to 19 Nov", "Room taken", "Undo"],
      ["4 Dec", "Middle G2", "Cancelled", "Teacher ill", "Undo"],
    ]);
  });

  it("offers neither Holiday nor Undo without manage_lessons", async () => {
    me = { permissions: ["view_people"] };
    await mount();
    expect(byText(host, "Holiday…")).toBeUndefined();
    expect(rows()[0]).toEqual(["18 Nov", "Centre holiday", "Cancelled", "Independence Day"]);
  });

  it("says so when no lesson is changed", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url === "/classes/admin/lesson-changes/" ? { ...LIST, changes: [] } : DAY }),
    );
    await mount();
    expect(list().textContent).toContain("No lesson is cancelled or moved from 18 Oct to 17 Jan.");
  });

  it("sets a centre holiday on the shown day with a reason, then says what came back", async () => {
    post.mockResolvedValue({ data: { change: { id: 9 }, money: { ...NONE, voided: 1, students: 1, amount: 38_500, unfrozen: 1 } } });
    await mount();
    await click(byText(host, "Holiday…"));
    expect((dialog()!.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-18");
    const reason = dialog()!.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Teachers' day");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText(dialog()!, "Set holiday"));
    expect(post).toHaveBeenCalledWith("/classes/admin/lessons/holiday/", { day: "2026-11-18", reason: "Teachers' day" });
    expect(dialog()?.textContent).toContain("Given back to 1 student: 38 500 so'm");
    get.mockClear();
    await click(byText(dialog()!, "Done"));
    expect(dialog()).toBeNull();
    expect(get).toHaveBeenCalledWith("/classes/admin/lesson-changes/");
  });

  it("undoes a centre holiday from the list, for every group", async () => {
    post.mockResolvedValue({ data: { change: { id: 7 }, money: { ...NONE, charged: 2, charged_amount: 77_000 } } });
    await mount();
    await click(byText(list().querySelector("tbody tr")!, "Undo"));
    expect(dialog()?.textContent).toContain("Every group's lesson on 18 Nov is held and charged again.");
    await click(byText(dialog()!, "Undo"));
    expect(post).toHaveBeenCalledWith("/classes/admin/lesson-changes/7/undo/", {});
    expect(dialog()?.textContent).toContain("Charged in all: 77 000 so'm.");
    await click(byText(dialog()!, "Done"));
    expect(dialog()).toBeNull();
  });
});
