"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Shuffle, Check, X, Loader2, Users } from "lucide-react";
import { midtermApi, type VersionAssignRow, type MidtermVersionBrief } from "@/lib/midtermApi";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Button } from "../ui";

/**
 * "Assign versions" popup: randomly splits the class across the midterm's versions.
 * The teacher can re-random until happy, then Proceed to persist. Students are never
 * shown which version they got.
 */
export function AssignVersionModal({
  classId, midtermId, onClose, onDone,
}: {
  classId: number; midtermId: number; onClose: () => void; onDone: () => void;
}) {
  const [rows, setRows] = useState<VersionAssignRow[]>([]);
  const [versions, setVersions] = useState<MidtermVersionBrief[]>([]);
  const [loading, setLoading] = useState(true);

  const shuffle = useMutation({
    mutationFn: () => midtermApi.previewVersions(classId, midtermId),
    onSuccess: (d) => { setRows(d.assignments); setVersions(d.versions); },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });
  const commit = useMutation({
    mutationFn: () => midtermApi.commitVersions(classId, midtermId, Object.fromEntries(rows.map((r) => [r.student_id, r.version_id]))),
    onSuccess: () => { pushGlobalToast({ tone: "success", message: "Versions assigned to students." }); onDone(); },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  // Load current assignments; if the class isn't fully assigned yet, seed a random preview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cur = await midtermApi.getVersions(classId, midtermId);
        if (cancelled) return;
        setVersions(cur.versions);
        if (cur.assignments.length > 0 && cur.unassigned_count === 0) {
          setRows(cur.assignments);
        } else {
          const p = await midtermApi.previewVersions(classId, midtermId);
          if (!cancelled) { setRows(p.assignments); setVersions(p.versions); }
        }
      } catch (e) {
        if (!cancelled) pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [classId, midtermId]);

  const grouped = useMemo(() => {
    const byNum = new Map<number, VersionAssignRow[]>();
    for (const v of versions) byNum.set(v.version_number, []);
    for (const r of rows) {
      if (!byNum.has(r.version_number)) byNum.set(r.version_number, []);
      byNum.get(r.version_number)!.push(r);
    }
    return versions.map((v) => ({
      v,
      students: (byNum.get(v.version_number) ?? []).slice().sort((a, b) => a.student_name.localeCompare(b.student_name)),
    }));
  }, [rows, versions]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-foreground">Assign versions</h2>
            <p className="text-xs text-muted-foreground">Students are randomly split across versions — they never see which one they got.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {grouped.map(({ v, students }) => (
                <div key={v.id} className="rounded-2xl border border-border bg-surface-2/40 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-extrabold text-foreground">{v.label || `Version ${v.version_number}`}</p>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                      <Users className="h-3 w-3" /> {students.length}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {students.map((s) => <li key={s.student_id} className="truncate text-sm text-foreground">{s.student_name}</li>)}
                    {students.length === 0 ? <li className="text-xs italic text-muted-foreground">No students</li> : null}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button variant="secondary" icon={Shuffle} loading={shuffle.isPending} onClick={() => shuffle.mutate()} disabled={loading}>Re-random</Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button icon={Check} loading={commit.isPending} disabled={loading || rows.length === 0} onClick={() => commit.mutate()}>Proceed</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
