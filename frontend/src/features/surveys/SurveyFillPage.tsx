"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  EyeOff,
  MessageSquare,
  UserRound,
} from "lucide-react";
import { Alert, HeroPage, PageHero, Skeleton, Textarea } from "@/components/ui";
// The house devices, so a survey reads as part of the same product as the classroom.
import { Button, buttonClassName, Card, EmptyState, ErrorState } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";
import {
  QuestionImage,
  SurveyQuestionField,
  isAnswered,
  labelId,
  wantsFollowUp,
} from "./SurveyQuestionField";
import type { SurveyAnswerValue, SurveyQuestion } from "./surveysApi";
import { isValidSurveyId, useRespond, useSurvey } from "./surveysHooks";

const questionAnchor = (q: SurveyQuestion) => `survey-card-${q.id}`;

export function SurveyFillPage({ surveyId }: { surveyId: number }) {
  const survey = useSurvey(surveyId);
  const respond = useRespond(surveyId);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [anonymous, setAnonymous] = useState(false);
  const [done, setDone] = useState(false);
  const [doneAnonymously, setDoneAnonymously] = useState(false);
  // Set only when Submit is pressed with something missing. Until then the form stays quiet:
  // marking a question red before the student has reached it is nagging, not help.
  const [showMissing, setShowMissing] = useState(false);

  const questions = useMemo(() => survey.data?.questions ?? [], [survey.data]);

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

  /** The questions that stand between the student and Submit, in page order. */
  const missing = useMemo(
    () =>
      questions.filter((q) => {
        const value = answers[String(q.id)] ?? null;
        if (q.is_required && !isAnswered(value)) return true;
        // A follow-up the author made mandatory is as blocking as the answer above it, and
        // the server refuses the whole submission over it — so it has to be findable here.
        if (
          q.follow_up_required &&
          wantsFollowUp(q, value) &&
          !(followUps[String(q.id)] ?? "").trim()
        ) {
          return true;
        }
        return false;
      }),
    [questions, answers, followUps],
  );

  const setAnswer = useCallback((q: SurveyQuestion, value: SurveyAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [String(q.id)]: value }));
  }, []);

  async function submit() {
    if (missing.length > 0) {
      // Say WHICH, and take them there. A greyed-out button on a twenty-question form is a
      // puzzle: the student can see they are blocked and not what by.
      setShowMissing(true);
      // By id rather than a ref map: the kit's Card spreads its extra props onto the DOM
      // node but does not forward a ref, so `ref` on a <Card> is a type error and, if it
      // compiled, would land on nothing.
      document
        .getElementById(questionAnchor(missing[0]))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    try {
      const result = await respond.mutateAsync({
        answers,
        follow_ups: followUps,
        anonymous: anonymous && Boolean(survey.data?.allow_anonymous),
      });
      // What the SERVER recorded, not what was asked for — the two differ if the author
      // never turned anonymity on, and the thank-you card must not claim otherwise.
      setDoneAnonymously(Boolean(result?.is_anonymous));
      setDone(true); // only on success — a failed submit must keep the answers on screen
    } catch {
      // `respond.isError` already renders the alert above; swallowing here only stops the
      // rejection going unhandled.
    }
  }

  // ── the four branches, in order ───────────────────────────────────────────
  //
  // The invalid-id branch comes FIRST and is not one of the four. A disabled react-query v5
  // query reports status "pending" forever, so /surveys/abc used to render skeletons that
  // never resolved — a page that looked like it was loading and never was.
  if (!isValidSurveyId(surveyId)) {
    return (
      <HeroPage width="narrow">
        <BackToSurveys />
        <Card className="cr-card mt-4">
          <EmptyState
            icon={ClipboardList}
            title="That isn't a survey link"
            description="The address is missing a survey number. The surveys page lists everything you can answer."
            action={
              <Link href="/surveys" className={buttonClassName({ variant: "secondary" })}>
                Back to surveys
              </Link>
            }
          />
        </Card>
      </HeroPage>
    );
  }

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
                <Link href="/surveys" className={buttonClassName({ variant: "secondary" })}>
                  Back to surveys
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

  if (!survey.data || questions.length === 0) {
    return (
      <HeroPage width="narrow">
        <BackToSurveys />
        <Card className="cr-card mt-4">
          <EmptyState
            icon={ClipboardList}
            title={survey.data ? "This survey has no questions yet" : "This survey isn't open yet"}
            description={
              survey.data
                ? "Nothing to answer here at the moment. It will appear on your surveys page once there is."
                : "It may have closed, or it isn't published yet. The surveys page lists everything you can answer right now."
            }
            action={
              <Link href="/surveys" className={buttonClassName({ variant: "secondary" })}>
                Back to surveys
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
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                Your points have been added.
              </p>
              {done && doneAnonymously && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-[13px] font-semibold text-muted-foreground">
                  <EyeOff className="h-3.5 w-3.5" aria-hidden /> Sent without your name
                </p>
              )}
            </div>
            <Link
              href="/surveys"
              className={buttonClassName({ variant: "secondary", className: "mt-2" })}
            >
              Back to surveys
            </Link>
          </div>
        </Card>
      </HeroPage>
    );
  }

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
            { label: "Questions", value: questions.length },
            { label: "Earns you", value: "Points", accent: true },
          ]}
        />
        {survey.data.image_url && (
          <div className="border-t border-border p-4">
            <QuestionImage src={survey.data.image_url} alt="" />
          </div>
        )}
      </Card>

      {respond.isError && (
        <Alert tone="danger" title="Couldn't send your answers">
          {(respond.error as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail || "Those answers weren't accepted."}
        </Alert>
      )}

      {questions.map((q, i) => {
        const value = answers[String(q.id)] ?? null;
        const openFollowUp = wantsFollowUp(q, value);
        const isMissing = showMissing && missing.includes(q);
        return (
          <Card
            key={q.id}
            id={questionAnchor(q)}
            className={cn(
              "cr-card space-y-3 scroll-mt-24",
              isMissing && "border-rose-400/70 ring-1 ring-rose-400/40",
            )}
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
          >
            <div className="flex items-start gap-[15px]">
              {/* The homework detail numbers its instruction steps exactly this way. */}
              <span
                className={cn(
                  "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-sm font-extrabold",
                  isMissing ? "bg-rose-500/10 text-rose-600" : "bg-primary/10 text-primary",
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p id={labelId(q)} className="text-[16px] font-bold text-foreground">
                  {q.prompt}
                  {/* Same required marker the kit's Field renders, announced with the label. */}
                  {q.is_required && <span className="ml-0.5 text-rose-500">*</span>}
                </p>
                {q.help_text && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{q.help_text}</p>
                )}
              </div>
            </div>

            {q.image_url && <QuestionImage src={q.image_url} alt="" />}

            <SurveyQuestionField question={q} value={value} onChange={(v) => setAnswer(q, v)} />

            {/* Revealed by the answer above it. The placeholder is the author's own question,
                and it clears itself the moment the student types — no JS involved. */}
            {openFollowUp && (
              <div className="cr-rowin space-y-1.5 rounded-xl border border-border bg-surface-2 p-3">
                <label
                  htmlFor={`survey-followup-${q.id}`}
                  className="text-[13px] font-bold text-foreground"
                >
                  {q.follow_up_required ? "Please tell us more" : "Anything you'd like to add?"}
                  {q.follow_up_required ? (
                    <span className="ml-0.5 text-rose-500">*</span>
                  ) : (
                    <span className="ml-1.5 font-medium text-muted-foreground">Optional</span>
                  )}
                </label>
                <Textarea
                  id={`survey-followup-${q.id}`}
                  rows={3}
                  placeholder={q.follow_up_placeholder || undefined}
                  value={followUps[String(q.id)] ?? ""}
                  onChange={(e) =>
                    setFollowUps((prev) => ({ ...prev, [String(q.id)]: e.target.value }))
                  }
                />
              </div>
            )}

            {isMissing && (
              <p className="text-[13px] font-semibold text-rose-600">
                {q.is_required && !isAnswered(value)
                  ? "This one still needs an answer."
                  : "Please add a short note to go with your answer."}
              </p>
            )}
          </Card>
        );
      })}

      {survey.data.allow_anonymous && (
        <Card className="cr-card space-y-2.5">
          <p className="text-[15px] font-bold text-foreground">How should this be sent?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <AnonymityChoice
              icon={UserRound}
              label="With my name"
              hint="Staff can see who wrote it."
              selected={!anonymous}
              onSelect={() => setAnonymous(false)}
            />
            <AnonymityChoice
              icon={EyeOff}
              label="Anonymously"
              hint="Your name is kept off the results."
              selected={anonymous}
              onSelect={() => setAnonymous(true)}
            />
          </div>
        </Card>
      )}

      <Card className="cr-card flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs font-semibold text-muted-foreground">
          {missing.length === 0
            ? "Ready to send."
            : `${missing.length} question${missing.length === 1 ? "" : "s"} still to answer.`}
        </p>
        {/* Deliberately NOT disabled while something is missing. A dead button explains
            nothing; pressing it scrolls to the first gap and marks it. */}
        <Button
          className="shrink-0"
          icon={ClipboardList}
          loading={respond.isPending}
          onClick={submit}
        >
          {respond.isPending ? "Sending…" : "Submit"}
        </Button>
      </Card>
    </HeroPage>
  );
}

function AnonymityChoice({
  icon: Icon,
  label,
  hint,
  selected,
  onSelect,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "ds-ring flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-foreground">{label}</span>
        <span className="block text-[12px] font-medium text-muted-foreground">{hint}</span>
      </span>
    </button>
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
