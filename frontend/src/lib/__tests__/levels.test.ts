import { describe, expect, it } from "vitest";
import {
  reconcileSecondaryLevel,
  secondaryLevelOptions,
  setHasLevel,
  setLevelsLabel,
} from "../levels";

/**
 * The optional second level on an assessment set (2026-10-11, the school's request: one set
 * shown to two cohorts at once). These helpers are what the builder's create form and set
 * editor use, and they must agree with the backend's AssessmentSetAdminWriteSerializer —
 * otherwise a form happily sends a pair the server answers with a 400 on secondary_level.
 */

describe("setLevelsLabel", () => {
  it("names one level, or both with the primary first", () => {
    expect(setLevelsLabel("junior", "")).toBe("Junior");
    expect(setLevelsLabel("junior", null)).toBe("Junior");
    expect(setLevelsLabel("junior", "middle")).toBe("Junior · Middle");
    expect(setLevelsLabel("senior", "foundation")).toBe("Senior · Foundation");
  });

  it("is blank for a legacy/untagged set", () => {
    expect(setLevelsLabel("", "")).toBe("");
    expect(setLevelsLabel(null, undefined)).toBe("");
  });

  it("passes an unknown code through rather than hiding it", () => {
    expect(setLevelsLabel("junior", "expert")).toBe("Junior · expert");
  });
});

describe("setHasLevel — the builder's level buckets", () => {
  it("puts a two-level set in both buckets, and no third", () => {
    const dual = { level: "junior", secondary_level: "middle" };
    expect(setHasLevel(dual, "junior")).toBe(true);
    expect(setHasLevel(dual, "middle")).toBe(true);
    expect(setHasLevel(dual, "senior")).toBe(false);
  });

  it("never matches a blank level through a blank second level", () => {
    expect(setHasLevel({ level: "junior", secondary_level: "" }, "")).toBe(false);
  });
});

describe("secondaryLevelOptions", () => {
  it("is the subject's levels minus the primary", () => {
    expect(secondaryLevelOptions("math", "junior")).toEqual(["foundation", "middle", "senior"]);
    // English has no Foundation.
    expect(secondaryLevelOptions("english", "junior")).toEqual(["middle", "senior"]);
  });

  it("offers nothing until a primary is chosen", () => {
    expect(secondaryLevelOptions("math", "")).toEqual([]);
    expect(secondaryLevelOptions("math", null)).toEqual([]);
  });
});

describe("reconcileSecondaryLevel — the forms' clearing rules", () => {
  it("keeps a second level that still fits", () => {
    expect(reconcileSecondaryLevel("math", "junior", "middle")).toBe("middle");
    // Primary moved, but not onto the second level.
    expect(reconcileSecondaryLevel("math", "senior", "middle")).toBe("middle");
  });

  it("clears it when the primary is blanked — it never stands alone", () => {
    expect(reconcileSecondaryLevel("math", "", "middle")).toBe("");
  });

  it("clears it when the primary moves onto it", () => {
    expect(reconcileSecondaryLevel("math", "middle", "middle")).toBe("");
  });

  it("clears it when the subject no longer has that level", () => {
    // Math Junior + Foundation, switched to English.
    expect(reconcileSecondaryLevel("english", "junior", "foundation")).toBe("");
  });

  it("leaves 'none' as none", () => {
    expect(reconcileSecondaryLevel("math", "junior", "")).toBe("");
    expect(reconcileSecondaryLevel("math", "junior", undefined)).toBe("");
  });
});
