/**
 * Instant checking, on both places a teacher works a question.
 *
 * The owner asked for one behaviour and it has to hold identically in two very different
 * hosts — the past-paper reader (a teacher-kit card, questions off the exams admin endpoint)
 * and the assessment practice runner (a full-screen white sheet, questions off the assessments
 * admin endpoint). So the cases below are written once and run against each: nothing to press
 * before an answer exists, nothing revealed before it is pressed, the key and the solution when
 * it is, an honest line when no solution was ever written, and the whole thing repeatable when
 * the teacher changes their mind.
 *
 * The last case is the one that would cost real money if it broke: checking must reach the
 * server for NOTHING. A teacher leafing through a live paper cannot be allowed to open an
 * attempt, save a draft or touch a score, so every api function these pages can see is a spy
 * and the writes among them are asserted never called.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ── Reads, and every write these two pages could possibly reach for ──────────────
const getPastpaperSection = vi.fn();
const getPastpaperSections = vi.fn();
const getQuestions = vi.fn();
const adminGetSet = vi.fn();

const writes = {
  createQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  adminUpdateSet: vi.fn(),
  adminDeleteSet: vi.fn(),
  startAttempt: vi.fn(),
  submitAnswer: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  default: { post: writes.post, put: writes.put, patch: writes.patch, delete: writes.delete, get: vi.fn() },
  getCachedCsrfToken: () => null,
  classesApi: {},
  examsPublicApi: {
    getPastpaperSections: () => getPastpaperSections(),
    getPastpaperSection: (id: number) => getPastpaperSection(id),
  },
  examsAdminApi: {
    getQuestions: (testId: number, moduleId: number) => getQuestions(testId, moduleId),
    createQuestion: writes.createQuestion,
    updateQuestion: writes.updateQuestion,
    deleteQuestion: writes.deleteQuestion,
  },
  assessmentsAdminApi: {
    adminGetSet: (id: number) => adminGetSet(id),
    adminUpdateSet: writes.adminUpdateSet,
    adminDeleteSet: writes.adminDeleteSet,
  },
  assessmentsApi: { startAttempt: writes.startAttempt, submitAnswer: writes.submitAnswer },
}));

vi.mock("@/components/AuthGuard", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/testing-simulation/tools/calculator/DesmosCalculator", () => ({
  DesmosCalculator: () => null,
}));

const push = vi.fn();
let routeParams: Record<string, string> = { setId: "7" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => routeParams,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { answerKeyFromAssessmentQuestion, judgeAnswer, EMPTY_ANSWER_KEY } = await import("../questionWork");
const { TeacherPaper } = await import("../pastpapers/TeacherPaper");
const TeacherAssessmentPracticePage = (
  await import("@/app/(teacher)/teacher/assessments/[setId]/practice/page")
).default;

// ── Fixtures ────────────────────────────────────────────────────────────────────
const SECTION = {
  id: 41, title: "", practice_date: "2025-10-04", subject: "READING_WRITING", label: "A",
  form_type: "INTERNATIONAL", collection_name: "October 2025 Int. A", is_published: true,
  modules: [{ id: 411, module_order: 1 }],
};

const PAPER_QUESTIONS = [
  {
    id: 9001, order: 1,
    question_text: "Scientists tracked the colony for a decade.",
    question_prompt: "Which choice best states the purpose of the passage?",
    question_type: "READING", is_math_input: false,
    option_a: "To record a steady rise", option_b: "To dispute an old estimate",
    option_c: "To describe a method", option_d: "To praise a researcher",
    correct_answer: "B", explanation: "The passage sets up a disagreement.", score: 1,
  },
  {
    id: 9002, order: 2,
    question_text: "The colony's range widened each spring.",
    question_prompt: "Which choice completes the text?",
    question_type: "READING", is_math_input: false,
    option_a: "nevertheless", option_b: "therefore", option_c: "however", option_d: "moreover",
    // The 285 questions the backfill has not reached: a real answer, no solution written.
    correct_answer: "D", explanation: "", score: 1,
  },
  {
    // A grid-in, keyed the way the model documents it: ONE comma-separated list of variants,
    // every one of which the student runner accepts (exams.Question.check_answer splits on ",").
    id: 9003, order: 3,
    question_text: "Two of every three sampled birds were banded.",
    question_prompt: "What fraction of the sample was banded?",
    question_type: "MATH", is_math_input: true,
    option_a: "", option_b: "", option_c: "", option_d: "",
    correct_answer: "2/3, 0.666, 0.667", explanation: "Two of three.", score: 1,
  },
  {
    // A question nobody keyed. It is not the teacher's answer that is at fault here.
    id: 9004, order: 4,
    question_text: "The survey ran for six seasons.",
    question_prompt: "Which choice completes the text?",
    question_type: "READING", is_math_input: false,
    option_a: "briefly", option_b: "annually", option_c: "rarely", option_d: "twice",
    correct_answer: "", explanation: "", score: 1,
  },
];

const ASSESSMENT_SET = {
  id: 7, title: "Linear functions, set 4", subject: "math", level: "junior",
  questions: [
    {
      id: 501, order: 1, question_type: "multiple_choice", is_active: true, points: 1,
      prompt: "A line passes through (0, 3) and (2, 7).",
      question_prompt: "What is its slope?",
      choices: [
        { id: "A", text: "1" }, { id: "B", text: "2" },
        { id: "C", text: "3" }, { id: "D", text: "4" },
      ],
      correct_answer: "B",
      explanation: "Rise over run: four over two.",
    },
    {
      id: 502, order: 2, question_type: "multiple_choice", is_active: true, points: 1,
      prompt: "The same line is shifted up by five.",
      question_prompt: "What is the new intercept?",
      choices: [
        { id: "A", text: "three" }, { id: "B", text: "five" },
        { id: "C", text: "eight" }, { id: "D", text: "ten" },
      ],
      correct_answer: "C",
      explanation: "",
    },
    {
      // A numeric question keyed with a LIST of accepted values — the shape the exams side
      // spells as one comma-separated string, and the reason there are two adapters.
      id: 503, order: 3, question_type: "numeric", is_active: true, points: 1,
      prompt: "A second line falls one unit for every two it runs.",
      question_prompt: "What is its slope's magnitude?",
      choices: [],
      correct_answer: ["0.5", "1/2"],
      explanation: "One over two.",
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  routeParams = { setId: "7" };
  [getPastpaperSection, getPastpaperSections, getQuestions, adminGetSet, push].forEach((f) => f.mockReset());
  Object.values(writes).forEach((f) => f.mockReset());

  getPastpaperSection.mockResolvedValue(SECTION);
  getQuestions.mockResolvedValue(PAPER_QUESTIONS);
  adminGetSet.mockResolvedValue(ASSESSMENT_SET);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await flush();
  await flush();
}

const text = () => host.textContent ?? "";
const buttons = () => [...host.querySelectorAll("button")];
const checkButton = () => buttons().find((b) => (b.textContent ?? "").trim() === "Check");
const explanationPane = () => host.querySelector('[aria-label="Explanation"]');
/** The verdict badge itself. Its TEXT cannot be searched for: "Correct answer" contains it. */
const verdict = () => host.querySelector("[data-verdict]")?.getAttribute("data-verdict") ?? null;
const gridInField = () => host.querySelector<HTMLInputElement>('input[placeholder^="Number or fraction"]');

