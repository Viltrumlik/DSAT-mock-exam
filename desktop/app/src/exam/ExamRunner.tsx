import { useState } from "react";
import { Bookmark, BookmarkCheck, Grid3x3, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Attempt, ExamQuestion } from "./types";
import { formatClock, isReadingWriting, isStudentResponse, parseOptions } from "./util";
import { renderExamHtml, SafeHtml } from "./richText";
import { useCountdown, useRunner, type RunnerState } from "./useExamState";

const BRAND = "#2a68c0";

/**
 * The native exam runner — the test-taking surface, rebuilt fresh over the preserved server
 * contract (see exam/types.ts). This increment renders a live module from an attempt: Bluebook-
 * style frame, server-anchored countdown, two-pane Reading & Writing / single-pane Math with
 * KaTeX, multiple-choice + grid-in, answer eliminator, flagging, and question navigation.
 *
 * Autosave, module submit, the review page and the midterm lockdown handshake are the next
 * increments; here the work lives locally and the timer counts a mock module down.
 */
export function ExamRunner({ attempt, onExit }: { attempt: Attempt; onExit: () => void }) {
  const mod = attempt.current_module_details;
  const r = useRunner(attempt);
  const remaining = useCountdown(attempt);
  const [showTimer, setShowTimer] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  if (!mod || mod.questions.length === 0) {
    return (
      <div className="ds-app flex h-screen items-center justify-center bg-background text-muted-foreground">
        This module has no questions.
      </div>
    );
  }

  const twoPane = isReadingWriting(attempt.practice_test_details.subject);
  const q = mod.questions[r.index];
  const count = mod.questions.length;

  return (
    <div className="ds-app relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Header
        title={attempt.practice_test_details.title}
        moduleLabel={`Module ${mod.module_order}`}
        remaining={remaining}
        showTimer={showTimer}
        onToggleTimer={() => setShowTimer((v) => !v)}
        onExit={onExit}
      />

      <div className="min-h-0 flex-1">
        {twoPane ? (
          <div className="mx-auto flex h-full max-w-[1400px]">
            <PassagePane q={q} />
            <div className="w-px shrink-0 bg-border" />
            <div className="h-full w-1/2 overflow-y-auto px-8 py-7">
              <QuestionHeader q={q} number={r.index + 1} r={r} />
              {q.question_prompt ? (
                <SafeHtml
                  block
                  className="mb-5 text-[15px] font-semibold leading-relaxed text-foreground"
                  html={renderExamHtml(q.question_prompt)}
                />
              ) : null}
              <AnswerArea q={q} r={r} />
            </div>
          </div>
        ) : (
          <div className="mx-auto h-full max-w-3xl overflow-y-auto px-8 py-8">
            <QuestionHeader q={q} number={r.index + 1} r={r} />
            {q.question_image ? (
              <img src={q.question_image} alt="" className="mb-5 max-w-full rounded-lg border border-border" />
            ) : null}
            <SafeHtml
              block
              className="mb-6 text-[16px] font-medium leading-relaxed text-foreground"
              html={renderExamHtml(q.question_text)}
            />
            <AnswerArea q={q} r={r} />
          </div>
        )}
      </div>

      <Footer
        index={r.index}
        count={count}
        onPrev={r.prev}
        onNext={r.next}
        onToggleNav={() => setNavOpen((v) => !v)}
      />

      {navOpen ? (
        <Navigator questions={mod.questions} r={r} onClose={() => setNavOpen(false)} />
      ) : null}
    </div>
  );
}

function Header({
  title,
  moduleLabel,
  remaining,
  showTimer,
  onToggleTimer,
  onExit,
}: {
  title: string;
  moduleLabel: string;
  remaining: number;
  showTimer: boolean;
  onToggleTimer: () => void;
  onExit: () => void;
}) {
  const warn = remaining <= 300;
  const danger = remaining <= 60;
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{title}</p>
        <p className="text-xs font-semibold text-muted-foreground">{moduleLabel}</p>
      </div>
      <div className="flex flex-col items-center px-4">
        <span
          className="text-[22px] font-extrabold leading-none tabular-nums"
          style={{ color: danger ? "#dc2626" : warn ? "#d97706" : undefined }}
        >
          {showTimer ? formatClock(remaining) : "•  •  •"}
        </span>
        <button
          type="button"
          onClick={onToggleTimer}
          className="ds-ring mt-1 rounded text-[11px] font-bold text-muted-foreground hover:text-foreground"
        >
          {showTimer ? "Hide" : "Show"}
        </button>
      </div>
      <div className="flex flex-1 justify-end">
        <button
          type="button"
          onClick={onExit}
          className="ds-ring rounded-lg border border-border px-3.5 py-1.5 text-xs font-bold text-foreground transition hover:bg-surface-2"
        >
          Save &amp; Exit
        </button>
      </div>
    </header>
  );
}

function PassagePane({ q }: { q: ExamQuestion }) {
  return (
    <div className="h-full w-1/2 overflow-y-auto px-8 py-7">
      {q.question_image ? (
        <img src={q.question_image} alt="" className="mb-4 max-w-full rounded-lg border border-border" />
      ) : null}
      <SafeHtml block className="text-[15px] leading-[1.7] text-foreground" html={renderExamHtml(q.question_text)} />
    </div>
  );
}

