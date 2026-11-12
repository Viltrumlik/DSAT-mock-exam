/**
 * Builder Midterms (PR 18): the subject → level drill-down with its counts and Untagged, New midterm only inside
 * a level with the bucket's subject + level and the same payload, the type / period chips, Publish / Add / Remove
 * version / Delete calling the same API, and Results opening a student's wrong answers.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  getMockExams: vi.fn(),
  createMockExam: vi.fn(),
  updateMockExam: vi.fn(),
  deleteMockExam: vi.fn(),
  addMidtermVersion: vi.fn(),
  removeMidtermVersion: vi.fn(),
  publishMockExam: vi.fn(),
  unpublishMockExam: vi.fn(),
  getMidtermResults: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/examsAdmin/api", () => ({
  examsAdminApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

type Over = Record<string, unknown>;
function midterm(id: number, over: Over = {}) {
  return {
    id,
    title: `Midterm ${id}`,
    practice_date: "2026-11-20",
    is_active: true,
    is_published: false,
    published_at: null,
    kind: "MIDTERM",
    midterm_subject: "MATH",
    midterm_scoring_scale: "SCALE_100",
    midterm_module_count: 2,
    midterm_module1_minutes: 40,
    midterm_module2_minutes: 40,
    midterm_two_module_runtime: true,
    midterm_target_question_count: 44,
    midterm_module_question_limit: 30,
    midterm_level: "junior",
    midterm_period: "FIRST_MONTH",
    midterm_type: "MIDTERM",
    midterm_pass_mark: null,
    midterm_retake_of: null,
    tests: [{ id: id * 10, subject: "MATH", modules: [{ id: id * 100 + 1, module_order: 1, time_limit_minutes: 32 }, { id: id * 100 + 2, module_order: 2, time_limit_minutes: 32 }] }],
    publish_ready: true,
    publish_block_reason: "",
    ...over,
  };
}

const ALL = [
  midterm(1, { is_published: true }),
  midterm(2, { midterm_type: "RETAKE", midterm_period: "SECOND_MONTH", publish_ready: false, publish_block_reason: "Version A, module 2 has no questions." }),
  midterm(3, { midterm_level: "middle" }),
  midterm(4, { midterm_level: "" }),
  midterm(5, { midterm_subject: "READING_WRITING" }),
  { id: 9, kind: "MOCK_SAT", title: "Not a midterm" },
];

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
  await act(async () => {
    root.render(<Page />);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const cards = () => Array.from(host.querySelectorAll<HTMLElement>("article[data-midterm]"));
const card = (id: number) => host.querySelector<HTMLElement>(`article[data-midterm="${id}"]`)!;

async function openMathJunior() {
  await render();
  await click(buttonIn(host, "Math"));
  await click(buttonIn(host, "Junior"));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.getMockExams.mockResolvedValue(ALL);
  for (const k of ["createMockExam", "updateMockExam", "deleteMockExam", "addMidtermVersion", "removeMidtermVersion", "publishMockExam", "unpublishMockExam"] as const) {
    api[k].mockResolvedValue({});
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the drill-down", () => {
  it("counts midterms by subject and level, with Untagged for the ones without a level", async () => {
    await render();
    expect(host.textContent).toContain("Midterms");
    expect(buttonIn(host, "English").textContent).toContain("1 midterm");
    expect(buttonIn(host, "Math").textContent).toContain("4 midterms");
    expect(host.querySelector('[aria-label="Subject and level"]')!.textContent).toBe("All subjects");
    // No New midterm until a level is open.
    expect(buttonIn(host, "New midterm")).toBeUndefined();

    await click(buttonIn(host, "Math"));
    expect(buttonIn(host, "Junior").textContent).toContain("2 midterms");
    expect(buttonIn(host, "Middle").textContent).toContain("1 midterm");
    expect(buttonIn(host, "Untagged").textContent).toContain("1 without a level");

    await click(buttonIn(host, "Junior"));
    expect(cards().map((c) => c.dataset.midterm)).toEqual(["1", "2"]);
    expect(host.querySelector('[aria-label="Subject and level"]')!.textContent).toBe("All subjectsMathJunior");
  });

  it("draws a card: its state, facts, versions and module links", async () => {
    await openMathJunior();
    const draft = card(2);
    expect(draft.textContent).toContain("Draft");
    expect(draft.textContent).toContain("Retake");
    expect(draft.textContent).toContain("Second month");
    expect(draft.textContent).toContain("40 + 40 min");
    expect(draft.textContent).toContain("44 target questions");
    expect(draft.textContent).toContain("2 modules created");
    expect(draft.textContent).toContain("Version A, module 2 has no questions.");
    expect(buttonIn(draft, "Publish").disabled).toBe(true);
    expect(draft.textContent).toContain("One version — everyone sits the same paper.");
    expect(draft.querySelector('a[href="/builder/midterms/2/20/202"]')!.textContent).toContain("Module 2");
    expect(draft.querySelector('a[href="/builder/midterms/2/20/202"]')!.textContent).toContain("40 min");
    expect(card(1).textContent).toContain("Published");
  });

  it("filters by type and period with the chips", async () => {
    await openMathJunior();
    const type = host.querySelector('[role="group"][aria-label="Type"]')!;
    expect(buttonIn(type, "Retake midterm").textContent).toContain("1");
    await click(buttonIn(type, "Retake midterm"));
    expect(cards().map((c) => c.dataset.midterm)).toEqual(["2"]);
    await click(buttonIn(host, "Clear"));
    await click(buttonIn(host.querySelector('[role="group"][aria-label="Period"]')!, "First month"));
    expect(cards().map((c) => c.dataset.midterm)).toEqual(["1"]);
  });
});

describe("creating a midterm", () => {
  it("fixes the bucket's subject and level and sends the same payload", async () => {
    await openMathJunior();
    await click(buttonIn(host, "New midterm"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("New midterm");
    // Subject and level are shown, not chosen.
    expect(dialog.textContent).toContain("Math");
    expect(dialog.textContent).toContain("Junior");
    const title = dialog.querySelector<HTMLInputElement>("input[required]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Unit 3 midterm");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const modules = Array.from(dialog.querySelectorAll<HTMLSelectElement>("select")).find((s) => s.querySelector('option[value="2"]'))!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(modules, "2");
      modules.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(dialog.textContent).toContain("Two sequential timed modules.");
    await click(buttonIn(dialog, "Save midterm"));
    expect(api.createMockExam).toHaveBeenCalledWith({
      title: "Unit 3 midterm",
      practice_date: null,
      kind: "MIDTERM",
      midterm_subject: "MATH",
      midterm_scoring_scale: "SCALE_100",
      midterm_module_count: 2,
      midterm_module1_minutes: 60,
      midterm_module2_minutes: 60,
      midterm_two_module_runtime: true,
      midterm_target_question_count: 44,
      midterm_module_question_limit: 30,
      midterm_level: "junior",
      midterm_period: "",
      midterm_type: "MIDTERM",
      midterm_pass_mark: null,
      midterm_retake_of: null,
    });
  });
});

describe("a card's actions", () => {
  it("publishes, adds and removes versions, and deletes after confirming", async () => {
    await openMathJunior();
    await click(buttonIn(card(1), "Unpublish"));
    expect(api.unpublishMockExam).toHaveBeenCalledWith(1);
    await click(buttonIn(card(2), "Add version"));
    expect(api.addMidtermVersion).toHaveBeenCalledWith(2);
    await click(buttonIn(card(2), "Delete"));
    expect(api.deleteMockExam).not.toHaveBeenCalled();
    await click(buttonIn(card(2), "Confirm delete"));
    expect(api.deleteMockExam).toHaveBeenCalledWith(2);
  });

  it("removes a version only when there are two or more", async () => {
    api.getMockExams.mockResolvedValue([
      midterm(1, { tests: [{ id: 10, subject: "MATH", modules: [] }, { id: 11, subject: "MATH", modules: [] }] }),
    ]);
    await openMathJunior();
    expect(card(1).textContent).toContain("2 versions — enough to separate desk partners");
    expect(card(1).textContent).toContain("Add version (2/4)");
    const versionB = card(1).querySelector('section[aria-label="Version B"]')!;
    await click(buttonIn(versionB, "Remove"));
    expect(api.removeMidtermVersion).toHaveBeenCalledWith(1, 11);
  });

  it("shows a student's wrong answers in Results", async () => {
    api.getMidtermResults.mockResolvedValue({
      students: [
        {
          attempt_id: 71,
          student_id: 5,
          student_username: "aziza",
          student_name: "Aziza Karimova",
          score: 82,
          max_score: 100,
          total_questions: 44,
          correct_count: 36,
          wrong_count: 8,
          wrong_questions: [{ question_id: 900, module_order: 1, prompt: "Solve 2x + 3 = 11.", student_answer: "B", correct_answers: ["C"] }],
          completed_at: "2026-11-20T10:00:00+05:00",
        },
      ],
    });
    await openMathJunior();
    await click(buttonIn(card(1), "Results"));
    expect(api.getMidtermResults).toHaveBeenCalledWith(1);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Results · Midterm 1");
    expect(dialog.textContent).toContain("36/44 correct · 8 wrong");
    await click(buttonIn(dialog, "Aziza Karimova"));
    expect(dialog.textContent).toContain("M1 · Solve 2x + 3 = 11.");
    expect(dialog.textContent).toContain("Answered: B");
    expect(dialog.textContent).toContain("Correct: C");
  });
});
