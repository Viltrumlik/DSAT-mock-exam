import { describe, expect, it } from "vitest";

import {
  daysUntil,
  describeDevice,
  dueLabel,
  initialSectionTargets,
  isTurnedIn,
  lastActiveLabel,
  lessonLabel,
  nextLesson,
  profileChecklist,
  recentResults,
  resultHref,
  roleLabel,
  subjectLabel,
  summariseHomework,
  type ChecklistInput,
  type HomeworkRow,
  type ScheduleEvent,
} from "../profileModel";

// Monday 14 September 2026, 15:30 in Tashkent (the suite's pinned zone).
const NOW = new Date(2026, 8, 14, 15, 30).getTime();
const at = (days: number, hours = 0) => new Date(NOW + days * 86_400_000 + hours * 3_600_000).toISOString();

describe("describeDevice", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", "Chrome on Windows", "computer"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", "Safari on iPhone", "phone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36", "Chrome on Android", "phone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36", "Chrome on Android", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0", "Edge on Windows", "computer"],
    ["Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36", "Samsung Internet on Android", "phone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", "Safari on Mac", "computer"],
    ["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0", "Firefox on Linux", "computer"],
    ["MasterSAT/1.4 (iPhone; iOS 18.6) CFNetwork/1568 Darwin/24.0", "MasterSAT app on iPhone", "app"],
    ["", "Unknown device", "computer"],
  ])("reads %s", (ua, label, kind) => {
    expect(describeDevice(ua)).toEqual({ label, kind });
  });
});

