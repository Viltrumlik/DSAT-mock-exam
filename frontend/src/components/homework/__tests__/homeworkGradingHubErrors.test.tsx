import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * What the homework grading hub — `/teacher/homework/grading` — shows when its homework does not
 * load.
 *
 * The hub asks the server for its homework in two ways, and a failure means something different in
 * each:
 *
 * - The first load, or a "Try again" after it failed. Nothing is known yet, so the reason takes the
 *   list's place, with a way to try again. It used to sit above an "All homework" card with no rows
 *   in it — a list of no homework — and there was no way to try again short of reloading the page.
 * - A refresh, which the hub runs without a spinner whenever the server says a class changed. The
 *   homework on screen is still what last loaded, so it stays, under a notice that it may be out of
 *   date. A failed refresh used to put "Could not load homework." above that list, as if the page had
 *   not loaded, and a refresh that ran after a failed load showed "No assignments to grade yet" for
 *   as long as it took.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listAssignments: vi.fn(),
}));

type RealtimeHandler = (ev: { id: number; type: string; data: Record<string, unknown> }) => unknown;

/** The hub's realtime handler, kept so a test can say a class changed. */
const realtime = vi.hoisted(() => ({ onEvent: null as RealtimeHandler | null }));

vi.mock("@/lib/api", () => ({ classesApi: api }));
// There is no EventSource in jsdom.
vi.mock("@/lib/realtime", () => ({
  subscribeRealtime: (handlers: { onEvent: RealtimeHandler }) => {
    realtime.onEvent = handlers.onEvent;
    return () => {};
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { default: HomeworkGradingHub } = await import("../HomeworkGradingHub");

const BASE = "/teacher/homework/grading";
const LOAD_FAILED = "Could not load homework.";
const REFRESH_FAILED = "Could not refresh homework.";
const OUT_OF_DATE = "The list below may be out of date.";
/** The heading of the homework list. Drawn from no data, it is a list of no homework. */
const LIST = "All homework";
const EMPTY = "No assignments to grade yet";

/** A `GET /api/classes/` row, in the serializer's wire shape. ADMIN may grade on every version of the hub. */
function classRow(id: number, name: string) {
  return { id, name, subject: "MATH", lesson_days: "ODD", join_code: `JOIN${id}`, members_count: 21, student_count: 20, my_role: "ADMIN" };
}

/** A `GET /api/classes/<id>/assignments/` row, with no deadline so that nothing on the row depends on today. */
function homework(id: number, title: string) {
  return {
    id,
    title,
    status: "PUBLISHED",
    created_at: "2026-09-10T09:00:00+05:00",
    due_at: null,
    submissions_count: 3,
    turned_in_count: 3,
  };
}

const ALGEBRA = classRow(1, "Algebra 2");
const GEOMETRY = classRow(2, "Geometry");
const WEEK_4 = homework(101, "Week 4 — Algebra");
const WEEK_5 = homework(102, "Week 5 — Functions");
const PROOFS = homework(201, "Proofs");

/** Answer with these classes and their homework, through the real contract parsers. */
function serve(classes: object[], homeworkByClass: Record<number, object[]>) {
  api.list.mockImplementation(async () => parseClassroomList(classes, "GET /classes/"));
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(homeworkByClass[classId] ?? [], `GET /classes/${classId}/assignments/`),
  );
}

/** A request the server answered with an error, in axios's shape. */
function httpError(status: number, detail: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { detail } },
  });
}

/** A request that never reached the server: axios gives no `response`. */
const networkError = () => new Error("Network Error");

