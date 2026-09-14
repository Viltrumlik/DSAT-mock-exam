/**
 * The classroom Gradebook tab opened from a homework's own page: `?tab=grading&assignment=<id>`.
 *
 * The tab opened a homework's grades only from a row of its list, and the list leaves archived homework
 * out, so the grades archiving keeps could not be opened without unarchiving. The homework's page now
 * names the homework in the link, and the tab opens straight on it.
 *
 * Archived homework is hidden from students, so its grades are read-only here: a returned piece of work
 * would go back to a student who can no longer open the homework.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole } from "../types";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { gradeSubmission: vi.fn(), returnSubmission: vi.fn() },
}));
// What the app router hands over is the address itself, so each test sets the address.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { Gradebook } = await import("../pages/Gradebook");

const PAGE = "/teacher/classrooms/34";

/** `GET /api/classes/34/gradebook/` for a class whose only homework is archived: the list leaves it out. */
const OVERVIEW = { assignments: [], needs_grading_total: 0, students: 2 };

/** `GET /api/classes/34/gradebook/assignments/102/` for a written homework in a class of two. */
function grades(status: "PUBLISHED" | "ARCHIVED") {
  return {
    assignment: {
      id: 102,
      title: "Unit 3 review",
      status,
      category: "HOMEWORK",
      due_at: "2026-09-10T18:00:00+05:00",
      is_auto_graded: false,
      source_label: "Manual",
      max_score: "100.00",
    },
    roster: [
      {
        student_id: 7, name: "Aziza Karimova", email: "aziza@example.com", profile_image_url: null,
        status: "GRADED", grade: "80.00", max_score: "100.00", source: "TEACHER", submission_id: 501,
      },
      {
        student_id: 8, name: "Bekzod Rahimov", email: "bekzod@example.com", profile_image_url: null,
        status: "SUBMITTED", grade: null, max_score: null, source: null, submission_id: 502,
      },
    ],
    counts: { graded: 1, needs_grading: 1, submitted: 1, needs_revision: 0, missing: 0, total: 2 },
    performance: null,
  };
}

/** The 404 `get_object_or_404` answers with, as axios rejects with it. */
function notFound() {
  return Object.assign(new Error("Request failed with status code 404"), {
    response: { status: 404, data: { detail: "No Assignment matches the given query." } },
  });
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

/** Let the queries resolve: wait until no loading label is left on screen. */
async function settle() {
  const loading = () => !host.textContent || host.textContent.includes("Loading");
  for (let tick = 0; tick < 50 && loading(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (loading()) throw new Error("the gradebook never finished loading");
}

/** Open the Gradebook tab at `address`, with the API serving `homework` as homework 102's grades. */
async function mount(address: string, homework: object | "not found") {
  window.history.replaceState(null, "", address);
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/gradebook/") return { data: OVERVIEW };
    if (url === "/classes/34/gradebook/assignments/102/") {
      if (homework === "not found") throw notFound();
      return { data: homework };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: "OWNER" } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Gradebook classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label);

describe("Gradebook tab — opened from a homework's page", () => {
  it("opens on the homework the link names, though the list leaves archived homework out", async () => {
    await mount(`${PAGE}?tab=grading&assignment=102`, grades("ARCHIVED"));

    expect(get).toHaveBeenCalledWith("/classes/34/gradebook/assignments/102/");
    expect(host.textContent).toContain("Unit 3 review");
    expect(host.textContent).toContain("Aziza Karimova");
    expect(host.textContent).toContain("80.00/100.00");
    expect(host.textContent).not.toContain("No assignments yet");
  });

  it("keeps an archived homework's grades as they are: nothing to grade or return", async () => {
    await mount(`${PAGE}?tab=grading&assignment=102`, grades("ARCHIVED"));

    // The archive dialog's own promise: "Existing grades are kept and you can unarchive it later."
    expect(host.textContent).toContain("Archived homework is hidden from students, and its grades are kept.");
    expect(host.textContent).toContain("To grade or return work on it, unarchive it on the Assignments tab.");
    expect(buttons("Grade")).toHaveLength(0);
    expect(buttons("Re-grade")).toHaveLength(0);
  });

  it("does not tell the teacher to grade archived work that is graded automatically", async () => {
    const quiz = grades("ARCHIVED");
    quiz.assignment = { ...quiz.assignment, is_auto_graded: true, source_label: "Quiz" };
    await mount(`${PAGE}?tab=grading&assignment=102`, quiz);

    expect(host.textContent).toContain("Archived homework is hidden from students, and its grades are kept.");
    expect(host.textContent).not.toContain("To grade or return work on it");
  });

  it("still lets the teacher grade published homework opened the same way", async () => {
    await mount(`${PAGE}?tab=grading&assignment=102`, grades("PUBLISHED"));

    expect(buttons("Grade")).toHaveLength(1);
    expect(buttons("Re-grade")).toHaveLength(1);
    expect(host.textContent).not.toContain("Archived homework is hidden from students");
  });

  it("takes the homework out of the address, and Back shows the list", async () => {
    await mount(`${PAGE}?tab=grading&assignment=102`, grades("ARCHIVED"));

    // Left in, a refresh after Back would reopen the homework, and switching tabs would carry it along.
    expect(window.location.pathname).toBe(PAGE);
    expect(window.location.search).toBe("?tab=grading");

    const [back] = buttons("Gradebook");
    expect(back).toBeTruthy();
    await act(async () => back.click());
    await settle();
    expect(host.textContent).toContain("No assignments yet");
  });

  it("says a homework this class does not have was not found, with the way back, not an empty list", async () => {
    await mount(`${PAGE}?tab=grading&assignment=102`, "not found");

    expect(host.textContent).toContain("Homework not found");
    expect(host.textContent).not.toContain("No students in this view");
    // Asking again cannot find it either.
    expect(buttons("Try again")).toHaveLength(0);
    expect(buttons("Gradebook")).toHaveLength(1);
  });

  it("opens the list, as before, when the address names no homework", async () => {
    await mount(`${PAGE}?tab=grading`, grades("ARCHIVED"));

    expect(host.textContent).toContain("No assignments yet");
    expect(get).not.toHaveBeenCalledWith("/classes/34/gradebook/assignments/102/");
  });
});
