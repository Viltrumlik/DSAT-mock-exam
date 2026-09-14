import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import api from "@/lib/api";
import type { ClassroomWithRole } from "../../types";

/**
 * The line under each homework on a class's Assignments tab that tells its teaching team how many
 * students have turned it in.
 *
 * It printed `submissions_count` as "N submitted". That is `Count("submissions")`: every submission
 * row. A row starts as a DRAFT the first time a student uploads a file, stays when work is RETURNED
 * for revision, and outlives the membership of a student who leaves the class or is made a TA. So
 * three drafts read "3 submitted", and a class of 20 who had all turned a homework in could read
 * "22 submitted". The row now carries `turned_in_count`, the class's ACTIVE students with a
 * SUBMITTED or REVIEWED submission, which is what the gradebook and the grading page count, and the
 * line reads it out of the class's `student_count`.
 *
 * Only the HTTP call is stubbed. The list goes through the real `classesApi.listAssignments` and its
 * contract parser, and the archived list through its own request, so a mapper that dropped the field
 * would fail here too.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/teacher/classrooms/1" }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { Assignments } = await import("../Assignments");

const CLASS_BASE = "/teacher/classrooms/1";

/** `GET /api/classes/1/` as the class's teacher receives it. */
function classroom(counts: { members_count: number; student_count?: number }): ClassroomWithRole {
  return {
    id: 1,
    name: "Algebra 2",
    subject: "MATH",
    lesson_days: "ODD",
    join_code: "JOIN1",
    my_role: "TEACHER",
    ...counts,
  } as ClassroomWithRole;
}

// 20 students, their teacher and a TA.
const ALGEBRA = classroom({ members_count: 22, student_count: 20 });

type Row = {
  id: number;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  due_at: string;
  published_at: string;
  created_at: string;
  submissions_count: number;
  turned_in_count?: number;
};

/** A `GET /api/classes/1/assignments/` row as the teaching team receives it. */
function homework(
  id: number,
  title: string,
  counts: { submissions_count: number; turned_in_count?: number },
  status: Row["status"] = "PUBLISHED",
): Row {
  return {
    id,
    title,
    status,
    due_at: "2026-09-15T18:00:00+05:00",
    published_at: "2026-09-08T09:00:00+05:00",
    created_at: "2026-09-08T09:00:00+05:00",
    ...counts,
  };
}

// All 20 students turned it in. So did a student who has since moved to the evening group, and one
// who has since been made a TA: 22 submission rows.
const ESSAY = homework(101, "Essay", { submissions_count: 22, turned_in_count: 20 });

// Three students have saved a draft. Nobody has turned it in.
const READING = homework(102, "Reading", { submissions_count: 3, turned_in_count: 0 });

// 16 students turned it in. Two only saved a draft, one has work returned for revision, one never
// started, and a student who has since left the class had turned it in: 20 rows.
const WORKSHEET = homework(103, "Worksheet", { submissions_count: 20, turned_in_count: 16 });

// Archived once 18 students had turned it in. Two drafts and a returned quiz make 21 rows.
const QUIZ = homework(104, "Quiz", { submissions_count: 21, turned_in_count: 18 }, "ARCHIVED");

/** Answer the tab's requests. The list leaves archived homework out unless it is asked for. */
function serve(rows: Row[]) {
  const get = async (url: string) => {
    if (url === "/classes/1/assignments/") return { data: rows.filter((r) => r.status !== "ARCHIVED") };
    if (url === "/classes/1/assignments/?include_archived=1") return { data: rows };
    throw new Error(`unexpected GET ${url}`);
  };
  vi.spyOn(api, "get").mockImplementation(get as unknown as typeof api.get);
}

let host: HTMLDivElement;
let root: Root;

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** Let the queries settle until `done`, or fail naming what never happened. */
async function until(done: () => boolean, what: string) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error(`${what} never happened`);
}

const loading = () => host.querySelector(".animate-spin") != null;

async function renderTab(cls: ClassroomWithRole, rows: Row[]) {
  serve(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Assignments classroom={cls} />
      </QueryClientProvider>,
    ),
  );
  await until(() => !loading(), "the assignments loading");
  if (text(host).includes("Something went wrong")) throw new Error("the assignments failed to load");
}

/** Open the archived section and wait for homework `id` to appear in it. */
async function showArchived(id: number) {
  const button = [...host.querySelectorAll("button")].find((b) => text(b) === "Show archived");
  if (!button) throw new Error("no Show archived button");
  await act(async () => button.click());
  await until(() => host.querySelector(`a[href="${CLASS_BASE}/assignments/${id}"]`) != null, `archived homework ${id} appearing`);
}

/** The link that opens homework `id`: its title, and the line under it. */
function row(id: number): Element {
  const link = host.querySelector(`a[href="${CLASS_BASE}/assignments/${id}"]`);
  if (!link) throw new Error(`no row for homework ${id}`);
  return link;
}

/** The "… submitted" line under a homework's title, or null when it has none. */
function submittedLine(el: Element): string | null {
  return [...el.querySelectorAll("p")].map(text).find((t) => t.endsWith("submitted")) ?? null;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Assignments tab — how many students have turned each homework in", () => {
  it("reads 20 / 20 when all 20 students turned it in, not the 22 rows a moved student and a new TA leave behind", async () => {
    await renderTab(ALGEBRA, [ESSAY, READING, WORKSHEET]);

    expect(submittedLine(row(101))).toBe("20 / 20 submitted");
  });

  it("says nothing about homework that only has drafts", async () => {
    await renderTab(ALGEBRA, [ESSAY, READING, WORKSHEET]);

    expect(submittedLine(row(102))).toBeNull();
  });

  it("counts neither drafts, nor work returned for revision, nor a student who left", async () => {
    await renderTab(ALGEBRA, [ESSAY, READING, WORKSHEET]);

    expect(submittedLine(row(103))).toBe("16 / 20 submitted");
  });

  it("counts archived homework the same way", async () => {
    await renderTab(ALGEBRA, [ESSAY, QUIZ]);
    await showArchived(104);

    expect(submittedLine(row(104))).toBe("18 / 20 submitted");
  });

  it("does not fall back to submissions_count when the server sends no turned_in_count", async () => {
    const fromAnOlderServer = homework(101, "Essay", { submissions_count: ESSAY.submissions_count });
    await renderTab(ALGEBRA, [fromAnOlderServer]);

    expect(submittedLine(row(101))).toBeNull();
  });

  it("without the class's student count, gives no total rather than counting the teacher and the TA", async () => {
    await renderTab(classroom({ members_count: 22 }), [ESSAY]);

    expect(submittedLine(row(101))).toBe("20 submitted");
  });
});
