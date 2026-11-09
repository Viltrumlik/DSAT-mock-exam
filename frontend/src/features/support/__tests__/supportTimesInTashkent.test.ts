/**
 * A support hour is an hour in Tashkent, whatever clock the reader's device keeps.
 *
 * 2026-11-09: a student booked the 16:00 hour from a laptop whose timezone sat three hours
 * behind Tashkent. Every support page rendered times in the device's own zone, so on that
 * laptop the hour could read "13:00" — while the support teacher, on a Tashkent clock, saw the
 * same booking at 16:00 and another student at 13:00. The server and the request were right;
 * only the label moved.
 *
 * These run on a device set to Europe/Kyiv (UTC+2 in November — exactly that three-hour gap).
 * The suite itself is pinned to Asia/Tashkent in vitest.config.ts, which is why no other test
 * could see this.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { supportHourLabel } from "@/features/services/servicesHooks";
import { formatDay, formatTime, formatWhen } from "@/features/supportReport/format";

import { dayLabel, fmtDay, fmtHour, fmtWhen } from "../teacherDiary";

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** The hour, in whichever clock style the test runner's locale uses. */
const SIXTEEN = /(16:00|04:00\sPM)/;

let savedTz: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("support times on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("labels the hour by the school's clock on the booking calendar and the teacher's diary", () => {
    expect(fmtHour(FOUR_PM)).toMatch(SIXTEEN);
    expect(fmtWhen(FOUR_PM)).toMatch(SIXTEEN);
    expect(fmtWhen(FOUR_PM)).toContain("9");
  });

  it("says Today for a session that is today in Tashkent, though the device is still on yesterday", () => {
    // 01:00 on the 10th in Tashkent is 22:00 on the 9th in Kyiv.
    const now = Date.parse("2026-11-10T01:00:00+05:00");
    expect(dayLabel("2026-11-10T13:00:00+05:00", now).title).toBe("Today");
    // The calendar's own day keys are school dates.
    expect(dayLabel("2026-11-10", now).title).toBe("Today");
    expect(dayLabel("2026-11-10", now).sub).toContain("10");
    expect(dayLabel("2026-11-11", now).title).toBe("Tomorrow");
  });

  it("dates a moment by the school's calendar", () => {
    // 01:00 on the 10th in Tashkent — still the 9th on the device.
    expect(fmtDay("2026-11-10T01:00:00+05:00")).toContain("10");
    expect(formatDay("2026-11-10T01:00:00+05:00")).toContain("10");
  });

  it("names the next support hour on the services page by the school's clock", () => {
    const now = new Date("2026-11-09T09:00:00+05:00");
    expect(supportHourLabel(FOUR_PM, now)).toMatch(new RegExp(`^Today, ${SIXTEEN.source}$`));
    expect(supportHourLabel("2026-11-10T13:00:00+05:00", new Date("2026-11-10T01:00:00+05:00")))
      .toMatch(/^Today, /);
  });

  it("shows the same hour in the support report", () => {
    expect(formatTime(FOUR_PM)).toMatch(SIXTEEN);
    expect(formatWhen(FOUR_PM)).toMatch(SIXTEEN);
  });
});
