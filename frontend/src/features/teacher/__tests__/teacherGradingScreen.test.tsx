/**
 * The one grading screen at `/teacher/grading`.
 *
 * What the owner asked for, read back as assertions: the queue nests class → homework → the
 * students waiting; opening a student shows the work they turned in — the uploaded jpg or pdf,
 * which is the thing three of the four old surfaces never showed; a grade goes to the endpoint
 * that already exists, carrying the `expected_revision` that submission was handed, so two
 * teachers cannot overwrite each other in silence; a rejected save is told to the teacher, not
 * swallowed, and does not move them on; saving moves to the next student without a list in
 * between; a deep link opens exactly one piece of work.
 *
 * And the rule this product keeps breaking: a request that FAILED says so and offers the retry.
 * It is never drawn as "nothing to grade" — the reading that would leave real work unmarked.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teacherToday = vi.fn();
const listSubmissions = vi.fn();
const gradeSubmission = vi.fn();
const returnSubmission = vi.fn();

vi.mock("@/lib/api", () => ({
  classesApi: {
    teacherToday: () => teacherToday(),
    listSubmissions: (classId: number, assignmentId: number) => listSubmissions(classId, assignmentId),
    gradeSubmission: (id: number, payload: unknown) => gradeSubmission(id, payload),
    returnSubmission: (id: number, payload: unknown) => returnSubmission(id, payload),
  },
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));
vi.mock("@/hooks/useAuthCriticalGate", () => ({
  useAuthCriticalGate: () => ({ assertCriticalAuth: () => true, criticalAuthReady: true }),
}));

const { TeacherGradingScreen } = await import("../grading/TeacherGradingScreen");
const { selectionFromParams, nextStopAfter } = await import("../grading/gradingQueueModel");

const TODAY = {
  date: "2026-09-21",
  now: "2026-09-21T10:35:00+05:00",
  classes: [],
  grading_queue: [
    {
      classroom_id: 1,
      name: "Math Junior 3",
      waiting: 3,
      assignments: [
        {
          assignment_id: 88,
          title: "Quadratics, week 3",
          waiting: 2,
          students: [
            { id: 11, name: "Dilnoza S.", submitted_at: "2026-09-19T19:10:00+05:00" },
            { id: 12, name: "Eldor U.", submitted_at: "2026-09-20T08:02:00+05:00" },
          ],
        },
        {
          assignment_id: 90,
          title: "Circles, week 4",
          waiting: 1,
          students: [{ id: 13, name: "Kamila N.", submitted_at: "2026-09-20T20:40:00+05:00" }],
        },
      ],
    },
  ],
  upcoming_midterms: [],
  stats: { attendance_week: [], homework_30d: [], attendance_trend: [] },
};

const DILNOZA = {
  id: 501,
  status: "SUBMITTED",
  workflow_status: "SUBMITTED",
  revision: 4,
  submitted_at: "2026-09-19T19:10:00+05:00",
  student: { id: 11, first_name: "Dilnoza", last_name: "S.", email: "d@example.com" },
  files: [{ id: 1, url: "https://files.mastersat.uz/hw/dilnoza-quadratics.jpg", file_name: "dilnoza-quadratics.jpg", file_type: "image/jpeg" }],
  review: null,
};

const ELDOR = {
  id: 502,
  status: "SUBMITTED",
  workflow_status: "SUBMITTED",
  revision: 2,
  submitted_at: "2026-09-20T08:02:00+05:00",
  student: { id: 12, first_name: "Eldor", last_name: "U.", email: "e@example.com" },
  files: [{ id: 2, url: "https://files.mastersat.uz/hw/eldor-quadratics.pdf", file_name: "eldor-quadratics.pdf", file_type: "application/pdf" }],
  review: null,
};

/** Already checked: it must never be listed as waiting. */
const NODIRA = {
  id: 503,
  status: "REVIEWED",
  workflow_status: "GRADED",
  revision: 6,
  submitted_at: "2026-09-18T12:00:00+05:00",
  student: { id: 14, first_name: "Nodira", last_name: "T.", email: "n@example.com" },
  files: [],
  review: { grade: 88, feedback: "Solid." },
};

