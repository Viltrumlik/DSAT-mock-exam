import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLD,
  EM_DASH,
  assessmentWrongLine,
  barWidth,
  clampThreshold,
  formatPercent,
  humanEnum,
  paperLabel,
  pastpaperWrongLine,
  plural,
  subjectLabel,
} from "./format";

describe("formatPercent", () => {
  it("renders an unknown rate as an em dash, never as 0%", () => {
    // The whole page rests on this: an empty denominator is "we do not know", and rendering
    // it as 0% tells a teacher the class aced a question nobody has answered.
    expect(formatPercent(null)).toBe(EM_DASH);
    expect(formatPercent(undefined)).toBe(EM_DASH);
  });

  it("keeps a real zero a real zero", () => {
    expect(formatPercent(0)).toBe("0%");
  });

  it("keeps the backend's one decimal", () => {
    expect(formatPercent(33.3)).toBe("33.3%");
  });
});

describe("barWidth", () => {
  it("gives an unknown rate no bar at all rather than a zero-width one", () => {
    expect(barWidth(null)).toBeNull();
  });

  it("clamps to the track", () => {
    expect(barWidth(0)).toBe("0%");
    expect(barWidth(42.5)).toBe("42.5%");
    expect(barWidth(140)).toBe("100%");
  });
});

describe("clampThreshold", () => {
  it("matches the backend's 1..100 clamp", () => {
    expect(clampThreshold(0)).toBe(1);
    expect(clampThreshold(-8)).toBe(1);
    expect(clampThreshold(250)).toBe(100);
    expect(clampThreshold("40")).toBe(40);
  });

  it("falls back to the school's rule on junk", () => {
    expect(clampThreshold("abc")).toBe(DEFAULT_THRESHOLD);
    expect(clampThreshold("")).toBe(DEFAULT_THRESHOLD);
    expect(clampThreshold(null)).toBe(DEFAULT_THRESHOLD);
  });
});

describe("enum rendering", () => {
  it("never lets a raw database enum reach the screen", () => {
    expect(humanEnum("MODULE_1_ACTIVE")).toBe("Module 1 active");
    expect(subjectLabel("ENGLISH")).toBe("English");
    expect(subjectLabel("READING_WRITING")).toBe("Reading & Writing");
  });

  it("humanises an enum it has never seen instead of printing it raw", () => {
    expect(subjectLabel("SOME_NEW_SUBJECT")).toBe("Some new subject");
  });

  it("has nothing to say about an absent value", () => {
    expect(subjectLabel(null)).toBe("");
    expect(humanEnum(undefined)).toBe("");
  });
});

describe("paperLabel", () => {
  it("folds title, collection and subject into one line", () => {
    expect(
      paperLabel({ id: 4, title: "March 2024 Module 1", collection_name: "March 2024", subject: "MATH" }),
    ).toBe("March 2024 Module 1 · March 2024 · Math");
  });

  it("falls back to the collection, then to the id — never to an empty option", () => {
    expect(paperLabel({ id: 9, collection_name: "May 2023", subject: "READING_WRITING" })).toBe(
      "May 2023 · Reading & Writing",
    );
    expect(paperLabel({ id: 9, subject: "" })).toBe("Past paper #9");
  });
});

describe("plural", () => {
  it("agrees with its count", () => {
    expect(plural(1, "student")).toBe("1 student");
    expect(plural(3, "student")).toBe("3 students");
    expect(plural(2, "sitting")).toBe("2 sittings");
  });
});

describe("assessmentWrongLine", () => {
  it("says the rate is over graded answers, and how many are still ungraded", () => {
    const line = assessmentWrongLine({ students_wrong: 6, students_graded: 20, ungraded: 3 });
    expect(line).toContain("6 of 20 graded answers got it wrong");
    expect(line).toContain("3 more answers still waiting on a score");
  });

  it("does not claim a verdict when nothing is graded", () => {
    expect(assessmentWrongLine({ students_wrong: 0, students_graded: 0, ungraded: 4 })).toContain(
      "Nothing graded yet",
    );
    expect(assessmentWrongLine({ students_wrong: 0, students_graded: 0, ungraded: 0 })).toBe(
      "Nobody has answered this yet",
    );
  });
});

describe("pastpaperWrongLine", () => {
  it("keeps blank answers separate from wrong ones", () => {
    // "12 ran out of time" and "12 got it wrong" are different lessons; the row must not
    // merge them into one number.
    const line = pastpaperWrongLine({ wrong: 8, answered: 18, omitted: 12, seen: 30 });
    expect(line).toContain("8 of 18 students who answered got it wrong");
    expect(line).toContain("12 students left it blank");
    expect(line).toContain("30 students saw it");
  });

  it("says nobody answered rather than reporting a rate of nothing", () => {
    expect(pastpaperWrongLine({ wrong: 0, answered: 0, omitted: 5, seen: 5 })).toContain(
      "Nobody who saw it wrote an answer",
    );
    expect(pastpaperWrongLine({ wrong: 0, answered: 0, omitted: 0, seen: 0 })).toBe(
      "Nobody reached this question",
    );
  });
});
