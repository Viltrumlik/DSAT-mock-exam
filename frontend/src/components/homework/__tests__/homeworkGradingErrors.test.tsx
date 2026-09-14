import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * What the assignment grading page — `/teacher/homework/grading/[classId]/[assignmentId]` — shows
 * when something fails.
 *
 * Two different failures, and they need opposite screens:
 *
 * - The page did not load: a request failed, or the user's role cannot grade. Nothing on the page
 *   is known, so it shows why and nothing else. It used to draw the lists underneath anyway, from
 *   empty data: "Submitted (0) · No submissions yet. · Not submitted (0) · Everyone turned work
 *   in." A teacher told that everyone turned work in chases no one.
 * - A save or a return failed. Everything on the page is still true, so the lists and the student
 *   being graded stay on screen, with the reason above them.
 */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  listAssignments: vi.fn(),
  listSubmissions: vi.fn(),
  people: vi.fn(),
  gradeSubmission: vi.fn(),
  returnSubmission: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useAuthCriticalGate", () => ({
  useAuthCriticalGate: () => ({ assertCriticalAuth: () => true, criticalAuthReady: true }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { default: HomeworkGradingAssignmentView } = await import("../HomeworkGradingAssignmentView");

const STUDENT = { id: 501, first_name: "Aziza", last_name: "Karimova" };
const WAITING = { id: 9001, status: "SUBMITTED", revision: 1, student: STUDENT, files: [], attempt: null, review: null };

/**
 * Class 7's homework 700, with one student whose work is waiting for review. ADMIN is a role every
 * version of the page lets grade.
 */
function serveClass(myRole = "ADMIN") {
  api.get.mockResolvedValue({ id: 7, name: "Algebra 2", my_role: myRole });
  api.listAssignments.mockResolvedValue({ items: [{ id: 700, title: "Week 4 — Algebra", locks_file_upload: false }] });
  api.listSubmissions.mockResolvedValue([WAITING]);
  api.people.mockResolvedValue([
    { role: "ADMIN", user: { id: 9, first_name: "The", last_name: "Teacher" } },
    { role: "STUDENT", user: STUDENT },
  ]);
}

/** A request the server answered with an error, in axios's shape. */
function httpError(status: number, detail: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { detail } },
  });
}

/** A request that never reached the server: axios gives no `response`. */
const networkError = () => new Error("Network Error");

/** The lists' own empty states. On a page that did not load they claim nothing was turned in. */
const EMPTY_LISTS = [
  "Submitted (0)",
  "No submissions yet.",
  "Not submitted (0)",
  "Everyone turned work in.",
  "Select a student to view uploads, test results, and grading.",
];

let host: HTMLDivElement;
let root: Root;

const text = () => host.textContent ?? "";
const emptyListsShown = () => EMPTY_LISTS.filter((line) => text().includes(line));
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
const spinnerGone = () => host.querySelector(".animate-spin") == null;

