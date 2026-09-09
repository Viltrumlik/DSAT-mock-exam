"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui";

import { errText, supportReportApi } from "./api";
import { monthEnd, monthStart } from "./format";
import { MonthlySummary, monthOptions } from "./MonthlySummary";
import { ErrorPanel, SectionCard, TableSkeleton } from "./ReportUI";
import { SessionHistory, type HistoryRequest } from "./SessionHistory";
import { UnsettledBacklogPanel } from "./UnsettledBacklogPanel";
import type { MonthKey, SupportMonthlyReport } from "./types";
import { STATUS_UNSETTLED } from "./types";

/**
 * The ops console's support-session report: what the desk did, and what it has left undone.
 *
 * The order on the page is the argument. The **unsettled backlog** comes first, because it is
 * the one thing here that is costing the school something right now and nothing anywhere told
 * anybody about it. Then the **month**, which is the report the school asked for. Then the
 * **session history** underneath, which is the evidence for both — and the banner links
 * straight into it, because a finding you cannot act on is a finding people learn to scroll
 * past.
 *
 * **Data fetching is plain `useState` + axios, not React Query, and that is not an oversight.**
 * The in-app browser pane reports `visibilityState: "hidden"`, which pauses React Query's
 * retries indefinitely — a failed fetch never resolves and the page spins forever. Every ops
 * surface fetches this way.
 */
export function SupportReportPage() {
  /** null until the first response: the backend opens on the school's own current month. */
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [report, setReport] = useState<SupportMonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<HistoryRequest | null>(null);

  /**
   * The date range the history opens on, decided **once** from the first month that arrives.
   *
   * Deliberately not re-derived when the picker moves. The summary and the history answer two
   * different questions, and driving the second from the first would silently discard filters
   * a reader had set by hand — a table that resets itself while you are reading it is worse
   * than one whose range you change twice.
   */
  const [seed, setSeed] = useState<{ from: string; to: string } | null>(null);
  const seeded = useRef(false);

  const settleSeed = useCallback((seedMonth: MonthKey | null) => {
    if (seeded.current) return;
    seeded.current = true;
    setSeed({ from: monthStart(seedMonth), to: monthEnd(seedMonth) });
  }, []);

  const load = useCallback(
    async (requested: MonthKey | null) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await supportReportApi.monthly(requested);
        setReport(payload);
        settleSeed(payload.month);
      } catch (e) {
        // Never fall back to an empty payload. "No sessions this month" where a request failed
        // is a lie about a support teacher's month, and this page is read to judge one.
        setReport(null);
        setError(errText(e, "Could not load the monthly support report."));
        // The history is a separate request and may well succeed; it just opens unfiltered
        // rather than on a month nobody could tell it.
        settleSeed(null);
      } finally {
        setLoading(false);
      }
    },
    [settleSeed],
  );

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const months = report?.months ?? [];
  /** What the picker shows: the month asked for, so it does not snap back mid-request. */
  const pickerMonth = month ?? report?.month ?? "";

  const monthPicker =
    months.length > 0 ? (
      <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <CalendarClock className="h-4 w-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Month</span>
        <span className="w-48">
          <Select
            selectSize="sm"
            value={pickerMonth}
            onChange={(e) => setMonth(e.target.value || null)}
            aria-label="Report month"
          >
            {/* A control whose value matches no option renders blank, which reads as a broken
                picker rather than as the honest answer it is. */}
            {pickerMonth ? null : <option value="">No month with sessions</option>}
            {monthOptions(months)}
          </Select>
        </span>
      </label>
    ) : null;

  return (
    <div className="space-y-4">
      {/* ── 1. The backlog, impossible to miss ──────────────────────────────────────── */}
      {report?.backlog ? (
        <UnsettledBacklogPanel
          backlog={report.backlog}
          onShowUnsettled={(teacherId) =>
            setJump((prev) => ({
              teacher: teacherId,
              status: STATUS_UNSETTLED,
              nonce: (prev?.nonce ?? 0) + 1,
            }))
          }
        />
      ) : null}

      {/* ── 2. The month ────────────────────────────────────────────────────────────── */}
      {error ? (
        <ErrorPanel message={error} onRetry={() => void load(month)} />
      ) : loading || report == null ? (
        <div className="space-y-4" aria-busy>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
          <SectionCard>
            <TableSkeleton rows={4} />
          </SectionCard>
        </div>
      ) : (
        <MonthlySummary report={report} monthPicker={monthPicker} />
      )}

      {/* ── 3. The evidence ─────────────────────────────────────────────────────────── */}
      {/* Mounted once the first month has settled, so its date range is seeded from a real
          answer rather than from the empty string the loading state would hand it. The
          teacher options come from the monthly rows: the history's own payload does not carry
          them, and every support teacher has a row there whether or not they ran anything. */}
      {seed ? (
        <SessionHistory
          initialFrom={seed.from}
          initialTo={seed.to}
          teacherOptions={report?.teachers ?? []}
          request={jump}
        />
      ) : (
        <SectionCard>
          <TableSkeleton rows={6} />
        </SectionCard>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void load(month)}
          className="ds-ring inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-bold text-foreground transition-colors hover:bg-surface-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh the month
        </button>
      </div>
    </div>
  );
}

export default SupportReportPage;
