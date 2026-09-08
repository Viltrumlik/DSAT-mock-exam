import { describe, expect, it } from "vitest";
import {
  classroomSubjectLabel,
  filterRows,
  formatScore,
  isGraded,
  isInProgress,
  legendFor,
  outcomeFor,
  retakeCountOf,
  scoreText,
  stateDetail,
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
      // A two-module paper spends its whole second half here. This endpoint sends the RAW
      // DB state (WIRE_STATE is not applied by `admin_report.sitting_for`), and the value
      // was missing from both the type and this map — so the lookup returned `undefined`
      // and a student halfway through module 2 had no detail at all.
      ["MODULE_2_ACTIVE", "in progress, on module 2"],
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

  it("covers every state the midterm state machine can produce", () => {
    // `midterms/state_machine.py` STATE_CHOICES, plus the report's synthesized ABSENT. If
    // the backend grows a state, this list is where the omission has to be noticed — the
    // type alone cannot catch it, because a value missing from the union is also a value
    // tsc never sees on the wire.
    const machine: MidtermState[] = [
      "NOT_STARTED",
      "ACTIVE",
      "MODULE_2_ACTIVE",
      "SCORING",
      "COMPLETED",
      "ABANDONED",
      "ABSENT",
    ];
    for (const state of machine) {
      expect(stateDetail(state)).toBeTruthy();
    }
  });

  it("names a state it has never heard of instead of implying a missing result", () => {
    // A future backend state must not silently become "no detail" — and must not reach the
    // screen shouting its raw enum either.
    const detail = stateDetail("PROCTOR_HOLD" as MidtermState);
    expect(detail).toContain("proctor hold");
    expect(detail).not.toContain("PROCTOR_HOLD");
    expect(stateDetail(null)).toBeUndefined();

    const outcome = outcomeFor(
      row({ final_status: "PENDING", midterm_state: "PROCTOR_HOLD" as MidtermState }),
      true,
    );
    expect(outcome.label).toBe("Awaiting result");
    expect(outcome.detail).toContain("proctor hold");
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

  it("does not tell an admin a student mid-module-2 came back with nothing", () => {
    // MODULE_2_ACTIVE fell past every branch and landed on "No score recorded", which reads
    // as "handed in, and nothing came back" — the opposite of what is happening. A student
    // sitting module 2 right now is in progress, on both halves of a two-module paper.
    expect(scoreText(null, 800, "MODULE_2_ACTIVE")).toBe("In progress");
    expect(isInProgress("MODULE_2_ACTIVE")).toBe(true);
    expect(isInProgress("ACTIVE")).toBe(true);
    expect(isInProgress("COMPLETED")).toBe(false);
  });

  it("claims nothing it cannot know about a state it has never heard of", () => {
    expect(scoreText(null, 800, "PROCTOR_HOLD" as MidtermState)).toBe("No score yet");
  });
});

describe("retakeCountOf", () => {
  it("returns null — unknown, never 0 — when the payload does not list the retakes", () => {
    // `ReportClassroomDetailView` still sends only `retake_for(m)`, a single object. Reading
    // that as "one retake" would let the Records tab claim its counts must agree with the
    // Statistics tab, which counts a pass on ANY retake.
    expect(retakeCountOf({ retake: { id: 8, title: "R" } })).toBeNull();
    expect(retakeCountOf({ retake: null })).toBeNull();
  });

  it("counts them when the payload does list them", () => {
    expect(retakeCountOf({ retake: null, retakes: [] })).toBe(0);
    expect(retakeCountOf({ retake: { id: 8, title: "R" }, retakes: [{ id: 8, title: "R" }] })).toBe(1);
    expect(
      retakeCountOf({
        retake: { id: 8, title: "R1" },
        retakes: [
          { id: 8, title: "R1" },
          { id: 9, title: "R2" },
        ],
      }),
    ).toBe(2);
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
