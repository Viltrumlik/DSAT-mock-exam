"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Input, Select } from "@/components/ui";

import { errText, supportReportApi, type SessionFilters } from "./api";
import {
  FALLBACK_STATUS_OPTIONS,
  NO_TOPIC,
  UNSETTLED_LABEL,
  formatDay,
  formatTime,
  formatWhen,
  pageRange,
  personName,
  plural,
  sessionStatusLabel,
  topicText,
} from "./format";
import {
  Column,
  DataTable,
  EmptyPanel,
  ErrorPanel,
  Note,
  SectionCard,
  StatusPill,
  TableSkeleton,
} from "./ReportUI";
import type {
  HistoryStatus,
  MonthlyTeacherRow,
  StatusOption,
  SupportSessionRow,
  SupportSessionsReport,
} from "./types";
import { STATUS_UNSETTLED } from "./types";

/**
 * The session-by-session history: who was helped, when, on what, and how it went.
 *
 * This is the owner's first question — *kimlar bilan support qilgan, nechida va qachon,
 * mavzu va boshqa detallari* — so the **topic** is a first-class column rather than a
 * tooltip, and `invited_by` is shown wherever it is set: a student who was *invited* into
 * somebody's hour did not choose it, which changes how a missed session on that row reads.
 *
 * Fetches on its own, with plain `useState` + axios rather than React Query. The in-app
 * browser pane reports `visibilityState: "hidden"`, which pauses React Query's retries
 * indefinitely — a failed fetch would never resolve and the table would spin forever. Every
 * ops surface fetches this way.
 */

/** One page. The backend's own default; the desk is small enough that 50 is usually all of it. */
const PAGE_SIZE = 50;

/** What the page above asks this table to show. A new `nonce` re-applies it. */
export type HistoryRequest = {
  teacher: number | null;
  status: HistoryStatus | "";
  /** Bumped on every request so the same filters can be asked for twice. */
  nonce: number;
};

type Props = {
  /**
   * The date range the table opens on, seeded from the month the report opened on. Read once,
   * on mount: the summary and the history answer different questions, and driving the second
   * from the first would silently discard a range the reader had set by hand.
   */
  initialFrom?: string;
  initialTo?: string;
  /** The desk's teachers, from the monthly payload — the history's own page does not carry them. */
  teacherOptions?: Pick<MonthlyTeacherRow, "support_teacher_id" | "support_teacher">[];
  /** The backlog banner's "show me which", applied when its nonce changes. */
  request?: HistoryRequest | null;
};

/** A student the reader can filter to. Built from the rows on screen — see `studentOptions`. */
type StudentOption = { id: number; name: string };

