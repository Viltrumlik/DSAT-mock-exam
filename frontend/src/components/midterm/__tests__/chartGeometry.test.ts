import { describe, expect, it } from "vitest";
import {
  LABEL_ANGLE,
  LABEL_BAND,
  LABEL_CHAR_WIDTH,
  MAX_LABEL_CHARS,
  SLOT_WIDTH,
  accuracyPercent,
  barPath,
  leftOverhang,
  niceTicks,
  truncateLabel,
} from "../chartGeometry";

describe("niceTicks", () => {
  it("keeps ticks integral — a '2.5 wrong' gridline would be meaningless", () => {
    for (const max of [1, 2, 3, 5, 7, 9, 12, 18, 24, 31, 57]) {
      const { top, ticks } = niceTicks(max);
      expect(ticks.every((t) => Number.isInteger(t))).toBe(true);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(top);
      expect(top).toBeGreaterThanOrEqual(max);
    }
  });

  it("never collapses the scale when every skill has a single mistake", () => {
    expect(niceTicks(1)).toEqual({ top: 1, ticks: [0, 1] });
  });

  it("survives a zero max without dividing by zero downstream", () => {
    expect(niceTicks(0).top).toBeGreaterThan(0);
  });
});

describe("barPath", () => {
  it("rounds the cap and squares the base", () => {
    const d = barPath(10, 50, 24, 100);
    // Two quadratic curves at the top, none at the bottom.
    expect(d.match(/Q/g)).toHaveLength(2);
    expect(d.startsWith("M10,150")).toBe(true);
    expect(d.endsWith("L34,150 Z")).toBe(true);
  });

  it("does not let the radius exceed a very short column", () => {
    const d = barPath(0, 100, 24, 1);
    expect(d).toContain("Q0,100 1,100");
  });
});

describe("truncateLabel", () => {
  it("leaves short SAT skill names alone", () => {
    expect(truncateLabel("Boundaries")).toBe("Boundaries");
  });

  it("ellipsises the long ones to a fixed budget", () => {
    const out = truncateLabel("Inference from a text or a set of texts", 24);
    expect(out).toHaveLength(24);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("leftOverhang", () => {
  it("reserves enough room that the leftmost tilted label cannot be clipped", () => {
    const label = "x".repeat(MAX_LABEL_CHARS);
    const overhang = leftOverhang([label, label]);
    const rad = (Math.abs(LABEL_ANGLE) * Math.PI) / 180;
    const firstCenter = overhang + SLOT_WIDTH / 2;
    const reach = label.length * LABEL_CHAR_WIDTH * Math.cos(rad);
    expect(firstCenter - reach).toBeGreaterThanOrEqual(0);
  });

  it("asks for nothing when the labels already fit inside the axis gutter", () => {
    expect(leftOverhang(["Ok", "Ok", "Ok"])).toBe(0);
  });

  it("keeps the tallest label inside the band reserved beneath the baseline", () => {
    const rad = (Math.abs(LABEL_ANGLE) * Math.PI) / 180;
    const drop = MAX_LABEL_CHARS * LABEL_CHAR_WIDTH * Math.sin(rad);
    expect(drop + 14).toBeLessThan(LABEL_BAND);
  });
});

describe("accuracyPercent", () => {
  it("reports the share correct, not the share wrong", () => {
    expect(accuracyPercent(6, 5)).toBe(17);
    expect(accuracyPercent(4, 0)).toBe(100);
  });

  it("returns 0 rather than NaN for an empty skill", () => {
    expect(accuracyPercent(0, 0)).toBe(0);
  });
});
