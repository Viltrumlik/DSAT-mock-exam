"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { ClipboardCheck, Loader2, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

function permissionList(me: Record<string, unknown> | undefined | null): string[] {
  if (!me) return [];
  const p = me.permissions;
  if (!Array.isArray(p)) return [];
  return p.filter((x): x is string => typeof x === "string");
}

function staffAccess(perms: string[]): boolean {
  return (
    perms.includes("*") ||
    perms.includes("manage_users") ||
    perms.includes("assign_access") ||
    perms.includes("manage_tests")
  );
}

function isAssessmentAssignmentRow(a: { assessment_homework?: unknown | null } | null | undefined): boolean {
  return a != null && a.assessment_homework != null;
}

type Row = {
  assignmentId: number;
  title: string;
  classId: number;
  className: string;
  due_at?: string | null;
  kind: "workspace" | "due_soon";
};

function formatDue(iso?: string | null): string {
  if (!iso) return "No due date";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return Math.ceil((t.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function AssessmentsHubPage() {
  const { me } = useMe();
  const perms = permissionList(me as Record<string, unknown>);
  const canAssign = staffAccess(perms);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await classesApi.list();
      const classes = list.items ?? [];
      const out: Row[] = [];
      const seen = new Set<string>();

      for (const g of classes) {
        const cid = Number(g.id);
        if (!Number.isFinite(cid)) continue;
        const name = String(g.name || `Class #${cid}`);
        try {
          const ws = await classesApi.getStudentWorkspace(cid);
          if (!ws || typeof ws !== "object") continue;
          const your = Array.isArray((ws as { your_assignments?: unknown }).your_assignments)
            ? ((ws as { your_assignments: unknown[] }).your_assignments as Record<string, unknown>[])
            : [];
          const dueSoon = Array.isArray((ws as { due_soon?: unknown }).due_soon)
            ? ((ws as { due_soon: unknown[] }).due_soon as Record<string, unknown>[])
            : [];

          for (const a of your) {
            if (!isAssessmentAssignmentRow(a)) continue;
            const id = Number(a.id);
            if (!Number.isFinite(id)) continue;
            const key = `${cid}:${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              assignmentId: id,
              title: String(a.title || "Untitled"),
              classId: cid,
              className: name,
              due_at: (a.due_at as string | null | undefined) ?? null,
              kind: "workspace",
            });
          }
          for (const a of dueSoon) {
            if (!isAssessmentAssignmentRow(a)) continue;
            const id = Number(a.id);
            if (!Number.isFinite(id)) continue;
            const key = `${cid}:${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              assignmentId: id,
              title: String(a.title || "Untitled"),
              classId: cid,
              className: name,
              due_at: (a.due_at as string | null | undefined) ?? null,
              kind: "due_soon",
            });
          }
        } catch {
          /* skip class */
        }
      }

      out.sort((x, y) => {
        const tx = x.due_at ? new Date(x.due_at).getTime() : Infinity;
        const ty = y.due_at ? new Date(y.due_at).getTime() : Infinity;
        return tx - ty;
      });

      setRows(out);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load assessments.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    let overdue = 0;
    let upcoming = 0;
    for (const r of rows) {
      const d = daysUntil(r.due_at);
      if (d != null && d < 0) overdue++;
      else if (d != null && d <= 7) upcoming++;
    }
    return { overdue, upcoming, total: rows.length };
  }, [rows]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ds-gold">Assessments</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Your homework assessments</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Assigned assessments from your classes. Open one to start or continue your attempt.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold hover:bg-surface-2 disabled:opacity-60"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {canAssign ? (
        <div className="mt-6 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/8 via-card to-amber-500/5 p-5 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-ds-gold">Staff</p>
          <p className="mt-1 text-sm font-semibold text-foreground">Assign assessments to classes</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create homework links from assessment sets and push them to classrooms.
          </p>
          <Link
            href="/assessments/assign"
            className={cn(
              "mt-4 inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold",
              "ms-btn-primary ms-cta-fill border-transparent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/90 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            Assign assessments
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Due within 7 days</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{stats.upcoming}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Overdue</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-red-600 dark:text-red-400">{stats.overdue}</p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <span className="font-bold text-foreground">Assignments</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-semibold text-foreground">No assessment homework yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              When your teachers assign assessments to your classes, they will appear here. You can also check{" "}
              <Link href="/classes" className="font-bold text-primary underline">
                Classes
              </Link>{" "}
              for classwork.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const d = daysUntil(r.due_at);
              const overdue = d != null && d < 0;
              return (
                <li key={`${r.classId}-${r.assignmentId}`} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-foreground">{r.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{r.className}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Due {formatDue(r.due_at)}</span>
                      {overdue ? (
                        <Badge variant="neutral" className="border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                          Overdue
                        </Badge>
                      ) : d != null && d <= 3 ? (
                        <Badge variant="brand">Soon</Badge>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={`/assessments/${r.assignmentId}`}
                    className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-95"
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
