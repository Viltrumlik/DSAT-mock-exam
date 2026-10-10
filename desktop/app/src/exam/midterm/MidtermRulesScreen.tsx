/**
 * Midterm start screen — the rules a student reads before beginning, ported from the site's
 * MidtermRulesScreen.tsx (same copy, same layout). The FIRST thing they see: the access code is
 * asked for only after this screen. Every rule stated here is one the platform enforces; the
 * off-screen limit and the pass mark come from midtermRules, which mirrors the backend.
 *
 * In the app `fullscreenSupported` is false, as on the site inside the app: the shell makes the
 * window fullscreen itself when it locks, so the page-level fullscreen line is left out.
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import type { ElementType } from "react";
import {
  Ban,
  BatteryCharging,
  BookX,
  Calculator,
  Camera,
  ChevronRight,
  Clock,
  Flag,
  KeyRound,
  ListChecks,
  MonitorX,
  NotebookPen,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Target,
  Wifi,
} from "lucide-react";

import { SatColorRule } from "../SatColorRule";
import type { Attempt } from "../types";
import { isReadingWriting } from "../util";
import { MIDTERM_OFFSCREEN_GRACE_SECONDS, MIDTERM_OFFSCREEN_VIOLATION_LIMIT, midtermPassMarkLabel } from "./midtermRules";

type Rule = { icon: ElementType; text: string };

const REQUIRED_CODE: Rule = {
  icon: KeyRound,
  text: "The 6-digit access code from your teacher — you'll enter it right before you start.",
};

const REQUIRED: Rule[] = [
  { icon: BatteryCharging, text: "A fully charged device that stays on for the whole test — roughly 1–2 hours." },
  { icon: Wifi, text: "A stable internet connection. Your answers save automatically as you go." },
];

const ALLOWED: Rule[] = [
  { icon: NotebookPen, text: "Blank scratch paper and a pen or pencil for your working." },
  { icon: Flag, text: "Flagging questions to review and return to them before time runs out." },
];

const CALCULATOR_ALLOWED: Rule = {
  icon: Calculator,
  text: "The built-in Desmos calculator, opened from the toolbar. No physical calculator.",
};

const SCIENTIFIC_CALCULATOR_ALLOWED: Rule = {
  icon: Calculator,
  text: "The built-in Desmos scientific calculator, opened from the toolbar. No physical calculator.",
};

const PROHIBITED: Rule[] = [
  { icon: MonitorX, text: "Other apps, browser tabs, or programs — close everything else before you begin." },
  { icon: BookX, text: "Notes, books, or any other reference material." },
  { icon: Smartphone, text: "Phones, smartwatches, headphones, or earbuds." },
  { icon: Camera, text: "Any camera, screen recorder, or recording device." },
  {
    icon: Ban,
    // The one prohibition the software enforces, stated in full (mirrors backend/midterms/proctoring.py).
    text:
      `Leaving full screen or switching to another window. You get ${MIDTERM_OFFSCREEN_GRACE_SECONDS} seconds ` +
      `to come back, and only ${MIDTERM_OFFSCREEN_VIOLATION_LIMIT - 1} warnings — the ` +
      `${MIDTERM_OFFSCREEN_VIOLATION_LIMIT === 3 ? "third" : `${MIDTERM_OFFSCREEN_VIOLATION_LIMIT}th`} time, ` +
      "your paper is submitted immediately.",
  },
];

function RuleList({ rules, tone }: { rules: Rule[]; tone: "ok" | "no" }) {
  return (
    <ul className="space-y-3">
      {rules.map((r, i) => {
        const Icon = r.icon;
        return (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                tone === "ok" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-sm leading-relaxed text-slate-700">{r.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function MidtermRulesScreen({
  attempt,
  requiresCode,
  onProceed,
}: {
  attempt: Attempt;
  /** Unknown until the probe lands — the caller passes true then, so no one is told to start without one. */
  requiresCode: boolean;
  onProceed: () => void;
}) {
  const details = attempt.practice_test_details;
  const subjectLabel = isReadingWriting(details.subject) ? "Reading and Writing" : "Math";
  const modules = (details.modules ?? []).slice().sort((a, b) => a.module_order - b.module_order);
  // The WHOLE paper for a midterm: quoting only module 1 told a student sitting 32+32 that the exam
  // was 32 minutes, then dropped them into a second module they were never warned about.
  const moduleMinutes = modules.map((m) => m.time_limit_minutes || 0);
  const minutes = moduleMinutes.reduce((s, m) => s + m, 0) || undefined;
  const questionCount = details.total_question_count;
  const calculatorEnabled = !!details.calculator_enabled;
  const calculatorScientificOnly = (details.calculator_mode ?? "").toUpperCase() === "SCIENTIFIC";
  const isRetake = details.midterm_type === "RETAKE";

  const required = requiresCode ? [...REQUIRED, REQUIRED_CODE] : REQUIRED;
  const allowed = calculatorEnabled ? [...ALLOWED, calculatorScientificOnly ? SCIENTIFIC_CALCULATOR_ALLOWED : CALCULATOR_ALLOWED] : ALLOWED;
  // Quote a pass mark ONLY when the scale is known: the two scales don't share a floor, so a guess
  // would put a number in front of the student that the server would then disagree with.
  const passMarkLabel = details.scoring_scale ? midtermPassMarkLabel(details.scoring_scale, details.pass_mark) : null;

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <SatColorRule />
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Midterm</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{details.title || "Midterm"}</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Read the rules below, then continue to start your {subjectLabel} midterm.
            </p>
          </div>

          <div className={`mx-auto mt-6 grid gap-3 ${passMarkLabel ? "max-w-2xl grid-cols-3" : "max-w-md grid-cols-2"}`}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <Clock className="mx-auto h-5 w-5 text-slate-500" />
              <div className="mt-2 text-lg font-bold text-slate-900">{minutes ? `${minutes} min` : "—"}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Time</div>
              {moduleMinutes.length > 1 ? (
                // Spell the split out: each module ends at its own buzzer and cannot be returned to.
                <div className="mt-1 text-[11px] font-medium text-slate-500">{moduleMinutes.join(" + ")} min</div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <ListChecks className="mx-auto h-5 w-5 text-slate-500" />
              <div className="mt-2 text-lg font-bold text-slate-900">{questionCount ? questionCount : "—"}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Questions</div>
            </div>
            {passMarkLabel ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <Target className="mx-auto h-5 w-5 text-slate-500" />
                <div className="mt-2 text-lg font-bold text-slate-900">{passMarkLabel}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To pass</div>
              </div>
            ) : null}
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div>
                <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-emerald-700">Required</h2>
                <RuleList rules={required} tone="ok" />
              </div>
              <div className="border-t border-slate-100 pt-5">
                <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-emerald-700">Allowed</h2>
                <RuleList rules={allowed} tone="ok" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-red-600">Prohibited</h2>
              <RuleList rules={PROHIBITED} tone="no" />
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-900">
              <Clock className="h-5 w-5 text-amber-600" />
              <p className="mt-2">
                The timer starts as soon as you begin and <strong>cannot be paused or reset</strong>. You can&apos;t
                submit early — the midterm submits itself when time runs out.
              </p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-900">
              <ShieldAlert className="h-5 w-5 text-red-600" />
              <p className="mt-2">
                If you leave the exam window you have <strong>{MIDTERM_OFFSCREEN_GRACE_SECONDS} seconds</strong> to
                return. It can happen {MIDTERM_OFFSCREEN_VIOLATION_LIMIT - 1} times; on the next one your paper is
                <strong> submitted immediately</strong>, however much time is left.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-700">
              <RotateCcw className="h-5 w-5 text-slate-500" />
              <p className="mt-2">
                {isRetake ? (
                  <>
                    This is your <strong>retake</strong> — it is offered because you didn&apos;t reach the pass mark
                    first time. You sit a midterm once; there is no retake of a retake.
                  </>
                ) : (
                  <>
                    {passMarkLabel ? (
                      <>
                        You need <strong>{passMarkLabel}</strong> to pass.{" "}
                      </>
                    ) : (
                      <>You need to reach this midterm&apos;s pass mark. </>
                    )}
                    You sit this midterm once — if you miss it, your teacher can open a retake for you.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="mt-7 flex justify-center pb-4">
            <button
              type="button"
              onClick={onProceed}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-700 px-10 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              <ChevronRight className="h-5 w-5" />
              I&apos;m ready — continue
            </button>
          </div>
        </div>
      </div>
      <SatColorRule />
    </div>
  );
}
