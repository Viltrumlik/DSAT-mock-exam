import type { SmsStatsCostMonth, SmsStatsDay } from "../smsApi";

/**
 * The overview charts' rows, kept apart from recharts so they can be tested. A day's delivered %
 * is drawn only when enough SMS reached their end that day: on a quiet day one test SMS swings it
 * from 0% to 100%, which says nothing about delivery.
 */

export const MIN_FOR_RATE = 10;

const short = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function deliveryRows(days: SmsStatsDay[]) {
  return days.map((d) => {
    const finished = d.delivered + d.undelivered + d.rejected;
    return {
      ...d,
      label: short(d.day),
      percent: finished >= MIN_FOR_RATE && d.rate !== null ? Math.round(d.rate * 100) : null,
    };
  });
}

const thousands = (soM: number) => Math.round(soM / 100) / 10;

/** Thousands of so'm, so the axis reads "30" rather than a clipped "30000"; months as "Nov 2026". */
export function costRows(months: SmsStatsCostMonth[]) {
  return months.map((m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return {
      month: new Date(y, mo - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
      debt_warning: thousands(m.debt_warning),
      campaign: thousands(m.campaign),
      automation: thousands(m.automation),
      test: thousands(m.test),
      total: thousands(m.total),
    };
  });
}

/** A day's cost, in thousands of so'm. */
export function costByDayRows(days: SmsStatsDay[]) {
  return days.map((d) => ({ day: short(d.day), cost: thousands(d.cost) }));
}