/** A response that arrives only when the test lets it. */
function held<T>() {
  let release!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

let host: HTMLDivElement;
let root: Root;

const text = () => host.textContent ?? "";
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
const spinnerGone = () => host.querySelector(".animate-spin") == null;
/** The homework rows, by the grading page each one opens. */
const rows = () => [...host.querySelectorAll(`a[href^="${BASE}/"]`)].map((a) => a.getAttribute("href")).sort();

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
  await act(async () =>
    root.render(<HomeworkGradingHub basePath={BASE} homeworkManagementHref="/teacher/homework" homeworkManagementLabel="Homework" />),
  );
  await until(spinnerGone);
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no "${label}" button among ${JSON.stringify(buttons())}`);
  await act(async () => button.click());
}

/** The server says a class changed, so the hub starts a refresh. `done` settles when that refresh has ended. */
async function classChanged(): Promise<{ done: Promise<unknown> }> {
  const onEvent = realtime.onEvent;
  if (!onEvent) throw new Error("the hub never subscribed to realtime events");
  let done: Promise<unknown> = Promise.resolve();
  await act(async () => {
    done = Promise.resolve(onEvent({ id: 1, type: "workspace.updated", data: {} }));
  });
  return { done };
}

/** A class changed, and the hub's refresh ran to the end. */
async function refreshed() {
  const { done } = await classChanged();
  await act(async () => {
    await done;
  });
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  realtime.onEvent = null;
  vi.resetAllMocks();
});

describe("HomeworkGradingHub — a load that fails shows why in the list's place", () => {
  it("a failed classesApi.list shows the error and a retry, and no list of no homework", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    api.list.mockRejectedValue(networkError());
    await mount();

    expect(text()).toContain(LOAD_FAILED);
    expect(text()).not.toContain(LIST);
    expect(text()).not.toContain(EMPTY);
    expect(buttons()).toContain("Try again");
  });

  it("a failed classesApi.listAssignments shows the error and a retry, and none of the homework that did load", async () => {
    serve([ALGEBRA, GEOMETRY], { 1: [WEEK_4], 2: [PROOFS] });
    const answer = api.listAssignments.getMockImplementation()!;
    api.listAssignments.mockImplementation(async (classId: number) => {
      if (classId === 2) throw networkError();
      return answer(classId);
    });
    await mount();

    // Geometry's homework was asked for after Algebra's came back.
    expect(api.listAssignments).toHaveBeenCalledTimes(2);
    expect(text()).toContain(LOAD_FAILED);
    expect(text()).not.toContain(LIST);
    expect(text()).not.toContain(EMPTY);
    expect(rows()).toEqual([]);
    expect(buttons()).toContain("Try again");
  });

  it("says what the server said when it gives a reason", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    api.listAssignments.mockRejectedValue(httpError(503, "The service is busy. Try again shortly."));
    await mount();

    expect(text()).toContain("The service is busy. Try again shortly.");
    expect(text()).not.toContain(LIST);
    expect(buttons()).toContain("Try again");
  });

  it("tries again, and lists the homework once the request goes through", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    api.list.mockRejectedValueOnce(networkError());
    await mount();
    expect(text()).toContain(LOAD_FAILED);
    expect(buttons()).toContain("Try again");

    const response = held<unknown>();
    api.list.mockImplementationOnce(() => response.promise);
    await click("Try again");

    // Nothing is on screen to keep, so the retry shows it is loading, in the error's place.
    expect(spinnerGone()).toBe(false);
    expect(text()).not.toContain(LOAD_FAILED);

    await act(async () => response.release(parseClassroomList([ALGEBRA], "GET /classes/")));
    await until(spinnerGone);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain(LOAD_FAILED);
    expect(text()).toContain(LIST);
    expect(rows()).toEqual([`${BASE}/1/101`]);
    expect(buttons()).not.toContain("Try again");
  });

  it("still says there is nothing to grade when there is nothing to grade", async () => {
    serve([ALGEBRA], { 1: [] });
    await mount();

    expect(text()).toContain(EMPTY);
    expect(text()).not.toContain(LOAD_FAILED);
    expect(buttons()).not.toContain("Try again");
  });
});

describe("HomeworkGradingHub — a refresh that fails keeps the homework on screen", () => {
  it("keeps the list, says it may be out of date without claiming the page did not load, and offers a retry", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();
    expect(rows()).toEqual([`${BASE}/1/101`]);

    api.list.mockRejectedValue(networkError());
    await refreshed();

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual([`${BASE}/1/101`]);
    expect(text()).toContain(LIST);
    expect(text()).not.toContain(LOAD_FAILED);
    expect(text()).toContain(REFRESH_FAILED);
    expect(text()).toContain(OUT_OF_DATE);
    expect(buttons()).toContain("Try again");
    // It interrupts nothing: a status, not an alert.
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(REFRESH_FAILED);
  });

  it("says what the server said when a refresh fails with a reason", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    api.listAssignments.mockRejectedValue(httpError(503, "The service is busy. Try again shortly."));
    await refreshed();

    expect(text()).toContain("The service is busy. Try again shortly.");
    expect(text()).toContain(OUT_OF_DATE);
    expect(rows()).toEqual([`${BASE}/1/101`]);
  });

  it("keeps the list while trying again, and drops the notice once the refresh goes through", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();
    api.list.mockRejectedValueOnce(networkError());
    await refreshed();
    expect(text()).toContain(REFRESH_FAILED);

    const response = held<unknown>();
    api.list.mockImplementationOnce(() => response.promise);
    await click("Try again");

    // Still waiting on the server: the homework stays, and the button says a retry is running.
    expect(spinnerGone()).toBe(true);
    expect(rows()).toEqual([`${BASE}/1/101`]);
    expect(buttons()).toContain("Trying again…");
    expect(buttons()).not.toContain("Try again");

    // By the time it answers, Algebra has a second homework.
    serve([ALGEBRA], { 1: [WEEK_4, WEEK_5] });
    await act(async () => response.release(parseClassroomList([ALGEBRA], "GET /classes/")));
    await until(() => rows().length === 2);

    expect(rows()).toEqual([`${BASE}/1/101`, `${BASE}/1/102`]);
    expect(text()).not.toContain(REFRESH_FAILED);
    expect(text()).not.toContain(OUT_OF_DATE);
    expect(buttons()).not.toContain("Try again");
  });

  it("says it is trying again until the last of several overlapping refreshes has ended", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();
    api.list.mockRejectedValueOnce(networkError());
    await refreshed();
    expect(buttons()).toContain("Try again");

    // Two classes change at once, and the server is slow to answer either refresh.
    const first = held<unknown>();
    const second = held<unknown>();
    api.list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const one = await classChanged();
    const other = await classChanged();
    expect(buttons()).toContain("Trying again…");

    await act(async () => {
      first.fail(networkError());
      await one.done;
    });
    expect(buttons()).toContain("Trying again…");

    await act(async () => {
      second.fail(networkError());
      await other.done;
    });
    expect(buttons()).toContain("Try again");
    expect(text()).toContain(REFRESH_FAILED);
    expect(rows()).toEqual([`${BASE}/1/101`]);
  });

  it("keeps saying there is nothing to grade when a refresh of an empty list fails", async () => {
    serve([ALGEBRA], { 1: [] });
    await mount();

    api.list.mockRejectedValue(networkError());
    await refreshed();

    expect(text()).toContain(EMPTY);
    expect(text()).toContain(REFRESH_FAILED);
    expect(text()).not.toContain(LOAD_FAILED);
  });
});

describe("HomeworkGradingHub — a refresh after a failed load", () => {
  it("keeps saying why the homework did not load while it runs and after it fails, and never that there is none", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    api.list.mockRejectedValueOnce(networkError());
    await mount();
    expect(text()).toContain(LOAD_FAILED);

    const response = held<unknown>();
    api.list.mockImplementationOnce(() => response.promise);
    const { done } = await classChanged();

    expect(text()).not.toContain(EMPTY);
    expect(text()).toContain(LOAD_FAILED);
    expect(buttons()).toContain("Try again");

    await act(async () => {
      response.fail(networkError());
      await done;
    });

    expect(text()).not.toContain(EMPTY);
    expect(text()).not.toContain(LIST);
    expect(text()).toContain(LOAD_FAILED);
    expect(text()).not.toContain(REFRESH_FAILED);
    expect(buttons()).toContain("Try again");
  });

  it("lists the homework when it goes through", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    api.list.mockRejectedValueOnce(networkError());
    await mount();
    expect(text()).toContain(LOAD_FAILED);

    await refreshed();

    expect(rows()).toEqual([`${BASE}/1/101`]);
    expect(text()).not.toContain(LOAD_FAILED);
    expect(buttons()).not.toContain("Try again");
  });
});
