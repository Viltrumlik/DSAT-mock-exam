"use client";

/**
 * Test mode — no clock, every word once, question kind cycling MCQ →
 * True/False → Spelling. No feedback until the end: the review screen is where
 * the learning happens, so it shows what was answered next to what was correct.
 *
 * Accent: **success** — the same one `STUDY_MODE_ACCENT.test` gives the Test card
 * on the set page. Nothing is graded while answering, so green can't be mistaken
 * for "correct" here; on the review screen success/danger go back to meaning
 * right/wrong and the accent stays out of the way.
 */

import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Scale,
  SpellCheck,
  Target,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Badge, Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { VocabSetDetail } from "../types";
import { Kbd, ModeBoot, ModeFrame, ModeOutcome, ModePill, ModeStartError } from "./ModeChrome";
import { useModeKeys } from "./useModeKeys";
import { useModeSession } from "./useModeSession";
import {
  accuracyPercent,
  buildTestQuestions,
  CHOICE_LABELS,
  maskWord,
  spellingIsCorrect,
} from "./utils";
import type { DistractorWord, TestQuestion } from "./utils";

const TITLE = "Test";

/** Letters get a tile; spaces and hyphens are structure, not answer. */
const LETTER = /\p{L}/u;

/** Row-entrance stagger, capped so a long answer list still lands quickly. */
const stagger = (i: number, step = 45) => ({ animationDelay: `${Math.min(i, 12) * step}ms` });

export function TestMode({ setId }: { setId: number }) {
  return (
    <ModeBoot setId={setId} title={TITLE}>
      {({ set, pool, runKey, restart }) => (
        <TestRunner key={runKey} setId={setId} set={set} pool={pool} onRestart={restart} />
      )}
    </ModeBoot>
  );
}

interface GradedAnswer {
  question: TestQuestion;
  /** What the student picked or typed, as shown back to them in the review. */
  given: string;
  /** What they should have picked or typed. */
  expected: string;
  correct: boolean;
}

