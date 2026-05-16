"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import type { AssignmentDispatchRow, SkippedUserRow } from "./types";

function statusStyle(s: string): string {
  const v = String(s || "").toLowerCase();
  if (v === "completed") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (v === "delivered") return "text-blue-700 bg-blue-50 border-blue-200";
  if (v === "pending") return "text-amber-700 bg-amber-50 border-amber-200";
  if (v === "failed") return "text-red-700 bg-red-50 border-red-200";
  return "text-muted-foreground bg-surface-2 border-border";
}

type Props = {
  entries: AssignmentDispatchRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onLoadInWizard: (entry: AssignmentDispatchRow) => void;
  onRerun: (dispatchId: number) => void;
  rerunBusyId: number | null;
};

export function AssignmentHistoryPanel({
  entries,
  loading,
  error,
  onRefresh,
  onLoadInWizard,
  onRerun,
  rerunBusyId,
}: Props) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-surface-2">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">Assignment history</h3>
            <p className="text-[11px] text-muted-foreground">
              Server-backed log of library bulk dispatches. Re-run replays the stored payload with your current
              permissions.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Refresh
        </button>
      </div>
      {error ? (
        <div className="px-5 py-3 text-sm text-red-700 bg-red-50/80 border-b border-red-100">{error}</div>
      ) : null}
      {loading && entries.length === 0 ? (
        <div className="px-5 py-10 flex justify-center items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading history…
        </div>
      ) : null}
      {!loading && entries.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No dispatches yet. Complete an assignment run to build history.
        </div>
      ) : null}
      {entries.length > 0 ? (
        <ul className="divide-y divide-border max-h-[360px] overflow-y-auto">
          {entries.map((e) => {
            const cc = (e.payload?.client_context || {}) as Record<string, unknown>;
            const label =
              (typeof cc.content_label === "string" && cc.content_label) ||
              (e.kind === "pastpaper" ? "Pastpaper library" : e.kind === "timed_mock" ? "Timed mock" : e.kind);
            const rawSkipped = e.result?.skipped_users;
            const skippedUsers: SkippedUserRow[] = Array.isArray(rawSkipped)
              ? (rawSkipped as SkippedUserRow[])
              : [];
            const skipped = skippedUsers.length;
            const req = Number(e.students_requested_count ?? 0);
            const granted = Number(e.students_granted_count ?? 0);
            const noneGrantedAllSkipped = req > 0 && granted === 0;
            const partialGrant = req > 0 && granted > 0 && granted < req;
            const firstSkipReason =
              noneGrantedAllSkipped && skippedUsers[0]
                ? String(skippedUsers[0].reason || "").trim()
                : "";
            return (
              <li
                key={e.id}
                className={`px-5 py-3 flex flex-wrap items-start gap-3 justify-between ${
                  noneGrantedAllSkipped ? "bg-amber-50/40" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {e.subject_summary ? <span>{e.subject_summary} · </span> : null}
                    {noneGrantedAllSkipped ? (
                      <span className="text-amber-900 font-medium">
                        No library access granted — all {req} student{req === 1 ? "" : "s"} skipped
                        {firstSkipReason ? ` (${firstSkipReason})` : ""}
                      </span>
                    ) : (
                      <>
                        Granted <strong>{granted}</strong> / {req} students
                        {skipped ? (
                          <>
                            {" "}
                            · <span className="text-amber-700">{skipped} skipped</span>
                          </>
                        ) : null}
                        {partialGrant ? (
                          <span className="text-muted-foreground"> · partial</span>
                        ) : null}
                      </>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {new Date(e.created_at).toLocaleString()}
                    {e.assigned_by_name ? <> · {e.assigned_by_name}</> : null}
                    <span className={`ml-2 inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusStyle(e.status)}`}>
                      {e.status}
                    </span>
                    {noneGrantedAllSkipped ? (
                      <span className="ml-2 inline-flex items-center rounded-lg border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        No grants
                      </span>
                    ) : null}
                    {e.rerun_of ? <span className="ml-1 text-muted-foreground">· re-run of #{e.rerun_of}</span> : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={rerunBusyId != null}
                    onClick={() => onLoadInWizard(e)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40"
                  >
                    Use in wizard
                  </button>
                  <button
                    type="button"
                    disabled={rerunBusyId != null}
                    onClick={() => onRerun(e.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {rerunBusyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Re-run
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
