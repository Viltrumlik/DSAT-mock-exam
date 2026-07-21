import { describe, expect, it } from "vitest";
import {
  filterRows,
  finalPill,
  formatScore,
  isGraded,
  sittingPill,
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

describe("sittingPill", () => {
  it("reads the verdict when there is one", () => {
    expect(sittingPill(true, true, "COMPLETED")).toEqual({ tone: "pass", label: "Passed" });
    expect(sittingPill(true, false, "COMPLETED")).toEqual({ tone: "fail", label: "Failed" });
  });

  it("never says Failed for an ungraded (pre-)midterm", () => {
    expect(sittingPill(false, null, "COMPLETED")).toEqual({
      tone: "ungraded",
      label: "Not graded",
    });
  });

  it("separates a missing verdict from an absent student", () => {
    // Graded + completed + no verdict is a data gap, not a fail.
    expect(sittingPill(true, null, "COMPLETED")).toEqual({
      tone: "waiting",
      label: "Awaiting result",
    });
    expect(sittingPill(true, null, "ABSENT")).toEqual({ tone: "absent", label: "Absent" });
    expect(sittingPill(true, null, null)).toEqual({ tone: "absent", label: "Absent" });
  });

  it("labels every in-flight state without inventing a verdict", () => {
    const cases: [MidtermState, string][] = [
      ["NOT_STARTED", "Not started"],
      ["ACTIVE", "In progress"],
      ["SCORING", "Scoring"],
      ["ABANDONED", "Abandoned"],
    ];
    for (const [state, label] of cases) {
      expect(sittingPill(true, null, state)).toEqual({ tone: "waiting", label });
    }
  });
});

describe("finalPill", () => {
  it("maps each wire status", () => {
    const expected: [FinalStatus, string][] = [
      ["PASSED", "Passed"],
      ["PASSED_ON_RETAKE", "Passed on retake"],
      ["FAILED", "Failed"],
      ["ABSENT", "Absent"],
      ["NOT_GRADED", "Not graded"],
    ];
    for (const [status, label] of expected) {
      expect(finalPill(row({ final_status: status }), true).label).toBe(label);
    }
  });

  it("resolves PENDING through the attempt state", () => {
    expect(finalPill(row({ final_status: "PENDING", midterm_state: "ACTIVE" }), true)).toEqual({
      tone: "waiting",
      label: "In progress",
    });
  });

  it("keeps an ungraded midterm out of the failure vocabulary on any unknown status", () => {
    // A backend that has not learned NOT_GRADED yet sends PENDING for a sat pre-midterm.
    const pill = finalPill(row({ final_status: "PENDING", midterm_state: "COMPLETED" }), false);
    expect(pill).toEqual({ tone: "ungraded", label: "Not graded" });
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
