import api, { classesApi, examsPublicApi } from "@/lib/api";
import type {
  AssessmentAssignmentAnalysis,
  AssessmentItemAnalysis,
  ClassroomOption,
  HomeworkBlock,
  HomeworkState,
  PapersTruncated,
  PastPaperOption,
  PastpaperAssignmentAnalysis,
  PastpaperItemAnalysis,
} from "./types";

/**
 * API boundary for the teacher's question-analysis page.
 *
 * The two analysis endpoints are read straight off the axios instance: they return a freeform
 * analytics payload with no generated schema behind it, and the shapes in `./types.ts` are
 * transcribed from the builders that produce them. `assertShape` below is the whole of the
 * runtime checking, and it exists for one reason — a malformed payload has to surface as an
 * ERROR, never as a page that renders "no questions" and lets a teacher conclude their class
 * got everything right.
 *
 * The two pickers reuse the shared clients rather than re-spelling their URLs, and pass their
 * rows through whole. Rebuilding a row field-by-field here is the mapper-whitelist bug that
 * has already cost this project a production outage: the server adds a field, the hand-built
 * object silently drops it, and nothing type-checks the loss.
 */

/** Root-relative to the axios `baseURL`, which already ends in `/api`. */
const ASSESSMENT_ITEM_ANALYSIS = "/assessments/teacher/item-analysis/";
const PASTPAPER_ITEM_ANALYSIS = "/exams/teacher/pastpaper-item-analysis/";

class MalformedAnalysisError extends Error {
  constructor(endpoint: string, detail?: string) {
    super(
      `The analysis from ${endpoint} came back in a shape this page does not understand. ` +
        "Nothing was analysed — do not read this as a clean result." +
        (detail ? ` ${detail}` : ""),
    );
    this.name = "MalformedAnalysisError";
  }
}

/**
 * The minimum that has to be true for the page to mean anything: a question list and a
 * flagged list, both arrays. Anything less is an error, not an empty classroom.
 */
function assertShape<T extends { questions?: unknown; needs_analysis?: unknown }>(
  payload: T,
  endpoint: string,
): T {
  if (!payload || !Array.isArray(payload.questions) || !Array.isArray(payload.needs_analysis)) {
    throw new MalformedAnalysisError(endpoint);
  }
  return payload;
}

/**
 * The past paper's extra requirement: `totals.analysed`.
 *
 * `totals.error_rate` divides over the questions whose answer key is trustworthy, while
 * `totals.wrong` / `totals.answered` stay whole — so without `analysed` the page cannot say
 * which population the headline percentage describes, and would print a rate beside counts
 * that do not reconcile. A server too old to send it is a shape this page does not understand,
 * and the honest outcome is the error branch, not a quietly mislabelled number.
 */
function assertPastpaperShape(payload: PastpaperItemAnalysis, endpoint: string) {
  const analysed = assertShape(payload, endpoint).totals?.analysed;
  if (!analysed || typeof analysed.answered !== "number") {
    throw new MalformedAnalysisError(endpoint);
  }
  return payload;
}

const HOMEWORK_STATES: readonly HomeworkState[] = ["closed", "open", "no_deadline"];

/**
 * The `homework` block, or an error — never a silent fall-through to the numbers.
 *
 * This is the single check that keeps a still-open homework's answers off the screen. A
 * backend that does not understand `assignment=` would either 400 (which surfaces as an
 * error, correctly) or ignore the parameter and hand back a whole-classroom analysis with no
 * homework block at all. Rendering that would show every wrong answer and every answer key
 * from a homework students are still working on. So a payload with no usable block is a shape
 * this page refuses, exactly like a payload with no question list.
 */
function assertHomework(payload: unknown, endpoint: string): HomeworkBlock {
  const homework = (payload as { homework?: unknown } | null)?.homework as
    | Partial<HomeworkBlock>
    | undefined;
  if (
    !homework ||
    typeof homework !== "object" ||
    typeof homework.locked !== "boolean" ||
    typeof homework.state !== "string" ||
    !HOMEWORK_STATES.includes(homework.state as HomeworkState)
  ) {
    throw new MalformedAnalysisError(
      endpoint,
      "It did not say whether this homework's deadline has passed, so nothing is shown: " +
        "a homework that is still open must not show its questions or its answer keys.",
    );
  }
  return homework as HomeworkBlock;
}

/**
 * How many papers were left out, when any were.
 *
 * The server caps one homework's analysis at a fixed number of papers and says so, in three
 * fields plus a sentence of its own (`papers_truncated`, `papers_total`, `papers_analysed`,
 * `truncation_note`). Silent truncation is forbidden here for a plain reason: a teacher
 * reading three papers' numbers has no way to know a fourth exists.
 *
 * Read defensively rather than trustingly — a count larger than the list that arrived is
 * disclosed whether or not the boolean came with it, and the server's own sentence is carried
 * through rather than paraphrased. `null` is the ordinary case: nothing was left out.
 */
function readPapersTruncated(payload: unknown, analysed: number): PapersTruncated | null {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const total = Number(raw.papers_total);
  const reported = Number(raw.papers_analysed);
  const covered = Number.isFinite(reported) ? reported : analysed;
  const short = Number.isFinite(total) && total > covered;
  if (raw.papers_truncated !== true && !short) return null;
  const note =
    typeof raw.truncation_note === "string" && raw.truncation_note.trim()
      ? raw.truncation_note.trim()
      : null;
  return { analysed: covered, total: short ? total : covered, note };
}