export function SessionHistory({
  initialFrom,
  initialTo,
  teacherOptions = [],
  request,
}: Props) {
  const [teacher, setTeacher] = useState<number | null>(null);
  const [status, setStatus] = useState<HistoryStatus | "">("");
  const [from, setFrom] = useState<string>(initialFrom ?? "");
  const [to, setTo] = useState<string>(initialTo ?? "");
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<SupportSessionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * The students the picker offers.
   *
   * The endpoint filters by `student_id`, and there is no roster in either payload — so the
   * options are the students in the rows currently loaded under the *other* filters, and they
   * are refreshed only while no student is selected. Without that guard the list would
   * collapse to the one student who is selected, and the reader could never pick a different
   * one without clearing first.
   */
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);

  /** The status vocabulary the server sent last. Kept so a failed page still has a filter. */
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>(FALLBACK_STATUS_OPTIONS);

  const heading = useRef<HTMLDivElement | null>(null);

  /**
   * Every in-flight request is stamped, and only the newest one may write to state. Without
   * it a slow unfiltered fetch can land after a fast filtered one and repaint the table with
   * rows the filters exclude — which reads as a broken filter, not as a race.
   */
  const requestId = useRef(0);

  const filters: SessionFilters = useMemo(
    () => ({
      teacher,
      student: student?.id ?? null,
      status: status || null,
      from: from || null,
      to: to || null,
      offset,
      limit: PAGE_SIZE,
    }),
    [teacher, student, status, from, to, offset],
  );

  const load = useCallback(
    async (f: SessionFilters, collectStudents: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const payload = await supportReportApi.sessions(f);
        if (id !== requestId.current) return;
        setData(payload);
        if (payload.statuses?.length) setStatusOptions(payload.statuses);
        if (collectStudents) {
          const seen = new Map<number, string>();
          for (const row of payload.results) {
            if (!seen.has(row.student_id)) seen.set(row.student_id, personName(row.student));
          }
          setStudentOptions(
            [...seen].map(([id_, name]) => ({ id: id_, name })).sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          );
        }
      } catch (e) {
        if (id !== requestId.current) return;
        // Never fall back to an empty payload: a failed request that renders as "no sessions"
        // is a lie about the school, and this page is read to judge how a desk is running.
        setData(null);
        setError(errText(e, "Could not load the session history."));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(filters, student == null);
  }, [load, filters, student]);

  /** The banner's "show me which": the unsettled rows, for everyone or for one teacher. */
  const nonce = request?.nonce ?? 0;
  useEffect(() => {
    if (!request || nonce === 0) return;
    setTeacher(request.teacher);
    setStatus(request.status);
    setStudent(null);
    setOffset(0);
    // The backlog is all time; a date range left over from the month would hide most of it.
    setFrom("");
    setTo("");
    heading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Only the nonce may re-trigger this: `request` is a fresh object on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const filtered =
    teacher != null || status !== "" || from !== "" || to !== "" || student != null;

  const reset = () => {
    setTeacher(null);
    setStatus("");
    setFrom("");
    setTo("");
    setStudent(null);
    setOffset(0);
  };

  /** Any filter change starts again at the first page; only the pager moves the offset. */
  const refine = <T,>(set: (value: T) => void) => (value: T) => {
    setOffset(0);
    set(value);
  };

  /** The selected student stays in the list even once they are the only rows loaded. */
  const students = useMemo<StudentOption[]>(() => {
    if (!student) return studentOptions;
    return studentOptions.some((s) => s.id === student.id)
      ? studentOptions
      : [student, ...studentOptions];
  }, [studentOptions, student]);

  const cols = useMemo<Column<SupportSessionRow>[]>(
    () => [
      {
        key: "when",
        header: "When",
        className: "w-[150px]",
        cell: (row) => (
          <div>
            <span className="block whitespace-nowrap font-semibold tabular-nums text-foreground">
              {formatDay(row.starts_at)}
            </span>
            <span className="block whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
              {formatTime(row.starts_at)}
              {formatTime(row.ends_at) ? `–${formatTime(row.ends_at)}` : ""}
            </span>
          </div>
        ),
      },
      {
        key: "teacher",
        header: "Support teacher",
        cell: (row) => (
          <span className="font-semibold leading-snug text-foreground">
            {personName(row.support_teacher)}
          </span>
        ),
      },
      {
        key: "student",
        header: "Student",
        cell: (row) => (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => {
                setOffset(0);
                setStudent({ id: row.student_id, name: personName(row.student) });
              }}
              className="ds-ring rounded text-left leading-snug text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              title={`Show only ${personName(row.student)}'s support sessions`}
            >
              {personName(row.student)}
            </button>
            {/* A student who was invited did not choose this hour. It changes how a missed
                session on the row reads, so it is shown rather than filed away. */}
            {row.invited_by ? (
              <span className="block text-[11px] text-muted-foreground">
                Invited by {personName(row.invited_by)}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "classroom",
        header: "Class",
        cell: (row) =>
          row.classroom_name ? (
            <span className="text-foreground">{row.classroom_name}</span>
          ) : (
            <span
              className="text-muted-foreground"
              title="This booking was never attributed to a class. Eligibility only needs a shared classroom; the attribution is what the reward ledger uses."
            >
              No class
            </span>
          ),
      },
      {
        key: "topic",
        header: "Topic",
        className: "min-w-[220px]",
        cell: (row) => {
          const t = topicText(row);
          return t ? (
            <span className="text-foreground">{t}</span>
          ) : (
            <span className="text-muted-foreground">{NO_TOPIC}</span>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        className: "w-[150px]",
        cell: (row) => {
          const { label, tone } = sessionStatusLabel(row);
          return <StatusPill label={label} tone={tone} />;
        },
      },
      {
        key: "settled",
        header: "Settled by",
        className: "w-[170px]",
        cell: (row) =>
          row.settled_by ? (
            <div className="min-w-0">
              <span className="block leading-snug text-foreground">
                {personName(row.settled_by)}
              </span>
              {row.settled_at ? (
                <span className="block text-[11px] tabular-nums text-muted-foreground">
                  {formatWhen(row.settled_at)}
                </span>
              ) : null}
            </div>
          ) : (
            <span
              className="text-muted-foreground"
              title={
                row.is_unsettled
                  ? "Nobody has marked who came. Until somebody does, this session pays nobody."
                  : "Not settled — this hour has not happened yet."
              }
            >
              &mdash;
            </span>
          ),
      },
    ],
    [],
  );

  const shown = data?.results.length ?? 0;
  const canPrev = offset > 0;
  const canNext = Boolean(data?.has_more);

  return (
    <div ref={heading}>
      <SectionCard
        title="Session history"
        description="Every support hour that was booked, and what became of it. Newest first."
      >
        {/* The filters stay mounted through every branch. A reader whose request failed, or
            whose filter matched nothing, needs the controls that got them there. */}
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-4">
          <label className="min-w-[11rem] flex-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Support teacher
            <span className="mt-1 block font-normal normal-case tracking-normal">
              <Select
                selectSize="sm"
                value={teacher == null ? "" : String(teacher)}
                onChange={(e) =>
                  refine(setTeacher)(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Everyone</option>
                {teacherOptions.map((t) => (
                  <option key={t.support_teacher_id} value={t.support_teacher_id}>
                    {personName(t.support_teacher)}
                  </option>
                ))}
              </Select>
            </span>
          </label>

          <label className="min-w-[11rem] flex-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
            <span className="mt-1 block font-normal normal-case tracking-normal">
              <Select
                selectSize="sm"
                value={status}
                onChange={(e) =>
                  refine(setStatus)((e.target.value || "") as HistoryStatus | "")
                }
              >
                <option value="">Any status</option>
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </span>
          </label>

          <label className="min-w-[9.5rem] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            From
            <span className="mt-1 block font-normal normal-case tracking-normal">
              <Input
                inputSize="sm"
                type="date"
                aria-label="Sessions from"
                value={from}
                max={to || undefined}
                onChange={(e) => refine(setFrom)(e.target.value)}
              />
            </span>
          </label>

          <label className="min-w-[9.5rem] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            To
            <span className="mt-1 block font-normal normal-case tracking-normal">
              <Input
                inputSize="sm"
                type="date"
                aria-label="Sessions to"
                value={to}
                min={from || undefined}
                onChange={(e) => refine(setTo)(e.target.value)}
              />
            </span>
          </label>

          <label className="min-w-[11rem] flex-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Student
            <span className="mt-1 block font-normal normal-case tracking-normal">
              <Select
                selectSize="sm"
                value={student == null ? "" : String(student.id)}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const found = students.find((s) => s.id === id);
                  refine(setStudent)(found ?? null);
                }}
              >
                <option value="">Everyone</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </span>
          </label>

          {filtered ? (
            <button
              type="button"
              onClick={reset}
              className="ds-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[13px] font-bold text-foreground transition-colors hover:bg-surface-2"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          ) : null}
        </div>

        {/* Four branches, and they are never confused for one another. */}
        {error ? (
          <div className="p-5">
            <ErrorPanel message={error} onRetry={() => void load(filters, student == null)} />
          </div>
        ) : loading || data == null ? (
          <TableSkeleton rows={6} />
        ) : data.results.length === 0 ? (
          <div className="p-5">
            <EmptyPanel
              title={filtered ? "No sessions match these filters" : "No support sessions yet"}
              body={
                filtered
                  ? "Nothing was booked under this combination. Widen the dates, or clear the filters to see the whole history."
                  : "No student has booked a support hour yet. Every booking made from the students' calendar shows up here."
              }
            />
          </div>
        ) : (
          <>
            <DataTable
              columns={cols}
              rows={data.results}
              rowKey={(row) => row.id}
              minWidthClass="min-w-[1040px]"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <span className="tabular-nums">{pageRange(offset, shown, data.count)}</span>
                <span className="ml-1 normal-case">
                  {data.count === 1 ? "session" : "sessions"}
                </span>
              </p>
              {canPrev || canNext ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canPrev}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    className="ds-ring inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-bold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    Newer
                  </button>
                  <button
                    type="button"
                    disabled={!canNext}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    className="ds-ring inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-bold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Older
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
            {status === STATUS_UNSETTLED ? (
              <div className="border-t border-border px-5 py-3">
                <Note>
                  These are the {plural(data.count, "session")} behind the banner above:{" "}
                  {UNSETTLED_LABEL.toLowerCase()}, so {data.count === 1 ? "it" : "they"} paid
                  nobody. The support teacher settles them from their own diary.
                </Note>
              </div>
            ) : null}
          </>
        )}
      </SectionCard>
    </div>
  );
}

export default SessionHistory;
