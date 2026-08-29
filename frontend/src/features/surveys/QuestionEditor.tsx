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
  scale_min: number;
  scale_max: number;
  scale_low_label: string;
  scale_high_label: string;
  follow_up_threshold: number | null;
  follow_up_placeholder: string;
  follow_up_required: boolean;
}

export const BLANK_DRAFT: QuestionDraft = {
  prompt: "",
  help_text: "",
  question_type: "SHORT_TEXT",
  is_required: false,
  options: ["", ""],
  follow_up_options: [],
  scale_min: 1,
  scale_max: 5,
  scale_low_label: "",
  scale_high_label: "",
  follow_up_threshold: null,
  follow_up_placeholder: "",
  follow_up_required: false,
};

export function draftFrom(q: SurveyQuestion): QuestionDraft {
  return {
    prompt: q.prompt,
    help_text: q.help_text,
    question_type: q.question_type,
    is_required: q.is_required,
    options: q.options.length ? [...q.options] : ["", ""],
    follow_up_options: [...(q.follow_up_options ?? [])],
    scale_min: q.scale_min,
    scale_max: q.scale_max,
    scale_low_label: q.scale_low_label,
    scale_high_label: q.scale_high_label,
    follow_up_threshold: q.follow_up_threshold,
    follow_up_placeholder: q.follow_up_placeholder,
    follow_up_required: q.follow_up_required,
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
    scale_min: numeric ? draft.scale_min : 1,
    scale_max: numeric ? draft.scale_max : 5,
    scale_low_label: draft.question_type === "RATING" ? draft.scale_low_label.trim() : "",
    scale_high_label: draft.question_type === "RATING" ? draft.scale_high_label.trim() : "",
    follow_up_threshold: numeric ? draft.follow_up_threshold : null,
    follow_up_placeholder: draft.follow_up_placeholder.trim(),
    follow_up_required: draft.follow_up_required,
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
}: {
  draft: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  image: File | null;
  onImageChange: (file: File | null) => void;
  existingImageUrl?: string | null;
  idPrefix: string;
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

/** The reasons this draft cannot be saved, rendered where the author is looking. */
export function DraftProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <Alert tone="warning" title={problems[0]}>
      {problems.length > 1 ? problems.slice(1).join(" ") : undefined}
    </Alert>
  );
}
