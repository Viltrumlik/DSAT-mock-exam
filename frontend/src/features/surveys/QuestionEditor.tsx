"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  Alert,
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  isChoiceType,
  isNumericType,
  type QuestionPatch,
  type SurveyConditionOperator,
  type SurveyQuestion,
  type SurveyQuestionType,
} from "./surveysApi";

export const TYPE_LABELS: Record<SurveyQuestionType, string> = {
  SHORT_TEXT: "Short answer",
  LONG_TEXT: "Paragraph",
  SINGLE_CHOICE: "Multiple choice — pick one",
  MULTI_CHOICE: "Checkboxes — pick any",
  SCALE: "Linear scale (buttons)",
  RATING: "Recommendation slider",
  DATE: "Date",
};

/** What each type is FOR, in the author's language. The type name alone does not say when
 *  to reach for a slider over a scale, and the two look identical in a dropdown. */
const TYPE_HINTS: Record<SurveyQuestionType, string> = {
  SHORT_TEXT: "One line — a name, a topic, a number.",
  LONG_TEXT: "A paragraph. Use it when you want their own words.",
  SINGLE_CHOICE: "Radio buttons. One answer out of the list.",
  MULTI_CHOICE: "Tick boxes. As many as apply.",
  SCALE: "A short row of numbers to tap. Best up to about 1–5.",
  RATING: "A dragged slider with a sentence at each end. Best for 0–10.",
  DATE: "A calendar date.",
};

/** The defaults each type wants the first time it is chosen. */
function defaultsForType(type: SurveyQuestionType): Partial<QuestionPatch> {
  if (type === "RATING") {
    return {
      scale_min: 0,
      scale_max: 10,
      scale_low_label: "Would not recommend",
      scale_high_label: "Would recommend",
    };
  }
  if (type === "SCALE") return { scale_min: 1, scale_max: 5 };
  return {};
}

export interface QuestionDraft {
  prompt: string;
  help_text: string;
  question_type: SurveyQuestionType;
  is_required: boolean;
  options: string[];
  follow_up_options: string[];
  max_selections: number;
  scale_min: number;
  scale_max: number;
  scale_low_label: string;
  scale_high_label: string;
  follow_up_threshold: number | null;
  follow_up_placeholder: string;
  follow_up_required: boolean;
  condition_question: number | null;
  condition_operator: SurveyConditionOperator | "";
  condition_value: number | string[] | null;
}

export const BLANK_DRAFT: QuestionDraft = {
  prompt: "",
  help_text: "",
  question_type: "SHORT_TEXT",
  is_required: false,
  options: ["", ""],
  follow_up_options: [],
  max_selections: 0,
  scale_min: 1,
  scale_max: 5,
  scale_low_label: "",
  scale_high_label: "",
  follow_up_threshold: null,
  follow_up_placeholder: "",
  follow_up_required: false,
  condition_question: null,
  condition_operator: "",
  condition_value: null,
};

export function draftFrom(q: SurveyQuestion): QuestionDraft {
  return {
    prompt: q.prompt,
    help_text: q.help_text,
    question_type: q.question_type,
    is_required: q.is_required,
    options: q.options.length ? [...q.options] : ["", ""],
    follow_up_options: [...(q.follow_up_options ?? [])],
    max_selections: q.max_selections ?? 0,
    scale_min: q.scale_min,
    scale_max: q.scale_max,
    scale_low_label: q.scale_low_label,
    scale_high_label: q.scale_high_label,
    follow_up_threshold: q.follow_up_threshold,
    follow_up_placeholder: q.follow_up_placeholder,
    follow_up_required: q.follow_up_required,
    condition_question: q.condition_question,
    condition_operator: q.condition_operator,
    condition_value: q.condition_value,
  };
}

