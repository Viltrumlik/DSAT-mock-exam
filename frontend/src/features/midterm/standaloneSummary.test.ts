import { describe, expect, it } from "vitest";
import {
  MIDTERM_STATE_LABELS,
  midtermProgress,
  midtermStateLabel,
  scoreOnScale,
  scoringScaleLabel,
  summarizeStandalone,
  type StandaloneResultRow,
} from "@/lib/midtermApi";

function row(over: Partial<StandaloneResultRow>): StandaloneResultRow {
  return {
    student_id: 1,
    student_name: "Student",
    instructor_id: null,
    instructor_name: null,
    state: "NOT_STARTED",
    submitted: false,
    score: null,
    score_ceiling: 800,
    sittings: 0,
    resit_open: false,
    ...over,
  };
}

/**
 * Every state in backend/midterms/state_machine.py, plus the wire spelling of module 1.
 * If the state machine grows a state, this list must grow with it.
 */
const EVERY_WIRE_STATE = [
  "NOT_STARTED",
  "ACTIVE",
  "MODULE_1_ACTIVE",
  "MODULE_2_ACTIVE",
  "SCORING",
  "COMPLETED",
  "ABANDONED",
];

describe("midtermStateLabel", () => {
  it("covers every state the backend can send, and never echoes the enum", () => {
    for (const state of EVERY_WIRE_STATE) {
      const label = midtermStateLabel(state);
      expect(MIDTERM_STATE_LABELS[state]).toBeTruthy();
      expect(label).toBe(MIDTERM_STATE_LABELS[state]);
      expect(label).not.toBe(state);
      expect(label).not.toMatch(/_/);
    }
  });

  it("spells the two module-1 spellings the same way", () => {
    expect(midtermStateLabel("ACTIVE")).toBe("Module 1 in progress");
    expect(midtermStateLabel("MODULE_1_ACTIVE")).toBe("Module 1 in progress");
    expect(midtermStateLabel("MODULE_2_ACTIVE")).toBe("Module 2 in progress");
  });

  it("humanises a state it has never seen rather than printing the raw enum", () => {
    expect(midtermStateLabel("SOME_FUTURE_STATE")).toBe("Some future state");
    expect(midtermStateLabel("")).toBe("Not started");
    expect(midtermStateLabel(null)).toBe("Not started");
  });
});

describe("midtermProgress", () => {
  it("buckets each state", () => {
    expect(midtermProgress(row({ state: "NOT_STARTED" }))).toBe("not_started");
    expect(midtermProgress(row({ state: "ACTIVE" }))).toBe("in_progress");
    expect(midtermProgress(row({ state: "MODULE_2_ACTIVE" }))).toBe("in_progress");
    expect(midtermProgress(row({ state: "SCORING" }))).toBe("scoring");
    expect(midtermProgress(row({ state: "ABANDONED" }))).toBe("voided");
    expect(midtermProgress(row({ state: "COMPLETED", submitted: true }))).toBe("completed");
  });

  it("trusts `submitted` over the state string", () => {
    expect(midtermProgress(row({ state: "SCORING", submitted: true }))).toBe("completed");
  });
});

describe("scoreOnScale", () => {
  it("converts through the share of the work, respecting the 800 scale's 200 floor", () => {
    expect(scoreOnScale(90, 100, 800)).toBe(740);
    expect(scoreOnScale(0, 100, 800)).toBe(200);
    expect(scoreOnScale(500, 800, 100)).toBe(50);
    expect(scoreOnScale(72, 100, 100)).toBe(72);
  });
});

describe("summarizeStandalone", () => {
  it("averages papers sat on different scales on the midterm's current one", () => {
    // Sat before the scale changed (90 of 100) and after it (500 of 800): 740 and 500.
    const s = summarizeStandalone(
      [
        row({ student_id: 1, state: "COMPLETED", submitted: true, score: 90, score_ceiling: 100 }),
        row({ student_id: 2, state: "COMPLETED", submitted: true, score: 500, score_ceiling: 800 }),
      ],
      800,
    );
    expect(s.average_score).toBe(620);
  });

  it("is null, not zero, when nobody has finished", () => {
    const s = summarizeStandalone(
      [row({ student_id: 1 }), row({ student_id: 2, state: "ACTIVE" })],
      800,
    );
    expect(s.average_score).toBeNull();
    expect(s.granted).toBe(2);
    expect(s.submitted).toBe(0);
    expect(s.outstanding).toBe(2);
  });

  it("is null, not zero, for an empty access list", () => {
    const s = summarizeStandalone([], 800);
    expect(s.average_score).toBeNull();
    expect(s.granted).toBe(0);
    expect(s.outstanding).toBe(0);
  });

  it("counts each bucket and averages only the finished papers", () => {
    const s = summarizeStandalone(
      [
        row({ student_id: 1, state: "COMPLETED", submitted: true, score: 700, sittings: 1 }),
        row({ student_id: 2, state: "COMPLETED", submitted: true, score: 500, sittings: 2, resit_open: true }),
        row({ student_id: 3, state: "MODULE_1_ACTIVE" }),
        row({ student_id: 4, state: "SCORING" }),
        row({ student_id: 5, state: "NOT_STARTED" }),
        row({ student_id: 6, state: "ABANDONED" }),
      ],
      800,
    );
    expect(s.granted).toBe(6);
    expect(s.submitted).toBe(2);
    expect(s.in_progress).toBe(1);
    expect(s.scoring).toBe(1);
    expect(s.not_started).toBe(1);
    expect(s.voided).toBe(1);
    expect(s.resit_open).toBe(1);
    // Still to sit = everyone who has not handed it in, voided and in-flight included.
    expect(s.outstanding).toBe(4);
    expect(s.average_score).toBe(600);
    expect(s.score_ceiling).toBe(800);
  });

  it("rounds the average to one decimal, house style", () => {
    const s = summarizeStandalone(
      [
        row({ student_id: 1, state: "COMPLETED", submitted: true, score: 700 }),
        row({ student_id: 2, state: "COMPLETED", submitted: true, score: 690 }),
        row({ student_id: 3, state: "COMPLETED", submitted: true, score: 680 }),
        row({ student_id: 4, state: "COMPLETED", submitted: true, score: 675 }),
      ],
      800,
    );
    expect(s.average_score).toBe(686.3);
  });
});

describe("scoringScaleLabel", () => {
  it("labels the ceiling instead of printing a bare /800", () => {
    expect(scoringScaleLabel("SCALE_800", 800)).toBe("Scored out of 800");
    expect(scoringScaleLabel("SCALE_100")).toBe("Scored out of 100");
  });
});
