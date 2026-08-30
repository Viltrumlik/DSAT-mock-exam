"use client";

import { useState } from "react";
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
  // Whether THIS element saw the pointer go down. Without it a pointerup that merely ended a
  // gesture begun elsewhere would count as an answer.
  const [pressed, setPressed] = useState(false);

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
        // DRAGGING it commits the value under the thumb even when that value has not
        // CHANGED — otherwise the one answer a recommendation survey most needs is the one
        // it cannot record: the thumb is parked at the minimum, so a student who wants to
        // answer 0 drags it, no change event fires, and their score stays null.
        //
        // `onPointerUp` only, and only after a real press. An earlier version also listened
        // on `onKeyUp`, which silently answered the question for anybody who TABBED past it:
        // the keyup of the Tab that moved focus HERE fires on this element, and recorded the
        // minimum. On a 0–10 recommendation slider that is a 0 — the worst score there is —
        // written by a student who never touched the control.
        onPointerDown={() => setPressed(true)}
        onPointerUp={(e) => {
          if (!pressed) return;
          setPressed(false);
          onChange(Number(e.currentTarget.value));
        }}
        // The keyboard needs no equivalent: an arrow key on a range input CHANGES the value,
        // so `onChange` already fires. Only the parked-at-minimum case needed help, and
        // Home/End/arrows all move off it.
        aria-labelledby={labelId(question)}
        // Names the END the student is at, not just the number — a screen-reader user hears
        // "7, Would recommend" instead of a bare 7 with no idea which end means what.
        aria-valuetext={
          picked == null
            ? "Not answered yet"
            : [
                String(picked),
                picked === min ? question.scale_low_label : null,
                picked === max ? question.scale_high_label : null,
              ]
                .filter(Boolean)
                .join(", ")
        }
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
      {picked == null ? (
        <p className="text-xs font-medium text-muted-foreground">
          Drag the slider to choose a number.
        </p>
      ) : (
        // The same escape hatch SINGLE_CHOICE has. An optional question that cannot be
        // un-answered is not optional — and a slider is the easiest control in the form to
        // nudge by accident while scrolling on a phone.
        !question.is_required && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ds-ring rounded-lg px-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear my answer
          </button>
        )
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
      const cap = question.max_selections || 0;
      const atCap = cap > 0 && picked.length >= cap;
      return (
        // `role="group"` does not support aria-required; the label's `*` carries it.
        <div role="group" aria-labelledby={labelledBy} className="space-y-1.5">
          {cap > 0 && (
            <p className="text-[13px] font-semibold text-muted-foreground">
              Pick up to {cap}
              {atCap && <span className="ml-1.5 text-primary">— that&apos;s {cap}, unpick one to change</span>}
            </p>
          )}
          {question.options.map((opt) => {
            const on = picked.includes(opt);
            // At the cap, the unpicked boxes go disabled rather than letting the student
            // tick a sixth and be refused at Submit. The server still enforces it — this is
            // the courtesy, not the rule.
            const blocked = atCap && !on;
            return (
              <label
                key={opt}
                className={cn(
                  choiceRow,
                  on ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                  blocked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <Checkbox
                  checked={on}
                  disabled={blocked}
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

/**
 * A question's picture, above its control.
 *
 * `alt` is the author's caption when there is one. A survey that asks "which uniform do you
 * prefer? [photo A] [photo B]" is unanswerable without sight if the photo has no description,
 * and both call sites used to hard-code an empty alt.
 */
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
