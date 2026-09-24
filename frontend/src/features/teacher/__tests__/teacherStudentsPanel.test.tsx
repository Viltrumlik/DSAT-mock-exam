import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseClassroomList } from "@/lib/criticalApiContract";
import type { RiskLevel, StudentRecord, TeacherAnalyticsModel } from "../useTeacherAnalytics";

/**
 * /teacher/students, in the teacher panel's own kit.
 *
 * The four states this page can be in are the whole point of the file. A teacher arrives here
 * from the analytics page's "Check in with 3 at-risk students", so the page has to be honest
 * about which of the four it is in: a class list that did not load drawn as "No students yet"
 * tells that teacher their classes are gone, and a page still loading drawn as "No students
 * match" tells them their filters are wrong. Both have shipped in this product before.
 *
 * The rest is the port's contract: every filter the page had before still filters, the tile
 * still opens what is known about one student, and the filter buttons count against each
 * other's result so the number on a button is the number of tiles pressing it leaves behind.
 *
 * Students here are invented. This repository is public.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  getInterventions: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { TeacherStudents } = await import("../TeacherStudents");

function student(
  id: number, name: string, classId: number, className: string,
  row: {
    reviewAvg: number | null; completionPct: number | null; practiceAverage: number | null;
    inactiveDays: number | null; overdueCount: number; riskLevel: RiskLevel; riskReasons: string[];
  },
): StudentRecord {
  return { id, name, classId, className, assessmentLow: null, ...row };
}

// Two at risk, one to watch, two on track — and exactly one of them inactive, so each filter
// has something to leave out.
const RISKY = student(11, "Aziza Karimova", 1, "Algebra 2", { reviewAvg: 52, completionPct: 75, practiceAverage: 1020, inactiveDays: null, overdueCount: 2, riskLevel: "at-risk", riskReasons: ["2 not turned in", "Grade avg 52%"] });
const WATCHED = student(12, "Bekzod Turgunov", 1, "Algebra 2", { reviewAvg: 65, completionPct: 50, practiceAverage: null, inactiveDays: 9, overdueCount: 0, riskLevel: "watch", riskReasons: ["Inactive 9d"] });
const STEADY = student(13, "Dilnoza Rakhimova", 1, "Algebra 2", { reviewAvg: 91, completionPct: 100, practiceAverage: 1310, inactiveDays: 0, overdueCount: 0, riskLevel: "on-track", riskReasons: [] });
const NEWCOMER = student(21, "Eldor Yusupov", 2, "Geometry", { reviewAvg: null, completionPct: null, practiceAverage: null, inactiveDays: null, overdueCount: 1, riskLevel: "at-risk", riskReasons: ["1 not turned in"] });

const MODEL: TeacherAnalyticsModel = {
  classCount: 2,
  totalStudents: 4,
  atRiskCount: 2,
  watchCount: 1,
  classes: [
    { id: 1, name: "Algebra 2", students: 3, reviewAvg: 69, completion: 75, atRisk: 1 },
    { id: 2, name: "Geometry", students: 1, reviewAvg: null, completion: 0, atRisk: 1 },
  ],
  // The hook hands the list over at-risk first; the page must not re-sort it away.
  students: [RISKY, NEWCOMER, WATCHED, STEADY],
  assignments: [],
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
  for (let turn = 0; turn < 100 && !done(); turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error("never settled");
}

const text = () => host.textContent ?? "";
const loading = () => host.querySelector('[aria-busy="true"]') !== null;
const alert = () => host.querySelector('[role="alert"]');

/** A student's tile, found by the name it leads with. Only a tile puts a `<p>` inside a button. */
function tile(name: string) {
  return [...host.querySelectorAll("button")].find((b) => b.querySelector("p")?.textContent === name) ?? null;
}
const tiles = () =>
  [...host.querySelectorAll("button")]
    .map((b) => b.querySelector("p")?.textContent)
    .filter((name): name is string => !!name);

/** The value printed under `label` — tiles and the dialog both pair a label with its value. */
function stat(scope: ParentNode | null, label: string) {
  return [...(scope?.querySelectorAll("p") ?? [])].find((p) => p.textContent === label)?.nextElementSibling?.textContent ?? null;
}
/** The risk chip a tile carries. */
function chipOf(name: string) {
  const said = tile(name)?.textContent ?? "";
  return ["At risk", "Watch", "On track"].find((label) => said.includes(label)) ?? null;
}

