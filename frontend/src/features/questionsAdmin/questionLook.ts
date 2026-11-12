import { inputShell } from "@/features/console/ui";

/**
 * How the Builder draws a question while it is written (design handoff v0.3): the module editor's question
 * pane (PR 14b) and the question bank's editor (PR 16a) share these, so a question reads the same wherever it
 * is authored — the fields in the console's shell, the question in the student's Georgia, the choices as the
 * student's cards with the answer key's card in green.
 */

/** A field's words above it, as the console's Field labels them. */
export const FIELD_LABEL = "mb-1.5 block text-[14px] font-medium leading-5 text-ms-fg";
/** Help under a field. */
export const HINT = "mt-1.5 text-[13px] leading-[18px] text-ms-fg-3";
/** The console field shell on a native select or input; it draws its own focus, so no outline on top. */
export const CONTROL = inputShell({
  className: "w-full outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
});
/**
 * A long field in the student's Georgia: the stem, the passage, the explanation. The face sits on a wrapper
 * (`font-ms-serif`): globals.css sets `font-family: inherit` on every control, unlayered, so a font utility
 * on the textarea itself never applies.
 */
export const SERIF_AREA = inputShell({ area: true, className: "w-full resize-y outline-none placeholder:text-ms-fg-3" });
/** A choice as the student sees it: a card with its letter in a circle; the answer key's card in green. */
export const CHOICE = "ms-transition flex rounded-[14px] border-[1.5px] p-3";
export const CHOICE_IDLE = "border-ms-border-strong bg-ms-card";
export const CHOICE_KEY = "border-ms-positive bg-ms-positive-soft";
export const LETTER = "mt-px grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] text-[13px] font-semibold";
export const LETTER_IDLE = "border-ms-border-input text-ms-fg-2";
export const LETTER_KEY = "border-ms-positive bg-ms-positive text-white";
/** Letter and True / False buttons: choice-shaped, the picked one green. */
export const PICK = "ms-transition ms-press inline-flex items-center justify-center rounded-[12px] border-[1.5px] font-semibold";
export const PICK_OFF = "border-ms-border-strong bg-ms-card text-ms-fg hover:bg-ms-surface";
export const PICK_ON = "border-ms-positive bg-ms-positive-soft text-ms-positive-fg";

/** A choice's preview is worth showing only when it carries math or markup (\( … \), $, **, <u>). */
export function hasMarkup(text: string): boolean {
  return /[\\$*<]/.test(text);
}

/** The answer key as a choice letter, when it is one ("b" → "B"); "" for a grid-in or text answer. */
export function keyLetterOf(answer: unknown): string {
  const s = (Array.isArray(answer) ? answer.join(",") : String(answer ?? "")).trim().toUpperCase();
  return /^[A-D]$/.test(s) ? s : "";
}
