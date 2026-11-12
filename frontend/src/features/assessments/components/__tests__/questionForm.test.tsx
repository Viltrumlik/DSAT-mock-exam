/**
 * The set editor's question form, preview and bank picker (PR 17c): the answer key, ⌘↵ / Backspace on the choices
 * (the key follows), the duplicate warning, True / False and Numeric writing the same JSON, the preview drawing the
 * key, and the picker sending the same query and adding the picked question.
 */
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const qbTaxonomy = vi.fn();
const qbSelect = vi.fn();
vi.mock("@/features/assessmentsAdmin/api", () => ({
  assessmentsAdminApi: {
    qbTaxonomy: (...a: unknown[]) => qbTaxonomy(...a),
    qbSelect: (...a: unknown[]) => qbSelect(...a),
  },
}));

const { AssessmentQuestionEditorFields } = await import("../AssessmentQuestionEditorFields");
const { SATQuestionPreview } = await import("@/features/assessments/builder/SATQuestionPreview");
const { QuestionBankPickerModal } = await import("@/features/assessments/builder/QuestionBankPickerModal");
type Draft = import("../assessmentQuestionEditorShared").AssessmentQuestionEditorDraft;

const MC: Draft = {
  prompt: "What is 2 + 2?",
  question_prompt: "",
  question_type: "multiple_choice",
  order: 0,
  points: 1,
  is_active: true,
  explanation: "",
  choicesText: JSON.stringify([
    { id: "A", text: "3" },
    { id: "B", text: "4" },
    { id: "C", text: "5" },
    { id: "D", text: "6" },
  ]),
  correctAnswerText: JSON.stringify("C"),
  gradingConfigText: "{}",
};

let latest: Draft = MC;
function Harness({ initial }: { initial: Draft }) {
  const [draft, setDraft] = useState(initial);
  const insertRef = useRef<((s: string, c: number) => void) | null>(null);
  // What the form last wrote, read by the assertions (recorded after the render, not during it).
  useEffect(() => {
    latest = draft;
  }, [draft]);
  return (
    <AssessmentQuestionEditorFields
      draft={draft}
      onPatch={(p) => setDraft((d) => ({ ...d, ...p }))}
      insertHandlerRef={insertRef}
      imageState={{ files: {}, clears: {} }}
      onSetImage={() => {}}
    />
  );
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const byLabel = <T extends Element>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!;
const fieldFor = <T extends HTMLElement>(words: string) =>
  document.getElementById(Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(words))!.htmlFor) as T;
const choicesOf = () => (JSON.parse(latest.choicesText) as { id: string; text: string }[]).map((c) => `${c.id}:${c.text}`);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  qbTaxonomy.mockReset();
  qbSelect.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the answer choices", () => {
  it("marks the answer key from a choice's letter", async () => {
    await mount(<Harness initial={MC} />);
    expect(host.querySelector('[data-choice="C"]')!.textContent).toContain("Answer key · C");
    await click(byLabel("Mark option B as correct"));
    expect(latest.correctAnswerText).toBe(JSON.stringify("B"));
    expect(host.querySelector('[data-choice="B"]')!.textContent).toContain("Answer key · B");
    expect(byLabel("Option B is the correct answer").getAttribute("aria-pressed")).toBe("true");
  });

  it("adds a choice after this one with ⌘↵, and the key moves with its choice", async () => {
    await mount(<Harness initial={MC} />);
    await act(async () => {
      byLabel<HTMLTextAreaElement>("Option B").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });
    await settle();
    expect(choicesOf()).toEqual(["A:3", "B:4", "C:", "D:5", "E:6"]);
    expect(latest.correctAnswerText).toBe(JSON.stringify("D"));
    expect(host.textContent).toContain("5/8");
  });

  it("removes an empty choice with Backspace, and the key moves back", async () => {
    await mount(<Harness initial={{ ...MC, choicesText: JSON.stringify([{ id: "A", text: "3" }, { id: "B", text: "" }, { id: "C", text: "5" }]) }} />);
    await act(async () => {
      byLabel<HTMLTextAreaElement>("Option B").dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    await settle();
    expect(choicesOf()).toEqual(["A:3", "B:5"]);
    expect(latest.correctAnswerText).toBe(JSON.stringify("B"));
  });

  it("warns about a duplicate, and asks for a key when there is none", async () => {
    await mount(<Harness initial={{ ...MC, correctAnswerText: "null" }} />);
    expect(host.textContent).toContain("Click a letter badge to mark the correct answer ↓");
    setValue(byLabel<HTMLTextAreaElement>("Option D"), "3");
    await settle();
    expect(host.querySelector('[data-choice="D"]')!.textContent).toContain("Duplicate option");
  });
});

