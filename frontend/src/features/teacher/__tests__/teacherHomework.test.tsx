/**
 * /teacher/homework — one list, the homework that needs a teacher first.
 *
 * Three things are held still here.
 *
 * The four branches: a load still running, a load that FAILED, a teacher with no assignments,
 * and assignments in hand. The middle two are the pair this product keeps confusing — "No
 * assignments yet" over a 500 tells a teacher their classes did nothing all week — so each one
 * is asserted to be itself AND asserted not to be the other.
 *
 * The chips. A page in this repo recently lost a state by replacing two chips with one verdict,
 * and a struck-off paper read as a pass. This page shows five — three mutually exclusive health
 * cases and two independent flags — so every one of them is driven here, from a model that
 * contains all five at once.
 *
 * The ordering, which is the whole reason the page was rewritten. The list answers "which
 * homework needs me?" by its order, so the order is pinned row by row, including the case it
 * exists to get right: homework that is past due with everyone's work already in owes the
 * teacher nothing and must NOT be dragged to the top by its flag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const api = vi.hoisted(() => ({ list: vi.fn(), getInterventions: vi.fn(), getLeaderboard: vi.fn() }));
/** The boot state the page is asked to render against; mutable, because one case is signed out. */
const boot = vi.hoisted(() => ({ state: "AUTHENTICATED" }));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: boot.state }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className, style }: { children: ReactNode; href: string; className?: string; style?: Record<string, unknown> }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

const { TeacherHomework } = await import("../TeacherHomework");
type Model = Parameters<typeof TeacherHomework>[0]["previewModel"];
type Assignment = NonNullable<Model>["assignments"][number];

/** An assignment row exactly as `useTeacherAnalytics` builds one. */
function assignment(over: Partial<Assignment> & Pick<Assignment, "id" | "title" | "classId" | "className" | "effectiveness">): Assignment {
  return {
    completionPct: 80, submitted: 8, total: 10,
    isAssessment: false, isOverdue: false, groupMean: 1300, createdMs: null,
    ...over,
  };
}

/**
 * Deadlines are absolute rather than offsets from the clock: the suite runs in Asia/Tashkent
 * (see vitest.config.ts), so a fixed instant renders as a fixed string and the labels below can
 * be read literally. `isOverdue` is a flag the server sets, not something the page derives from
 * these, so a past deadline and a false flag never contradict each other here.
 */
const JAN_15 = Date.UTC(2026, 0, 15);
const FEB_10 = Date.UTC(2026, 1, 10);
const MAR_4 = Date.UTC(2026, 2, 4);
const MAR_20 = Date.UTC(2026, 2, 20);
const MAR_25 = Date.UTC(2026, 2, 25);

/**
 * Two classes, and one assignment per health case plus the two flags, so a single mount can be
 * asked whether each chip has somewhere to appear — and one assignment per band of the ranking,
 * so the same mount pins the order.
 */
const ALGEBRA_ID = 1;
const READING_ID = 2;
const MODEL: NonNullable<Model> = {
  classCount: 2,
  totalStudents: 5,
  atRiskCount: 1,
  watchCount: 1,
  classes: [
    { id: ALGEBRA_ID, name: "Algebra 2", students: 3, reviewAvg: 72, completion: 80, atRisk: 1 },
    { id: READING_ID, name: "Reading B", students: 2, reviewAvg: 84, completion: 91, atRisk: 0 },
  ],
  students: [],
  assignments: [
    // Deliberately NOT in the order the page must show them in.
    assignment({ id: 101, title: "Linear equations", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "healthy", completionPct: 92, submitted: 22, total: 24, groupMean: null, createdMs: MAR_4 }),
    assignment({ id: 102, title: "Quadratics drill", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "challenging", completionPct: 76, submitted: 19, total: 25, groupMean: 1240, createdMs: MAR_25 }),
    assignment({ id: 103, title: "Percentages quiz", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "low-completion", completionPct: 41, submitted: 10, total: 24, isAssessment: true, isOverdue: true, groupMean: 1180, createdMs: FEB_10 }),
    assignment({ id: 201, title: "Inferences set", classId: READING_ID, className: "Reading B", effectiveness: "healthy", completionPct: 88, submitted: 15, total: 17 }),
    assignment({ id: 202, title: "Vocabulary set 3", classId: READING_ID, className: "Reading B", effectiveness: "low-completion", completionPct: 38, submitted: 7, total: 18, groupMean: null, createdMs: MAR_20 }),
    // Past due, and every student's work is already in. Nothing is owed, so its flag must not
    // carry it to the top.
    assignment({ id: 203, title: "Reading log", classId: READING_ID, className: "Reading B", effectiveness: "healthy", completionPct: 100, submitted: 17, total: 17, isOverdue: true, groupMean: 1350, createdMs: JAN_15 }),
  ],
  classAvgTrend: [],
  recommendations: [],
};

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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  if (!done()) throw new Error("never settled");
}

