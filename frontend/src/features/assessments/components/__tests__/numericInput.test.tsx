/**
 * The typed-answer box (NumericInput) must never show an answer it does not record.
 *
 * 2026-11-24, Foundation assessment: students typed answers, pressed Next, came back to an
 * empty box, and handed in 12 questions as "0 answered". The box only committed text that
 * JavaScript's Number() reads, so a decimal written the Uzbek school way — "2,5" — stayed
 * on screen and was never sent up. These cases pin what the box records for what is typed.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerInput, NumericInput } from "@/features/assessments/components/QuestionInputs";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const field = () => host.querySelector<HTMLInputElement>("input")!;

/** NumericInput is uncontrolled: React only sees a value through a real input event. */
function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function mountBox() {
  const onChange = vi.fn();
  act(() => root.render(<NumericInput value={null} onChange={onChange} />));
  return onChange;
}

const lastCommit = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0];

describe("NumericInput records what the student typed", () => {
  it("reads a comma decimal as a decimal", () => {
    const onChange = mountBox();
    type("2,5");
    expect(lastCommit(onChange)).toBe(2.5);
  });

  it("reads a negative comma decimal", () => {
    const onChange = mountBox();
    type("-0,75");
    expect(lastCommit(onChange)).toBe(-0.75);
  });

  it("reads the typographic minus sign as a minus", () => {
    const onChange = mountBox();
    type("\u22123");
    expect(lastCommit(onChange)).toBe(-3);
  });

  it("still commits a plain number and a fraction as before", () => {
    const onChange = mountBox();
    type("12");
    expect(lastCommit(onChange)).toBe(12);
    type("25/7");
    expect(lastCommit(onChange)).toBe("25/7");
  });

  it("waits while a comma decimal is half typed", () => {
    const onChange = mountBox();
    type("2,");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps text that is not a number rather than dropping it", () => {
    // The grader marks it wrong; the student still sees it was taken, and the question
    // counts as answered instead of handing in as Omitted.
    const onChange = mountBox();
    type("25%");
    expect(lastCommit(onChange)).toBe("25%");
  });

  it("clears the answer when the box is emptied", () => {
    const onChange = mountBox();
    type("2,5");
    type("");
    expect(lastCommit(onChange)).toBeNull();
  });
});

/** The runner's shape: one box, the answer kept per question id, Next and Back between them. */
function TwoQuestions({ onAnswered }: { onAnswered: (n: number) => void }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const qid = idx + 1;
  const answered = Object.values(answers).filter((v) => v != null && String(v).trim() !== "").length;
  onAnswered(answered);
  return (
    <div>
      <AnswerInput
        type="numeric"
        value={answers[qid] ?? null}
        onChange={(next) => setAnswers((p) => ({ ...p, [qid]: next }))}
      />
      <button type="button" data-nav="next" onClick={() => setIdx(1)}>Next</button>
      <button type="button" data-nav="back" onClick={() => setIdx(0)}>Back</button>
    </div>
  );
}

describe("an x=… answer stays on its own question", () => {
  // Owner, 2026-11-24: "x=5" / "x=12" were not taken, and moving on carried the same text
  // into the next question's box. Each must stay on the question it was typed on.
  it("does not ride along to the next question, and is still there on return", () => {
    let answered = -1;
    act(() => root.render(<TwoQuestions onAnswered={(n) => { answered = n; }} />));
    const nav = (which: string) =>
      act(() => host.querySelector<HTMLButtonElement>(`[data-nav="${which}"]`)!.click());

    type("x=5");
    expect(answered).toBe(1);
    nav("next");
    expect(field().value).toBe("");
    type("x=12");
    nav("back");
    expect(field().value).toBe("x=5");
    nav("next");
    expect(field().value).toBe("x=12");
    expect(answered).toBe(2);
  });
});

describe("a comma answer survives Next and Back", () => {
  it("is still in the box on return and counts as answered", () => {
    let answered = -1;
    act(() => root.render(<TwoQuestions onAnswered={(n) => { answered = n; }} />));
    const nav = (which: string) =>
      act(() => host.querySelector<HTMLButtonElement>(`[data-nav="${which}"]`)!.click());

    type("2,5");
    nav("next");
    expect(field().value).toBe("");
    type("0,4");
    nav("back");

    expect(Number(field().value.replace(",", "."))).toBe(2.5);
    expect(answered).toBe(2);
  });
});