/**
 * Type into the grid-in field. NumericInput is UNCONTROLLED by design, so React only learns
 * about a value through a real input event with the native setter used — assigning `.value`
 * alone is invisible to it.
 */
async function typeGridIn(value: string) {
  const el = gridInField();
  expect(el, "no grid-in field on this question").toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function click(el: Element | undefined) {
  expect(el, "the element this case needs is not on the page").toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}

/** The choice button carrying this option's text — the one a teacher clicks to answer. */
function choice(label: string) {
  return buttons().find((b) => (b.textContent ?? "").includes(label));
}

function expectNoWrites() {
  Object.entries(writes).forEach(([name, fn]) => {
    expect(fn, `${name} was called — checking must write nowhere`).not.toHaveBeenCalled();
  });
}

// ── The two hosts, driven the same way ──────────────────────────────────────────
const HOSTS = [
  {
    name: "a past paper",
    mount: () => mount(<TeacherPaper paperId={41} />),
    answered: "To dispute an old estimate",
    otherAnswer: "To describe a method",
    correctLabel: "B. To dispute an old estimate",
    explanation: "The passage sets up a disagreement.",
    /** The second question — a real key, but no solution written for it. */
    goToUnexplained: async () => click(buttons().find((b) => b.getAttribute("aria-label") === "Module 1, question 2")),
    unexplainedAnswer: "moreover",
  },
  {
    name: "an assessment in practice",
    mount: () => mount(<TeacherAssessmentPracticePage />),
    answered: "2",
    otherAnswer: "3",
    correctLabel: "B. 2",
    explanation: "Rise over run: four over two.",
    goToUnexplained: async () => click(buttons().find((b) => b.getAttribute("aria-label") === "Go to question 2")),
    unexplainedAnswer: "eight",
  },
];

describe.each(HOSTS)("checking a question — $name", (h) => {
  it("offers nothing to press until the question is answered", async () => {
    await h.mount();

    expect(checkButton()).toBeUndefined();
    expect(text()).not.toContain(h.correctLabel);
    expect(text()).not.toContain(h.explanation);
  });

  it("shows the Check button once an answer is there, and still gives nothing away", async () => {
    await h.mount();
    await click(choice(h.answered));

    expect(checkButton()).toBeTruthy();
    // The column exists and says what it is for — and holds no key and no solution.
    const pane = explanationPane();
    expect(pane).toBeTruthy();
    expect(pane!.textContent).toContain("press Check");
    expect(pane!.textContent).not.toContain(h.explanation);
    expect(pane!.textContent).not.toContain("Correct answer");
  });

  it("reveals the verdict, the correct option and the explanation when Check is pressed", async () => {
    await h.mount();
    await click(choice(h.answered));
    await click(checkButton());

    const pane = explanationPane()!;
    expect(verdict()).toBe("correct");
    expect(pane.textContent).toContain("Correct answer");
    expect(pane.textContent).toContain(h.correctLabel);
    expect(pane.textContent).toContain(h.explanation);
    // A right answer is never also told it is not right.
    expect(pane.textContent).not.toContain("Not correct yet");
  });

  it("names a wrong answer without punishing it, and still gives the right one", async () => {
    await h.mount();
    await click(choice(h.otherAnswer));
    await click(checkButton());

    const pane = explanationPane()!;
    expect(verdict()).toBe("incorrect");
    expect(pane.textContent).toContain("Not correct yet");
    expect(pane.textContent).not.toContain("Wrong");
    expect(pane.textContent).toContain(h.correctLabel);
  });

  it("hides the key again when the answer changes, and checks the new one", async () => {
    await h.mount();
    await click(choice(h.otherAnswer));
    await click(checkButton());
    expect(explanationPane()!.textContent).toContain("Not correct yet");

    // The teacher changes their mind. The reveal belonged to the old answer, so it goes.
    await click(choice(h.answered));
    let pane = explanationPane()!;
    expect(verdict()).toBeNull();
    expect(pane.textContent).not.toContain("Not correct yet");
    expect(pane.textContent).not.toContain(h.explanation);
    expect(pane.textContent).toContain("press Check");

    // And Check is still there to press a second time — nothing locked.
    await click(checkButton());
    pane = explanationPane()!;
    expect(verdict()).toBe("correct");
    expect(pane.textContent).toContain(h.explanation);
  });

  it("says a question has no explanation rather than drawing an empty panel", async () => {
    await h.mount();
    await h.goToUnexplained();
    await click(choice(h.unexplainedAnswer));
    await click(checkButton());

    const pane = explanationPane()!;
    expect(pane.textContent).toContain("No explanation written for this question yet");
    // The key it DOES have is still shown — a missing solution is not a missing answer.
    expect(pane.textContent).toContain("Correct answer");
  });

  it("is a real button a keyboard can reach", async () => {
    await h.mount();
    await click(choice(h.answered));

    const btn = checkButton()!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.hasAttribute("disabled")).toBe(false);
    // Nothing has pushed it out of tab order.
    expect(btn.getAttribute("tabindex")).not.toBe("-1");
  });

  it("writes nothing to the server, at any point", async () => {
    await h.mount();
    await click(choice(h.otherAnswer));
    await click(checkButton());
    await click(choice(h.answered));
    await click(checkButton());
    await h.goToUnexplained();
    await click(choice(h.unexplainedAnswer));
    await click(checkButton());

    expectNoWrites();
  });
});

