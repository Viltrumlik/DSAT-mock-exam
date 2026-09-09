"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MidtermEvidence } from "@/features/midtermReports/MidtermEvidence";
import { DefinitionNote } from "./DefinitionNote";
import { errText, midtermStatsApi } from "./api";
import {
  MONTH_BASIS_LABEL,
  MONTH_BASIS_NOTE,
  formatPassMark,
  formatShare,
  hasMixedScales,
  isInferredMonth,
  latestSatMonth,
  midtermSubjectLabel,
  midtermTypeLabel,
  monthLabel,
  monthOptionLabel,
  plural,
  rateReason,
  titleList,
} from "./format";
import {
  EmptyPanel,
  ErrorPanel,
  Note,
  OrphanRetakeNote,
  RateBar,
  RateFigure,
  ScheduledBanner,
  ScheduledFigure,
  SectionCard,
  TableSkeleton,
} from "./StatsUI";
import type { ClassroomMidtermRow, ClassroomMonth, MonthKey } from "./types";

/**
 * One classroom's month: the papers it sat, the pooled summary over them, and — on demand —
 * the students behind each one.
 *
 * This is the drill-down half of "statistics first, detail on request". It replaces the
 * ranked tables in place rather than opening a dialog: the classroom dialog elsewhere in this
 * console locks body scroll with no max-height, so a class with several papers and a full
 * roster becomes literally unreachable inside one.
 */
