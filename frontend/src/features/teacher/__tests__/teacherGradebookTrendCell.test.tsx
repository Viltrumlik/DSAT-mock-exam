import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Cell, GradebookModel, StudentRow } from "../useGradebook";

/**
 * The Trend cell of the teacher portal's gradebook (`/teacher/gradebook`): how far a student's grade moved from the
 * oldest homework they were graded on to the newest, drawn as an arrow and a number of points.
 *
 * A grade has two decimals (`SubmissionReview.grade`), and auto-graded assessment homework records the attempt's
 * percent there, so 76.67 and 83.33 are ordinary grades. The cell printed the move as JavaScript subtracts it, and
 * there 83.33 − 76.67 is 6.659999999999997: that is what the teacher read.
 */

vi.mock("@/lib/api", () => ({ classesApi: {} }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: "AUTHENTICATED" }) }));

const { TeacherGradebook } = await import("../TeacherGradebook");

const HOMEWORK = [
  { id: 101, title: "Homework 1" },
  { id: 102, title: "Homework 2" },
];

let nextId = 1;

/**
 * A student graded on both homework, as the gradebook's model carries them, and named by that move: each grade read
 * from the review's two-decimal string with `Number`, the average in whole points, the trend the newer minus the older.
 */
function student(older: string, newer: string): StudentRow {
  const grades = [Number(older), Number(newer)];
  return {
    id: nextId++,
    name: `${older} → ${newer}`,
    cells: grades.map((grade, i): Cell => ({ assignmentId: HOMEWORK[i].id, status: "graded", grade })),
    average: Math.round((grades[0] + grades[1]) / 2),
    trendDelta: grades[1] - grades[0],
    missing: 0,
  };
}

let host: HTMLDivElement;
let root: Root;

async function render(...students: StudentRow[]) {
  const model: GradebookModel = {
    assignments: HOMEWORK,
    students,
    // The figures and the spread of the class's averages above the matrix are not read here. Left empty,
    // the spread draws "No graded work yet" in place of its bars.
    classAverage: null,
    distribution: [],
    missingCount: 0,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<TeacherGradebook preview={{ classes: [{ id: 1, name: "Algebra 2" }], model }} />));
}

/** The student's cell under the column with this header. */
function cell(name: string, column: string): Element {
  const columns = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
  const row = [...host.querySelectorAll("tbody tr")].find((tr) => tr.querySelector(".truncate")?.textContent === name);
  if (!row || !columns.includes(column)) throw new Error(`no ${column} cell for ${name}`);
  return row.children[columns.indexOf(column)];
}

/** Every student's Trend cell as the teacher reads it: the points it prints, its arrow, and its colour. */
function trends() {
  const names = [...host.querySelectorAll("tbody tr .truncate")].map((span) => span.textContent ?? "");
  return Object.fromEntries(
    names.map((name) => {
      const trend = cell(name, "Trend");
      const arrow = trend.querySelector(".lucide-arrow-up-right") ? "up" : trend.querySelector(".lucide-arrow-down-right") ? "down" : null;
      // The cell's colour is one of the teacher kit's tone tokens, set inline: `--dz-success` for a rise,
      // `--dz-amber` — the kit's warning ink — for a fall. It was a pair of utility classes before the page
      // moved to the kit; what is asserted below has not changed.
      const colour = (trend.firstElementChild as HTMLElement | null)?.style.color ?? "";
      const tone = colour.includes("dz-success") ? "success" : colour.includes("dz-amber") ? "warning" : null;
      return [name, { points: trend.textContent, arrow, tone }];
    }),
  );
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("TeacherGradebook — the Trend cell", () => {
  it("prints a move between two-decimal grades in whole points, as the Avg column beside it does", async () => {
    await render(student("76.67", "83.33"), student("83.33", "76.67"));

    expect(trends()).toEqual({
      "76.67 → 83.33": { points: "7", arrow: "up", tone: "success" },
      "83.33 → 76.67": { points: "7", arrow: "down", tone: "warning" },
    });
    expect(cell("76.67 → 83.33", "Avg").textContent).toBe("80%");
  });

  it("prints a fall as many points as the same rise, when the move ends in a half", async () => {
    // Math.round takes a half towards +∞: 2.5 is 3, but −2.5 is −2.
    await render(student("80.00", "82.50"), student("82.50", "80.00"));

    expect(trends()).toEqual({
      "80.00 → 82.50": { points: "3", arrow: "up", tone: "success" },
      "82.50 → 80.00": { points: "3", arrow: "down", tone: "warning" },
    });
  });

  it("prints the same move as the same points, whichever two grades it ran between", async () => {
    // All three moved 3.50 points. In JavaScript 83.50 − 80.00 is 3.5, but 64.52 − 61.02 is 3.499999999999993,
    // which rounds to 3.
    await render(student("80.00", "83.50"), student("61.02", "64.52"), student("64.52", "61.02"));

    expect(trends()).toEqual({
      "80.00 → 83.50": { points: "4", arrow: "up", tone: "success" },
      "61.02 → 64.52": { points: "4", arrow: "up", tone: "success" },
      "64.52 → 61.02": { points: "4", arrow: "down", tone: "warning" },
    });
  });

  it("reads a move that prints as 0 as no change, like an unchanged grade, and half a point as a fall", async () => {
    await render(student("83.33", "83.33"), student("83.33", "83.00"), student("83.33", "82.83"));

    expect(trends()).toEqual({
      "83.33 → 83.33": { points: "0", arrow: "up", tone: "success" },
      "83.33 → 83.00": { points: "0", arrow: "up", tone: "success" },
      "83.33 → 82.83": { points: "1", arrow: "down", tone: "warning" },
    });
  });

  it("shows no trend for a student graded only once", async () => {
    await render({
      ...student("70.00", "70.00"),
      name: "Graded once",
      cells: [
        { assignmentId: 101, status: "graded", grade: 70 },
        { assignmentId: 102, status: "submitted", grade: null },
      ],
      trendDelta: null,
    });

    expect(trends()).toEqual({ "Graded once": { points: "—", arrow: null, tone: null } });
  });
});
