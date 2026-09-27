/**
 * "Most missed", inside the homework, and the pop-up behind a row.
 *
 * The owner asked for two things: that a teacher can see what their class got wrong most from
 * inside the homework they are already looking at, and that they can open any one of those
 * questions in a pop-up and work it. The cases below are those two, plus the three rules this
 * block is not allowed to break.
 *
 * The one that carries real risk is the **deadline**. The figures, the prompts and the answer
 * keys open only once a homework's deadline has passed, and that verdict is the server's. So
 * the locked case does not check for a nice message — it checks that no question, no count and
 * no answer key is anywhere in the DOM, and that not one question body was fetched.
 *
 * The second is the **capability**. `AssignmentDetail` is the same page on the student route
 * and the teacher route, so the block is mounted behind `caps.canViewClassAnalytics` and never
 * behind the address. A student opening their own homework must reach no part of this.
 *
 * The third is the house rule this codebase keeps paying for: a request that FAILED says so
 * and offers a retry. It must never render as "nobody missed anything", which would tell a
 * teacher their class got everything right.
 *
 * `@/lib/api` is the seam, mocked the way `teacherDashboardToday.test.tsx` mocks it — so the
 * real `questionAnalysisApi` runs, with its real shape checks, over a fake transport.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ── the transport, and every write these surfaces could possibly reach for ──────
const apiGet = vi.fn();
const classroomGet = vi.fn();
const getAssignment = vi.fn();
const getMySubmission = vi.fn();
const getPastpaperSection = vi.fn();
const getQuestions = vi.fn();
const adminGetSet = vi.fn();

const writes = {
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  submitAssignment: vi.fn(),
  startTest: vi.fn(),
};

const ASSESSMENT_ANALYSIS = "/assessments/teacher/item-analysis/";
const PASTPAPER_ANALYSIS = "/exams/teacher/pastpaper-item-analysis/";

vi.mock("@/lib/api", () => ({
  default: {
    get: (url: string, config?: unknown) => apiGet(url, config),
    post: writes.post,
    put: writes.put,
    patch: writes.patch,
    delete: writes.delete,
  },
  getCachedCsrfToken: () => null,
  classesApi: {
    get: (id: number) => classroomGet(id),
    getMySubmission: (...a: unknown[]) => getMySubmission(...a),
    submitAssignment: writes.submitAssignment,
    list: vi.fn(),
  },
  examsPublicApi: {
    getPastpaperSection: (id: number) => getPastpaperSection(id),
    getPastpaperSections: vi.fn(),
    getPracticeTests: vi.fn(),
    startTest: writes.startTest,
  },
  examsAdminApi: {
    getQuestions: (testId: number, moduleId: number) => getQuestions(testId, moduleId),
  },
  assessmentsAdminApi: { adminGetSet: (id: number) => adminGetSet(id) },
}));

vi.mock("@/components/VideoPlayer", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { MostMissed } = await import("../mistakes");
// The pop-up is code-split, so `MostMissed` only reaches for it when a row is opened. Warmed
// here so a click resolves it from the module cache in a tick, as it does in a browser that
// has opened one before — without this the assertions race the chunk rather than the render.
await import("../mistakes/QuestionPopup");
const { AssignmentDetailPage } = await import("@/features/classroom/pages/AssignmentDetail");

// ── fixtures ───────────────────────────────────────────────────────────────────

const SET_TITLE = "Linear functions, set 4";
const SLOPE_PROMPT = "A line passes through (0, 3) and (2, 7).";
const INTERCEPT_PROMPT = "A line crosses the y-axis at 6.";
const RIGHT_PROMPT = "Every student got this one.";
const COLONY_STEM = "Scientists tracked the colony for a decade.";
const RANGE_STEM = "The colony's range widened each spring.";
const COLONY_EXPLANATION = "The passage sets up a disagreement.";

function homework(over: Record<string, unknown> = {}) {
  return {
    id: 55,
    title: "Week 4 — Algebra",
    due_at: "2026-09-19T18:00:00Z",
    state: "closed",
    locked: false,
    ...over,
  };
}

function assessmentRow(over: Record<string, unknown>) {
  return {
    question_id: 0, order: 0, position: 1, prompt: "", prompt_truncated: false,
    question_type: "multiple_choice", question_type_label: "Multiple choice",
    set: { id: 7, title: SET_TITLE, subject: "MATH" },
    students_answered: 12, students_graded: 12, students_correct: 3, students_wrong: 0,
    ungraded: 0, error_rate: 0, needs_analysis: false, skill: null, domain: null,
    ...over,
  };
}

function paperRow(over: Record<string, unknown>) {
  return {
    question_id: 0, number: 1, module: 1, module_label: "Module 1", stem: "",
    correct_answer: "B", question_type: "READING", question_type_label: "Reading",
    format: "MCQ", format_label: "Multiple choice", skill_id: null, skill: "Untagged",
    domain_id: null, domain: "Untagged", difficulty: null, difficulty_label: "—",
    seen: 20, answered: 20, omitted: 0, correct: 20, wrong: 0,
    error_rate: 0, miss_rate: 0, needs_analysis: false, suspect_key: false,
    ...over,
  };
}

/** The assessment half: two questions the class missed, one it did not. */
const ASSESSMENT_PAYLOAD = {
  homework: homework(),
  classroom: { id: 1, name: "Math Junior 3", subject: "MATH", subject_label: "Math", level: null, level_label: null },
  threshold: 25,
  denominator: "graded",
  counting_rule: "one attempt per student",
  summary: {
    questions_total: 3, questions_analysed: 3, questions_awaiting_grading: 0,
    questions_flagged: 1, students_counted: 12, attempts_counted: 12, sets: 1,
  },
  taxonomy_coverage: { linked: 0, total: 3, rate: null, note: "" },
  excluded: { retired_questions: 0 },
  needs_analysis: [],
  questions: [
    assessmentRow({ question_id: 501, position: 1, prompt: SLOPE_PROMPT, students_wrong: 9, students_correct: 3, error_rate: 75 }),
    assessmentRow({ question_id: 502, position: 2, prompt: INTERCEPT_PROMPT, students_wrong: 2, students_correct: 10, error_rate: 17 }),
    assessmentRow({ question_id: 503, position: 3, prompt: RIGHT_PROMPT, students_wrong: 0, students_correct: 12, error_rate: 0 }),
  ],
  by_question_type: [], by_skill: [], by_domain: [],
  sets: [{ id: 7, title: SET_TITLE, subject: "MATH" }],
};

