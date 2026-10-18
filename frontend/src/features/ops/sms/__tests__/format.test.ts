import { describe, expect, it } from "vitest";

import {
  campaignBadge,
  fillPattern,
  hourLabel,
  isAscii,
  kindLabel,
  money,
  roleLabel,
  skipLabel,
  slotLabel,
  smsParts,
  statusBadge,
  templateBadge,
  todayInTashkent,
} from "../format";

/**
 * The words and numbers the SMS panel prints. Money is what an admin weighs before a paid send,
 * so its shape is pinned exactly: digits grouped by threes and the currency kept on the same line.
 */

const NB = " ";

describe("money", () => {
  it("groups by threes with a non-breaking space and says so'm", () => {
    expect(money(1020)).toBe(`1${NB}020${NB}so'm`);
    expect(money(170)).toBe(`170${NB}so'm`);
    expect(money(1_250_000)).toBe(`1${NB}250${NB}000${NB}so'm`);
  });

  it("keeps the sign of a debt and never prints -0", () => {
    expect(money(-150_000)).toBe(`-150${NB}000${NB}so'm`);
    expect(money(0)).toBe(`0${NB}so'm`);
    expect(money(-0.2)).toBe(`0${NB}so'm`);
  });

  it("is a dash when there is no figure", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(Number.NaN)).toBe("—");
  });
});

describe("smsParts", () => {
  it("counts plain ASCII at 160, then 153 a part", () => {
    expect(smsParts("a".repeat(160))).toBe(1);
    expect(smsParts("a".repeat(161))).toBe(2);
    expect(smsParts("a".repeat(306))).toBe(2);
    expect(smsParts("a".repeat(307))).toBe(3);
  });

  it("counts any non-ASCII text at 70, then 67 a part", () => {
    expect(smsParts("ʻ".repeat(70))).toBe(1);
    expect(smsParts("ʻ".repeat(71))).toBe(2);
    expect(smsParts(`${"a".repeat(69)}ʻ`)).toBe(1);
  });

  it("is 0 for nothing written", () => {
    expect(smsParts("")).toBe(0);
  });

  it("knows ASCII from not", () => {
    expect(isAscii("MASTER SAT'dan")).toBe(true);
    expect(isAscii("Oʻzbekiston")).toBe(false);
  });
});

describe("fillPattern", () => {
  const pattern = "MASTER SAT'dan yozyabmiz. %w{1,4} sizda %d so'm qarz. %w";

  it("fills each slot in order, cutting words to the slot's maximum", () => {
    expect(fillPattern(pattern, ["Karimova Malika Akmal qizi Jr,", "150000", "Rahmat"])).toBe(
      "MASTER SAT'dan yozyabmiz. Karimova Malika Akmal qizi sizda 150000 so'm qarz. Rahmat",
    );
  });

  it("takes one word for a bare %w and turns curly apostrophes plain", () => {
    expect(fillPattern("Salom %w!", ["Gʻulom Ali"])).toBe("Salom G'ulom!");
  });

  it("marks an empty slot instead of dropping it", () => {
    expect(fillPattern("Salom %w!", [""])).toBe("Salom …!");
  });
});

describe("labels", () => {
  it("names every SMS status, and shows an unknown one as it came", () => {
    expect(statusBadge("DELIVERED")).toEqual({ variant: "success", label: "Delivered" });
    expect(statusBadge("UNDELIVERED").label).toBe("Not delivered");
    expect(statusBadge("UNCERTAIN").variant).toBe("warning");
    expect(statusBadge("WHATEVER")).toEqual({ variant: "neutral", label: "WHATEVER" });
  });

  it("names the kinds, the roles and the skip reasons", () => {
    expect(kindLabel("debt_warning")).toBe("Debt warning");
    expect(kindLabel("campaign")).toBe("Campaign");
    expect(kindLabel("test")).toBe("Test");
    expect(roleLabel("student")).toBe("Student's name");
    expect(roleLabel("debt")).toBe("Debt amount");
    expect(roleLabel("text")).toBe("Same text for all");
    expect(skipLabel("no_phone")).toBe("No phone in lc-up");
    expect(skipLabel("not_freezable")).toBe("not freezable");
  });

  it("calls a reklama template ad price, and both moderation spellings moderation", () => {
    expect(templateBadge("service").label).toBe("Service");
    expect(templateBadge("reklama").label).toBe("Ad price");
    expect(templateBadge("moderation").label).toBe("Moderation");
    expect(templateBadge("inproccess").label).toBe("Moderation");
    expect(templateBadge("gone").label).toBe("Gone");
  });

  it("names the campaign statuses", () => {
    expect(campaignBadge("SCHEDULED").label).toBe("Scheduled");
    expect(campaignBadge("DONE").variant).toBe("success");
    expect(campaignBadge("CANCELLED").label).toBe("Cancelled");
  });

  it("describes a slot", () => {
    expect(slotLabel({ kind: "w", min: 1, max: 4 })).toBe("1–4 words");
    expect(slotLabel({ kind: "w", min: 1, max: 1 })).toBe("1 word");
    expect(slotLabel({ kind: "d", min: 1, max: 1 })).toBe("a number");
  });

  it("writes an hour as a clock time", () => {
    expect(hourLabel(8)).toBe("08:00");
    expect(hourLabel(20)).toBe("20:00");
  });
});

describe("todayInTashkent", () => {
  it("is the Tashkent calendar day, whatever the machine's zone", () => {
    // 20:30 UTC is already the next day in Tashkent (UTC+5).
    expect(todayInTashkent(new Date("2026-10-31T20:30:00Z"))).toBe("2026-11-01");
    expect(todayInTashkent(new Date("2026-10-31T18:30:00Z"))).toBe("2026-10-31");
  });
});