function TestRunner({
  setId,
  set,
  pool,
  onRestart,
}: {
  setId: number;
  set: VocabSetDetail;
  pool: DistractorWord[];
  onRestart: () => void;
}) {
  const session = useModeSession(setId, "test");
  const [questions] = useState<TestQuestion[]>(() => buildTestQuestions(set.words, pool));

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<GradedAnswer[]>([]);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  const current = questions[index];

  const submit = (answer: GradedAnswer) => {
    setAnswers([...answers, answer]);
    setTyped("");
    // The student sees no feedback until the end, but the server hears every
    // answer as it lands — an abandoned test still records what was answered.
    session.report({ word_id: answer.question.wordId, correct: answer.correct });
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      return;
    }
    setDone(true);
    session.finish();
  };

  const answerMcq = (optionIndex: number) => {
    if (!current || current.kind !== "mcq") return;
    const picked = current.options[optionIndex];
    if (picked == null) return;
    submit({
      question: current,
      given: picked,
      expected: current.word,
      correct: optionIndex === current.answerIndex,
    });
  };

  const answerTrueFalse = (said: boolean) => {
    if (!current || current.kind !== "truefalse") return;
    submit({
      question: current,
      given: said ? "True" : "False",
      expected: current.isGenuine ? "True" : "False",
      correct: said === current.isGenuine,
    });
  };

  const answerSpelling = () => {
    if (!current || current.kind !== "spelling") return;
    submit({
      question: current,
      given: typed.trim() || "—",
      expected: current.word,
      correct: spellingIsCorrect(typed, current.word),
    });
  };

  useModeKeys(!done, (key) => {
    if (!current) return false;
    if (current.kind === "mcq") {
      const letter = CHOICE_LABELS.indexOf(key.toUpperCase() as (typeof CHOICE_LABELS)[number]);
      if (letter >= 0 && letter < current.options.length) {
        answerMcq(letter);
        return true;
      }
      const digit = Number(key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= current.options.length) {
        answerMcq(digit - 1);
        return true;
      }
      return false;
    }
    if (current.kind === "truefalse") {
      if (key === "t" || key === "T" || key === "1" || key === "ArrowLeft") {
        answerTrueFalse(true);
        return true;
      }
      if (key === "f" || key === "F" || key === "2" || key === "ArrowRight") {
        answerTrueFalse(false);
        return true;
      }
    }
    return false;
  });

  if (session.fatal && session.error) {
    return <ModeStartError setId={setId} title={TITLE} message={session.error} onRetry={session.retry} />;
  }

  if (done) {
    const correct = answers.filter((a) => a.correct).length;
    const wrong = answers.filter((a) => !a.correct);
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <ModeOutcome
          setId={setId}
          title={wrong.length === 0 ? "Perfect test" : "Test complete"}
          description={
            wrong.length === 0
              ? `All ${answers.length} questions right.`
              : `${wrong.length} to look at again — they're listed below.`
          }
          stats={[
            { label: "Correct", value: `${correct}/${answers.length}`, tone: "success" },
            { label: "Accuracy", value: `${accuracyPercent(correct, answers.length)}%` },
            { label: "Missed", value: String(wrong.length), tone: wrong.length ? "danger" : "neutral" },
          ]}
          session={session}
          onRestart={onRestart}
          restartLabel="Take it again"
        >
          <TestReview wrong={wrong} set={set} />
        </ModeOutcome>
      </ModeFrame>
    );
  }

  return (
    <ModeFrame
      setId={setId}
      title={TITLE}
      subtitle={set.title}
      progress={(index / Math.max(1, questions.length)) * 100}
      right={
        <ModePill>
          <span className="ds-num">
            {index + 1} / {questions.length}
          </span>
        </ModePill>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        {current?.kind === "mcq" ? (
          <QuestionShell
            key={current.wordId}
            icon={ListChecks}
            kicker="Which word means…"
            prompt={current.definition}
            step={index + 1}
            total={questions.length}
            hint={
              <>
                Press <Kbd>A</Kbd>–<Kbd>D</Kbd> to answer
              </>
            }
          >
            <div className="grid gap-2.5">
              {current.options.map((option, i) => (
                <button
                  key={`${current.wordId}-${option}`}
                  type="button"
                  onClick={() => answerMcq(i)}
                  style={stagger(i, 55)}
                  className="ds-ring cr-press cr-rowin group flex items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left text-[15px] font-semibold text-foreground shadow-card hover:border-success/45 hover:bg-success-soft"
                >
                  {/* Soft accent fill, not a solid one: `--success` is a light
                      mint in dark mode, so white-on-success would fail there. */}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-extrabold text-muted-foreground group-hover:bg-success-soft group-hover:text-success-foreground">
                    {CHOICE_LABELS[i]}
                  </span>
                  <span className="flex-1">{option}</span>
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-label-foreground opacity-0 group-hover:opacity-100"
                  />
                </button>
              ))}
            </div>
          </QuestionShell>
        ) : null}

        {current?.kind === "truefalse" ? (
          <QuestionShell
            key={current.wordId}
            icon={Scale}
            kicker="True or false?"
            prompt={`“${current.word}” means “${current.shownDefinition}”`}
            step={index + 1}
            total={questions.length}
            hint={
              <>
                Press <Kbd>T</Kbd> or <Kbd>F</Kbd>
              </>
            }
          >
            {/* Both choices rest on the same neutral surface — a filled green
                "True" beside a filled red "False" reads as right-vs-wrong on a
                screen where nothing has been graded yet. The glyph keeps them
                apart; the tint only arrives on hover. */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => answerTrueFalse(true)}
                className="ds-ring cr-press cr-rowin group inline-flex h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background text-[15px] font-extrabold text-foreground shadow-card hover:border-success/45 hover:bg-success-soft"
              >
                <CheckCircle2 aria-hidden className="h-6 w-6 text-success" /> True
              </button>
              <button
                type="button"
                onClick={() => answerTrueFalse(false)}
                style={stagger(1, 55)}
                className="ds-ring cr-press cr-rowin group inline-flex h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background text-[15px] font-extrabold text-foreground shadow-card hover:border-danger/45 hover:bg-danger-soft"
              >
                <XCircle aria-hidden className="h-6 w-6 text-danger" /> False
              </button>
            </div>
          </QuestionShell>
        ) : null}

        {current?.kind === "spelling" ? (
          <SpellingQuestionView
            key={current.wordId}
            word={current.word}
            definition={current.definition}
            revealIndex={current.revealIndex}
            step={index + 1}
            total={questions.length}
            value={typed}
            onChange={setTyped}
            onSubmit={answerSpelling}
          />
        ) : null}
      </div>
    </ModeFrame>
  );
}

/**
 * The one shell every question type wears: icon + kicker + prompt on a tinted
 * band, the answer area under it, the shortcut hint in the footer. Only the
 * icon and the wording change as the mode cycles.
 *
 * Entrance-only motion (`cr-cardrise`, not `cr-card`): a hover lift on the
 * shell would nudge the answer the pointer is aiming at.
 */