/** The past-paper half: the worst question on the homework, and a nearly clean one. */
const PAPER = {
  practice_test: { id: 41, title: "October 2025 Int. A", collection_name: "October 2025", subject: "READING_WRITING", subject_label: "Reading & Writing" },
  classroom: { id: 1, name: "Math Junior 3", subject: "MATH", subject_label: "Math" },
  threshold: 25,
  denominator: "answered",
  attempt_selection: "first_clean_completed_sitting_per_student",
  needs_analysis: [],
  questions: [
    paperRow({ question_id: 9001, number: 4, stem: COLONY_STEM, wrong: 11, omitted: 3, correct: 6, answered: 17, error_rate: 65, miss_rate: 70 }),
    paperRow({ question_id: 9002, number: 5, stem: RANGE_STEM, wrong: 1, omitted: 0, correct: 19, error_rate: 5, miss_rate: 5 }),
  ],
  totals: {
    questions: 2, seen: 40, answered: 37, omitted: 3, correct: 25, wrong: 12,
    error_rate: 32, analysed: { questions: 2, seen: 40, answered: 37, wrong: 12 },
    needs_analysis: 1, suspect_key: 0,
  },
  groups: {
    question_type: { coverage: { tagged: 2, total: 2 }, groups: [] },
    format: { coverage: { tagged: 2, total: 2 }, groups: [] },
    skill: { coverage: { tagged: 0, total: 2 }, groups: [] },
    domain: { coverage: { tagged: 0, total: 2 }, groups: [] },
    difficulty: { coverage: { tagged: 0, total: 2 }, groups: [] },
  },
  unclassified_total: 2,
  unclassified_wrong: 12,
  data_quality: {
    roster: 20, attempts_considered: 20, attempts_counted: 20, students_counted: 20,
    excluded: { copied: 0, repeat_sitting: 0 }, suspect_key_questions: 0,
  },
};

