/**
 * The names behind one number, and the caveat that keeps two surfaces from disagreeing in
 * silence.
 *
 * This table resolves `retake_for()` — the FIRST retake of a paper — while the monthly
 * statistics count a pass on ANY of them. On a paper with two retakes that is "1 passed, 2
 * failed" here and "2 passed" one tab away, for the same paper on the same page. Both numbers
 * are defensible; neither was explained.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MidtermReport } from "../types";

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
  retake: {
    id: 8,
    title: "Midterm 12 Retake",
    subject: "MATH",
    subject_label: "Math",
    midterm_type: "RETAKE",
    pass_mark: 500,
    score_ceiling: 800,
    scoring_scale: "SCALE_800",
  },
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
  it("states the fact when the caller knows the paper has more than one retake", async () => {
    midtermCall.mockResolvedValue(report());
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} retakeCount={2} />);
    expect(out).toContain("This paper has 2 retakes");
    expect(out).toContain("counts a student who passed any of them");
  });

  it("says nothing extra when the caller knows there is exactly one retake", async () => {
    midtermCall.mockResolvedValue(report());
    const out = await render(<MidtermEvidence classroomId={11} midtermId={7} retakeCount={1} />);
    expect(out).not.toContain("retakes");
    expect(out).not.toContain("first retake");
    expect(out).toContain("results table");
  });

  it("warns from what it CAN see when the caller cannot count the retakes", async () => {
    // The Records tab's endpoint sends `retake_for(m)` alone, so `retakeCount` is null there.
    // Silence would let the two tabs' counts differ with nothing on screen to say why.
    midtermCall.mockResolvedValue(report());
    const out = await render(
      <MidtermEvidence classroomId={11} midtermId={7} retakeCount={null} />,
    );
    expect(out).toContain("first retake");
    expect(out).toContain("Statistics tab counts a student who passed any of them");
  });

  it("says nothing about retakes on a paper that has none", async () => {
    midtermCall.mockResolvedValue(report({ retake: null }));
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
