"use client";

/**
 * InterventionPanel
 *
 * Teacher-facing actionable signals for a classroom. Surfaces:
 *   1. Class health stats (completion rate, avg score, active students)
 *   2. Overdue students — who hasn't submitted past-due work
 *   3. Inactive students — no activity in ≥7 days
 *   4. Low-score students — avg assessment score below 60%
 *   5. Assignment completion breakdown — per-assignment rates
 *
 * Design principle: every item is an actionable signal, not analytics wallpaper.
 * Show only what the teacher can act on right now.
 *
 * Data: GET /api/classes/{id}/interventions/
 */

import { useEffect, useRef, useState } from "react";
import { classesApi } from "@/lib/api";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  TrendingDown,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverdueStudent = {
  student_id: number;
  email: string;
  first_name: string;
  last_name: string;
  overdue_count: number;
  oldest_overdue_due_at: string | null;
};

type InactiveStudent = {
  student_id: number;
  email: string;
  first_name: string;
  last_name: string;
  last_activity_at: string | null;
  days_inactive: number | null;
};

type LowScoreStudent = {
  student_id: number;
  email: string;
  first_name: string;
  last_name: string;
  avg_score_pct: number;
};

type AssignmentCompletion = {
  assignment_id: number;
  title: string;
  due_at: string | null;
  is_overdue: boolean;
  is_assessment: boolean;
  submitted_count: number;
  student_count: number;
  completion_pct: number;
};

type ClassStats = {
  student_count: number;
  assignment_count: number;
  overall_completion_pct: number;
  avg_assessment_score_pct: number | null;
};

