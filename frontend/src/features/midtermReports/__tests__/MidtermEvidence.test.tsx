/**
 * The names behind one number, and the caveat that stops a score being read under the wrong
 * paper's heading.
 *
 * The rows resolve across EVERY retake of a paper, but the table has one retake column and it
 * is headed by the oldest — title and score ceiling. On a paper with two second chances a cell
 * can therefore hold a score from a paper the column is not named after. The endpoint now
 * sends `retakes[]`, so this component counts them itself and states that exactly, instead of
 * the hedge it used when the Records tab could not tell it how many there were.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MidtermBrief, MidtermReport } from "../types";

const midtermCall = vi.fn();

vi.mock("../api", () => ({
  midtermReportsApi: {
    midterm: (...args: unknown[]) => midtermCall(...args),
    classrooms: vi.fn(),
    classroom: vi.fn(),
    downloadPdf: vi.fn(),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

vi.mock("../MidtermResultsTable", () => ({
  MidtermResultsTable: () => <div>results table</div>,
}));

import { MidtermEvidence } from "../MidtermEvidence";

const retake = (over: Partial<MidtermBrief> = {}): MidtermBrief => ({
  id: 8,
  title: "Midterm 12 Retake",
  subject: "MATH",
  subject_label: "Math",
  midterm_type: "RETAKE",
  pass_mark: 500,
  score_ceiling: 800,
  scoring_scale: "SCALE_800",
  ...over,
});

const report = (over: Partial<MidtermReport> = {}): MidtermReport => ({
  classroom: {
    id: 11,
    name: "Chilonzor 9-B",
    subject: "MATH",
    level: "intermediate",
    teacher_name: "Nodira Yusupova",
  },
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
  retake: retake(),
  retakes: [retake()],
  summary: { passed: 1, failed: 2, absent: 0, pending: 0, students: 3, pass_mark: 500, average_score: 460 },
  rows: [],
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: React.ReactElement): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  midtermCall.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MidtermEvidence", () => {
  it("counts the retakes from its OWN payload, and names the paper the column is headed by", async () => {
    const second = retake({ id: 9, title: "Midterm 12 Retake B" });
    midtermCall.mockResolvedValue(report({ retakes: [retake(), second] }));
    // The caller cannot count them; the response can, and that is now the authority.
    const out = await render(
      <MidtermEvidence classroomId={11} midtermId={7} retakeCount={null} />,
    );
    expect(out).toContain("This paper has 2 retakes");
    expect(out).toContain("headed below by Midterm 12 Retake");
    expect(out).toContain("counts a pass on any of them");
    // The hedge is gone: nothing on screen says the count is unknown.
    expect(out).not.toContain("if this one has a second retake");
  });

  it("says nothing extra when there is exactly one retake", async () => {
    midtermCall.mockResolvedValue(report());
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} retakeCount={1} />);
    expect(out).not.toContain("retakes");
    expect(out).not.toContain("first retake");
    expect(out).toContain("results table");
  });

  it("warns when two retakes are scored out of different totals", async () => {
    // One column, one "out of N" in its header, and a cell that may come from either paper.
    midtermCall.mockResolvedValue(
      report({ retakes: [retake(), retake({ id: 9, title: "Retake B", score_ceiling: 100 })] }),
    );
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} />);
    expect(out).toContain("not all scored out of the same total");
    expect(out).toContain("against its own pass mark");
  });

  it("falls back to the caller's count only when the payload carries no list", async () => {
    // An older server. "I cannot count them" must not collapse into "there is one".
    const legacy: Record<string, unknown> = { ...report() };
    delete legacy.retakes;
    midtermCall.mockResolvedValue(legacy);
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} retakeCount={3} />);
    expect(out).toContain("This paper has 3 retakes");
  });

  it("says nothing about retakes on a paper that has none", async () => {
    midtermCall.mockResolvedValue(report({ retake: null, retakes: [] }));
    const out = await render(
      <MidtermEvidence classroomId={11} midtermId={7} retakeCount={null} />,
    );
    expect(out).not.toContain("retake");
    expect(out).toContain("results table");
  });

  it("renders a failed fetch as a failure, never as an empty roster", async () => {
    midtermCall.mockRejectedValue(new Error("boom"));
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} />);
    expect(out).toContain("Could not load the per-student results for this paper");
    expect(out).not.toContain("results table");
  });
});
