/**
 * One bank question (PR 16a): Preview marks the answer key's choice, Details lists the facts, Archive calls the
 * same hook, and the editor's key card follows the Correct answer field and saves the same payload.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QbQuestionDetail } from "@/domains/questionBank/types";

const archive = vi.fn();
const restore = vi.fn();
const update = vi.fn();
let question: QbQuestionDetail;

const idle = { isPending: false };

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/console/recent", () => ({ recordRecent: vi.fn() }));
vi.mock("@/components/FormulaToolbar", () => ({ FormulaToolbar: () => null }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("@/domains/questionBank/hooks", () => ({
  useQbQuestion: () => ({ data: question, isLoading: false, error: null }),
  useQbArchive: () => ({ ...idle, mutate: archive }),
  useQbRestore: () => ({ ...idle, mutate: restore }),
  useQbCreateQuestion: () => ({ ...idle, mutateAsync: vi.fn() }),
  useQbUpdateQuestion: () => ({ ...idle, mutateAsync: update }),
  useQbDomains: () => ({ data: [] }),
  useQbSkills: () => ({ data: [] }),
}));

const { default: Page } = await import("../page");

function makeQuestion(over: Partial<QbQuestionDetail> = {}): QbQuestionDetail {
  return {
    id: 5,
    qb_id: "QB-MATH-000005",
    status: "TRIAGE",
    subject: "MATH",
    question_type: "MULTIPLE_CHOICE",
    difficulty: "MEDIUM",
    external_id: "",
    domain: null,
    skill: null,
    passage: null,
    question_text: "If x + 3 = 7, what is x?",
    question_prompt: "",
    question_image: null,
    option_a: "3",
    option_b: "4",
    option_c: "5",
    option_d: "10",
    option_a_image: null,
    option_b_image: null,
    option_c_image: null,
    option_d_image: null,
    correct_answer: "B",
    explanation: "Subtract 3 from both sides.",
    points: 1,
    source_type: "MANUAL",
    source_reference: "",
    content_hash: "",
    created_at: "2026-11-01T10:00:00Z",
    suggestion: null,
    ...over,
  } as QbQuestionDetail;
}

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<Page />);
  });
}
const button = (words: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [archive, restore, update]) f.mockReset();
  question = makeQuestion();
  update.mockImplementation(async () => question);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("one bank question", () => {
  it("previews the question with the answer key's choice marked", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("QB-MATH-000005");
    expect(host.textContent).toContain("In triage");
    expect(host.textContent).toContain("If x + 3 = 7, what is x?");
    expect(host.textContent).toContain("Answer key · B");
    expect(host.textContent).not.toContain("Answer key · A");
  });

  it("lists the facts under Details", async () => {
    await render();
    await click(host.querySelector<HTMLButtonElement>("#qb-details")!);
    expect(host.textContent).toContain("Domain");
    expect(host.textContent).toContain("Unclassified");
    expect(host.textContent).toContain("Medium");
  });

  it("archives with the same call, and restores an archived one", async () => {
    await render();
    await click(button("Archive"));
    expect(archive).toHaveBeenCalledWith(5);
    act(() => root.unmount());
    root = createRoot(host);
    question = makeQuestion({ status: "ARCHIVED" });
    await render();
    await click(button("Restore"));
    expect(restore).toHaveBeenCalledWith(5);
  });

  it("edits: the key card follows the Correct answer, and Save sends the same payload", async () => {
    await render();
    await click(button("Edit"));
    expect(host.textContent).toContain("Edit QB-MATH-000005");
    const answer = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find((l) => l.textContent === "Correct answer")!;
    // useId() ids carry colons, so the field is found by id rather than a selector.
    await typeInto(document.getElementById(answer.htmlFor) as HTMLInputElement, "c");
    expect(host.textContent).toContain("Answer key · C");
    await click(button("Save changes"));
    expect(update).toHaveBeenCalledWith({
      id: 5,
      payload: {
        subject: "MATH",
        question_type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        external_id: "",
        domain: null,
        skill: null,
        question_text: "If x + 3 = 7, what is x?",
        question_prompt: "",
        option_a: "3",
        option_b: "4",
        option_c: "5",
        option_d: "10",
        correct_answer: "c",
        explanation: "Subtract 3 from both sides.",
        points: 1,
      },
      files: {},
      clears: {},
    });
  });
});
