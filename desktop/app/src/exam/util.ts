/**
 * Pure helpers for the runner, ported from the site's testing-simulation/utils
 * (options, questionKind, time). No React, no I/O.
 */
import type { Attempt, ExamQuestion, ParsedOption } from "./types";

/** A grid-in (student-produced response) rather than multiple choice. */
export function isStudentResponse(q: ExamQuestion): boolean {
  return Boolean(q.is_math_input);
}

/** The dynamic options map → an ordered [{key,text,image}]. Defaults to A–D when absent. */
export function parseOptions(options: unknown): ParsedOption[] {
  const fallback = ["A", "B", "C", "D"];
  if (!options || typeof options !== "object") {
    return fallback.map((key) => ({ key, text: "" }));
  }
  const map = options as Record<string, unknown>;
  const keys = Object.keys(map);
  const ordered = (keys.length ? keys : fallback).slice().sort();
  return ordered.map((key) => {
    const v = map[key];
    if (typeof v === "string") return { key, text: v };
    if (v && typeof v === "object") {
      const o = v as { text?: string; image?: string | null };
      return { key, text: o.text ?? "", image: o.image ?? null };
    }
    return { key, text: v == null ? "" : String(v) };
  });
}

export function isReadingWriting(subject: string): boolean {
  const s = (subject || "").toUpperCase();
  return s.includes("READING") || s.includes("WRITING") || s === "RW";
}

/** Seconds → "M:SS". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** The active module's limit in seconds (prefers the explicit duration). */
export function moduleLimitSeconds(a: Attempt): number {
  if (a.module_duration_seconds && a.module_duration_seconds > 0) return a.module_duration_seconds;
  return (a.current_module_details?.time_limit_minutes ?? 0) * 60;
}
