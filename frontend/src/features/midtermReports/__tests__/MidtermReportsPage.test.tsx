/**
 * The one thing this browser must never do: report a failed request as a fact about the
 * school.
 *
 * `GET /midterms/admin/reports/classrooms/` failing used to set `classrooms` to `[]`, and the
 * sidebar's only non-loading branch reads its emptiness straight off that array — so a 500
 * printed "No midterm activity / Classrooms appear here once a midterm is assigned or
 * scheduled for them" under the red banner, and the right-hand panel invited the admin to
 * pick from a list that did not exist. An admin who scrolls past a banner is left with the
 * app asserting this school has never given a midterm.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomDetail, ClassroomListRow, ClassroomMidtermRow } from "../types";

const classroomsCall = vi.fn();
const classroomCall = vi.fn();

vi.mock("../api", () => ({
  midtermReportsApi: {
    classrooms: (...args: unknown[]) => classroomsCall(...args),
    classroom: (...args: unknown[]) => classroomCall(...args),
    midterm: vi.fn(),
    downloadPdf: vi.fn(),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

vi.mock("../MidtermEvidence", () => ({
  MidtermEvidence: () => <div>student evidence</div>,
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
  retake: { id: 8, title: "Midterm 12 Retake" },
  retakes: [{ id: 8, title: "Midterm 12 Retake" }],
  ...over,
});

const detail = (over: Partial<ClassroomDetail> = {}): ClassroomDetail => ({
  classroom: {
    id: 11,
    name: "Chilonzor 9-B",
    subject: "MATH",
    level: "intermediate",
    teacher_name: "Nodira Yusupova",
  },
  midterms: [],
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<MidtermRecordsBrowser />);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  classroomsCall.mockReset();
  classroomCall.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MidtermRecordsBrowser", () => {
  it("lists the classrooms and opens on the first one", async () => {
    classroomsCall.mockResolvedValue([listRow(), listRow({ id: 12, name: "Yunusobod 11-C" })]);
    classroomCall.mockResolvedValue(detail());
    const out = await render();

    expect(out).toContain("Chilonzor 9-B");
    expect(out).toContain("Yunusobod 11-C");
    expect(classroomCall).toHaveBeenCalledWith(11);
    expect(out).not.toContain("No midterm activity");
  });

  it("NEVER reports a failed list as a school with no midterms", async () => {
    classroomsCall.mockRejectedValue(new Error("boom"));
    const out = await render();

    expect(out).toContain("Could not load classrooms");
    expect(out).toContain("Nothing below is empty — it is unknown.");
    expect(out).toContain("Classroom list unavailable");
    expect(out).toContain("This is not an empty school");

    // The exact copy the empty state used to show under the banner.
    expect(out).not.toContain("No midterm activity");
    expect(out).not.toContain("Classrooms appear here once a midterm is assigned");
    // And the right-hand panel does not invite a pick from a list that failed to load.
    expect(out).not.toContain("Select a classroom on the left");
    expect(out).toContain("Nothing could be listed");
    // Nothing was selected, so no detail request should have gone out either.
    expect(classroomCall).not.toHaveBeenCalled();
  });

  it("still reports a genuinely empty school as empty", async () => {
    classroomsCall.mockResolvedValue([]);
    const out = await render();

    expect(out).toContain("No midterm activity");
    expect(out).toContain("Classrooms appear here once a midterm is assigned");
    expect(out).not.toContain("Could not load classrooms");
    expect(out).not.toContain("Classroom list unavailable");
  });

  it("distinguishes a search with no match from a school with no midterms", async () => {
    classroomsCall.mockResolvedValue([listRow()]);
    classroomCall.mockResolvedValue(detail());
    await render();

    const search = container?.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(search, "zzzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container?.textContent).toContain("No match");
    expect(container?.textContent).not.toContain("No midterm activity");
  });

  it("says how many retake papers a midterm has, now that the list endpoint counts them", async () => {
    // "has a retake" was equally true of a paper with three, and the number changes how the
    // table underneath has to be read.
    classroomsCall.mockResolvedValue([listRow()]);
    classroomCall.mockResolvedValue(
      detail({
        midterms: [
          paper({
            retakes: [
              { id: 8, title: "Midterm 12 Retake" },
              { id: 9, title: "Midterm 12 Retake B" },
            ],
          }),
          paper({ id: 10, title: "Midterm 13", retake: null, retakes: [] }),
        ],
      }),
    );
    const out = await render();

    expect(out).toContain("2 retake papers");
    expect(out).not.toContain("has a retake");
  });

  it("renders a failed DETAIL request as a failure, not as a classroom with no papers", async () => {
    classroomsCall.mockResolvedValue([listRow()]);
    classroomCall.mockRejectedValue(new Error("boom"));
    const out = await render();

    expect(out).toContain("Could not load this classroom's midterms");
    expect(out).not.toContain("No midterms in this classroom");
  });
});
