/**
 * The module editor's frame (PR 14a): the outline's rows and their dots, ⌥↑ / ⌥↓ reordering with the
 * same single save a drag makes, and a full module refusing another question. The question pane (PR 14b):
 * the answer key's card follows the Correct answer field, and Save sends what it always sent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminModuleQuestion } from "../types";

const reorder = vi.fn();
const create = vi.fn();
const update = vi.fn();
let questions: AdminModuleQuestion[] = [];

const idle = { isPending: false, isError: false, error: null };

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me: { role: "test_admin" } }) }));
vi.mock("@/components/FormulaToolbar", () => ({ FormulaToolbar: () => null }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("@/features/questionsAdmin/skillTaxonomy", () => ({
  bankSubjectForQuestionType: () => "MATH",
  useSkillTaxonomyQuery: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/features/questionsAdmin/hooks", () => ({
  examsModuleQuestionsApi: { source: "exams", exportCsv: vi.fn() },
  useModuleQuestionsQuery: () => ({ data: questions, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false }),
  useCreateModuleQuestion: () => ({ ...idle, mutateAsync: create }),
  useReorderModuleQuestionsBulk: () => ({ ...idle, mutateAsync: reorder }),
  useImportModuleQuestionsCsv: () => ({ ...idle, mutateAsync: vi.fn() }),
  useUpdateModuleQuestion: () => ({ ...idle, mutateAsync: update }),
  useDeleteModuleQuestion: () => ({ ...idle, mutateAsync: vi.fn() }),
}));

const { default: ModuleQuestionsPanel } = await import("../ModuleQuestionsPanel");

function question(id: number, over: Partial<AdminModuleQuestion> = {}): AdminModuleQuestion {
  return {
    id,
    order: id - 1,
    question_text: `If x + ${id} = ${id + 2}, what is x?`,
    question_prompt: "",
    question_type: "MATH",
    is_math_input: false,
    option_a: "1",
    option_b: "2",
    option_c: "3",
    option_d: "4",
    correct_answer: "B",
    explanation: "",
    score: 10,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function render(props: Partial<React.ComponentProps<typeof ModuleQuestionsPanel>> = {}) {
  await act(async () => {
    root.render(<ModuleQuestionsPanel testId={7} moduleId={70} sectionSubject="MATH" moduleOrder="Module 1" {...props} />);
  });
}

const row = (id: number) => host.querySelector<HTMLButtonElement>(`button[data-qid="${id}"]`)!;
const rowIds = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button[data-qid]")).map((b) => Number(b.dataset.qid));

async function press(el: HTMLElement, key: string, altKey = true) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, altKey, bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reorder.mockReset().mockResolvedValue(undefined);
  update.mockReset().mockImplementation(async ({ questionId }: { questionId: number }) => questions.find((q) => q.id === questionId));
  create.mockReset();
  questions = [question(1), question(2), question(3)];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the module editor's outline", () => {
  it("draws one row per question with a dot that says whether it is ready", async () => {
    questions = [
      question(1),
      question(2, { correct_answer: "  " }),
      question(3, { question_text: "" }),
      question(4, { question_type: "READING" }),
    ];
    await render();
    expect(rowIds()).toEqual([1, 2, 3, 4]);
    expect(row(1).textContent).toContain("Q1");
    expect(row(1).textContent).toContain("ready");
    expect(row(2).textContent).toContain("no answer key");
    expect(row(3).textContent).toContain("No text yet");
    expect(row(3).textContent).toContain("needs a look");
    // A Reading question in a Math module: the wrong type for this section.
    expect(row(4).textContent).toContain("needs a look");
    expect(row(4).querySelector('[aria-label="Wrong question type for this section"]')).not.toBeNull();
    expect(host.textContent).toContain("move a question");
  });

  it("opens the first question and marks it as the current one", async () => {
    await render();
    expect(row(1).getAttribute("aria-current")).toBe("true");
    expect(row(2).getAttribute("aria-current")).toBeNull();
  });

  it("moves a question one place with ⌥↓, saves the new order once, and keeps the focus on it", async () => {
    await render();
    act(() => row(1).focus());
    await press(row(1), "ArrowDown");
    expect(rowIds()).toEqual([2, 1, 3]);
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith([2, 1, 3]);
    expect(document.activeElement).toBe(row(1));
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe("Q1 moved to position 2 of 3.");
  });

  it("moves up with ⌥↑, and does nothing past either end or without ⌥", async () => {
    await render();
    await press(row(3), "ArrowUp");
    expect(reorder).toHaveBeenLastCalledWith([1, 3, 2]);
    reorder.mockClear();
    await press(row(1), "ArrowUp");
    await press(row(2), "ArrowDown");
    await press(row(1), "ArrowDown", false);
    expect(reorder).not.toHaveBeenCalled();
  });
});

describe("the module editor's top bar", () => {
  it("names the test, the subject and the module, with the count against the module's size", async () => {
    await render({ packTitle: "Algebra focus" });
    const bar = host.querySelector("header")!;
    expect(bar.textContent).toContain("Past papers");
    expect(bar.textContent).toContain("Algebra focus");
    expect(bar.textContent).toContain("Mathematics");
    expect(host.querySelector("h1")!.textContent).toBe("Module 1");
    expect(bar.textContent).toContain("3 / 22 questions");
  });

  it("refuses another question once the module is full", async () => {
    questions = Array.from({ length: 22 }, (_, i) => question(i + 1));
    await render();
    const bar = host.querySelector("header")!;
    expect(bar.textContent).toContain("Module full (22/22)");
    const add = Array.from(bar.querySelectorAll("button")).find((b) => b.textContent?.includes("Add question"))!;
    expect(add.disabled).toBe(true);
  });
});

/** Type into a controlled field the way React hears it. */
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const button = (words: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

describe("the question pane", () => {
  it("puts the type, the weight and the skill under Properties", async () => {
    await render();
    const props = host.querySelector('aside[aria-label="Properties"]')!;
    expect(props.textContent).toContain("Question type");
    expect(props.textContent).toContain("Score weight");
    expect(props.textContent).toContain("Student types numeric answer (no A/B/C/D choices)");
    expect(props.textContent).toContain("SAT skill (optional)");
  });

  it("marks the answer key's choice, and moves the mark as the Correct answer changes", async () => {
    await render();
    expect(host.textContent).toContain("Answer key · B");
    await typeInto(host.querySelector<HTMLInputElement>("#q1-answer")!, "d");
    expect(host.textContent).not.toContain("Answer key · B");
    expect(host.textContent).toContain("Answer key · D");
  });

  it("saves the same fields it always sent", async () => {
    await render();
    await typeInto(host.querySelector<HTMLTextAreaElement>("#q1-stem")!, "If x + 1 = 4, what is x?");
    await click(button("Save question"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      questionId: 1,
      data: {
        question_type: "MATH",
        question_text: "If x + 1 = 4, what is x?",
        question_prompt: "",
        is_math_input: false,
        option_a: "1",
        option_b: "2",
        option_c: "3",
        option_d: "4",
        correct_answer: "B",
        explanation: "",
        score: 10,
        skill: null,
      },
    });
    expect(host.textContent).toContain("Saved");
  });

  it("keeps a midterm's True / False controls and saves them as before", async () => {
    questions = [question(1, { option_a: "True", option_b: "False", option_c: "", option_d: "", correct_answer: "A" })];
    await render({ examKind: "MIDTERM", sectionSubject: "MATH" });
    expect(host.textContent).toContain("Answer choices (True / False)");
    expect(host.querySelector('aside[aria-label="Properties"]')!.textContent).toContain("Answer format");
    const falseButton = host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    expect(falseButton.textContent).toBe("False");
    await click(falseButton);
    expect(falseButton.getAttribute("aria-pressed")).toBe("true");
    await click(button("Save question"));
    expect(update.mock.calls[0][0].data).toMatchObject({ option_a: "True", option_b: "False", correct_answer: "B", is_math_input: false });
  });

  it("asks before deleting, inline", async () => {
    await render();
    await click(button("Delete"));
    expect(host.textContent).toContain("Delete this question?");
    await click(button("Cancel"));
    expect(host.textContent).not.toContain("Delete this question?");
  });
});
