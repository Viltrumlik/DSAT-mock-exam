/**
 * A time typed into a scheduling form is a time in Tashkent, whatever clock the device keeps.
 *
 * `<input type="datetime-local">` holds a bare wall-clock reading, "2026-11-09T16:00", with no
 * zone. These helpers turn it into the moment the API stores and back. They used to read it on
 * the device's clock, so a staffer whose laptop sat three hours behind Tashkent who typed 16:00
 * saved 19:00 Tashkent — and, opening the form again, saw a 16:00 event as 13:00. After the
 * lists moved to Tashkent's clock (#364) the list and its own edit form disagreed on one screen.
 *
 * These run on a device set to Europe/Kyiv (UTC+2 in November). The suite is pinned to
 * Asia/Tashkent in vitest.config.ts, where the two readings cannot be told apart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { combineLocalDateTimeIso, nextNDays } from "@/lib/scheduleOptions";

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 on the 9th in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
const FOUR_PM_UTC = "2026-11-09T11:00:00.000Z";
/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const PAST_MIDNIGHT = "2026-11-10T01:00:00+05:00";

let savedTz: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("datetime-local values on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("fills the field with Tashkent's reading of the moment", () => {
    expect(toLocalInput(FOUR_PM)).toBe("2026-11-09T16:00");
    expect(toLocalInput(FOUR_PM_UTC)).toBe("2026-11-09T16:00");
    // The school's date, not the device's: past Tashkent's midnight the device is still on the 9th.
    expect(toLocalInput(PAST_MIDNIGHT)).toBe("2026-11-10T01:00");
  });

  it("reads what was typed as Tashkent's wall clock", () => {
    expect(fromLocalInput("2026-11-09T16:00")).toBe(FOUR_PM_UTC);
    expect(fromLocalInput("2026-11-10T01:00")).toBe("2026-11-09T20:00:00.000Z");
    // A browser with a seconds step sends them too.
    expect(fromLocalInput("2026-11-09T16:00:30")).toBe("2026-11-09T11:00:30.000Z");
  });

  it("round-trips: a 16:00 event opened and saved untouched stays 16:00", () => {
    expect(fromLocalInput(toLocalInput(FOUR_PM))).toBe(FOUR_PM_UTC);
    expect(fromLocalInput(toLocalInput(PAST_MIDNIGHT))).toBe(new Date(PAST_MIDNIGHT).toISOString());
  });

  it("still says nothing for an empty or broken value", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("not a date")).toBeNull();
    expect(fromLocalInput("2026-02-30T10:00")).toBeNull();
    expect(fromLocalInput("2026-11-09T24:30")).toBeNull();
  });
});

describe("the midterm assign picker on a device outside Tashkent", () => {
  it("combines the picked day and slot on Tashkent's clock", () => {
    expect(combineLocalDateTimeIso("2026-11-09", "16:00")).toBe(FOUR_PM_UTC);
    expect(combineLocalDateTimeIso("", "16:00")).toBeNull();
    expect(combineLocalDateTimeIso("2026-11-09", "")).toBeNull();
  });

  it("starts the week on Tashkent's today, though the device is still on yesterday", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PAST_MIDNIGHT));

    const days = nextNDays(3);

    expect(days.map((d) => d.value)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(days[0].label).toBe("Today · Tue, Nov 10");
    expect(days[1].label).toBe("Tomorrow · Wed, Nov 11");
    expect(days[2].label).toBe("Thu, Nov 12");
  });
});
