/**
 * Delete in the teaching team's row menu, on the Assignments tab and the Classwork tab.
 *
 * Only an owner or a teacher can delete set work. A TA archives it instead: the API refuses a TA's delete
 * with 403 "Only a teacher or owner can delete assignments (TAs can archive).". The menu offered a TA Delete
 * on every row anyway, live and archived, and every click ended in that error.
 *
 * Archived rows keep Edit and Delete for everyone else on the team: by id, the API finds archived work.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole } from "../types";

const get = vi.fn();
const listAssignments = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    listAssignments: (...args: unknown[]) => listAssignments(...args),
    deleteAssignment: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/classrooms/34",
  useRouter: () => ({ push: vi.fn() }),
}));

const { Assignments } = await import("../pages/Assignments");
const { Classwork } = await import("../pages/Classwork");

type Tab = "Assignments" | "Classwork";

/** A row of `GET /api/classes/34/assignments/` as the teaching team receives it. */
function row(id: number, title: string, category: "HOMEWORK" | "CLASSWORK", status: "PUBLISHED" | "ARCHIVED") {
  return {
    id,
    title,
    category,
    status,
    created_at: "2026-09-09T19:00:00+05:00",
    published_at: "2026-09-09T19:00:00+05:00",
    assigned_at: "2026-09-09T19:00:00+05:00",
    due_at: null,
    submissions_count: 0,
    contents: [],
    vocab_homeworks: [],
    classwork_award: null,
  };
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  listAssignments.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** One live row and one archived row, served the way each tab asks for them. */
function serve(tab: Tab) {
  const category = tab === "Assignments" ? "HOMEWORK" : "CLASSWORK";
  const live = [row(11, "Unit 4", category, "PUBLISHED")];
  const all = [...live, row(12, "Unit 3", category, "ARCHIVED")];
  listAssignments.mockImplementation((_classId: number, opts?: { includeArchived?: boolean }) =>
    Promise.resolve({ items: opts?.includeArchived ? all : live }),
  );
  get.mockImplementation(async (url: string) => {
    if (url !== "/classes/34/assignments/?include_archived=1") throw new Error(`unexpected GET ${url}`);
    return { data: all };
  });
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await flush();
}

/** Mount a tab for one role and show its archived rows, so there is a live menu and an archived one. */
async function mount(tab: Tab, myRole: string) {
  serve(tab);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: myRole } as unknown as ClassroomWithRole;
  const Page = tab === "Assignments" ? Assignments : Classwork;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Page classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  await flush();
  await click(buttons("Show archived")[0]);
  for (let tick = 0; tick < 50 && buttons("Actions").length < 2; tick++) await flush();
  expect(buttons("Actions")).toHaveLength(2);
}

/** Open one row's menu and read its items in order, then close it again. */
async function menu(actions: HTMLButtonElement): Promise<string[]> {
  await click(actions);
  // The menu is portalled onto <body>, outside the page.
  const items = Array.from(document.body.querySelectorAll(".ds-app a, .ds-app button"))
    .filter((el) => !host.contains(el))
    .map((el) => (el.textContent ?? "").trim());
  const overlay = Array.from(document.body.querySelectorAll<HTMLElement>("div.fixed.inset-0")).find((el) => !host.contains(el));
  if (overlay) await click(overlay);
  return items;
}

describe.each(["Assignments", "Classwork"] as const)("The %s tab's row menu", (tab) => {
  it("offers a TA no Delete, on a live row or an archived one", async () => {
    await mount(tab, "TA");
    const [live, archived] = buttons("Actions");

    expect(await menu(live)).toEqual(["Open", "Edit", "Archive"]);
    expect(await menu(archived)).toEqual(["Open", "Edit", "Unarchive"]);
  });

  it.each(["TEACHER", "OWNER"])("offers the %s Edit and Delete on both", async (role) => {
    await mount(tab, role);
    const [live, archived] = buttons("Actions");

    expect(await menu(live)).toEqual(["Open", "Edit", "Archive", "Delete"]);
    expect(await menu(archived)).toEqual(["Open", "Edit", "Unarchive", "Delete"]);
  });
});