describe("the other types", () => {
  it("writes True / False as the same JSON", async () => {
    await mount(<Harness initial={MC} />);
    setValue(fieldFor<HTMLSelectElement>("Question type"), "boolean");
    await settle();
    expect(latest.correctAnswerText).toBe("true");
    const group = host.querySelector('[role="group"][aria-label="Correct answer"]')!;
    await click(Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "False")!);
    expect(latest.correctAnswerText).toBe("false");
  });

  it("writes a numeric answer and its tolerance as before", async () => {
    await mount(<Harness initial={{ ...MC, question_type: "numeric", choicesText: "[]", correctAnswerText: "0", gradingConfigText: '{"tolerance":0}' }} />);
    setValue(fieldFor<HTMLInputElement>("Correct value(s)"), "10.25, 21/2");
    setValue(fieldFor<HTMLInputElement>("Tolerance"), "0.5");
    await settle();
    expect(latest.correctAnswerText).toBe(JSON.stringify("10.25, 21/2"));
    expect(JSON.parse(latest.gradingConfigText)).toEqual({ tolerance: 0.5 });
  });
});

describe("the student preview", () => {
  it("draws the choices with the answer key's card in green", async () => {
    await mount(
      <SATQuestionPreview prompt="What is 2 + 2?" question_type="multiple_choice" choicesText={MC.choicesText} correctAnswerText={'"B"'} explanation="Two and two." />,
    );
    const key = host.querySelector('[data-preview-choice="B"]')!;
    expect(key.className).toContain("bg-ms-positive-soft");
    expect(key.querySelector(".sr-only")!.textContent).toBe("B");
    expect(host.querySelector('[data-preview-choice="A"]')!.className).not.toContain("bg-ms-positive-soft");
    expect(host.textContent).toContain("Explanation");
  });

  it("says what to do when there is nothing to show", async () => {
    await mount(<SATQuestionPreview prompt="" question_type="multiple_choice" choicesText="[]" correctAnswerText="null" explanation="" />);
    expect(host.textContent).toBe("Enter a question to see the preview");
  });
});

describe("Add from Question Bank", () => {
  it("asks for APPROVED questions with the same query and adds the picked one", async () => {
    qbTaxonomy.mockResolvedValue({ domains: [], skills: [] });
    qbSelect.mockResolvedValue({
      results: [
        { id: 501, qb_id: "QB-MATH-000501", domain: "Algebra", skill: "Linear equations", difficulty: "EASY", question_text: "Solve 2x = 6." },
        { id: 502, qb_id: "QB-MATH-000502", domain: "Algebra", skill: null, difficulty: "HARD", question_text: "Solve x² = 9." },
      ],
    });
    const onAdd = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mount(
      <QueryClientProvider client={qc}>
        <QuestionBankPickerModal open subject="MATH" onClose={() => {}} onAdd={onAdd} />
      </QueryClientProvider>,
    );
    expect(qbSelect).toHaveBeenCalledWith({ subject: "MATH", difficulty: undefined, domain_id: undefined, skill_id: undefined, search: undefined, limit: 50 });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Select a question to add");
    await click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("QB-MATH-000502"))!);
    expect(dialog.textContent).toContain("Selected QB-MATH-000502");
    await click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Add to set")!);
    expect(onAdd).toHaveBeenCalledWith(502);
  });
});
