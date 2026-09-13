/**
 * The Classwork tab after classwork left the homework list.
 *
 * It used to read the classroom's shared assignment list and keep the classwork rows — which
 * only worked because that list carried classwork, the very thing that put classwork under
 * homework. Now the plain list is homework, so this tab has to ask for classwork by name, and
 * everything a teacher used to do to classwork from the Assignments menu (edit, archive,
 * delete, the archived rows) has to be reachable here instead.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole } from "../types";

const listAssignments = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    listAssignments: (...args: unknown[]) => listAssignments(...args),
    deleteAssignment: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/classrooms/34",
  useRouter: () => ({ push: vi.fn() }),
}));

const { Classwork } = await import("../pages/Classwork");

const row = (id: number, title: string, status: string) => ({
  id,
  title,
  category: "CLASSWORK",
  status,
  assigned_at: "2026-09-10T09:00:00+05:00",
  contents: [],
  vocab_homeworks: [],
  classwork_award: null,
});
const LIVE = [row(11, "Lesson 12 classwork", "PUBLISHED")];
// `include_archived` returns the live rows too; the tab keeps only the archived ones.
const WITH_ARCHIVED = [...LIVE, row(12, "Old classwork", "ARCHIVED")];

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  listAssignments.mockReset();
  listAssignments.mockImplementation((_classId: number, opts?: { includeArchived?: boolean }) =>
    Promise.resolve({ items: opts?.includeArchived ? WITH_ARCHIVED : LIVE }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(myRole: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: myRole } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Classwork classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  await flush();
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await flush();
}

describe("Classwork tab", () => {
  it("asks the server for classwork by name, not for the homework list", async () => {
    await mount("OWNER");

    expect(listAssignments).toHaveBeenCalledWith(34, { category: "CLASSWORK", includeArchived: false });
    expect(host.textContent).toContain("Lesson 12 classwork");
  });

  it("gives the teaching team the row menu that used to live only on Assignments", async () => {
    await mount("OWNER");

    expect(buttons("Give XP")).toHaveLength(1);
    const [actions] = buttons("Actions");
    expect(actions).toBeTruthy();
    await click(actions);

    const menu = document.body.textContent ?? "";
    for (const item of ["Open", "Edit", "Archive", "Delete"]) expect(menu).toContain(item);
    expect(menu).not.toContain("Unarchive");
  });

  it("keeps archived classwork reachable, in its own section and without XP", async () => {
    await mount("OWNER");
    await click(buttons("Show archived")[0]);

    expect(listAssignments).toHaveBeenCalledWith(34, { category: "CLASSWORK", includeArchived: true });
    expect(host.textContent).toContain("Old classwork");
    expect(host.textContent).toContain("Archived");
    // The live row keeps its button; the archived one is hidden from the class, so none.
    expect(buttons("Give XP")).toHaveLength(1);
  });

  it("offers a student none of it", async () => {
    await mount("STUDENT");

    expect(host.textContent).toContain("Lesson 12 classwork");
    expect(buttons("Actions")).toHaveLength(0);
    expect(buttons("Show archived")).toHaveLength(0);
  });
});
