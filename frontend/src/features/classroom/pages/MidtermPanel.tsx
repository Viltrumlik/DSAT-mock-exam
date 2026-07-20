"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, Download, RefreshCw, Save, Clock, CheckCircle2, KeyRound, Shuffle } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { classesApi } from "@/lib/api";
import { midtermApi } from "@/lib/midtermApi";
import { downloadBlob } from "@/lib/download";
import { Card, CardHeader, Button, Field, Input, Tabs, LoadingState, ErrorState, StatCard, ConfirmDialog } from "../ui";
import { AssignVersionModal } from "./AssignVersionModal";

const fileSlug = (t: string) => (t || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "midterm";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

interface PanelStudent {
  student_id: number;
  student_name: string;
  state: string;
  submitted: boolean;
  score: number | null;
  rank: number | null;
  certificate_code: string | null;
  version_number: number | null;
  version_label: string | null;
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

export function MidtermPanel({ classId, midtermId, title, onBack }: { classId: number; midtermId: number; title: string; onBack: () => void }) {
  const qc = useQueryClient();
  const key = ["classroom-midterm-v2", "panel", classId, midtermId];
  const { data, isLoading, isError } = useQuery<PanelData>({ queryKey: key, queryFn: () => midtermApi.classroomPanel(classId, midtermId) });
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

  useEffect(() => {
    if (!data) return;
    setStartsInput(toLocalInput(data.schedule.starts_at));
    setDeadlineInput(toLocalInput(data.schedule.deadline));
    setIgnoreStart(data.schedule.ignore_start);
  }, [data]);

  if (isLoading) return <LoadingState label="Loading midterm…" />;
  if (isError || !data) return <ErrorState title="Could not load this midterm." />;

  const { schedule, stats, students, certificates_issued, all_finished } = data;
  const scale = data.midterm.score_ceiling;

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

  async function doIssue(force: boolean) {
    try {
      const res = await issue.mutateAsync(force);
      pushGlobalToast({ tone: "success", message: res?.detail || "Results published and certificates issued." });
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
  }

  // Publish for just the students who finished — absent / unfinished students get no
  // certificate. A later "Re-calculate" folds them in (and refreshes ranks) once they finish.
  async function publishForFinishers() {
    const missing = stats.assigned - stats.completed;
    const ok = window.confirm(
      `${missing} student${missing !== 1 ? "s" : ""} haven't finished yet. Publish results and issue certificates for the ${stats.completed} who did?\n\n` +
      `Students who didn't take the midterm won't get a certificate. When they finish later, use "Re-calculate" to include them and refresh class ranks.`,
    );
    if (ok) await doIssue(true);
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
    ? `Opens ${schedule.available_at ? new Date(schedule.available_at).toLocaleString() : ""}`
    : schedule.is_open ? "Open now" : "Closed";

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All midterms
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardHeader title={title} description={`${data.midterm.subject} · ${stats.completed}/${stats.assigned} completed · ${windowStatus}`} />
          <div className="flex flex-wrap items-center gap-2">
            {certificates_issued ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>
                <Button variant="secondary" size="sm" icon={Download} loading={busyAll} onClick={downloadAll}>Download all</Button>
                <Button variant="ghost" size="sm" icon={RefreshCw} loading={issue.isPending} onClick={() => doIssue(true)}>Re-calculate</Button>
              </>
            ) : all_finished ? (
              <Button icon={Award} loading={issue.isPending} onClick={() => doIssue(false)}>Publish results &amp; certificates</Button>
            ) : stats.completed > 0 ? (
              <div className="flex flex-col items-end gap-1">
                <Button icon={Award} loading={issue.isPending} onClick={publishForFinishers}>
                  Publish for {stats.completed} finisher{stats.completed !== 1 ? "s" : ""}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {stats.assigned - stats.completed} haven&rsquo;t finished — they won&rsquo;t get a certificate yet
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No one has finished this midterm yet</span>
            )}
          </div>
        </div>

        {/* Access code — "Start midterm" sets the start time and generates the 6-digit code. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
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
              <StatCard label="Completed" value={`${stats.completed}/${stats.assigned}`} />
              <StatCard label="Average" value={stats.average ?? "—"} />
              <StatCard label="Highest" value={stats.highest ?? "—"} />
              <StatCard label="Lowest" value={stats.lowest ?? "—"} />
            </div>
            {data.has_versions && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-foreground">This midterm has {data.versions.length} versions</p>
                  <p className="text-xs text-muted-foreground">Randomly split the class across them — students never see their version.</p>
                </div>
                <Button variant="secondary" icon={Shuffle} onClick={() => setAssignVersionOpen(true)}>Assign versions</Button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Student</th>{data.has_versions && <th>Version</th>}<th>State</th><th>Score</th><th>Rank</th>{certificates_issued && <th>Certificate</th>}</tr></thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.student_id} className="border-t border-border">
                      <td className="py-1.5 font-medium text-foreground">{s.student_name}</td>
                      {data.has_versions && (
                        <td className="text-muted-foreground">
                          {s.version_label ? (
                            <span className="inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{s.version_label}</span>
                          ) : "—"}
                        </td>
                      )}
                      <td className="text-muted-foreground">{s.state.replace(/_/g, " ")}</td>
                      <td className="text-foreground">{s.score != null ? `${s.score} / ${scale}` : "—"}</td>
                      <td className="text-muted-foreground">{s.rank ?? "—"}</td>
                      {certificates_issued && (
                        <td>
                          {s.certificate_code ? (
                            <Button variant="ghost" size="sm" icon={Download} loading={busyCode === s.certificate_code} onClick={() => downloadOne(s.certificate_code!, s.student_name)}>Download</Button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-4 max-w-lg space-y-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> Students see a countdown until the start time, then a “Start midterm” button.</p>
            <Field label="Opens at (start)" hint="Required — a midterm with no start time is open to the class right now.">
              <Input type="datetime-local" value={startsInput} onChange={(e) => setStartsInput(e.target.value)} />
            </Field>
            <Field label="Deadline (optional)" hint="After this time students can no longer start.">
              <Input type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={ignoreStart} onChange={(e) => setIgnoreStart(e.target.checked)} className="h-4 w-4 rounded border-border" />
              Ignore start time — open now
            </label>
            <Button icon={Save} loading={updateSchedule.isPending} disabled={!startsInput} onClick={saveSchedule}>Save schedule</Button>
            {schedule.results_released && (
              <p className="text-xs font-medium text-emerald-600">Results published — students can see their scores.</p>
            )}
          </div>
        )}
      </Card>

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
