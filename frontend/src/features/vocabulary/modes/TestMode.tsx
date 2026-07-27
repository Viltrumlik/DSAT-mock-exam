"use client";

/**
 * Test mode — no clock, every word once, question kind cycling MCQ →
 * True/False → Spelling. No feedback until the end: the review screen is where
 * the learning happens, so it shows what was answered next to what was correct.
 */

import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { SessionResult, VocabSetDetail } from "../types";
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
    const next = [...answers, answer];
    setAnswers(next);
    setTyped("");
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      return;
    }
    setDone(true);
    session.finish(
      next.map<SessionResult>((a) => ({ word_id: a.question.wordId, correct: a.correct })),
    );
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
          {index + 1} / {questions.length}
        </ModePill>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        {current?.kind === "mcq" ? (
          <>
            <QuestionPrompt kicker="Which word means…" text={current.definition} />
            <div className="grid gap-3">
              {current.options.map((option, i) => (
                <button
                  key={`${current.wordId}-${option}`}
                  type="button"
                  onClick={() => answerMcq(i)}
                  className="ds-ring cr-press flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left text-[15px] font-semibold text-foreground shadow-card hover:border-primary/40 hover:bg-primary-soft"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-bold text-muted-foreground">
                    {CHOICE_LABELS[i]}
                  </span>
                  <span>{option}</span>
                </button>
              ))}
            </div>
            <p className="text-center text-[12px] text-muted-foreground">
              Press <Kbd>A</Kbd>–<Kbd>D</Kbd> to answer
            </p>
          </>
        ) : null}

        {current?.kind === "truefalse" ? (
          <>
            <QuestionPrompt
              kicker="True or false?"
              text={`“${current.word}” means “${current.shownDefinition}”`}
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => answerTrueFalse(true)}
                className="ds-ring cr-press inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-success/25 bg-success-soft text-[15px] font-bold text-success-foreground hover:border-success/40"
              >
                <CheckCircle2 className="h-5 w-5" /> True
              </button>
              <button
                type="button"
                onClick={() => answerTrueFalse(false)}
                className="ds-ring cr-press inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-danger/25 bg-danger-soft text-[15px] font-bold text-danger-foreground hover:border-danger/40"
              >
                <XCircle className="h-5 w-5" /> False
              </button>
            </div>
            <p className="text-center text-[12px] text-muted-foreground">
              Press <Kbd>T</Kbd> or <Kbd>F</Kbd>
            </p>
          </>
        ) : null}

        {current?.kind === "spelling" ? (
          <SpellingQuestionView
            key={current.wordId}
            word={current.word}
            definition={current.definition}
            revealIndex={current.revealIndex}
            value={typed}
            onChange={setTyped}
            onSubmit={answerSpelling}
          />
        ) : null}
      </div>
    </ModeFrame>
  );
}

function QuestionPrompt({ kicker, text }: { kicker: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-center shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{kicker}</p>
      <p className="mt-3 text-xl font-semibold text-foreground sm:text-2xl">{text}</p>
    </div>
  );
}

function SpellingQuestionView({
  word,
  definition,
  revealIndex,
  value,
  onChange,
  onSubmit,
}: {
  word: string;
  definition: string;
  revealIndex: number;
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
      <QuestionPrompt kicker="Spell the word that means…" text={definition} />

      <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Letters to fill in">
        {maskWord(word, revealIndex).map((ch, i) => (
          <span
            key={`${i}-${ch}`}
            className={cn(
              "inline-flex h-11 w-8 items-center justify-center rounded-lg border text-lg font-extrabold uppercase",
              ch === "_"
                ? "border-border bg-surface-2 text-transparent"
                : "border-primary/30 bg-primary-soft text-primary",
            )}
          >
            {ch === "_" ? "_" : ch}
          </span>
        ))}
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
      <p className="text-center text-[12px] text-muted-foreground">
        Press <Kbd>Enter</Kbd> to submit
      </p>
    </form>
  );
}

function TestReview({ wrong, set }: { wrong: GradedAnswer[]; set: VocabSetDetail }) {
  return (
    <div className="flex flex-col gap-6">
      {wrong.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h3 className="ds-h4">What to review</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {wrong.map((a, i) => (
              <li key={`${a.question.wordId}-${i}`} className="border-t border-border pt-4 first:border-0 first:pt-0">
                <p className="text-[13px] text-muted-foreground">{promptOf(a)}</p>
                <div className="mt-2 flex flex-col gap-1 text-sm">
                  <p className="text-danger-foreground">
                    <span className="font-semibold">You answered:</span> {a.given}
                  </p>
                  <p className="text-success-foreground">
                    <span className="font-semibold">Correct answer:</span> {a.expected}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h3 className="ds-h4">All the answers</h3>
        <ul className="mt-4 flex flex-col gap-3">
          {set.words.map((w) => (
            <li key={w.id} className="flex flex-col gap-0.5 border-t border-border pt-3 first:border-0 first:pt-0">
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
