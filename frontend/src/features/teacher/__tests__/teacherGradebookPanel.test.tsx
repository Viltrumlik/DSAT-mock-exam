import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseAssignmentList, parseClassroomList } from "@/lib/criticalApiContract";
import { TONE_INK, TONE_WASH, type Tone } from "../ui";
import type { Cell, GradebookModel, StudentRow } from "../useGradebook";

/**
 * `/teacher/gradebook` in the teacher panel's own look: what the page still does after the port.
 *
 * The page carries one of the four jobs the teachers named — checking results — so the thing
 * worth guarding is that nothing it could say was lost in the restyle:
 *
 * - the four branches, with the failed one checked before the empty one, so a class whose
 *   gradebook answered a 500 is never drawn as a class that did nothing;
 * - every state a cell can show. Six of them share three glyphs and four tones, and a chip that
 *   quietly loses a state is how a struck-off paper once read as a pass in this codebase;
 * - the running average and the count of work not turned in, in the words the product uses;
 * - the class switcher, and the student column that stays put while the homework scrolls past it.
 *
 * The Trend column has its own file (teacherGradebookTrendCell.test.tsx); the loads that fail
 * have theirs (teacherLoadErrors.test.tsx). Neither is repeated here.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  people: vi.fn(),
  listAssignments: vi.fn(),
  listSubmissions: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { TeacherGradebook } = await import("../TeacherGradebook");

/* ------------------------------------------------------------------ the wire, for the load tests */

const ALGEBRA = { id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "JOIN1", my_role: "TEACHER" };
const GEOMETRY = { id: 2, name: "Geometry", subject: "MATH", lesson_days: "EVEN", join_code: "JOIN2", my_role: "TEACHER" };

type Person = { id: number; first_name: string; last_name: string };
const TEACHER: Person = { id: 9, first_name: "The", last_name: "Teacher" };
const FIRST: Person = { id: 11, first_name: "First", last_name: "Student" };
const SECOND: Person = { id: 12, first_name: "Second", last_name: "Student" };
const THIRD: Person = { id: 21, first_name: "Third", last_name: "Student" };

const STUDENTS: Record<number, Person[]> = { 1: [FIRST, SECOND], 2: [THIRD] };
const HOMEWORK: Record<number, number[]> = { 1: [102, 101], 2: [201] };
const TURNED_IN: Record<number, Person[]> = { 101: [FIRST, SECOND], 102: [FIRST, SECOND], 201: [THIRD] };

function submission(assignmentId: number, student: Person) {
  return {
    id: assignmentId * 100 + student.id,
    status: "SUBMITTED",
    workflow_status: "SUBMITTED",
    revision: 1,
    submitted_at: "2026-09-12T20:00:00+05:00",
    student,
    review: null,
  };
}

/** Every request answers, the lists through the real contract parsers. */
function serve(classrooms = [ALGEBRA, GEOMETRY]) {
  api.list.mockImplementation(async () => parseClassroomList(classrooms, "GET /classes/"));
  api.people.mockImplementation(async (classId: number) => [
    { id: 900 + classId, role: "TEACHER", status: "ACTIVE", user: TEACHER },
    ...STUDENTS[classId].map((user) => ({ id: 1000 + user.id, role: "STUDENT", status: "ACTIVE", user })),
  ]);
  api.listAssignments.mockImplementation(async (classId: number) =>
    parseAssignmentList(
      HOMEWORK[classId].map((id) => ({ id, title: `Homework ${id}`, status: "PUBLISHED", created_at: "2026-09-10T09:00:00+05:00" })),
      `GET /classes/${classId}/assignments/`,
    ),
  );
  api.listSubmissions.mockImplementation(async (_classId: number, assignmentId: number) =>
    TURNED_IN[assignmentId].map((student) => submission(assignmentId, student)),
  );
}

/** How axios rejects when the server answers with an error status. */
function httpError(status: number, data: unknown = "<!doctype html><title>Server Error (500)</title>") {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

/* ---------------------------------------------------- a model, for what the page draws from one */

const COLUMNS = [101, 102, 103, 104, 105, 106].map((id, i) => ({ id, title: `Homework ${i + 1}` }));
const cell = (assignmentId: number, status: Cell["status"], grade: number | null): Cell => ({ assignmentId, status, grade });

function student(id: number, name: string, cells: Cell[], rest: Partial<StudentRow> = {}): StudentRow {
  return { id, name, cells, average: null, trendDelta: null, missing: 0, ...rest };
}

/** One student wearing every state a cell can be in, in the order the key at the foot lists them. */
const EVERY_STATE = student(1, "Every State", [
  cell(101, "missing", null),
  cell(102, "submitted", null),
  cell(103, "graded", null),
  cell(104, "graded", 92),
  cell(105, "graded", 71),
  cell(106, "graded", 48),
], { average: 70, trendDelta: null, missing: 1 });

function model(students: StudentRow[], rest: Partial<GradebookModel> = {}): GradebookModel {
  return {
    assignments: COLUMNS,
    students,
    classAverage: 70,
    distribution: [
      { band: "0–49", count: 0 }, { band: "50–69", count: 1 },
      { band: "70–84", count: 2 }, { band: "85–100", count: 0 },
    ],
    missingCount: students.reduce((sum, s) => sum + s.missing, 0),
    ...rest,
  };
}

const ONE_CLASS = [{ id: 1, name: "Algebra 2" }];

/* ------------------------------------------------------------------------------------ harness */

let host: HTMLDivElement;
let root: Root;

async function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}

