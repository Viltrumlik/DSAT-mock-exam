"use client";

import {
  BatteryCharging,
  Wifi,
  KeyRound,
  NotebookPen,
  Flag,
  Maximize,
  MonitorX,
  BookX,
  Smartphone,
  Camera,
  Ban,
  Clock,
  ListChecks,
  ChevronRight,
  ShieldAlert,
  Target,
  RotateCcw,
  Calculator,
} from "lucide-react";
import {
  MIDTERM_OFFSCREEN_GRACE_SECONDS,
  MIDTERM_OFFSCREEN_VIOLATION_LIMIT,
  midtermPassMarkLabel,
} from "@/lib/midtermRules";
import { SatColorRule } from "./SatColorRule";

interface MidtermRulesScreenProps {
  /** Midterm / module title shown as the heading. */
  title: string;
  subjectLabel: string;
  minutes?: number;
  questionCount?: number;
  starting: boolean;
  fullscreenSupported: boolean;
  /** Fired by the primary button (→ start, or → code entry once the gate exists). */
  onProceed: () => void;
  proceedLabel?: string;
  /** Scoring scale of this midterm ("SCALE_100" / "SCALE_800"); drives the quoted pass mark. */
  scoringScale?: string | null;
  /** The midterm's own pass mark; omitted falls back to the scale default (see midtermRules). */
  passMark?: number | null;
  /** True when this sitting IS the retake, so the retake rule is worded in the past tense. */
  isRetake?: boolean;
  /** Whether an access code is required — a standalone midterm has none to hand out. */
  requiresCode?: boolean;
  /** Desmos gate as decided server-side; midterms only offer it at Math middle/senior. */
  calculatorEnabled?: boolean;
}

type Rule = { icon: React.ElementType; text: string };

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

const PROHIBITED: Rule[] = [
  { icon: MonitorX, text: "Other apps, browser tabs, or programs — close everything else before you begin." },
  { icon: BookX, text: "Notes, books, or any other reference material." },
  { icon: Smartphone, text: "Phones, smartwatches, headphones, or earbuds." },
  { icon: Camera, text: "Any camera, screen recorder, or recording device." },
  {
    icon: Ban,
    // The one prohibition the software actually enforces, so it is stated in full: the
    // numbers here mirror backend/midterms/proctoring.py via lib/midtermRules.
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

/**
 * Midterm start screen — exam rules a student reads before beginning, and the FIRST thing
 * they see: the access code is asked for only after this screen, because a code prompt with
 * no rules behind it tells a student nothing about what they are agreeing to.
 *
 * Modeled on a proctored test-day checklist (required / allowed / prohibited) but rewritten
 * for MasterSAT midterms. Every rule stated here is one the platform actually enforces —
 * the off-screen limit, the pass mark and the retake all come from lib/midtermRules, which
 * mirrors the backend.
 */
export function MidtermRulesScreen({
  title,
  subjectLabel,
  minutes,
  questionCount,
  starting,
  fullscreenSupported,
  onProceed,
  proceedLabel = "I'm ready — continue",
  scoringScale,
  passMark,
  isRetake = false,
  requiresCode = true,
  calculatorEnabled = false,
}: MidtermRulesScreenProps) {
  const required = requiresCode ? [...REQUIRED, REQUIRED_CODE] : REQUIRED;
  const allowed = calculatorEnabled ? [...ALLOWED, CALCULATOR_ALLOWED] : ALLOWED;
  // Quote a pass mark ONLY when the scale is known. The two scales don't share a floor
  // (a blank 800-scale paper scores 200), so guessing one would put a real number in front
  // of the student that the server would then disagree with.
  const passMarkLabel = scoringScale ? midtermPassMarkLabel(scoringScale, passMark) : null;
  return (
    <div className="flex h-screen flex-col bg-white">
      <SatColorRule />
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Midterm</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Read the rules below, then continue to start your {subjectLabel} midterm.
            </p>
          </div>

          {/* Stat tiles */}
          <div className={`mx-auto mt-6 grid gap-3 ${passMarkLabel ? "max-w-2xl grid-cols-3" : "max-w-md grid-cols-2"}`}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <Clock className="mx-auto h-5 w-5 text-slate-500" />
              <div className="mt-2 text-lg font-bold text-slate-900">{minutes ? `${minutes} min` : "—"}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Time</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
              <ListChecks className="mx-auto h-5 w-5 text-slate-500" />
              <div className="mt-2 text-lg font-bold text-slate-900">{questionCount ? questionCount : "—"}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Questions</div>
            </div>
            {passMarkLabel && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <Target className="mx-auto h-5 w-5 text-slate-500" />
                <div className="mt-2 text-lg font-bold text-slate-900">{passMarkLabel}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To pass</div>
              </div>
            )}
          </div>

          {/* Rules — two columns */}
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

          {/* The three rules a student is most likely to be caught out by, spelled out. */}
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-900">
              <Clock className="h-5 w-5 text-amber-600" />
              <p className="mt-2">
                The timer starts as soon as you begin and <strong>cannot be paused or reset</strong>. You can&apos;t
                submit early — the midterm submits itself when time runs out.
                {fullscreenSupported ? " It opens in full screen; stay there until you finish." : ""}
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
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-700 px-10 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {fullscreenSupported ? <Maximize className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              {starting ? "Starting…" : proceedLabel}
            </button>
          </div>
        </div>
      </div>
      <SatColorRule />
    </div>
  );
}