const text = () => host.textContent ?? "";
const alert = () => host.querySelector('[role="alert"]');
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}
/** Every row on the page, as the text inside its link. */
const rows = () => [...host.querySelectorAll("a")].map((a) => a.textContent ?? "");
/** The titles the rows lead with, top to bottom — the page's answer to "which needs me?". */
const order = () => [...host.querySelectorAll("a")].map((a) => a.querySelector("p")?.textContent ?? "");
/** The text of the one row whose title is `title`, or null. */
function rowFor(title: string) {
  return [...host.querySelectorAll("a")].find((a) => a.querySelector("p")?.textContent === title)?.textContent ?? null;
}
/** Where the one row whose title is `title` goes, or null. */
function hrefFor(title: string) {
  return [...host.querySelectorAll("a")].find((a) => a.querySelector("p")?.textContent === title)?.getAttribute("href") ?? null;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  boot.state = "AUTHENTICATED";
  api.list.mockResolvedValue({ items: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
});

describe("homework — while the model is still loading", () => {
  it("shows neither assignments nor a failure, only the placeholder", async () => {
    // A promise that never settles: the pending state, held still.
    api.list.mockReturnValue(new Promise(() => {}));
    await mount(<TeacherHomework />);

    expect(alert()).toBeNull();
    expect(text()).not.toContain("No assignments yet");
    expect(text()).not.toContain("Couldn’t load");
    // The region says it is working, which is what a screen reader hears and what the shared
    // load-failure suite watches to know this page has not settled yet.
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    // And the placeholder's own shape — eight row-sized blocks, carrying the product's shared
    // shimmer class, which is the other marker that suite settles on.
    const blocks = [...host.querySelectorAll<HTMLElement>(".ds-skeleton")].filter((d) => d.style.height === "44px");
    expect(blocks).toHaveLength(8);
  });
});

describe("homework — when the model does not load", () => {
  it("says the request failed, and never that there are no assignments", async () => {
    api.list.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500, data: "<!doctype html>" } }));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);

    expect(text()).toContain("Couldn’t load your assignments");
    expect(text()).toContain("Your assignments and their submissions are unchanged — only this page failed to load.");
    // The whole point of the branch order — against BOTH of the page's empty wordings.
    expect(text()).not.toContain("No assignments yet");
    expect(text()).not.toContain("No assignments in this class yet");
    // Django's HTML error page is not a reason to show anyone.
    expect(text()).not.toContain("doctype");
    expect(buttons()).toContain("Try again");
  });

  it("shows the server's reason when it gave one", async () => {
    const detail = "You do not have permission to perform this action.";
    api.list.mockRejectedValue(Object.assign(new Error("forbidden"), { response: { status: 403, data: { detail } } }));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);

    expect(text()).toContain(detail);
    expect(text()).not.toContain("only this page failed to load");
  });

  it("asks again when the retry is pressed", async () => {
    api.list.mockRejectedValue(new Error("network"));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);
    const before = api.list.mock.calls.length;

    await act(async () => button("Try again").click());
    await until(() => api.list.mock.calls.length > before);

    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("homework — when there is nothing to show", () => {
  it("gives the reason, and is not dressed up as a failure", async () => {
    api.list.mockResolvedValue({ items: [] });
    await mount(<TeacherHomework />);
    await until(() => text().includes("No assignments yet"));

    expect(text()).toContain("Assignment health appears here once you assign work.");
    expect(alert()).toBeNull();
    expect(buttons()).not.toContain("Try again");
  });

  it("asks a signed-out reader to sign in, rather than reporting an empty week", async () => {
    boot.state = "UNAUTHENTICATED";
    await mount(<TeacherHomework />);

    expect(text()).toContain("Sign in with a teacher account");
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
  });
});

describe("homework — the order, which is the page's answer", () => {
  it("leads with what a teacher is holding up, band by band, then by deadline", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(order()).toEqual([
      // Past due with work still missing — the sharpest call on a teacher, oldest debt first.
      "Percentages quiz",
      // Under half turned in, deadline still ahead.
      "Vocabulary set 3",
      // It came back, and the class scored below its own practice average.
      "Quadratics drill",
      // Nothing outstanding, soonest deadline first…
      "Reading log",
      "Linear equations",
      // …and an assignment with no deadline cannot be ranked by one, so it goes last.
      "Inferences set",
    ]);
  });

  it("does not drag a past-due assignment up when every student's work is already in", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // "Reading log" is overdue AND 17/17. It keeps the flag, and it sits in the bottom band —
    // ranking on the flag alone would have put it first and buried the work that is missing.
    expect(rowFor("Reading log")).toContain("Past due");
    expect(order().indexOf("Reading log")).toBeGreaterThan(order().indexOf("Quadratics drill"));
  });

  it("keeps both headline counts readable under the title, over every class", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // The two figures the old page carried as cards: "Below 50% turned in" and "Group mean below
    // class average". Merged into one they stopped being answerable — a teacher asking "how many
    // did the class find hard?" had to count chips down the list.
    expect(text()).toContain("6 assignments across 2 classes · 2 under half turned in, 1 below the class average.");
  });

  it("says a count of nothing as a word, and still says both of them", async () => {
    const calm = { ...MODEL, assignments: [MODEL.assignments[0]], classCount: 1, classes: [MODEL.classes[0]] };
    await mount(<TeacherHomework previewModel={calm} />);

    expect(text()).toContain("1 assignment across 1 class · none under half turned in, none below the class average.");
  });

  /**
   * The model holds what came back and what it averaged. It does not hold what has been MARKED,
   * and this page is the door into the classroom Grading section where the manual share of a
   * homework's grade is entered. So the page may rank what it can see and must not reassure a
   * teacher about what it cannot: with manual grading on, every upload in and no deadline gone,
   * a "nothing is waiting on you" would be printed at its most confident with the marking queue
   * at its fullest.
   */
  it("never tells a teacher nothing is waiting on them — it cannot see the marking queue", async () => {
    const calm = { ...MODEL, assignments: [MODEL.assignments[0]], classCount: 1, classes: [MODEL.classes[0]] };
    await mount(<TeacherHomework previewModel={calm} />);
    expect(text()).not.toContain("waiting on you");
    expect(text()).not.toContain("need you first");
    expect(text()).not.toContain("needs you first");
    await act(async () => root.unmount());
    host.remove();

    await mount(<TeacherHomework previewModel={MODEL} />);
    expect(text()).not.toContain("waiting on you");
    expect(text()).not.toContain("need you first");
  });
});