/** Turn the event loop until `done` holds. */
async function until(done: () => boolean) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("never settled");
}

const text = () => host.textContent ?? "";
/** No loading placeholder is left on the page. */
const pageSettled = () => host.querySelector(".ds-skeleton") === null;
const alerts = () => [...host.querySelectorAll("[role=alert]")].map((a) => a.textContent ?? "");
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}
/** The figure standing over this label. */
function figure(label: string) {
  return [...host.querySelectorAll("p")].find((p) => p.textContent === label)?.previousElementSibling?.textContent ?? null;
}
/** Everything in the card that carries the spread of the class's averages. */
function spread() {
  return [...host.querySelectorAll("section")].find((s) => s.querySelector("h3"))?.textContent ?? "";
}
function studentRow(name: string) {
  return [...host.querySelectorAll("tbody tr")].find((tr) => tr.querySelector(".truncate")?.textContent === name)!;
}
/** Which of the kit's tones an element is wearing, read from the tone token it was given. */
function washTone(el: Element | null): Tone | null {
  const wash = (el as HTMLElement | null)?.style.background ?? "";
  return (Object.keys(TONE_WASH) as Tone[]).find((t) => TONE_WASH[t] === wash) ?? null;
}
function inkTone(el: Element | null): Tone | null {
  const ink = (el as HTMLElement | null)?.style.color ?? "";
  return (Object.keys(TONE_INK) as Tone[]).find((t) => TONE_INK[t] === ink) ?? null;
}
/** This student's homework cells, as the teacher reads them: the glyph, and the tone behind it. */
function cellsOf(name: string) {
  const cells = [...studentRow(name).querySelectorAll("td")].slice(0, COLUMNS.length);
  return cells.map((td) => ({ text: td.textContent, tone: washTone(td.firstElementChild) }));
}
/** The Avg chip: what it prints and the tone it prints it in. */
function average(name: string) {
  const td = [...studentRow(name).querySelectorAll("td")].at(-2)!;
  return { text: td.textContent, tone: washTone(td.firstElementChild) };
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  serve();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
});

