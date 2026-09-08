/**
 * The evidence table's job is to be readable at a glance and to never libel a student.
 *
 * What is asserted here is what a type-check cannot catch: a pre-midterm (no pass mark) reads
 * "Not graded" rather than "Failed"; there is exactly ONE verdict column; the retake column
 * does not exist at all when there is no retake (so no cell can hold an unexplained dash);
 * every label on screen is explained by the legend; and the "only failed" filter is a control
 * on this table rather than something several screens away that rewrites it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MidtermResultsTable } from "../MidtermResultsTable";
import type { MidtermBrief, MidtermReport, ReportRow } from "../types";

const midterm = (over: Partial<MidtermBrief> = {}): MidtermBrief => ({
  id: 7,
  title: "Midterm 12",
  subject: "MATH",
  subject_label: "Math",
  midterm_type: "MIDTERM",
  pass_mark: 500,
  score_ceiling: 800,
  scoring_scale: "SCALE_800",
  ...over,
});

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  student_id: 1,
  student_name: "Aziz X",
  midterm_score: 800,
  midterm_state: "COMPLETED",
  midterm_passed: true,
  retake_score: null,
  retake_state: null,
  retake_passed: null,
  retake_eligible: false,
  final_status: "PASSED",
  ...over,
});

function report(over: Partial<MidtermReport> = {}): MidtermReport {
  const rows = over.rows ?? [row()];
  return {
    classroom: {
      id: 1,
      name: "Math Senior A",
      subject: "MATH",
      level: "senior",
      teacher_name: "Nodir T",
    },
    midterm: midterm(),
    retake: null,
    summary: {
      students: rows.length,
      passed: 0,
      failed: 0,
      absent: 0,
      pending: 0,
      pass_mark: 500,
      average_score: 400,
    },
    rows,
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: React.ReactElement): string {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

function text(): string {
  return container?.textContent ?? "";
}

function click(selector: string) {
  const el = container?.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`no element for ${selector}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MidtermResultsTable", () => {
  it("shows the student, the score and ONE verdict — and names the scale the score is on", () => {
    const out = render(
      <MidtermResultsTable
        report={report({ rows: [row(), row({ student_id: 2, student_name: "Bek X" })] })}
      />,
    );
    for (const header of ["Student", "Midterm score", "Outcome"]) {
      expect(out).toContain(header);
    }
    expect(out).toContain("out of 800");
    expect(out).toContain("Aziz X");
    expect(out).toContain("Bek X");
    expect(out).toContain("800 / 800");
    // The three verdict columns of the old table are gone.
    expect(out).not.toContain("Retake result");
    expect(out).not.toContain("Final");
  });

  it("omits the retake column entirely when there is no retake", () => {
    const out = render(<MidtermResultsTable report={report()} />);
    expect(out).not.toContain("Retake score");
    expect(out).not.toContain("Not offered");
  });

  it("explains every label it uses, under the table", () => {
    const out = render(
      <MidtermResultsTable
        report={report({
          rows: [
            row(),
            row({ student_id: 2, midterm_passed: false, final_status: "FAILED", midterm_score: 200 }),
          ],
        })}
      />,
    );
    expect(out).toContain("Scored at or above the pass mark at the first sitting.");
    expect(out).toContain("without reaching the pass mark");
  });

  it("says 'not graded' — never 'Failed' — for a pre-midterm", () => {
    const out = render(
      <MidtermResultsTable
        report={report({
          midterm: midterm({ midterm_type: "PRE_MIDTERM", pass_mark: null }),
          summary: { ...report().summary, pass_mark: null },
          rows: [row({ midterm_passed: null, final_status: "NOT_GRADED", midterm_score: 430 })],
        })}
      />,
    );
    expect(out).toContain("Not graded");
    expect(out).not.toContain("Failed");
    expect(out).toContain("pre-midterm");
  });

  it("calls out a midterm nobody has sat", () => {
    const rows = [
      row({
        midterm_score: null,
        midterm_passed: null,
        midterm_state: "ABSENT",
        final_status: "ABSENT",
      }),
    ];
    const out = render(
      <MidtermResultsTable report={report({ rows, summary: { ...report().summary, students: 1, absent: 1 } })} />,
    );
    expect(out).toContain("Nobody has sat this midterm yet");
    expect(out).toContain("Absent");
    // A blank score cell says what it means rather than showing a bare dash.
    expect(out).toContain("Not sat");
  });

  it("explains the empty roster rather than showing a bare table", () => {
    const out = render(
      <MidtermResultsTable report={report({ rows: [], summary: { ...report().summary, students: 0 } })} />,
    );
    expect(out).toContain("No students on this roster");
  });

  it("filters to outright failures from a control on the table itself", () => {
    const rows = [
      row(),
      row({
        student_id: 2,
        student_name: "Dilnoza X",
        midterm_passed: false,
        final_status: "FAILED",
        midterm_score: 200,
      }),
    ];
    render(<MidtermResultsTable report={report({ rows })} />);
    expect(text()).toContain("Only students who failed (1)");
    expect(text()).toContain("Aziz X");

    click("button[aria-pressed]");
    expect(text()).toContain("Dilnoza X");
    expect(text()).not.toContain("Aziz X");
    expect(text()).toContain("Showing 1 of 2 students");
  });

  it("offers no filter at all when nobody failed", () => {
    render(<MidtermResultsTable report={report({ rows: [row()] })} />);
    expect(container?.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("shows a retake score only for the students who were eligible, and names the reason", () => {
    const rows = [
      row({
        student_name: "Aziz X",
        midterm_score: 200,
        midterm_passed: false,
        retake_eligible: true,
        retake_score: 800,
        retake_state: "COMPLETED",
        retake_passed: true,
        final_status: "PASSED_ON_RETAKE",
      }),
      row({ student_id: 2, student_name: "Bek X" }),
    ];
    const out = render(
      <MidtermResultsTable
        report={report({
          rows,
          retake: midterm({ id: 8, title: "Midterm 12 Retake", midterm_type: "RETAKE" }),
        })}
      />,
    );
    expect(out).toContain("Retake score");
    expect(out).toContain("Passed on retake");
    expect(out).toContain("Midterm 12 Retake");
    // Bek passed first time, so his retake cell says so in words.
    expect(out).toContain("Not offered");
  });

  it("warns when the retake is scored on a different scale from the midterm", () => {
    const out = render(
      <MidtermResultsTable
        report={report({
          retake: midterm({ id: 9, title: "Retake", midterm_type: "RETAKE", score_ceiling: 100 }),
        })}
      />,
    );
    expect(out).toContain("different scales");
  });
});
