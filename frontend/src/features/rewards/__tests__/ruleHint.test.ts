/**
 * The support-session line on the rewards page, read off the rule's ladder.
 *
 * Since 2026-10-21 a support session holds at most two students and pays 10 alone, 15 each
 * for two. The line used to destructure exactly three rungs, so a two-rung ladder made the
 * whole explanation vanish — these pin that it reads the ladder as a list of any length.
 */
import { describe, expect, it } from "vitest";

import { ruleHint, ruleRange } from "../RewardsPage";
import type { RewardRule } from "../rewardsApi";

function support(group_points: number[] | null): RewardRule {
  return { event: "SUPPORT_SESSION", label: "Support session", points: 10, grants_xp: true, group_points };
}

describe("support session reward line", () => {
  it("explains the school's two-rung ladder: 10 alone, 15 each for two", () => {
    const hint = ruleHint(support([10, 15])) ?? "";
    expect(hint).toContain("10 on your own, 15 each if two of you go.");
    expect(hint).toContain("A session holds up to 2 students.");
    expect(hint).not.toMatch(/three|20/);
  });

  it("still reads a longer ladder, should the school ever widen it", () => {
    const hint = ruleHint(support([10, 15, 20])) ?? "";
    expect(hint).toContain("15 each if two of you go, 20 each if 3 of you go.");
    expect(hint).toContain("up to 3 students");
  });

  it("says nothing about groups when the rule has no ladder", () => {
    expect(ruleHint(support(null))).toBeNull();
  });

  it("shows the range from the bottom rung to the top", () => {
    expect(ruleRange(support([10, 15]))).toBe("10–15");
    expect(ruleRange(support(null))).toBe("10");
  });
});