const KAMILA = {
  id: 504,
  status: "SUBMITTED",
  workflow_status: "SUBMITTED",
  revision: 1,
  submitted_at: "2026-09-20T20:40:00+05:00",
  student: { id: 13, first_name: "Kamila", last_name: "N.", email: "k@example.com" },
  files: [{ id: 3, url: "https://files.mastersat.uz/hw/kamila-circles.jpg", file_name: "kamila-circles.jpg", file_type: "image/jpeg" }],
  review: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  teacherToday.mockReset();
  listSubmissions.mockReset();
  gradeSubmission.mockReset();
  returnSubmission.mockReset();
  teacherToday.mockResolvedValue(TODAY);
  listSubmissions.mockImplementation(async (_classId: number, assignmentId: number) =>
    assignmentId === 88 ? [DILNOZA, ELDOR, NODIRA] : [KAMILA],
  );
  gradeSubmission.mockResolvedValue({});
  returnSubmission.mockResolvedValue({});
  window.history.replaceState(null, "", "/teacher/grading");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(initial: { classId: number | null; assignmentId: number | null; studentId: number | null } = {
  classId: null, assignmentId: null, studentId: null,
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeacherGradingScreen initial={initial} />
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
  await flush();
}

const text = () => host.textContent ?? "";
const imageSrc = () => host.querySelector("img")?.getAttribute("src") ?? null;
const pdfSrc = () => host.querySelector("iframe")?.getAttribute("src") ?? null;

function buttons() {
  return [...host.querySelectorAll("button")];
}

async function click(label: string) {
  const el = buttons().find((b) => (b.textContent ?? "").includes(label));
  if (!el) throw new Error(`No button reading "${label}". Buttons: ${buttons().map((b) => b.textContent).join(" | ")}`);
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  await flush();
}

/** The shortcuts are bound on the window, so that is where the key is pressed. */
async function press(init: KeyboardEventInit) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })); });
  await flush();
  await flush();
}

/**
 * The same chord, pressed with the cursor IN a box. It bubbles to the same window listener, but
 * carries the field as its target — which is the whole difference between saving the grade and
 * sending the work back, and between skipping and moving the caret.
 */
async function pressIn(selector: string, init: KeyboardEventInit) {
  const el = host.querySelector(selector);
  if (!el) throw new Error(`No field ${selector}`);
  await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })); });
  await flush();
  await flush();
}

const fieldValue = (selector: string) =>
  (host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? null;

/** React listens on the native input event, so the value has to be set the way the browser does. */
async function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

describe("the grading queue", () => {
  it("reads class, then homework, then the students waiting", async () => {
    await mount();

    expect(text()).toContain("Math Junior 3");
    expect(text()).toContain("Quadratics, week 3");
    expect(text()).toContain("Circles, week 4");
    expect(text()).toContain("Dilnoza S.");
    expect(text()).toContain("Eldor U.");
    expect(text()).toContain("Kamila N.");
    // Work already checked is not work waiting.
    expect(text()).not.toContain("Nodira");
    // Every waiting student is listed here, so nothing claims to be hidden.
    expect(text()).not.toContain("more waiting");
  });

  it("says how many students the queue did not list", async () => {
    // The server lists at most twelve per homework while `waiting` stays the true total, so a
    // "14 to check" above one name has to say where the other thirteen are.
    const klass = TODAY.grading_queue[0];
    teacherToday.mockResolvedValue({
      ...TODAY,
      grading_queue: [
        { ...klass, waiting: 16, assignments: [klass.assignments[0], { ...klass.assignments[1], waiting: 14 }] },
      ],
    });
    await mount();

    expect(text()).toContain("+13 more waiting");
  });

  it("opens the longest-waiting student of the first homework by itself", async () => {
    await mount();
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
  });
});

describe("the work itself", () => {
  it("shows the file the student uploaded", async () => {
    await mount();

    expect(text()).toContain("dilnoza-quadratics.jpg");
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
  });

  it("shows a pdf in its viewer when that is what came in", async () => {
    await mount();
    await click("Eldor U.");

    expect(text()).toContain("eldor-quadratics.pdf");
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });
});

describe("saving a grade", () => {
  it("calls the endpoint with the revision that submission was handed", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");
    await type("#grading-feedback", "Clear working.");
    await click("Save");

    expect(gradeSubmission).toHaveBeenCalledTimes(1);
    expect(gradeSubmission).toHaveBeenCalledWith(501, {
      grade: "92",
      feedback: "Clear working.",
      expected_revision: 4,
    });
  });

  it("moves to the next student waiting, with no list in between", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");
    await click("Save");

    // Eldor's pdf is on screen, and Dilnoza's jpg is gone: the next piece of work opened itself.
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
    expect(imageSrc()).toBeNull();
  });

  it("tells the teacher when another teacher got there first, and stays put", async () => {
    gradeSubmission.mockRejectedValueOnce({
      response: { status: 409, data: { detail: "Submission was modified. Refresh and try again.", revision: 5 } },
    });
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");
    await click("Save");

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent ?? "").toContain("Another teacher saved this one");
    // Not moved on: the work that did not save is still the work on screen.
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
  });

  it("saves and moves on from the keyboard", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "74");
    await press({ key: "Enter", metaKey: true });

    expect(gradeSubmission).toHaveBeenCalledWith(501, { grade: "74", feedback: "", expected_revision: 4 });
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });

  it("skips from the keyboard too", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await press({ key: "ArrowRight", ctrlKey: true });

    expect(gradeSubmission).not.toHaveBeenCalled();
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });

  it("skips without grading anything", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await click("Skip for now");

    expect(gradeSubmission).not.toHaveBeenCalled();
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });
});

