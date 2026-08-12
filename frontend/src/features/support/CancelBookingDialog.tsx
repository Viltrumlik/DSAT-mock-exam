"use client";

import { useState } from "react";
import { Button, Field, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";

/** The reasons that actually come up, so most cancellations are one tap rather than an essay.
 *  "Other" is last and always opens the box — a preset list that cannot be escaped just
 *  collects the nearest wrong answer. */
const PRESETS = [
  "I have a lesson clash",
  "I'm unwell",
  "I sorted it out myself",
  "I need a different time",
] as const;

const OTHER = "Something else";

/**
 * Cancelling asks why, and the answer goes to the support teacher.
 *
 * Not a nag: the teacher held that hour open and nobody else could take it, so "he didn't
 * turn up" and "she had a clash and said so" are different facts and the teacher should be
 * able to tell them apart. The server requires a reason from a student for the same reason.
 */
export function CancelBookingDialog({
  open, teacherName, when, pending, error, onClose, onConfirm,
}: {
  open: boolean;
  teacherName: string;
  when: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState("");

  const isOther = picked === OTHER;
  const reason = isOther ? detail.trim() : (picked ?? "");
  const canSend = reason.length > 0 && !pending;

  function close() {
    setPicked(null);
    setDetail("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title="Cancel this session?"
      description={`${when} with ${teacherName}. Let them know why so they can offer the hour to someone else.`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Keep it</Button>
          <Button variant="danger" disabled={!canSend} loading={pending} onClick={() => onConfirm(reason)}>
            Cancel session
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[...PRESETS, OTHER].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPicked(p)}
              aria-pressed={picked === p}
              className={cn(
                "ds-ring rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                picked === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-surface-2",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        {isOther && (
          <Field label="Tell them what happened" htmlFor="support-cancel-detail">
            <Input
              id="support-cancel-detail"
              autoFocus
              inputSize="sm"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="A short line is plenty"
              maxLength={280}
            />
          </Field>
        )}
        {error ? <p className="text-sm font-semibold text-rose-500">{error}</p> : null}
      </div>
    </Modal>
  );
}
