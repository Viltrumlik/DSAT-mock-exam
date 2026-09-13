import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";

/**
 * How often the homework grading hub — `/teacher/homework/grading` — asks the server for its homework
 * again when the server says classes changed.
 *
 * Every refresh is a full reload: the class list, then each class's homework, one class after another.
 * The realtime stream hands the hub one event per call, and a whole batch at once when its debounce lets
 * go — straight after connecting it replays up to 200 stored events. The hub used to start a reload for
 * every one of them, all running together.
 *
 * Now one refresh runs at a time. However many events arrive while it runs, they get one refresh after
 * it: the running one may have read the server before they happened.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listAssignments: vi.fn(),
}));

type RealtimeEvent = { id: number; type: string; data: Record<string, unknown> };
type RealtimeHandler = (ev: RealtimeEvent) => unknown;

const realtime = vi.hoisted(() => ({
  /** The hub's realtime handler, kept so a test can deliver events. */
  onEvent: null as RealtimeHandler | null,
  /**
   * Events the stream still hands over as it closes: `subscribeRealtime`'s unsubscribe flushes what its
   * debounce was holding, through the same handler.
   */
  deliveredOnClose: [] as RealtimeEvent[],
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
// There is no EventSource in jsdom.
vi.mock("@/lib/realtime", () => ({
  subscribeRealtime: (handlers: { onEvent: RealtimeHandler }) => {
    realtime.onEvent = handlers.onEvent;
    return () => {
      for (const ev of realtime.deliveredOnClose) handlers.onEvent(ev);
    };
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { default: HomeworkGradingHub } = await import("../HomeworkGradingHub");

const BASE = "/teacher/homework/grading";
const BUSY = "The service is busy. Try again shortly.";

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
const WEEK_4 = homework(101, "Week 4 — Algebra");
const WEEK_5 = homework(102, "Week 5 — Functions");

/** Answer with these classes and their homework, through the real contract parsers. */
function serve(classes: object[], homeworkByClass: Record<number, object[]>) {
  api.list.mockImplementation(async () => parseClassroomList(classes, "GET /classes/"));
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(homeworkByClass[classId] ?? [], `GET /classes/${classId}/assignments/`),
  );
}

/** The class list as the server sends it, for a held request to answer with. */
const algebraOnly = () => parseClassroomList([ALGEBRA], "GET /classes/");

/** A request the server answered with an error, in axios's shape. */
function httpError(status: number, detail: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { detail } },
  });
}

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
let mounted = false;

const text = () => host.textContent ?? "";
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

/** Let whatever has started run on, so that a request nothing should make would have been made. */
async function settle() {
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<HomeworkGradingHub basePath={BASE} homeworkManagementHref="/teacher/homework" homeworkManagementLabel="Homework" />),
  );
  mounted = true;
  await until(spinnerGone);
}

async function unmount() {
  await act(async () => root.unmount());
  mounted = false;
}

/**
 * The stream hands the hub these events at once, the way `subscribeRealtime` delivers a batch: one
 * handler call per event, back to back. Each promise settles when the hub is done with its event.
 */
async function deliver(...types: string[]): Promise<Promise<unknown>[]> {
  const onEvent = realtime.onEvent;
  if (!onEvent) throw new Error("the hub never subscribed to realtime events");
  let pending: Promise<unknown>[] = [];
  await act(async () => {
    pending = types.map((type, i) => Promise.resolve(onEvent({ id: i + 1, type, data: {} })));
  });
  return pending;
}

/** Wait until the hub is done with every one of these events. */
async function handled(events: Promise<unknown>[]) {
  await act(async () => {
    await Promise.all(events);
  });
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) await unmount();
  host.remove();
  realtime.onEvent = null;
  realtime.deliveredOnClose = [];
  vi.resetAllMocks();
});

describe("HomeworkGradingHub — one refresh at a time", () => {
  it("starts one refresh for five events delivered at once, and exactly one more once the server answers it", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();
    // The page's own load.
    expect(api.list).toHaveBeenCalledTimes(1);

    const first = held<unknown>();
    const second = held<unknown>();
    api.list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const events = await deliver("workspace.updated", "workspace.updated", "stream.updated", "workspace.updated", "resync");

    // One refresh waits on the server; the other four events wait for the one after it.
    expect(api.list).toHaveBeenCalledTimes(2);

    await act(async () => first.release(algebraOnly()));
    await until(() => api.list.mock.calls.length === 3);
    expect(rows()).toEqual([`${BASE}/1/101`]);

    // By the time the refresh after it asks, Algebra has a second homework.
    serve([ALGEBRA], { 1: [WEEK_4, WEEK_5] });
    await act(async () => second.release(algebraOnly()));
    await handled(events);
    await settle();

    expect(api.list).toHaveBeenCalledTimes(3);
    expect(api.listAssignments).toHaveBeenCalledTimes(3);
    expect(rows()).toEqual([`${BASE}/1/101`, `${BASE}/1/102`]);
  });

  it("still runs the refresh waiting behind one that fails", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    const first = held<unknown>();
    const second = held<unknown>();
    api.list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const events = await deliver("workspace.updated", "workspace.updated", "workspace.updated");
    expect(api.list).toHaveBeenCalledTimes(2);

    await act(async () => first.fail(httpError(503, BUSY)));
    await until(() => api.list.mock.calls.length === 3);

    serve([ALGEBRA], { 1: [WEEK_4, WEEK_5] });
    await act(async () => second.release(algebraOnly()));
    await handled(events);
    await settle();

    expect(api.list).toHaveBeenCalledTimes(3);
    expect(rows()).toEqual([`${BASE}/1/101`, `${BASE}/1/102`]);
    expect(text()).not.toContain(BUSY);
  });

  it("shows a refresh that fails as it always has: the server's reason, above the homework that loaded", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    api.list.mockRejectedValueOnce(httpError(503, BUSY));
    await handled(await deliver("workspace.updated"));

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(text()).toContain(BUSY);
    expect(rows()).toEqual([`${BASE}/1/101`]);
  });

  it("starts the next refresh at once when none is running", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    await handled(await deliver("workspace.updated", "workspace.updated"));
    expect(api.list).toHaveBeenCalledTimes(3);

    const answer = held<unknown>();
    api.list.mockImplementationOnce(() => answer.promise);
    const later = await deliver("stream.updated");
    expect(api.list).toHaveBeenCalledTimes(4);

    await act(async () => answer.release(algebraOnly()));
    await handled(later);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(4);
  });

  it("starts no refresh for events that are not about a class", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    await handled(await deliver("hello", "ping", "comments.updated", "notifications.updated"));
    await settle();

    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe("HomeworkGradingHub — closing the page", () => {
  it("drops the refresh waiting behind one that is still running", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    const answer = held<unknown>();
    api.list.mockImplementationOnce(() => answer.promise);
    const events = await deliver("workspace.updated", "workspace.updated");
    expect(api.list).toHaveBeenCalledTimes(2);

    await unmount();
    await act(async () => answer.release(algebraOnly()));
    // Every event is let go of, the dropped refresh's too, so nothing waits on the page forever.
    await handled(events);
    await settle();

    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("starts no refresh for events the stream still hands over as it closes", async () => {
    serve([ALGEBRA], { 1: [WEEK_4] });
    await mount();

    realtime.deliveredOnClose = [{ id: 9, type: "workspace.updated", data: {} }];
    await unmount();
    await settle();

    expect(api.list).toHaveBeenCalledTimes(1);
  });
});