const PASTPAPER_PAYLOAD = { homework: homework(), papers: [PAPER] };

/** The paper as the authoring endpoint answers it — key and explanation attached. */
const SECTION = {
  id: 41, title: "October 2025 Int. A", practice_date: "2025-10-04",
  subject: "READING_WRITING", label: "A", form_type: "INTERNATIONAL",
  collection_name: "October 2025", is_published: true,
  modules: [{ id: 411, module_order: 1 }],
};

const PAPER_QUESTIONS = [
  {
    id: 9001, order: 1, question_text: COLONY_STEM,
    question_prompt: "Which choice best states the purpose of the passage?",
    question_type: "READING", is_math_input: false,
    option_a: "To record a steady rise", option_b: "To dispute an old estimate",
    option_c: "To describe a method", option_d: "To praise a researcher",
    correct_answer: "B", explanation: COLONY_EXPLANATION, score: 1,
  },
  {
    id: 9002, order: 2, question_text: RANGE_STEM,
    question_prompt: "Which choice completes the text?",
    question_type: "READING", is_math_input: false,
    option_a: "nevertheless", option_b: "therefore", option_c: "however", option_d: "moreover",
    correct_answer: "D", explanation: "", score: 1,
  },
];

const ASSESSMENT_SET = {
  id: 7, title: SET_TITLE, subject: "math", level: "junior",
  questions: [
    {
      id: 501, order: 1, question_type: "multiple_choice", is_active: true, points: 1,
      prompt: SLOPE_PROMPT, question_prompt: "What is its slope?",
      choices: [{ id: "A", text: "1" }, { id: "B", text: "2" }, { id: "C", text: "3" }, { id: "D", text: "4" }],
      correct_answer: "B", explanation: "Rise over run: four over two.",
    },
    {
      id: 502, order: 2, question_type: "multiple_choice", is_active: true, points: 1,
      prompt: INTERCEPT_PROMPT, question_prompt: "What is its y-intercept?",
      choices: [{ id: "A", text: "3" }, { id: "B", text: "6" }],
      correct_answer: "B", explanation: "It is where x is zero.",
    },
  ],
};

// ── fixtures for the judgement-carrying branches ───────────────────────────────

const SUSPECT_STEM = "Nearly every student chose the same wrong option.";
const NO_RATE_STEM = "The analysis could not work out a rate for this one.";
const GRID_STEM = "Solve 3x + 4 = 25 for x.";
const GRID_STEM_2 = "Solve 2y - 8 = 10 for y.";

/** A paper whose worst row the backend flags as a likely broken key, plus a rate-less row. */
const FLAGGED_PAPER = {
  ...PAPER,
  questions: [
    paperRow({
      question_id: 9004, number: 7, stem: SUSPECT_STEM,
      wrong: 19, omitted: 1, correct: 0, answered: 19,
      error_rate: 100, miss_rate: 100, suspect_key: true,
    }),
    paperRow({
      question_id: 9003, number: 6, stem: NO_RATE_STEM,
      wrong: 3, omitted: 0, correct: 17, answered: 20,
      error_rate: null, miss_rate: null,
    }),
  ],
};

const FLAGGED_QUESTIONS = [
  {
    id: 9004, order: 7, question_text: SUSPECT_STEM,
    question_prompt: "Which choice best completes the text?",
    question_type: "READING", is_math_input: false,
    option_a: "one", option_b: "two", option_c: "three", option_d: "four",
    correct_answer: "C", explanation: "", score: 1,
  },
  {
    id: 9003, order: 6, question_text: NO_RATE_STEM,
    question_prompt: "Which choice best completes the text?",
    question_type: "READING", is_math_input: false,
    option_a: "one", option_b: "two", option_c: "three", option_d: "four",
    correct_answer: "A", explanation: "", score: 1,
  },
];

/** Two grid-ins in a row: the caret test and the carry-over test both need real inputs. */
const GRID_PAPER = {
  ...PAPER,
  questions: [
    paperRow({ question_id: 9101, number: 1, stem: GRID_STEM, wrong: 8, omitted: 0, correct: 12, answered: 20, error_rate: 40, miss_rate: 40 }),
    paperRow({ question_id: 9102, number: 2, stem: GRID_STEM_2, wrong: 5, omitted: 0, correct: 15, answered: 20, error_rate: 25, miss_rate: 25 }),
  ],
};

