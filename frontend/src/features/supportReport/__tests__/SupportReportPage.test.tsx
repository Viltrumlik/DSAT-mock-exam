/**
 * The page as a whole: does the month reach the screen, does the backlog shout, and does a
 * failed request read as a failure rather than as a desk nobody used?
 *
 * Those three get confused with each other, and confusing them here is expensive: this page is
 * read to judge how a support teacher's month went, so "no sessions" where a fetch failed is
 * not a cosmetic bug.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportCounts, SupportMonthlyReport, SupportSessionsReport } from "../types";

const monthly = vi.fn();
const sessions = vi.fn();

vi.mock("../api", () => ({
  supportReportApi: {
    monthly: (...args: unknown[]) => monthly(...args),
    sessions: (...args: unknown[]) => sessions(...args),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

import { SupportReportPage } from "../SupportReportPage";

const counts = (over: Partial<SupportCounts> = {}): SupportCounts => ({
  slots_published: 6,
  bookings: 8,
  held: 5,
  no_show: 1,
  cancelled: 1,
  upcoming: 0,
  unsettled: 1,
  unsettled_oldest: "2026-09-02T09:00:00+05:00",
  students_helped: 4,
  students_booked: 6,
  ...over,
});

const report = (over: Partial<SupportMonthlyReport> = {}): SupportMonthlyReport => ({
  month: "2026-09",
  months: ["2026-09", "2026-08"],
  generated_at: "2026-09-09T12:00:00+05:00",
  teacher_id: null,
  teachers: [
    {
      support_teacher_id: 7,
      support_teacher: "Dilafruz Ibrokhimjonova",
      ...counts(),
      attendance_rate: 0.8333,
      backlog_unsettled: 30,
      backlog_oldest: "2026-08-13T09:00:00+05:00",
    },
  ],
  total: { ...counts(), attendance_rate: 0.8333 },
  backlog: {
    unsettled: 32,
    oldest: "2026-08-13T09:00:00+05:00",
    teachers: [
      {
        support_teacher_id: 7,
        support_teacher: "Dilafruz Ibrokhimjonova",
        unsettled: 30,
        oldest: "2026-08-13T09:00:00+05:00",
      },
      {
        support_teacher_id: 8,
        support_teacher: "Nodir T",
        unsettled: 2,
        oldest: "2026-09-01T09:00:00+05:00",
      },
    ],
  },
  status_labels: {
    BOOKED: "Booked",
    HELD: "Held",
    NO_SHOW: "Did not attend",
    CANCELLED: "Cancelled",
  },
  ...over,
});

const emptyHistory: SupportSessionsReport = {
  results: [],
  count: 0,
  limit: 50,
  offset: 0,
  has_more: false,
  statuses: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<SupportReportPage />);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  monthly.mockReset();
  sessions.mockReset();
  sessions.mockResolvedValue(emptyHistory);
  // The banner scrolls the history into view; jsdom has no implementation for it.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SupportReportPage", () => {
  it("opens on the month the backend chose and states what the rate is made of", async () => {
    monthly.mockResolvedValue(report());
    const out = await render();

    expect(out).toContain("The desk in September 2026");
    expect(out).toContain("Dilafruz Ibrokhimjonova");
    // The payload's 0.8333 is a FRACTION. Printed unscaled it would read "1%".
    expect(out).toContain("83.3%");
    expect(out).not.toContain("0.8333");
    expect(out).toContain("5 of 6");
    expect(out).toContain("The whole school");
    expect(monthly).toHaveBeenCalledWith(null);
  });

  /**
   * The finding that prompted the whole report. Production has 32 of these, the oldest since
   * 13 August, and nothing anywhere said so.
   */
  it("puts the unsettled backlog above everything, in what it costs", async () => {
    monthly.mockResolvedValue(report());
    const out = await render();

    expect(out).toContain("32 support sessions have never been settled");
    expect(out).toContain("paid nobody");
    // Not just a count: the age and the owner are the parts that make it a backlog.
    // Locale-formatted by the browser; assert on the parts, not on one locale's order.
    expect(out).toMatch(/Aug(ust)?\s+13,?\s+2026|13\s+Aug(ust)?\s+2026/);
    expect(out).toContain("27 days ago");
    expect(out).toContain("Dilafruz Ibrokhimjonova");
    expect(out).toContain("Nodir T");
    // All time, so a September page still reports August's.
    expect(out).toContain("until the support teacher marks who turned up");
  });

  it("says nothing about a backlog when there is none", async () => {
    monthly.mockResolvedValue(
      report({ backlog: { unsettled: 0, oldest: null, teachers: [] } }),
    );
    const out = await render();

    expect(out).not.toContain("have never been settled");
    expect(out).toContain("The desk in September 2026");
  });

  it("renders a failed request as a failure — never as an empty desk", async () => {
    monthly.mockRejectedValue(new Error("boom"));
    const out = await render();

    expect(out).toContain("Could not load the support report");
    expect(out).toContain("Nothing here is empty — it is unknown");
    // The lie this rule exists to prevent.
    expect(out).not.toContain("No support hours in");
    expect(out).not.toContain("The whole school");
  });

  it("renders an empty month as an empty month, with the reason", async () => {
    monthly.mockResolvedValue(
      report({
        month: "2026-01",
        teachers: [],
        total: {
          ...counts({
            slots_published: 0,
            bookings: 0,
            held: 0,
            no_show: 0,
            cancelled: 0,
            unsettled: 0,
            unsettled_oldest: null,
            students_helped: 0,
            students_booked: 0,
          }),
          attendance_rate: null,
        },
        backlog: { unsettled: 0, oldest: null, teachers: [] },
      }),
    );
    const out = await render();

    expect(out).toContain("No support hours in January 2026");
    expect(out).not.toContain("Could not load");
  });

  /**
   * A month where the desk clearly ran hours but settled none of them. The rate has an empty
   * denominator, and 0% here would accuse a teacher of a problem they do not have.
   */
  it("shows an em dash, not 0%, when nobody was settled either way", async () => {
    monthly.mockResolvedValue(
      report({
        teachers: [
          {
            support_teacher_id: 7,
            support_teacher: "Dilafruz Ibrokhimjonova",
            ...counts({ held: 0, no_show: 0, cancelled: 0, unsettled: 8 }),
            attendance_rate: null,
            backlog_unsettled: 30,
            backlog_oldest: "2026-08-13T09:00:00+05:00",
          },
        ],
        total: {
          ...counts({ held: 0, no_show: 0, cancelled: 0, unsettled: 8 }),
          attendance_rate: null,
        },
      }),
    );
    const out = await render();

    expect(out).toContain("—");
    expect(out).not.toContain("0%");
    // And the dash says which of its two causes this is.
    expect(out).toContain("still waiting for somebody to mark who came");
  });

  it("seeds the history with the month it opened on", async () => {
    monthly.mockResolvedValue(report());
    await render();

    expect(sessions).toHaveBeenCalled();
    const first = sessions.mock.calls[0][0];
    expect(first.from).toBe("2026-09-01");
    expect(first.to).toBe("2026-09-30");
  });
});
