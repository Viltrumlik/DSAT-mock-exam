"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Award, Download, RefreshCw, Save, Clock, KeyRound, LayoutGrid, Users,
} from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { classesApi } from "@/lib/api";
import { midtermApi, subjectLabel } from "@/lib/midtermApi";
import { downloadBlob } from "@/lib/download";
import {
  Card, CardHeader, Button, Field, Input, Tabs, Pill,
  LoadingState, ErrorState, EmptyState, StatCard, ConfirmDialog,
} from "../ui";
import type { PillTone } from "../ui";
import { AssignVersionModal } from "./AssignVersionModal";
import { Avatar } from "@/components/ui/Avatar";
import { ChartCard, BarChart } from "@/components/ui/charts";

const fileSlug = (t: string) => (t || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "midterm";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/**
 * Every attempt state a student row can carry, in words.
 *
 * Covers BOTH spellings on purpose: the panel endpoint sends `attempt.current_state`
 * unmapped (so the module-1 state arrives as the raw DB value `ACTIVE`), while every other
 * midterm endpoint sends the wire spelling `MODULE_1_ACTIVE`. See
 * `midterms/state_machine.py` — WIRE_STATE. A raw enum must never reach the teacher.
 */
const STATE_LABEL: Record<string, { label: string; tone: PillTone; hint: string }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral", hint: "This student has not opened the paper yet." },
  ACTIVE: { label: "Module 1 in progress", tone: "info", hint: "Sitting module 1 right now." },
  MODULE_1_ACTIVE: { label: "Module 1 in progress", tone: "info", hint: "Sitting module 1 right now." },
  MODULE_2_ACTIVE: { label: "Module 2 in progress", tone: "info", hint: "Sitting module 2 right now." },
  SCORING: { label: "Being scored", tone: "info", hint: "Handed in — the score is being computed." },
  COMPLETED: { label: "Finished", tone: "success", hint: "Handed in and scored." },
  ABANDONED: { label: "Voided", tone: "warning", hint: "This sitting was voided by staff and does not count." },
};

/** Never render a raw DB enum: an unmapped state is sentence-cased rather than shouted. */
function stateChip(state: string): { label: string; tone: PillTone; hint: string } {
  const known = STATE_LABEL[state];
  if (known) return known;
  const words = String(state || "").toLowerCase().replace(/_/g, " ").trim();
  return {
    label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown",
    tone: "neutral",
    hint: "The server reported a state this page does not have a name for yet.",
  };
}

interface PanelStudent {
  student_id: number;
  student_name: string;
  student_profile_image_url?: string | null;
  state: string;
  submitted: boolean;
  score: number | null;
  rank: number | null;
  certificate_code: string | null;
  /** How many times they have finished it — >1 means they have already re-sat. */
  sittings: number;
  /** They currently hold an unspent re-sit (may sit this paper once more). */
  resit_open: boolean;
  version_number: number | null;
  version_label: string | null;
  /** Where they sit. Null until a seating plan is committed. */
  seat_row: number | null;
  seat_col: number | null;
  side: number | null;
  desk_number: number | null;
}
interface PanelData {
  midterm: { id: number; title: string; subject: string; scoring_scale: string; score_ceiling: number };
  schedule: {
    starts_at: string | null; deadline: string | null; ignore_start: boolean;
    results_released: boolean; available_at: string | null; is_before_start: boolean; is_open: boolean;
    access_code: string | null; requires_code: boolean;
    /** When the class was emailed the schedule. Set once — a second start mails nobody. */
    notified_at: string | null;
  };
  students: PanelStudent[];
  stats: { assigned: number; completed: number; average: number | null; highest: number | null; lowest: number | null };
  all_finished: boolean;
  certificates_issued: boolean;
  has_versions: boolean;
  versions: { id: number; version_number: number; label: string }[];
}

