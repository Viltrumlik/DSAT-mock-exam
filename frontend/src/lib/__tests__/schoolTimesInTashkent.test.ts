/**
 * A time at the centre is a time in Tashkent, whatever clock the reader's device keeps.
 *
 * The support pages learned this on 2026-11-09 (see `features/support/__tests__/
 * supportTimesInTashkent.test.ts`). These are the other places that print an hour of the
 * school's — a homework deadline, a midterm sitting, a Telegram post's send time, a moment on a
 * person's record — through the pure helpers that build the text.
 *
 * They run on a device set to Europe/Kyiv (UTC+2 in November, three hours behind Tashkent).
 * The suite itself is pinned to Asia/Tashkent in vitest.config.ts, which is why no other test
 * could see the difference.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatDeadline } from "@/features/questionAnalysis/format";
import { formatWhen as formatSitting } from "@/features/midtermReports/status";
import { formatDateTime } from "@/features/ops/people/format";
import { scheduleLabel } from "@/features/ops/telegram-posts/audience";
import { midtermStatus } from "@/features/desktop/homeModel";
import { formatAssignmentDueFull } from "@/lib/assignmentLifecycle";
import type { MidtermRow } from "@/lib/midtermApi";

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const AFTER_MIDNIGHT = "2026-11-10T01:00:00+05:00";
/** The hour, in whichever clock style the test runner's locale uses, seconds or not. */
const SIXTEEN = /(16:00|\b0?4:00(:00)?\sPM)/;

function midterm(over: Partial<MidtermRow> = {}): MidtermRow {
  return {
    midterm_id: 1,
    title: "Midterm 1",
    subject: "MATH",
    scoring_scale: "SCALE_100",
    score_ceiling: 100,
    duration_minutes: 60,
    question_count: 20,
    flavor: "CLASSROOM",
    attempt_id: null,
    state: "NOT_STARTED",
    submitted: false,
    is_open: false,
    is_before_start: true,
    awaiting_code: false,
    available_at: null,
    deadline: null,
    results_visible: false,
    score: null,
    certificate: null,
    ...over,
  };
}

let savedTz: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("school times on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
    expect(new Date(AFTER_MIDNIGHT).getDate()).toBe(9);
  });

  it("gives a homework deadline the school's hour", () => {
    expect(formatAssignmentDueFull(FOUR_PM)).toMatch(/^Nov 9, 2026, 04:00\sPM$/);
    expect(formatDeadline(FOUR_PM)).toMatch(/November 9, 2026.*4:00\sPM/);
    // Just past midnight in Tashkent is already the next day's deadline.
    expect(formatDeadline(AFTER_MIDNIGHT)).toMatch(/^Tuesday, November 10, 2026.*1:00\sAM$/);
  });

  it("dates a midterm sitting on the report by the school's clock", () => {
    expect(formatSitting(FOUR_PM)).toBe("9 Nov 2026, 16:00");
    expect(formatSitting(AFTER_MIDNIGHT)).toBe("10 Nov 2026, 01:00");
  });

  it("says when a scheduled midterm opens on the desktop home by the school's clock", () => {
    expect(midtermStatus(midterm({ available_at: FOUR_PM }), "scheduled").label).toMatch(
      /^Opens Mon, Nov 9, 4:00\sPM$/,
    );
    expect(midtermStatus(midterm({ available_at: AFTER_MIDNIGHT }), "scheduled").label).toMatch(
      /^Opens Tue, Nov 10, 1:00\sAM$/,
    );
  });

  it("names a one-off Telegram post's send time by the school's clock", () => {
    const label = scheduleLabel({ when: "ONCE", weekdays: [], time_of_day: null, send_at: FOUR_PM });
    expect(label).toMatch(SIXTEEN);
  });

  it("prints a moment on a person's record with the school's date and hour", () => {
    expect(formatDateTime(FOUR_PM)).toBe("Nov 9, 2026 16:00");
    expect(formatDateTime(AFTER_MIDNIGHT)).toBe("Nov 10, 2026 01:00");
  });
});
