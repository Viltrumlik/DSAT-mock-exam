"use client";

import type { AssessmentChoice, AssessmentQuestionType } from "@/features/assessments/types";
import { MathText } from "@/components/MathText";

export function MultipleChoiceInput({
  choices,
  value,
  onChange,
}: {
  choices: AssessmentChoice[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="grid gap-3">
      {choices.map((c) => {
        const checked = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(checked ? null : c.id)}
            // min-h-[52px] ensures 44px+ tap target even for short answer text.
            // Border + bg change on checked provides unambiguous selection feedback.
            // select-none prevents the iOS/Android long-press text-selection popup
            // from interrupting an answer tap.
            className={`select-none min-h-[52px] rounded-2xl border-2 p-4 text-left transition-colors ${
              checked
                ? "border-primary bg-primary/8 shadow-sm"
                : "border-border bg-card hover:border-primary/40 hover:bg-surface-2"
            }`}
            aria-pressed={checked}
          >
            <div className="flex items-start gap-3">
              {/* Selection indicator circle */}
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  checked ? "border-primary bg-primary" : "border-muted-foreground/40"
                }`}
                aria-hidden
              >
                {checked && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase tracking-wider text-label-foreground">{c.id}</p>
                {/* MathText renders LaTeX delimiters via KaTeX and handles
                    **bold** / *italic* markdown inline formatting. Long
                    choice text wraps naturally — no truncation. */}
                <MathText
                  text={c.text}
                  className="mt-0.5 text-sm text-foreground leading-snug"
                />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function NumericInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <input
      className="ui-input w-full rounded-xl border border-border bg-surface-2/80 px-4 py-3 min-h-[44px] text-base shadow-sm"
      // type="text" + inputMode="decimal" + pattern: triggers numeric keyboard
      // on both iOS Safari and Android Chrome consistently. type="number" causes
      // stepper arrows on desktop and inconsistent mobile keyboards.
      type="text"
      inputMode="decimal"
      pattern="[0-9.]*"
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const s = e.target.value.trim();
        if (!s) return onChange(null);
        const n = Number(s);
        if (!Number.isFinite(n)) return;
        onChange(n);
      }}
      placeholder="Enter a number…"
    />
  );
}

export function ShortTextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <textarea
      // text-base (16px) prevents iOS Safari auto-zoom on focus (triggered by
      // any input with font-size < 16px).
      className="ui-input w-full min-h-[120px] rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-base shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type your answer…"
    />
  );
}

export function AnswerInput({
  type,
  choices,
  value,
  onChange,
}: {
  type: AssessmentQuestionType;
  choices?: AssessmentChoice[];
  value: any;
  onChange: (next: any) => void;
}) {
  if (type === "multiple_choice") {
    return <MultipleChoiceInput choices={choices || []} value={value ?? null} onChange={onChange} />;
  }
  if (type === "numeric") {
    return <NumericInput value={typeof value === "number" ? value : value == null ? null : Number(value)} onChange={onChange} />;
  }
  return <ShortTextInput value={String(value ?? "")} onChange={onChange} />;
}

