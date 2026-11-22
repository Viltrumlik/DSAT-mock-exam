import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The v0.7 admin look's shared pieces (lc-up structure canvas, `console-v05.css`, owner 22 Nov 2026):
 * signed balances with no words, verdict tints for money and status cells, and course tags in their own hues.
 *
 * Tables need no helper: every `<table>` in the admin console is ruled by `globals.css`. A money or status cell
 * takes `data-verdict={verdict}` and the stylesheet tints it.
 */

/** A cell's verdict, as `globals.css` tints it: red owes, green paid / ahead, amber needs attention. */
export type Verdict = "critical" | "positive" | "attention";

const MINUS = "−";

/**
 * A balance as a signed number only — the owner (22 Nov 2026): no "owes / paid / ahead" words. "−153 846",
 * "3 000", "0". Digits grouped by spaces, a true minus sign. `plus` writes "+346 154" (a payment in a ledger).
 */
export function signedAmount(amount: number, { plus = false }: { plus?: boolean } = {}): string {
  const n = Math.round(amount);
  const digits = Math.abs(n).toLocaleString("en-US").replace(/,/g, " ");
  if (n < 0) return `${MINUS}${digits}`;
  if (n > 0 && plus) return `+${digits}`;
  return digits;
}

/** A balance's verdict: below zero owes (critical), above zero paid ahead (positive), zero none. */
export function balanceVerdict(amount: number | null | undefined): Verdict | undefined {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return undefined;
  if (amount < 0) return "critical";
  if (amount > 0) return "positive";
  return undefined;
}

/** The text colour that goes with a verdict, for a number outside a tinted cell. */
export function verdictText(verdict: Verdict | undefined): string {
  if (verdict === "critical") return "text-ms-critical-fg";
  if (verdict === "positive") return "text-ms-positive-fg";
  if (verdict === "attention") return "text-ms-attention-fg";
  return "text-ms-fg-2";
}

/** The four course levels the centre teaches (`Classroom.level`). */
export type CourseLevel = "foundation" | "junior" | "middle" | "senior";

const LEVELS: readonly string[] = ["foundation", "junior", "middle", "senior"];

/**
 * A group's level: its own `level` field when set, else the first word of its name ("Junior G21 · Math").
 * `null` when neither says — the tag is then drawn as a plain outline, never a guessed colour.
 */
export function courseLevelOf(level?: string | null, name?: string | null): CourseLevel | null {
  const own = String(level ?? "").trim().toLowerCase();
  if (LEVELS.includes(own)) return own as CourseLevel;
  const first = String(name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return LEVELS.includes(first) ? (first as CourseLevel) : null;
}

/** "Foundation Math" — a course the way lc-up names it, from the group's level and subject. */
export function courseName(level?: string | null, subject?: string | null): string {
  const l = String(level ?? "").trim();
  const s = String(subject ?? "").trim().toLowerCase();
  const subjectWord = s === "math" ? "Math" : s === "english" ? "English" : s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  const levelWord = l ? l.charAt(0).toUpperCase() + l.slice(1).toLowerCase() : "";
  return [levelWord, subjectWord].filter(Boolean).join(" ");
}

const COURSE_VAR: Record<CourseLevel, string> = {
  foundation: "var(--ms-course-foundation)",
  junior: "var(--ms-course-junior)",
  middle: "var(--ms-course-middle)",
  senior: "var(--ms-course-senior)",
};

/** The course hue, for a lesson card or a dot (`null` → the neutral colour). */
export function courseColor(level: CourseLevel | null): string {
  return level ? COURSE_VAR[level] : "var(--ms-neutral)";
}

/**
 * A group or course as a soft tag in its course's hue: Foundation sky, Junior violet, Middle pink, Senior indigo.
 * Never red / green / amber — those are verdicts. A group whose level is unknown is a plain outline.
 */
export function CourseTag({
  level,
  size = "md",
  className,
  children,
  title,
}: {
  level: CourseLevel | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const style = level
    ? ({
        "--c": COURSE_VAR[level],
        backgroundColor: "color-mix(in srgb, var(--c) 14%, var(--ms-card))",
        color: "color-mix(in srgb, var(--c) 75%, var(--ms-fg))",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, var(--ms-card))",
      } as CSSProperties)
    : undefined;
  return (
    <span
      data-course={level ?? "none"}
      title={title}
      style={style}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-ms-badge font-semibold leading-none",
        size === "lg" ? "h-7 px-[11px] text-[14px]" : size === "sm" ? "h-[22px] px-[7px] text-[12px]" : "h-6 px-[9px] text-[13px]",
        !level && "text-ms-fg-2 shadow-[inset_0_0_0_1px_var(--ms-border-strong)]",
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
