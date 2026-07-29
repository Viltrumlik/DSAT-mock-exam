"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Shuffle, Check, X, Loader2, Lock, Presentation, AlertTriangle } from "lucide-react";
import {
  midtermApi,
  type MidtermVersionBrief,
  type SeatingGrid,
  type SeatOccupant,
} from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button, Field, Select } from "../ui";

/**
 * "Seating & versions": the system decides who sits with whom AND which paper each chair
 * gets, so no student can read a useful answer off the person beside, in front of, or
 * behind them. The teacher re-shuffles until happy, then Proceeds to persist.
 *
 * Students are never shown any of this — the version is applied silently on their next start.
 */
const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6];

export function AssignVersionModal({
  classId, midtermId, onClose, onDone,
}: {
  classId: number; midtermId: number; onClose: () => void; onDone: () => void;
}) {
  // Portalled to <body>, like every other dialog in the app (components/ui/Modal, Drawer).
  // Rendered in place it lands inside `<main class="relative z-10">`, whose stacking context
  // clamps ANY z-index the dialog sets below the sidebar's z-30 — no value of z-[...] can
  // win from in there, and the whole left column of desks disappears behind the nav.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [seating, setSeating] = useState<SeatingGrid | null>(null);
  const [versions, setVersions] = useState<MidtermVersionBrief[]>([]);
  const [columns, setColumns] = useState(3);
  const [loading, setLoading] = useState(true);
  // Once anyone has started, the plan is fixed: their paper is already in their hands, so a
  // re-shuffle would only produce a chart that contradicts the room.
  const locked = !!seating?.any_started;

  const apply = useCallback((d: { seating: SeatingGrid | null; versions: MidtermVersionBrief[] }) => {
    setSeating(d.seating);
    setVersions(d.versions);
    if (d.seating) setColumns(d.seating.columns);
  }, []);

  const shuffle = useMutation({
    mutationFn: (cols: number) => midtermApi.previewVersions(classId, midtermId, cols),
    onSuccess: apply,
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const commit = useMutation({
    mutationFn: () => midtermApi.commitSeating(classId, midtermId, {
      columns: seating?.columns ?? columns,
      seats: (seating?.desks ?? []).flatMap((d) =>
        d.seats
          .filter((s) => s.student_id != null && s.version_id != null)
          .map((s) => ({ student_id: s.student_id!, version_id: s.version_id!, row: d.row, col: s.seat_col })),
      ),
    }),
    onSuccess: () => {
      pushGlobalToast({ tone: "success", message: "Seating plan saved." });
      onDone();
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  // Show the committed chart if there is one; otherwise seed a fresh shuffle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cur = await midtermApi.getVersions(classId, midtermId);
        if (cancelled) return;
        if (cur.seating && cur.unassigned_count === 0) {
          apply(cur);
        } else {
          const p = await midtermApi.previewVersions(classId, midtermId, cur.seating?.columns);
          if (!cancelled) apply(p);
        }
      } catch (e) {
        if (!cancelled) pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [classId, midtermId, apply]);

  const legend = useMemo(
    () => versions.map((v) => ({ v, count: seating?.version_counts?.[String(v.id)] ?? 0 })),
    [versions, seating],
  );
  const rows = useMemo(() => {
    const byRow = new Map<number, SeatingGrid["desks"]>();
    for (const d of seating?.desks ?? []) byRow.set(d.row, [...(byRow.get(d.row) ?? []), d]);
    return [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  }, [seating]);

  if (!mounted) return null;

  // z-[200] is the project's modal layer (components/ui/Modal, Drawer); the shells own z-[100].
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-foreground">Seating &amp; versions</h2>
            <p className="text-xs text-muted-foreground">
              The system pairs the class and hands out papers so no one sits next to, in front of, or
              behind the same version — students never see which one they got.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : !seating ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No students are assigned this midterm yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Field label="Desks per row" className="w-40">
                  <Select
                    value={columns}
                    disabled={locked || shuffle.isPending}
                    onChange={(e) => { const c = Number(e.target.value); setColumns(c); shuffle.mutate(c); }}
                  >
                    {COLUMN_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <p className="pb-2 text-xs text-muted-foreground">
                  {seating.rows} row{seating.rows === 1 ? "" : "s"} × {seating.columns} desk
                  {seating.columns === 1 ? "" : "s"} · {seating.desk_count} desks · {seating.student_count} students
                </p>
              </div>

              {locked && (
                <Banner icon={Lock}>
                  Someone has already started — the seating plan is fixed for this sitting.
                </Banner>
              )}
              {seating.warnings.map((w) => <Banner key={w} icon={AlertTriangle}>{w}</Banner>)}

              <div className="rounded-2xl border border-dashed border-border bg-surface-2/40 py-2 text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Presentation className="mr-1.5 inline h-3.5 w-3.5" aria-hidden /> Board — front of the room
              </div>

              <div className="space-y-3">
                {rows.map(([row, desks]) => (
                  <div
                    key={row}
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${seating.columns}, minmax(0, 1fr))` }}
                  >
                    {desks.map((desk) => (
                      <div key={desk.desk_number} className="rounded-2xl border border-border bg-surface-2/40 p-3">
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          Desk {desk.desk_number}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {desk.seats.map((seat) => <Seat key={seat.seat_col} seat={seat} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {legend.map(({ v, count }) => (
                  <span key={v.id} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    {v.label || `Version ${v.version_number}`} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button
            variant="secondary"
            icon={Shuffle}
            loading={shuffle.isPending}
            onClick={() => shuffle.mutate(columns)}
            disabled={loading || locked || !seating}
          >
            Re-shuffle seats
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              icon={Check}
              loading={commit.isPending}
              disabled={loading || locked || !seating?.desks.length}
              onClick={() => commit.mutate()}
            >
              Proceed
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Seat({ seat }: { seat: SeatOccupant }) {
  if (seat.student_id == null) {
    return (
      <div className="rounded-xl border border-dashed border-border py-3 text-center text-xs italic text-muted-foreground">
        Empty
      </div>
    );
  }
  return (
    <div
      className={`rounded-xl border border-border bg-card p-2 ${seat.locked ? "opacity-70" : ""}`}
      title={seat.locked ? "Already started — this paper cannot be changed." : undefined}
    >
      <p className="truncate text-sm font-medium text-foreground">
        {seat.locked && <Lock className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden />}
        {seat.student_name}
      </p>
      <span className="mt-1 inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
        {seat.version_label || `Version ${seat.version_number}`}
      </span>
    </div>
  );
}

function Banner({ icon: Icon, children }: { icon: typeof Lock; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
