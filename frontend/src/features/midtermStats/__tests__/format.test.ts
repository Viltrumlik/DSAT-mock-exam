/**
 * The rules a type-check cannot enforce: a missing rate is not zero, a month key is not a
 * Date, and no raw DB enum reaches the screen.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_CHART_GROUPS,
  MONTH_BASIS_LABEL,
  MONTH_BASIS_NOTE,
  NO_VALUE,
  chartBars,
  definitionEntries,
  groupSubline,
  rosterNote,
  definitionLine,
  formatPassMark,
  formatRate,
  formatShare,
  hasMixedScales,
  isInferredMonth,
  isUnassigned,
  midtermSubjectLabel,
  midtermTypeLabel,
  monthLabel,
  passerSplit,
  plural,
  rateReason,
} from "@/features/midtermStats/format";
import type { StatsDefinition } from "@/features/midtermStats/types";

describe("formatRate", () => {
  it("renders a rate as a percentage, one decimal as the backend sent it", () => {
    expect(formatRate(90)).toBe("90%");
    expect(formatRate(72.4)).toBe("72.4%");
    expect(formatRate(0)).toBe("0%"); // a measured zero IS zero
  });

  it("renders an unknown rate as an em dash — never as 0%", () => {
    expect(formatRate(null)).toBe(NO_VALUE);
    expect(formatRate(undefined)).toBe(NO_VALUE);
    expect(formatRate(Number.NaN)).toBe(NO_VALUE);
    expect(formatRate(null)).not.toBe("0%");
  });
});

describe("rateReason", () => {
  it("distinguishes an empty roster from a cohort in which nobody passed", () => {
    expect(rateReason("pass", 0)).toContain("No students on the roster");
    expect(rateReason("share", 12)).toContain("Nobody passed");
  });
});

describe("monthLabel", () => {
  it("reads the month key as a string, never through Date", () => {
    // A Date would re-interpret the key in the browser's timezone and slide a September
    // sitting into August for anyone west of the school.
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("2026-12")).toBe("December 2026");
  });

  it("hands back anything it does not recognise instead of inventing a month", () => {
    expect(monthLabel("September")).toBe("September");
    expect(monthLabel("2026-13")).toBe("2026-13");
    expect(monthLabel(null)).toBe("");
    expect(monthLabel(undefined)).toBe("");
  });
});

describe("labels", () => {
  it("never renders a raw DB enum", () => {
    expect(midtermSubjectLabel("READING_WRITING")).toBe("Reading & Writing");
    expect(midtermSubjectLabel("MATH")).toBe("Math");
    expect(midtermTypeLabel("PRE_MIDTERM")).toBe("Pre-midterm");
    expect(midtermTypeLabel("RETAKE")).toBe("Retake");
    expect(MONTH_BASIS_LABEL.first_sitting).toBe("From the first sitting");
    expect(MONTH_BASIS_LABEL.schedule).toBe("From the timetable");
  });

  it("passes an unknown value through rather than showing a blank", () => {
    expect(midtermSubjectLabel("PHYSICS")).toBe("PHYSICS");
    expect(midtermTypeLabel("MOCK")).toBe("MOCK");
  });
});

describe("isInferredMonth", () => {
  it("is true for every basis except the timetable", () => {
    expect(isInferredMonth("schedule")).toBe(false);
    expect(isInferredMonth("first_sitting")).toBe(true);
    expect(isInferredMonth("published")).toBe(true);
    expect(isInferredMonth("created")).toBe(true);
    expect(isInferredMonth(null)).toBe(false);
  });
});

describe("formatPassMark", () => {
  it("keeps the ceiling attached, because 72 and 640 are not comparable without it", () => {
    expect(formatPassMark(500, 800)).toBe("500 / 800");
    expect(formatPassMark(60, 100)).toBe("60 / 100");
    expect(formatPassMark(null, 800)).toBe("Not graded");
  });
});

describe("hasMixedScales", () => {
  it("spots two papers scored out of different totals in one month", () => {
    expect(hasMixedScales([{ score_ceiling: 800 }, { score_ceiling: 800 }])).toBe(false);
    expect(hasMixedScales([{ score_ceiling: 800 }, { score_ceiling: 100 }])).toBe(true);
    expect(hasMixedScales([])).toBe(false);
  });
});

describe("passerSplit", () => {
  it("is a share of the passers, and is null when nobody passed", () => {
    expect(passerSplit({ passed: 10, first_try_share: 80, retake_share: 20 })).toEqual({
      first: "80%",
      retake: "20%",
    });
    expect(passerSplit({ passed: 0, first_try_share: null, retake_share: null })).toBeNull();
  });
});

describe("definitionLine", () => {
  it("states the rule using the backend's own words", () => {
    const definition: StatsDefinition = {
      pass_rate: "passed (first sitting or retake) / all roster students",
      absent_counts_as: "failed",
      rollup: "pooled",
    };
    const line = definitionLine(definition);
    expect(line).toContain("passed (first sitting or retake) / all roster students");
    expect(line).toContain("An absent student counts as failed");
    expect(line).toContain("never an average of percentages");
  });

  it("still states a rule when the backend sent none", () => {
    const line = definitionLine(undefined);
    expect(line).toContain("all roster students");
    expect(line).toContain("counts as failed");
  });
});

describe("definitionEntries", () => {
  it("renders only the keys that arrived, in a fixed order", () => {
    const entries = definitionEntries({ rollup: "pooled", pass_rate: "passed / roster" });
    expect(entries.map((e) => e.key)).toEqual(["pass_rate", "rollup"]);
    expect(entries[0].label).toBe("Pass rate");
    expect(definitionEntries(undefined)).toEqual([]);
    expect(definitionEntries({})).toEqual([]);
  });
});

describe("small helpers", () => {
  it("shows the counts behind a rate", () => {
    expect(formatShare(9, 10)).toBe("9 of 10");
  });

  it("pluralises without a library", () => {
    expect(plural(1, "paper")).toBe("1 paper");
    expect(plural(3, "paper")).toBe("3 papers");
    expect(plural(2, "class", "classes")).toBe("2 classes");
  });

  it("treats a null id as the Unassigned bucket", () => {
    expect(isUnassigned({ id: null, name: "Unassigned" })).toBe(true);
    expect(isUnassigned({ id: 4, name: "Chilonzor" })).toBe(false);
  });
});

describe("rosterNote / groupSubline", () => {
  it("says nothing when the headcount and the denominator agree", () => {
    expect(rosterNote(10, 10)).toBeNull();
    expect(groupSubline({ classrooms: 2, distinct_students: 10, roster: 10 })).toBe(
      "2 classes · 10 students",
    );
  });

  it("names the roster count too when a row carries two different denominators", () => {
    // 112 of 226 students hold two active memberships, so roster > headcount is ordinary.
    expect(groupSubline({ classrooms: 12, distinct_students: 180, roster: 210 })).toBe(
      "12 classes · 180 students · 210 roster places",
    );
    const note = rosterNote(210, 180);
    expect(note).toContain("180 students");
    expect(note).toContain("210 roster places");
    expect(note).toContain("two of these classes");
  });
});

describe("chartBars", () => {
  const row = (id: number | null, name: string, pass_rate: number | null) => ({
    id,
    name,
    pass_rate,
  });

  it("never plots the Unassigned bucket as if it were a group", () => {
    // Classrooms created since #154 carry branch = NULL and were never backfilled, so this
    // bucket is large in production. Drawn as a bar in "Pass rate by branch" it reads as a
    // failing branch, where it is a record-keeping hole spanning every branch.
    const out = chartBars(
      [
        row(1, "Chilonzor", 91),
        row(2, "Yunusobod", 84),
        row(null, "Unassigned", 62),
        row(3, "Sergeli", 77),
      ],
      12,
    );
    expect(out.bars.map((b) => b.name)).toEqual(["Chilonzor", "Yunusobod", "Sergeli"]);
    expect(out.gaps).toBe(1);
    // It is excluded from the chart, not silently forgotten — the caption counts it.
    expect(out.unrated).toBe(0);
  });

  it("counts a group with no rate separately from the data gap", () => {
    const out = chartBars([row(1, "A", 91), row(2, "B", null), row(null, "Unassigned", 40)], 12);
    expect(out.bars).toHaveLength(1);
    expect(out.unrated).toBe(1);
    expect(out.gaps).toBe(1);
  });

  it("reports what it truncated so the caption can point at the table", () => {
    const rows = [1, 2, 3, 4].map((i) => row(i, `B${i}`, 50 + i));
    const out = chartBars(rows, 2);
    expect(out.bars).toHaveLength(2);
    expect(out.truncated).toBe(2);
  });

  it("holds a floor of three, so one real group plus a gap is not a comparison", () => {
    expect(MIN_CHART_GROUPS).toBe(3);
    const out = chartBars([row(1, "Chilonzor", 91), row(null, "Unassigned", 62)], 12);
    expect(out.bars.length).toBeLessThan(MIN_CHART_GROUPS);
  });
});

describe("MONTH_BASIS_NOTE", () => {
  it("is a whole sentence, so no caller has to prepend one", () => {
    // The panel used to print a hardcoded "this paper was never timetabled…" clause AND
    // then this note, which opens with the same clause. The sentence appeared twice.
    for (const basis of ["first_sitting", "published", "created"] as const) {
      expect(MONTH_BASIS_NOTE[basis]).toContain("never timetabled for this class");
    }
    expect(MONTH_BASIS_NOTE.schedule).not.toContain("never timetabled");
  });
});
