/**
 * Unpublished homework on the classroom's Assignments tab (`/teacher/classrooms/[id]`).
 *
 * `create` gives every homework the start of the class's next lesson as its deadline, whatever its
 * status, and only the first publish replaces it, with the lesson after publishing. A homework saved
 * with "Save as draft" therefore carries a date no student is ever given. The teaching team's rows
 * never count as done, so once that lesson began the draft read a red "Was due …" beside its "Draft"
 * pill — about homework no student can see.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAssignmentList } from "@/lib/criticalApiContract";
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

const { Assignments } = await import("../pages/Assignments");

// Sunday noon in Tashkent. The class meets on Monday, Wednesday and Friday at 18:00.
const NOW = new Date("2026-09-13T12:00:00+05:00");

/** A `GET /api/classes/<id>/assignments/` row as the teaching team receives it. */
function homework(
  id: number,
  title: string,
  status: "DRAFT" | "PUBLISHED" | null,
  fields: { created_at: string; due_at: string },
) {
  return {
    id,
    title,
    category: "HOMEWORK",
    ...(status ? { status } : {}),
    published_at: null,
    submissions_count: 0,
    ...fields,
  };
}

// Published after Wednesday's lesson and due at Friday's, which has passed.
const WORKSHEET = homework(101, "Worksheet", "PUBLISHED", {
  created_at: "2026-09-09T19:00:00+05:00",
  due_at: "2026-09-11T18:00:00+05:00",
});

// Saved as a draft after Wednesday's lesson and never published. `create` still gave it Friday's
// lesson as a deadline, which has passed; no student has been able to see it.
const OLD_DRAFT = homework(102, "Unit 3 review", "DRAFT", {
  created_at: "2026-09-09T19:30:00+05:00",
  due_at: "2026-09-11T18:00:00+05:00",
});

// Saved as a draft yesterday. Its placeholder is tomorrow's lesson — the real deadline is whichever
// lesson follows the moment it is published.
const NEW_DRAFT = homework(103, "Unit 4 preview", "DRAFT", {
  created_at: "2026-09-12T10:00:00+05:00",
  due_at: "2026-09-14T18:00:00+05:00",
});

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `Date` only: faking the timer functions too would freeze the queues `act` waits on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  listAssignments.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** Serve `rows` through the real contract parser and mount the tab for a class owner. */
async function mount(rows: object[]) {
  listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(rows, `GET /classes/${classId}/assignments/`),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: "OWNER" } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Assignments classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !host.querySelector(".cr-rowin"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.querySelector(".cr-rowin")) throw new Error("the list never rendered a row");
}

/** The one row titled `title`. */
function row(title: string): HTMLElement {
  const rows = [...host.querySelectorAll<HTMLElement>(".cr-rowin")].filter((el) => el.textContent?.includes(title));
  if (rows.length !== 1) throw new Error(`expected one row titled "${title}", found ${rows.length}`);
  return rows[0];
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** Whether anything in the row is drawn in the overdue red. */
const drawnRed = (el: Element) => el.querySelector('[class*="c0392b"]') != null;

describe("Assignments tab — homework that has not reached students", () => {
  it("says a draft is not published, not that it was due, once its placeholder deadline has passed", async () => {
    await mount([WORKSHEET, OLD_DRAFT]);

    // Published homework past its deadline is still flagged in red.
    expect(text(row("Worksheet"))).toContain("Was due Sep 11");
    expect(drawnRed(row("Worksheet"))).toBe(true);

    const draft = row("Unit 3 review");
    expect(text(draft)).toContain("Draft");
    expect(text(draft)).toContain("Not published");
    expect(text(draft)).not.toMatch(/due/i);
    expect(text(draft)).not.toContain("Sep 11");
    expect(drawnRed(draft)).toBe(false);
  });

  it("gives a draft no date while its placeholder is still ahead either — publishing sets the real one", async () => {
    await mount([NEW_DRAFT]);

    const draft = row("Unit 4 preview");
    expect(text(draft)).toContain("Not published");
    expect(text(draft)).not.toMatch(/due/i);
    expect(text(draft)).not.toContain("Sep 14");
  });

  it("goes only by a status that says DRAFT: a row that names no status keeps its deadline", async () => {
    // The contract does not require `status`; a missing field must not hide a deadline.
    await mount([homework(104, "Reading", null, { created_at: WORKSHEET.created_at, due_at: WORKSHEET.due_at })]);

    expect(text(row("Reading"))).toContain("Was due Sep 11");
    expect(drawnRed(row("Reading"))).toBe(true);
  });
});
