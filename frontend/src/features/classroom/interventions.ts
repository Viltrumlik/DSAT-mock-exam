/**
 * What the teacher Overview reads from GET /classes/{id}/interventions/.
 *
 * The Overview used to read `completion_rate`, `overdue`, `inactive` and `low_scores`, keys the
 * endpoint has never sent, so its Completion card could only ever read "—" and Needs attention
 * only ever 0. These map the two cards onto the fields the server actually returns.
 */

import type { InterventionStudent, Interventions } from "./types";

/** One student in the Needs attention list. */
export interface AttentionRow {
  student: InterventionStudent;
  /** Every reason the student is listed: "2 missing · Inactive 9d · Average 45.5%". */
  detail: string;
}

/**
 * The Completion card as a whole percentage, or null when the class has nothing assigned.
 *
 * `overall_completion_pct` is already 0–100: the old `<= 1 ? × 100` guess turned a class at 1%
 * into 100%. With nothing assigned the server still sends 0, which would read as "nobody turned
 * anything in" when there is nothing to turn in.
 */
export function classCompletionPct(iv: Interventions | undefined): number | null {
  const stats = iv?.class_stats;
  if (!stats?.assignment_count) return null;
  return Math.round(stats.overall_completion_pct);
}

/**
 * The Needs attention list: the three student lists, one row per student.
 *
 * A student can be missing work, inactive and low-scoring at once, and is listed once with every
 * reason. More reasons sort first, so the eight rows the card shows are never filled by
 * one-reason students while a student with all three waits below them. Ties keep the order the
 * server lists them in: missing work first, most missing at the top.
 */
export function needsAttention(iv: Interventions | undefined): AttentionRow[] {
  const rows = new Map<number, { student: InterventionStudent; reasons: string[] }>();
  const flag = (student: InterventionStudent, reason: string) => {
    const row = rows.get(student.student_id);
    if (row) row.reasons.push(reason);
    else rows.set(student.student_id, { student, reasons: [reason] });
  };

  for (const s of iv?.overdue_students ?? []) flag(s, `${s.overdue_count} missing`);
  for (const s of iv?.inactive_students ?? []) {
    flag(s, s.days_inactive == null ? "No activity yet" : `Inactive ${s.days_inactive}d`);
  }
  for (const s of iv?.low_score_students ?? []) flag(s, `Average ${s.avg_score_pct}%`);

  return [...rows.values()]
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .map(({ student, reasons }) => ({ student, detail: reasons.join(" · ") }));
}