describe("TeacherGradebook — the four branches", () => {
  it("draws the class's students once it has loaded", async () => {
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(alerts()).toEqual([]);
    expect([...host.querySelectorAll("tbody tr .truncate")].map((s) => s.textContent)).toEqual(["First Student", "Second Student"]);
    expect(figure("Students")).toBe("2");
    expect(figure("Not turned in")).toBe("0");
  });

  it("a class list that did not load is an alert with a retry, never 'No classes yet'", async () => {
    api.list.mockRejectedValueOnce(httpError(500));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("Couldn’t load your classes");
    expect(text()).not.toContain("No classes yet");
    expect(text()).not.toContain("No students yet");

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(alerts()).toEqual([]);
    expect(text()).toContain("First Student");
  });

  it("a class whose gradebook did not load is an alert in its place, never 'No students yet'", async () => {
    api.people.mockRejectedValueOnce(httpError(503));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("Couldn’t load the gradebook for Algebra 2");
    expect(text()).not.toContain("No students yet");
    // Not zero, and not "nothing graded": a figure taken over a class nobody could read is unknown.
    expect(figure("Students")).toBe("—");
    expect(figure("Not turned in")).toBe("—");
    expect(spread()).not.toContain("No graded work yet");

    await act(async () => button("Try again").click());
    await until(pageSettled);

    expect(alerts()).toEqual([]);
    expect(figure("Students")).toBe("2");
  });

  it("a teacher with no classes is the empty state, and nothing is alarmed about it", async () => {
    api.list.mockResolvedValue(parseClassroomList([], "GET /classes/"));
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(alerts()).toEqual([]);
    expect(text()).toContain("No classes yet");
  });

  it("a class with nobody in it is the empty state, not an alert", async () => {
    api.people.mockResolvedValue([{ id: 901, role: "TEACHER", status: "ACTIVE", user: TEACHER }]);
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(alerts()).toEqual([]);
    expect(text()).toContain("No students yet");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("TeacherGradebook — every state a cell can show", () => {
  it("keeps all six: not turned in, waiting for a grade, graded without one, and the three bands", async () => {
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model([EVERY_STATE]) }} />);

    expect(cellsOf("Every State")).toEqual([
      { text: "–", tone: "neutral" },  // not turned in
      { text: "•", tone: "info" },     // turned in, waiting for a grade
      { text: "•", tone: "neutral" },  // graded, but no number was put on it
      { text: "92", tone: "success" }, // strong, 80+
      { text: "71", tone: "info" },    // on track, 60–79
      { text: "48", tone: "warning" }, // needs attention, under 60
    ]);
  });

  it("prints the running average in the band it falls in, and an em dash when there is none", async () => {
    const rows = [
      student(1, "No Average", EVERY_STATE.cells),
      student(2, "Needs Attention", EVERY_STATE.cells, { average: 55 }),
      student(3, "On Track", EVERY_STATE.cells, { average: 77 }),
    ];
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model(rows) }} />);

    expect(average("No Average")).toEqual({ text: "—", tone: "neutral" });
    expect(average("Needs Attention")).toEqual({ text: "55%", tone: "warning" });
    expect(average("On Track")).toEqual({ text: "77%", tone: "success" });
  });

  it("marks a student who owes work, in words a screen reader can read, and marks nobody who owes none", async () => {
    const rows = [
      student(1, "Owes Two", EVERY_STATE.cells, { missing: 2 }),
      student(2, "Owes None", EVERY_STATE.cells),
    ];
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model(rows) }} />);

    const badge = studentRow("Owes Two").querySelector("[title]")!;
    expect(badge.getAttribute("title")).toBe("2 not turned in");
    expect(badge.textContent).toBe("2!2 not turned in");
    expect(inkTone(badge)).toBe("warning");
    expect(studentRow("Owes None").querySelector("[title]")).toBeNull();
    // "Not turned in", never "Missing" or "Absent".
    expect(text()).not.toMatch(/missing|absent/i);
  });
});

describe("TeacherGradebook — reading the class", () => {
  it("stands the student column over the homework as it scrolls past", async () => {
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model([EVERY_STATE]) }} />);

    const head = host.querySelector("thead th") as HTMLElement;
    const name = host.querySelector("tbody th") as HTMLElement;
    expect([head.style.position, head.style.left]).toEqual(["sticky", "0px"]);
    expect([name.style.position, name.style.left]).toEqual(["sticky", "0px"]);
    // Opaque, or the homework scrolls straight through the name.
    expect(name.style.background).toBe("var(--dz-card)");
  });

  it("spells the spread of the class's averages out in figures, not only in bars", async () => {
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model([EVERY_STATE]) }} />);

    expect(spread()).toContain("How is the class distributed?");
    expect(spread()).toContain("50–69");
    expect(spread()).toContain("70–84");
    expect(spread()).not.toContain("No graded work yet");
  });

  it("says so when a class has been given work but none of it is graded", async () => {
    const nothingGraded = model([EVERY_STATE], {
      classAverage: null,
      distribution: [{ band: "0–49", count: 0 }, { band: "50–69", count: 0 }, { band: "70–84", count: 0 }, { band: "85–100", count: 0 }],
    });
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: nothingGraded }} />);

    expect(spread()).toContain("No graded work yet");
    expect(figure("Class average")).toBe("—");
  });

  it("keeps the key to the colours and the glyphs under the matrix that uses them", async () => {
    await mount(<TeacherGradebook preview={{ classes: ONE_CLASS, model: model([EVERY_STATE]) }} />);

    expect(text()).toContain("Strong 80+");
    expect(text()).toContain("On track 60–79");
    expect(text()).toContain("Needs attention <60");
    expect(text()).toContain("not turned in");
    expect(text()).toContain("awaiting grade");
  });

  it("switches class, and does not ask a teacher with one class to choose it", async () => {
    await mount(<TeacherGradebook />);
    await until(pageSettled);
    expect(button("Algebra 2").getAttribute("aria-pressed")).toBe("true");

    await act(async () => button("Geometry").click());
    await until(() => pageSettled() && text().includes("Third Student"));

    expect(button("Geometry").getAttribute("aria-pressed")).toBe("true");
    expect(button("Algebra 2").getAttribute("aria-pressed")).toBe("false");
    expect([...host.querySelectorAll("tbody tr .truncate")].map((s) => s.textContent)).toEqual(["Third Student"]);

    await act(async () => root.unmount());
    host.remove();
    serve([ALGEBRA]);
    await mount(<TeacherGradebook />);
    await until(pageSettled);

    expect(host.querySelector("[role=group]")).toBeNull();
    expect(text()).toContain("First Student");
  });
});
