"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, inputShell } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import { levelLabel } from "@/lib/levels";
import { errText, midtermReportsApi } from "./api";
import { MidtermEvidence } from "./MidtermEvidence";
import { Notice } from "./reportParts";
import { CountChip } from "./StatusPill";
import { classroomSubjectLabel, formatWhen, isGraded, retakeCountOf } from "./status";
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
      // NEVER an empty array here. `[]` is a claim — "this school has never given a midterm"
      // — and the sidebar below reads exactly that claim off `classrooms.length === 0`. A
      // 500 from the list endpoint used to print it as a fact under the red banner. `null`
      // is the honest value: we do not know, so nothing states otherwise.
      setClassrooms(null);
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 max-w-2xl flex-1 basis-[18rem] text-[14px] leading-5 text-ms-fg-2">
          Every classroom that has ever been given a midterm, whichever month it was sat in.
          Pass/fail results come from the record frozen when each student was scored.
        </p>
        <Button variant="secondary" size="sm" icon="refresh" onClick={refreshAll}>
          Refresh
        </Button>
      </div>

      {listError && <ErrorBox message={listError} onRetry={() => void loadClassrooms()} />}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Classroom list */}
        <aside className="animate-ms-card-in rounded-ms-card bg-ms-card p-3 shadow-ms-1 lg:sticky lg:top-4 lg:self-start">
          {/* A plain field, not the debounced SearchField: the list filters as each letter lands. */}
          <label className={cn(inputShell(), "mb-2")}>
            <Icon name="search" size="sm" className="text-ms-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search classrooms"
              aria-label="Search classrooms"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ms-fg-3"
            />
          </label>

          {/* Four branches, and the first two are the ones that get confused: a failed list
              is not an empty list. The error branch comes first so a 500 can never fall
              through to the "No midterm activity" copy below it. */}
          {listError ? (
            <div className="flex flex-col items-center gap-1 px-2 py-8 text-center">
              <span className="mb-1 grid size-10 place-items-center rounded-full bg-ms-critical-soft text-ms-critical-fg">
                <Icon name="alert" />
              </span>
              <p className="text-[14px] font-semibold text-ms-fg">Classroom list unavailable</p>
              <p className="text-[13px] leading-[18px] text-ms-fg-3">
                This is not an empty school — the list could not be loaded. Retry above.
              </p>
            </div>
          ) : classrooms == null ? (
            <div className="flex flex-col gap-1.5" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="animate-ms-shimmer h-14 rounded-ms-ctl" />
              ))}
            </div>
          ) : filteredClassrooms.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-2 py-8 text-center">
              <span className="mb-1 grid size-10 place-items-center rounded-full bg-ms-surface-2 text-ms-fg-3">
                <Icon name={classrooms.length === 0 ? "ms-room" : "search"} />
              </span>
              <p className="text-[14px] font-semibold text-ms-fg">
                {classrooms.length === 0 ? "No midterm activity" : "No match"}
              </p>
              <p className="text-[13px] leading-[18px] text-ms-fg-3">
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
                      "ms-transition rounded-ms-ctl px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring",
                      active ? "bg-ms-primary-soft" : "hover:bg-ms-surface",
                    )}
                  >
                    <p
                      className={cn(
                        "truncate text-[14px] font-semibold",
                        active ? "text-ms-primary-text" : "text-ms-fg",
                      )}
                    >
                      {c.name}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-ms-fg-3">
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
        <section className="flex min-w-0 flex-col gap-3">
          {detailError ? (
            <ErrorBox message={detailError} />
          ) : detailLoading || (selectedId != null && !detail) ? (
            <div aria-busy className="animate-ms-shimmer h-40 rounded-ms-card" />
          ) : !detail ? (
            /* "Pick a classroom" is an invitation, and it is only honest when there IS a
               list to pick from. With the list request failed there is nothing on the left,
               and the invitation reads as "we found nothing for you". */
            listError ? (
              <div className="animate-ms-fade-in flex flex-col items-center gap-1 rounded-ms-card border border-ms-critical-line bg-ms-critical-soft px-5 py-10 text-center text-ms-critical-fg">
                <Icon name="alert" size="lg" className="mb-2" />
                <p className="font-semibold">Nothing could be listed</p>
                <p className="max-w-md text-[14px] leading-5">
                  The classroom list failed to load, so there is nothing to pick. Nothing here
                  says this school has no midterms — retry above.
                </p>
              </div>
            ) : (
              <div className="animate-ms-card-in rounded-ms-card bg-ms-card shadow-ms-1">
                <EmptyState
                  icon="file"
                  title="Pick a classroom"
                  detail="Select a classroom on the left to see its midterms."
                />
              </div>
            )
          ) : (
            <>
              <div className="animate-ms-card-in rounded-ms-card bg-ms-card px-5 py-4 shadow-ms-1">
                <h3 className="text-[20px] font-bold leading-7 text-ms-fg">
                  {detail.classroom.name}
                </h3>
                <p className="mt-0.5 text-[14px] text-ms-fg-2">
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
                <div className="animate-ms-card-in rounded-ms-card bg-ms-card shadow-ms-1">
                  <EmptyState
                    icon="timer"
                    title="No midterms in this classroom"
                    detail={`Nothing has been scheduled or assigned to ${detail.classroom.name} yet.`}
                  />
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
  // Exact now that the list endpoint sends every retake. "has a retake" was true of a paper
  // with three, and the number changes how the table under it must be read.
  const retakes = retakeCountOf(midterm);
  // An ungraded midterm produces no passed/failed tally at all, so the collapsed row would
  // otherwise show only its absentees and hide the class that actually sat it. The rest of
  // the roster is exactly the students who have a score and no verdict.
  const scored =
    rosterSize == null ? null : Math.max(0, rosterSize - counts.absent - counts.pending);

  return (
    <div className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="ms-transition w-full px-4 py-3 text-left hover:bg-ms-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ms-ring"
      >
        <span className="flex items-center gap-2">
          <Icon name={expanded ? "down" : "right"} size="sm" className="text-ms-fg-3" />
          <span className="truncate font-semibold text-ms-fg">{midterm.title}</span>
          <Badge tone="line" className="shrink-0">
            {TYPE_LABELS[midterm.midterm_type] ?? midterm.midterm_type}
          </Badge>
        </span>
        <span className="ml-6 mt-0.5 block text-[13px] text-ms-fg-3">
          {midterm.subject_label} · {formatWhen(midterm.scheduled_at)}
          {retakes == null
            ? midterm.retake
              ? " · has a retake"
              : ""
            : retakes > 0
              ? ` · ${retakes} retake paper${retakes === 1 ? "" : "s"}`
              : ""}
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
              <Badge tone="neutral" icon="circle">
                Not graded
              </Badge>
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
        <div id={panelId} className="border-t border-ms-line px-4 py-4">
          {/* The exact count from this list's own payload. `MidtermEvidence` re-counts from
              its own response and prefers that; this is what it falls back to. */}
          <MidtermEvidence
            classroomId={classroomId}
            midtermId={midterm.id}
            retakeCount={retakes}
          />
        </div>
      )}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice
      tone="critical"
      role="alert"
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
    >
      <span className="font-semibold">{message}</span>
      <span className="mt-0.5 block text-ms-fg-2">Nothing below is empty — it is unknown.</span>
    </Notice>
  );
}
