/**
 * The pastpaper report screen.
 *
 * Two things here are recreations of the midterm report's rules and must not drift:
 * untagged questions are DISCLOSED rather than folded into a skill row (otherwise the skill
 * totals look like they should add up to the mistake count and do not), and the certificate
 * and the error report are TWO downloads because they are two documents.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttemptErrorReport } from "../pastpaperReportApi";

const useAttemptReport = vi.fn();

vi.mock("../pastpaperReportHooks", () => ({
  useAttemptReport: (...a: unknown[]) => useAttemptReport(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { PastpaperReportPage } = await import("../PastpaperReportPage");

const REPORT: AttemptErrorReport = {
  attempt_id: 7,
  score: 640,
  paper_title: "SAT March 2024",
  certificate_code: "abc123",
  total_count: 44,
  correct_count: 33,
  wrong: 11,
  accuracy: 75,
  unclassified_total: 13,
  unclassified_wrong: 0,
  skills: [
    {
      skill_id: 1, skill: "Linear Functions", domain: "Algebra",
      wrong: 5, total: 12, accuracy: 58.3, question_numbers: [3, 7, 12, 19, 24],
    },
  ],
  questions: [
    {
      number: 3, module: 1, skill: "Linear Functions", domain: "Algebra",
      your_answer: "C", correct_answer: "A",
    },
  ],
  headline: "Start with Linear Functions — 5 of your 11 mistakes are there.",
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined, isPending: false, isError: false,
    refetch: vi.fn(), ...overrides,
  };
}

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<PastpaperReportPage attemptId={7} />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("PastpaperReportPage", () => {
  it("leads with the skill to start on", async () => {
    useAttemptReport.mockReturnValue(query({ data: REPORT }));
    await render();

    expect(host.textContent).toContain("Start with Linear Functions");
    expect(host.textContent).toContain("WHAT TO WORK ON");   // the section label, as rendered
  });

  it("shows both answers for a mistake", async () => {
    useAttemptReport.mockReturnValue(query({ data: REPORT }));
    await render();

    expect(host.textContent).toContain("You put");
    expect(host.textContent).toContain("C");
    expect(host.textContent).toContain("A");
  });

  it("offers the certificate and the report as two separate downloads", async () => {
    useAttemptReport.mockReturnValue(query({ data: REPORT }));
    await render();

    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((b) => b?.includes("Certificate"))).toBe(true);
    expect(buttons.some((b) => b?.includes("Error report PDF"))).toBe(true);
  });

  it("offers no certificate when the attempt never earned one", async () => {
    useAttemptReport.mockReturnValue(query({
      data: { ...REPORT, certificate_code: null },
    }));
    await render();

    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((b) => b?.includes("Certificate"))).toBe(false);
  });

  it("discloses untagged mistakes rather than hiding them", async () => {
    useAttemptReport.mockReturnValue(query({
      data: { ...REPORT, unclassified_wrong: 2 },
    }));
    await render();

    expect(host.textContent).toContain("2 of your mistakes are on questions that");
  });

  it("says nothing about untagged questions when none were wrong", async () => {
    useAttemptReport.mockReturnValue(query({ data: REPORT }));
    await render();

    expect(host.textContent).not.toContain("aren't tagged with a skill yet");
  });

  it("shows a failure as an error, never as a clean paper", async () => {
    useAttemptReport.mockReturnValue(query({ isError: true }));
    await render();

    expect(host.textContent).toContain("didn't load");
    expect(host.textContent).not.toContain("Nothing to review");
  });

  it("congratulates a perfect paper instead of listing nothing", async () => {
    useAttemptReport.mockReturnValue(query({
      data: { ...REPORT, wrong: 0, correct_count: 44, accuracy: 100, skills: [], questions: [] },
    }));
    await render();

    expect(host.textContent).toContain("Nothing to review");
    expect(host.textContent).toContain("Every question correct");
  });

  it("offers no report download when there is nothing to review", async () => {
    useAttemptReport.mockReturnValue(query({
      data: { ...REPORT, wrong: 0, skills: [], questions: [] },
    }));
    await render();

    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((b) => b?.includes("Error report PDF"))).toBe(false);
  });
});
