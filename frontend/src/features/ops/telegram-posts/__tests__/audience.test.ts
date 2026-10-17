import { describe, expect, it } from "vitest";
import {
  draftChats, draftFrom, draftToFields, firstLine, kindLabel, scheduleLabel, sentLabel, targetChats,
} from "../audience";
import type { TelegramGroup } from "../telegramPostsApi";

const groups: TelegramGroup[] = [
  { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
  { id: 2, name: "Junior G2 Math", subject: "MATH", level: "junior", chat_id: "-1002" },
  { id: 3, name: "Senior G3 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
  { id: 4, name: "Senior G4 English", subject: "ENGLISH", level: "senior", chat_id: "-1003" },
];

describe("targetChats", () => {
  it("counts every chat once by default", () => {
    expect(targetChats(groups, { subjects: [], levels: [] })).toEqual(["-1001", "-1002", "-1003"]);
  });

  it("filters by subject and by level", () => {
    expect(targetChats(groups, { subjects: ["MATH"], levels: [] })).toEqual(["-1001", "-1002"]);
    expect(targetChats(groups, { subjects: [], levels: ["senior"] })).toEqual(["-1001", "-1003"]);
  });

  it("lets chosen classes win over the filters", () => {
    expect(targetChats(groups, { subjects: ["ENGLISH"], levels: [], classroom_ids: [2] })).toEqual(["-1002"]);
  });
});

describe("labels", () => {
  it("reads a post's kind and schedule", () => {
    expect(kindLabel({ kind: "MANUAL", when: "WEEKLY" })).toBe("Weekly");
    expect(kindLabel({ kind: "EVENT_REMINDER", when: "EVENT" })).toBe("Event reminder");
    expect(scheduleLabel({ when: "WEEKLY", weekdays: [5], time_of_day: "18:00:00", send_at: null })).toBe("Every Sat at 18:00");
    expect(scheduleLabel({ when: "EVENT", weekdays: [], time_of_day: null, send_at: null })).toBe("The evening before, 18:00");
  });

  it("shows the first line as plain text", () => {
    expect(firstLine("📢 <b>A &amp; B</b>\n\nmore")).toBe("📢 A & B");
  });

  it("sums up the last run", () => {
    expect(
      sentLabel({ last_run: { run_on: "2026-10-24", total: 26, sent: 24, failed: 2, missed: 0, pending: 0, deleted: 0, uncertain: 0 } }),
    ).toBe("Sent 24/26 · 2 failed");
    expect(sentLabel({ last_run: null })).toBe("");
  });
});

describe("audience drafts", () => {
  it("starts in the mode the saved audience implies", () => {
    expect(draftFrom(undefined)).toEqual({ mode: "filter", subjects: [], levels: [], classroom_ids: [] });
    expect(draftFrom({ subjects: [], levels: [], classroom_ids: [3] }).mode).toBe("groups");
  });

  it("reaches no group when specific groups is chosen and none is ticked", () => {
    expect(draftChats(groups, { mode: "groups", subjects: [], levels: [], classroom_ids: [] })).toEqual([]);
    expect(draftChats(groups, { mode: "filter", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual(["-1001", "-1002"]);
  });

  it("sends only the half of the draft its mode uses", () => {
    expect(draftToFields({ mode: "groups", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual({
      subjects: [], levels: [], classroom_ids: [3],
    });
    expect(draftToFields({ mode: "filter", subjects: ["MATH"], levels: [], classroom_ids: [3] })).toEqual({
      subjects: ["MATH"], levels: [], classroom_ids: [],
    });
  });
});
