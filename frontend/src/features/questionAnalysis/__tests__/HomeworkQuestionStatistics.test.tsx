/**
 * The statistics section inside one homework, judged on the four states it has to keep apart.
 *
 * The one that carries real risk is **locked**. A homework whose deadline has not passed must
 * not put a question prompt, an answer key or an error rate on a teacher's screen — that
 * screen gets projected and screenshotted, and the students in front of it can still hand the
 * work in. So the locked test does not check for a nice message; it checks that none of the
 * payload's content is anywhere in the DOM.
 *
 * The other three are the house rule this codebase has been bitten by: a failed fetch must
 * never render as "nothing to go over", because that tells a teacher their class got
 * everything right.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssessmentAssignmentAnalysis,
  AssessmentItemRow,
  HomeworkBlock,
  PastpaperAssignmentAnalysis,
  PastpaperItemAnalysis,
  PastpaperItemRow,
} from "../types";

const assessmentsForAssignment = vi.fn();
const pastpapersForAssignment = vi.fn();

vi.mock("../api", () => ({
  questionAnalysisApi: {
    assessmentsForAssignment: (...a: unknown[]) => assessmentsForAssignment(...a),
    pastpapersForAssignment: (...a: unknown[]) => pastpapersForAssignment(...a),
    assessments: vi.fn(),
    pastpaper: vi.fn(),
    classrooms: vi.fn(),
    pastPapers: vi.fn(),
  },
  questionAnalysisKeys: {
    all: ["question-analysis"],
    assignmentAssessments: (id: number, t: number) => ["hw", "a", id, t],
    assignmentPastpapers: (id: number, t: number) => ["hw", "p", id, t],
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { HomeworkQuestionStatistics } = await import("../HomeworkQuestionStatistics");

// ── fixtures ─────────────────────────────────────────────────────────────────

const OPEN_PROMPT = "Which choice completes the text with the most logical word?";
const PAPER_STEM = "The graph shows the mass of a sample over time.";

function homework(over: Partial<HomeworkBlock> = {}): HomeworkBlock {
  return {
    id: 12,
    title: "Week 4 — Algebra",
    due_at: "2026-09-05T18:00:00Z",
    state: "closed",
    locked: false,
    ...over,
  };
}

const SET = { id: 7, title: "Week 4 set", subject: "MATH" };

function assessmentRow(over: Partial<AssessmentItemRow> = {}): AssessmentItemRow {
  return {
    question_id: 401,
    order: 0,
    position: 4,
    prompt: OPEN_PROMPT,
    prompt_truncated: false,
    question_type: "MCQ",
    question_type_label: "Multiple choice",
    set: SET,
    students_answered: 22,
    students_graded: 22,
    students_correct: 5,
    students_wrong: 17,
    ungraded: 0,
    error_rate: 77,
    needs_analysis: true,
    skill: "Words in Context",
    domain: "Craft and Structure",
    ...over,
  };
}

function assessmentPayload(
  over: Partial<HomeworkBlock> = {},
): AssessmentAssignmentAnalysis {
  const rows = [assessmentRow()];
  return {
    homework: homework(over),
    classroom: {
      id: 3,
      name: "Group A",
      subject: "MATH",
      subject_label: "Math",
      level: null,
      level_label: null,
    },
    threshold: 25,
    denominator: "graded",
    counting_rule: "their first attempt at each question",
    summary: {
      questions_total: 1,
      questions_analysed: 1,
      questions_awaiting_grading: 0,
      questions_flagged: 1,
      students_counted: 22,
      attempts_counted: 22,
      sets: 1,
    },
    taxonomy_coverage: { linked: 0, total: 1, rate: 0, note: "" },
    excluded: { retired_questions: 0 },
    needs_analysis: rows,
    questions: rows,
    by_question_type: [],
    by_skill: [],
    by_domain: [],
    sets: [SET],
  } as AssessmentAssignmentAnalysis;
}

function paperRow(over: Partial<PastpaperItemRow> = {}): PastpaperItemRow {
  return {
    question_id: 900,
    number: 12,
    module: 1,
    module_label: "Module 1",
    stem: PAPER_STEM,
    correct_answer: "B",
    question_type: "MATH",
    question_type_label: "Math",
    format: "MCQ",
    format_label: "Multiple choice",
    skill_id: 4,
    skill: "Linear equations",
    domain_id: 2,
    domain: "Algebra",
    difficulty: "HARD",
    difficulty_label: "Hard",
    seen: 24,
    answered: 20,
    omitted: 4,
    correct: 6,
    wrong: 14,
    error_rate: 70,
    miss_rate: 75,
    needs_analysis: true,
    suspect_key: false,
    ...over,
  };
}

function paper(id: number, title: string): PastpaperItemAnalysis {
  const rows = [paperRow({ question_id: id * 10 })];
  return {
    practice_test: {
      id,
      title,
      collection_name: "October 2025",
      subject: "MATH",
      subject_label: "Math",
    },
    classroom: { id: 3, name: "Group A", subject: "MATH", subject_label: "Math" },
    threshold: 25,
    denominator: "answered",
    attempt_selection: "first_clean_completed_sitting_per_student",
    needs_analysis: rows,
    questions: rows,
    totals: {
      questions: 1,
      seen: 24,
      answered: 20,
      omitted: 4,
      correct: 6,
      wrong: 14,
      error_rate: 70,
      analysed: { questions: 1, seen: 24, answered: 20, wrong: 14 },
      needs_analysis: 1,
      suspect_key: 0,
    },
    groups: {
      question_type: { coverage: { tagged: 1, total: 1 }, groups: [] },
      format: { coverage: { tagged: 1, total: 1 }, groups: [] },
      skill: { coverage: { tagged: 1, total: 1 }, groups: [] },
      domain: { coverage: { tagged: 1, total: 1 }, groups: [] },
      difficulty: { coverage: { tagged: 1, total: 1 }, groups: [] },
    },
    unclassified_total: 0,
    unclassified_wrong: 0,
    data_quality: {
      roster: 26,
      attempts_considered: 24,
      attempts_counted: 24,
      students_counted: 24,
      excluded: { copied: 0, repeat_sitting: 0 },
      suspect_key_questions: 0,
    },
  };
}

function pastpaperPayload(
  papers: PastpaperItemAnalysis[],
  over: Partial<HomeworkBlock> = {},
  truncated: { analysed: number; total: number; note: string | null } | null = null,
): PastpaperAssignmentAnalysis {
  return { homework: homework(over), papers, papers_truncated: truncated };
}

// ── harness ──────────────────────────────────────────────────────────────────

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  assessmentsForAssignment.mockReset();
  pastpapersForAssignment.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(props: {
  hasAssessments?: boolean;
  hasPastPapers?: boolean;
  pastPaperCount?: number | null;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <HomeworkQuestionStatistics
          assignmentId={12}
          hasAssessments={props.hasAssessments ?? false}
          hasPastPapers={props.hasPastPapers ?? false}
          pastPaperCount={props.pastPaperCount ?? null}
        />
      </QueryClientProvider>,
    );
  });
  await flush();
}

describe("HomeworkQuestionStatistics — locked", () => {
  it("shows the deadline in words and not one figure from the analysis", async () => {
    // What the server actually sends for a homework that is still open: the block, nothing
    // else. The test asserts the *rendering* refuses to invent anything from it.
    const locked = { homework: homework({ state: "open", locked: true }) };
    assessmentsForAssignment.mockResolvedValue(locked);
    pastpapersForAssignment.mockResolvedValue(locked);
    await mount({ hasAssessments: true, hasPastPapers: true });

    const text = host.textContent ?? "";
    expect(text).toContain("The statistics open when this homework");
    // The deadline as a person reads it — not an ISO string to decode.
    expect(text).toContain("September 5, 2026");
    expect(text).not.toContain("2026-09-05T18:00:00Z");

    // Nothing that could leak the work: no question rows, no rates, no flagged list.
    expect(host.querySelector("[data-flagged-list]")).toBeNull();
    expect(text).not.toContain("77%");
    expect(text).not.toContain("to go over");

    // And it is neither of the two states it must not be mistaken for.
    expect(text).not.toContain("Try again");
    expect(text).not.toContain("Nothing to go over");
  });

  it("still says when it opens if the deadline is unreadable", async () => {
    assessmentsForAssignment.mockResolvedValue({
      homework: homework({ state: "open", locked: true, due_at: "not-a-date" }),
    });
    await mount({ hasAssessments: true });
    const text = host.textContent ?? "";
    expect(text).toContain("once the deadline passes");
    expect(text).not.toContain("Invalid Date");
  });
});

describe("HomeworkQuestionStatistics — the other three states", () => {
  it("renders an error with a retry, never an empty state", async () => {
    assessmentsForAssignment.mockRejectedValue(new Error("Gateway timed out."));
    await mount({ hasAssessments: true });

    const text = host.textContent ?? "";
    expect(text).toContain("could not load");
    expect(text).toContain("Nothing was analysed");
    expect(text).toContain("Try again");
    // The exact inversion this branch exists to prevent.
    expect(text).not.toContain("Nothing to go over");
    expect(text).not.toContain("Nothing is over");
  });

  it("is loading, not empty, before the first response lands", async () => {
    assessmentsForAssignment.mockReturnValue(new Promise(() => {}));
    await mount({ hasAssessments: true });
    expect(host.textContent).toContain("Counting this homework");
    expect(host.querySelector("[data-flagged-list]")).toBeNull();
  });

  it("leads with the work once the deadline has passed", async () => {
    assessmentsForAssignment.mockResolvedValue(assessmentPayload());
    await mount({ hasAssessments: true });

    const list = host.querySelector("[data-flagged-list]");
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain(OPEN_PROMPT);
    expect(list!.textContent).toContain("77%");
    expect(host.textContent).toContain("Go over this question");

    // The full list and the breakdowns are there, and folded.
    const folds = Array.from(host.querySelectorAll<HTMLDetailsElement>("details"));
    const summaries = folds.map((d) => d.querySelector("summary")?.textContent ?? "");
    expect(summaries.some((s) => s.includes("Statistics by question type"))).toBe(true);
    expect(summaries.some((s) => s.includes("Every assessment question"))).toBe(true);
    expect(folds.every((d) => !d.open)).toBe(true);
  });

  it("says a homework with no deadline is still moving, and shows the figures anyway", async () => {
    assessmentsForAssignment.mockResolvedValue(
      assessmentPayload({ state: "no_deadline", due_at: null, locked: false }),
    );
    await mount({ hasAssessments: true });

    const line = host.querySelector("[data-deadline-line]");
    expect(line?.textContent).toContain("no deadline");
    expect(line?.textContent).toContain("handed in so far");
    // Not locked: the numbers are on screen.
    expect(host.querySelector("[data-flagged-list]")).not.toBeNull();
  });
});

describe("HomeworkQuestionStatistics — both halves", () => {
  it("labels each half so no number is ambiguous about where it came from", async () => {
    assessmentsForAssignment.mockResolvedValue(assessmentPayload());
    pastpapersForAssignment.mockResolvedValue(pastpaperPayload([paper(44, "Paper 4")]));
    await mount({ hasAssessments: true, hasPastPapers: true });

    const text = host.textContent ?? "";
    expect(text).toContain("Assessments in this homework");
    expect(text).toContain("Past papers in this homework");
    expect(host.querySelectorAll("[data-flagged-list]").length).toBe(2);
  });

  it("keeps one half's failure from erasing the other's numbers", async () => {
    // Half a page of real work beats a whole page of nothing, as long as the missing half
    // says it is missing rather than reading as "no past papers here".
    assessmentsForAssignment.mockResolvedValue(assessmentPayload());
    pastpapersForAssignment.mockRejectedValue(new Error("Service unavailable."));
    await mount({ hasAssessments: true, hasPastPapers: true });

    expect(host.querySelector("[data-flagged-list]")?.textContent).toContain(OPEN_PROMPT);
    const text = host.textContent ?? "";
    expect(text).toContain("could not load the past-paper statistics");
    expect(text).toContain("this is not a paper with nothing to go over");
  });

  it("names every paper when a homework carries more than one", async () => {
    pastpapersForAssignment.mockResolvedValue(
      pastpaperPayload([paper(44, "Paper 4"), paper(45, "Paper 5")]),
    );
    await mount({ hasPastPapers: true });

    const text = host.textContent ?? "";
    expect(text).toContain("Paper 4");
    expect(text).toContain("Paper 5");
    expect(host.querySelectorAll("[data-flagged-list]").length).toBe(2);
  });

  it("says so out loud when the server analysed only some of the papers", async () => {
    const note = "This homework attaches 10 past papers; the first 8 are analysed here.";
    pastpapersForAssignment.mockResolvedValue(
      pastpaperPayload([paper(44, "Paper 4")], {}, { analysed: 8, total: 10, note }),
    );
    await mount({ hasPastPapers: true });
    expect(host.querySelector("[data-papers-truncated]")?.textContent).toContain(note);
  });

  it("discloses a gap the homework itself revealed, even with the server silent", async () => {
    pastpapersForAssignment.mockResolvedValue(pastpaperPayload([paper(44, "Paper 4")]));
    await mount({ hasPastPapers: true, pastPaperCount: 3 });
    const disclosure = host.querySelector("[data-papers-truncated]")?.textContent ?? "";
    expect(disclosure).toContain("3 past papers");
    expect(disclosure).toContain("1 of them");
  });
});
