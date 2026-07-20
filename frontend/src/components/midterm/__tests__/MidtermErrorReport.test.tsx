import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MidtermErrorReport from "../MidtermErrorReport";
import type { ErrorReport } from "../errorReportApi";

const BASE: ErrorReport = {
  attempt_id: 12,
  student_name: "Aziz Karimov",
  date: "21 July 2026",
  midterm: {
    id: 3,
    title: "Midterm 12",
    subject: "MATH",
    subject_label: "Mathematics",
    scoring_scale: "SCALE_800",
    score_ceiling: 800,
    level: "middle",
    midterm_type: "MIDTERM",
  },
  score: 570,
  correct_count: 33,
  total_count: 54,
  pass_mark: 500,
  passed: true,
  is_graded: true,
  unclassified_total: 0,
  unclassified_wrong: 0,
  skills: [
    { skill_id: 12, skill: "Nonlinear functions", domain: "Advanced Math", total: 6, wrong: 5 },
    { skill_id: 4, skill: "Linear equations", domain: "Algebra", total: 8, wrong: 3 },
    { skill_id: 9, skill: "Ratios and rates", domain: "Problem-Solving", total: 4, wrong: 2 },
    { skill_id: 7, skill: "Area and volume", domain: "Geometry", total: 3, wrong: 1 },
  ],
};

let host: HTMLElement;
let root: Root;

async function render(report: ErrorReport) {
  await act(async () => root.render(<MidtermErrorReport report={report} />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("MidtermErrorReport", () => {
  it("heads the report with the student, midterm and date", async () => {
    await render(BASE);
    expect(host.textContent).toContain("Aziz Karimov");
    expect(host.textContent).toContain("Midterm 12");
    expect(host.textContent).toContain("21 July 2026");
  });

  it("derives mistakes from the counts rather than from the chart rows", async () => {
    // 4 charted skills carry 11 mistakes; the paper actually has 21.
    await render(BASE);
    const tiles = [...host.querySelectorAll(".mer-tile")].map((t) => t.textContent ?? "");
    expect(tiles.some((t) => t.startsWith("Mistakes") && t.includes("21"))).toBe(true);
    expect(tiles.some((t) => t.startsWith("Correct") && t.includes("33/54"))).toBe(true);
    expect(tiles.some((t) => t.startsWith("Weak skills") && t.includes("4"))).toBe(true);
  });

  it("lists exactly the top three skills as priority focus areas", async () => {
    await render(BASE);
    const items = host.querySelectorAll("ol li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Nonlinear functions");
    expect(items[0].textContent).toContain("5 of 6 missed");
    // The 4th skill is charted but is not a priority.
    expect([...items].some((li) => li.textContent?.includes("Area and volume"))).toBe(false);
  });

  it("drops the score tile on an ungraded midterm instead of inventing a score", async () => {
    await render({ ...BASE, is_graded: false, score: null, pass_mark: null, passed: null });
    const tiles = [...host.querySelectorAll(".mer-tile")].map((t) => t.textContent ?? "");
    expect(tiles.some((t) => t.startsWith("Score"))).toBe(false);
    expect(tiles.some((t) => t.startsWith("Correct"))).toBe(true);
  });

  it("discloses unclassified mistakes rather than folding them into an 'Other' bar", async () => {
    await render({ ...BASE, unclassified_total: 5, unclassified_wrong: 3 });
    expect(host.textContent).toContain("3 of your 21 mistakes");
    expect(host.textContent).not.toContain("Other");
  });

  it("shows a clean-paper empty state, not an empty chart frame", async () => {
    await render({ ...BASE, correct_count: 54, skills: [] });
    expect(host.querySelector("svg[role='img']")).toBeNull();
    expect(host.textContent).toContain("A clean paper");
  });

  it("says so when the questions were never classified by skill", async () => {
    await render({ ...BASE, skills: [], unclassified_total: 54, unclassified_wrong: 21 });
    expect(host.querySelector("svg[role='img']")).toBeNull();
    expect(host.textContent).toContain("have not been classified by skill yet");
  });

  it("offers its own download, separate from the certificate's", async () => {
    await render(BASE);
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain(" Download report");
  });
});
