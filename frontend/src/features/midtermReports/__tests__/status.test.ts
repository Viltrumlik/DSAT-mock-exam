import { describe, expect, it } from "vitest";
import {
  classroomSubjectLabel,
  filterRows,
  formatScore,
  isGraded,
  legendFor,
  outcomeFor,
  scoreText,
} from "@/features/midtermReports/status";
import type { FinalStatus, MidtermState, ReportRow } from "@/features/midtermReports/types";

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    student_id: 1,
    student_name: "Aziz X",
    midterm_score: null,
    midterm_state: "COMPLETED",
    midterm_passed: null,
    retake_score: null,
    retake_state: null,
    retake_passed: null,
    retake_eligible: false,
    final_status: "PENDING",
    ...over,
  };
}

describe("isGraded", () => {
  it("is driven solely by the presence of a pass mark", () => {
    expect(isGraded({ pass_mark: 500 })).toBe(true);
    expect(isGraded({ pass_mark: 0 })).toBe(true); // a 0 pass mark is still a pass mark
    expect(isGraded({ pass_mark: null })).toBe(false);
  });
});

describe("outcomeFor", () => {
  it("gives one verdict per wire status", () => {
    const expected: [FinalStatus, string][] = [
      ["PASSED", "Passed"],
      ["PASSED_ON_RETAKE", "Passed on retake"],
      ["FAILED", "Failed"],
      ["ABSENT", "Absent"],
      ["NOT_GRADED", "Not graded"],
    ];
    for (const [status, label] of expected) {
      expect(outcomeFor(row({ final_status: status }), true).label).toBe(label);
    }
  });

  it("never says Failed for an ungraded (pre-)midterm, whatever the wire says", () => {
    for (const status of ["PENDING", "FAILED", "PASSED"] as FinalStatus[]) {
      const outcome = outcomeFor(row({ final_status: status, midterm_score: 430 }), false);
      expect(outcome).toMatchObject({ tone: "ungraded", label: "Not graded" });
    }
  });

  it("collapses every no-verdict-yet state into one label with the detail underneath", () => {
    const cases: [MidtermState, string][] = [
      ["NOT_STARTED", "not started"],
      ["ACTIVE", "in progress"],
      ["SCORING", "being scored"],
      ["ABANDONED", "abandoned mid-sitting"],
      ["COMPLETED", "sat, no verdict recorded"],
    ];
    for (const [state, detail] of cases) {
      const outcome = outcomeFor(row({ final_status: "PENDING", midterm_state: state }), true);
      expect(outcome.label).toBe("Awaiting result");
      expect(outcome.tone).toBe("waiting");
      expect(outcome.detail).toBe(detail);
    }
  });

  it("separates an absent student from one whose verdict has not arrived", () => {
    expect(outcomeFor(row({ final_status: "PENDING", midterm_state: "ABSENT" }), true).label).toBe(
      "Absent",
    );
  });

  it("every outcome carries a meaning, so the legend can never be blank", () => {
    const statuses: FinalStatus[] = [
      "PASSED",
      "PASSED_ON_RETAKE",
      "FAILED",
      "ABSENT",
      "NOT_GRADED",
      "PENDING",
    ];
    for (const status of statuses) {
      expect(outcomeFor(row({ final_status: status }), true).meaning.length).toBeGreaterThan(10);
    }
  });
});

describe("legendFor", () => {
  it("lists each label once, worst-to-best-ordered by tone, with no leftover detail", () => {
    const outcomes = [
      outcomeFor(row({ final_status: "PENDING", midterm_state: "ACTIVE" }), true),
      outcomeFor(row({ final_status: "FAILED" }), true),
      outcomeFor(row({ final_status: "PASSED" }), true),
      outcomeFor(row({ final_status: "PASSED" }), true),
      outcomeFor(row({ final_status: "PENDING", midterm_state: "SCORING" }), true),
    ];
    const legend = legendFor(outcomes);
    expect(legend.map((o) => o.label)).toEqual(["Passed", "Failed", "Awaiting result"]);
    expect(legend.every((o) => o.detail === undefined)).toBe(true);
  });

  it("explains only what is on screen", () => {
    expect(legendFor([])).toEqual([]);
    expect(legendFor([outcomeFor(row({ final_status: "ABSENT" }), true)]).map((o) => o.label)).toEqual(
      ["Absent"],
    );
  });
});

describe("formatScore", () => {
  it("shows the ceiling when there is one and an em dash when there is no score", () => {
    expect(formatScore(440, 800)).toBe("440 / 800");
    expect(formatScore(0, 800)).toBe("0 / 800");
    expect(formatScore(72, null)).toBe("72");
    expect(formatScore(null, 800)).toBe("—");
  });
});

describe("scoreText", () => {
  it("says in words what an empty score cell means, instead of one dash for three causes", () => {
    expect(scoreText(440, 800, "COMPLETED")).toBe("440 / 800");
    expect(scoreText(null, 800, "ABSENT")).toBe("Not sat");
    expect(scoreText(null, 800, null)).toBe("Not sat");
    expect(scoreText(null, 800, "NOT_STARTED")).toBe("Not started");
    expect(scoreText(null, 800, "ACTIVE")).toBe("In progress");
    expect(scoreText(null, 800, "ABANDONED")).toBe("Abandoned");
    expect(scoreText(null, 800, "COMPLETED")).toBe("No score recorded");
  });
});

describe("classroomSubjectLabel", () => {
  it("never lets a raw DB enum reach the screen", () => {
    expect(classroomSubjectLabel("ENGLISH")).toBe("English");
    expect(classroomSubjectLabel("MATH")).toBe("Math");
    expect(classroomSubjectLabel("both")).toBe("English and Math");
    expect(classroomSubjectLabel(null)).toBe("");
  });
});

describe("filterRows", () => {
  const rows = [
    row({ student_id: 1, final_status: "FAILED" }),
    row({ student_id: 2, final_status: "PASSED" }),
    // A retake rescue is NOT something to chase — it is already resolved.
    row({ student_id: 3, final_status: "PASSED_ON_RETAKE" }),
    row({ student_id: 4, final_status: "ABSENT" }),
  ];

  it("passes everything through when off", () => {
    expect(filterRows(rows, false)).toHaveLength(4);
  });

  it("keeps only outright failures when on", () => {
    expect(filterRows(rows, true).map((r) => r.student_id)).toEqual([1]);
  });
});