const GRID_QUESTIONS = [
  {
    id: 9101, order: 1, question_text: GRID_STEM, question_prompt: "",
    question_type: "MATH", is_math_input: true,
    correct_answer: "7", explanation: "", score: 1,
  },
  {
    id: 9102, order: 2, question_text: GRID_STEM_2, question_prompt: "",
    question_type: "MATH", is_math_input: true,
    correct_answer: "9", explanation: "", score: 1,
  },
];

/** Six questions the class missed — one more than the block shows before the toggle. */
const SIX_MISSED = {
  ...ASSESSMENT_PAYLOAD,
  questions: [1, 2, 3, 4, 5, 6].map((n) =>
    assessmentRow({
      question_id: 600 + n, position: n, prompt: `Missed question ${n}`,
      students_wrong: 12 - n, students_correct: n, error_rate: 90 - n,
    }),
  ),
};

const ASSIGNMENT = {
  id: 55, title: "Week 4 — Algebra", category: "HOMEWORK", status: "PUBLISHED",
  subject: "MATH", due_at: "2026-09-19T18:00:00Z",
  assessment_homeworks: [{ id: 3, set_id: 7 }],
  practice_test_ids: [41],
};

// ── harness ────────────────────────────────────────────────────────────────────

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of [apiGet, classroomGet, getAssignment, getMySubmission, getPastpaperSection, getQuestions, adminGetSet]) {
    fn.mockReset();
  }
  getPastpaperSection.mockResolvedValue(SECTION);
  getQuestions.mockResolvedValue(PAPER_QUESTIONS);
  adminGetSet.mockResolvedValue(ASSESSMENT_SET);
  getMySubmission.mockResolvedValue(null);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** Route the one axios instance by URL, the way the real endpoints are separated. */
function serveAnalysis(assessments: unknown, pastpapers: unknown) {
  apiGet.mockImplementation(async (url: string) => {
    if (url === ASSESSMENT_ANALYSIS) {
      if (assessments instanceof Error) throw assessments;
      return { data: assessments };
    }
    if (url === PASTPAPER_ANALYSIS) {
      if (pastpapers instanceof Error) throw pastpapers;
      return { data: pastpapers };
    }
    if (url.includes("/assignments/")) return { data: await getAssignment() };
    throw new Error(`unexpected GET ${url}`);
  });
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mountBlock(props?: Partial<{ hasAssessments: boolean; hasPastPapers: boolean }>) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client()}>
        <MostMissed
          assignmentId={55}
          hasAssessments={props?.hasAssessments ?? true}
          hasPastPapers={props?.hasPastPapers ?? true}
        />
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
}

async function mountPage() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client()}>
        <AssignmentDetailPage classId={1} assignmentId={55} />
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
}

const text = () => host.textContent ?? "";
const rowKeys = () => [...host.querySelectorAll("[data-missed-row]")].map((el) => el.getAttribute("data-missed-row"));
const popup = () => document.querySelector("[data-missed-popup]");
const popupText = () => popup()?.textContent ?? "";

function buttonWith(label: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  if (!found) throw new Error(`no button containing ${JSON.stringify(label)}`);
  return found as HTMLButtonElement;
}

/**
 * Twice, because the pop-up is code-split: the first click resolves its chunk and the second
 * flush is the render that chunk causes. A single flush catches the block but not the dialog.
 */
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
}

// ── the capability ─────────────────────────────────────────────────────────────