/** The draft as the API wants it — blanks stripped, options trimmed. */
export function patchFrom(draft: QuestionDraft): QuestionPatch {
  const options = draft.options.map((o) => o.trim()).filter(Boolean);
  const choice = isChoiceType(draft.question_type);
  const numeric = isNumericType(draft.question_type);
  return {
    prompt: draft.prompt.trim(),
    help_text: draft.help_text.trim(),
    question_type: draft.question_type,
    is_required: draft.is_required,
    options: choice ? options : [],
    // Only ever the triggers that survived the option list. An author who renames an option
    // after ticking it would otherwise send a trigger the server refuses.
    follow_up_options: choice
      ? draft.follow_up_options.filter((t) => options.includes(t))
      : [],
    // Only a checkbox question can carry a cap, and never one bigger than the list.
    max_selections:
      draft.question_type === "MULTI_CHOICE"
        ? Math.min(draft.max_selections || 0, options.length)
        : 0,
    scale_min: numeric ? draft.scale_min : 1,
    scale_max: numeric ? draft.scale_max : 5,
    scale_low_label: draft.question_type === "RATING" ? draft.scale_low_label.trim() : "",
    scale_high_label: draft.question_type === "RATING" ? draft.scale_high_label.trim() : "",
    follow_up_threshold: numeric ? draft.follow_up_threshold : null,
    follow_up_placeholder: draft.follow_up_placeholder.trim(),
    follow_up_required: draft.follow_up_required,
    // Both halves or neither — the server refuses half a rule, and an operator left behind
    // when the question is cleared would be an unsaveable draft the author cannot see.
    condition_question: draft.condition_operator ? draft.condition_question : null,
    condition_operator: draft.condition_question ? draft.condition_operator : "",
    condition_value: draft.condition_question && draft.condition_operator
      ? draft.condition_value
      : null,
  };
}

/** Why this draft cannot be saved yet, in the author's words. Empty means it can. */
export function draftProblems(draft: QuestionDraft): string[] {
  const problems: string[] = [];
  if (!draft.prompt.trim()) problems.push("The question needs something to ask.");
  const options = draft.options.map((o) => o.trim()).filter(Boolean);
  if (isChoiceType(draft.question_type)) {
    if (options.length < 1) problems.push("Add at least one option to choose from.");
    if (new Set(options).size !== options.length) {
      problems.push("Two options have the same text — the results could not tell them apart.");
    }
  }
  if (draft.question_type === "MULTI_CHOICE" && draft.max_selections > options.length) {
    problems.push(
      `You can only pick from ${options.length} option${options.length === 1 ? "" : "s"}, so a limit of ${draft.max_selections} does nothing.`,
    );
  }
  if (isNumericType(draft.question_type)) {
    if (draft.scale_max <= draft.scale_min) {
      problems.push("The top of the scale has to be above the bottom.");
    } else if (
      draft.follow_up_threshold != null &&
      !(draft.follow_up_threshold > draft.scale_min && draft.follow_up_threshold <= draft.scale_max)
    ) {
      problems.push(
        `The satisfactory score has to sit inside the scale — more than ${draft.scale_min} and at most ${draft.scale_max}.`,
      );
    }
  }
  return problems;
}

