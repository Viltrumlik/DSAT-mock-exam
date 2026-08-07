"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardList, MessageSquare } from "lucide-react";
import {
  Alert,
  Checkbox,
  HeroPage,
  Input,
  PageHero,
  Skeleton,
  Textarea,
} from "@/components/ui";
// The house devices, so a survey reads as part of the same product as the classroom.
import { Button, Card, EmptyState, ErrorState } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";
import type { SurveyAnswerValue, SurveyQuestion } from "./surveysApi";
import { useSurvey, useRespond } from "./surveysHooks";

/** The card title is the question's visible label, so controls point at it by id. */
const controlId = (q: SurveyQuestion) => `survey-q-${q.id}`;
const labelId = (q: SurveyQuestion) => `survey-q-${q.id}-label`;

const choiceRow =
  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors";

function QuestionField({
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

export function SurveyFillPage({ surveyId }: { surveyId: number }) {
  const survey = useSurvey(surveyId);
  const respond = useRespond(surveyId);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [done, setDone] = useState(false);

  // Checkboxes need a real array from the start; everything else is fine as undefined.
  useEffect(() => {
    if (!survey.data) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of survey.data.questions) {
        if (q.question_type === "MULTI_CHOICE" && next[String(q.id)] === undefined) {
          next[String(q.id)] = [];
        }
      }
      return next;
    });
  }, [survey.data]);

  const missingRequired = useMemo(() => {
    if (!survey.data) return false;
    return survey.data.questions.some((q) => {
      if (!q.is_required) return false;
      const v = answers[String(q.id)];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    });
  }, [survey.data, answers]);

  if (survey.isPending) {
    return (
      <HeroPage width="narrow" className="space-y-5">
        <Skeleton className="h-40 rounded-2xl" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </HeroPage>
    );
  }
  if (survey.isError) {
    // A 404 means the survey really is gone, closed or unpublished. Anything else means the
    // request failed, and saying "not available" there would state as fact something we do
    // not know — the survey may be sitting there perfectly fine behind a dropped connection.
    const status = (survey.error as { response?: { status?: number } })?.response?.status;
    const notFound = status === 404 || status === 403;
    return (
      <HeroPage width="narrow">
        <BackToSurveys />
        <Card className="cr-card mt-4">
          {notFound ? (
            <EmptyState
              icon={ClipboardList}
              title="Survey not available"
              description="It may have closed, or it isn't published yet."
              action={
                <Link href="/surveys">
                  <Button variant="secondary">Back to surveys</Button>
                </Link>
              }
            />
          ) : (
            <ErrorState
              title="That didn't load"
              message="Nothing has been lost — the survey just couldn't be fetched."
              onRetry={() => void survey.refetch()}
            />
          )}
        </Card>
      </HeroPage>
    );
  }
  if (!survey.data) {
    return (
      <HeroPage width="narrow">
        <BackToSurveys />
        <Card className="cr-card mt-4">
          <EmptyState
            icon={ClipboardList}
            title="This survey isn't open yet"
            description="It may have closed, or it isn't published yet. The surveys page lists everything you can answer right now."
            action={
              <Link href="/surveys">
                <Button variant="secondary">Back to surveys</Button>
              </Link>
            }
          />
        </Card>
      </HeroPage>
    );
  }

  if (done || survey.data.already_completed) {
    return (
      <HeroPage width="narrow">
        <Card className="cr-card">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="cr-daypop flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-extrabold text-foreground">Thanks — your answers are in.</p>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">Your points have been added.</p>
            </div>
            <Link href="/surveys" className="mt-2">
              <Button variant="secondary">Back to surveys</Button>
            </Link>
          </div>
        </Card>
      </HeroPage>
    );
  }

  async function submit() {
    try {
      await respond.mutateAsync(answers);
      setDone(true);   // only on success — a failed submit must keep the answers on screen
    } catch {
      // `respond.isError` already renders the alert above; swallowing here only stops the
      // rejection going unhandled.
    }
  }

  const total = survey.data.questions.length;

  return (
    <HeroPage width="narrow" className="space-y-5">
      <BackToSurveys />

      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Survey"
          icon={MessageSquare}
          title={survey.data.title}
          description={survey.data.description || undefined}
          tiles={[
            { label: "Questions", value: total },
            { label: "Earns you", value: "Points", accent: true },
          ]}
        />
      </Card>

      {respond.isError && (
        <Alert tone="danger" title="Couldn't send your answers">
          {(respond.error as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail || "Those answers weren't accepted."}
        </Alert>
      )}

      {survey.data.questions.map((q, i) => (
        <Card key={q.id} className="cr-card space-y-3" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
          <div className="flex items-start gap-[15px]">
            {/* The homework detail numbers its instruction steps exactly this way. */}
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-sm font-extrabold text-primary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p id={labelId(q)} className="text-[16px] font-bold text-foreground">
                {q.prompt}
                {/* Same required marker the kit's Field renders, and announced with the label. */}
                {q.is_required && <span className="ml-0.5 text-rose-500">*</span>}
              </p>
              {q.help_text && (
                <p className="mt-0.5 text-sm text-muted-foreground">{q.help_text}</p>
              )}
            </div>
          </div>
          <QuestionField
            question={q}
            value={answers[String(q.id)] ?? null}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [String(q.id)]: v }))}
          />
        </Card>
      ))}

      <Card className="cr-card flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs font-semibold text-muted-foreground">
          {missingRequired ? "Answer the questions marked * to finish." : "Ready to send."}
        </p>
        <Button
          className="shrink-0"
          icon={ClipboardList}
          loading={respond.isPending}
          disabled={missingRequired}
          onClick={submit}
        >
          {respond.isPending ? "Sending…" : "Submit"}
        </Button>
      </Card>
    </HeroPage>
  );
}

/** The homework detail's way back, so a survey leaves the same way a homework does. */
function BackToSurveys() {
  return (
    <Link
      href="/surveys"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to surveys
    </Link>
  );
}
