"use client";

import Image from "next/image";
import { Checkbox, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  isChoiceType,
  isNumericType,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from "./surveysApi";

/** The card title is the question's visible label, so controls point at it by id. */
export const controlId = (q: SurveyQuestion) => `survey-q-${q.id}`;
export const labelId = (q: SurveyQuestion) => `survey-q-${q.id}-label`;

const choiceRow =
  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors";

/**
 * Whether this answer opens the question's follow-up box.
 *
 * The same rule as `SurveyQuestion.wants_follow_up` on the server, and it has to be: the
 * server drops a comment left on an answer that closed its box, so a client that showed the
 * box where the server would not would let a student write something that is silently
 * discarded.
 */
export function wantsFollowUp(q: SurveyQuestion, value: SurveyAnswerValue): boolean {
  if (isNumericType(q.question_type)) {
    if (q.follow_up_threshold == null || typeof value !== "number") return false;
    return value < q.follow_up_threshold;
  }
  if (isChoiceType(q.question_type)) {
    const triggers = new Set(q.follow_up_options ?? []);
    if (triggers.size === 0) return false;
    const picked = Array.isArray(value) ? value : value == null ? [] : [String(value)];
    return picked.some((p) => triggers.has(String(p)));
  }
  return false;
}

/** Has this question been answered at all? `0` is an answer — the lowest point of a slider. */
export function isAnswered(value: SurveyAnswerValue): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** A dragged slider with a written sentence at each end — the recommendation question. */
function RatingSlider({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue;
  onChange: (v: SurveyAnswerValue) => void;
}) {
  const min = question.scale_min;
  const max = question.scale_max;
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const picked = typeof value === "number" ? value : null;

  return (
    <div className="space-y-2">
      {/* The scale reads left to right above the track, the way the school's mock-up has it.
          `tabular-nums` keeps 10 the same width as 1 so the row does not shift as it renders. */}
      <div
        className="flex justify-between px-0.5 text-[13px] font-bold tabular-nums text-muted-foreground"
        aria-hidden
      >
        {steps.map((n) => (
          <span key={n} className={cn(picked === n && "text-primary")}>
            {n}
          </span>
        ))}
      </div>
      <input
        id={controlId(question)}
        type="range"
        min={min}
        max={max}
        step={1}
        // Parked at the bottom until they touch it — but `value` stays null until then, so
        // an untouched slider still counts as unanswered rather than as a silent zero.
        value={picked ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        // Touching it at all commits the value under the thumb, even when that value has
        // not CHANGED. Without this the one answer a recommendation survey most needs is
        // the one it cannot record: the thumb is parked at the minimum, so a student who
        // wants to answer 0 drags it, no change event fires, and their score stays null.
        // Both handlers, because a pointer and a keyboard reach the control differently.
        onPointerUp={(e) => onChange(Number(e.currentTarget.value))}
        onKeyUp={(e) => onChange(Number(e.currentTarget.value))}
        aria-labelledby={labelId(question)}
        aria-valuetext={picked == null ? "Not answered yet" : String(picked)}
        className={cn(
          "ds-ring h-2 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary",
          picked == null && "opacity-70",
        )}
      />
      {(question.scale_low_label || question.scale_high_label) && (
        <div className="flex justify-between gap-4 text-[13px] font-medium text-muted-foreground">
          <span className="min-w-0">{question.scale_low_label}</span>
          <span className="min-w-0 text-right">{question.scale_high_label}</span>
        </div>
      )}
      {picked == null && (
        <p className="text-xs font-medium text-muted-foreground">
          Drag the slider to choose a number.
        </p>
      )}
    </div>
  );
}

export function SurveyQuestionField({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue;
  onChange: (v: SurveyAnswerValue) => void;
}) {
  const id = controlId(question);
  const labelledBy = labelId(question);
  const required = question.is_required || undefined;

  switch (question.question_type) {
    case "LONG_TEXT":
      return (
        <Textarea
          id={id}
          aria-labelledby={labelledBy}
          aria-required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "DATE":
      return (
        <Input
          id={id}
          type="date"
          aria-labelledby={labelledBy}
          aria-required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "RATING":
      return <RatingSlider question={question} value={value} onChange={onChange} />;
    case "SCALE": {
      const steps = Array.from(
        { length: question.scale_max - question.scale_min + 1 },
        (_, i) => question.scale_min + i,
      );
      return (
        <div
          role="radiogroup"
          aria-labelledby={labelledBy}
          aria-required={required}
          className="flex flex-wrap gap-2"
        >
          {steps.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              onClick={() => onChange(n)}
              className={cn(
                "ds-ring ds-num h-10 w-10 rounded-xl border text-sm font-bold transition-colors",
                value === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-foreground hover:bg-surface-2",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }
    case "SINGLE_CHOICE":
      return (
        <div
          role="radiogroup"
          aria-labelledby={labelledBy}
          aria-required={required}
          className="space-y-1.5"
        >
          {question.options.map((opt) => {
            const on = value === opt;
            return (
              <label
                key={opt}
                className={cn(
                  choiceRow,
                  on ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name={`q${question.id}`}
                  checked={on}
                  onChange={() => onChange(opt)}
                  className="ds-ring h-[18px] w-[18px] shrink-0 accent-primary"
                />
                <span className="min-w-0">{opt}</span>
              </label>
            );
          })}
          {/* An optional question that cannot be un-answered is not optional. A radio group
              has no native way back to "nothing", so it needs an explicit way out. */}
          {!question.is_required && value != null && value !== "" && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ds-ring rounded-lg px-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear my answer
            </button>
          )}
        </div>
      );
    case "MULTI_CHOICE": {
      const picked = Array.isArray(value) ? value : [];
      return (
        // `role="group"` does not support aria-required; the label's `*` carries it.
        <div role="group" aria-labelledby={labelledBy} className="space-y-1.5">
          {question.options.map((opt) => {
            const on = picked.includes(opt);
            return (
              <label
                key={opt}
                className={cn(
                  choiceRow,
                  on ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <Checkbox
                  checked={on}
                  onChange={() =>
                    onChange(on ? picked.filter((x) => x !== opt) : [...picked, opt])
                  }
                />
                <span className="min-w-0">{opt}</span>
              </label>
            );
          })}
        </div>
      );
    }
    default:
      return (
        <Input
          id={id}
          aria-labelledby={labelledBy}
          aria-required={required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** A question's picture, above its control. */
export function QuestionImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-2">
      {/* `unoptimized`: the R2 bucket is private, so the src is a signed URL that expires in
          an hour — Next's optimizer would cache a copy that 403s once the signature lapses. */}
      <Image
        src={src}
        alt={alt}
        width={1200}
        height={675}
        unoptimized
        className="h-auto w-full object-contain"
      />
    </div>
  );
}
