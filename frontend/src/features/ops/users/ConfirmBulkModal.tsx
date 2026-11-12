"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Button, Dialog } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

/**
 * The confirm step for `POST /users/admin/bulk/` — moved here unchanged from the old /ops/users
 * page so the Students, Public users and Staff lists share it.
 *
 * In the console's look (design handoff v0.3, PR 22): the console dialog, the same words and the same rule
 * (a delete waits for DELETE typed in).
 */

export type BulkAction = "freeze" | "unfreeze" | "delete";

/** One entry of the endpoint's per-id `results`. */
export type BulkResult = {
  id: number;
  ok: boolean;
  is_frozen?: boolean;
  deleted?: boolean;
  error?: string;
};

export const ACTION_LABEL: Record<BulkAction, string> = {
  freeze: "Freeze",
  unfreeze: "Unfreeze",
  delete: "Delete",
};

export const ACTION_PAST: Record<BulkAction, string> = {
  freeze: "frozen",
  unfreeze: "unfrozen",
  delete: "deleted",
};

export function ConfirmBulkModal({
  action,
  count,
  attemptTotal,
  busy,
  onCancel,
  onConfirm,
}: {
  action: BulkAction;
  count: number;
  /** Graded/submitted rows across the selection. Every relation is CASCADE. */
  attemptTotal: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const isDelete = action === "delete";
  const canConfirm = !busy && (!isDelete || typed.trim().toUpperCase() === "DELETE");
  const noun = `${count} account${count === 1 ? "" : "s"}`;

  return (
    <Dialog open onClose={onCancel} labelledBy={`${id}-title`} width={400} locked={busy}>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-[22px] pb-2 pt-[22px]">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-[12px]",
              isDelete ? "bg-ms-critical-soft text-ms-critical-fg" : "bg-ms-primary-soft text-ms-primary-text",
            )}
          >
            <Icon name={isDelete ? "trash" : "shield"} size="sm" className="size-[18px]" />
          </span>
          <h2 id={`${id}-title`} className="text-[18px] font-bold leading-6 text-ms-fg">
            {ACTION_LABEL[action]} {noun}?
          </h2>
        </div>

        <p className="text-[14px] leading-5 text-ms-fg-2">
          {isDelete
            ? `This permanently deletes ${noun}. This cannot be undone.`
            : `This will ${ACTION_LABEL[action].toLowerCase()} ${noun}. You can reverse it later.`}
        </p>

        {/* Deleting a user cascades to every attempt, submission and result they own.
            Without this line the dialog looks identical whether you picked the empty
            duplicate or the one holding a year of work. */}
        {isDelete && attemptTotal > 0 && (
          <p className="flex items-start gap-2 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-[14px] font-semibold leading-5 text-ms-critical-fg">
            <Icon name="alert" size="sm" className="mt-0.5" />
            <span>
              {attemptTotal.toLocaleString()} exam {attemptTotal === 1 ? "result" : "results"} will be permanently deleted with{" "}
              {count === 1 ? "this account" : "these accounts"}.
            </span>
          </p>
        )}

        {isDelete && (
          <div>
            <label htmlFor={`${id}-typed`} className={FIELD_LABEL}>
              Type DELETE to confirm
            </label>
            <div className="font-ms-mono">
              <input
                id={`${id}-typed`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className={CONTROL}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={isDelete ? "danger" : "primary"}
          className="flex-1"
          icon={isDelete ? "trash" : undefined}
          state={busy ? "busy" : "idle"}
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {ACTION_LABEL[action]}
        </Button>
      </div>
    </Dialog>
  );
}
