/**
 * What survives the move to a drill-down: the unranked table a scheduled month gets instead
 * of one, and the five tiles above the page.
 *
 * The four flat ranked tables this file used to cover are gone — one hierarchy replaced them
 * — and their rules moved with them to `HierarchyPanel.test.tsx`. What stayed behind is the
 * table for a month nobody has sat, which is deliberately NOT a hierarchy: every level of a
 * hierarchy is a comparison, and there is nothing yet to compare.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduledClassroomTable } from "../RankTables";
import { HeadlineStats } from "../HeadlineStats";
import type { ClassroomRow, GroupTally, MonthlyStats } from "../types";

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

const classroom = (over: Partial<ClassroomRow> = {}): ClassroomRow => ({
  id: 11,
  name: "Math Senior A",
  subject: "MATH",
  subject_label: "Math",
  level: "senior",
  level_label: "Senior",
  teacher: { id: 5, name: "Nodir T" },
  branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
  midterms: 1,
  ...tally(),
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

describe("ScheduledClassroomTable", () => {
  it("renders labels, not enums, and opens the drill-down when a class is clicked", () => {
    const onSelect = vi.fn();
    const out = render(<ScheduledClassroomTable rows={[classroom()]} onSelect={onSelect} />);
    expect(out).toContain("Math Senior A");
    expect(out).toContain("Senior");
    expect(out).not.toContain("MATH");

    const button = container?.querySelector("tbody button") as HTMLElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe(11);
  });

  it("shows what is booked and no rate at all — a plan is not a result", () => {
    const out = render(<ScheduledClassroomTable rows={[classroom()]} onSelect={() => {}} />);
    expect(out).toContain("Papers booked");
    expect(out).not.toContain("Pass rate");
    expect(out).not.toContain("90%");
  });

  it("says nothing is booked rather than showing a bare table", () => {
    const out = render(<ScheduledClassroomTable rows={[]} onSelect={() => {}} />);
    expect(out).toContain("Nothing is booked in this month");
  });
});

describe("HeadlineStats", () => {
  const stats = (over: Partial<MonthlyStats["totals"]> = {}): MonthlyStats => ({
    month: "2026-09",
    definition: {},
    is_future: false,
    future_months: [],
    this_month: "2026-09",
    orphan_retakes: [],
    totals: { ...tally(), midterms: 2, ...over },
    branches: [],
    departments: [],
    teachers: [],
    classrooms: [],
    months: ["2026-09"],
    filters: { branch: null, subject: null, teacher: null },
  });

  it("leads with the rate, and shows the fraction it came from", () => {
    const out = render(<HeadlineStats stats={stats()} />);
    expect(out).toContain("90%");
    expect(out).toContain("9 of 10 roster places passed in September 2026");
    expect(out).toContain("8 at the first sitting · 1 on a retake");
  });

  it("splits the passers, never the roster", () => {
    const out = render(<HeadlineStats stats={stats()} />);
    expect(out).toContain("88.9% first sitting · 11.1% retake");
    expect(out).toContain("8 of 9 passers needed no retake");
  });

  it("says there is no split rather than printing 0% when nobody passed", () => {
    const out = render(
      <HeadlineStats
        stats={stats({
          passed: 0,
          passed_first: 0,
          passed_retake: 0,
          failed: 10,
          pass_rate: 0,
          first_try_share: null,
          retake_share: null,
        })}
      />,
    );
    expect(out).toContain("Nobody passed this month");
    expect(out).toContain("—");
  });

  it("flags the students who are still awaiting a verdict", () => {
    const out = render(<HeadlineStats stats={stats({ pending: 3 })} />);
    expect(out).toContain("3 still awaiting a result");
  });

  it("puts the HEADCOUNT under the word Students, not the roster-place total", () => {
    // `roster` is summed once per (classroom, paper) pair, so a class of 20 sitting two
    // papers contributes 40. Under a tile labelled "Students" that is simply a wrong number,
    // and it used to be the big one — with the real headcount as 12px detail beneath it.
    const out = render(
      <HeadlineStats stats={stats({ roster: 117, distinct_students: 99, classrooms: 6, midterms: 7 })} />,
    );
    const tile = [...(container?.querySelectorAll("div.rounded-2xl") ?? [])].find((d) =>
      d.textContent?.startsWith("Students"),
    );
    expect(tile?.textContent).toBe(
      "Students996 classes · 7 papers117 roster places — every rate is over these.",
    );
    expect(out).not.toContain("Students117");
  });

  it("drops the roster line entirely when it would say the same thing twice", () => {
    const out = render(<HeadlineStats stats={stats({ roster: 10, distinct_students: 10 })} />);
    expect(out).not.toContain("roster places — every rate is over these");
  });
});
