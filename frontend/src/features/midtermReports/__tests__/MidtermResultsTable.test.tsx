/**
 * The table's job is to be readable at a glance and to never libel a student. Two things are
 * asserted here that a type-check cannot catch: a pre-midterm (no pass mark) reads "Not
 * graded" everywhere rather than "Failed", and "Only failed" narrows to exactly the people an
 * admin has to chase.
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
  subject_label: "Mathematics",
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
    classroom: { id: 1, name: "Math Senior A", subject: "MATH", level: "senior", teacher_name: "Nodir T" },
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

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MidtermResultsTable", () => {
  it("renders the six columns and one row per student", () => {
    const text = render(
      <MidtermResultsTable
        report={report({ rows: [row(), row({ student_id: 2, student_name: "Bek X" })] })}
        onlyFailed={false}
      />,
    );
    for (const header of ["Student", "Midterm", "Result", "Retake", "Retake result", "Final"]) {
      expect(text).toContain(header);
    }
    expect(text).toContain("Aziz X");
    expect(text).toContain("Bek X");
    expect(text).toContain("800 / 800");
  });

  it("says 'not graded' — never 'Failed' — for a pre-midterm", () => {
    const text = render(
      <MidtermResultsTable
        report={report({
          midterm: midterm({ midterm_type: "PRE_MIDTERM", pass_mark: null }),
          summary: { ...report().summary, pass_mark: null },
          rows: [row({ midterm_passed: null, final_status: "NOT_GRADED", midterm_score: 430 })],
        })}
        onlyFailed={false}
      />,
    );
    expect(text).toContain("Not graded");
    expect(text).not.toContain("Failed");
    expect(text).toContain("pre-midterm");
  });

  it("calls out a midterm nobody has sat", () => {
    const rows = [row({ midterm_score: null, midterm_passed: null, midterm_state: "ABSENT", final_status: "ABSENT" })];
    const text = render(
      <MidtermResultsTable
        report={report({ rows, summary: { ...report().summary, students: 1, absent: 1 } })}
        onlyFailed={false}
      />,
    );
    expect(text).toContain("Nobody has sat this midterm yet");
    expect(text).toContain("Absent");
  });

  it("explains the empty roster rather than showing a bare table", () => {
    const text = render(
      <MidtermResultsTable
        report={report({ rows: [], summary: { ...report().summary, students: 0 } })}
        onlyFailed={false}
      />,
    );
    expect(text).toContain("No students on this roster");
  });

  it("narrows to outright failures under 'Only failed', and says so when there are none", () => {
    const rows = [
      row(),
      row({ student_id: 2, student_name: "Dilnoza X", midterm_passed: false, final_status: "FAILED", midterm_score: 200 }),
    ];
    const filtered = render(<MidtermResultsTable report={report({ rows })} onlyFailed />);
    expect(filtered).toContain("Dilnoza X");
    expect(filtered).not.toContain("Aziz X");

    act(() => root?.unmount());
    container?.remove();

    const none = render(<MidtermResultsTable report={report({ rows: [row()] })} onlyFailed />);
    expect(none).toContain("No failed students");
  });

  it("shows the retake score only for the students who were eligible to sit it", () => {
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
    const text = render(
      <MidtermResultsTable
        report={report({ rows, retake: midterm({ id: 8, title: "Midterm 12 Retake", midterm_type: "RETAKE" }) })}
        onlyFailed={false}
      />,
    );
    expect(text).toContain("Passed on retake");
    expect(text).toContain("Midterm 12 Retake");
    // Bek passed first time, so his retake cells carry the reason they are blank.
    expect(text).toContain("not eligible");
  });
});
