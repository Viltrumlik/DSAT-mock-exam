/**
 * The page as a whole: does the month actually reach the screen, does a failed request read
 * as a failure rather than as an empty school, and does an empty month read as an empty month?
 *
 * Those three are the branches that get confused with each other, and confusing them here is
 * expensive: this page is read to judge teachers, so "no data" where a fetch failed is not a
 * cosmetic bug.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MonthlyStats } from "../types";

const monthly = vi.fn();

vi.mock("../api", () => ({
  midtermStatsApi: {
    monthly: (...args: unknown[]) => monthly(...args),
    classroom: vi.fn(),
    months: vi.fn(),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

// The records tab is not mounted on first paint; stub it so the smoke test does not drag the
// whole reports feature (and the axios instance) into jsdom.
vi.mock("@/features/midtermReports/MidtermReportsPage", () => ({
  default: () => <div>records browser</div>,
}));

import MidtermStatsPage from "../MidtermStatsPage";

const tally = {
  roster: 10,
  attended: 9,
  passed_first: 8,
  passed_retake: 1,
  failed: 1,
  absent: 0,
  pending: 0,
  retake_taken: 1,
  retake_passed: 1,
  retake_failed: 0,
  passed: 9,
  pass_rate: 90,
  attendance_rate: 90,
  first_try_share: 88.9,
  retake_share: 11.1,
  classrooms: 1,
  distinct_students: 10,
};

const payload = (over: Partial<MonthlyStats> = {}): MonthlyStats => ({
  month: "2026-09",
  definition: {
    pass_rate: "passed (first sitting or retake) / all roster students",
    absent_counts_as: "failed",
    rollup: "pooled",
  },
  // The time block every payload carries: what month it is, what is still ahead, and whether
  // the month on screen is one of those.
  is_future: false,
  future_months: [],
  this_month: "2026-09",
  orphan_retakes: [],
  totals: { ...tally, midterms: 1 },
  branches: [{ id: 1, name: "Chilonzor", ...tally }],
  departments: [{ subject: "MATH", label: "Math", name: "Math", ...tally }],
  teachers: [
    { id: 5, name: "Nodir T", subject: "MATH", subject_label: "Math", branch: "Chilonzor", ...tally },
  ],
  classrooms: [
    {
      id: 11,
      name: "Math Senior A",
      subject: "MATH",
      subject_label: "Math",
      level: "senior",
      level_label: "Senior",
      teacher: { id: 5, name: "Nodir T" },
      branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
      midterms: 1,
      ...tally,
    },
  ],
  months: ["2026-09", "2026-08"],
  filters: { branch: null, subject: null, teacher: null },
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<MidtermStatsPage />);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  monthly.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MidtermStatsPage", () => {
  it("opens on the month the backend chose and states the rule it measured by", async () => {
    monthly.mockResolvedValue(payload());
    const out = await render();

    expect(out).toContain("Midterm statistics");
    expect(out).toContain("90%");
    expect(out).toContain("9 of 10 roster places passed in September 2026");
    // The rule is on the page, not in a handbook.
    expect(out).toContain("passed (first sitting or retake) / all roster students");
    expect(out).toContain("An absent student counts as failed");
    // All four altitudes are present.
    for (const heading of ["Branches", "Departments", "Teachers", "Classes"]) {
      expect(out).toContain(heading);
    }
    expect(monthly).toHaveBeenCalledWith(null);
  });

  it("renders a failed request as a failure — never as an empty school", async () => {
    monthly.mockRejectedValue(new Error("boom"));
    const out = await render();

    expect(out).toContain("Could not load these figures");
    expect(out).toContain("Nothing here is empty — it is unknown");
    expect(out).not.toContain("No midterms in");
    expect(out).not.toContain("Branches");
  });

  it("renders an empty month as an empty month, with the reason", async () => {
    monthly.mockResolvedValue(
      payload({
        month: "2026-01",
        totals: {
          ...tally,
          roster: 0,
          attended: 0,
          passed: 0,
          passed_first: 0,
          passed_retake: 0,
          failed: 0,
          retake_taken: 0,
          retake_passed: 0,
          pass_rate: null,
          attendance_rate: null,
          first_try_share: null,
          retake_share: null,
          classrooms: 0,
          distinct_students: 0,
          midterms: 0,
        },
        branches: [],
        departments: [],
        teachers: [],
        classrooms: [],
      }),
    );
    const out = await render();

    expect(out).toContain("No midterms in January 2026");
    expect(out).toContain("—");
    expect(out).not.toContain("Could not load");
  });

  it("warns that a month with verdicts outstanding is a floor, not a final figure", async () => {
    monthly.mockResolvedValue(
      payload({ totals: { ...tally, pending: 4, midterms: 1 } }),
    );
    const out = await render();
    // `pending` counts roster places, not students — a student awaiting two verdicts is two
    // of them. Calling them students overstated the headcount, which is the mistake the
    // Students tile used to make one altitude up.
    expect(out).toContain("4 roster places in September 2026 are still awaiting a result");
    expect(out).not.toContain("4 students in September 2026");
    expect(out).toContain("can only go up");
  });

  /**
   * The worst reading this page can produce, and the reason `is_future` is on the wire.
   *
   * A midterm booked for next month dates into next month, its roster has sat nothing, absent
   * counts as not passed — and the pooled formula answers 0.0%. Nothing in the shape of that
   * answer says it is a plan. The backend stopped such a month being the DEFAULT; the picker
   * still offers it, so everything below has to say what it is.
   */
  describe("a month the school has not reached", () => {
    const scheduled = () =>
      payload({
        month: "2026-10",
        is_future: true,
        future_months: ["2026-10"],
        this_month: "2026-09",
        months: ["2026-10", "2026-09", "2026-08"],
        totals: {
          ...tally,
          attended: 0,
          passed_first: 0,
          passed_retake: 0,
          passed: 0,
          failed: 0,
          absent: 10,
          retake_taken: 0,
          retake_passed: 0,
          // The formula's honest answer over a roster nobody has sat: zero, not null.
          pass_rate: 0,
          attendance_rate: 0,
          first_try_share: null,
          retake_share: null,
          midterms: 1,
        },
      });

    it("reports it as scheduled and prints no pass rate at all", async () => {
      monthly.mockResolvedValue(scheduled());
      const out = await render();

      expect(out).toContain("October 2026 is scheduled — nobody has sat these papers yet");
      expect(out).toContain("it is September 2026 now");
      expect(out).toContain("Scheduled");
      // The whole point: the 0% the backend computed never reaches the screen.
      expect(out).not.toContain("0%");
      expect(out).not.toContain("0 of 10 roster places passed");
      // Nor the verdict tiles that are only zero because nothing has happened.
      expect(out).not.toContain("Did not pass");
      expect(out).toContain("Papers scheduled");
    });

    it("shows what is booked instead of ranking classes that have sat nothing", async () => {
      monthly.mockResolvedValue(scheduled());
      const out = await render();

      expect(out).toContain("Booked for October 2026");
      expect(out).toContain("Papers booked");
      expect(out).toContain("Math Senior A");
      // A league table of a plan: the order alone would be read as a finding.
      for (const heading of ["Branches", "Departments", "Teachers"]) {
        expect(out).not.toContain(heading);
      }
      expect(out).not.toContain("Pass rate by");
    });

    it("offers the newest month actually sat as the way out", async () => {
      monthly.mockResolvedValue(scheduled());
      await render();
      const back = [...(container?.querySelectorAll("button") ?? [])].find((b) =>
        b.textContent?.includes("Show September 2026 instead"),
      ) as HTMLElement;
      expect(back).toBeTruthy();

      monthly.mockResolvedValue(payload());
      await act(async () => {
        back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(monthly).toHaveBeenLastCalledWith("2026-09");
    });

    it("marks a scheduled month in the picker, so choosing one is a choice", async () => {
      monthly.mockResolvedValue(scheduled());
      await render();
      const options = [...(container?.querySelectorAll("option") ?? [])].map((o) => o.textContent);
      expect(options).toContain("October 2026 (scheduled)");
      expect(options).toContain("September 2026");
    });

    it("says there are no results yet when there is no month to open on", async () => {
      // `/stats/months/` answers `current: null` in exactly this case, and the monthly payload
      // answers `month: null`. An empty school it is not.
      monthly.mockResolvedValue(
        payload({
          month: null,
          is_future: false,
          future_months: ["2026-10"],
          this_month: "2026-09",
          months: ["2026-10"],
          totals: {
            ...tally,
            roster: 0,
            attended: 0,
            passed: 0,
            passed_first: 0,
            passed_retake: 0,
            failed: 0,
            absent: 0,
            retake_taken: 0,
            retake_passed: 0,
            pass_rate: null,
            attendance_rate: null,
            first_try_share: null,
            retake_share: null,
            classrooms: 0,
            distinct_students: 0,
            midterms: 0,
          },
          branches: [],
          departments: [],
          teachers: [],
          classrooms: [],
        }),
      );
      const out = await render();

      expect(out).toContain("No results yet");
      expect(out).toContain("Every month it has is still ahead: October 2026");
      expect(out).not.toContain("No midterms in");
      expect(out).not.toContain("Could not load");
      // And the picker does not sit blank with nothing selected.
      expect(out).toContain("No month with results");
      // No month was chosen, so nothing is on screen wearing the word "Passed" over a zero.
      expect(out).not.toContain("Did not pass");
      expect(out).not.toContain("How passers got through");
    });
  });

  describe("orphan retakes", () => {
    const orphans = [{ id: 44, title: "Midterm 12 Retake" }];

    it("names the papers left out of every figure", async () => {
      monthly.mockResolvedValue(payload({ orphan_retakes: orphans }));
      const out = await render();

      expect(out).toContain("1 retake paper left out of every figure for September 2026");
      expect(out).toContain("Midterm 12 Retake");
      expect(out).toContain("no parent midterm");
      // Still a month with data: the tables are untouched.
      expect(out).toContain("Branches");
    });

    it("explains an empty month whose only paper was an orphan retake", async () => {
      monthly.mockResolvedValue(
        payload({
          month: "2026-01",
          orphan_retakes: orphans,
          totals: {
            ...tally,
            roster: 0,
            attended: 0,
            passed: 0,
            passed_first: 0,
            passed_retake: 0,
            failed: 0,
            absent: 0,
            retake_taken: 0,
            retake_passed: 0,
            pass_rate: null,
            attendance_rate: null,
            first_try_share: null,
            retake_share: null,
            classrooms: 0,
            distinct_students: 0,
            midterms: 0,
          },
          branches: [],
          departments: [],
          teachers: [],
          classrooms: [],
        }),
      );
      const out = await render();

      expect(out).toContain("No countable midterms in January 2026");
      expect(out).toContain("is a retake with no parent midterm — Midterm 12 Retake");
      // The generic copy would have left the reader hunting for a paper they can see.
      expect(out).not.toContain("No class sat a countable paper in this month");
    });
  });

  it("never calls roster places students, at any altitude", async () => {
    // A class of 5 sitting two papers: 10 roster places, 5 human beings.
    monthly.mockResolvedValue(
      payload({
        totals: { ...tally, roster: 10, distinct_students: 5, classrooms: 1, midterms: 2 },
      }),
    );
    const out = await render();
    expect(out).toContain("10 roster places — every rate is over these.");
    // The headline tile leads with the 5 human beings, not the 10 roster places.
    expect(out).toContain("Students51 class · 2 papers");
    expect(out).not.toContain("Students101 class");
  });
});