function group(label: string) {
  return host.querySelector(`[role="group"][aria-label="${label}"]`);
}
/** One button of a filter group. A segment reads "At risk" then its count, so match the front. */
function option(groupLabel: string, label: string) {
  return [...(group(groupLabel)?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").startsWith(label))!;
}
/** The count a segment carries — what pressing it would leave on screen. */
function countOn(groupLabel: string, label: string) {
  return option(groupLabel, label).querySelector("span")?.textContent ?? null;
}
const pressed = (groupLabel: string, label: string) => option(groupLabel, label).getAttribute("aria-pressed");
async function press(groupLabel: string, label: string) {
  await act(async () => option(groupLabel, label).click());
}

const dialog = () => document.body.querySelector('[role="dialog"]');
async function open(name: string) {
  await act(async () => tile(name)!.click());
  return dialog();
}

/** A class list that answers, so the page reaches its data state through the real hook. */
function serve() {
  api.list.mockImplementation(async () =>
    parseClassroomList([{ id: 1, name: "Algebra 2", subject: "MATH", lesson_days: "ODD", join_code: "J1", my_role: "TEACHER" }], "GET /classes/"),
  );
  api.getInterventions.mockImplementation(async () => ({
    overdue_students: [], inactive_students: [], low_score_students: [], completion_summary: [],
    class_stats: { student_count: 1, assignment_count: 0, overall_completion_pct: 0, avg_assessment_score_pct: null },
  }));
  api.getLeaderboard.mockImplementation(async () => ({
    class_practice_average: null,
    students: [{ user_id: 11, first_name: "Aziza", last_name: "Karimova" }],
    assignments_summary: [],
    homework_grade_leaderboard: { class_average_review_grade: null, rows: [] },
  }));
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
  localStorage.clear();
});

describe("TeacherStudents — the four states", () => {
  it("while the load is in flight, says so: no tiles, no failure, no empty state", async () => {
    // A promise that never settles — the loading state, held still.
    api.list.mockReturnValue(new Promise(() => {}));
    await mount(<TeacherStudents />);

    expect(loading()).toBe(true);
    expect(tiles()).toEqual([]);
    expect(alert()).toBeNull();
    expect(text()).not.toContain("No students yet");
    expect(text()).not.toContain("No students match");
    // The page still says what it is while it fills.
    expect(host.querySelector("h1")?.textContent).toBe("Students");
  });

  it("a load that fails says so with a retry — and never as an empty state", async () => {
    api.list.mockRejectedValue(new Error("network"));
    await mount(<TeacherStudents />);
    await until(() => !loading());

    expect(alert()).not.toBeNull();
    expect(text()).toContain("Couldn’t load your students");
    expect(text()).toContain("Your students and their work are unchanged — only this page failed to load.");
    // The whole reason the error branch is tested before the empty one.
    expect(text()).not.toContain("No students yet");
    expect(text()).not.toContain("No students match");
    expect(tiles()).toEqual([]);
  });

  it("the retry runs the load again, and the students arrive", async () => {
    api.list.mockRejectedValueOnce(new Error("network"));
    await mount(<TeacherStudents />);
    await until(() => !loading());

    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Try again")!;
    await act(async () => retry.click());
    await until(() => !loading());

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(alert()).toBeNull();
    expect(tiles()).toEqual(["Aziza Karimova"]);
  });

  it("a teacher with no classes gets the empty state, not a failure", async () => {
    api.list.mockImplementation(async () => parseClassroomList([], "GET /classes/"));
    await mount(<TeacherStudents />);
    await until(() => !loading());

    expect(text()).toContain("No students yet");
    expect(alert()).toBeNull();
  });

  it("with students, every one of them is on the page, at-risk first", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    expect(tiles()).toEqual(["Aziza Karimova", "Eldor Yusupov", "Bekzod Turgunov", "Dilnoza Rakhimova"]);
    expect(text()).toContain("4 students · 2 at risk");
    expect(alert()).toBeNull();
    expect(text()).not.toContain("No students yet");
  });
});

describe("TeacherStudents — the catalog's preview", () => {
  it("renders the sample the owner reviews this page from, without a teacher account", async () => {
    const { SAMPLE_TEACHER_ANALYTICS } = await import("../sampleAnalytics");
    await mount(<TeacherStudents previewModel={SAMPLE_TEACHER_ANALYTICS} />);

    // /ui-catalog/students is how this page is looked at and screenshotted, so the fixture
    // behind it has to reach every branch of the tile: a student with no grades, one who has
    // been away, and one flagged for each reason.
    expect(tiles()).toHaveLength(SAMPLE_TEACHER_ANALYTICS.students.length);
    expect(chipOf("Sara Kim")).toBe("At risk");
    expect(stat(tile("Sara Kim"), "Activity")).toBe("Inactive 16d");
    expect(countOn("Risk", "At risk")).toBe(String(SAMPLE_TEACHER_ANALYTICS.atRiskCount));
  });
});

