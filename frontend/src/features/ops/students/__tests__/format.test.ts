import { describe, expect, it } from "vitest";

import { coveredMonths } from "../QuickCard";
import { courseOf, daysText, groupLabel, lessonsProgress, percentText, priceText, shortDay, timeRange } from "../format";

describe("the lists' words", () => {
  it("names a group the way lc-up does", () => {
    expect(groupLabel("Foundation G13 | Math | Muhlisa", "MATH", "Toshmatov")).toBe("Foundation G13 · Math · Muhlisa");
    expect(groupLabel("G7", "MATH", "Aliyev")).toBe("G7 · Math · Aliyev");
    expect(groupLabel("Junior G21 Math", "MATH", "")).toBe("Junior G21 Math");
  });

  it("reads a course from the level, else the name's first word", () => {
    expect(courseOf("junior", "G21", "MATH")).toBe("Junior Math");
    expect(courseOf("", "Senior G4 | English | X", "ENGLISH")).toBe("Senior English");
    expect(courseOf("", "Own class", "MATH")).toBe("");
  });

  it("writes days, times, dates and prices", () => {
    expect(daysText("ODD")).toBe("Mon Wed Fri");
    expect(daysText("EVEN")).toBe("Tue Thu Sat");
    expect(daysText("")).toBe("");
    expect(timeRange("14:00", 2)).toBe("14:00–16:00");
    expect(timeRange("9:30", null)).toBe("09:30");
    expect(timeRange("", 2)).toBe("");
    expect(shortDay("2026-09-02")).toBe("2 Sep 2026");
    expect(shortDay(null)).toBe("");
    expect(priceText(500000)).toBe("500 000 so’m a month");
  });

  it("colours a course's progress as lc-up does and flags its end", () => {
    expect(lessonsProgress(6, 40)).toMatchObject({ tone: "early", flag: "" });
    expect(lessonsProgress(7, 14)).toMatchObject({ tone: "half", flag: "" });
    expect(lessonsProgress(12, 14)).toMatchObject({ tone: "late", flag: "Ends in 2" });
    expect(lessonsProgress(14, 14)).toMatchObject({ tone: "late", flag: "Last lesson" });
    expect(lessonsProgress(33, 26)).toMatchObject({ tone: "past", flag: "Past plan by 7" });
    expect(percentText(50)).toBe("50%");
    expect(percentText((12 / 14) * 100)).toBe("85.7%");
  });

  it("lists the months the attendance part reaches back to", () => {
    expect(coveredMonths("2026-11-22")).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(coveredMonths("2026-01-15")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});
