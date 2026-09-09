/**
 * The API boundary for the in-homework analysis, where the deadline rule is actually enforced
 * on the client.
 *
 * Two failures it exists to prevent, and neither one looks like a crash:
 *
 *   1. **A backend that ignores `assignment=`.** An older server would answer the same URL
 *      with a whole-classroom analysis and no `homework` block — a 200, full of question
 *      prompts, answer keys and error rates, for a homework students may still be working on.
 *      No block, no render.
 *   2. **A locked payload that carries rows anyway.** The contract says a locked response
 *      holds the homework block and nothing else. This layer makes that true on the way in
 *      rather than trusting every component downstream to look away.
 *
 * And one honesty check: a capped list of papers has to arrive carrying the fact that it was
 * capped, or the disclosure the page prints is a guess.
 */
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args) },
  classesApi: { list: vi.fn() },
  examsPublicApi: { getPracticeTests: vi.fn() },
}));

const { questionAnalysisApi } = await import("../api");
const { homeworkAnalysisScope } = await import("@/features/classroom/homeworkApi");
import type { AssignmentDetail } from "@/features/classroom/homeworkApi";
import type { PastpaperPapersAnalysis } from "../types";

const OPEN = { id: 12, title: "Week 4", due_at: "2099-01-01T00:00:00Z", state: "open", locked: true };
const CLOSED = { id: 12, title: "Week 4", due_at: "2020-01-01T00:00:00Z", state: "closed", locked: false };

const assessments = () => questionAnalysisApi.assessmentsForAssignment({ assignment: 12, threshold: 25 });
const pastpapers = () => questionAnalysisApi.pastpapersForAssignment({ assignment: 12, threshold: 25 });

/** The smallest past-paper analysis this layer accepts, so a test can take one thing away. */
function onePaper() {
  return {
    questions: [],
    needs_analysis: [],
    totals: {
      questions: 0,
      seen: 0,
      answered: 0,
      omitted: 0,
      correct: 0,
      wrong: 0,
      error_rate: null,
      analysed: { questions: 0, seen: 0, answered: 0, wrong: 0 },
      needs_analysis: 0,
      suspect_key: 0,
    },
  };
}

describe("the deadline block is not optional", () => {
  it("refuses an assessment payload that never said whether the homework is open", async () => {
    // Exactly what a server too old to understand `assignment=` would return: a full,
    // perfectly valid classroom analysis. Valid, and not an answer to the question asked.
    get.mockResolvedValue({ data: { questions: [], needs_analysis: [] } });
    await expect(assessments()).rejects.toThrow(/deadline has passed/);
  });

  it("refuses a past-paper payload that never said whether the homework is open", async () => {
    get.mockResolvedValue({ data: { papers: [onePaper()] } });
    await expect(pastpapers()).rejects.toThrow(/deadline has passed/);
  });

  it("refuses a state it does not recognise rather than guessing which way it falls", async () => {
    get.mockResolvedValue({
      data: { homework: { ...CLOSED, state: "pending_review" }, questions: [], needs_analysis: [] },
    });
    await expect(assessments()).rejects.toThrow(/deadline has passed/);
  });
});

describe("a locked response carries nothing else", () => {
  it("drops rows a locked assessment payload should never have carried", async () => {
    get.mockResolvedValue({
      data: {
        homework: OPEN,
        // Not in the contract. If a future change ever put them here, they stop at this line.
        questions: [{ question_id: 1, prompt: "The answer is B" }],
        needs_analysis: [{ question_id: 1 }],
      },
    });
    const payload = await assessments();
    expect(payload.homework.locked).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("The answer is B");
    expect(Object.keys(payload)).toEqual(["homework"]);
  });

  it("drops papers a locked past-paper payload should never have carried", async () => {
    get.mockResolvedValue({ data: { homework: OPEN, papers: [onePaper()] } });
    const payload = await pastpapers();
    expect(Object.keys(payload)).toEqual(["homework"]);
  });

  it("does not lock a homework that simply has no deadline", async () => {
    get.mockResolvedValue({
      data: {
        homework: { ...CLOSED, due_at: null, state: "no_deadline" },
        questions: [],
        needs_analysis: [],
      },
    });
    const payload = await assessments();
    expect(payload.homework.locked).toBe(false);
    expect("questions" in payload).toBe(true);
  });
});

