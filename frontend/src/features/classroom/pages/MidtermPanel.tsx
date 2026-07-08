"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, Download, RefreshCw, Save, Clock, CheckCircle2 } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { classesApi } from "@/lib/api";
import { midtermApi } from "@/lib/midtermApi";
import { downloadBlob } from "@/lib/download";
import { Card, CardHeader, Button, Field, Input, Tabs, LoadingState, ErrorState, StatCard } from "../ui";

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
}
interface PanelData {
  midterm: { id: number; title: string; subject: string; scoring_scale: string; score_ceiling: number };
  schedule: {
    starts_at: string | null; deadline: string | null; ignore_start: boolean;
    results_released: boolean; available_at: string | null; is_before_start: boolean; is_open: boolean;
  };
  students: PanelStudent[];
  stats: { assigned: number; completed: number; average: number | null; highest: number | null; lowest: number | null };
  all_finished: boolean;
  certificates_issued: boolean;
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

  const [tab, setTab] = useState<"students" | "schedule">("students");
  const [startsInput, setStartsInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [ignoreStart, setIgnoreStart] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

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

  async function doIssue(force: boolean) {
    try {
      const res = await issue.mutateAsync(force);
      pushGlobalToast({ tone: "success", message: res?.detail || "Results published and certificates issued." });
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    }
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
            ) : (
              <span className="text-xs text-muted-foreground">Publishing unlocks once everyone finishes</span>
            )}
          </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Student</th><th>State</th><th>Score</th><th>Rank</th>{certificates_issued && <th>Certificate</th>}</tr></thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.student_id} className="border-t border-border">
                      <td className="py-1.5 font-medium text-foreground">{s.student_name}</td>
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
            <Field label="Opens at (start)" hint="Leave empty to open immediately.">
              <Input type="datetime-local" value={startsInput} onChange={(e) => setStartsInput(e.target.value)} />
            </Field>
            <Field label="Deadline (optional)" hint="After this time students can no longer start.">
              <Input type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={ignoreStart} onChange={(e) => setIgnoreStart(e.target.checked)} className="h-4 w-4 rounded border-border" />
              Ignore start time — open now
            </label>
            <Button icon={Save} loading={updateSchedule.isPending} onClick={saveSchedule}>Save schedule</Button>
            {schedule.results_released && (
              <p className="text-xs font-medium text-emerald-600">Results published — students can see their scores.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