/**
 * The verdict has to agree with the grader the student's own attempt is scored by. A Check
 * that calls a right answer wrong is worse than no Check button at all — a teacher would go
 * and "fix" a question that was never broken. These cases are the two graders' rules, read
 * back: exams.Question.check_answer (comma-separated variants, numeric within 0.0001, simple
 * a/b fractions) and assessments.grading.grade_answer (a LIST of accepted values, decimals).
 */
describe("the verdict agrees with the grader — a past-paper grid-in", () => {
  const goToGridIn = () => click(buttons().find((b) => b.getAttribute("aria-label") === "Module 1, question 3"));

  it("accepts any variant of the comma-separated key, and shows the teacher all of them", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await goToGridIn();
    await typeGridIn("0.667");
    await click(checkButton());

    const pane = explanationPane()!;
    expect(verdict(), "0.667 is one of the key's variants — the student runner marks it correct").toBe("correct");
    expect(pane.textContent).not.toContain("Not correct yet");
    // Every accepted variant, not just the one that matched: the teacher is reading a key.
    expect(pane.textContent).toContain("2/3, 0.666, 0.667");
  });

  it("accepts the fraction the key itself is written as", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await goToGridIn();
    await typeGridIn("2/3");
    await click(checkButton());

    expect(verdict()).toBe("correct");
  });

  it("accepts an equivalent fraction the key never spells", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await goToGridIn();
    // 4/6 appears nowhere in the key, and check_answer divides before it compares, so the
    // student runner takes it. Only a numeric comparison here agrees with that.
    await typeGridIn("4/6");
    await click(checkButton());

    expect(verdict()).toBe("correct");
  });

  it("accepts a decimal that is only within the grid-in tolerance", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await goToGridIn();
    // 0.6667 is not written in the key at all, but 0.667 is, and check_answer's tolerance is
    // 0.0001 — the paper this teacher is reading would mark it right.
    await typeGridIn("0.6667");
    await click(checkButton());

    expect(verdict()).toBe("correct");
  });

  it("still says a genuinely different number is not correct yet", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await goToGridIn();
    await typeGridIn("0.9");
    await click(checkButton());

    expect(verdict()).toBe("incorrect");
    expect(explanationPane()!.textContent).toContain("Not correct yet");
  });
});

