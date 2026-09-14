import { describe, expect, it } from "vitest";

import type { SupportBooking } from "@/lib/api";

import { earliestExamDate, nextSupportHour, supportHourLabel } from "../servicesHooks";

const HOUR = 3_600_000;
const NOW = new Date(2026, 8, 13, 10, 0).getTime();

function booking(status: SupportBooking["status"], startsInHours: number, withdrawn = false) {
  const starts = NOW + startsInHours * HOUR;
  return {
    status,
    slot: {
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(starts + HOUR).toISOString(),
      is_cancelled: withdrawn,
    },
  } as SupportBooking;
}

describe("nextSupportHour", () => {
  it("counts an hour already under way, but not one that has ended", () => {
    const underWay = booking("BOOKED", -0.5);
    expect(nextSupportHour([booking("BOOKED", -2), underWay, booking("BOOKED", 5)], NOW)).toBe(underWay);
  });

  it("skips withdrawn and non-booked hours", () => {
    const real = booking("BOOKED", 9);
    expect(
      nextSupportHour([booking("BOOKED", 1, true), booking("CANCELLED", 2), booking("NO_SHOW", 3), real], NOW),
    ).toBe(real);
  });

  it("is null with nothing ahead", () => {
    expect(nextSupportHour([booking("HELD", -20)], NOW)).toBeNull();
    expect(nextSupportHour(undefined, NOW)).toBeNull();
  });
});

describe("earliestExamDate", () => {
  it("picks the soonest date, not the first listed", () => {
    const soonest = { id: 2, exam_date: "2026-10-03", label: "" };
    expect(earliestExamDate([{ id: 1, exam_date: "2026-12-05", label: "" }, soonest])).toBe(soonest);
    expect(earliestExamDate([])).toBeNull();
  });
});

describe("supportHourLabel", () => {
  const now = new Date(NOW);

  it("names today and tomorrow", () => {
    expect(supportHourLabel(new Date(2026, 8, 13, 15, 0).toISOString(), now)).toMatch(/^Today, /);
    expect(supportHourLabel(new Date(2026, 8, 14, 9, 0).toISOString(), now)).toMatch(/^Tomorrow, /);
  });

  it("gives a weekday and date after that", () => {
    const label = supportHourLabel(new Date(2026, 8, 20, 9, 0).toISOString(), now);
    expect(label).not.toMatch(/^(Today|Tomorrow)/);
    expect(label).toContain("20");
  });
});
