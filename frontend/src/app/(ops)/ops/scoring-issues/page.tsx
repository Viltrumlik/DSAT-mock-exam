"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  User,
  Zap,
} from "lucide-react";
import { StateTag } from "@/components/governance";
import { cn } from "@/lib/cn";
import type { GradingMetrics } from "@/domains/scoring/types";

type FailedAttempt = {
  id: number;
  student_email: string | null;
  student_name: string | null;
  status: string;
  grading_status: string | null;
  grading_attempts: number;
  submitted_at: string | null;
  set_title: string | null;
  assignment_title: string | null;
  stuck_reason: "grading_failed" | "submitted_not_graded";
};

type FailedAttemptsResponse = {
  count: number;
  limit: number;
  offset: number;
  results: FailedAttempt[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScoringIssuesPage() {
  const [metrics, setMetrics] = useState<GradingMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState<FailedAttempt[]>([]);
  const [failedTotal, setFailedTotal] = useState(0);
  const [attemptsLoading, setAttemptsLoading] = useState(true);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);

  // Per-attempt retry state
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [retryResults, setRetryResults] = useState<Record<number, "ok" | "err">>({});

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const r = await api.get("/assessments/admin/grading/metrics/");
      setMetrics(r.data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMetricsError(typeof detail === "string" ? detail : "Could not load metrics.");
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const loadFailedAttempts = useCallback(async () => {
    setAttemptsLoading(true);
    setAttemptsError(null);
    try {
      const r = await api.get("/assessments/admin/attempts/failed/?limit=50");
      const d = r.data as FailedAttemptsResponse;
      setFailedAttempts(d.results);
      setFailedTotal(d.count);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAttemptsError(
        typeof detail === "string" ? detail : "Could not load failed attempts.",
      );
    } finally {
      setAttemptsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    loadFailedAttempts();
  }, [loadMetrics, loadFailedAttempts]);

  // ── Retry handler ─────────────────────────────────────────────────────────

  const retryAttempt = async (attemptId: number) => {
    setRetrying((prev) => ({ ...prev, [attemptId]: true }));
    setRetryResults((prev) => {
      const next = { ...prev };
      delete next[attemptId];
      return next;
    });
    try {
      await api.post(`/assessments/admin/attempts/${attemptId}/requeue/`);
      setRetryResults((prev) => ({ ...prev, [attemptId]: "ok" }));
      // Remove from list after short delay so user sees the success state
      setTimeout(() => {
        setFailedAttempts((prev) => prev.filter((a) => a.id !== attemptId));
        setFailedTotal((t) => Math.max(0, t - 1));
      }, 1500);
    } catch (e: unknown) {
      setRetryResults((prev) => ({ ...prev, [attemptId]: "err" }));
    } finally {
      setRetrying((prev) => ({ ...prev, [attemptId]: false }));
    }
  };

  const refreshAll = () => {
    setRetryResults({});
    loadMetrics();
    loadFailedAttempts();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Admin console · Scoring
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Scoring issues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor the automated scoring pipeline. Failed and stuck attempts appear here for
            one-click retry. Per governance rule, each retry generates an audit event.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Safety protocol note */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-50 p-2 shrink-0">
            <AlertOctagon className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Scoring safety protocol</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Retrying re-queues the grading job.{" "}
              <strong className="text-foreground">
                Student answers are never altered
              </strong>{" "}
              — only the grading computation is re-run. Each retry generates a{" "}
              <code className="font-mono bg-surface-2 px-1 rounded text-xs">
                ScoringRetried
              </code>{" "}
              audit event.
            </p>
          </div>
        </div>
      </div>

      {/* Metrics */}
      {metricsError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {metricsError}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          loading={metricsLoading}
          value={metrics?.queue.pending ?? 0}
          label="Pending scoring"
          icon={<Clock className="h-5 w-5" />}
          color={
            metrics && metrics.queue.pending > 50
              ? "amber"
              : metrics && metrics.queue.pending > 0
              ? "normal"
              : "green"
          }
          tag={
            metrics && metrics.queue.pending > 0 ? (
              <StateTag state="SCORING" size="xs" />
            ) : undefined
          }
        />
        <MetricCard
          loading={metricsLoading}
          value={failedTotal}
          label="Needs attention"
          icon={<AlertOctagon className="h-5 w-5" />}
          color={failedTotal > 0 ? "red" : "green"}
          tag={
            failedTotal > 0 ? (
              <StateTag state="FAILED" size="xs" />
            ) : (
              <StateTag state="SCORED" size="xs" />
            )
          }
        />
        <MetricCard
          loading={metricsLoading}
          value={
            metrics?.latency_seconds.p50 != null
              ? `${Math.round(metrics.latency_seconds.p50 * 1000)}ms`
              : "—"
          }
          label="Median grading latency"
          icon={<Zap className="h-5 w-5" />}
          color="normal"
        />
      </div>

      {/* Failed attempts list */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-3">
          <p className="font-bold text-foreground">
            Failed & stuck attempts
            {failedTotal > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                {failedTotal}
              </span>
            )}
          </p>
          {failedTotal > 50 && (
            <p className="text-xs text-muted-foreground">
              Showing first 50 of {failedTotal}
            </p>
          )}
        </div>

        {attemptsLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-8 rounded bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-40 rounded bg-muted" />
                  <div className="h-3 w-56 rounded bg-muted" />
                </div>
                <div className="h-8 w-16 rounded-xl bg-muted" />
              </div>
            ))}
          </div>
        ) : attemptsError ? (
          <div className="p-6 text-center text-sm font-semibold text-red-700">
            {attemptsError}
          </div>
        ) : failedAttempts.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500" />
            <p className="font-semibold text-foreground">No scoring failures</p>
            <p className="text-sm mt-1">The scoring pipeline is operating normally.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {failedAttempts.map((att) => {
              const isRetrying = retrying[att.id];
              const retryResult = retryResults[att.id];

              return (
                <div
                  key={att.id}
                  className={cn(
                    "px-5 py-4 flex flex-wrap items-start gap-3 transition-colors",
                    retryResult === "ok" && "bg-emerald-50",
                  )}
                >
                  {/* Attempt info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-bold text-muted-foreground">
                        #{att.id}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold",
                          att.stuck_reason === "grading_failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {att.stuck_reason === "grading_failed"
                          ? "Grading failed"
                          : "Stuck — not graded"}
                      </span>
                      {att.grading_attempts > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {att.grading_attempts} attempt{att.grading_attempts !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-foreground truncate">
                      {att.assignment_title ?? att.set_title ?? "Unknown assignment"}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      {att.student_email && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3 shrink-0" />
                          {att.student_name
                            ? `${att.student_name} (${att.student_email})`
                            : att.student_email}
                        </span>
                      )}
                      {att.submitted_at && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          Submitted {formatDate(att.submitted_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Retry / status */}
                  <div className="shrink-0">
                    {retryResult === "ok" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Requeued
                      </span>
                    ) : retryResult === "err" ? (
                      <div className="text-right">
                        <p className="text-xs text-red-700 font-semibold mb-1">Retry failed</p>
                        <button
                          type="button"
                          onClick={() => void retryAttempt(att.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Try again
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void retryAttempt(att.id)}
                        disabled={isRetrying}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
                      >
                        {isRetrying ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Retrying…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Retry
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Metric card component ────────────────────────────────────────────────────

function MetricCard({
  loading,
  value,
  label,
  icon,
  color,
  tag,
}: {
  loading: boolean;
  value: number | string;
  label: string;
  icon: React.ReactNode;
  color: "normal" | "amber" | "red" | "green";
  tag?: React.ReactNode;
}) {
  const colorClasses = {
    normal: "text-foreground",
    amber: "text-amber-600",
    red: "text-red-600",
    green: "text-emerald-600",
  };

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-5 animate-pulse h-24" />;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className={cn("mb-2", colorClasses[color])}>{icon}</div>
      <p className={cn("text-2xl font-extrabold tabular-nums", colorClasses[color])}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        {tag}
      </div>
    </div>
  );
}