describe("the verdict agrees with the grader — an assessment numeric question", () => {
  const goToNumeric = () => click(buttons().find((b) => b.getAttribute("aria-label") === "Go to question 3"));

  it("accepts either value of a key that lists several", async () => {
    await mount(<TeacherAssessmentPracticePage />);
    await goToNumeric();
    await typeGridIn("0.5");
    await click(checkButton());

    expect(verdict()).toBe("correct");
    expect(explanationPane()!.textContent).not.toContain("Not correct yet");
  });

  it("accepts the fraction spelling of the same value", async () => {
    await mount(<TeacherAssessmentPracticePage />);
    await goToNumeric();
    await typeGridIn("1/2");
    await click(checkButton());

    expect(verdict()).toBe("correct");
  });

  it("accepts an equivalent fraction that is in neither list entry", async () => {
    await mount(<TeacherAssessmentPracticePage />);
    await goToNumeric();
    // grade_answer parses both sides as decimals, so 2/4 scores exactly as 0.5 does.
    await typeGridIn("2/4");
    await click(checkButton());

    expect(verdict()).toBe("correct");
  });

  it("says a different value is not correct yet", async () => {
    await mount(<TeacherAssessmentPracticePage />);
    await goToNumeric();
    await typeGridIn("0.75");
    await click(checkButton());

    expect(verdict()).toBe("incorrect");
  });
});

