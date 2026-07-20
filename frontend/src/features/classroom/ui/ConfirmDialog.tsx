"use client";

import { Dialog } from "./Dialog";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Body content rendered above the actions (optional extra context). */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" turns the confirm button red — use for destructive actions. */
  tone?: "primary" | "danger";
  /** Shows a spinner on the confirm button and disables both actions. */
  loading?: boolean;
  /**
   * Blocks confirming while the body's own inputs are incomplete — a dialog that collects
   * something (a date, a reason) has no other way to say "not yet". Cancel stays live:
   * an unfinished form must never trap the teacher in the modal.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal for destructive or irreversible actions. Wraps the design-system
 * Dialog so every "Are you sure?" looks and behaves identically. Reuse this instead of
 * hand-rolling per-page confirms.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? <span className="sr-only">Please confirm this action.</span>}
    </Dialog>
  );
}