/** Let the page run until `done` holds. */
async function until(done: () => boolean) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("the page never settled");
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<HomeworkGradingAssignmentView basePath="/teacher/homework/grading" classId={7} assignmentId={700} />));
  await until(spinnerGone);
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no "${label}" button among ${JSON.stringify(buttons())}`);
  await act(async () => button.click());
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
});

describe("HomeworkGradingAssignmentView — a page that did not load shows only why", () => {
  it.each(["get", "listAssignments", "listSubmissions", "people"] as const)(
    "a failed classesApi.%s shows the error and a retry, and no empty lists",
    async (call) => {
      serveClass();
      api[call].mockRejectedValue(networkError());
      await mount();

      expect(emptyListsShown()).toEqual([]);
      expect(text()).toContain("Could not load assignment.");
      expect(buttons()).toContain("Try again");
    },
  );

  it("says what the server said when it gives a reason", async () => {
    serveClass();
    api.listSubmissions.mockRejectedValue(httpError(503, "The service is busy. Try again shortly."));
    await mount();

    expect(emptyListsShown()).toEqual([]);
    expect(text()).toContain("The service is busy. Try again shortly.");
  });

  it("refuses a student of the class with no empty lists, and offers no retry a role would not pass", async () => {
    serveClass("STUDENT");
    await mount();

    expect(emptyListsShown()).toEqual([]);
    expect(text()).toContain("Only class teachers can grade this homework.");
    expect(buttons()).not.toContain("Try again");
  });

  it("tries again, and shows the lists once the request goes through", async () => {
    serveClass();
    api.listSubmissions.mockRejectedValueOnce(networkError());
    await mount();
    expect(text()).toContain("Could not load assignment.");

    await click("Try again");
    await until(spinnerGone);

    expect(api.listSubmissions).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Could not load assignment.");
    expect(text()).toContain("Submitted (1)");
    expect(text()).toContain("Aziza Karimova");
  });

  it("a reload that fails after a saved review shows the error, not the lists it could not refresh", async () => {
    serveClass();
    api.gradeSubmission.mockResolvedValue({});
    await mount();
    await click("Aziza Karimova");

    api.listSubmissions.mockRejectedValue(networkError());
    await click("Save review");
    await until(() => spinnerGone() && api.listSubmissions.mock.calls.length === 2);

    expect(text()).not.toContain("Submitted (1)");
    expect(text()).not.toContain("Aziza Karimova");
    expect(text()).toContain("Could not load assignment.");
    expect(buttons()).toContain("Try again");
    // The save itself went through, and the teacher should not have to wonder.
    expect(text()).toContain("Review saved.");
  });

  it("a grade that lost a race, then a reload that fails, does not claim a refresh until one happens", async () => {
    serveClass();
    api.gradeSubmission.mockRejectedValue(httpError(409, "Submission was modified."));
    await mount();
    await click("Aziza Karimova");

    api.listSubmissions.mockRejectedValueOnce(networkError());
    await click("Save review");
    await until(() => spinnerGone() && api.listSubmissions.mock.calls.length === 2);

    expect(text()).not.toContain("Submission changed. Refreshed.");
    expect(text()).not.toContain("Submitted (1)");
    expect(text()).toContain("Could not load assignment.");

    await click("Try again");
    await until(() => spinnerGone() && api.listSubmissions.mock.calls.length === 3);

    // Why the teacher's grade is not there is still worth saying once the page is back.
    expect(text()).toContain("Submitted (1)");
    expect(text()).toContain("Submission changed. Refreshed.");
  });
});

describe("HomeworkGradingAssignmentView — a failed save or return keeps the page on screen", () => {
  it("a rejected grade shows the server's reason above the lists and the student being graded", async () => {
    serveClass();
    api.gradeSubmission.mockRejectedValue(httpError(400, "Grade must be between 0 and 100."));
    await mount();
    await click("Aziza Karimova");

    await click("Save review");
    await until(() => spinnerGone() && api.gradeSubmission.mock.calls.length === 1);

    expect(text()).toContain("Grade must be between 0 and 100.");
    expect(text()).toContain("Submitted (1)");
    expect(text()).toContain("Status: SUBMITTED");
    expect(buttons()).toContain("Save review");
    expect(text()).toContain("1 submission waiting for your review");
    expect(buttons()).not.toContain("Try again");
    expect(api.listSubmissions).toHaveBeenCalledTimes(1);
  });

  it("a failed return says so and keeps the lists and the student being graded", async () => {
    serveClass();
    api.returnSubmission.mockRejectedValue(networkError());
    await mount();
    await click("Aziza Karimova");

    await click("Return to student");
    await until(() => spinnerGone() && api.returnSubmission.mock.calls.length === 1);

    expect(text()).toContain("Could not return.");
    expect(text()).toContain("Submitted (1)");
    expect(text()).toContain("Status: SUBMITTED");
    expect(buttons()).toContain("Return to student");
    expect(buttons()).not.toContain("Try again");
  });

  it("a grade that lost a race to another change says so over the refreshed submission", async () => {
    serveClass();
    api.gradeSubmission.mockRejectedValue(httpError(409, "Submission was modified."));
    await mount();
    await click("Aziza Karimova");

    // Someone else reviewed it first: the reload brings back their version.
    api.listSubmissions.mockResolvedValue([{ ...WAITING, status: "REVIEWED", revision: 2, review: { grade: "90", feedback: "" } }]);
    await click("Save review");
    await until(() => spinnerGone() && api.listSubmissions.mock.calls.length === 2);

    expect(text()).toContain("Status: REVIEWED");
    expect(text()).toContain("Submission changed. Refreshed.");
    expect(buttons()).not.toContain("Try again");
  });
});