export interface AssignmentAnalysisParams {
  /** `classes.Assignment.id` — the homework itself. The classroom is derived from it. */
  assignment: number;
  threshold: number;
}

export interface AssessmentAnalysisParams {
  classroom: number;
  /** One assessment set assigned to that classroom; omitted means every set. */
  set?: number | null;
  threshold: number;
}

export interface PastpaperAnalysisParams {
  classroom: number;
  practiceTest: number;
  threshold: number;
}

export const questionAnalysisApi = {
  /** Per-question analysis of one classroom's assessment homework. */
  async assessments(params: AssessmentAnalysisParams): Promise<AssessmentItemAnalysis> {
    const { data } = await api.get<AssessmentItemAnalysis>(ASSESSMENT_ITEM_ANALYSIS, {
      params: {
        classroom: params.classroom,
        threshold: params.threshold,
        ...(params.set != null ? { set: params.set } : {}),
      },
    });
    return assertShape(data, ASSESSMENT_ITEM_ANALYSIS);
  },

  /** Per-question analysis of one past paper for one classroom's roster. */
  async pastpaper(params: PastpaperAnalysisParams): Promise<PastpaperItemAnalysis> {
    const { data } = await api.get<PastpaperItemAnalysis>(PASTPAPER_ITEM_ANALYSIS, {
      params: {
        classroom: params.classroom,
        practice_test: params.practiceTest,
        threshold: params.threshold,
      },
    });
    return assertPastpaperShape(data, PASTPAPER_ITEM_ANALYSIS);
  },

  /**
   * The same assessment analysis, scoped to ONE homework rather than a whole classroom.
   *
   * The classroom comes from the assignment server-side, and so does the verdict on its
   * deadline. A locked response is narrowed to the homework block alone before it leaves this
   * function: the contract says a locked payload carries nothing else, and narrowing here
   * means no component can render a row that should not exist even if one ever arrives.
   */
  async assessmentsForAssignment(
    params: AssignmentAnalysisParams,
  ): Promise<AssessmentAssignmentAnalysis> {
    const { data } = await api.get<AssessmentItemAnalysis & { homework: HomeworkBlock }>(
      ASSESSMENT_ITEM_ANALYSIS,
      { params: { assignment: params.assignment, threshold: params.threshold } },
    );
    const homework = assertHomework(data, ASSESSMENT_ITEM_ANALYSIS);
    if (homework.locked) return { homework };
    return { ...assertShape(data, ASSESSMENT_ITEM_ANALYSIS), homework };
  },

  /**
   * Every past paper attached to one homework, each analysed in full.
   *
   * One assignment can bundle several papers, so this returns a list where the single-paper
   * call returns one analysis. Each entry is validated exactly as the standalone one is — a
   * paper whose payload cannot name the population its headline rate divided is an error for
   * the whole request, not a quietly mislabelled card among several correct ones.
   */
  async pastpapersForAssignment(
    params: AssignmentAnalysisParams,
  ): Promise<PastpaperAssignmentAnalysis> {
    const { data } = await api.get<{
      homework: HomeworkBlock;
      papers?: PastpaperItemAnalysis[];
    }>(PASTPAPER_ITEM_ANALYSIS, {
      params: { assignment: params.assignment, threshold: params.threshold },
    });
    const homework = assertHomework(data, PASTPAPER_ITEM_ANALYSIS);
    if (homework.locked) return { homework };
    if (!Array.isArray(data?.papers)) {
      throw new MalformedAnalysisError(
        PASTPAPER_ITEM_ANALYSIS,
        "It carried no list of papers for this homework.",
      );
    }
    const papers = data.papers.map((paper) =>
      assertPastpaperShape(paper, PASTPAPER_ITEM_ANALYSIS),
    );
    return {
      homework,
      papers,
      papers_truncated: readPapersTruncated(data, papers.length),
    };
  },

  /** Classrooms this teacher is a member of — the picker at the top of the page. */
  async classrooms(): Promise<ClassroomOption[]> {
    const res = await classesApi.list();
    return res.items;
  },

  /**
   * The past-paper library, for the paper picker. `GET /exams/` is already standalone-only
   * (a timed mock's sections live behind `/exams/mock-exams/`), and the analysis endpoint
   * refuses anything carrying a `mock_exam` — so the filter here keeps the picker from
   * offering a paper the server would then reject.
   */
  async pastPapers(): Promise<PastPaperOption[]> {
    const res = await examsPublicApi.getPracticeTests();
    return res.items.filter((test) => test.mock_exam_id == null);
  },
};

export const questionAnalysisKeys = {
  all: ["question-analysis"] as const,
  classrooms: () => [...questionAnalysisKeys.all, "classrooms"] as const,
  pastPapers: () => [...questionAnalysisKeys.all, "past-papers"] as const,
  assessments: (classroomId: number, setId: number | null, threshold: number) =>
    [...questionAnalysisKeys.all, "assessments", classroomId, setId, threshold] as const,
  pastpaper: (classroomId: number, practiceTestId: number, threshold: number) =>
    [...questionAnalysisKeys.all, "pastpaper", classroomId, practiceTestId, threshold] as const,
  assignmentAssessments: (assignmentId: number, threshold: number) =>
    [...questionAnalysisKeys.all, "assignment", "assessments", assignmentId, threshold] as const,
  assignmentPastpapers: (assignmentId: number, threshold: number) =>
    [...questionAnalysisKeys.all, "assignment", "pastpapers", assignmentId, threshold] as const,
};