describe("the walk from one homework to the next", () => {
  const stop = (assignmentId: number, title: string) => ({
    classId: 1, className: "Math Junior 3", assignmentId, title, waiting: 1,
  });
  const STOPS = [stop(87, "Warm-up"), stop(88, "Quadratics, week 3"), stop(90, "Circles, week 4")];

  it("goes to the following homework in the queue's own order", () => {
    expect(nextStopAfter(STOPS, 1, 88, 1)?.assignmentId).toBe(90);
    expect(nextStopAfter(STOPS, 1, 90, 2)).toBeNull();
  });

  it("resumes where a finished homework stood, never back at the top", () => {
    // Grading the last waiting piece of 88 takes it out of the queue, so the refetched queue no
    // longer has it. Walking from the top would send the teacher back to 87, which they have
    // already worked through; the successor slid into 88's old index instead.
    const afterRefetch = [stop(87, "Warm-up"), stop(90, "Circles, week 4")];
    expect(nextStopAfter(afterRefetch, 1, 88, 1)?.assignmentId).toBe(90);
  });
});

describe("sending the work back for another go", () => {
  it("calls the return endpoint with the note and the revision, and moves on", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-return-note", "Redo question 4 — show the working.");
    await click("Send back");

    expect(returnSubmission).toHaveBeenCalledTimes(1);
    expect(returnSubmission).toHaveBeenCalledWith(501, {
      note: "Redo question 4 — show the working.",
      expected_revision: 4,
    });
    expect(gradeSubmission).not.toHaveBeenCalled();
    // The next student waiting opened by itself, the same as after a grade.
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });

  it("tells the teacher when another teacher got there first, and stays put", async () => {
    returnSubmission.mockRejectedValueOnce({
      response: { status: 409, data: { detail: "Submission was modified. Refresh and try again." } },
    });
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-return-note", "Redo question 4.");
    await click("Send back");

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent ?? "").toContain("Another teacher saved this one");
    // Not moved on: the work that did not go back is still the work on screen.
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
  });

  it("is what ⌘↵ does from inside the note box — never a grade", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-return-note", "Have another go at the last two.");
    await pressIn("#grading-return-note", { key: "Enter", metaKey: true });

    // The gesture the page advertises beside that box must send the work back. Marking it
    // instead would tell the student their work had been checked and throw the note away.
    expect(returnSubmission).toHaveBeenCalledWith(501, {
      note: "Have another go at the last two.",
      expected_revision: 4,
    });
    expect(gradeSubmission).not.toHaveBeenCalled();
  });
});