export function ClassroomMonthPanel({
  classroomId,
  initialMonth,
  fallbackName,
  onBack,
  backLabel,
}: {
  classroomId: number;
  initialMonth: MonthKey | null;
  /** Shown in the header while the first request is in flight, so the view has an identity. */
  fallbackName?: string;
  onBack: () => void;
  backLabel: string;
}) {
  const [month, setMonth] = useState<MonthKey | null>(initialMonth);
  const [data, setData] = useState<ClassroomMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPaper, setOpenPaper] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await midtermStatsApi.classroom(classroomId, month);
      setData(payload);
      setOpenPaper(null);
    } catch (e) {
      setData(null);
      setError(errText(e, "Could not load this class's month."));
    } finally {
      setLoading(false);
    }
  }, [classroomId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const classroom = data?.classroom;
  const summary = data?.summary;
  const rows = data?.rows ?? [];
  /** The month asked for, so a switch in flight leaves the picker where the reader put it. */
  const shownMonth = month ?? data?.month ?? "";
  /** A month this class sat nothing in is a legitimate (empty) answer, so it stays an option
   *  rather than leaving the control blank with nothing selected. */
  const monthOptions =
    data == null
      ? []
      : shownMonth && !data.months.includes(shownMonth)
        ? [shownMonth, ...data.months]
        : data.months;
  const futureMonths = data?.future_months ?? [];
  /** This class's selected month is booked, not sat: no rate here is a result. */
  const scheduled = data?.is_future === true;
  const orphans = data?.orphan_retakes ?? [];
  /**
   * No month to open on, but months still to come. "Never sat a midterm" is true; "no paper
   * has been timetabled for it" is exactly the opposite of true, and it is the sentence a
   * teacher would be judged by.
   */
  const nothingSatYet = data != null && data.month == null && futureMonths.length > 0;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="ds-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </button>

      <SectionCard>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-foreground">
              {classroom?.name ?? fallbackName ?? "Classroom"}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {classroom
                ? [
                    classroom.level_label,
                    classroom.subject_label,
                    classroom.teacher?.name ?? "No teacher assigned",
                    classroom.branch
                      ? [classroom.branch.name, classroom.branch.region].filter(Boolean).join(", ")
                      : "No branch set",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Loading this class…"}
            </p>
          </div>

          {monthOptions.length > 0 && (
            <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground">
              <CalendarClock className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Month</span>
              {/* Room for the "(scheduled)" marker while the control is closed. */}
              <span className="w-60">
                <Select
                  selectSize="sm"
                  value={shownMonth}
                  onChange={(e) => setMonth(e.target.value || null)}
                  aria-label="Month for this class"
                >
                  {shownMonth ? null : <option value="">No month with results</option>}
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthOptionLabel(m, futureMonths)}
                    </option>
                  ))}
                </Select>
              </span>
            </label>
          )}
        </div>
      </SectionCard>

      {error ? (
        <ErrorPanel message={error} onRetry={() => void load()} />
      ) : loading || !data || !summary ? (
        <SectionCard>
          <TableSkeleton rows={5} />
        </SectionCard>
      ) : data.month == null ? (
        <SectionCard>
          <div className="p-5">
            {nothingSatYet ? (
              /* Its papers are booked, not missing. The old copy — "no paper has been
                 timetabled for it" — was the exact opposite of the truth for this class, and
                 it is the sentence its teacher would be judged by. */
              <EmptyPanel
                title="No results for this class yet"
                body={`This class has not sat a midterm. Its first ${plural(futureMonths.length, "paper is", "papers are")} timetabled for ${titleList(futureMonths.map(monthLabel))} — pick that month above, marked "scheduled", to see what is coming.`}
              />
            ) : (
              <EmptyPanel
                title="This class has never sat a midterm"
                body="No paper has been timetabled for it and none has been granted to it, so there is no month to show."
              />
            )}
            <div className="mt-4">
              <OrphanRetakeNote month={null} papers={orphans} />
            </div>
          </div>
        </SectionCard>
      ) : (
        <>
          {scheduled ? (
            <ScheduledBanner
              month={data.month}
              thisMonth={data.this_month}
              latestMonth={latestSatMonth(data.months, futureMonths)}
              onOpenLatest={() => setMonth(latestSatMonth(data.months, futureMonths))}
              detail={`${plural(summary.midterms, "paper")} booked for ${plural(summary.distinct_students, "student")} on this roster.`}
            />
          ) : null}

          <SectionCard
            title={
              scheduled
                ? `Booked for ${monthLabel(data.month)}`
                : `${monthLabel(data.month)} summary`
            }
            description={`${plural(summary.midterms, "paper")} · ${plural(summary.distinct_students, "student")} on the roster`}
          >
            {scheduled ? (
              <div className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <Figure
                  label="Pass rate"
                  value={<ScheduledFigure />}
                  detail="Nobody has sat these papers, so there is no rate — not a rate of zero."
                />
                <Figure
                  label="Papers booked"
                  value={String(summary.midterms)}
                  detail={`Timetabled for ${monthLabel(data.month)} and not yet sat.`}
                />
                <Figure
                  label="Students"
                  value={String(summary.distinct_students)}
                  detail={`${plural(summary.roster, "roster place")} waiting on these papers.`}
                />
              </div>
            ) : (
            <div className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Pass rate"
                value={
                  <span className="flex items-center gap-2">
                    <RateFigure
                      rate={summary.pass_rate}
                      reason={rateReason("pass", summary.roster)}
                    />
                    <RateBar rate={summary.pass_rate} />
                  </span>
                }
                detail={`${formatShare(summary.passed, summary.roster)} roster places`}
              />
              <Figure
                label="Passed"
                value={String(summary.passed)}
                detail={`${summary.passed_first} first sitting · ${summary.passed_retake} on a retake`}
              />
              <Figure
                label="Did not pass"
                value={String(summary.failed + summary.absent)}
                detail={
                  <>
                    {summary.failed} failed · {summary.absent} absent
                    {summary.pending > 0 ? ` · ${summary.pending} awaiting a result` : ""}
                  </>
                }
              />
              {/* "SAT THE PAPER" in caps, in an SAT-prep product, reads as "SAT the paper".
                  The figure is an attendance rate; call it that. */}
              <Figure
                label="Attendance"
                value={
                  <span className="flex items-center gap-2">
                    <RateFigure
                      rate={summary.attendance_rate}
                      reason={rateReason("attendance", summary.roster)}
                    />
                  </span>
                }
                detail={`${formatShare(summary.attended, summary.roster)} · ${summary.retake_taken} sat a retake, ${summary.retake_passed} passed it`}
              />
            </div>
            )}

            {!scheduled && summary.roster !== summary.distinct_students && summary.midterms > 1 && (
              <div className="border-t border-border px-5 py-3">
                <Note>
                  This class sat {plural(summary.midterms, "paper")} this month, so its{" "}
                  {summary.distinct_students} students appear {summary.roster} times in the
                  denominator — once per paper. That is what the pooled rule asks for.
                </Note>
              </div>
            )}

            {!scheduled && hasMixedScales(rows) && (
              <div className="border-t border-border px-5 py-3">
                <Note>
                  The papers below are not all scored out of the same total. Their pass rates are
                  comparable; their scores are not.
                </Note>
              </div>
            )}
          </SectionCard>

          {/* Papers this class has in this month that no figure above counts. */}
          <OrphanRetakeNote month={data.month} papers={orphans} />

          <DefinitionNote definition={data.definition} />

          <SectionCard
            title={scheduled ? "Papers booked for this month" : "Papers sat this month"}
            description={
              scheduled
                ? "Nothing here has been sat. Open a paper to see who is on its roster."
                : "Open a paper to see the students behind its numbers."
            }
          >
            {rows.length === 0 ? (
              <div className="p-5">
                {orphans.length > 0 ? (
                  <EmptyPanel
                    title="No countable papers in this month"
                    body={`The only ${orphans.length === 1 ? "paper" : plural(orphans.length, "paper")} dating into this month for this class ${orphans.length === 1 ? "is a retake" : "are retakes"} with no parent midterm — ${titleList(orphans.map((p) => p.title))} — and a parentless retake is never a row of its own.`}
                  />
                ) : (
                  <EmptyPanel
                    title="No countable papers in this month"
                    body="Pre-midterms and retake papers are not counted as units of their own, so a month that held only those shows nothing here."
                  />
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((row) => (
                  <PaperRow
                    key={row.id}
                    row={row}
                    classroomId={classroomId}
                    scheduled={scheduled}
                    open={openPaper === row.id}
                    onToggle={() => setOpenPaper((prev) => (prev === row.id ? null : row.id))}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function PaperRow({
  row,
  classroomId,
  scheduled,
  open,
  onToggle,
}: {
  row: ClassroomMidtermRow;
  classroomId: number;
  /** The month this paper sits in is still ahead: it has a roster, not results. */
  scheduled?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `paper-${row.id}`;
  const inferred = isInferredMonth(row.month_basis);
  const basis = row.month_basis;

  return (
    <li>
      <div className="flex flex-wrap items-start gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="ds-ring -mx-2 min-w-0 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-surface-2"
        >
          <span className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate font-bold text-foreground">{row.title}</span>
            <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {midtermTypeLabel(row.midterm_type)}
            </span>
          </span>
          <span className="ml-6 mt-0.5 block truncate text-xs text-muted-foreground">
            {[
              midtermSubjectLabel(row.subject),
              `Pass mark ${formatPassMark(row.pass_mark, row.score_ceiling)}`,
              row.retakes.length > 0
                ? plural(row.retakes.length, "retake paper")
                : "No retake paper",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="ml-6 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {/* In a scheduled month every one of these counts is the same fact — nobody has
                sat it — dressed as five findings, and "N absent" is the worst of them: it
                reads as a class that failed to turn up for a paper that has not happened. */}
            {scheduled ? (
              <span>
                {plural(row.roster, "student")} on the roster · not sat yet
              </span>
            ) : (
              <>
                <span className="font-bold text-foreground">
                  {row.passed} passed
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({row.passed_first} first · {row.passed_retake} retake)
                  </span>
                </span>
                <span>{row.failed} failed</span>
                <span>{row.absent} absent</span>
                {row.pending > 0 && <span>{row.pending} awaiting a result</span>}
                {row.retake_taken > 0 && (
                  <span>
                    {row.retake_taken} sat a retake, {row.retake_passed} passed it
                  </span>
                )}
              </>
            )}
          </span>
        </button>

        <div className="shrink-0 text-right">
          {scheduled ? (
            <p className="text-lg font-extrabold tracking-tight">
              <ScheduledFigure />
            </p>
          ) : (
            <>
              <p className="text-lg font-extrabold tracking-tight text-foreground">
                <RateFigure rate={row.pass_rate} reason={rateReason("pass", row.roster)} />
              </p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatShare(row.passed, row.roster)}
              </p>
              <RateBar rate={row.pass_rate} />
            </>
          )}
        </div>
      </div>

      {/* The label, then the note — and nothing between them. There used to be a hardcoded
          "this paper was never timetabled for this class, so its month was inferred" here,
          immediately ahead of MONTH_BASIS_NOTE, which opens with the same clause. The
          sentence printed twice in a row and read as a rendering bug. */}
      {inferred && basis && (
        <p className="flex items-start gap-1.5 px-5 pb-3 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-bold">{MONTH_BASIS_LABEL[basis]}</span> · {MONTH_BASIS_NOTE[basis]}
          </span>
        </p>
      )}

      {open && (
        <div
          id={panelId}
          className={cn("border-t border-border bg-surface-2/40 px-5 py-4")}
        >
          <MidtermEvidence
            classroomId={classroomId}
            midtermId={row.id}
            retakeCount={row.retakes.length}
          />
        </div>
      )}
    </li>
  );
}
