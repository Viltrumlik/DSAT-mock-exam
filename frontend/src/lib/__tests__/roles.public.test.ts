import { describe, expect, it } from "vitest";
import {
  CANONICAL_ROLES,
  homePathFor,
  isPublicStudent,
  isPublicStudentPath,
  isStudentSiteRole,
  ROLE_LABELS,
} from "@/lib/roles";

/** A public learner (signed up on the site, not at the learning center) sees mock exams and
 *  events, plus their profile — nothing else (owner, 2026-10-13). */
describe("public_student", () => {
  it("is a canonical, student-site role with its own home", () => {
    expect(CANONICAL_ROLES).toContain("public_student");
    expect(isPublicStudent("public_student")).toBe(true);
    expect(isPublicStudent("student")).toBe(false);
    expect(isStudentSiteRole("public_student")).toBe(true);
    expect(isStudentSiteRole(" Student ")).toBe(true);
    expect(isStudentSiteRole("teacher")).toBe(false);
    expect(homePathFor("public_student")).toBe("/mock-exam");
    expect(homePathFor("student")).toBe("/");
    expect(homePathFor(undefined)).toBe("/");
    expect(ROLE_LABELS.public_student).toBe("Public student");
  });

  it("may open only mock exams, the runner, events, the profile and their own review pages", () => {
    for (const p of [
      "/mock-exam",
      "/mock-exam/result/5",
      "/exam/9",
      "/events",
      "/events/3",
      "/profile",
      "/review/12",
    ]) {
      expect(isPublicStudentPath(p), p).toBe(true);
    }
    for (const p of [
      "/",
      "/classes",
      "/pastpapers",
      "/practice-tests",
      "/leaderboard",
      "/mock-examx",
      "/mock/4/results",
      "/examples",
      "/reviewer",
      "/review-center",
    ]) {
      expect(isPublicStudentPath(p), p).toBe(false);
    }
  });
});
