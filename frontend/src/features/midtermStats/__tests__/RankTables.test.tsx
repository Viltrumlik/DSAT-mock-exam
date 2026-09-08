/**
 * What the ranked tables must never do: print 0% where there was nothing to divide by, drop
 * the classrooms whose branch or teacher is unset, or show a percentage with no sight of the
 * counts it came from.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BranchTable, ClassroomTable, TeacherTable } from "../RankTables";
import { HeadlineStats } from "../HeadlineStats";
import type { BranchRow, ClassroomRow, GroupTally, MonthlyStats, TeacherRow } from "../types";

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

const branch = (over: Partial<BranchRow> = {}): BranchRow => ({
  id: 1,
  name: "Chilonzor",
  ...tally(),
  ...over,
});

const teacher = (over: Partial<TeacherRow> = {}): TeacherRow => ({
  id: 5,
  name: "Nodir T",
  subject: "MATH",
  subject_label: "Math",
  branch: "Chilonzor",
  ...tally(),
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

describe("BranchTable", () => {
  it("shows the counts a rate is made of, beside the rate", () => {
    const out = render(<BranchTable rows={[branch()]} />);
    expect(out).toContain("90%");
    expect(out).toContain("9 of 10");
  });

  it("renders an unmeasured branch as an em dash, never as 0%", () => {
    const out = render(
      <BranchTable
        rows={[
          branch({
            id: 2,
            name: "Yunusobod",
            roster: 0,
            passed: 0,
            passed_first: 0,
            passed_retake: 0,
            failed: 0,
            pass_rate: null,
            attendance_rate: null,
            first_try_share: null,
            retake_share: null,
            distinct_students: 0,
          }),
        ]}
      />,
    );
    expect(out).toContain("—");
    expect(out).not.toContain("0%");
    expect(out).toContain("No students on the roster");
  });

  it("keeps the classrooms with no branch, and marks them as the data gap they are", () => {
    const out = render(<BranchTable rows={[branch(), branch({ id: null, name: "Unassigned" })]} />);
    expect(out).toContain("Unassigned");
    expect(out).toContain("Data gap");
    expect(out).toContain("never backfilled");
  });

  it("explains an empty month instead of showing a bare table", () => {
    const out = render(<BranchTable rows={[]} />);
    expect(out).toContain("No branches to rank");
  });

  it("names both denominators on a row that has two, and reconciles them under the table", () => {
    // 112 of 226 students hold two active memberships, so a branch whose classes overlap
    // has roster > headcount in production. The row used to print "58 students" beside
    // "52 of 76" and explain neither number.
    const out = render(
      <BranchTable rows={[branch({ roster: 76, distinct_students: 58, passed: 52, pass_rate: 68 })]} />,
    );
    expect(out).toContain("2 classes · 58 students · 76 roster places");
    expect(out).toContain("52 of 76");
    expect(out).toContain("Rates are over roster places");
    expect(out).toContain("counts once per paper");
    expect(out).toContain("on both rosters");
  });

  it("says nothing about denominators when every row agrees with itself", () => {
    const out = render(<BranchTable rows={[branch()]} />);
    expect(out).toContain("2 classes · 10 students");
    expect(out).not.toContain("roster places");
  });

  it("draws NO bar for an unmeasured rate — an empty track is a picture of 0%", () => {
    render(
      <BranchTable
        rows={[
          branch({
            id: 2,
            name: "Yunusobod",
            roster: 0,
            passed: 0,
            pass_rate: null,
            distinct_students: 0,
          }),
        ]}
      />,
    );
    // The only decorative span in the rate cell is the bar; with no rate there is none.
    expect(container?.querySelectorAll("tbody [aria-hidden] .bg-primary")).toHaveLength(0);
  });

  it("draws a bar for a rate that exists", () => {
    render(<BranchTable rows={[branch()]} />);
    expect(container?.querySelectorAll("tbody [aria-hidden] .bg-primary").length).toBeGreaterThan(0);
  });
});

describe("TeacherTable", () => {
  it("shows the subject as a label and the class count behind the rate", () => {
    const out = render(<TeacherTable rows={[teacher()]} />);
    expect(out).toContain("Nodir T");
    expect(out).toContain("Math");
    expect(out).not.toContain("MATH");
  });

  it("names a class with nobody assigned rather than dropping it", () => {
    const out = render(
      <TeacherTable rows={[teacher({ id: null, name: "Unassigned", subject_label: null, branch: null })]} />,
    );
    expect(out).toContain("Unassigned");
    expect(out).toContain("Data gap");
  });
});

describe("ClassroomTable", () => {
  it("renders labels, not enums, and opens the drill-down when a class is clicked", () => {
    const onSelect = vi.fn();
    const out = render(<ClassroomTable rows={[classroom()]} onSelect={onSelect} />);
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

  it("says why a month is empty, without implying a failure", () => {
    const out = render(<ClassroomTable rows={[]} onSelect={() => {}} />);
    expect(out).toContain("No classes sat a midterm this month");
    expect(out).toContain("Pick another month");
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