describe("the teacher's typing", () => {
  it("is not thrown away by ⌘→ while they are writing feedback", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-feedback", "Good start on the discriminant, but");
    await pressIn("#grading-feedback", { key: "ArrowRight", metaKey: true });

    // In a textarea that chord is the system's "caret to end of line". Skipping on it would
    // move to the next student and clear the box, losing half a sentence with nothing saved.
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
    expect(fieldValue("#grading-feedback")).toBe("Good start on the discriminant, but");
  });

  it("posts one grade for two quick ⌘↵, not two", async () => {
    let release: (v: unknown) => void = () => {};
    gradeSubmission.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");

    // Both presses land before the first save comes back — the button is disabled while busy,
    // the keyboard is not.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }));
    });
    expect(gradeSubmission).toHaveBeenCalledTimes(1);

    await act(async () => { release({}); });
    await flush();
    await flush();

    // A second post would have come back 409 and painted "another teacher saved this one" over
    // Eldor's work — a falsehood about the piece the teacher is now looking at.
    expect(gradeSubmission).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });

  it("is not moved on by ⌘→ while a save is still in flight", async () => {
    let release: (v: unknown) => void = () => {};
    gradeSubmission.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }));
    });
    await press({ key: "ArrowRight", ctrlKey: true });
    // The skip is refused: the save that is still out will advance when it lands, and a skip in
    // between would be overridden by it.
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");

    await act(async () => { release({}); });
    await flush();
    await flush();
    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
  });

  it("survives a 409, with the other teacher's review shown beside it", async () => {
    let dilnoza: Record<string, unknown> = DILNOZA;
    listSubmissions.mockImplementation(async (_classId: number, assignmentId: number) =>
      assignmentId === 88 ? [dilnoza, ELDOR, NODIRA] : [KAMILA],
    );
    gradeSubmission.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Submission was modified." } } });

    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await type("#grading-score", "92");
    await type("#grading-feedback", "Working is clear all the way down.");
    // What the colleague saved, which the post-409 refetch brings back.
    dilnoza = { ...DILNOZA, revision: 5, review: { grade: 55, feedback: "Half of question 4 is missing." } };
    await click("Save");

    expect(fieldValue("#grading-score")).toBe("92");
    expect(fieldValue("#grading-feedback")).toBe("Working is clear all the way down.");
    expect(text()).toContain("What the other teacher saved");
    expect(text()).toContain("Half of question 4 is missing.");
  });
});

describe("the deep link", () => {
  it("reads class, homework and student out of the address", () => {
    const params = new URLSearchParams("class=1&homework=88&student=12");
    expect(selectionFromParams((k) => params.get(k))).toEqual({ classId: 1, assignmentId: 88, studentId: 12 });
    // A student without their homework cannot be found, and junk is no selection at all.
    expect(selectionFromParams(() => "nonsense")).toEqual({ classId: null, assignmentId: null, studentId: null });
  });

  it("opens exactly that student's work", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 12 });

    expect(pdfSrc()).toBe("https://files.mastersat.uz/hw/eldor-quadratics.pdf");
    expect(imageSrc()).toBeNull();
    expect(listSubmissions).toHaveBeenCalledWith(1, 88);
  });

  it("writes what is on screen back into the address", async () => {
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });
    await click("Eldor U.");

    // A teacher sends a colleague a link to a piece of work by copying the address bar, so the
    // address has to name the student actually open.
    expect(window.location.search).toBe("?class=1&homework=88&student=12");
  });

  it("opens the first homework of a class named without one", async () => {
    // `?class=<id>` alone is what a link pointing at a whole class carries. It must land on
    // something to grade, not on "Pick a student from the queue".
    await mount({ classId: 1, assignmentId: null, studentId: null });

    expect(listSubmissions).toHaveBeenCalledWith(1, 88);
    expect(imageSrc()).toBe("https://files.mastersat.uz/hw/dilnoza-quadratics.jpg");
    expect(text()).not.toContain("Pick a student from the queue");
  });
});

describe("a load that fails", () => {
  it("says the queue failed and offers the retry — never 'nothing to grade'", async () => {
    teacherToday.mockRejectedValue({ response: { status: 500 } });
    await mount();

    expect(text()).toContain("The queue didn't load");
    expect(text()).not.toContain("Nothing waiting");
    expect(buttons().some((b) => (b.textContent ?? "").includes("Try again"))).toBe(true);
  });

  it("retries the queue when asked", async () => {
    teacherToday.mockRejectedValueOnce({ response: { status: 500 } });
    await mount();
    expect(text()).toContain("The queue didn't load");

    teacherToday.mockResolvedValue(TODAY);
    await click("Try again");

    expect(text()).toContain("Quadratics, week 3");
    expect(text()).not.toContain("The queue didn't load");
  });

  it("says so when the work of an open homework fails to load", async () => {
    listSubmissions.mockRejectedValue({ response: { status: 500 } });
    await mount({ classId: 1, assignmentId: 88, studentId: 11 });

    expect(text()).toContain("didn't load");
    expect(text()).not.toContain("Nothing waiting to be checked");
    expect(buttons().some((b) => (b.textContent ?? "").includes("Try again"))).toBe(true);
  });
});