describe("homework — what a row says", () => {
  it("lists every assignment with its class", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(rows().length).toBe(6);
    expect(rowFor("Linear equations")).toContain("Algebra 2");
    expect(rowFor("Inferences set")).toContain("Reading B");
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
  });

  it("shows each of the five chips somewhere — the three health cases and the two flags", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // Each health case on the row that has it, so a chip cannot pass this by appearing anywhere.
    expect(rowFor("Linear equations")).toContain("Healthy");
    expect(rowFor("Quadratics drill")).toContain("Challenging");
    expect(rowFor("Percentages quiz")).toContain("Low completion");
    // And the two flags, which are not a verdict on the health chip and stand beside it.
    expect(rowFor("Percentages quiz")).toContain("Assessment");
    expect(rowFor("Percentages quiz")).toContain("Past due");
    // A healthy assignment that is neither carries neither.
    expect(rowFor("Linear equations")).not.toContain("Assessment");
    expect(rowFor("Linear equations")).not.toContain("Past due");
  });

  it("prints how much came back as a count, and the group mean", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(rowFor("Linear equations")).toContain("22/24 turned in");
    expect(rowFor("Quadratics drill")).toContain("1240");
  });

  it("reads a group mean nobody has yet as an em dash, never as a zero", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // "Linear equations" has groupMean: null. A 0 here reads as a class that answered everything
    // wrong, which is the opposite of what the server said.
    expect(rowFor("Linear equations")).toContain("—");
    expect(rowFor("Linear equations")).not.toContain("Avg 0");
  });

  it("prints the deadline, and says plainly when there is not one", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(rowFor("Linear equations")).toContain("Due Mar 4");
    // `createdMs` is null on this one. An absent deadline is its own fact, never a blank.
    expect(rowFor("Inferences set")).toContain("No due date");
  });
});