describe("who may see what the class got wrong", () => {
  it("shows a student their homework and no part of the block", async () => {
    classroomGet.mockResolvedValue({ id: 1, name: "Math Junior 3", my_role: "STUDENT" });
    getAssignment.mockResolvedValue(ASSIGNMENT);
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountPage();

    expect(text()).toContain("Week 4 — Algebra");
    expect(text()).not.toContain("Most missed");
    expect(text()).not.toContain(SLOPE_PROMPT);
    expect(text()).not.toContain(COLONY_STEM);
    // Not merely hidden — never asked for. A student's browser holds no answer key.
    const asked = apiGet.mock.calls.map(([url]) => url);
    expect(asked).not.toContain(ASSESSMENT_ANALYSIS);
    expect(asked).not.toContain(PASTPAPER_ANALYSIS);
  });

  it("shows a teacher the block on the same homework", async () => {
    classroomGet.mockResolvedValue({ id: 1, name: "Math Junior 3", my_role: "TEACHER" });
    getAssignment.mockResolvedValue(ASSIGNMENT);
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountPage();

    expect(text()).toContain("Most missed");
    expect(text()).toContain(COLONY_STEM);
  });
});

// ── before the deadline ────────────────────────────────────────────────────────

describe("before the deadline", () => {
  const LOCKED = homework({ state: "open", locked: true, due_at: "2099-01-01T12:00:00Z" });

  it("says in one line when the figures open, and shows nothing else", async () => {
    serveAnalysis({ homework: LOCKED }, { homework: LOCKED });
    await mountBlock();

    expect(host.querySelector("[data-missed-locked]")).not.toBeNull();
    expect(text()).toContain("opens once this homework's deadline passes");
    // Not one figure, not one prompt, not one row.
    expect(rowKeys()).toEqual([]);
    expect(text()).not.toContain(SLOPE_PROMPT);
    expect(text()).not.toContain(COLONY_STEM);
    expect(text()).not.toContain("missed it");
  });

  it("fetches no question body — there is nothing to open", async () => {
    serveAnalysis({ homework: LOCKED }, { homework: LOCKED });
    await mountBlock();

    expect(adminGetSet).not.toHaveBeenCalled();
    expect(getPastpaperSection).not.toHaveBeenCalled();
    expect(getQuestions).not.toHaveBeenCalled();
  });
});

// ── after it ───────────────────────────────────────────────────────────────────

describe("after the deadline", () => {
  it("ranks the questions the class missed, worst first, with the counts", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();

    // 14 missed, then 9, then 2, then 1 — across both kinds of work, in one list.
    expect(rowKeys()).toEqual(["p-9001", "a-501", "a-502", "p-9002"]);
    expect(text()).toContain("14");
    expect(text()).toContain("9");
    // The question nobody missed is not a mistake and is not on the list.
    expect(text()).not.toContain(RIGHT_PROMPT);
    // Each row states the population its count was taken from.
    const worst = host.querySelector('[data-missed-row="p-9001"]');
    expect(worst?.getAttribute("title")).toContain("14 of 20 who saw it missed it");
    const slope = host.querySelector('[data-missed-row="a-501"]');
    expect(slope?.getAttribute("title")).toContain("9 of 12 graded answers got it wrong");
  });

  it("opens the question in a pop-up, in full", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();
    expect(popup()).toBeNull();

    await click(host.querySelector('[data-missed-row="p-9001"]')!);

    expect(popup()).not.toBeNull();
    expect(popupText()).toContain(COLONY_STEM);
    // The full question, not the one-line preview: the choices are there to answer.
    expect(popupText()).toContain("To dispute an old estimate");
    // And the teacher is told where they are in the list they are walking.
    expect(popupText()).toContain("Most missed · 1 of 4");
  });

  it("lets the teacher work it: answering reveals the explanation, and only then", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();
    await click(host.querySelector('[data-missed-row="p-9001"]')!);

    expect(popupText()).not.toContain(COLONY_EXPLANATION);
    await click(buttonWith("To dispute an old estimate", popup()!));
    // The key is still hidden — an answer is not a check.
    expect(popupText()).not.toContain(COLONY_EXPLANATION);

    await click(buttonWith("Check", popup()!));
    expect(popupText()).toContain(COLONY_EXPLANATION);
    expect(popup()!.querySelector('[data-verdict="correct"]')).not.toBeNull();
  });

  it("walks the list without closing: next, then back", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();
    await click(host.querySelector('[data-missed-row="p-9001"]')!);

    await click(buttonWith("Next", popup()!));
    await flush();
    expect(popupText()).toContain("Most missed · 2 of 4");
    expect(popupText()).toContain(SLOPE_PROMPT);
    expect(popupText()).not.toContain(COLONY_STEM);

    await click(buttonWith("Previous", popup()!));
    await flush();
    expect(popupText()).toContain("Most missed · 1 of 4");
    expect(popupText()).toContain(COLONY_STEM);
  });

  it("closes on Escape", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();
    await click(host.querySelector('[data-missed-row="p-9001"]')!);
    expect(popup()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(popup()).toBeNull();
  });

  /**
   * Two questions the same number of students missed, at the same rate. The tie-break is the
   * set's own order, which is a NUMBER: sorted by the label, `Question 10` would come before
   * `Question 9`. And the sentence beside a row has to carry the answers still waiting on a
   * score, or a teacher reads a partial count as a final one.
   */
  it("breaks a tie by the set's own order, and counts what is still ungraded", async () => {
    const tied = {
      ...ASSESSMENT_PAYLOAD,
      questions: [
        assessmentRow({ question_id: 710, position: 10, prompt: "Tenth", students_wrong: 4, students_correct: 8, error_rate: 33 }),
        assessmentRow({ question_id: 709, position: 9, prompt: "Ninth", students_wrong: 4, students_correct: 6, students_graded: 12, ungraded: 2, error_rate: 33 }),
      ],
    };
    serveAnalysis(tied, { homework: homework(), papers: [] });
    await mountBlock();

    expect(rowKeys()).toEqual(["a-709", "a-710"]);
    expect(host.querySelector('[data-missed-row="a-709"]')?.getAttribute("title")).toContain(
      "4 of 12 graded answers got it wrong · 2 more answers still waiting on a score",
    );
  });

  it("celebrates a class that missed nothing", async () => {
    const clean = {
      ...ASSESSMENT_PAYLOAD,
      questions: [assessmentRow({ question_id: 503, position: 1, prompt: RIGHT_PROMPT })],
    };
    serveAnalysis(clean, { homework: homework(), papers: [] });
    await mountBlock();

    expect(text()).toContain("Nobody missed anything");
    expect(rowKeys()).toEqual([]);
  });
});

