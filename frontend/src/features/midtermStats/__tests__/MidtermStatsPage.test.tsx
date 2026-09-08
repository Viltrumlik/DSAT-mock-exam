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