export function QuestionEditor({
  draft,
  onChange,
  image,
  onImageChange,
  existingImageUrl,
  idPrefix,
  earlierQuestions = [],
}: {
  draft: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  image: File | null;
  onImageChange: (file: File | null) => void;
  existingImageUrl?: string | null;
  idPrefix: string;
  /** Questions ABOVE this one — the only ones a condition may point at. */
  earlierQuestions?: SurveyQuestion[];
}) {
  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const choice = isChoiceType(draft.question_type);
  const numeric = isNumericType(draft.question_type);
  // The follow-up block is worth showing only once something can open it.
  const hasTrigger = numeric ? draft.follow_up_threshold != null : draft.follow_up_options.length > 0;

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    // Revoked on unmount and on every replacement — an object URL held for the life of the
    // tab is a leak the size of the picture.
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const shownImage = preview ?? existingImageUrl ?? null;

  function setOption(index: number, text: string) {
    const before = draft.options[index];
    const options = draft.options.map((o, i) => (i === index ? text : o));
    // Renaming an option carries its trigger across, rather than silently un-ticking it.
    const follow_up_options = draft.follow_up_options.map((t) => (t === before ? text : t));
    onChange({ ...draft, options, follow_up_options });
  }

  function removeOption(index: number) {
    const removed = draft.options[index];
    onChange({
      ...draft,
      options: draft.options.filter((_, i) => i !== index),
      follow_up_options: draft.follow_up_options.filter((t) => t !== removed),
    });
  }

  function toggleTrigger(option: string, on: boolean) {
    set(
      "follow_up_options",
      on
        ? [...draft.follow_up_options, option]
        : draft.follow_up_options.filter((t) => t !== option),
    );
  }

  return (
    <div className="space-y-3.5">
      <Field label="Question" htmlFor={`${idPrefix}-prompt`} required>
        <Input
          id={`${idPrefix}-prompt`}
          value={draft.prompt}
          maxLength={500}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder="What do you want to ask?"
        />
      </Field>

      <Field
        label="Hint under the question"
        htmlFor={`${idPrefix}-help`}
        hint="Optional. A line of context the student reads before answering."
      >
        <Input
          id={`${idPrefix}-help`}
          value={draft.help_text}
          maxLength={300}
          onChange={(e) => set("help_text", e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <Field
          label="Answer type"
          htmlFor={`${idPrefix}-type`}
          hint={TYPE_HINTS[draft.question_type]}
        >
          <Select
            id={`${idPrefix}-type`}
            value={draft.question_type}
            onChange={(e) => {
              const type = e.target.value as SurveyQuestionType;
              // Changing the type brings that type's defaults with it — otherwise picking
              // "Recommendation slider" gives a 1–5 slider with no labels, which is the
              // wrong control wearing the right name.
              onChange({ ...draft, question_type: type, ...defaultsForType(type) });
            }}
          >
            {(Object.keys(TYPE_LABELS) as SurveyQuestionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex h-11 items-center px-1">
          <Checkbox
            id={`${idPrefix}-required`}
            label="Required"
            checked={draft.is_required}
            onChange={(e) => set("is_required", e.target.checked)}
          />
        </div>
      </div>

      {/* ── Options, each with its own "opens a follow-up" tick ─────────────── */}
      {choice && (
        <Field
          label="Options"
          hint="Tick “asks for more” on an option like “I have a suggestion” to open a text box under it."
        >
          <div className="space-y-2">
            {draft.options.map((opt, i) => {
              const trimmed = opt.trim();
              return (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    inputSize="sm"
                    value={opt}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Option ${i + 1}`}
                  />
                  <div className="shrink-0">
                    <Checkbox
                      label="asks for more"
                      checked={Boolean(trimmed) && draft.follow_up_options.includes(trimmed)}
                      disabled={!trimmed}
                      onChange={(e) => toggleTrigger(trimmed, e.target.checked)}
                    />
                  </div>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={draft.options.length <= 1}
                    onClick={() => removeOption(i)}
                    aria-label={`Remove option ${i + 1}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                </div>
              );
            })}
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Plus aria-hidden />}
              onClick={() => set("options", [...draft.options, ""])}
            >
              Add option
            </Button>
          </div>
        </Field>
      )}

      {draft.question_type === "MULTI_CHOICE" && (
        <Field
          label="Most they can pick"
          htmlFor={`${idPrefix}-cap`}
          hint={
            draft.max_selections
              ? `They can tick at most ${draft.max_selections}. Leave 0 for no limit.`
              : "0 means they can tick as many as they like."
          }
        >
          <Input
            id={`${idPrefix}-cap`}
            type="number"
            min={0}
            max={draft.options.filter((o) => o.trim()).length}
            value={draft.max_selections}
            onChange={(e) => set("max_selections", Number(e.target.value) || 0)}
          />
        </Field>
      )}

      {/* ── The numeric range, and the slider's two written ends ────────────── */}
      {numeric && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lowest number" htmlFor={`${idPrefix}-min`}>
            <Input
              id={`${idPrefix}-min`}
              type="number"
              min={0}
              max={100}
              value={draft.scale_min}
              onChange={(e) => set("scale_min", Number(e.target.value))}
            />
          </Field>
          <Field label="Highest number" htmlFor={`${idPrefix}-max`}>
            <Input
              id={`${idPrefix}-max`}
              type="number"
              min={1}
              max={100}
              value={draft.scale_max}
              onChange={(e) => set("scale_max", Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {draft.question_type === "RATING" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Label at the low end"
            htmlFor={`${idPrefix}-low`}
            hint="Write whatever the question is really about."
          >
            <Input
              id={`${idPrefix}-low`}
              value={draft.scale_low_label}
              maxLength={80}
              onChange={(e) => set("scale_low_label", e.target.value)}
              placeholder="Would not recommend"
            />
          </Field>
          <Field label="Label at the high end" htmlFor={`${idPrefix}-high`}>
            <Input
              id={`${idPrefix}-high`}
              value={draft.scale_high_label}
              maxLength={80}
              onChange={(e) => set("scale_high_label", e.target.value)}
              placeholder="Would recommend"
            />
          </Field>
        </div>
      )}

      {/* ── The satisfactory bar ────────────────────────────────────────────── */}
      {numeric && (
        <Field
          label="Satisfactory score"
          htmlFor={`${idPrefix}-threshold`}
          hint={
            draft.follow_up_threshold == null
              ? "Leave empty to never ask for a reason."
              : `Anything below ${draft.follow_up_threshold} is asked why. ${draft.follow_up_threshold} and above is not.`
          }
        >
          <Input
            id={`${idPrefix}-threshold`}
            type="number"
            min={draft.scale_min + 1}
            max={draft.scale_max}
            value={draft.follow_up_threshold ?? ""}
            onChange={(e) =>
              set("follow_up_threshold", e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder="e.g. 8"
          />
        </Field>
      )}

      {/* ── What the follow-up box says and whether it is compulsory ────────── */}
      {hasTrigger && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3.5">
          <p className="text-[13px] font-bold text-foreground">The follow-up box</p>
          <Field
            label="What the empty box says"
            htmlFor={`${idPrefix}-placeholder`}
            hint="It disappears as soon as the student starts typing."
          >
            <Input
              id={`${idPrefix}-placeholder`}
              inputSize="sm"
              value={draft.follow_up_placeholder}
              maxLength={200}
              onChange={(e) => set("follow_up_placeholder", e.target.value)}
              placeholder="Why did you give this score?"
            />
          </Field>
          <Checkbox
            id={`${idPrefix}-fu-required`}
            label="They must fill it in"
            checked={draft.follow_up_required}
            onChange={(e) => set("follow_up_required", e.target.checked)}
          />
          {draft.follow_up_required && (
            <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
              A student who cannot think of anything to write can only get past this by
              changing their answer. Leave it optional unless you really need the note.
            </p>
          )}
        </div>
      )}

      {/* ── Show this only sometimes ────────────────────────────────────────── */}
      <ConditionEditor draft={draft} onChange={onChange} earlier={earlierQuestions} idPrefix={idPrefix} />

      {/* ── Picture ─────────────────────────────────────────────────────────── */}
      <Field label="Picture" hint="Optional. Shown above the answer control.">
        <div className="space-y-2">
          {shownImage && (
            <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-border">
              <Image
                src={shownImage}
                alt=""
                width={640}
                height={360}
                unoptimized
                className="h-auto w-full object-contain"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "ds-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border",
                "bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2",
              )}
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              {shownImage ? "Replace picture" : "Add a picture"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => onImageChange(e.target.files?.[0] ?? null)}
              />
            </label>
            {image && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Trash2 aria-hidden />}
                onClick={() => onImageChange(null)}
              >
                Undo
              </Button>
            )}
          </div>
        </div>
      </Field>
    </div>
  );
}

/**
 * "Show this question only if…" — the branch the school asked for.
 *
 * The follow-up box above is the one-question version of this and can only ever ask for
 * prose on the UNSATISFACTORY side. This is the other half: a whole question, with its own
 * type and options, shown only when an earlier answer went a particular way. Asking "what
 * makes you recommend us? [teaching] [community] [exams]" of somebody who scored 5 is what
 * it exists to stop.
 */
/**
 * "When should students see this question?" — in sentences, not operators.
 *
 * The first version of this was three dropdowns reading `[3. test] [picked any of] [☐☐☐]`.
 * Every word in it was the schema's word rather than the school's, and the person using it
 * runs a learning centre. It is now a list of plain choices, each of which says what it does,
 * with one detail row and a sentence at the bottom restating the finished rule in English.
 *
 * The five modes map onto the same operators as before — nothing changed underneath.
 */

type ConditionMode = "ALWAYS" | "HIGH" | "LOW" | "PICKED" | "NOT_PICKED" | "ANSWERED";

const MODES: { value: ConditionMode; label: string; hint: string }[] = [
  { value: "ALWAYS", label: "Everyone sees it", hint: "The normal case." },
  {
    value: "HIGH",
    label: "Only students who gave a HIGH score",
    hint: "e.g. ask happy students what they liked.",
  },
  {
    value: "LOW",
    label: "Only students who gave a LOW score",
    hint: "e.g. ask unhappy students what went wrong.",
  },
  {
    value: "PICKED",
    label: "Only students who chose certain answers",
    hint: "e.g. only those who ticked “I have a suggestion”.",
  },
  {
    value: "NOT_PICKED",
    label: "Only students who did NOT choose certain answers",
    hint: "The opposite of the one above.",
  },
  {
    value: "ANSWERED",
    label: "Only students who answered an earlier question",
    hint: "Whatever they said, as long as they said something.",
  },
];

const MODE_OF: Record<string, ConditionMode> = {
  AT_LEAST: "HIGH",
  BELOW: "LOW",
  ANY_OF: "PICKED",
  NONE_OF: "NOT_PICKED",
  ANSWERED: "ANSWERED",
};
const OPERATOR_OF: Record<ConditionMode, SurveyConditionOperator | ""> = {
  ALWAYS: "",
  HIGH: "AT_LEAST",
  LOW: "BELOW",
  PICKED: "ANY_OF",
  NOT_PICKED: "NONE_OF",
  ANSWERED: "ANSWERED",
};

/** Which earlier questions a given mode can actually read. */
function sourcesFor(mode: ConditionMode, earlier: SurveyQuestion[]): SurveyQuestion[] {
  if (mode === "HIGH" || mode === "LOW") return earlier.filter((q) => isNumericType(q.question_type));
  if (mode === "PICKED" || mode === "NOT_PICKED") {
    return earlier.filter((q) => isChoiceType(q.question_type));
  }
  return earlier;
}

function ConditionEditor({
  draft,
  onChange,
  earlier,
  idPrefix,
}: {
  draft: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  earlier: SurveyQuestion[];
  idPrefix: string;
}) {
  const source = earlier.find((q) => q.id === draft.condition_question) ?? null;
  const mode: ConditionMode =
    draft.condition_question && draft.condition_operator
      ? MODE_OF[draft.condition_operator] ?? "ALWAYS"
      : "ALWAYS";
  const candidates = sourcesFor(mode, earlier);

  // Two options with the same TEXT are the same answer as far as the survey is concerned —
  // the stored answer IS the text. Showing them as separate boxes is what made ticking one
  // appear to tick all three. Collapse them, and say so, rather than drawing a control that
  // cannot mean what it looks like.
  const rawOptions = source?.options ?? [];
  const options = Array.from(new Set(rawOptions.map((o) => String(o))));
  const hasDuplicateOptions = options.length !== rawOptions.length;

  function setMode(next: ConditionMode) {
    if (next === "ALWAYS") {
      onChange({ ...draft, condition_question: null, condition_operator: "", condition_value: null });
      return;
    }
    // Keep the current source only if the new mode can actually read it; otherwise take the
    // first one that fits, so the author never lands on a rule that can never be true.
    const fits = sourcesFor(next, earlier);
    const keep = fits.find((q) => q.id === draft.condition_question) ?? fits[0] ?? null;
    onChange({
      ...draft,
      condition_operator: OPERATOR_OF[next],
      condition_question: keep?.id ?? null,
      condition_value: defaultValueFor(next, keep),
    });
  }

  function defaultValueFor(next: ConditionMode, q: SurveyQuestion | null | undefined) {
    if (!q) return null;
    if (next === "HIGH" || next === "LOW") {
      // Prefilled from the satisfactory score the author already set on that question —
      // the number they mean nine times out of ten.
      return q.follow_up_threshold ?? Math.ceil((q.scale_min + q.scale_max) / 2);
    }
    if (next === "PICKED" || next === "NOT_PICKED") return [];
    return null;
  }

  /** The finished rule, in one English sentence. */
  function preview(): string | null {
    if (mode === "ALWAYS" || !source) return null;
    const q = `“${source.prompt.slice(0, 40)}”`;
    const picked = Array.isArray(draft.condition_value) ? draft.condition_value : [];
    switch (mode) {
      case "HIGH":
        return `Shown only to students who scored ${draft.condition_value} or more on ${q}.`;
      case "LOW":
        return `Shown only to students who scored less than ${draft.condition_value} on ${q}.`;
      case "PICKED":
        return picked.length
          ? `Shown only to students who picked ${picked.map((p) => `“${p}”`).join(" or ")} on ${q}.`
          : `Choose which answers on ${q} should show it.`;
      case "NOT_PICKED":
        return picked.length
          ? `Shown only to students who did NOT pick ${picked.map((p) => `“${p}”`).join(" or ")} on ${q}.`
          : `Choose which answers on ${q} should hide it.`;
      case "ANSWERED":
        return `Shown only to students who answered ${q}.`;
      default:
        return null;
    }
  }

  if (earlier.length === 0) {
    return (
      <Field
        label="When to show this"
        hint="The first question is always shown — a rule can only look at a question above it."
      >
        <p className="text-[13px] text-muted-foreground">Nothing above this one to depend on yet.</p>
      </Field>
    );
  }

  return (
    <Field label="When should students see this question?">
      <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3.5">
        <div className="space-y-1.5">
          {MODES.map((m) => {
            const usable = m.value === "ALWAYS" || sourcesFor(m.value, earlier).length > 0;
            return (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
                  mode === m.value ? "bg-primary/10" : "hover:bg-card",
                  !usable && "cursor-not-allowed opacity-45",
                )}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-cond-mode`}
                  className="ds-ring mt-0.5 h-[18px] w-[18px] shrink-0 accent-primary"
                  checked={mode === m.value}
                  disabled={!usable}
                  onChange={() => setMode(m.value)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{m.label}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {usable
                      ? m.hint
                      : m.value === "HIGH" || m.value === "LOW"
                        ? "No scale or slider question above this one."
                        : "No choice question above this one."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {mode !== "ALWAYS" && (
          <div className="space-y-2.5 border-t border-border pt-3">
            <Field label="Based on their answer to" htmlFor={`${idPrefix}-cond-q`}>
              <Select
                id={`${idPrefix}-cond-q`}
                value={draft.condition_question == null ? "" : String(draft.condition_question)}
                onChange={(e) => {
                  const next = earlier.find((q) => String(q.id) === e.target.value) ?? null;
                  onChange({
                    ...draft,
                    condition_question: next?.id ?? null,
                    condition_value: defaultValueFor(mode, next),
                  });
                }}
              >
                {candidates.map((q) => (
                  <option key={q.id} value={String(q.id)}>
                    {earlier.indexOf(q) + 1}. {q.prompt.slice(0, 48)}
                  </option>
                ))}
              </Select>
            </Field>

            {(mode === "HIGH" || mode === "LOW") && source && (
              <Field
                label={mode === "HIGH" ? "A high score means" : "A low score means"}
                htmlFor={`${idPrefix}-cond-n`}
                hint={
                  mode === "HIGH"
                    ? `${draft.condition_value} or more, out of ${source.scale_max}.`
                    : `Less than ${draft.condition_value}, out of ${source.scale_max}.`
                }
              >
                <Input
                  id={`${idPrefix}-cond-n`}
                  type="number"
                  min={source.scale_min}
                  max={source.scale_max}
                  value={typeof draft.condition_value === "number" ? draft.condition_value : ""}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      condition_value: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
            )}

            {(mode === "PICKED" || mode === "NOT_PICKED") && source && (
              <Field label={mode === "PICKED" ? "Which answers" : "Which answers to exclude"}>
                <div className="space-y-1.5">
                  {hasDuplicateOptions && (
                    <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                      “{source.prompt.slice(0, 30)}” has more than one option with the same
                      name, so a rule cannot tell them apart. Rename them on that question.
                    </p>
                  )}
                  {options.map((opt, i) => {
                    const chosen = Array.isArray(draft.condition_value)
                      ? draft.condition_value.map(String)
                      : [];
                    return (
                      <Checkbox
                        // Keyed by INDEX, not by text — two options with the same name gave
                        // React duplicate keys and made every one of them render as ticked
                        // the moment any single one was.
                        key={`${opt}-${i}`}
                        label={opt}
                        checked={chosen.includes(opt)}
                        onChange={(e) =>
                          onChange({
                            ...draft,
                            condition_value: e.target.checked
                              ? [...chosen, opt]
                              : chosen.filter((c) => c !== opt),
                          })
                        }
                      />
                    );
                  })}
                </div>
              </Field>
            )}

            {/* The finished rule, restated in English. The single biggest thing that makes
                this readable without knowing what any of the controls are called. */}
            {preview() && (
              <p className="rounded-lg bg-card px-3 py-2 text-[13px] font-medium text-foreground">
                {preview()}
              </p>
            )}
            <p className="text-[12px] text-muted-foreground">
              Students who don’t match never see this question, and anything they had already
              put in it is discarded.
            </p>
          </div>
        )}
      </div>
    </Field>
  );
}

/** The reasons this draft cannot be saved, rendered where the author is looking. */
export function DraftProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <Alert tone="warning" title={problems[0]}>
      {problems.length > 1 ? problems.slice(1).join(" ") : undefined}
    </Alert>
  );
}
