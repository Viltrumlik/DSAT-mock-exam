/**
 * What survives the move to a drill-down: the unranked table a scheduled month gets instead
 * of one, and the cards above the page.
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
import { SummaryCards } from "../SummaryCards";
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

describe("SummaryCards", () => {
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
    const out = render(<SummaryCards stats={stats()} />);
    expect(out).toContain("90%");
    expect(out).toContain("9 of 10 passed in September 2026");
  });

  it("splits the passers between first time and retake", () => {
    const out = render(<SummaryCards stats={stats()} />);
    expect(out).toContain("8 passed first time");
    expect(out).toContain("1 after a retake");
  });

  it("says nobody passed rather than dressing a zero up as a result", () => {
    const out = render(
      <SummaryCards
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
  });

  it("flags the results that have not landed yet", () => {
    const out = render(<SummaryCards stats={stats({ pending: 3 })} />);
    expect(out).toContain("3 still waiting for a result");
  });

  it("puts the HEADCOUNT under the word Students, not the exams-expected total", () => {
    // `roster` is summed once per (classroom, paper) pair, so a class of 20 sitting two
    // papers contributes 40. Under a card labelled "Students" that is simply a wrong number,
    // and it used to be the big one — with the real headcount as 12px detail beneath it.
    const out = render(
      <SummaryCards stats={stats({ roster: 117, distinct_students: 99, classrooms: 6, midterms: 7 })} />,
    );
    const card = [...(container?.querySelectorAll("div.rounded-2xl") ?? [])].find((d) =>
      d.textContent?.startsWith("Students"),
    );
    expect(card?.textContent).toContain("99");
    expect(card?.textContent).toContain("6 classes · 7 exams");
    expect(out).not.toContain("Students117");
  });

  it("explains the bigger denominator in plain words, and only when it differs", () => {
    const out = render(
      <SummaryCards stats={stats({ roster: 117, distinct_students: 99, classrooms: 6, midterms: 7 })} />,
    );
    expect(out).toContain("117 and not 99, because 18 students sat more than one exam");
    const same = render(<SummaryCards stats={stats({ roster: 10, distinct_students: 10 })} />);
    expect(same).not.toContain("Rates are over");
  });

  it("brings the four cards in one after another, not all at once", () => {
    render(<SummaryCards stats={stats()} />);
    const cards = [...(container?.querySelectorAll("div.rounded-2xl.cr-card") ?? [])];
    expect(cards).toHaveLength(4);
    const delays = cards.map((c) => Number((c as HTMLElement).style.animationDelay.replace("ms", "")));
    // Strictly increasing left to right.
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(4);
  });

  it("never prints a rate for a month nobody has sat", () => {
    const out = render(<SummaryCards stats={{ ...stats(), is_future: true }} />);
    expect(out).toContain("Nobody has sat");
    expect(out).not.toContain("90%");
  });

  it("names what happened to everyone who did not pass", () => {
    const out = render(<SummaryCards stats={stats({ failed: 3, absent: 2, passed: 5, pass_rate: 50 })} />);
    expect(out).toContain("3 failed the exam · 2 did not come");
  });
});