function QuestionHeader({ q, number, r }: { q: ExamQuestion; number: number; r: RunnerState }) {
  const flagged = r.flagged.has(q.id);
  return (
    <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
      <span className="flex h-7 min-w-[28px] items-center justify-center rounded bg-foreground px-2 text-sm font-extrabold text-background">
        {number}
      </span>
      <button
        type="button"
        onClick={() => r.toggleFlag(q.id)}
        className="ds-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-muted-foreground transition hover:text-foreground"
      >
        {flagged ? (
          <BookmarkCheck className="h-4 w-4" style={{ color: BRAND }} />
        ) : (
          <Bookmark className="h-4 w-4" />
        )}
        {flagged ? "Marked for Review" : "Mark for Review"}
      </button>
    </div>
  );
}

function AnswerArea({ q, r }: { q: ExamQuestion; r: RunnerState }) {
  return isStudentResponse(q) ? <SprInput q={q} r={r} /> : <ChoiceList q={q} r={r} />;
}

function ChoiceList({ q, r }: { q: ExamQuestion; r: RunnerState }) {
  const opts = parseOptions(q.options);
  const selected = r.answers[q.id];
  const elim = r.eliminated[q.id] ?? new Set<string>();
  return (
    <div className="flex flex-col gap-3">
      {opts.map((o) => {
        const isSel = selected === o.key;
        const isElim = elim.has(o.key);
        return (
          <div key={o.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => r.select(q.id, o.key)}
              className={cn(
                "ds-ring group flex flex-1 items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition",
                isSel ? "border-[#2a68c0] bg-[#2a68c0]/[0.06]" : "border-border hover:border-border-strong",
                isElim && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition",
                  isSel ? "border-[#2a68c0] bg-[#2a68c0] text-white" : "border-border text-foreground",
                )}
              >
                {o.key}
              </span>
              <span className={cn("flex-1 text-[15px] leading-snug text-foreground", isElim && "line-through")}>
                {o.image ? (
                  <img src={o.image} alt="" className="max-h-40" />
                ) : (
                  <SafeHtml html={renderExamHtml(o.text)} />
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => r.toggleEliminate(q.id, o.key)}
              title={isElim ? "Undo cross out" : "Cross out"}
              className={cn(
                "ds-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition",
                isElim
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={isElim ? "" : "line-through"}>{o.key}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SprInput({ q, r }: { q: ExamQuestion; r: RunnerState }) {
  const value = r.answers[q.id] ?? "";
  return (
    <div className="max-w-xs">
      <input
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (/^[-0-9./]*$/.test(v)) r.select(q.id, v);
        }}
        maxLength={5}
        placeholder="Enter answer"
        className="ds-ring w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-lg font-bold text-foreground"
      />
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        {value ? (
          <>
            Answer preview: <span className="font-bold text-foreground">{value}</span>
          </>
        ) : (
          "Numbers, a decimal point or a fraction slash."
        )}
      </p>
    </div>
  );
}

function Footer({
  index,
  count,
  onPrev,
  onNext,
  onToggleNav,
}: {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onToggleNav: () => void;
}) {
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-border bg-card px-6 py-3">
      <div className="hidden w-40 sm:block" />
      <button
        type="button"
        onClick={onToggleNav}
        className="ds-ring inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-bold text-background"
      >
        Question {index + 1} of {count} <Grid3x3 className="h-4 w-4" />
      </button>
      <div className="flex w-40 justify-end gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          className="ds-ring rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground transition hover:bg-surface-2 disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={index === count - 1}
          className="ds-ring rounded-full px-5 py-2 text-sm font-bold text-white transition hover:brightness-[1.06] disabled:opacity-40"
          style={{ background: BRAND }}
        >
          Next
        </button>
      </div>
    </footer>
  );
}

function Navigator({
  questions,
  r,
  onClose,
}: {
  questions: ExamQuestion[];
  r: RunnerState;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/20 p-4" onClick={onClose}>
      <div
        className="quartz squircle mb-16 w-full max-w-xl p-6"
        style={{ ["--sq" as string]: "20px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-extrabold text-foreground">Go to question</p>
          <button type="button" onClick={onClose} className="ds-ring rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-8 gap-2">
          {questions.map((qq, i) => {
            const answered = !!r.answers[qq.id];
            const flagged = r.flagged.has(qq.id);
            const current = i === r.index;
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => {
                  r.goTo(i);
                  onClose();
                }}
                className={cn(
                  "relative flex h-10 items-center justify-center rounded-lg border text-sm font-bold transition",
                  current ? "border-[#2a68c0] ring-2 ring-[#2a68c0]/30" : "border-border",
                  answered ? "bg-[#2a68c0] text-white" : "bg-card text-foreground hover:bg-surface-2",
                )}
              >
                {i + 1}
                {flagged ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#d97706] ring-2 ring-card" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex items-center justify-center gap-5 text-[11px] font-semibold text-muted-foreground">
          <Legend swatch="bg-[#2a68c0]" label="Answered" />
          <Legend swatch="border border-border bg-card" label="Unanswered" />
          <Legend dot label="Flagged" />
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, dot, label }: { swatch?: string; dot?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot ? (
        <span className="h-2.5 w-2.5 rounded-full bg-[#d97706]" />
      ) : (
        <span className={cn("h-3 w-3 rounded", swatch)} />
      )}
      {label}
    </span>
  );
}
