/**
 * The v0.4 shell's numbers and pins, apart from the frame: flags per category, counts per page, the panel's line,
 * and the pin list's rules (up to six, toggled, moved).
 */
import { describe, expect, it } from "vitest";

import type { AttentionItem, AttentionSource } from "@/features/console/attention";
import { OPS_CATEGORIES } from "../opsNav";
import { attentionItems, categoryFlags, groupLine, pageCounts, tabHref } from "../shellModel";
import { MAX_PINS, movePin, togglePin, type Pin } from "../shellStore";

const item = (id: string, href: string, tone: AttentionItem["tone"], count?: number): AttentionItem => ({
  id,
  icon: "warn",
  tone,
  title: id,
  action: { label: "Open", href },
  count,
});

const ITEMS = [
  item("sms", "/ops/sms", "critical", 22),
  item("trials", "/ops/trials", "attention", 16),
  item("lcup", "/ops/lcup", "attention", 3),
  item("teacher", "/ops/classrooms?status=active", "attention", 1),
  item("lessons", "/ops/classrooms/4?tab=attendance", "critical", 2),
];

describe("attentionItems", () => {
  it("keeps only the sources that are done and have something to act on", () => {
    const source = (status: AttentionSource["status"], it: AttentionItem | null): AttentionSource => ({ id: "x", label: "x", status, item: it, retry: () => undefined });
    expect(attentionItems([source("loading", null), source("error", null), source("done", null), source("done", ITEMS[0])])).toEqual([ITEMS[0]]);
  });
});

describe("categoryFlags", () => {
  it("counts the items linking into each category, coloured by the worst — Today carries them all", () => {
    const flags = categoryFlags(ITEMS, OPS_CATEGORIES);
    expect(flags.get("today")).toEqual({ count: 5, tone: "critical" });
    expect(flags.get("centre")).toEqual({ count: 3, tone: "critical" });
    expect(flags.get("teaching")).toEqual({ count: 2, tone: "critical" });
    expect(flags.get("people")).toBeUndefined();
  });

  it("is attention-coloured when nothing inside is critical", () => {
    expect(categoryFlags([ITEMS[1], ITEMS[2]], OPS_CATEGORIES).get("centre")).toEqual({ count: 2, tone: "attention" });
  });
});

describe("pageCounts", () => {
  it("adds the items' numbers up per page, a record's link counting for its page", () => {
    const counts = pageCounts(ITEMS, OPS_CATEGORIES);
    expect(counts.get("/ops/sms")).toEqual({ count: 22, tone: "critical" });
    expect(counts.get("/ops/classrooms")).toEqual({ count: 3, tone: "critical" });
    expect(counts.get("/ops")).toBeUndefined();
  });

  it("has no number for an item that carries none — the panel draws a dot", () => {
    expect(pageCounts([item("sms", "/ops/sms", "attention")], OPS_CATEGORIES).get("/ops/sms")).toEqual({ count: undefined, tone: "attention" });
  });
});

describe("groupLine", () => {
  it("names a category's groups in a short line", () => {
    expect(groupLine(OPS_CATEGORIES[3])).toBe("Enrolment, money, messages and help");
    expect(groupLine(OPS_CATEGORIES[1])).toBe("Learners and team");
    expect(groupLine(OPS_CATEGORIES[0])).toBe("");
  });
});

describe("tabHref", () => {
  it("leaves the first tab as the page itself", () => {
    const tabs = [{ id: "overview" }, { id: "debtors" }];
    expect(tabHref("/ops/finance", tabs, "overview")).toBe("/ops/finance");
    expect(tabHref("/ops/finance", tabs, "debtors")).toBe("/ops/finance?tab=debtors");
  });
});

describe("pins", () => {
  const pin = (n: number): Pin => ({ href: `/ops/p${n}`, label: `P${n}`, icon: "users" });

  it("toggles a page in and out", () => {
    const one = togglePin([], pin(1));
    expect(one).toEqual([pin(1)]);
    expect(togglePin(one, pin(1))).toEqual([]);
  });

  it("refuses a seventh", () => {
    const six = Array.from({ length: MAX_PINS }, (_, i) => pin(i));
    expect(togglePin(six, pin(9))).toEqual(six);
    // …but still unpins one of the six.
    expect(togglePin(six, pin(2))).toHaveLength(5);
  });

  it("moves a pin, and ignores a move off either end", () => {
    const three = [pin(1), pin(2), pin(3)];
    expect(movePin(three, 0, 2).map((p) => p.label)).toEqual(["P2", "P3", "P1"]);
    expect(movePin(three, 0, -1)).toEqual(three);
    expect(movePin(three, 2, 3)).toEqual(three);
  });
});
