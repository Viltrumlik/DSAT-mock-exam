"use client";

/**
 * The teaching team's row menu for one piece of set work: open, edit, publish, archive,
 * unarchive, delete.
 *
 * Shared by the Assignments (homework) list and the Classwork list. It used to live only in
 * the Assignments list, which was fine while classwork showed up there too — and meant that
 * once classwork left that list (the owner: *"classwork classworkni o'zida ko'rinishi
 * kerak"*), a teacher would have had no way left to archive or delete it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Archive, ExternalLink, Eye, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { ConfirmDialog } from "../ui";
import { useAssignmentLifecycle } from "../homeworkHooks";
import { classroomKeys } from "../queryKeys";

export type RowWorkKind = "homework" | "classwork";

/**
 * What archiving and deleting cost, per kind. Classwork has no submissions or grades to lose,
 * and its XP is NOT taken back by either — awards are keyed on the carrier's id, not tied to
 * the row, so they outlive it. Saying "grades are kept" there would describe the wrong thing.
 */
const COPY: Record<RowWorkKind, { noun: string; archive: (t: string) => string; remove: (t: string) => string }> = {
  homework: {
    noun: "assignment",
    archive: (t) => `“${t}” will be hidden from students. Existing grades are kept and you can unarchive it later.`,
    remove: (t) => `“${t}” will be permanently deleted, along with any student submissions and grades. This cannot be undone.`,
  },
  classwork: {
    noun: "classwork",
    archive: (t) => `“${t}” will be hidden from students. The XP you gave for it stays, and you can unarchive it later.`,
    remove: (t) => `“${t}” will be permanently deleted. The XP you gave for it stays with the students. This cannot be undone.`,
  },
};

export function AssignmentRowActions({
  classId,
  classBase,
  row,
  archived,
  kind = "homework",
  canDelete,
}: {
  classId: number;
  classBase: string;
  row: { id: number; title: string; status?: string | null };
  /** Rendered from an archived list, where the row may predate its status being sent. */
  archived?: boolean;
  kind?: RowWorkKind;
  /** `capabilities.canDeleteAssignment`: an owner or a teacher. A TA archives instead, and the API refuses them a delete. */
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const lc = useAssignmentLifecycle(classId, row.id);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const copy = COPY[kind];
  const title = row.title || (kind === "classwork" ? "Classwork" : "Assignment");
  const href = `${classBase}/assignments/${row.id}`;

  const del = useMutation({
    mutationFn: () => classesApi.deleteAssignment(classId, row.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
      pushGlobalToast({ tone: "success", message: `“${title}” deleted.` });
      setConfirmDelete(false);
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  async function run(m: { mutateAsync: () => Promise<unknown> }, ok: string) {
    try {
      await m.mutateAsync();
      pushGlobalToast({ tone: "success", message: ok });
      setConfirmArchive(false);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

  return (
    <>
      <KebabMenu>
        <MenuItem icon={ExternalLink} href={href}>Open</MenuItem>
        <MenuItem icon={Pencil} href={`${href}/edit`}>Edit</MenuItem>
        {row.status === "DRAFT" && (
          <MenuItem icon={Eye} onClick={() => run(lc.publish, `“${title}” published.`)}>Publish</MenuItem>
        )}
        {row.status === "PUBLISHED" && (
          <MenuItem icon={Archive} onClick={() => setConfirmArchive(true)}>Archive</MenuItem>
        )}
        {(row.status === "ARCHIVED" || archived) && (
          <MenuItem icon={RotateCcw} onClick={() => run(lc.unarchive, `“${title}” unarchived.`)}>Unarchive</MenuItem>
        )}
        {canDelete && (
          <MenuItem icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>Delete</MenuItem>
        )}
      </KebabMenu>

      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${copy.noun}?`}
        description={copy.archive(title)}
        confirmLabel="Archive"
        tone="danger"
        loading={lc.archive.isPending}
        onConfirm={() => run(lc.archive, `“${title}” archived.`)}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${copy.noun}?`}
        description={copy.remove(title)}
        confirmLabel="Delete"
        tone="danger"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/** Minimal kebab dropdown (click-away via a transparent overlay). */
function KebabMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Each assignment row is its own stacking context (the `.cr-rowin` enter animation
  // ends on a `translateY(0)` transform), so an absolutely-positioned menu is trapped
  // behind the rows below it. Render it in a portal with fixed coordinates so it
  // floats above everything and stays clickable.
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: Math.round(r.bottom + 4), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, place]);

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Actions"
        aria-expanded={open}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <MoreVertical className="h-[18px] w-[18px]" />
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)} aria-hidden />
            {/* `ds-app`: a portal lands on <body>, whose default face is the reading serif, so
                without the shell's font class the menu rendered in Georgia beside a sans row. */}
            <div
              className="ds-app fixed z-[999] w-44 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-[var(--ds-shadow-lg)]"
              style={{ top: pos.top, right: pos.right }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function MenuItem({ icon: Icon, onClick, href, destructive, children }: { icon: React.ElementType; onClick?: () => void; href?: string; destructive?: boolean; children: React.ReactNode }) {
  const cls = destructive
    ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
    : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-surface-2";
  const iconCls = destructive ? "h-4 w-4 text-red-500" : "h-4 w-4 text-muted-foreground";
  const body = (<><Icon className={iconCls} aria-hidden />{children}</>);
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