describe("a question nobody keyed", () => {
  it("says the question has no key rather than judging the teacher's answer", async () => {
    await mount(<TeacherPaper paperId={41} />);
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Module 1, question 4"));
    await click(choice("annually"));
    await click(checkButton());

    const pane = explanationPane()!;
    expect(pane.textContent).toContain("No answer key is recorded for this question yet");
    // Neither verdict: an unjudgeable answer is not a wrong one.
    expect(verdict()).toBeNull();
    expect(pane.textContent).not.toContain("Not correct yet");
    expect(pane.textContent).not.toContain("Correct answer");
    // And not the em dash normalize.ts writes for "no answer recorded" — that sentinel is a
    // placeholder for a reader, never a key to hold a teacher's answer against.
    expect(pane.textContent).not.toContain("—");
  });
});

/**
 * Two of the graders' rules cannot be reached through an input — NumericInput canonicalizes a
 * decimal before it commits it, and the boolean input only ever emits its own two words. They
 * are still rules a teacher's answer is judged by, so they are checked against the adapters
 * and the judge directly.
 */
describe("the verdict agrees with the grader — the rules an input cannot type", () => {
  const numericQuestion = (extra: Record<string, unknown>) =>
    answerKeyFromAssessmentQuestion({
      id: 1, assessment_set: 1, order: 1, prompt: "", question_type: "numeric",
      choices: [], points: 1, is_active: true, ...extra,
    } as never);

  it("honours the set author's tolerance", async () => {
    const key = numericQuestion({ correct_answer: "10", grading_config: { tolerance: "0.5" } });

    expect(judgeAnswer("10.4", key), "inside the author's tolerance").toBe("correct");
    expect(judgeAnswer("11", key), "outside it").toBe("incorrect");
  });

  it("compares exactly when the author set no tolerance", async () => {
    const key = numericQuestion({ correct_answer: "10" });

    expect(judgeAnswer("10.000", key)).toBe("correct");
    expect(judgeAnswer("10.4", key)).toBe("incorrect");
  });

  it("reads the boolean words the grader reads", async () => {
    const key = answerKeyFromAssessmentQuestion({
      id: 2, assessment_set: 1, order: 2, prompt: "", question_type: "boolean",
      choices: [], points: 1, is_active: true, correct_answer: "true",
    } as never);

    // grade_answer's _to_bool takes any of true/t/1/yes/y for the same answer.
    expect(judgeAnswer("yes", key)).toBe("correct");
    expect(judgeAnswer("Y", key)).toBe("correct");
    expect(judgeAnswer("no", key)).toBe("incorrect");
    // Not a boolean word at all — not correct, and never mistaken for one.
    expect(judgeAnswer("maybe", key)).toBe("incorrect");
  });

  it("returns unknown rather than a verdict when there is nothing to judge against", async () => {
    const key = numericQuestion({ correct_answer: "" });

    expect(judgeAnswer("4", key)).toBe("unknown");
    expect(judgeAnswer(null, EMPTY_ANSWER_KEY)).toBe("unknown");
  });
});

describe("the teacher's reassurance", () => {
  it("says on screen that checking saves nothing", async () => {
    await mount(<TeacherPaper paperId={41} />);
    expect(text()).toContain("checking saves nothing and starts no attempt");
  });
});