function QuestionShell({
  icon: Icon,
  kicker,
  prompt,
  step,
  total,
  hint,
  children,
}: {
  icon: LucideIcon;
  kicker: string;
  prompt: string;
  step: number;
  total: number;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cr-cardrise overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
      <div className="relative overflow-hidden border-b border-border bg-success-soft px-5 py-6 text-center sm:px-7 sm:py-7">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full bg-success/10" />
        <div className="relative flex items-center justify-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-card text-success shadow-card">
            <Icon aria-hidden className="h-4 w-4" />
          </span>
          <span className="ds-overline">{kicker}</span>
        </div>
        <p className="relative mt-3 text-[19px] font-bold leading-snug tracking-[-0.01em] text-foreground sm:text-[23px]">
          {prompt}
        </p>
        <p className="ds-num relative mt-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-label-foreground">
          Question {step} of {total}
        </p>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
      {hint ? (
        <div className="border-t border-border px-5 py-3 text-center text-[12px] font-medium text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SpellingQuestionView({
  word,
  definition,
  revealIndex,
  step,
  total,
  value,
  onChange,
  onSubmit,
}: {
  word: string;
  definition: string;
  revealIndex: number;
  step: number;
  total: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <QuestionShell
        icon={SpellCheck}
        kicker="Spell the word that means…"
        prompt={definition}
        step={step}
        total={total}
        hint={
          <>
            Press <Kbd>Enter</Kbd> to submit
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {/* Letter tiles: the given letter is a filled accent tile, the blanks
              are dashed wells, punctuation is bare structure. */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2" aria-label="Letters to fill in">
            {maskWord(word, revealIndex).map((ch, i) => {
              const blank = ch === "_";
              const structural = !blank && !LETTER.test(ch);
              return (
                <span
                  key={`${i}-${ch}`}
                  style={stagger(i, 30)}
                  className={cn(
                    "cr-pillin inline-flex items-center justify-center text-lg font-extrabold uppercase",
                    structural && "h-12 w-4 text-label-foreground",
                    blank && "h-12 w-9 rounded-xl border border-dashed border-border-strong bg-surface-2 pb-1 text-label-foreground",
                    !blank && !structural && "h-12 w-9 rounded-xl border border-success/40 bg-success-soft text-success-foreground shadow-card",
                  )}
                >
                  {ch === "_" ? "_" : ch}
                </span>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type the word"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputSize="lg"
              aria-label="Your spelling"
            />
            <Button type="submit" size="lg" className="shrink-0">
              Submit
            </Button>
          </div>
        </div>
      </QuestionShell>
    </form>
  );
}

/** Header row shared by the two review sections. */
function ReviewSectionHeader({
  icon: Icon,
  tone,
  title,
  description,
  count,
}: {
  icon: LucideIcon;
  tone: "danger" | "neutral";
  title: string;
  description: string;
  count: number;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-5 py-4">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          tone === "danger" ? "bg-danger-soft text-danger-foreground" : "bg-primary-soft text-primary",
        )}
      >
        <Icon aria-hidden className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="ds-h4">{title}</h3>
        <p className="ds-small">{description}</p>
      </div>
      <Badge variant={tone === "danger" ? "danger" : "neutral"}>
        <span className="ds-num">{count}</span>
      </Badge>
    </header>
  );
}

function TestReview({ wrong, set }: { wrong: GradedAnswer[]; set: VocabSetDetail }) {
  return (
    <div className="flex flex-col gap-5">
      {wrong.length > 0 ? (
        <section className="cr-cardrise overflow-hidden rounded-3xl border border-border bg-card shadow-card">
          <ReviewSectionHeader
            icon={Target}
            tone="danger"
            title="What to review"
            description="What you answered, against the right answer"
            count={wrong.length}
          />
          <ul className="flex flex-col gap-3 p-4 sm:p-5">
            {wrong.map((a, i) => (
              <li
                key={`${a.question.wordId}-${i}`}
                style={stagger(i, 60)}
                className="cr-rowin rounded-2xl border border-border bg-background p-4"
              >
                <p className="text-[13px] font-medium text-muted-foreground">{promptOf(a)}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-danger-foreground">
                      You answered
                    </p>
                    <p className="mt-1 text-sm font-bold text-foreground">{a.given}</p>
                  </div>
                  <div className="rounded-xl border border-success/25 bg-success-soft px-3.5 py-2.5">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-success-foreground">
                      Correct answer
                    </p>
                    <p className="mt-1 text-sm font-bold text-foreground">{a.expected}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="cr-cardrise overflow-hidden rounded-3xl border border-border bg-card shadow-card"
        style={{ animationDelay: wrong.length > 0 ? "90ms" : undefined }}
      >
        <ReviewSectionHeader
          icon={BookOpen}
          tone="neutral"
          title="All the answers"
          description="Every word in this set"
          count={set.words.length}
        />
        <ul className="flex flex-col p-4 sm:p-5">
          {set.words.map((w, i) => (
            <li
              key={w.id}
              style={stagger(i, 35)}
              className="cr-rowin flex flex-col gap-0.5 border-t border-border py-3 first:border-0 first:pt-0 last:pb-0"
            >
              <p className="text-sm font-bold text-foreground">{w.word}</p>
              <p className="text-[13px] text-muted-foreground">{w.definition}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Restate the question so the review reads on its own. */
function promptOf(a: GradedAnswer): string {
  if (a.question.kind === "mcq") return `Which word means “${a.question.definition}”?`;
  if (a.question.kind === "truefalse") {
    return `“${a.question.word}” means “${a.question.shownDefinition}”`;
  }
  return `Spell the word that means “${a.question.definition}”`;
}

export default TestMode;