// ── where the pop-up is mounted ────────────────────────────────────────────────

/**
 * jsdom computes no layout, so nothing here can see a dialog open below the fold. What it CAN
 * see is the cause: a `position: fixed` overlay rendered in place, inside `.cr-section` and
 * `.cr-card`, both of which carry a transform — and a transformed ancestor becomes the
 * containing block for fixed-position descendants, so the overlay stops being anchored to the
 * viewport. The fix is to portal onto <body>, and THAT is a DOM fact a test can hold.
 */
describe("where the pop-up is mounted", () => {
  it("portals onto document.body rather than rendering inside the card", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await mountBlock();
    await click(host.querySelector('[data-missed-row="p-9001"]')!);

    const el = popup();
    expect(el).not.toBeNull();
    // Not a descendant of the block, therefore not of the transformed card around it.
    expect(host.contains(el!)).toBe(false);
    // And its own root — the `.dzboard` scope that carries the kit's colours — hangs directly
    // off <body>, which is what keeps `inset: 0` meaning the viewport.
    const scope = el!.closest(".dzboard");
    expect(scope).not.toBeNull();
    expect(scope!.parentElement).toBe(document.body);
  });
});

// ── the calls this block makes on the teacher's behalf ─────────────────────────

describe("a question the backend flagged", () => {
  it("badges the row and leads the pop-up with the answer key, not the topic", async () => {
    getQuestions.mockResolvedValue(FLAGGED_QUESTIONS);
    serveAnalysis(ASSESSMENT_PAYLOAD, { homework: homework(), papers: [FLAGGED_PAPER] });
    await mountBlock();

    // 20 missed — it is genuinely the most missed, so it stays at the top of the list.
    expect(rowKeys()[0]).toBe("p-9004");
    const flagged = host.querySelector('[data-missed-row="p-9004"]')!;
    expect(flagged.textContent).toContain("Check the answer key");
    // A question that is merely hard is not accused of a broken key.
    expect(host.querySelector('[data-missed-row="a-501"]')!.textContent).not.toContain(
      "Check the answer key",
    );

    await click(flagged);
    expect(popupText()).toContain("far more often a wrong answer key");
  });

  it("shows an em dash for a rate it does not have — never 0%", async () => {
    serveAnalysis({ ...ASSESSMENT_PAYLOAD, questions: [] }, { homework: homework(), papers: [FLAGGED_PAPER] });
    await mountBlock();

    const rateless = host.querySelector('[data-missed-row="p-9003"]')!;
    // 3 of 20 missed it and the rate is unknown: "0%" would read as "nobody missed it",
    // which is the opposite of the count sitting right beside it.
    expect(rateless.textContent).toContain("3");
    expect(rateless.textContent).toContain("—");
    expect(rateless.textContent).not.toContain("0%");
  });
});

