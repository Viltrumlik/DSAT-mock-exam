/**
 * The one chart on the page, and the three things it must never do.
 *
 * A chart is a claim about comparability, which is what makes it more dangerous than the
 * table beside it: a bar has no room for a "Data gap" marker, no counts under it and no
 * tooltip a printed page can carry. So the rules are enforced before anything is drawn — the
 * gap bucket is not a group, two bars are not a comparison, and a bare number on an axis is
 * not a percentage.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PassRateChart } from "../PassRateChart";
import type { BranchRow, GroupTally, MonthlyStats, TeacherRow } from "../types";

const tally = (over: Partial<GroupTally> = {}): GroupTally => ({
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
  classrooms: 2,
  distinct_students: 10,
  ...over,
});

const branch = (id: number | null, name: string, pass_rate: number | null): BranchRow => ({
  id,
  name,
  ...tally({ pass_rate }),
});

const teacher = (id: number | null, name: string, pass_rate: number | null): TeacherRow => ({
  id,
  name,
  subject: "MATH",
  subject_label: "Math",
  branch: "Chilonzor",
  ...tally({ pass_rate }),
});

const stats = (over: Partial<MonthlyStats> = {}): MonthlyStats => ({
  month: "2026-09",
  definition: {},
  totals: { ...tally(), midterms: 2 },
  branches: [],
  departments: [],
  teachers: [],
  classrooms: [],
  months: ["2026-09"],
  filters: { branch: null, subject: null, teacher: null },
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: React.ReactElement): string {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("PassRateChart", () => {
  it("draws nothing when there are only two groups to compare", () => {
    const out = render(
      <PassRateChart
        stats={stats({ branches: [branch(1, "Chilonzor", 91), branch(2, "Yunusobod", 84)] })}
      />,
    );
    // Two bars beside a two-row table are the same fact drawn twice.
    expect(out).toBe("");
  });

  it("does not let one real branch plus the data gap pass as a two-bar comparison", () => {
    const out = render(
      <PassRateChart
        stats={stats({ branches: [branch(1, "Chilonzor", 91), branch(null, "Unassigned", 62)] })} />,
    );
    expect(out).toBe("");
  });

  it("plots the real branches and leaves the data gap out of the bars", () => {
    const out = render(
      <PassRateChart
        stats={stats({
          branches: [
            branch(1, "Chilonzor", 91),
            branch(2, "Yunusobod", 84),
            branch(null, "Unassigned", 62),
            branch(3, "Sergeli", 77),
          ],
        })}
      />,
    );
    expect(out).toContain("Pass rate by branch");
    expect(out).toContain("Chilonzor");
    expect(out).toContain("Sergeli");
    // The bucket is named in the caption and never given a bar of its own.
    expect(out).toContain("unassigned bucket is left out");
    const bars = container?.querySelectorAll("ol > li") ?? [];
    expect(bars).toHaveLength(3);
    expect([...bars].some((li) => li.textContent?.includes("Unassigned"))).toBe(false);
  });

  it("puts a unit on every number, axis included", () => {
    const out = render(
      <PassRateChart
        stats={stats({
          branches: [branch(1, "A", 91), branch(2, "B", 84), branch(3, "C", 77)],
        })}
      />,
    );
    expect(out).toContain("91%");
    // The axis: bare 0/25/50/75/100 on a page whose other numbers are scores out of 800.
    for (const tick of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(out).toContain(tick);
    }
  });

  it("falls back to teachers only when the branches cannot carry a chart", () => {
    const out = render(
      <PassRateChart
        stats={stats({
          branches: [branch(1, "Chilonzor", 91), branch(null, "Unassigned", 62)],
          teachers: [
            teacher(1, "Aziza K", 73),
            teacher(2, "Nodira Y", 72),
            teacher(3, "Dilshod R", 65),
            teacher(null, "Unassigned", null),
          ],
        })}
      />,
    );
    expect(out).toContain("Pass rate by teacher");
    expect(out).toContain("Aziza K");
    expect(out).not.toContain("Pass rate by branch");
  });

  it("says which groups have no roster rather than plotting them at zero", () => {
    const out = render(
      <PassRateChart
        stats={stats({
          branches: [
            branch(1, "A", 91),
            branch(2, "B", 84),
            branch(3, "C", 77),
            branch(4, "D", null),
          ],
        })}
      />,
    );
    expect(out).toContain("1 branch has no roster this month");
    const bars = container?.querySelectorAll("ol > li") ?? [];
    expect([...bars].some((li) => li.textContent?.includes("D"))).toBe(false);
  });
});
