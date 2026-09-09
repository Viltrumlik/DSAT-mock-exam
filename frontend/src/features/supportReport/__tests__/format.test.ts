/**
 * The rules a type-check cannot enforce.
 *
 * Three of these are here because getting them wrong produces a page that looks correct and
 * says something false: a fraction printed as a percentage, an em dash printed as 0%, and a
 * raw enum printed at a student.
 */
import { describe, expect, it } from "vitest";

import {
  NO_VALUE,
  STATUS_LABEL,
  UNSETTLED_LABEL,
  ageInDays,
  ageLabel,
  attendanceReason,
  formatRate,
  formatShare,
  monthEnd,
  monthLabel,
  monthStart,
  nameList,
  pageRange,
  personName,
  plural,
  ratePercent,
  sessionStatusLabel,
  settledCount,
  teacherSubline,
  topicText,
} from "../format";
import type { SupportCounts, SupportSessionRow } from "../types";

const counts = (over: Partial<SupportCounts> = {}): SupportCounts => ({
  slots_published: 4,
  bookings: 5,
  held: 3,
  no_show: 1,
  cancelled: 1,
  upcoming: 0,
  unsettled: 0,
  unsettled_oldest: null,
  students_helped: 3,
  students_booked: 4,
  ...over,
});

const row = (over: Partial<SupportSessionRow> = {}): SupportSessionRow => ({
  id: 1,
  starts_at: "2026-09-01T09:00:00+05:00",
  ends_at: "2026-09-01T10:00:00+05:00",
  slot_id: 2,
  slot_note: "",
  capacity: 1,
  support_teacher_id: 7,
  support_teacher: "Dilafruz Ibrokhimjonova",
  student_id: 21,
  student: "Aziza K",
  classroom_id: 3,
  classroom_name: "Math Senior A",
  topic: "Quadratics",
  status: "HELD",
  status_label: "Held",
  booked_at: "2026-08-30T12:00:00+05:00",
  settled_at: "2026-09-01T10:05:00+05:00",
  settled_by_id: 7,
  settled_by: "Dilafruz Ibrokhimjonova",
  invited_by_id: null,
  invited_by: null,
  cancel_reason: "",
  cancelled_at: null,
  teacher_note: "",
  rating: null,
  rating_comment: "",
  is_unsettled: false,
  ...over,
});

describe("attendance rate", () => {
  /**
   * The backend sends `round(held / (held + no_show), 4)` — a FRACTION. Rendering it without
   * scaling prints "1%" for a desk with perfect attendance, which does not look like a bug;
   * it looks like a finding about a support teacher.
   */
  it("scales the payload's fraction into a percentage", () => {
    expect(ratePercent(0.7576)).toBe(75.8);
    expect(formatRate(0.7576)).toBe("75.8%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0.75)).toBe("75%");
    expect(formatRate(0)).toBe("0%");
  });

  /** The house rule: an empty denominator is not zero. */
  it("renders a missing rate as an em dash, never as 0%", () => {
    expect(formatRate(null)).toBe(NO_VALUE);
    expect(formatRate(undefined)).toBe(NO_VALUE);
    expect(ratePercent(null)).toBeNull();
    expect(formatRate(null)).not.toBe("0%");
  });

  it("explains the dash differently when there is a backlog behind it", () => {
    // A desk that ran hours and settled none of them is not a desk nobody came to.
    expect(attendanceReason(counts({ held: 0, no_show: 0, unsettled: 6 }))).toContain(
      "6 sessions",
    );
    expect(attendanceReason(counts({ held: 0, no_show: 0, unsettled: 0, bookings: 0 }))).toContain(
      "No hours were booked",
    );
  });

  it("counts the denominator as everyone settled either way", () => {
    expect(settledCount(counts({ held: 3, no_show: 1 }))).toBe(4);
    // Cancelled hours are in neither half — the seat went back to the calendar.
    expect(settledCount(counts({ held: 3, no_show: 1, cancelled: 9 }))).toBe(4);
    expect(formatShare(3, 4)).toBe("3 of 4");
  });
});

describe("status", () => {
  it("never renders a raw enum", () => {
    expect(STATUS_LABEL.NO_SHOW).toBe("Did not attend");
    expect(sessionStatusLabel(row({ status: "NO_SHOW", status_label: "Did not attend" })).label)
      .toBe("Did not attend");
    expect(sessionStatusLabel(row()).label).not.toContain("_");
  });

  /**
   * The split the backend cannot make. `BOOKED` is next Tuesday's appointment on one row and
   * August's unfinished paperwork on another; only `is_unsettled` tells them apart, and only
   * one of the two is something somebody has to act on.
   */
  it("calls a past BOOKED booking 'Not settled yet', and a future one 'Booked'", () => {
    const past = sessionStatusLabel(
      row({ status: "BOOKED", status_label: "Booked", is_unsettled: true }),
    );
    expect(past.label).toBe(UNSETTLED_LABEL);
    expect(past.tone).toBe("unsettled");

    const future = sessionStatusLabel(
      row({ status: "BOOKED", status_label: "Booked", is_unsettled: false }),
    );
    expect(future.label).toBe("Booked");
    expect(future.tone).toBe("upcoming");
  });

  it("prefers the server's own label so the vocabulary cannot drift", () => {
    expect(sessionStatusLabel(row({ status: "HELD", status_label: "Attended" })).label).toBe(
      "Attended",
    );
    // …and falls back to ours when the server sent nothing.
    expect(sessionStatusLabel(row({ status: "HELD", status_label: "" })).label).toBe("Held");
  });
});

describe("months", () => {
  it("reads a month key as a string, never through Date", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLabel("")).toBe("");
    expect(monthLabel("nonsense")).toBe("nonsense");
  });

  it("turns a month into the inclusive range the history's date inputs want", () => {
    expect(monthStart("2026-09")).toBe("2026-09-01");
    expect(monthEnd("2026-09")).toBe("2026-09-30");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    // Leap years, because a 28th of February would silently drop a day of sessions.
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("")).toBe("");
  });
});

