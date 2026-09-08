import api, { classesApi, examsPublicApi } from "@/lib/api";
import type {
  AssessmentItemAnalysis,
  ClassroomOption,
  PastPaperOption,
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
  constructor(endpoint: string) {
    super(
      `The analysis from ${endpoint} came back in a shape this page does not understand. ` +
        "Nothing was analysed — do not read this as a clean result.",
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
    return assertShape(data, PASTPAPER_ITEM_ANALYSIS);
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
};