describe("homework — where a row goes", () => {
  it("opens the class's own Grading section on that homework, as a real link", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // An anchor, not a click handler: cmd-click and middle-click open a second one, and the
    // keyboard reaches it at all. The manual mark is entered inside the classroom, not on the
    // panel-wide grading screen, so that is where the row lands.
    expect(hrefFor("Percentages quiz")).toBe("/teacher/classrooms/1?tab=grading&assignment=103");
    expect(hrefFor("Inferences set")).toBe("/teacher/classrooms/2?tab=grading&assignment=201");
    expect([...host.querySelectorAll("a")]).toHaveLength(6);
  });

  it("leaves the homework off the link when the server gave no id for it", async () => {
    // `useTeacherAnalytics` falls back to 0 when a completion row carries no `assignment_id`.
    // The classroom refuses a 0 anyway; sending one would put a meaningless number in the bar.
    const noId = { ...MODEL, assignments: [assignment({ ...MODEL.assignments[0], id: 0 })] };
    await mount(<TeacherHomework previewModel={noId} />);

    expect(hrefFor("Linear equations")).toBe("/teacher/classrooms/1?tab=grading");
  });
});

describe("homework — the class filter", () => {
  it("narrows to one class, and back to all of them", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);
    expect(rows().length).toBe(6);

    await act(async () => button("Reading B").click());
    expect(rows().length).toBe(3);
    expect(rowFor("Inferences set")).not.toBeNull();
    expect(text()).not.toContain("Linear equations");

    await act(async () => button("All classes").click());
    expect(rows().length).toBe(6);
    expect(text()).toContain("Linear equations");
  });

  it("keeps the ranking inside one class", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);
    await act(async () => button("Reading B").click());

    expect(order()).toEqual(["Vocabulary set 3", "Reading log", "Inferences set"]);
  });

  it("keeps the class chips out of the way of a teacher with one class", async () => {
    const one = { ...MODEL, classCount: 1, classes: [MODEL.classes[0]], assignments: MODEL.assignments.filter((a) => a.classId === ALGEBRA_ID) };
    await mount(<TeacherHomework previewModel={one} />);

    expect(buttons()).not.toContain("All classes");
    expect(buttons()).not.toContain("Algebra 2");
    // The Show filter is not about having more than one class, so it stays.
    expect(buttons()).toEqual(["All", "Needs attention", "Healthy"]);
  });

  it("says a class has nothing in its own words, not the empty page's and not a failure's", async () => {
    const quiet = { ...MODEL, assignments: MODEL.assignments.filter((a) => a.classId === ALGEBRA_ID) };
    await mount(<TeacherHomework previewModel={quiet} />);

    await act(async () => button("Reading B").click());

    expect(text()).toContain("No assignments in this class yet");
    expect(text()).toContain("Choose another class, or All classes.");
    // Reading B having none is not the same as the teacher having none, and not the same as a 500.
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
    // And the chips are still there to be undone.
    expect(buttons()).toEqual(expect.arrayContaining(["All classes", "Algebra 2"]));
  });
});

/**
 * The Show filter. Ordering is not filtering: the ranking lifts the work that needs a teacher,
 * but only this can take the rest off the page, which is what a teacher wanting to read the work
 * that is running on its own is asking for.
 */