describe("lastActiveLabel", () => {
  it("says how long ago, in the words a person would use", () => {
    expect(lastActiveLabel(new Date(NOW - 30_000).toISOString(), NOW)).toBe("Active now");
    expect(lastActiveLabel(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe("Active 12 minutes ago");
    expect(lastActiveLabel(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe("Active 1 hour ago");
    expect(lastActiveLabel(new Date(NOW - 30 * 3_600_000).toISOString(), NOW)).toBe("Active yesterday");
    expect(lastActiveLabel(new Date(NOW - 4 * 86_400_000).toISOString(), NOW)).toBe("Active 4 days ago");
    expect(lastActiveLabel(null, NOW)).toBe("Active recently");
  });
});

describe("daysUntil", () => {
  it("counts calendar days, so tomorrow is 1 even late tonight", () => {
    expect(daysUntil("2026-09-14", NOW)).toBe(0);
    expect(daysUntil("2026-09-15", new Date(2026, 8, 14, 23, 59).getTime())).toBe(1);
    expect(daysUntil("2026-11-07", NOW)).toBe(54);
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe("homework", () => {
  const rows: HomeworkRow[] = [
    { id: 1, title: "Later", due_at: at(6), workflow_status: "NOT_STARTED" },
    { id: 2, title: "Missed", due_at: at(-2), workflow_status: "RETURNED" },
    { id: 3, title: "Tomorrow", due_at: at(1), workflow_status: "in_progress" },
    { id: 4, title: "Undated", due_at: null, workflow_status: "not_started" },
    { id: 5, title: "Sent", due_at: at(-4), workflow_status: "SUBMITTED" },
    { id: 6, title: "Marked", due_at: at(-5), workflow_status: "graded" },
  ];

  it("counts submitted and graded work as turned in, in either case, and a returned piece as not", () => {
    expect(isTurnedIn("SUBMITTED")).toBe(true);
    expect(isTurnedIn("graded")).toBe(true);
    expect(isTurnedIn("RETURNED")).toBe(false);
    expect(isTurnedIn("in_progress")).toBe(false);
  });

  it("puts the work to catch up on first, then by due date, undated last", () => {
    const summary = summariseHomework(rows, NOW);
    expect(summary.total).toBe(6);
    expect(summary.turnedIn).toBe(2);
    expect(summary.toDo.map((r) => r.title)).toEqual(["Missed", "Tomorrow", "Later", "Undated"]);
    expect(summary.catchUp).toBe(1);
  });

  it("labels due dates without ever saying overdue", () => {
    expect(dueLabel(at(-2), NOW)).toEqual({ text: "Catch up", tone: "catch-up" });
    expect(dueLabel(new Date(2026, 8, 14, 23, 0).toISOString(), NOW)).toEqual({ text: "Due today", tone: "soon" });
    expect(dueLabel(at(1), NOW)).toEqual({ text: "Due tomorrow", tone: "soon" });
    expect(dueLabel(at(6), NOW)).toEqual({ text: "Due in 6 days", tone: "later" });
    expect(dueLabel(null, NOW)).toEqual({ text: "No due date", tone: "none" });
  });
});

describe("nextLesson", () => {
  const events: ScheduleEvent[] = [
    { date: "2026-09-14", type: "class", time: "14:00", classroom_id: 34 },
    { date: "2026-09-16", type: "class", time: "14:00", classroom_id: 34 },
    { date: "2026-09-12", type: "class", time: "16:00", classroom_id: 35 },
    { date: "2026-09-15", type: "class", time: "16:00", classroom_id: 35 },
    { date: "2026-09-15", type: "mock", time: "", classroom_id: null },
  ];

  it("calls a lesson that has started but not finished on now", () => {
    const lesson = nextLesson(events, 34, 2, NOW);
    expect(lesson?.live).toBe(true);
    expect(lessonLabel(lesson!, NOW)).toBe("On now");
  });

  it("moves on once today's lesson is over", () => {
    const lesson = nextLesson(events, 34, 1, NOW);
    expect(lessonLabel(lesson!, NOW)).toBe("Wed, Sep 16 at 14:00");
  });

  it("says tomorrow for tomorrow, and nothing for a class with no lessons ahead", () => {
    expect(lessonLabel(nextLesson(events, 35, 2, NOW)!, NOW)).toBe("Tomorrow at 16:00");
    expect(nextLesson(events, 99, 2, NOW)).toBeNull();
  });

  it("reads a lesson time given as a range by its own end", () => {
    const ranged: ScheduleEvent[] = [
      { date: "2026-09-14", type: "class", time: "13:00-15:00", classroom_id: 7 },
      { date: "2026-09-14", type: "class", time: "15:00-16:30", classroom_id: 8 },
      { date: "2026-09-16", type: "class", time: "13:00-15:00", classroom_id: 7 },
    ];
    // 13:00–15:00 is over at 15:30 even though the class's lessons are "2 hours" long.
    expect(lessonLabel(nextLesson(ranged, 7, 4, NOW)!, NOW)).toBe("Wed, Sep 16 at 13:00");
    expect(nextLesson(ranged, 8, 1, NOW)?.live).toBe(true);
  });
});

describe("profileChecklist", () => {
  const complete: ChecklistInput = {
    realEmail: "madina@example.com",
    emailVerified: true,
    targetScore: 1400,
    examDate: "2026-11-07",
    photoUrl: "https://cdn/p.jpg",
    telegramLinked: true,
    phone: "+998901234567",
  };

  it("ticks what is done and keeps the order of what matters most", () => {
    const items = profileChecklist({ ...complete, photoUrl: null, phone: " " }, { telegramAvailable: true });
    expect(items.map((i) => i.key)).toEqual(["email", "goal", "exam", "photo", "telegram", "phone"]);
    expect(items.filter((i) => !i.done).map((i) => i.key)).toEqual(["photo", "phone"]);
  });

  it("asks to add an email that is missing and to confirm one that is not confirmed", () => {
    expect(profileChecklist({ ...complete, realEmail: "" }, { telegramAvailable: true })[0].label).toBe("Add your email");
    const unconfirmed = profileChecklist({ ...complete, emailVerified: false }, { telegramAvailable: true })[0];
    expect(unconfirmed).toMatchObject({ label: "Confirm your email", done: false });
  });

  it("leaves out a Telegram step nobody on this site can take", () => {
    const items = profileChecklist({ ...complete, telegramLinked: false }, { telegramAvailable: false });
    expect(items.map((i) => i.key)).not.toContain("telegram");
  });
});

describe("recentResults", () => {
  const attempt = (id: number, days: number, extra: Record<string, unknown> = {}) => ({
    id,
    submitted_at: at(-days),
    is_completed: true,
    score: 500 + id,
    practice_test_details: { subject: "MATH", mock_exam_id: null, mock_kind: null },
    ...extra,
  });

  it("keeps the latest scored tests, newest first, and leaves midterms to their own page", () => {
    const rows = recentResults([
      attempt(1, 9),
      attempt(2, 1),
      attempt(3, 2, { practice_test_details: { subject: "MATH", mock_exam_id: 8, mock_kind: "MIDTERM" } }),
      attempt(4, 3, { is_completed: false }),
      attempt(5, 4, { score: null }),
      attempt(6, 5, { practice_test_details: { subject: "READING_WRITING", mock_exam_id: 4, mock_kind: "MOCK_SAT" } }),
      attempt(7, 6),
    ]);
    expect(rows.map((r) => r.id)).toEqual([2, 6, 7]);
  });

  it("sends a mock to its result page and anything else to the review", () => {
    expect(resultHref({ id: 6, practice_test_details: { mock_exam_id: 4 } })).toBe("/mock-exam/result/6");
    expect(resultHref({ id: 2, practice_test_details: { mock_exam_id: null } })).toBe("/review/2");
  });

  it("names subjects and roles the way the page says them", () => {
    expect(subjectLabel("READING_WRITING")).toBe("Reading & Writing");
    expect(subjectLabel("MATH")).toBe("Math");
    expect(roleLabel("support_teacher")).toBe("Support teacher");
    expect(roleLabel("student")).toBe("Student");
  });
});

describe("initialSectionTargets", () => {
  it("starts from the stored section targets", () => {
    expect(initialSectionTargets(1400, 690, 710)).toEqual({ english: 690, math: 710 });
  });

  it("splits a total with no sections the way the dashboard does", () => {
    expect(initialSectionTargets(1450, null, null)).toEqual({ english: 730, math: 720 });
  });

  it("starts an unset goal in the middle of the scale", () => {
    expect(initialSectionTargets(null, null, null)).toEqual({ english: 650, math: 650 });
  });
});
