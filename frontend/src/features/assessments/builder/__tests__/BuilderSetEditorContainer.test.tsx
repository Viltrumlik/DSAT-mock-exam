/**
 * The set editor's frame (PR 17b): the top bar and its review status, ⌥↓ saving the MOVED order (until 17b a
 * drag sent the unchanged one), delete with a 409 → "Delete anyway" sending force, the save menu, and Set
 * metadata saving the same fields. The question form and the preview are stubbed (they are 17c).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssessmentQuestion, AssessmentSet } from "@/features/assessments/types";

const getSet = vi.fn();
const reorderQuestions = vi.fn();
const deleteQuestion = vi.fn();
const setReviewStatus = vi.fn();
const upsertSet = vi.fn();
const toast = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "9" }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/lib/permissions", () => ({ getRole: () => "admin", getSubject: () => null }));
vi.mock("@/features/assessmentsAdmin/api", () => ({
  assessmentsAdminApi: {
    reorderQuestions: (...a: unknown[]) => reorderQuestions(...a),
    appendQuestionsCsv: vi.fn(),
    exportQuestionsCsv: vi.fn(),
    addQuestionFromBank: vi.fn(),
  },
}));
vi.mock("@/features/assessments/hooks", async (importOriginal) => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  // The store's validateSetClientSide lives here too: keep the real exports, swap the server hooks.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAssessmentSetsList: () => useQuery({ queryKey: ["list"], queryFn: async () => ({ results: [] }) }),
    useAssessmentSetDetail: (id: number) => useQuery({ queryKey: ["set", id], queryFn: () => getSet(id) }),
    useUpsertAssessmentQuestion: () => useMutation({ mutationFn: async () => ({}) }),
    useDeleteAssessmentQuestion: () =>
      useMutation({
        mutationFn: (v: number | { questionId: number; force?: boolean }) =>
          typeof v === "number" ? deleteQuestion(v, false) : deleteQuestion(v.questionId, Boolean(v.force)),
      }),
    useSetReviewStatus: () => useMutation({ mutationFn: (x: { id: number; status: string }) => setReviewStatus(x.id, x.status) }),
    useUpsertAssessmentSet: () => useMutation({ mutationFn: (x: { id: number; payload: unknown }) => upsertSet(x) }),
  };
});
// The panes' insides are 17c.
vi.mock("@/features/assessments/components/AssessmentQuestionEditorFields", () => ({ AssessmentQuestionEditorFields: () => <div data-fields /> }));
vi.mock("@/features/assessments/builder/SATQuestionPreview", () => ({ SATQuestionPreview: () => null }));
vi.mock("@/features/assessments/builder/QuestionBankPickerModal", () => ({ QuestionBankPickerModal: () => null }));
vi.mock("@/components/FormulaToolbar", () => ({ FormulaToolbar: () => null }));
vi.mock("@/features/questionsAdmin/DownloadQuestionsCsvButton", () => ({ DownloadQuestionsCsvButton: () => null }));

const { default: Editor } = await import("../BuilderSetEditorContainer");
const { useBuilderStore } = await import("../store");

function question(id: number, order: number, prompt: string): AssessmentQuestion {
  return {
    id,
    order,
    prompt,
    question_prompt: "",
    question_type: "multiple_choice",
    choices: [
      { id: "A", text: "1" },
      { id: "B", text: "2" },
    ],
    correct_answer: "A",
    grading_config: {},
    points: 1,
    is_active: true,
    explanation: "",
  } as unknown as AssessmentQuestion;
}

const SET: AssessmentSet = {
  id: 9,
  subject: "math",
  source: "MATHBOOK",
  level: "junior",
  secondary_level: "middle",
  category: "Algebra · Systems of linear equations",
  title: "Systems of Equations",
  description: "Unit 3",
  is_active: true,
  review_status: "approved",
  updated_at: "2026-11-01T10:00:00+05:00",
  questions: [question(42, 0, "First question"), question(43, 1, "Second question"), question(44, 2, "Third question")],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Editor />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const buttonWith = (words: string, within: ParentNode = document) =>
  Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const rowOf = (qid: number) => host.querySelector<HTMLElement>(`[data-qid="${qid}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [getSet, reorderQuestions, deleteQuestion, setReviewStatus, upsertSet, toast]) f.mockReset();
  useBuilderStore.setState({ selectedQuestionId: null, past: [], future: [] });
  getSet.mockResolvedValue(SET);
  reorderQuestions.mockResolvedValue([43, 42, 44]);
  deleteQuestion.mockResolvedValue(undefined);
  setReviewStatus.mockResolvedValue({});
  upsertSet.mockResolvedValue(SET);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the top bar", () => {
  it("names the set, its review status and state, and how many questions it has", async () => {
    await render();
    const header = host.querySelector("header")!;
    expect(header.querySelector("h1")!.textContent).toBe("Systems of Equations");
    expect(header.textContent).toContain("#9");
    expect(header.textContent).toContain("Approved");
    expect(header.textContent).toContain("Published");
    expect(header.textContent).toContain("math · Algebra · Systems of linear equations · 3 questions");
    expect(header.textContent).not.toContain("Unsaved");
    expect(host.textContent).toContain("Published set.");
  });

  it("changes the review status with the same call", async () => {
    await render();
    await click(byLabel("Review status"));
    const needs = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.startsWith("Needs review"))!;
    await click(needs);
    expect(setReviewStatus).toHaveBeenCalledWith(9, "needs_review");
  });
});

describe("the outline", () => {
  it("lists the questions in order with their numbers", async () => {
    await render();
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-qid]"));
    expect(rows.map((r) => r.dataset.qid)).toEqual(["42", "43", "44"]);
    expect(rows[1].textContent).toContain("Q2");
    expect(rows[1].textContent).toContain("Second question");
  });

  it("moves a question with ⌥↓ and saves the MOVED order", async () => {
    await render();
    const q1 = rowOf(42).querySelector<HTMLButtonElement>("button[aria-keyshortcuts]")!;
    await act(async () => {
      q1.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    });
    await settle();
    expect(reorderQuestions).toHaveBeenCalledWith(9, [43, 42, 44]);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Order saved." });
  });

  it("deletes after Yes; a 409 asks in the console dialog and sends force", async () => {
    deleteQuestion.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Has answers." } } });
    await render();
    await click(rowOf(43).querySelector('button[aria-label="Delete question 2"]')!);
    await click(buttonWith("Yes", rowOf(43)));
    expect(deleteQuestion).toHaveBeenCalledWith(43, false);
    expect(document.body.textContent).toContain("Delete Q2 anyway?");
    expect(document.body.textContent).toContain("This question already has student answers.");
    await click(buttonWith("Delete anyway"));
    expect(deleteQuestion).toHaveBeenLastCalledWith(43, true);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Deleted." });
  });
});

describe("saving", () => {
  it("picks what happens after a save from the menu beside Save", async () => {
    await render();
    expect(buttonWith("Create")).toBeTruthy();
    await click(byLabel("Save options"));
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((m) => m.textContent?.includes("Save & next →"))!);
    expect(buttonWith("Save & Next")).toBeTruthy();
  });

  it("saves the set's metadata with the same fields, and says Unsaved while edited", async () => {
    await render();
    await click(buttonWith("Set metadata"));
    const title = document.getElementById(
      Array.from(host.querySelectorAll("label")).find((l) => l.textContent === "Title")!.htmlFor,
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Systems of Equations — HW 3");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector("header")!.textContent).toContain("Unsaved");
    await click(buttonWith("Save metadata"));
    expect(upsertSet).toHaveBeenCalledWith({
      id: 9,
      payload: {
        title: "Systems of Equations — HW 3",
        category: "Algebra · Systems of linear equations",
        description: "Unit 3",
        source: "MATHBOOK",
        level: "junior",
        secondary_level: "middle",
      },
    });
  });
});
