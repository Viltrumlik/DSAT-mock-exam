import type { PillTone } from "../ui";
import type { GradebookStatus } from "../gradebookApi";

/**
 * How each gradebook status reads to a teacher. Shared by the assignment's class list and by one
 * student's work, so a status cannot come to mean two things two clicks apart.
 */
export const STATUS_META: Record<GradebookStatus, { label: string; tone: PillTone; bar: string }> = {
  GRADED: { label: "Graded", tone: "success", bar: "bg-emerald-500" },
  SUBMITTED: { label: "Needs grading", tone: "warning", bar: "bg-amber-500" },
  NEEDS_REVISION: { label: "Needs revision", tone: "info", bar: "bg-sky-500" },
  // `MISSING` is the wire status and keeps its name; only what a teacher reads changes, so this
  // tab says the same thing as the teacher-panel gradebook instead of a second vocabulary.
  MISSING: { label: "Not turned in", tone: "neutral", bar: "bg-slate-300 dark:bg-slate-600" },
};