describe("TeacherStudents — what a tile says", () => {
  it("carries the student's class, grade average, turn-in rate and activity", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    expect([RISKY, WATCHED, STEADY, NEWCOMER].map((s) => [
      s.name, stat(tile(s.name), "Grade avg"), stat(tile(s.name), "Completion"), stat(tile(s.name), "Activity"), chipOf(s.name),
    ])).toEqual([
      ["Aziza Karimova", "52%", "75%", "Active", "At risk"],
      ["Bekzod Turgunov", "65%", "50%", "Inactive 9d", "Watch"],
      ["Dilnoza Rakhimova", "91%", "100%", "Active", "On track"],
      // Nothing graded and no homework is not a zero, on either figure.
      ["Eldor Yusupov", "—", "—", "Active", "At risk"],
    ]);
    expect(tile(RISKY.name)?.textContent).toContain("Algebra 2");
  });
});

describe("TeacherStudents — the filters", () => {
  it("a class chip narrows the page to that class", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    const geometry = [...(group("Class")?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Geometry")!;
    await act(async () => geometry.click());

    expect(tiles()).toEqual(["Eldor Yusupov"]);
    expect(geometry.getAttribute("aria-pressed")).toBe("true");
  });

  it("the risk filter leaves only that level", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    await press("Risk", "At risk");
    expect(tiles()).toEqual(["Aziza Karimova", "Eldor Yusupov"]);
    expect(pressed("Risk", "At risk")).toBe("true");

    await press("Risk", "Watch");
    expect(tiles()).toEqual(["Bekzod Turgunov"]);

    await press("Risk", "On track");
    expect(tiles()).toEqual(["Dilnoza Rakhimova"]);

    await press("Risk", "All");
    expect(tiles()).toHaveLength(4);
  });

  it("the activity filter separates the students who have been away", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    await press("Activity", "Inactive");
    expect(tiles()).toEqual(["Bekzod Turgunov"]);

    await press("Activity", "Active");
    expect(tiles()).toEqual(["Aziza Karimova", "Eldor Yusupov", "Dilnoza Rakhimova"]);
  });

  it("each filter button says how many students it would leave", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    expect(["All", "At risk", "Watch", "On track"].map((l) => countOn("Risk", l))).toEqual(["4", "2", "1", "1"]);
    expect(["Any", "Active", "Inactive"].map((l) => countOn("Activity", l))).toEqual(["4", "3", "1"]);
  });

  it("those counts are taken inside the other filters, not over the whole learning center", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    const geometry = [...(group("Class")?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Geometry")!;
    await act(async () => geometry.click());

    // Counting over the whole model would promise 2 at-risk students in a class that has one.
    expect(["All", "At risk", "Watch", "On track"].map((l) => countOn("Risk", l))).toEqual(["1", "1", "0", "0"]);

    await press("Activity", "Inactive");
    // Geometry's only student is active, so every risk button is now empty — and says so.
    expect(["All", "At risk", "Watch", "On track"].map((l) => countOn("Risk", l))).toEqual(["0", "0", "0", "0"]);
  });

  it("filters that match nobody are an empty state, never a failure", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);

    await press("Risk", "Watch");
    await press("Activity", "Active");

    expect(tiles()).toEqual([]);
    expect(text()).toContain("No students match");
    expect(alert()).toBeNull();
    // Still their page, and the filters are still there to widen.
    expect(text()).toContain("4 students · 2 at risk");
    expect(pressed("Risk", "Watch")).toBe("true");
  });
});

describe("TeacherStudents — one student, opened", () => {
  it("gives the figures behind the tile, and why the student is flagged", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);
    const panel = await open(RISKY.name);

    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Aziza Karimova");
    expect(["Why flagged", "Average grade", "Assignment completion", "Practice average", "Activity", "Not turned in"].map((l) => stat(panel, l))).toEqual([
      "2 not turned in · Grade avg 52%",
      "52%",
      "75%",
      "1020",
      "Active this week",
      "2 assignments",
    ]);
  });

  it("says what a student has not done yet rather than calling it zero, and counts one as one", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);
    const panel = await open(NEWCOMER.name);

    expect(["Average grade", "Practice average", "Not turned in"].map((l) => stat(panel, l))).toEqual([
      "No grades yet",
      "No practice yet",
      "1 assignment",
    ]);
    // The one thing this payload cannot answer is said, not estimated.
    expect(panel?.textContent).toContain("Per-skill data isn’t available yet");
  });

  it("an on-track student is opened too, with no reason to flag", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);
    const panel = await open(STEADY.name);

    expect(stat(panel, "Why flagged")).toBeNull();
    expect(stat(panel, "Average grade")).toBe("91%");
  });

  it("closes again, and leaves the list where it was", async () => {
    await mount(<TeacherStudents previewModel={MODEL} />);
    await press("Risk", "At risk");
    await open(RISKY.name);

    const close = [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Close")!;
    await act(async () => close.click());

    expect(dialog()).toBeNull();
    expect(tiles()).toEqual(["Aziza Karimova", "Eldor Yusupov"]);
  });
});