describe("a way to see the rest", () => {
  it("shows the worst five, then all of them when asked", async () => {
    serveAnalysis(SIX_MISSED, { homework: homework(), papers: [] });
    await mountBlock();

    expect(rowKeys()).toEqual(["a-601", "a-602", "a-603", "a-604", "a-605"]);
    const toggle = buttonWith("Show all 6 questions the class missed", host);

    await click(toggle);
    expect(rowKeys()).toEqual(["a-601", "a-602", "a-603", "a-604", "a-605", "a-606"]);
    expect(buttonWith("Show the worst 5", host)).toBeTruthy();
  });

  /**
   * The past-paper endpoint caps how many papers it analyses and says so. A list built on a
   * capped response is not every question the class missed, so it must not offer to "show all
   * of them" — and the server's own sentence about the cap has to travel with it.
   */
  it("says so when the server only counted some of the papers", async () => {
    serveAnalysis(SIX_MISSED, {
      homework: homework(),
      papers: [PAPER],
      papers_truncated: true,
      papers_total: 3,
      papers_analysed: 1,
      truncation_note: "Only 1 of this homework's 3 past papers was counted.",
    });
    await mountBlock();

    const note = host.querySelector("[data-missed-truncated]");
    expect(note).not.toBeNull();
    // The server's own sentence, rendered as written rather than paraphrased.
    expect(note!.textContent).toContain("Only 1 of this homework's 3 past papers was counted.");
    expect(text()).not.toContain("questions the class missed");
    expect(buttonWith("Show the other", host)).toBeTruthy();
  });
});

// ── when it breaks ─────────────────────────────────────────────────────────────

