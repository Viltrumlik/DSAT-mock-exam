// Port of frontend/src/features/testing-simulation/components/SprInput.tsx.
// Student-produced response input (math grid-ins). Accepts digits, -, ., / — at most 5.
//
// Like the website, the <input> is UNCONTROLLED: typed characters are never re-applied from
// outside while the student types (the website's prod bug "25"→"2" came from a controlled
// input). `lastGood` is the last accepted value: an invalid keystroke restores it, and an
// external change (question switch, state.patch) is adopted only when it differs from it.
// The "Recorded:" box mirrors the value and shows "a/b" as a stacked fraction.
import { h } from "./dom";

export const SPR_PATTERN = /^[-0-9./]*$/;
export const SPR_MAX = 5;

export interface SprInputView {
  readonly el: HTMLDivElement;
  readonly input: HTMLInputElement;
  /** Adopt an external value (draft restore / navigation / native echo). */
  setValue(value: string): void;
  setLocked(locked: boolean): void;
  readonly value: string;
}

/** Renders an "a/b" answer as a stacked fraction; otherwise plain text. */
export function RecordedAnswer(text: string): HTMLSpanElement {
  if (!text) return h("span", null, "—");
  if (text.includes("/")) {
    const [num, den] = text.split("/");
    return h(
      "span",
      { className: "inline-flex flex-col items-center justify-center font-black leading-none" },
      h("span", { className: "border-b-[2.5px] border-slate-900 px-[2px] pb-[1px]" }, num),
      h("span", { className: "px-[2px] pt-[1px]" }, den),
    );
  }
  return h("span", null, text);
}

export function SprInput(initial: string, onChange: (value: string) => void): SprInputView {
  let lastGood = initial ?? "";
  let locked = false;
  const recorded = h(
    "span",
    {
      className:
        "flex min-h-[30px] min-w-[30px] items-center justify-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-sm font-black text-slate-900",
    },
    RecordedAnswer(lastGood),
  );
  const setShown = (v: string) => recorded.replaceChildren(RecordedAnswer(v));

  const input = h("input", {
    className:
      "w-full max-w-xs rounded-lg border-2 border-slate-300 p-3 px-4 text-center text-xl font-bold tracking-widest text-slate-900 shadow-sm outline-2 outline-offset-1 outline-blue-600 transition-all hover:border-slate-400 focus:border-blue-600 focus:outline",
    attrs: {
      type: "text",
      inputmode: "text",
      placeholder: "Enter your answer",
      maxlength: SPR_MAX,
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
    },
  });
  input.defaultValue = lastGood;

  input.addEventListener("input", () => {
    if (locked) {
      input.value = lastGood;
      return;
    }
    const next = input.value.slice(0, SPR_MAX);
    if (SPR_PATTERN.test(next)) {
      if (input.value !== next) input.value = next;
      if (next === lastGood) return;
      lastGood = next;
      setShown(next);
      onChange(next);
    } else {
      // Reject non-grid-in characters: restore the last valid value.
      input.value = lastGood;
    }
  });
  // Pasting is typing too: the same filter applies (an invalid paste is simply refused).
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (locked || !SPR_PATTERN.test(text)) e.preventDefault();
  });
  input.addEventListener("drop", (e) => e.preventDefault());

  const el = h(
    "div",
    { className: "mt-6" },
    h("p", { className: "mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400" }, "Your Answer"),
    input,
    h(
      "div",
      { className: "mt-3 flex max-w-xs items-center gap-2" },
      h("span", { className: "text-[11px] font-bold uppercase tracking-widest text-slate-400" }, "Recorded:"),
      recorded,
    ),
  );

  return {
    el,
    input,
    get value() {
      return lastGood;
    },
    setValue(value: string) {
      const next = value ?? "";
      if (next === lastGood) return;
      lastGood = next;
      setShown(next);
      if (input.value !== next) input.value = next;
    },
    setLocked(on: boolean) {
      locked = on;
      input.readOnly = on;
    },
  };
}