describe("an unlocked past-paper response", () => {
  it("insists on a list of papers, because one homework can carry several", async () => {
    get.mockResolvedValue({ data: { homework: CLOSED } });
    await expect(pastpapers()).rejects.toThrow(/no list of papers/);
  });

  it("validates every paper, not just the first", async () => {
    const broken = onePaper() as Record<string, unknown> & { totals: Record<string, unknown> };
    delete broken.totals.analysed;
    get.mockResolvedValue({ data: { homework: CLOSED, papers: [onePaper(), broken] } });
    await expect(pastpapers()).rejects.toThrow(/shape this page does not understand/);
  });

  it("carries the server's own sentence about a cap it applied", async () => {
    const note = "This homework attaches 10 past papers; the first 8 are analysed here.";
    get.mockResolvedValue({
      data: {
        homework: CLOSED,
        papers: [onePaper()],
        papers_total: 10,
        papers_analysed: 8,
        papers_limit: 8,
        papers_truncated: true,
        truncation_note: note,
      },
    });
    const payload = (await pastpapers()) as PastpaperPapersAnalysis;
    expect(payload.papers_truncated).toEqual({ analysed: 8, total: 10, note });
  });

  it("says nothing about a cap that did not bite", async () => {
    get.mockResolvedValue({
      data: {
        homework: CLOSED,
        papers: [onePaper()],
        papers_total: 1,
        papers_analysed: 1,
        papers_truncated: false,
        truncation_note: null,
      },
    });
    const payload = (await pastpapers()) as PastpaperPapersAnalysis;
    expect(payload.papers_truncated).toBeNull();
  });
});

describe("what a homework says it has to analyse", () => {
  const base = { id: 1, title: "x", due_at: null, status: "PUBLISHED", category: "HOMEWORK", max_score: null } as AssignmentDetail;

  it("draws nothing for a homework with neither", () => {
    expect(homeworkAnalysisScope(base).hasAny).toBe(false);
  });

  it("finds past papers through every field they can arrive in", () => {
    // Reading one field is how a homework with two papers reports on one; the backend has a
    // single resolver for exactly this reason.
    expect(homeworkAnalysisScope({ ...base, practice_test: 44 }).hasPastPapers).toBe(true);
    expect(homeworkAnalysisScope({ ...base, practice_test_ids: [44, 45] }).hasPastPapers).toBe(true);
    expect(homeworkAnalysisScope({ ...base, practice_test_pack: 9 }).hasPastPapers).toBe(true);
    expect(homeworkAnalysisScope({ ...base, practice_test_pack_ids: [9] }).hasPastPapers).toBe(true);
  });

  it("counts the papers only when the payload actually resolved them", () => {
    expect(homeworkAnalysisScope({ ...base, practice_test_ids: [44, 45] }).pastPaperCount).toBe(2);
    // A pack expands server-side into papers this payload never lists, so the honest answer
    // is "unknown" — never a number that would make the page claim a paper went missing.
    expect(homeworkAnalysisScope({ ...base, practice_test_pack: 9 }).pastPaperCount).toBeNull();
  });

  it("does not offer to analyse a mock exam, which the endpoint refuses anyway", () => {
    expect(homeworkAnalysisScope({ ...base, mock_exam: 3 }).hasAny).toBe(false);
  });

  it("finds an assessment through either shape the payload uses", () => {
    expect(
      homeworkAnalysisScope({ ...base, assessment_homeworks: [{ homework_id: 5 }] })
        .hasAssessments,
    ).toBe(true);
    expect(homeworkAnalysisScope({ ...base, assessment_homework: { id: 5 } }).hasAssessments).toBe(
      true,
    );
  });
});
