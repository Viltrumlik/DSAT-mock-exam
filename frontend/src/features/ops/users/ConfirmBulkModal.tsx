"use client";

import { useState } from "react";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The confirm step for `POST /users/admin/bulk/` — moved here unchanged from the old /ops/users
 * page so the Students, Public users and Staff lists share it.
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
  const [typed, setTyped] = useState("");
  const isDelete = action === "delete";
  const canConfirm = !busy && (!isDelete || typed.trim().toUpperCase() === "DELETE");
  const noun = `${count} account${count === 1 ? "" : "s"}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-3xl bg-card border border-border shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {isDelete ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 className="h-4.5 w-4.5" />
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldAlert className="h-4.5 w-4.5" />
            </span>
          )}
          <p className="font-black text-foreground text-base">
            {ACTION_LABEL[action]} {noun}?
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          {isDelete
            ? `This permanently deletes ${noun}. This cannot be undone.`
            : `This will ${ACTION_LABEL[action].toLowerCase()} ${noun}. You can reverse it later.`}
        </p>

        {/* Deleting a user cascades to every attempt, submission and result they own.
            Without this line the dialog looks identical whether you picked the empty
            duplicate or the one holding a year of work. */}
        {isDelete && attemptTotal > 0 && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {attemptTotal.toLocaleString()} exam {attemptTotal === 1 ? "result" : "results"} will be
            permanently deleted with {count === 1 ? "this account" : "these accounts"}.
          </p>
        )}

        {isDelete && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Type DELETE to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={cn(
              "flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-background transition-opacity disabled:opacity-50 flex items-center justify-center gap-2",
              isDelete ? "bg-red-600 hover:bg-red-700 text-white" : "bg-foreground hover:opacity-90",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {ACTION_LABEL[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
