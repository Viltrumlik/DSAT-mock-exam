/**
 * /teacher/classrooms — the class list, on the kit.
 *
 * Two things are worth a test here. The first is the one this product keeps getting wrong: a
 * request that FAILED must say so and offer the retry, and a teacher who genuinely has no class
 * yet must be told that in words. Neither may ever be drawn as the other, because "we could not
 * ask" and "you teach nothing" are answers about completely different things.
 *
 * The second is the row. This page exists to be left — a teacher opens it to get INTO a class —
 * so the name has to be a real link a keyboard can reach, and the day, time, room and head-count
 * beside it have to be the ones the endpoint actually sent. The fixtures therefore go through
 * `parseClassroomList`, the real contract parser: if it ever stops passing `lesson_time` or
 * `room_number` through, these tests fail here rather than the page quietly going blank.
 *
 * Every class below is invented. This repository is public.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { parseClassroomList } from "@/lib/criticalApiContract";

const list = vi.fn();

vi.mock("@/lib/api", () => ({ classesApi: { list: () => list() } }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick }: { href: string; children: ReactNode; onClick?: (e: unknown) => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

const { TeacherClassrooms } = await import("@/features/classroom/pages/TeacherClassrooms");

/** Three invented classes: a full one, one the office has not finished setting up, and a closed one. */
const CLASSES = [
  {
    id: 11, name: "Evening Math B", subject: "MATH", level: "senior", lesson_days: "ODD",
    lesson_time: "18:00", room_number: "204", join_code: "MTH11B", student_count: 14, is_active: true,
  },
  {
    id: 12, name: "Morning English A", subject: "ENGLISH", level: "", lesson_days: "EVEN",
    lesson_time: "", room_number: "", join_code: "ENG12A", student_count: 9, is_active: true,
  },
  {
    id: 13, name: "Spring English C", subject: "ENGLISH", level: "junior", lesson_days: "EVEN",
    lesson_time: "09:30", room_number: "101", join_code: "ENG13C", student_count: 0, is_active: false,
  },
];

/** Serve the list the way the app receives it — through the contract parser, not around it. */
function served(rows: typeof CLASSES) {
  list.mockImplementation(async () => parseClassroomList(rows, "GET /classes/"));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  list.mockReset();
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(settle = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TeacherClassrooms /></QueryClientProvider>);
  });
  if (settle) { await flush(); await flush(); }
}

const text = () => host.textContent ?? "";
const rows = () => [...host.querySelectorAll("tbody tr")];
const cells = (row: Element) => [...row.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());

describe("the class list — while it is loading", () => {
  it("shows neither classes nor a failure, only the placeholder", async () => {
    // A promise that never settles: the pending state, held still.
    list.mockReturnValue(new Promise(() => {}));
    await mount(false);

    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(text()).not.toContain("No classes yet");
    // The skeleton's own shape — five 40px bars. A bare `[aria-hidden="true"]` would be
    // satisfied by any decorative icon on the page and prove nothing about this state.
    const bars = [...host.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].filter(
      (d) => d.style.height === "40px",
    );
    expect(bars).toHaveLength(5);
  });
});

describe("the class list — when the request fails", () => {
  it("says the request failed, and offers the retry", async () => {
    list.mockRejectedValue(new Error("network"));
    await mount();

    expect(text()).toContain("Your classes didn't load");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain("Try again");
    // The whole point: a failure is never dressed up as a teacher with no classes.
    expect(text()).not.toContain("No classes yet");
    expect(host.querySelector("table")).toBeNull();
  });

  it("asks again when the retry is pressed", async () => {
    list.mockRejectedValue(new Error("network"));
    await mount();
    const before = list.mock.calls.length;

    const retry = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Try again"));
    expect(retry).toBeTruthy();
    await act(async () => { retry!.click(); });
    await flush();

    expect(list.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("the class list — when there is nothing to show", () => {
  it("says so in words, and does not raise an alarm", async () => {
    served([]);
    await mount();

    expect(text()).toContain("No classes yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("table")).toBeNull();
  });
});

describe("the class list — when classes come back", () => {
  it("puts the day, the time, the room and the head-count on the row", async () => {
    served(CLASSES);
    await mount();

    expect(rows()).toHaveLength(3);
    expect(cells(rows()[0])).toEqual(["Evening Math BSenior", "Math", "Mon, Wed, Fri", "18:00", "204", "14"]);
    expect(cells(rows()[2])[2]).toBe("Tue, Thu, Sat");
    expect(cells(rows()[2])[3]).toBe("09:30");
  });

  it("names a time and a room nobody has filled in, instead of leaving the cell blank", async () => {
    served(CLASSES);
    await mount();

    // Class 12 has neither. An empty cell reads as a broken table; "Not set" reads as
    // something the teacher can go and ask about, which is what it is.
    expect(cells(rows()[1])[3]).toBe("Not set");
    expect(cells(rows()[1])[4]).toBe("Not set");
  });

  it("marks the archived class, and only that one", async () => {
    served(CLASSES);
    await mount();

    expect(cells(rows()[2])[0]).toContain("Archived");
    expect(cells(rows()[0])[0]).not.toContain("Archived");
    expect(cells(rows()[1])[0]).not.toContain("Archived");
  });

  it("names each class with a real link, so a keyboard reaches it", async () => {
    served(CLASSES);
    await mount();

    const hrefs = [...host.querySelectorAll("tbody a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/teacher/classrooms/11",
      "/teacher/classrooms/12",
      "/teacher/classrooms/13",
    ]);
  });

  it("opens the class from its row as well", async () => {
    served(CLASSES);
    await mount();

    await act(async () => { (rows()[1] as HTMLElement).click(); });
    expect(push).toHaveBeenCalledWith("/teacher/classrooms/12");
  });

  it("keeps the row click from firing behind the link", async () => {
    served(CLASSES);
    await mount();

    // Both would go to the same class, but two navigations for one click leaves the teacher
    // pressing Back twice to get out of a class they opened once.
    const link = host.querySelector("tbody a");
    await act(async () => { (link as HTMLElement).click(); });
    expect(push).not.toHaveBeenCalled();
  });
});