describe("homework — the Show filter", () => {
  it("narrows to the work that needs a teacher, and back to all of it", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);
    expect(rows().length).toBe(6);

    await act(async () => button("Needs attention").click());
    expect(order()).toEqual(["Percentages quiz", "Vocabulary set 3", "Quadratics drill"]);

    await act(async () => button("All").click());
    expect(rows().length).toBe(6);
  });

  it("hides the work that needs a teacher, which is the half with no other way to ask for it", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    await act(async () => button("Healthy").click());

    expect(order()).toEqual(["Reading log", "Linear equations", "Inferences set"]);
    expect(text()).not.toContain("Percentages quiz");
  });

  /**
   * The filter is defined on the ranking's bands, not on the health chip, and this is the row
   * where those two disagree: the class scored fine, so the chip reads "Healthy", but the
   * deadline has gone with work still missing, so the list leads with it. A chip-only test would
   * have made the top row of All vanish under "Needs attention".
   */
  it("keeps a past-due row with work still missing, whatever its health chip says", async () => {
    const chased = {
      ...MODEL,
      assignments: [assignment({ id: 301, title: "Essay draft", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "healthy", completionPct: 71, submitted: 17, total: 24, isOverdue: true, createdMs: FEB_10 })],
    };
    await mount(<TeacherHomework previewModel={chased} />);
    expect(rowFor("Essay draft")).toContain("Healthy");

    await act(async () => button("Needs attention").click());
    expect(order()).toEqual(["Essay draft"]);

    await act(async () => button("Healthy").click());
    expect(text()).not.toContain("Essay draft");
  });

  it("names the control that emptied the list, and only controls the page drew", async () => {
    const allChased = { ...MODEL, assignments: MODEL.assignments.filter((a) => a.effectiveness !== "healthy"), classCount: 1, classes: [MODEL.classes[0]] };
    await mount(<TeacherHomework previewModel={allChased} />);

    await act(async () => button("Healthy").click());

    expect(text()).toContain("No assignments match");
    // One class, so there are no class chips on the page and the hint must not send anyone to them.
    expect(text()).toContain("Switch Show back to All.");
    expect(text()).not.toContain("choose another class");
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
  });

  it("names both controls when both of them narrowed the list", async () => {
    // Without "Linear equations", every Algebra 2 row needs a teacher, so Healthy empties it.
    const chased = { ...MODEL, assignments: MODEL.assignments.filter((a) => a.title !== "Linear equations") };
    await mount(<TeacherHomework previewModel={chased} />);

    await act(async () => button("Algebra 2").click());
    await act(async () => button("Healthy").click());

    expect(rows()).toHaveLength(0);
    expect(text()).toContain("No assignments match");
    expect(text()).toContain("Switch Show back to All, or choose another class.");
    // Both named controls are on the page to be pressed.
    expect(buttons()).toEqual(expect.arrayContaining(["All", "All classes"]));
  });
});

/**
 * A teacher who has a class and has not set homework yet. `useTeacherAnalytics` calls a teacher
 * "empty" only when they have no CLASSES, so this one arrives at "ready" with an empty list —
 * and used to land in the class filter's state, told to press chips the page had not drawn.
 */
describe("homework — a teacher with classes and no homework yet", () => {
  it("says they have not assigned any, not that a filter hid it", async () => {
    await mount(<TeacherHomework previewModel={{ ...MODEL, assignments: [] }} />);

    expect(text()).toContain("No assignments yet");
    expect(text()).toContain("Assignment health appears here once you assign work.");
    expect(text()).not.toContain("No assignments in this class yet");
    expect(text()).not.toContain("Choose another class");
    expect(text()).not.toContain("Switch Show back to All");
    expect(alert()).toBeNull();
  });

  it("offers no filters over nothing, and counts nothing", async () => {
    await mount(<TeacherHomework previewModel={{ ...MODEL, assignments: [] }} />);

    // Not a chip, not a Show option, not a "Try again" — there is one thing to do and it is not
    // on this page.
    expect(buttons()).toHaveLength(0);
    expect(text()).toContain("0 assignments across 2 classes.");
    expect(text()).not.toContain("under half turned in");
  });
});
