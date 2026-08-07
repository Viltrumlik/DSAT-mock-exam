"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import ErrorPanel from "@/components/ErrorPanel";
import { cn } from "@/lib/cn";
import type { SurveyAnswerValue, SurveyQuestion } from "./surveysApi";
import { useSurvey, useRespond } from "./surveysHooks";

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue;
  onChange: (v: SurveyAnswerValue) => void;
}) {
  switch (question.question_type) {
    case "LONG_TEXT":
      return (
        <textarea rows={4} className={inputClass} value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)} />
      );
    case "DATE":
      return (
        <input type="date" className={inputClass} value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)} />
      );
    case "SCALE": {
      const steps = Array.from(
        { length: question.scale_max - question.scale_min + 1 },
        (_, i) => question.scale_min + i,
      );
      return (
        <div className="flex flex-wrap gap-2">
          {steps.map((n) => (
            <button key={n} type="button" onClick={() => onChange(n)}
              className={cn(
                "h-10 w-10 rounded-xl border text-sm font-bold",
                value === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-surface-2",
              )}>
              {n}
            </button>
          ))}
        </div>
      );
    }
    case "SINGLE_CHOICE":
      return (
        <div className="space-y-1.5">
          {question.options.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-2">
              <input type="radio" name={`q${question.id}`} checked={value === opt}
                onChange={() => onChange(opt)} className="accent-primary" />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    case "MULTI_CHOICE": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          {question.options.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={picked.includes(opt)} className="accent-primary"
                onChange={() =>
                  onChange(picked.includes(opt) ? picked.filter((x) => x !== opt) : [...picked, opt])
                } />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    default:
      return (
        <input className={inputClass} value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)} />
      );
  }
}

export function SurveyFillPage({ surveyId }: { surveyId: number }) {
  const router = useRouter();
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
    return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  }
  if (survey.isError || !survey.data) {
    return (
      <ErrorPanel
        title="Survey not available"
        message="It may have closed, or it isn't published yet."
        actionLabel="Back to surveys"
        onAction={() => router.push("/surveys")}
      />
    );
  }

  if (done || survey.data.already_completed) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-base font-bold text-foreground">Thanks — your answers are in.</p>
            <p className="text-sm text-muted-foreground">Your points have been added.</p>
            <button type="button" onClick={() => router.push("/surveys")}
              className="mt-2 rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-surface-2">
              Back to surveys
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function submit() {
    await respond.mutateAsync(answers);
    setDone(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={survey.data.title} description={survey.data.description || undefined} />

      {respond.isError && (
        <ErrorPanel
          message={
            (respond.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            "Those answers weren't accepted."
          }
        />
      )}

      <div className="space-y-3">
        {survey.data.questions.map((q, i) => (
          <Card key={q.id}>
            <CardHeader>
              <CardTitle>
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {q.prompt}
                {q.is_required && <span className="ml-1 text-rose-500">*</span>}
              </CardTitle>
              {q.help_text && <CardDescription>{q.help_text}</CardDescription>}
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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {missingRequired ? "Answer the questions marked * to finish." : "Ready to send."}
        </p>
        <button type="button" disabled={missingRequired || respond.isPending} onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <ClipboardList className="h-4 w-4" />
          {respond.isPending ? "Sending…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
