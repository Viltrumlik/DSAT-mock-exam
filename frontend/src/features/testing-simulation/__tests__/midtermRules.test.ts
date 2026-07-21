/**
 * The numbers the runner quotes at a student before they sit the paper.
 *
 * Lives with the runner rather than in src/lib because the runner is what puts these on
 * screen — a wrong pass mark here is a student told they need a score the server disagrees
 * with. The 800 scale is the trap: a blank paper already scores 200, so anything computed as
 * "percent of the ceiling" reads 50% as 400 instead of 500.
 */
import { describe, expect, it } from "vitest";

import {
  MIDTERM_OFFSCREEN_GRACE_SECONDS,
  MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
  midtermPassMark,
  midtermPassMarkLabel,
  offscreenChancesLabel,
  offscreenChancesLeft,
} from "@/lib/midtermRules";

describe("midterm pass mark", () => {
  it("defaults to half the QUESTIONS, not half the ceiling", () => {
    expect(midtermPassMark("SCALE_100")).toBe(50);
    expect(midtermPassMark("SCALE_800")).toBe(500); // 200 floor + half of the 600 span
  });

  it("uses the midterm's own pass mark when it has one", () => {
    expect(midtermPassMark("SCALE_800", 620)).toBe(620);
    expect(midtermPassMark("SCALE_100", 0)).toBe(0); // an explicit zero is a real value
  });

  it("quotes the pass mark against its own scale's ceiling", () => {
    expect(midtermPassMarkLabel("SCALE_800")).toBe("500 out of 800");
    expect(midtermPassMarkLabel("SCALE_100", 65)).toBe("65 out of 100");
  });

  it("falls back to the 100 scale for an unknown one rather than inventing bounds", () => {
    expect(midtermPassMarkLabel("SCALE_WHATEVER")).toBe("50 out of 100");
  });
});

describe("off-screen allowance", () => {
  it("mirrors the backend rule: 3 seconds, third offence forfeits", () => {
    expect(MIDTERM_OFFSCREEN_GRACE_SECONDS).toBe(3);
    expect(MIDTERM_OFFSCREEN_VIOLATION_LIMIT).toBe(3);
  });

  it("counts down the chances and never goes negative", () => {
    expect(offscreenChancesLeft(0)).toBe(3);
    expect(offscreenChancesLeft(2)).toBe(1);
    expect(offscreenChancesLeft(5)).toBe(0);
  });

  it("says it the way a student reads it", () => {
    expect(offscreenChancesLabel(1)).toBe("2 chances left");
    expect(offscreenChancesLabel(2)).toBe("1 chance left");
    expect(offscreenChancesLabel(3)).toBe("no chances left");
  });
});