describe("the backlog's age", () => {
  const now = new Date("2026-09-09T12:00:00+05:00");

  it("measures how long an unsettled hour has been waiting", () => {
    expect(ageInDays("2026-08-13T09:00:00+05:00", now)).toBe(27);
    expect(ageInDays(null, now)).toBeNull();
    // A slot in the future is not a backlog.
    expect(ageInDays("2026-10-01T09:00:00+05:00", now)).toBeNull();
  });

  it("says the age in words, because a bare date makes the reader subtract", () => {
    expect(ageLabel(0)).toBe("today");
    expect(ageLabel(1)).toBe("yesterday");
    expect(ageLabel(27)).toBe("27 days ago");
    expect(ageLabel(120)).toBe("4 months ago");
    expect(ageLabel(null)).toBe("");
  });
});

describe("prose", () => {
  it("names both counts when a row's hours and bookings disagree", () => {
    // One hour run as a small group is one slot and three bookings — the school prices
    // support per head, and a row showing one number without the other looks wrong.
    expect(teacherSubline(counts({ slots_published: 4, bookings: 6, students_booked: 5 })))
      .toBe("4 hours published · 6 bookings · 5 students");
    expect(teacherSubline(counts({ slots_published: 1, bookings: 1, students_booked: 1 })))
      .toBe("1 hour published · 1 booking · 1 student");
  });

  it("pluralises, lists names and ranges a page", () => {
    expect(plural(1, "session")).toBe("1 session");
    expect(plural(3, "class", "classes")).toBe("3 classes");
    expect(nameList(["Aziza"])).toBe("Aziza");
    expect(nameList(["Aziza", "Nodir"])).toBe("Aziza and Nodir");
    expect(nameList(["Aziza", "Nodir", "Kamola"])).toBe("Aziza, Nodir and Kamola");
    expect(pageRange(0, 50, 118)).toBe("1–50 of 118");
    expect(pageRange(50, 50, 118)).toBe("51–100 of 118");
    expect(pageRange(0, 0, 0)).toBe("0");
  });

  it("distinguishes a blank topic from a lost one", () => {
    expect(topicText({ topic: "Quadratics" })).toBe("Quadratics");
    expect(topicText({ topic: "   " })).toBeNull();
    expect(personName("")).toBe("Unnamed");
    expect(personName("  Aziza K ")).toBe("Aziza K");
  });
});
