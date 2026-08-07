"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, RefreshCw } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
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

  if (survey.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (survey.isError) {
    // A 404 means the survey really is gone, closed or unpublished. Anything else means the
    // request failed, and saying "not available" there would state as fact something we do
    // not know — the survey may be sitting there perfectly fine behind a dropped connection.
    const status = (survey.error as { response?: { status?: number } })?.response?.status;
    const notFound = status === 404 || status === 403;
    return (
      <div className="space-y-4">
        <Alert tone="danger" title={notFound ? "Survey not available" : "That didn't load"}>
          {notFound
            ? "It may have closed, or it isn't published yet."
            : "Nothing has been lost — the survey just couldn't be fetched."}
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            leftIcon={<RefreshCw />}
            onClick={() => void survey.refetch()}
          >
            Try again
          </Button>
          <Link href="/surveys">
            <Button variant="ghost">Back to surveys</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (!survey.data) {
    return (
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
    );
  }

  if (done || survey.data.already_completed) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-soft">
              <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
            </span>
            <div>
              <p className="ds-h4">Thanks — your answers are in.</p>
              <p className="mt-1 text-sm text-muted-foreground">Your points have been added.</p>
            </div>
            <Link href="/surveys" className="mt-2">
              <Button variant="secondary">Back to surveys</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
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

  return (
    <div className="space-y-6">
      <PageHeader title={survey.data.title} description={survey.data.description || undefined} />

      {respond.isError && (
        <Alert tone="danger" title="Couldn't send your answers">
          {(respond.error as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail || "Those answers weren't accepted."}
        </Alert>
      )}

      <div className="space-y-4">
        {survey.data.questions.map((q, i) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle id={labelId(q)}>
                  <span className="ds-num mr-2 text-muted-foreground">{i + 1}.</span>
                  {q.prompt}
                  {/* Same required marker the kit's Field renders, and announced with the label. */}
                  {q.is_required && <span className="ml-0.5 text-danger">*</span>}
                </CardTitle>
                {q.help_text && <CardDescription>{q.help_text}</CardDescription>}
              </div>
            </CardHeader>
            <CardContent>
              <QuestionField
                question={q}
                value={answers[String(q.id)] ?? null}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [String(q.id)]: v }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {missingRequired ? "Answer the questions marked * to finish." : "Ready to send."}
        </p>
        <Button
          className="shrink-0"
          leftIcon={<ClipboardList />}
          loading={respond.isPending}
          disabled={missingRequired}
          onClick={submit}
        >
          {respond.isPending ? "Sending…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
