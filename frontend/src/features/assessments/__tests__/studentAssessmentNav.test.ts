/**
 * The rules the student assessments page narrows by: which subject, which SAT domain, and what
 * belongs in To-do. The category strings below are the shapes on prod on 2026-09-13 — every
 * assigned set was `"Domain › Subdomain"`, and two math sets had no category at all.
 */
import { describe, expect, it } from "vitest";

import {
  compareTodo,
  domainOf,
  isOpenTodo,
  orderedDomains,
  OTHER_DOMAIN,
  subjectKeyOf,
} from "../studentAssessmentNav";

describe("subjectKeyOf", () => {
  it("reads both the set spelling and the platform spelling", () => {
    expect(subjectKeyOf("math")).toBe("math");
    expect(subjectKeyOf("MATH")).toBe("math");
    expect(subjectKeyOf("english")).toBe("english");
    expect(subjectKeyOf("READING_WRITING")).toBe("english");
  });

  it("places nothing it does not recognise", () => {
    expect(subjectKeyOf("")).toBeNull();
    expect(subjectKeyOf(undefined)).toBeNull();
    expect(subjectKeyOf("physics")).toBeNull();
  });
});

describe("domainOf", () => {
  it("is the part of the category before the ›", () => {
    expect(domainOf("Algebra › Linear functions")).toBe("Algebra");
    expect(domainOf("Standard English Conventions › Boundaries")).toBe("Standard English Conventions");
  });

  it("files an uncategorised set under Other instead of dropping it", () => {
    expect(domainOf("")).toBe(OTHER_DOMAIN);
    expect(domainOf("   ")).toBe(OTHER_DOMAIN);
    expect(domainOf(null)).toBe(OTHER_DOMAIN);
  });

  it("keeps a category written without a subdomain as its own domain", () => {
    expect(domainOf("Geometry and Trigonometry")).toBe("Geometry and Trigonometry");
  });
});

describe("orderedDomains", () => {
  it("lists only the domains present, in the SAT's order, whatever order they arrived in", () => {
    expect(orderedDomains("math", ["Geometry and Trigonometry", "Algebra", "Advanced Math"])).toEqual([
      "Algebra",
      "Advanced Math",
      "Geometry and Trigonometry",
    ]);
    expect(
      orderedDomains("english", ["Standard English Conventions", "Craft and Structure", "Information and Ideas"]),
    ).toEqual(["Craft and Structure", "Information and Ideas", "Standard English Conventions"]);
  });

  it("puts an unknown domain after the known ones and Other last", () => {
    expect(orderedDomains("math", [OTHER_DOMAIN, "Calculus", "Algebra", "Arithmetic"])).toEqual([
      "Algebra",
      "Arithmetic",
      "Calculus",
      OTHER_DOMAIN,
    ]);
  });
});

describe("isOpenTodo", () => {
  const now = new Date("2026-09-13T12:00:00+05:00").getTime();

  it("keeps work whose deadline is still ahead", () => {
    expect(isOpenTodo("2026-09-15T16:00:00+05:00", false, now)).toBe(true);
  });

  it("drops work whose deadline has passed", () => {
    expect(isOpenTodo("2026-09-12T16:00:00+05:00", false, now)).toBe(false);
  });

  it("drops work already handed in, however far off its deadline is", () => {
    expect(isOpenTodo("2026-09-20T16:00:00+05:00", true, now)).toBe(false);
  });

  it("keeps undone work that has no deadline — it has not passed one", () => {
    expect(isOpenTodo(null, false, now)).toBe(true);
    expect(isOpenTodo(undefined, false, now)).toBe(true);
  });
});

describe("compareTodo", () => {
  it("puts the nearest deadline first and undated work last", () => {
    const due = ["2026-09-20T16:00:00+05:00", null, "2026-09-14T16:00:00+05:00", undefined];
    expect([...due].sort(compareTodo)).toEqual([
      "2026-09-14T16:00:00+05:00",
      "2026-09-20T16:00:00+05:00",
      null,
      undefined,
    ]);
  });
});
