/**
 * /ops/trials shows two lists. The first is lc-up's trial students, neediest first (the server
 * orders them). The second is lc-up members no class list shows, each with why. Read-only:
 * activation happens in lc-up.
 */
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { NotOnListPanel, TrialStudentsPanel } = await import("../LcupPanels");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const ROOM = { id: 12, name: "Middle G23" };
const FOLLOWUPS = {
  free_trial_lessons: 1,
  pending: 3,
  trials: [
    { membership_id: 1, name: "Sardor Nazarov", student: { id: 41, name: "Sardor Nazarov", username: "sn", phone: null },
      classroom: ROOM, teachers: ["Tess Teacher"], since: "2026-10-12", lessons: 2,
      first_lesson: "2026-10-12", last_lesson: "2026-10-14", state: "used" },
    { membership_id: 2, name: "Ali Valiyev", student: null, classroom: ROOM, teachers: [], since: "2026-10-16",
      lessons: 1, first_lesson: "2026-10-16", last_lesson: "2026-10-16", state: "came" },
    { membership_id: 3, name: "Not Yet", student: null, classroom: ROOM, teachers: [], since: null,
      lessons: 0, first_lesson: null, last_lesson: null, state: "not_yet" },
  ],
  not_on_list: [
    { lcup_student_id: 9001, name: "Jasur Toshmatov", phone: "998901234567", student: null, classroom: ROOM,
      teachers: ["Tess Teacher"], lcup_status: "trial", since: "2026-10-19", reason: "needs_review",
      reason_text: "Their account match waits for review in lc-up → Students." },
  ],
};

async function mount(node: ReactNode, data: object = FOLLOWUPS) {
  get.mockImplementation(async (url: string) => {
    if (url === "/lcup/followups/") return { data };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  for (let tick = 0; tick < 50 && (host.textContent ?? "").includes("Loading"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("/ops/trials panels", () => {
  it("lists trial students in the server's order with their state", async () => {
    await mount(<TrialStudentsPanel />);
    const rows = Array.from(host.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Sardor Nazarov");
    expect(rows[0]).toContain("Came after the free lesson");
    expect(rows[1]).toContain("Came to trial (2026-10-16)");
    expect(rows[2]).toContain("Not come yet");
    expect(host.querySelector<HTMLAnchorElement>('a[href="/ops/students/41"]')?.textContent).toBe("Sardor Nazarov");
  });

  it("says so when nobody is on trial", async () => {
    await mount(<TrialStudentsPanel />, { ...FOLLOWUPS, trials: [] });
    expect(host.textContent).toContain("No one is on trial in lc-up right now.");
  });

  it("lists members missing from a class list with why, and points review cases at lc-up", async () => {
    await mount(<NotOnListPanel />);
    expect(host.textContent).toContain("Jasur Toshmatov");
    expect(host.textContent).toContain("Their account match waits for review in lc-up → Students.");
    expect(host.querySelector('a[href="/ops/lcup"]')).not.toBeNull();
  });

  it("says so when every member is on a list", async () => {
    await mount(<NotOnListPanel />, { ...FOLLOWUPS, not_on_list: [] });
    expect(host.textContent).toContain("Every lc-up member of a paired group is on their class list.");
  });
});