describe("a request that failed", () => {
  it("says so and offers a retry — never 'nobody missed anything'", async () => {
    serveAnalysis(new Error("Network Error"), new Error("Network Error"));
    await mountBlock();

    expect(text()).toContain("Nothing was counted");
    expect(text()).not.toContain("Nobody missed anything");
    expect(rowKeys()).toEqual([]);
    expect(buttonWith("Try again")).toBeTruthy();
  });

  it("retries both halves when the teacher asks", async () => {
    serveAnalysis(new Error("Network Error"), new Error("Network Error"));
    await mountBlock();
    const before = apiGet.mock.calls.length;

    serveAnalysis(ASSESSMENT_PAYLOAD, PASTPAPER_PAYLOAD);
    await click(buttonWith("Try again"));
    await flush();

    expect(apiGet.mock.calls.length).toBeGreaterThan(before);
    expect(rowKeys()).toEqual(["p-9001", "a-501", "a-502", "p-9002"]);
  });

  it("keeps the half that loaded and names the half that did not", async () => {
    serveAnalysis(ASSESSMENT_PAYLOAD, new Error("Network Error"));
    await mountBlock();

    expect(rowKeys()).toEqual(["a-501", "a-502"]);
    expect(text()).toContain("past-paper half of this homework did not load");
    expect(text()).not.toContain("Nobody missed anything");
  });

  /**
   * The half that loaded happens to be clean. That is NOT "the class got everything right" —
   * the other half was never counted — and it is the one way an empty list can still be a
   * lie. The banner alone does not do it: a teacher who skims past one line reads the
   * celebration underneath.
   */
  it("does not celebrate when the empty list is half a homework", async () => {
    const clean = {
      ...ASSESSMENT_PAYLOAD,
      questions: [assessmentRow({ question_id: 503, position: 1, prompt: RIGHT_PROMPT })],
    };
    serveAnalysis(clean, new Error("Network Error"));
    await mountBlock();

    expect(rowKeys()).toEqual([]);
    expect(text()).not.toContain("Nobody missed anything");
    expect(text()).toContain("this is not a homework the class got right");
    expect(text()).toContain("past-paper half of this homework did not load");
    expect(buttonWith("Try again")).toBeTruthy();
  });

  /**
   * The figures came back; the question behind one of them did not. The pop-up has to say
   * that, keep the figures standing, and offer the read again — not draw an empty question or
   * a skeleton that never resolves.
   */
  it("says when the question itself did not load, and keeps the figures", async () => {
    adminGetSet.mockRejectedValue(new Error("Network Error"));
    serveAnalysis(ASSESSMENT_PAYLOAD, { homework: homework(), papers: [] });
    await mountBlock();

    await click(host.querySelector('[data-missed-row="a-501"]')!);

    expect(popupText()).toContain("This question didn't load");
    expect(popupText()).toContain("The figures above are real");
    expect(buttonWith("Try again", popup()!)).toBeTruthy();
    // The row's own count is still on the page behind it.
    expect(host.querySelector('[data-missed-row="a-501"]')?.getAttribute("title")).toContain(
      "9 of 12 graded answers got it wrong",
    );
  });

  /**
   * A row whose analysis names no set to read the question from. Nothing can be fetched, so
   * the query is DISABLED — and a disabled react-query is pending forever. Drawn as loading,
   * that is a skeleton that never resolves: a dead end painted as work in progress.
   */
  it("says a question is gone rather than loading it forever", async () => {
    const orphaned = {
      ...ASSESSMENT_PAYLOAD,
      questions: [
        assessmentRow({
          question_id: 501, position: 1, prompt: SLOPE_PROMPT,
          students_wrong: 9, students_correct: 3, error_rate: 75,
          set: { id: 0, title: SET_TITLE, subject: "MATH" },
        }),
      ],
    };
    serveAnalysis(orphaned, { homework: homework(), papers: [] });
    await mountBlock();

    await click(host.querySelector('[data-missed-row="a-501"]')!);

    // The pop-up says what happened. Drawn as loading it would say nothing at all, forever.
    expect(popupText()).toContain("no longer in the set");
    expect(popupText()).toContain("Its figures above still stand");
    // And nothing was asked for, because there was nothing to ask about.
    expect(adminGetSet).not.toHaveBeenCalled();
  });
});

// ── the teacher working the question ───────────────────────────────────────────

describe("a grid-in inside the pop-up", () => {
  function gridInput(): HTMLInputElement {
    const el = popup()!.querySelector('input[type="text"]');
    if (!el) throw new Error("no grid-in input in the pop-up");
    return el as HTMLInputElement;
  }

  async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  async function openFirstGridIn() {
    getQuestions.mockResolvedValue(GRID_QUESTIONS);
    serveAnalysis({ ...ASSESSMENT_PAYLOAD, questions: [] }, { homework: homework(), papers: [GRID_PAPER] });
    await mountBlock();
    await click(host.querySelector('[data-missed-row="p-9101"]')!);
  }

  it("leaves Left and Right to the caret while the teacher is typing", async () => {
    await openFirstGridIn();
    const input = gridInput();
    await type(input, "25/7");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flush();

    // Still on the same question, and what they typed is still in the box.
    expect(popupText()).toContain("Most missed · 1 of 2");
    expect(gridInput().value).toBe("25/7");
  });

  it("still walks the list from a key press outside the answer", async () => {
    await openFirstGridIn();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flush();

    expect(popupText()).toContain("Most missed · 2 of 2");
  });

  /**
   * `NumericInput` is uncontrolled and only adopts an external value when it differs from what
   * it last committed. `1.` is a transient token, so nothing is ever committed — and without a
   * remount per question the next question opens with the previous one's half-typed answer
   * sitting in the box.
   */
  it("does not carry a half-typed answer to the next question", async () => {
    await openFirstGridIn();
    await type(gridInput(), "1.");

    await click(buttonWith("Next", popup()!));
    expect(popupText()).toContain("Most missed · 2 of 2");
    expect(gridInput().value).toBe("");
  });
});