/** One labelled seat coordinate. Three of these beat one packed "Row 3 · Desk 5 · left" string. */
function SeatBit({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/**
 * Score distribution bands across the paper's own scale.
 *
 * SCALE_100 runs 0–100; SCALE_800 bottoms out at 200, never 0 (`midterms/scoring.py`), so the
 * bands must start there or four fifths of the chart is dead space that misreads as failure.
 */
const BAND_COUNT = 5;
/** Below this a histogram is noise, not a distribution — we say so instead of drawing it. */
const MIN_SCORES_FOR_CHART = 5;

function scoreBands(scores: number[], ceiling: number): { band: string; students: number }[] {
  const floor = ceiling >= 800 ? 200 : 0;
  const width = (ceiling - floor) / BAND_COUNT;
  const bands = Array.from({ length: BAND_COUNT }, (_, i) => {
    const lo = Math.round(floor + i * width);
    const hi = i === BAND_COUNT - 1 ? ceiling : Math.round(floor + (i + 1) * width) - 1;
    return { band: `${lo}–${hi}`, students: 0 };
  });
  for (const s of scores) {
    const idx = Math.min(BAND_COUNT - 1, Math.max(0, Math.floor((s - floor) / width)));
    bands[idx].students += 1;
  }
  return bands;
}

export function MidtermPanel({ classId, midtermId, title, onBack }: { classId: number; midtermId: number; title: string; onBack: () => void }) {
  const qc = useQueryClient();
  const key = ["classroom-midterm-v2", "panel", classId, midtermId];
  const { data, isLoading, isError, error, refetch } = useQuery<PanelData>({
    queryKey: key,
    queryFn: () => midtermApi.classroomPanel(classId, midtermId),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["classroom-midterm-v2", "given", classId] });
  };
  const updateSchedule = useMutation({
    mutationFn: (patch: Record<string, unknown>) => midtermApi.updateClassroomSchedule(classId, midtermId, patch),
    onSuccess: invalidate,
  });
  const issue = useMutation({
    mutationFn: (force: boolean) => midtermApi.issueClassroomCertificates(classId, midtermId, force),
    onSuccess: invalidate,
  });
  const startCode = useMutation({
    mutationFn: () => midtermApi.generateStartCode(classId, midtermId),
    onSuccess: (res) => {
      invalidate();
      pushGlobalToast({ tone: "success", message: `Access code: ${res.access_code}` });
    },
    // Failures are surfaced by the caller (confirmStart), which also owns the dialog state.
  });
  // A midterm is once-only. This is the deliberate exception: a student who FAILED this month
  // and REPEATED it has to sit the same paper again. One click buys exactly one new sitting
  // (spent when they open it). The re-sit is exempt from the class window/access code, and it
  // re-opens the room for publish — press "Re-calculate" once they hand the new paper in.
  const resit = useMutation({
    mutationFn: async ({ userId, allow }: { userId: number; allow: boolean }) => {
      if (allow) await midtermApi.allowResit(midtermId, [userId], "repeated the month");
      else await midtermApi.withdrawResit(midtermId, [userId]);
    },
    onSuccess: (_res, vars) => {
      invalidate();
      pushGlobalToast({
        tone: "success",
        message: vars.allow ? "Re-sit allowed — the student can now sit it again." : "Re-sit withdrawn.",
      });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });

  const [tab, setTab] = useState<"students" | "schedule">("students");
  const [startsInput, setStartsInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [ignoreStart, setIgnoreStart] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [assignVersionOpen, setAssignVersionOpen] = useState(false);
  // Start dialog: the class cannot be granted the midterm without a start time, and the
  // teacher is told before confirming that pressing it mails every student.
  const [startOpen, setStartOpen] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  // Publish dialog: the one place the "some students haven't finished" trade-off is spelled
  // out. It replaced a raw window.confirm carrying two paragraphs of prose.
  const [publishOpen, setPublishOpen] = useState(false);

  useEffect(() => {
    if (!data) return;
    setStartsInput(toLocalInput(data.schedule.starts_at));
    setDeadlineInput(toLocalInput(data.schedule.deadline));
    setIgnoreStart(data.schedule.ignore_start);
  }, [data]);

  const scores = useMemo(
    () => (data?.students ?? []).map((s) => s.score).filter((s): s is number => s != null),
    [data],
  );
  const ceiling = data?.midterm.score_ceiling ?? 100;
  const bands = useMemo(() => scoreBands(scores, ceiling), [scores, ceiling]);

  if (isLoading) return <LoadingState label="Loading midterm…" />;
  // An error is an error — it must never be dressed up as "there is nothing here".
  if (isError || !data) {
    return (
      <div className="space-y-5">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All midterms
        </button>
        <Card>
          <ErrorState
            title="Could not load this midterm."
            message={isError ? normalizeApiError(error).message : "The server sent no data for this midterm."}
            onRetry={() => refetch()}
          />
        </Card>
      </div>
    );
  }

  const { schedule, stats, students, certificates_issued, all_finished } = data;
  const scale = data.midterm.score_ceiling;
  const missing = Math.max(0, stats.assigned - stats.completed);
  // A share of an empty roster is unknown, not zero — an em dash, never "0%".
  const finishedRate = stats.assigned > 0 ? Math.round((100 * stats.completed) / stats.assigned) : null;
  // Every student with a completed sitting gets a rank, so the ranked rows ARE the cohort a
  // rank is "out of". Without it, "4" is a number over nothing.
  const rankedCount = students.filter((s) => s.rank != null).length;
  const certificateCount = students.filter((s) => s.certificate_code).length;

  async function saveSchedule() {
    try {
      await updateSchedule.mutateAsync({ starts_at: fromLocalInput(startsInput), deadline: fromLocalInput(deadlineInput), ignore_start: ignoreStart });
      pushGlobalToast({ tone: "success", message: "Schedule saved." });
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

  function openStartDialog() {
    setStartAt(toLocalInput(data?.schedule.starts_at ?? null));
    setStartOpen(true);
  }

  // Two calls on purpose: the schedule PATCH is what makes the start time real (and what
  // mails the class), and only a scheduled midterm may be handed an access code.
  async function confirmStart() {
    const iso = fromLocalInput(startAt);
    if (!iso) return;
    setStartBusy(true);
    try {
      await updateSchedule.mutateAsync({ starts_at: iso });
      await startCode.mutateAsync();
      setStartOpen(false);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setStartBusy(false);
    }
  }

  /** `force` publishes over students who have not finished; they get no certificate yet. */
  async function doIssue(force: boolean): Promise<boolean> {
    try {
      const res = await issue.mutateAsync(force);
      pushGlobalToast({ tone: "success", message: res?.detail || "Results published and certificates issued." });
      return true;
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      return false;
    }
  }

  async function confirmPublish() {
    // "force" is exactly "publish although the room has not all handed in".
    if (await doIssue(!all_finished)) setPublishOpen(false);
  }

  async function downloadOne(code: string, student: string) {
    setBusyCode(code);
    window.open(`/certificate/${code}`, "_blank", "noopener");
    try {
      const blob = await classesApi.downloadCertificate(code);
      downloadBlob(blob, `certificate-${fileSlug(title)}-${fileSlug(student)}.pdf`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setBusyCode(null);
    }
  }

  async function downloadAll() {
    setBusyAll(true);
    try {
      const blob = await midtermApi.downloadClassroomCertificates(classId, midtermId);
      downloadBlob(blob, `certificates-${fileSlug(title)}.zip`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    } finally {
      setBusyAll(false);
    }
  }

  const windowStatus = schedule.is_before_start
    ? `Opens ${schedule.available_at ? new Date(schedule.available_at).toLocaleString() : "when scheduled"}`
    : schedule.is_open ? "Open now" : "Closed";

  // One sentence saying where publishing stands, so the buttons beside it need no folklore.
  const resultsLine = certificates_issued
    ? "Published — the class can see their scores."
    : stats.assigned === 0
      ? "No students in this class yet."
      : stats.completed === 0
        ? "Nobody has handed in yet. Publishing opens as soon as the first paper is in."
        : all_finished
          ? "Everyone has finished. Publishing releases the scores and issues each student a class-ranked certificate."
          : `${stats.completed} of ${stats.assigned} have finished. You can publish now — the ${missing} still to sit get no certificate yet.`;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All midterms
      </button>

      <Card>
        <CardHeader
          title={title}
          description={
            <span className="tabular-nums">
              {subjectLabel(data.midterm.subject)} · {stats.completed} of {stats.assigned} finished · {windowStatus}
            </span>
          }
          actions={certificates_issued ? <Pill tone="success" dot>Results published</Pill> : undefined}
        />

        {/* ── Results: ONE primary action, everything else demoted beside a sentence that
             says how they relate. That relationship used to live only in code comments. ── */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Results &amp; certificates</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{resultsLine}</p>
            {certificates_issued && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{certificateCount}</span> certificate{certificateCount === 1 ? "" : "s"} issued.
                Re-calculate after a late finisher or a re-sit: it refreshes the class ranks and issues any that are missing.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {certificates_issued ? (
              <>
                <Button variant="secondary" size="sm" icon={Download} loading={busyAll} onClick={downloadAll}>
                  Download all
                </Button>
                <Button variant="ghost" size="sm" icon={RefreshCw} loading={issue.isPending} onClick={() => doIssue(true)}>
                  Re-calculate
                </Button>
              </>
            ) : stats.completed > 0 ? (
              <Button icon={Award} loading={issue.isPending} onClick={() => setPublishOpen(true)}>
                Publish results &amp; certificates
              </Button>
            ) : null}
          </div>
        </div>

        {/* Access code — "Start midterm" sets the start time and generates the 6-digit code. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Access code</p>
            {schedule.access_code ? (
              <p className="mt-0.5 font-mono text-2xl font-extrabold tracking-[0.3em] text-foreground tabular-nums">{schedule.access_code}</p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">No code yet — read it out to the room when the exam starts.</p>
            )}
          </div>
          <Button
            variant={schedule.access_code ? "secondary" : "primary"}
            icon={KeyRound}
            loading={startBusy}
            onClick={openStartDialog}
          >
            {schedule.access_code ? "Regenerate code" : "Start midterm — generate code"}
          </Button>
        </div>

        <div className="mt-4">
          <Tabs items={[{ id: "students", label: "Students" }, { id: "schedule", label: "Schedule" }]} active={tab} onChange={(t) => setTab(t as "students" | "schedule")} />
        </div>

        {tab === "students" ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div title={finishedRate == null ? "No students in this class, so there is no share to work out." : `${stats.completed} of ${stats.assigned} students have handed in.`}>
                <StatCard
                  className="h-full"
                  label="Finished"
                  value={`${stats.completed}/${stats.assigned}`}
                  sub={finishedRate == null ? "— of the class" : `${finishedRate}% of the class`}
                  icon={Users}
                />
              </div>
              <div title={stats.average == null ? "No scores yet — nobody has been scored." : `Mean of the ${scores.length} scored papers.`}>
                <StatCard className="h-full" label="Average" value={stats.average ?? "—"} sub={stats.average == null ? "No scores yet" : `out of ${scale}`} />
              </div>
              <div title={stats.highest == null ? "No scores yet — nobody has been scored." : "Best score in the class."}>
                <StatCard className="h-full" label="Highest" value={stats.highest ?? "—"} sub={stats.highest == null ? "No scores yet" : `out of ${scale}`} />
              </div>
              <div title={stats.lowest == null ? "No scores yet — nobody has been scored." : "Lowest score in the class."}>
                <StatCard className="h-full" label="Lowest" value={stats.lowest ?? "—"} sub={stats.lowest == null ? "No scores yet" : `out of ${scale}`} />
              </div>
            </div>

            {/* A distribution only where there is enough of one to read. */}
            {scores.length >= MIN_SCORES_FOR_CHART ? (
              <ChartCard
                title="Score distribution"
                description={`Where the ${scores.length} scored papers land on this midterm’s ${scale}-point scale.`}
              >
                <BarChart
                  data={bands}
                  xKey="band"
                  series={[{ key: "students", label: "Students" }]}
                  height={200}
                  valueFormatter={(v) => `${v} student${v === 1 ? "" : "s"}`}
                />
              </ChartCard>
            ) : scores.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                A score distribution appears once {MIN_SCORES_FOR_CHART} students have been scored
                (<span className="tabular-nums">{scores.length}</span> so far).
              </p>
            ) : null}

            {data.has_versions && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-foreground">This midterm has {data.versions.length} versions</p>
                  <p className="text-xs text-muted-foreground">The system seats the class so no two neighbours get the same version — students never see which one they got.</p>
                </div>
                <Button variant="secondary" icon={LayoutGrid} onClick={() => setAssignVersionOpen(true)}>Seating &amp; versions</Button>
              </div>
            )}

            {students.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No students in this class yet"
                description="Once students join the class they appear here with their state, score and rank for this midterm."
              />
            ) : (
              /* The SAME six columns for every class. They no longer appear and disappear with
                 has_versions / certificates_issued, which is what stopped anyone building a
                 mental model of this table. Per-row content varies; the columns do not. */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">Student</th>
                      <th className="py-2 pr-3" title="Which version of the paper this student sits, and the chair they sit in. Only multi-version midterms use it.">
                        Paper &amp; seat
                      </th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Score</th>
                      <th className="py-2 pr-3">Rank</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const chip = stateChip(s.state);
                      const seated = s.desk_number != null && s.seat_row != null;
                      return (
                        <tr key={s.student_id} className="border-t border-border align-middle">
                          <td className="py-2 pr-3 font-medium text-foreground">
                            <span className="flex items-center gap-2">
                              <Avatar src={s.student_profile_image_url} name={s.student_name} size={24} />
                              <span className="truncate">{s.student_name}</span>
                            </span>
                          </td>

                          {/* Version on one line, then the seat as three separately labelled
                              coordinates — never "Row 3 · Desk 5 · left" as one string. */}
                          <td className="py-2 pr-3">
                            {s.version_label || seated ? (
                              <span className="flex flex-col items-start gap-1">
                                {s.version_label && (
                                  <span className="inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                                    {s.version_label}
                                  </span>
                                )}
                                {seated && (
                                  <span className="flex flex-wrap items-center gap-1">
                                    <SeatBit label="Row" value={(s.seat_row ?? 0) + 1} />
                                    <SeatBit label="Desk" value={s.desk_number ?? 0} />
                                    {s.side != null && <SeatBit label="Side" value={s.side ? "Right" : "Left"} />}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground" title="No version or seat assigned for this student.">—</span>
                            )}
                          </td>

                          <td className="py-2 pr-3">
                            <span title={chip.hint}><Pill tone={chip.tone}>{chip.label}</Pill></span>
                          </td>

                          <td className="py-2 pr-3 text-foreground">
                            {s.score != null ? (
                              <span className="font-semibold tabular-nums">{s.score} <span className="font-normal text-muted-foreground">/ {scale}</span></span>
                            ) : (
                              <span className="text-muted-foreground" title="No score yet — this paper has not been scored.">—</span>
                            )}
                            {s.sittings > 1 && (
                              <span className="ml-1.5 align-middle text-[10px] font-bold tabular-nums text-muted-foreground" title="They have finished this paper more than once (a re-sit).">
                                {s.sittings} sittings
                              </span>
                            )}
                          </td>

                          {/* "4" alone is a number over nothing. Rank always carries its cohort. */}
                          <td className="py-2 pr-3">
                            {s.rank != null ? (
                              <span className="tabular-nums" title={`Ranked among the ${rankedCount} students who have finished this midterm.`}>
                                <span className="font-semibold text-foreground">{s.rank}</span>
                                <span className="text-muted-foreground"> of {rankedCount}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground" title="Not ranked yet — ranking covers the students who have finished.">—</span>
                            )}
                          </td>

                          <td className="py-2">
                            <span className="flex items-center justify-end gap-1">
                              {s.certificate_code && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={Download}
                                  loading={busyCode === s.certificate_code}
                                  onClick={() => downloadOne(s.certificate_code!, s.student_name)}
                                >
                                  Certificate
                                </Button>
                              )}
                              {s.submitted ? (
                                <Button
                                  variant={s.resit_open ? "secondary" : "ghost"}
                                  size="sm"
                                  disabled={resit.isPending}
                                  onClick={() => resit.mutate({ userId: s.student_id, allow: !s.resit_open })}
                                  title={s.resit_open
                                    ? "They may sit this midterm again. Click to take that back."
                                    : "Let them sit this midterm again — for a student who repeated the month."}
                                >
                                  {s.resit_open ? "Re-sit allowed" : "Allow re-sit"}
                                </Button>
                              ) : (
                                <span className="px-2 text-muted-foreground" title="A re-sit can only be granted once they have handed this paper in.">—</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 max-w-lg space-y-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" /> Students see a countdown until the start time, then a “Start midterm” button.
            </p>

            {/* Two named choices instead of one "Ignore start time — open now" checkbox
                sitting beside the required field it silently overrides. */}
            <Field label="When can the class start it?">
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-surface-2">
                  <input
                    type="radio"
                    name="midterm-open-mode"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    checked={!ignoreStart}
                    onChange={() => setIgnoreStart(false)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">At the start time below</span>
                    <span className="block text-xs text-muted-foreground">The normal case: the paper unlocks at that moment, and not before.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-surface-2">
                  <input
                    type="radio"
                    name="midterm-open-mode"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    checked={ignoreStart}
                    onChange={() => setIgnoreStart(true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">Straight away</span>
                    <span className="block text-xs text-muted-foreground">The class can begin as soon as you save. The start time below stays on record but is not enforced.</span>
                  </span>
                </label>
              </div>
            </Field>

            <Field label="Start time" hint="Required — a schedule with no start time would open this midterm to the whole class immediately.">
              <Input type="datetime-local" value={startsInput} onChange={(e) => setStartsInput(e.target.value)} />
            </Field>
            <Field label="Deadline (optional)" hint="After this time students can no longer start. It must be after the start time.">
              <Input type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
            </Field>
            <div className="space-y-1.5">
              <Button icon={Save} loading={updateSchedule.isPending} disabled={!startsInput} onClick={saveSchedule}>Save schedule</Button>
              <p className="text-xs text-muted-foreground">
                {schedule.notified_at
                  ? `The class was emailed on ${new Date(schedule.notified_at).toLocaleString()}. Saving again does not email them — tell them yourself.`
                  : "Saving emails every student in this class the date, time and rules. It is sent once."}
              </p>
            </div>
            {schedule.results_released && (
              <p className="text-xs font-medium text-success-foreground">Results published — students can see their scores.</p>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={publishOpen}
        title="Publish results and issue certificates?"
        description="Scores become visible to the class, and everyone who finished is issued a certificate ranked within this class."
        confirmLabel="Publish results"
        loading={issue.isPending}
        onConfirm={confirmPublish}
        onCancel={() => setPublishOpen(false)}
      >
        <div className="mt-4 space-y-2 text-sm text-foreground">
          {all_finished ? (
            <p>
              All <span className="font-semibold tabular-nums">{stats.assigned}</span> students have finished this midterm,
              so every one of them is included.
            </p>
          ) : (
            <>
              <p>
                <span className="font-semibold tabular-nums">{missing}</span> of{" "}
                <span className="tabular-nums">{stats.assigned}</span> students have not finished yet.
              </p>
              <p className="text-muted-foreground">
                Publishing now releases scores to the class and issues certificates to the{" "}
                <span className="tabular-nums">{stats.completed}</span> who did finish. The others get no certificate for
                the moment — when they hand in, press <span className="font-semibold text-foreground">Re-calculate</span> to
                include them and refresh the class ranks.
              </p>
            </>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={startOpen}
        title="Start this midterm for the class?"
        description="A midterm without a start time is open to every student the moment it is assigned, so the date and time are required."
        confirmLabel="Set time & generate code"
        loading={startBusy}
        confirmDisabled={!startAt}
        onConfirm={confirmStart}
        onCancel={() => setStartOpen(false)}
      >
        <div className="mt-4 space-y-3">
          <Field label="Starts at" hint="Students see a countdown until this moment, then a “Start midterm” button.">
            <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-foreground">
            {schedule.notified_at
              ? `The class was emailed on ${new Date(schedule.notified_at).toLocaleString()}. Changing the time here does not email them again — tell them yourself.`
              : `Confirming emails all ${stats.assigned} student${stats.assigned !== 1 ? "s" : ""} in this class the date, time and rules. It is sent once.`}
          </p>
        </div>
      </ConfirmDialog>

      {assignVersionOpen && (
        <AssignVersionModal
          classId={classId}
          midtermId={midtermId}
          onClose={() => setAssignVersionOpen(false)}
          onDone={() => { setAssignVersionOpen(false); invalidate(); }}
        />
      )}
    </div>
  );
}
