/**
 * The Class records tab end to end, in the console's look: the classroom list and its search, picking a
 * classroom, Refresh, a list that failed and Try again, a midterm card's collapsed tally, opening it onto
 * the per-student evidence, Export PDF (busy as "Preparing…", its failure in words), a failed evidence
 * fetch and Try again, and the "Only students who failed" filter switched on and off. Only the API is mocked.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomDetail, ClassroomListRow, ClassroomMidtermRow, MidtermReport, ReportRow } from "../types";

const classrooms = vi.fn();
const classroom = vi.fn();
const midterm = vi.fn();
const downloadPdf = vi.fn();

vi.mock("../api", () => ({
  midtermReportsApi: {
    classrooms: (...a: unknown[]) => classrooms(...a),
    classroom: (...a: unknown[]) => classroom(...a),
    midterm: (...a: unknown[]) => midterm(...a),
    downloadPdf: (...a: unknown[]) => downloadPdf(...a),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

import MidtermRecordsBrowser from "../MidtermReportsPage";

const listRow = (over: Partial<ClassroomListRow> = {}): ClassroomListRow => ({
  id: 11,
  name: "Chilonzor 9-B",
  subject: "MATH",
  level: "intermediate",
  teacher_name: "Nodira Yusupova",
  student_count: 18,
  midterm_count: 2,
  ...over,
});

const paper = (over: Partial<ClassroomMidtermRow> = {}): ClassroomMidtermRow => ({
  id: 7,
  title: "Midterm 12",
  subject: "MATH",
  subject_label: "Math",
  midterm_type: "MIDTERM",
  pass_mark: 500,
  score_ceiling: 800,
  scoring_scale: "SCALE_800",
  scheduled_at: null,
  counts: { passed: 12, failed: 4, absent: 2, pending: 0 },
  retake: null,
  retakes: [],
  ...over,
});

const detail = (id: number, name: string, midterms: ClassroomMidtermRow[]): ClassroomDetail => ({
  classroom: { id, name, subject: "MATH", level: "intermediate", teacher_name: "Nodira Yusupova" },
  midterms,
});

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  student_id: 1,
  student_name: "Aziz X",
  midterm_score: 640,
  midterm_state: "COMPLETED",
  midterm_passed: true,
  retake_score: null,
  retake_state: null,
  retake_passed: null,
  retake_eligible: false,
  final_status: "PASSED",
  ...over,
});

const report = (over: Partial<MidtermReport> = {}): MidtermReport => ({
  classroom: { id: 11, name: "Chilonzor 9-B", subject: "MATH", level: "intermediate", teacher_name: "Nodira Yusupova" },
  midterm: {
    id: 7,
    title: "Midterm 12",
    subject: "MATH",
    subject_label: "Math",
    midterm_type: "MIDTERM",
    pass_mark: 500,
    score_ceiling: 800,
    scoring_scale: "SCALE_800",
  },
  retake: null,
  retakes: [],
  summary: { passed: 1, failed: 1, absent: 0, pending: 0, students: 2, pass_mark: 500, average_score: 420 },
  rows: [
    row(),
    row({ student_id: 2, student_name: "Dilnoza X", midterm_score: 200, midterm_passed: false, final_status: "FAILED" }),
  ],
  ...over,
});

let root: Root;
let host: HTMLElement;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<MidtermRecordsBrowser />);
  });
  await settle();
}
async function click(el: Element | null | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
const text = () => host.textContent ?? "";
const button = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) ?? null;
const listButton = (name: string) => [...host.querySelectorAll('nav[aria-label="Classrooms"] button')].find((b) => b.textContent?.includes(name)) ?? null;
const card = () => host.querySelector("button[aria-expanded]") as HTMLElement | null;

beforeEach(() => {
  for (const f of [classrooms, classroom, midterm, downloadPdf]) f.mockReset();
  classrooms.mockResolvedValue([listRow(), listRow({ id: 12, name: "Yunusobod 10-A", student_count: 1, midterm_count: 1 })]);
  classroom.mockImplementation(async (id: number) =>
    id === 11 ? detail(11, "Chilonzor 9-B", [paper()]) : detail(12, "Yunusobod 10-A", [paper({ id: 9, title: "Pre-midterm 3", midterm_type: "PRE_MIDTERM", counts: { passed: 0, failed: 0, absent: 0, pending: 0 } })]),
  );
  midterm.mockResolvedValue(report());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Class records — the list", () => {
  it("opens on the first classroom and switches to the one picked", async () => {
    await render();
    expect(classroom).toHaveBeenLastCalledWith(11);
    expect(listButton("Chilonzor 9-B")?.getAttribute("aria-current")).toBe("true");
    expect(text()).toContain("Nodira Yusupova · 18 students · 2 midterms");
    expect(text()).toContain("Yunusobod 10-A");
    expect(text()).toContain("Nodira Yusupova · 1 student · 1 midterm");

    await click(listButton("Yunusobod 10-A"));
    expect(classroom).toHaveBeenLastCalledWith(12);
    expect(listButton("Yunusobod 10-A")?.getAttribute("aria-current")).toBe("true");
    expect(listButton("Chilonzor 9-B")?.getAttribute("aria-current")).toBeNull();
    expect(text()).toContain("Pre-midterm 3");
  });

  it("filters the list as the search is typed", async () => {
    await render();
    const search = host.querySelector('input[aria-label="Search classrooms"]') as HTMLInputElement;
    expect(search.placeholder).toBe("Search classrooms");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "yunus");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listButton("Yunusobod 10-A")).not.toBeNull();
    expect(listButton("Chilonzor 9-B")).toBeNull();
  });

  it("Refresh asks again for the list and the open classroom", async () => {
    await render();
    const [lists, details] = [classrooms.mock.calls.length, classroom.mock.calls.length];
    await click(button("Refresh"));
    expect(classrooms.mock.calls.length).toBe(lists + 1);
    expect(classroom.mock.calls.length).toBe(details + 1);
    expect(classroom).toHaveBeenLastCalledWith(11);
  });

  it("a failed list says so, never 'no midterm activity', and Try again recovers", async () => {
    classrooms.mockRejectedValueOnce(new Error("boom"));
    await render();
    expect(text()).toContain("Could not load classrooms (administrators only).");
    expect(text()).toContain("Nothing below is empty — it is unknown.");
    expect(text()).toContain("Classroom list unavailable");
    expect(text()).toContain("Nothing could be listed");
    expect(text()).not.toContain("No midterm activity");
    expect(text()).not.toContain("Pick a classroom");

    await click(button("Try again"));
    expect(text()).not.toContain("Classroom list unavailable");
    expect(listButton("Chilonzor 9-B")).not.toBeNull();
  });

  it("says a classroom has no midterms when that is so", async () => {
    classroom.mockResolvedValue(detail(11, "Chilonzor 9-B", []));
    await render();
    expect(text()).toContain("No midterms in this classroom");
    expect(text()).toContain("Nothing has been scheduled or assigned to Chilonzor 9-B yet.");
  });
});

describe("Class records — a midterm", () => {
  it("shows the tally collapsed, then the students on request", async () => {
    await render();
    expect(text()).toContain("Midterm 12");
    expect(text()).toContain("Math · ");
    for (const chip of ["12passed", "4failed", "2absent"]) expect(text()).toContain(chip);
    expect(text()).not.toContain("awaiting a result");
    expect(midterm).not.toHaveBeenCalled();

    await click(card());
    expect(card()?.getAttribute("aria-expanded")).toBe("true");
    expect(midterm).toHaveBeenCalledWith(11, 7);
    expect(text()).toContain("Every student on the roster, as the record stood when they were scored.");
    expect(text()).toContain("Aziz X");
    expect(text()).toContain("Dilnoza X");
    expect(text()).toContain("2 students on the roster");

    await click(card());
    expect(card()?.getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain("Aziz X");
  });

  it("shows an ungraded paper as Not graded, with how many were scored", async () => {
    // Ungraded means no pass mark: a pre-midterm is scored, never passed or failed.
    classroom.mockResolvedValue(
      detail(11, "Chilonzor 9-B", [paper({ midterm_type: "PRE_MIDTERM", pass_mark: null, counts: { passed: 0, failed: 0, absent: 3, pending: 1 } })]),
    );
    await render();
    expect(text()).toContain("Pre-midterm");
    expect(text()).toContain("Not graded");
    // 18 on the roster − 3 absent − 1 waiting.
    expect(text()).toContain("14scored");
    expect(text()).toContain("1awaiting a result");
    expect(text()).not.toContain("0passed");
  });

  it("exports the paper as a PDF, says Preparing… meanwhile, and names a failure", async () => {
    let finish: (v?: unknown) => void = () => {};
    downloadPdf.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await render();
    await click(card());

    await click(button("Export PDF"));
    expect(downloadPdf).toHaveBeenCalledWith(11, 7);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Preparing…"))).toBe(true);
    await act(async () => finish());
    await settle();
    expect(button("Export PDF")).not.toBeNull();

    downloadPdf.mockRejectedValueOnce(new Error("boom"));
    await click(button("Export PDF"));
    const alert = [...host.querySelectorAll('[role="alert"]')].find((a) => a.textContent?.includes("Could not generate the PDF."));
    expect(alert).toBeTruthy();
  });

  it("a failed student list says so, and Try again loads it", async () => {
    midterm.mockRejectedValueOnce(new Error("boom"));
    await render();
    await click(card());
    expect(text()).toContain("Could not load the per-student results for this paper.");
    expect(text()).not.toContain("No students on this roster");

    await click(button("Try again"));
    expect(text()).toContain("Aziz X");
  });

  it("filters to the students who failed and back", async () => {
    await render();
    await click(card());
    const toggle = [...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent?.includes("Only students who failed")) as HTMLElement;
    expect(toggle.textContent).toContain("Only students who failed (1)");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("Showing 1 of 2 students in this table.");
    expect(text()).not.toContain("Aziz X");

    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(text()).toContain("Aziz X");
    expect(text()).not.toContain("Showing 1 of 2");
  });
});
