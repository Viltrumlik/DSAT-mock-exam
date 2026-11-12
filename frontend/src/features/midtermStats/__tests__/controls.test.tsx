/**
 * The midterm page's controls, in the console's look: the tabs, the month picker (a native select), Download
 * PDF (busy as "Preparing…", its failure in words), Refresh, and the class drill-down's own month picker and
 * Back. Each must ask the endpoints exactly what it asked before.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomMonth, MonthlyStats, TreeLevel, TreeNode } from "../types";

const monthly = vi.fn();
const classroom = vi.fn();
const downloadBranchPdf = vi.fn();
// Two months, so the line is drawn: one point is not a trend.
const trend = vi.fn(async () => [
  { month: "2026-08", pass_rate: 80 },
  { month: "2026-09", pass_rate: 90 },
]);

vi.mock("../api", () => ({
  midtermStatsApi: {
    monthly: (...a: unknown[]) => monthly(...a),
    classroom: (...a: unknown[]) => classroom(...a),
    months: vi.fn(),
    trend: () => trend(),
    branches: vi.fn(async () => []),
    downloadBranchPdf: (...a: unknown[]) => downloadBranchPdf(...a),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));
// Recharts needs layout jsdom does not give it.
vi.mock("@/components/ui/charts", () => ({
  DonutChart: () => <div>donut</div>,
  StackedBarChart: () => <div>bars</div>,
  AreaChart: () => <div>area</div>,
}));
vi.mock("@/features/midtermReports/MidtermReportsPage", () => ({ default: () => <div>records browser</div> }));
vi.mock("@/features/midtermReports/MidtermEvidence", () => ({ MidtermEvidence: () => <div>student evidence</div> }));

import MidtermStatsPage from "../MidtermStatsPage";

const tally = {
  roster: 10,
  attended: 9,
  passed_first: 8,
  passed_retake: 1,
  failed: 1,
  absent: 0,
  pending: 0,
  retake_taken: 1,
  retake_passed: 1,
  retake_failed: 0,
  passed: 9,
  pass_rate: 90,
  attendance_rate: 90,
  first_try_share: 88.9,
  retake_share: 11.1,
  classrooms: 1,
  distinct_students: 10,
};

const node = (key: string, level: TreeLevel, id: number | null, name: string, children: TreeNode[], over: Partial<TreeNode> = {}): TreeNode => ({
  ...tally,
  key,
  level,
  id,
  name,
  children,
  child_level: children[0]?.level ?? null,
  ...over,
});

const mathClass = {
  id: 11,
  name: "Math Senior A",
  subject: "MATH",
  subject_label: "Math",
  level: "senior",
  level_label: "Senior",
  teacher: { id: 5, name: "Nodir T" },
  branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
  midterms: 1,
  ...tally,
};

const payload = (over: Partial<MonthlyStats> = {}): MonthlyStats => ({
  month: "2026-09",
  definition: { pass_rate: "passed (first sitting or retake) / all roster students", absent_counts_as: "failed", rollup: "pooled" },
  is_future: false,
  future_months: [],
  this_month: "2026-09",
  orphan_retakes: [],
  totals: { ...tally, midterms: 1 },
  branches: [{ id: 1, name: "Chilonzor", ...tally }],
  departments: [{ subject: "MATH", label: "Math", name: "Math", ...tally }],
  teachers: [{ id: 5, name: "Nodir T", subject: "MATH", subject_label: "Math", branch: "Chilonzor", ...tally }],
  classrooms: [mathClass],
  tree: [
    node("region:1", "region", 1, "Tashkent", [
      node("branch:1", "branch", 1, "Chilonzor", [
        node("department:1:MATH", "department", null, "Math", [
          node("teacher:1:MATH:5", "teacher", 5, "Nodir T", [
            node("classroom:11", "classroom", 11, "Math Senior A", [], { midterms: 1, level_label: "Senior", subject_label: "Math" }),
          ]),
          node("teacher:1:MATH:7", "teacher", 7, "Sardor U", [
            node("classroom:13", "classroom", 13, "Math 10-B", [], { midterms: 1, level_label: "Beginner", subject_label: "Math" }),
          ]),
        ]),
        node("department:1:ENGLISH", "department", null, "English", [
          node("teacher:1:ENGLISH:6", "teacher", 6, "Aziza K", [
            node("classroom:12", "classroom", 12, "English 9-B", [], { midterms: 1, level_label: "Intermediate", subject_label: "English" }),
          ]),
        ]),
      ]),
    ]),
  ],
  tree_open_path: ["region:1", "branch:1"],
  months: ["2026-09", "2026-08"],
  filters: { branch: null, subject: null, teacher: null },
  ...over,
});

const classMonth = (over: Partial<ClassroomMonth> = {}): ClassroomMonth =>
  ({
    month: "2026-09",
    months: ["2026-09", "2026-08"],
    future_months: [],
    is_future: false,
    this_month: "2026-09",
    orphan_retakes: [],
    definition: payload().definition,
    classroom: mathClass,
    summary: { ...tally, midterms: 1 },
    rows: [
      {
        id: 7,
        title: "Midterm 12",
        subject: "MATH",
        midterm_type: "MIDTERM",
        pass_mark: 500,
        score_ceiling: 800,
        month: "2026-09",
        month_basis: "schedule",
        retakes: [],
        ...tally,
      },
    ],
    ...over,
  }) as unknown as ClassroomMonth;

let root: Root;
let host: HTMLElement;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<MidtermStatsPage />);
  });
  await settle();
}
async function click(el: Element | null | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function choose(el: Element | null, value: string) {
  expect(el, "select").toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const text = () => host.textContent ?? "";
const button = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) ?? null;
const buttonWith = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(words)) ?? null;

beforeEach(() => {
  monthly.mockReset();
  classroom.mockReset();
  downloadBranchPdf.mockReset();
  monthly.mockResolvedValue(payload());
  classroom.mockResolvedValue(classMonth());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MidtermStatsPage — header controls", () => {
  it("draws the two tabs, and Class records opens the records browser without the month's controls", async () => {
    await render();
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Results", "Class records"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(button("Download PDF")).not.toBeNull();

    await click(tabs[1]);
    expect(text()).toContain("records browser");
    expect(button("Download PDF")).toBeNull();
    expect(host.querySelector('select[aria-label="Month"]')).toBeNull();
  });

  it("asks for the month picked, and goes back to where that month opens", async () => {
    await render();
    await click(buttonWith("Math"));
    expect(text()).toContain("Teachers in Math");

    const picker = host.querySelector('select[aria-label="Month"]') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["September 2026", "August 2026"]);
    monthly.mockResolvedValue(payload({ month: "2026-08" }));
    await choose(picker, "2026-08");
    expect(monthly).toHaveBeenLastCalledWith("2026-08");
    expect(text()).toContain("Departments in Chilonzor");
  });

  it("Refresh asks again for the same month", async () => {
    await render();
    const before = monthly.mock.calls.length;
    await click(button("Refresh"));
    expect(monthly.mock.calls.length).toBe(before + 1);
    expect(monthly).toHaveBeenLastCalledWith(null);
  });

  it("downloads the branch it stands in as one PDF, says Preparing… meanwhile, and names a failure", async () => {
    let finish: (v?: unknown) => void = () => {};
    downloadBranchPdf.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await render();

    const download = button("Download PDF") as HTMLButtonElement;
    expect(download.title).toBe("Download Chilonzor for September 2026 as one PDF — every department, teacher, class and student.");
    await click(download);
    expect(downloadBranchPdf).toHaveBeenCalledWith(1, "2026-09", "Chilonzor");
    expect(buttonWith("Preparing…")).not.toBeNull();
    // Busy: a second click does not start a second download.
    await click(buttonWith("Preparing…"));
    expect(downloadBranchPdf).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    await settle();
    expect(button("Download PDF")).not.toBeNull();

    downloadBranchPdf.mockRejectedValueOnce(new Error("boom"));
    await click(button("Download PDF"));
    const alert = [...host.querySelectorAll('[role="alert"]')].find((a) => a.textContent?.includes("Could not build the PDF."));
    expect(alert).toBeTruthy();
  });

  it("shows the month as cards, pictures and the drill-down, with the rules at the foot", async () => {
    await render();
    for (const words of ["Pass rate", "Passed", "Did not pass", "Students", "What happened this month", "Month by month", "Departments in Chilonzor"]) {
      expect(text()).toContain(words);
    }
    // The legend for every split bar, once.
    for (const words of ["Failed", "Did not come", "Waiting for a result"]) expect(text()).toContain(words);
    expect(text()).toContain("What these numbers mean");
  });
});

describe("ClassroomMonthPanel — inside the page", () => {
  async function openClass() {
    await render();
    await click(buttonWith("Math"));
    await click(buttonWith("Nodir T"));
    await click(buttonWith("Math Senior A"));
  }

  it("asks for the class's month, and its own picker asks for another", async () => {
    await openClass();
    expect(classroom).toHaveBeenLastCalledWith(11, "2026-09");
    expect(text()).toContain("September 2026 summary");

    const picker = host.querySelector('select[aria-label="Month for this class"]') as HTMLSelectElement;
    classroom.mockResolvedValue(classMonth({ month: "2026-08" }));
    await choose(picker, "2026-08");
    expect(classroom).toHaveBeenLastCalledWith(11, "2026-08");
  });

  it("opens a paper's students on request, and Back returns to the results", async () => {
    await openClass();
    const toggle = host.querySelector("button[aria-expanded]") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("student evidence");

    await click(buttonWith("Back to September 2026 results"));
    expect(text()).toContain("Classes taught by Nodir T");
  });
});