type InterventionData = {
  overdue_students: OverdueStudent[];
  inactive_students: InactiveStudent[];
  low_score_students: LowScoreStudent[];
  completion_summary: AssignmentCompletion[];
  class_stats: ClassStats;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fullName(s: { first_name: string; last_name: string; email: string }): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ");
  return n || s.email;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function ScoreBar({ pct, danger }: { pct: number; danger?: boolean }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          danger || pct < 40
            ? "bg-red-500"
            : pct < 60
            ? "bg-orange-400"
            : pct < 80
            ? "bg-amber-400"
            : "bg-emerald-500",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ─── Sub-sections ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: "red" | "orange" | "green" | "default";
}) {
  const accentClass = {
    red: "text-red-600",
    orange: "text-orange-600",
    green: "text-emerald-600",
    default: "text-foreground",
  }[accent ?? "default"];

  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <p className={cn("text-xl font-black tabular-nums", accentClass)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SectionHeader({ label, count, accent }: { label: string; count: number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-xs font-extrabold uppercase tracking-wide text-foreground">{label}</h3>
      {count > 0 && (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black",
            accent ?? "bg-surface-2 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function EmptySignal({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-3">
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

// ─── Copy email chip ──────────────────────────────────────────────────────────

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — ignore silently
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Copy ${email}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors shrink-0",
        copied
          ? "bg-emerald-100 text-emerald-700"
          : "bg-surface-2 text-muted-foreground hover:bg-border hover:text-foreground",
      )}
    >
      <Copy className="h-2.5 w-2.5" />
      {copied ? "Copied" : "Email"}
    </button>
  );
}

// ─── Inline due-date extender ─────────────────────────────────────────────────

function ExtendDueDateButton({
  classroomId,
  assignmentId,
  currentDueAt,
  onExtended,
}: {
  classroomId: number;
  assignmentId: number;
  currentDueAt: string | null;
  onExtended: (newDueAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the picker to 7 days from now (or 7 days from current due_at if it's in the future)
  const defaultDate = (() => {
    const base = currentDueAt && new Date(currentDueAt) > new Date()
      ? new Date(currentDueAt)
      : new Date();
    base.setDate(base.getDate() + 7);
    // Format as yyyy-MM-ddTHH:mm for datetime-local input
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
  })();

  const [pickerValue, setPickerValue] = useState(defaultDate);

  const save = async () => {
    if (!pickerValue) return;
    setSaving(true);
    setError(null);
    try {
      await classesApi.updateAssignment(classroomId, assignmentId, {
        due_at: new Date(pickerValue).toISOString(),
      });
      onExtended(new Date(pickerValue).toISOString());
      setOpen(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not update due date.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-border hover:text-foreground transition-colors shrink-0"
      >
        <CalendarDays className="h-2.5 w-2.5" />
        Extend
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      <input
        type="datetime-local"
        value={pickerValue}
        onChange={(e) => setPickerValue(e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !pickerValue}
        className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[10px] font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
        Save
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        className="text-[10px] font-bold text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
      {error && <p className="text-[10px] font-semibold text-red-600 w-full">{error}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function InterventionPanel({ classroomId }: { classroomId: number }) {
  const [data, setData] = useState<InterventionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track inline due-date overrides so the UI updates without a full reload
  const [dueDateOverrides, setDueDateOverrides] = useState<Record<number, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await classesApi.getInterventions(classroomId);
      setData(r as InterventionData);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not load intervention data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-muted-foreground justify-center">
        <Loader2 className="h-5 w-5 animate-spin shrink-0" />
        Loading intervention signals…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const {
    overdue_students,
    inactive_students,
    low_score_students,
    completion_summary,
    class_stats,
  } = data;

  const totalSignals =
    overdue_students.length + inactive_students.length + low_score_students.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-0.5">
            Actionable signals
          </p>
          <h2 className="text-base font-extrabold text-foreground">
            Class interventions
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {totalSignals > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              {totalSignals} student{totalSignals !== 1 ? "s" : ""} need attention
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          icon={Users}
          label="Students"
          value={String(class_stats.student_count)}
        />
        <StatCard
          icon={BookOpen}
          label="Assignments"
          value={String(class_stats.assignment_count)}
        />
        <StatCard
          icon={CheckCircle2}
          label="Completion"
          value={`${class_stats.overall_completion_pct}%`}
          accent={
            class_stats.overall_completion_pct >= 80
              ? "green"
              : class_stats.overall_completion_pct >= 50
              ? "orange"
              : "red"
          }
        />
        <StatCard
          icon={TrendingDown}
          label="Avg score"
          value={
            class_stats.avg_assessment_score_pct != null
              ? `${class_stats.avg_assessment_score_pct}%`
              : "—"
          }
          sub={class_stats.avg_assessment_score_pct != null ? "assessment avg" : "no scores yet"}
          accent={
            class_stats.avg_assessment_score_pct == null
              ? "default"
              : class_stats.avg_assessment_score_pct >= 70
              ? "green"
              : class_stats.avg_assessment_score_pct >= 50
              ? "orange"
              : "red"
          }
        />
      </div>

      {/* Overdue students */}
      <div>
        <SectionHeader
          label="Overdue work"
          count={overdue_students.length}
          accent="bg-red-100 text-red-800"
        />
        {overdue_students.length === 0 ? (
          <EmptySignal text="No students have overdue work — class is on track." />
        ) : (
          <div className="space-y-1.5">
            {overdue_students.map((s) => (
              <div
                key={s.student_id}
                className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50/40 px-4 py-2.5"
              >
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">{fullName(s)}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <CopyEmailButton email={s.email} />
                  <div className="text-right">
                    <p className="text-xs font-black text-red-700 tabular-nums">
                      {s.overdue_count} overdue
                    </p>
                    {s.oldest_overdue_due_at && (
                      <p className="text-[10px] text-muted-foreground">
                        oldest {formatDate(s.oldest_overdue_due_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inactive students */}
      <div>
        <SectionHeader
          label="Inactive (7+ days)"
          count={inactive_students.length}
          accent="bg-orange-100 text-orange-800"
        />
        {inactive_students.length === 0 ? (
          <EmptySignal text="All students have submitted work this week." />
        ) : (
          <div className="space-y-1.5">
            {inactive_students.map((s) => (
              <div
                key={s.student_id}
                className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50/30 px-4 py-2.5"
              >
                <WifiOff className="h-4 w-4 text-orange-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">{fullName(s)}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <CopyEmailButton email={s.email} />
                  <div className="text-right">
                    {s.days_inactive != null ? (
                      <p className="text-xs font-black text-orange-700 tabular-nums">
                        {s.days_inactive}d inactive
                      </p>
                    ) : (
                      <p className="text-xs font-black text-orange-700">Never active</p>
                    )}
                    {s.last_activity_at && (
                      <p className="text-[10px] text-muted-foreground">
                        last {formatDate(s.last_activity_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Low-score students */}
      <div>
        <SectionHeader
          label="Struggling (score < 60%)"
          count={low_score_students.length}
          accent="bg-purple-100 text-purple-800"
        />
        {low_score_students.length === 0 ? (
          <EmptySignal text="No students are consistently scoring below 60%." />
        ) : (
          <div className="space-y-1.5">
            {low_score_students.map((s) => (
              <div
                key={s.student_id}
                className="flex items-center gap-3 rounded-xl border border-purple-200 bg-purple-50/20 px-4 py-2.5"
              >
                <TrendingDown className="h-4 w-4 text-purple-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">{fullName(s)}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <div className="shrink-0 text-right w-16">
                  <p className="text-xs font-black text-purple-700 tabular-nums">
                    {s.avg_score_pct}%
                  </p>
                  <ScoreBar pct={s.avg_score_pct} danger />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignment completion breakdown */}
      {completion_summary.length > 0 && (
        <div>
          <SectionHeader label="Assignment completion" count={completion_summary.length} />
          <div className="space-y-2">
            {completion_summary.map((a) => {
              const effectiveDueAt = dueDateOverrides[a.assignment_id] ?? a.due_at;
              const isNowOverdue = effectiveDueAt
                ? new Date(effectiveDueAt) < new Date()
                : false;
              return (
                <div
                  key={a.assignment_id}
                  className={cn(
                    "rounded-xl border px-4 py-3",
                    isNowOverdue && a.completion_pct < 100
                      ? "border-amber-200 bg-amber-50/20"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start gap-3 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold text-foreground truncate">{a.title}</p>
                        {a.is_assessment && (
                          <span className="rounded-md bg-teal-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-teal-700">
                            assessment
                          </span>
                        )}
                        {isNowOverdue && a.completion_pct < 100 && (
                          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">
                            overdue
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {effectiveDueAt && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            Due {formatDate(effectiveDueAt)}
                            {dueDateOverrides[a.assignment_id] && (
                              <span className="ml-1 text-emerald-600 font-bold">(updated)</span>
                            )}
                          </p>
                        )}
                        {/* Extend due date — inline action without leaving the panel */}
                        <ExtendDueDateButton
                          classroomId={classroomId}
                          assignmentId={a.assignment_id}
                          currentDueAt={effectiveDueAt}
                          onExtended={(newDue) =>
                            setDueDateOverrides((prev) => ({ ...prev, [a.assignment_id]: newDue }))
                          }
                        />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black tabular-nums text-foreground">
                        {a.submitted_count}/{a.student_count}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{a.completion_pct}%</p>
                    </div>
                  </div>
                  <ScoreBar pct={a.completion_pct} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All-clear state */}
      {totalSignals === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 shrink-0">
            <Wifi className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-emerald-900">Class is on track</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              No students flagged for overdue work, inactivity, or low scores right now.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
