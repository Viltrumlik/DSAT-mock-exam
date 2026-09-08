"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  RefreshCw,
  School,
  Search,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { levelLabel } from "@/lib/levels";
import { errText, midtermReportsApi } from "./api";
import { MidtermEvidence } from "./MidtermEvidence";
import { CountChip } from "./StatusPill";
import { classroomSubjectLabel, formatWhen, isGraded } from "./status";
import type { ClassroomDetail, ClassroomListRow, ClassroomMidtermRow } from "./types";

const TYPE_LABELS: Record<string, string> = {
  PRE_MIDTERM: "Pre-midterm",
  MIDTERM: "Midterm",
  RETAKE: "Retake",
};

/**
 * The record, classroom by classroom: every paper a class has ever been given, and who passed.
 *
 * The statistics page answers "how did this month go"; this answers "show me this class",
 * including the classes that sat nothing in the month currently selected there and so appear
 * in no roll-up at all. It is the second tab of `/ops/midterms`, not a page of its own — the
 * header, and the console's idea of where you are, belong to the statistics page.
 *
 * Read-only. Every verdict comes from the record frozen when each student was scored, so
 * nothing here can change one.
 */
export default function MidtermRecordsBrowser() {
  const [classrooms, setClassrooms] = useState<ClassroomListRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClassroomDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<number | null>(null);

  const loadClassrooms = useCallback(async () => {
    setListError(null);
    try {
      const rows = await midtermReportsApi.classrooms();
      setClassrooms(rows);
      // Land on something useful instead of an empty right-hand panel.
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      setClassrooms([]);
      setListError(errText(e, "Could not load classrooms (administrators only)."));
    }
  }, []);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  const loadDetail = useCallback(async (classroomId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await midtermReportsApi.classroom(classroomId));
    } catch (e) {
      setDetail(null);
      setDetailError(errText(e, "Could not load this classroom's midterms."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    setExpanded(null);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const filteredClassrooms = useMemo(() => {
    const rows = classrooms ?? [];
    const t = search.trim().toLowerCase();
    if (t.length < 2) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(t) ||
        c.teacher_name.toLowerCase().includes(t) ||
        classroomSubjectLabel(c.subject).toLowerCase().includes(t),
    );
  }, [classrooms, search]);

  const selectedClassroom = useMemo(
    () => (classrooms ?? []).find((c) => c.id === selectedId) ?? null,
    [classrooms, selectedId],
  );

  const refreshAll = () => {
    void loadClassrooms();
    if (selectedId != null) void loadDetail(selectedId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every classroom that has ever been given a midterm, whichever month it was sat in.
          Pass/fail results come from the record frozen when each student was scored.
        </p>
        <button
          type="button"
          onClick={refreshAll}
          className="ds-ring inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-surface-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </button>
      </div>

      {listError && <ErrorBox message={listError} />}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Classroom list */}
        <aside className="rounded-2xl border border-border bg-card p-3 lg:sticky lg:top-4 lg:self-start">
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search classrooms"
              aria-label="Search classrooms"
              className="w-full rounded-xl border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground"
            />
          </div>

          {classrooms == null ? (
            <div className="space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
              ))}
            </div>
          ) : filteredClassrooms.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <School className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-bold text-foreground">
                {classrooms.length === 0 ? "No midterm activity" : "No match"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {classrooms.length === 0
                  ? "Classrooms appear here once a midterm is assigned or scheduled for them."
                  : "No classroom matches that search."}
              </p>
            </div>
          ) : (
            <nav className="flex flex-col gap-0.5" aria-label="Classrooms">
              {filteredClassrooms.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "ds-ring rounded-xl px-3 py-2 text-left transition-colors",
                      active ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    <p
                      className={cn(
                        "truncate text-sm font-bold",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.teacher_name || "No teacher assigned"} · {c.student_count} student
                      {c.student_count === 1 ? "" : "s"} · {c.midterm_count} midterm
                      {c.midterm_count === 1 ? "" : "s"}
                    </p>
                  </button>
                );
              })}
            </nav>
          )}
        </aside>

        {/* Selected classroom */}
        <section className="min-w-0 space-y-3">
          {detailError ? (
            <ErrorBox message={detailError} />
          ) : detailLoading || (selectedId != null && !detail) ? (
            <div className="h-40 animate-pulse rounded-2xl border border-border bg-card" />
          ) : !detail ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center">
              <FileText className="mx-auto mb-3 h-7 w-7 text-muted-foreground" aria-hidden />
              <p className="font-bold text-foreground">Pick a classroom</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select a classroom on the left to see its midterms.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-border bg-card px-5 py-4">
                <h3 className="text-lg font-extrabold tracking-tight text-foreground">
                  {detail.classroom.name}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {[
                    detail.classroom.teacher_name || "No teacher assigned",
                    // Never the raw enum: the API sends ENGLISH / MATH here.
                    classroomSubjectLabel(detail.classroom.subject),
                    levelLabel(detail.classroom.level),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {detail.midterms.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                  <Timer className="mx-auto mb-3 h-7 w-7 text-muted-foreground" aria-hidden />
                  <p className="font-bold text-foreground">No midterms in this classroom</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nothing has been scheduled or assigned to {detail.classroom.name} yet.
                  </p>
                </div>
              ) : (
                detail.midterms.map((m) => (
                  <MidtermCard
                    key={m.id}
                    classroomId={detail.classroom.id}
                    midterm={m}
                    rosterSize={selectedClassroom?.student_count}
                    expanded={expanded === m.id}
                    onToggle={() => setExpanded((prev) => (prev === m.id ? null : m.id))}
                  />
                ))
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function MidtermCard({
  classroomId,
  midterm,
  rosterSize,
  expanded,
  onToggle,
}: {
  classroomId: number;
  midterm: ClassroomMidtermRow;
  rosterSize?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const graded = isGraded(midterm);
  const { counts } = midterm;
  const panelId = `midterm-report-${midterm.id}`;
  // An ungraded midterm produces no passed/failed tally at all, so the collapsed row would
  // otherwise show only its absentees and hide the class that actually sat it. The rest of
  // the roster is exactly the students who have a score and no verdict.
  const scored =
    rosterSize == null ? null : Math.max(0, rosterSize - counts.absent - counts.pending);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="ds-ring w-full px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="truncate font-bold text-foreground">{midterm.title}</span>
          <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
            {TYPE_LABELS[midterm.midterm_type] ?? midterm.midterm_type}
          </span>
        </span>
        <span className="ml-6 mt-0.5 block text-xs text-muted-foreground">
          {midterm.subject_label} · {formatWhen(midterm.scheduled_at)}
          {midterm.retake ? " · has a retake" : ""}
        </span>
        {/* The tally is the point of the collapsed row: what needs attention must be
            readable without opening anything. */}
        <span className="ml-6 mt-2 flex flex-wrap items-center gap-1.5">
          {graded ? (
            <>
              <CountChip tone="pass" count={counts.passed} label="passed" />
              <CountChip tone="fail" count={counts.failed} label="failed" />
            </>
          ) : (
            <>
              <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-bold text-muted-foreground">
                Not graded
              </span>
              {scored != null && <CountChip tone="ungraded" count={scored} label="scored" />}
            </>
          )}
          <CountChip
            tone="absent"
            count={counts.absent}
            label="absent"
            title="On the roster and never sat it. Counts as not passed."
          />
          {counts.pending > 0 && (
            <CountChip
              tone="waiting"
              count={counts.pending}
              label="awaiting a result"
              title="Sat, or still sitting, with no verdict recorded yet."
            />
          )}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border px-4 py-4">
          <MidtermEvidence classroomId={classroomId} midtermId={midterm.id} />
        </div>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger-soft p-3 text-sm font-semibold text-danger-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {message}
    </div>
  );
}
