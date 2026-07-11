"use client";

import { useEffect, useState } from "react";
import { Button, Field, Modal, Select, Textarea } from "@/components/ui";
// Global toast provider mounted in app/layout.tsx (NOT the ui-kit ToastProvider,
// which is only mounted on the ui-catalog demo page).
import { useToast } from "@/components/ToastProvider";
import { normalizeApiError } from "@/lib/apiError";
import {
  questionReportApi,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportSystem,
} from "@/lib/questionReportApi";

export interface ReportTarget {
  system: ReportSystem;
  questionId: number;
  attemptId?: number | null;
}

interface ReportProblemModalProps {
  open: boolean;
  onClose: () => void;
  target: ReportTarget | null;
  /** 1-based number shown to the student, for the dialog subtitle. */
  questionNumber?: number;
}

/**
 * Student-facing "Report a problem with this question" dialog. Reused by every
 * question surface (shared exam runner, assessment runner, and review modals).
 */
export function ReportProblemModal({
  open,
  onClose,
  target,
  questionNumber,
}: ReportProblemModalProps) {
  const toast = useToast();
  const [category, setCategory] = useState<ReportCategory>("wrong_answer");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setCategory("wrong_answer");
      setMessage("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    if (!target?.questionId || submitting) return;
    setSubmitting(true);
    try {
      const res = await questionReportApi.submit({
        system: target.system,
        question_id: target.questionId,
        category,
        message: message.trim(),
        attempt_id: target.attemptId ?? undefined,
      });
      toast.push({
        tone: "success",
        message: res.deduped
          ? "You've already reported this question — thanks!"
          : "Thanks! Your report was sent to our team.",
      });
      onClose();
    } catch (e) {
      toast.push({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a problem"
      description={
        questionNumber
          ? `Question ${questionNumber} — tell us what looks wrong.`
          : "Tell us what looks wrong with this question."
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Send report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What's the issue?">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Details (optional)" hint="Anything that helps us find and fix it.">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. The correct answer should be B, not C."
          />
        </Field>
      </div>
    </Modal>
  );
}
