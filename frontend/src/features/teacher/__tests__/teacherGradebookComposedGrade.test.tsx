/**
 * The number in a gradebook cell, on homework whose teacher's mark carries a share of the grade.
 *
 * `/teacher/gradebook` reads the same `/submissions/` response that carries `composed_grade` and
 * took `review.grade` off it — the teacher's mark, not the grade. On a 20%-share homework
 * composing 70, the cell printed 50 and banded it amber: "needs attention", for a passing grade.
 * The wrong number did not stop at the cell either. The student's average, their trend, the
 * class average and the 0–49 / 50–69 / 70–84 / 85–100 spread are all taken over these cells.
 *
 * `useGradebook.ts` had not been touched since the share landed — `git diff` over it against the
 * merge base was empty. The model was simply never revisited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Cell, GradebookModel } from "../useGradebook";

vi.mock("@/lib/api", () => ({ classesApi: {} }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { cellGrade } = await import("../useGradebook");
const { TeacherGradebook } = await import("../TeacherGradebook");

/** `ComposedGrade.as_payload()` — 20% by hand, 80% automatic, unless a test says otherwise. */
function composed(over: Record<string, unknown> = {}) {
  return {
    state: "final",
    percent: 70,
    is_final: true,
    automatic_percent: 75,
    manual_percent: 50,
    manual_weight_percent: 20,
    automatic_weight_percent: 80,
    ...over,
  } as never;
}

describe("what one gradebook cell stands for", () => {
  it("takes the composed grade, not the teacher's mark, when the homework composes", () => {
    expect(cellGrade({ review: { grade: "50.00" }, composed_grade: composed() }))
      .toEqual({ grade: 70, composed: "final" });
  });

  it("keeps reading the review's grade on homework with no manual share", () => {
    // Nearly every homework in the school. The key arrives present and null.
    expect(cellGrade({ review: { grade: "88.00" }, composed_grade: null })).toEqual({ grade: 88 });
    // And older responses that do not carry the key at all.
    expect(cellGrade({ review: { grade: "88.00" } })).toEqual({ grade: 88 });
  });

  it("gives no number while the mark is still owed", () => {
    // 20 is the automatic side weighted — a running total. Shown as the grade it bands 0–49 and
    // drags the student's average down for work nobody has finished marking.
    const row = { review: { grade: "25.00" }, composed_grade: composed({ state: "awaiting_manual_mark", percent: 20, is_final: false, manual_percent: null }) };
    expect(cellGrade(row)).toEqual({ grade: null, composed: "awaiting" });
  });

  it("gives no number, and says why, when the composition could not be read", () => {
    const row = { review: { grade: "50.00" }, composed_grade: composed({ state: "unavailable", percent: null, is_final: false, automatic_percent: null, manual_percent: null }) };
    expect(cellGrade(row)).toEqual({ grade: null, composed: "unavailable" });
  });

  it("reads a missing row as no grade at all", () => {
    expect(cellGrade({ review: null })).toEqual({ grade: null });
    expect(cellGrade({ review: { grade: null } })).toEqual({ grade: null });
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** One student, one homework, drawn through the page the teacher actually opens. */
async function render(cell: Cell, average: number | null) {
  const model: GradebookModel = {
    assignments: [{ id: 101, title: "Homework 1" }],
    students: [{ id: 1, name: "Nodira A.", cells: [cell], average, trendDelta: null, missing: 0 }],
    classAverage: average,
    distribution: [],
    missingCount: 0,
  };
  await act(async () => root.render(<TeacherGradebook preview={{ classes: [{ id: 1, name: "Algebra 2" }], model }} />));
}

/** The chip under the "Homework 1" column, as the teacher reads it. */
function chip(): HTMLElement {
  const columns = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
  const row = host.querySelector("tbody tr");
  const at = columns.indexOf("Homework 1");
  const found = row?.children[at]?.firstElementChild as HTMLElement | null;
  if (!found) throw new Error("no cell chip");
  return found;
}

describe("the cell a teacher reads", () => {
  it("prints the composed grade, not the mark it was built from", async () => {
    await render({ assignmentId: 101, status: "graded", grade: 70, composed: "final" }, 70);
    expect(chip().textContent).toBe("70");
  });

  it("says the mark is still owed rather than printing a part-composed number", async () => {
    await render({ assignmentId: 101, status: "submitted", grade: null, composed: "awaiting" }, null);
    expect(chip().textContent).toBe("•");
    expect(chip().getAttribute("title")).toContain("Waiting on your mark");
  });

  it("marks a grade that could not be worked out, instead of leaving an empty-looking cell", async () => {
    await render({ assignmentId: 101, status: "graded", grade: null, composed: "unavailable" }, null);
    // Not a number, and not the same quiet dot as "nobody has marked this yet": a failed
    // composition is a thing to look at, never a blank.
    expect(chip().textContent).toBe("?");
    expect(chip().getAttribute("title")).toContain("could not be worked out");
  });

  it("leaves an ordinary graded cell alone", async () => {
    await render({ assignmentId: 101, status: "graded", grade: 88 }, 88);
    expect(chip().textContent).toBe("88");
    expect(chip().getAttribute("title")).toBeNull();
  });
});
