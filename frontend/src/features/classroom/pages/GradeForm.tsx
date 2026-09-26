"use client";

/**
 * Where a teacher enters the mark. One form, two places: the class list on a homework, and one
 * student's work a level below it.
 *
 * Lifted out of the class list's row unchanged — same fields, same guards, same mutations — so
 * that opening a student to read their work before marking it cannot end up taking a grade by
 * some second set of rules.
 */

import { useState } from "react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button, Field, Input, Textarea } from "../ui";
import { useGradeSubmission, useReturnSubmission } from "../gradebookHooks";

export function GradeForm({
  classId,
  assignmentId,
  submissionId,
  studentName,
  maxScore,
  initialScore,
  onCancel,
  onDone,
  children,
}: {
  classId: number;
  assignmentId: number;
  submissionId: number;
  studentName: string;
  maxScore: string | null;
  /** The grade already on record, so re-grading starts from it rather than from blank. */
  initialScore?: string | null;
  /** Rendered above the fields — what the mark is worth, where the homework says so. */
  children?: React.ReactNode;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const [score, setScore] = useState(initialScore ?? "");
  const [feedback, setFeedback] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const grade = useGradeSubmission(classId, assignmentId);
  const ret = useReturnSubmission(classId, assignmentId);

  async function save() {
    setErr(null);
    try {
      await grade.mutateAsync({ submissionId, grade: String(score), feedback });
      pushGlobalToast({ tone: "success", message: `Saved grade for ${studentName}.` });
      onDone?.();
    } catch (e) { setErr(normalizeApiError(e).message); }
  }
  async function doReturn() {
    setErr(null);
    try {
      await ret.mutateAsync({ submissionId, note: feedback });
      pushGlobalToast({ tone: "success", message: `Returned ${studentName}'s work for revision.` });
      onDone?.();
    } catch (e) { setErr(normalizeApiError(e).message); }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
      {children}
      {err && <p className="text-xs text-rose-500">{err}</p>}
      <div className="flex items-end gap-3">
        <Field label="Score" className="w-32">
          <Input type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder={maxScore ? `/ ${maxScore}` : "Score"} />
        </Field>
      </div>
      <Field label="Feedback (optional)">
        <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Notes for the student…" className="min-h-[5rem]" />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" loading={grade.isPending} onClick={save} disabled={String(score).trim() === ""}>Save grade</Button>
        <Button size="sm" variant="secondary" loading={ret.isPending} onClick={doReturn}>Return for revision</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
