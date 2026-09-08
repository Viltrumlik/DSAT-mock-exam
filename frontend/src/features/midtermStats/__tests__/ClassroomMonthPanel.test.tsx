/**
 * The drill-down: one class, one month, and the honesty markers that stop a reader over-
 * trusting it — a month that was inferred rather than timetabled, papers scored out of
 * different totals, and a failed fetch that must not read as "this class did nothing".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomMidtermRow, ClassroomMonth } from "../types";

const classroomCall = vi.fn();

vi.mock("../api", () => ({
  midtermStatsApi: {
    classroom: (...args: unknown[]) => classroomCall(...args),
    monthly: vi.fn(),
    months: vi.fn(),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

vi.mock("@/features/midtermReports/MidtermEvidence", () => ({
  MidtermEvidence: () => <div>student evidence</div>,
}));

import { ClassroomMonthPanel } from "../ClassroomMonthPanel";

const tally = {
  roster: 4,
  attended: 4,
  passed_first: 2,
  passed_retake: 1,
  failed: 1,
  absent: 0,
  pending: 0,
  retake_taken: 1,
  retake_passed: 1,
  retake_failed: 0,
  passed: 3,
  pass_rate: 75,
  attendance_rate: 100,
  first_try_share: 66.7,
  retake_share: 33.3,
};

const paper = (over: Partial<ClassroomMidtermRow> = {}): ClassroomMidtermRow => ({
  id: 7,
  title: "Midterm 12",
  subject: "READING_WRITING",
  midterm_type: "MIDTERM",
  pass_mark: 500,
  score_ceiling: 800,
  month: "2026-09",
  month_basis: "schedule",
  retakes: [{ id: 8, title: "Midterm 12 Retake" }],
  ...tally,
  ...over,
});

const detail = (over: Partial<ClassroomMonth> = {}): ClassroomMonth => ({
  classroom: {
    id: 11,
    name: "Math Senior A",
    subject: "MATH",
    subject_label: "Math",
    level: "senior",
    level_label: "Senior",
    teacher: { id: 5, name: "Nodir T" },
    branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
  },
  month: "2026-09",
  months: ["2026-09"],
  definition: { pass_rate: "passed / roster", rollup: "pooled" },
  summary: { ...tally, midterms: 1, distinct_students: 4 },
  rows: [paper()],
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(
      <ClassroomMonthPanel
        classroomId={11}
        initialMonth="2026-09"
        fallbackName="Math Senior A"
        onBack={() => {}}
        backLabel="Back to September 2026 statistics"
      />,
    );
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  classroomCall.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ClassroomMonthPanel", () => {
  it("shows the class, its summary and its papers — with labels, not enums", async () => {
    classroomCall.mockResolvedValue(detail());
    const out = await render();

    expect(out).toContain("Math Senior A");
    expect(out).toContain("Senior · Math · Nodir T · Chilonzor, Tashkent");
    expect(out).toContain("75%");
    expect(out).toContain("3 of 4 roster places");
    expect(out).toContain("2 first sitting · 1 on a retake");
    expect(out).toContain("Midterm 12");
    expect(out).toContain("Reading & Writing");
    expect(out).toContain("Pass mark 500 / 800");
    expect(out).not.toContain("READING_WRITING");
    expect(classroomCall).toHaveBeenCalledWith(11, "2026-09");
  });

  it("says when a paper's month was inferred rather than timetabled — once", async () => {
    classroomCall.mockResolvedValue(detail({ rows: [paper({ month_basis: "first_sitting" })] }));
    const out = await render();
    expect(out).toContain("From the first sitting");
    expect(out).toContain("never timetabled for this class");
    // The row used to print a hardcoded "this paper was never timetabled for this class, so
    // its month was inferred" and then append MONTH_BASIS_NOTE, which opens with the same
    // clause. The sentence appeared twice in a row and read as a rendering bug.
    expect(out.split("never timetabled for this class")).toHaveLength(2);
  });

  it("calls the attendance figure attendance, not SAT THE PAPER", async () => {
    classroomCall.mockResolvedValue(detail());
    const out = await render();
    // Uppercased in an SAT-prep product, "SAT THE PAPER" reads as "SAT the paper".
    expect(out).toContain("Attendance");
    expect(out).not.toContain("Sat the paper");
  });

  it("says nothing about the basis when the paper WAS timetabled", async () => {
    classroomCall.mockResolvedValue(detail());
    const out = await render();
    expect(out).not.toContain("was inferred");
  });

  it("warns when the month's papers are scored out of different totals", async () => {
    classroomCall.mockResolvedValue(
      detail({
        summary: { ...tally, midterms: 2, distinct_students: 4 },
        rows: [paper(), paper({ id: 9, title: "Midterm 13", score_ceiling: 100, pass_mark: 60 })],
      }),
    );
    const out = await render();
    expect(out).toContain("not all scored out of the same total");
    expect(out).toContain("Their pass rates are comparable; their scores are not.");
  });

  it("renders a failed fetch as a failure, not as a class that did nothing", async () => {
    classroomCall.mockRejectedValue(new Error("boom"));
    const out = await render();
    expect(out).toContain("Could not load these figures");
    expect(out).not.toContain("has never sat a midterm");
  });

  it("says a class has never sat a midterm when that is genuinely the case", async () => {
    classroomCall.mockResolvedValue(
      detail({
        month: null,
        months: [],
        rows: [],
        summary: {
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
          midterms: 0,
          distinct_students: 0,
        },
      }),
    );
    const out = await render();
    expect(out).toContain("This class has never sat a midterm");
    expect(out).not.toContain("Could not load");
  });

  it("opens the per-student evidence for a paper on request, not before", async () => {
    classroomCall.mockResolvedValue(detail());
    await render();
    expect(container?.textContent).not.toContain("student evidence");

    const toggle = container?.querySelector("button[aria-expanded]") as HTMLElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container?.textContent).toContain("student evidence");
  });
});
