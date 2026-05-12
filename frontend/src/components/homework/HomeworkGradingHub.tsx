"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import { subscribeRealtime } from "@/lib/realtime";
import { AlertTriangle, Calendar, ChevronRight, ClipboardCheck } from "lucide-react";

type Row = {
  id: number;
  title: string;
  due_at?: string | null;
  created_at?: string | null;
  submissions_count?: number;
  members_count?: number;
  classroom_id: number;
  classroom_name: string;
  subject?: string;
};

type Props = {
  /** Base URL for this flow, e.g. `/teacher/homework/grading` */
  basePath: string;
  /** Where to send users to create homework (empty state / help) */
  homeworkManagementHref: string;
  homeworkManagementLabel: string;
};

export default function HomeworkGradingHub({
  basePath,
  homeworkManagementHref,
  homeworkManagementLabel,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const base = basePath.replace(/\/$/, "");

  const fetchRows = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const all = await classesApi.list();
      const groups = all.items.filter((g) => g.my_role === "ADMIN");
      const out: Row[] = [];
      for (const g of groups) {
        const list = await classesApi.listAssignments(g.id);
        const arr = list.items;
        for (const a of arr) {
          out.push({
            id: Number(a.id),
            title: String(a.title || "Untitled"),
            due_at: a.due_at ?? null,
            created_at: typeof (a as Record<string, unknown>).created_at === "string" ? (a as Record<string, unknown>).created_at as string : null,
            submissions_count: typeof a.submissions_count === "number" ? a.submissions_count : undefined,
            members_count: typeof g.members_count === "number" ? g.members_count : undefined,
            classroom_id: g.id,
            classroom_name: g.name || `Class #${g.id}`,
            subject: g.subject,
          });
        }
      }
      // Sort: overdue-with-missing-submissions first, then by due date desc
      const urgencyScore = (row: Row) => {
        const isOverdue = row.due_at ? new Date(row.due_at) < new Date() : false;
        const hasMissing =
          row.submissions_count != null &&
          row.members_count != null &&
          row.submissions_count < row.members_count;
        return isOverdue && hasMissing ? 1 : 0;
      };
      out.sort((x, y) => {
        const uDiff = urgencyScore(y) - urgencyScore(x);
        if (uDiff !== 0) return uDiff;
        const tx = x.due_at ? new Date(x.due_at).getTime() : 0;
        const ty = y.due_at ? new Date(y.due_at).getTime() : 0;
        return ty - tx;
      });
      setRows(out);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load homework.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Realtime: silently refresh submission counts when workspace events fire
  useEffect(() => {
    const unsub = subscribeRealtime(
      {
        onEvent: async (ev) => {
          const relevantTypes = ["workspace.updated", "stream.updated", "resync"];
          if (relevantTypes.includes(ev.type)) {
            await fetchRows(true);
          }
        },
      },
      { debounceMs: 300 },
    );
    return () => unsub();
  }, [fetchRows]);

  const formatDue = (s?: string | null) => {
    if (!s) return "No deadline";
    try {
      return new Date(s).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return s;
    }
  };

  const empty = useMemo(() => rows.length === 0 && !loading && !error, [rows.length, loading, error]);

  const attentionCount = useMemo(
    () =>
      rows.filter((r) => {
        const isOverdue = r.due_at ? new Date(r.due_at) < new Date() : false;
        const missing =
          r.submissions_count != null && r.members_count != null
            ? r.members_count - r.submissions_count
            : null;
        return isOverdue && missing != null && missing > 0;
      }).length,
    [rows],
  );

  /** Assignments created >3 days ago with zero submissions — likely not communicated to students. */
  const STALE_DAYS = 3;
  const staleIds = useMemo(() => {
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    return new Set(
      rows
        .filter((r) => {
          if (!r.created_at) return false;
          const createdMs = new Date(r.created_at).getTime();
          const zeroSubmissions = r.submissions_count === 0;
          return zeroSubmissions && createdMs < cutoff;
        })
        .map((r) => r.id),
    );
  }, [rows]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      {/* § 4.4 — top breadcrumb; same destination as bottom link but visible without scrolling */}
      <div className="mb-4">
        <Link href={homeworkManagementHref} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          ← {homeworkManagementLabel}
        </Link>
      </div>

      <div className="mb-8">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-primary">Grading</p>
        {/* § 4.2 — heading scale aligned to page-level content hierarchy */}
        <h1 className="text-xl font-bold tracking-tight text-foreground">Grade homework</h1>
        <p className="mt-2 text-muted-foreground">
          Open an assignment to see who turned work in, review uploads and pastpaper results, and enter grades.
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex justify-center rounded-2xl border border-border bg-card p-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : empty ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <div className="rounded-full bg-surface-2 p-4 w-16 h-16 mx-auto flex items-center justify-center mb-4">
            <ClipboardCheck className="h-7 w-7 text-muted-foreground/50" />
          </div>
          <p className="font-extrabold text-foreground">No assignments to grade yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
            Once you create homework and students submit, their work will appear here for review.
          </p>
          <Link
            href={homeworkManagementHref}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create first assignment →
          </Link>
        </div>
      ) : (
        <>
        {attentionCount > 0 && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-extrabold text-red-800">
                {attentionCount} assignment{attentionCount === 1 ? "" : "s"} overdue with missing submissions
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Highlighted below — consider chasing students or extending the deadline.
              </p>
            </div>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4 font-bold text-foreground">All homework</div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isOverdue = r.due_at ? new Date(r.due_at) < new Date() : false;
              const missing =
                r.submissions_count != null && r.members_count != null
                  ? r.members_count - r.submissions_count
                  : null;
              const needsAttention = isOverdue && missing != null && missing > 0;
              const allIn =
                r.submissions_count != null &&
                r.members_count != null &&
                r.submissions_count >= r.members_count;
              const isStale = staleIds.has(r.id);
              return (
                <li key={`${r.classroom_id}-${r.id}`}>
                  <Link
                    href={`${base}/${r.classroom_id}/${r.id}`}
                    className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors ${
                      needsAttention ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <p className="truncate font-extrabold text-foreground">{r.title}</p>
                        {needsAttention && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            {missing} missing
                          </span>
                        )}
                        {allIn && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            All in
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground/90">{r.classroom_name}</span>
                        {r.subject ? <span> · {r.subject}</span> : null}
                      </p>
                      <p className="mt-1 inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className={`inline-flex items-center gap-1 ${isOverdue && !allIn ? "font-semibold text-red-600" : ""}`}>
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDue(r.due_at)}
                        </span>
                        {typeof r.submissions_count === "number" ? (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                            <ClipboardCheck className="h-3.5 w-3.5" />
                            {r.submissions_count}
                            {r.members_count != null ? ` / ${r.members_count}` : ""} submitted
                          </span>
                        ) : null}
                      </p>
                      {isStale && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          No submissions yet — was this assignment communicated to students?
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href={homeworkManagementHref} className="font-semibold text-primary hover:underline">
          ← {homeworkManagementLabel}
        </Link>
      </p>
    </div>
  );
}
