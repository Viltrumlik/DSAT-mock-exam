"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Lock, TrendingUp, TrendingDown, Minus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardHeader, Button, Input, Pill, EmptyState, LoadingState, ErrorState, StatCard } from "../ui";
import type { PillTone } from "../ui";
import { capabilitiesFor } from "../capabilities";
import type { ClassroomWithRole } from "../types";
import {
  useAttendanceSessions,
  useAttendanceSession,
  useAttendanceSummary,
  useMyAttendance,
  useCreateSession,
  useMarkAttendance,
  useMarkAllPresent,
  useFinalizeSession,
} from "../attendanceHooks";
import type { AttendanceStatus, RosterRow } from "../attendanceApi";

const STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const META: Record<AttendanceStatus, { letter: string; label: string; tone: PillTone; active: string }> = {
  PRESENT: { letter: "P", label: "Present", tone: "success", active: "bg-emerald-500 text-white border-emerald-500" },
  ABSENT: { letter: "A", label: "Absent", tone: "danger", active: "bg-rose-500 text-white border-rose-500" },
  LATE: { letter: "L", label: "Late", tone: "warning", active: "bg-amber-500 text-white border-amber-500" },
  EXCUSED: { letter: "E", label: "Excused", tone: "info", active: "bg-sky-500 text-white border-sky-500" },
};

function fmtDate(d: string) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function TrendPill({ trend }: { trend: "IMPROVING" | "STABLE" | "DECLINING" }) {
  const map = {
    IMPROVING: { tone: "success" as PillTone, Icon: TrendingUp, label: "Improving" },
    DECLINING: { tone: "warning" as PillTone, Icon: TrendingDown, label: "Needs focus" },
    STABLE: { tone: "neutral" as PillTone, Icon: Minus, label: "Steady" },
  }[trend];
  return <Pill tone={map.tone}><map.Icon className="h-3 w-3" /> {map.label}</Pill>;
}

export function Attendance({ classroom }: { classroom: ClassroomWithRole }) {
  const caps = capabilitiesFor(classroom.my_role);
  return caps.canTakeAttendance ? <AttendanceStaff classroom={classroom} /> : <AttendanceStudent classroom={classroom} />;
}

// ── Student self-view ─────────────────────────────────────────────────────────
function AttendanceStudent({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const { data, isLoading, isError, refetch } = useMyAttendance(classId);
  if (isLoading) return <LoadingState label="Loading your attendance…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Attendance" value={data.attendance_score != null ? `${data.attendance_score}%` : "—"} icon={CheckCircle2} accent="text-emerald-600 bg-emerald-500/10" />
        <StatCard label="Sessions" value={data.counted_sessions} icon={CalendarPlus} />
        <Card className="flex flex-col justify-center gap-1.5"><span className="text-xs text-muted-foreground">Trend</span><TrendPill trend={data.trend} /></Card>
      </div>
      <Card>
        <CardHeader title="History" description="Your attendance for each lesson" />
        <div className="mt-4 space-y-2">
          {data.history.length === 0 ? (
            <EmptyState icon={CalendarPlus} title="No attendance yet" description="Lessons you attend will appear here." />
          ) : (
            data.history.map((h) => (
              <div key={h.session_id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{fmtDate(h.date)}</p>
                  {!h.finalized && <p className="text-xs text-muted-foreground">draft</p>}
                </div>
                <Pill tone={META[h.status].tone}>{META[h.status].label}</Pill>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Staff marking + summary ───────────────────────────────────────────────────
function AttendanceStaff({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const [view, setView] = useState<"mark" | "summary">("mark");
  const sessions = useAttendanceSessions(classId);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  const createSession = useCreateSession(classId);

  const list = useMemo(() => sessions.data?.sessions ?? [], [sessions.data]);
  // A register opens by itself on each lesson day. The manual form is the escape hatch for
  // a class whose lesson days can't be read at all — without it that class could never take
  // attendance, so hiding the form outright would be worse than showing a redundant one.
  const scheduleUsable = sessions.data?.schedule_is_usable !== false;
  useEffect(() => {
    if (activeId == null && list.length) setActiveId(list[0].id);
  }, [list, activeId]);

  async function create() {
    if (!newDate) return;
    const s = await createSession.mutateAsync({ date: newDate });
    setNewDate(""); setActiveId(s.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl border border-border p-0.5">
          {(["mark", "summary"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium capitalize", view === v ? "bg-surface-2 text-foreground" : "text-muted-foreground")}>
              {v === "mark" ? "Take attendance" : "Summary"}
            </button>
          ))}
        </div>
      </div>

      {view === "summary" ? (
        <AttendanceSummaryPanel classId={classId} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card pad="sm">
            <CardHeader title="Lesson days" description="Each lesson opens its own register" />
            <div className="mt-3 space-y-2">
              {!scheduleUsable && (
                <div className="space-y-2 rounded-xl border border-dashed border-amber-400/60 bg-amber-500/5 p-3">
                  <p className="text-xs font-semibold text-foreground">This class has no lesson days set</p>
                  <p className="text-xs text-muted-foreground">
                    Registers open automatically once the class has lesson days and a time. Until
                    then, add the day you need here.
                  </p>
                  <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  <Button size="sm" block icon={CalendarPlus} loading={createSession.isPending} disabled={!newDate} onClick={create}>Add a day</Button>
                </div>
              )}
              {list.map((s) => (
                <button key={s.id} onClick={() => setActiveId(s.id)}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm",
                    activeId === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2")}>
                  <span className="min-w-0 truncate">{fmtDate(s.date)}</span>
                  {s.status === "FINALIZED" ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <span className="text-[10px] text-muted-foreground">draft</span>}
                </button>
              ))}
              {list.length === 0 && scheduleUsable && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  The next lesson&apos;s register opens when that lesson starts.
                </p>
              )}
            </div>
          </Card>

          {activeId ? <RosterMarker classId={classId} sessionId={activeId} /> : (
            <Card><EmptyState icon={Users} title="No register open yet" description="Each lesson's register appears here when the lesson starts." /></Card>
          )}
        </div>
      )}
    </div>
  );
}

function RosterMarker({ classId, sessionId }: { classId: number; sessionId: number }) {
  const { data, isLoading, isError, refetch } = useAttendanceSession(classId, sessionId);
  const mark = useMarkAttendance(classId, sessionId);
  const markAll = useMarkAllPresent(classId, sessionId);
  const finalize = useFinalizeSession(classId, sessionId);
  const [local, setLocal] = useState<Record<number, AttendanceStatus | null>>({});

  useEffect(() => {
    if (data?.roster) setLocal(Object.fromEntries(data.roster.map((r) => [r.student_id, r.status])));
  }, [data]);

  const dirty = useMemo(() => {
    if (!data?.roster) return false;
    return data.roster.some((r) => local[r.student_id] !== r.status);
  }, [data, local]);

  if (isLoading) return <Card><LoadingState label="Loading roster…" /></Card>;
  if (isError || !data) return <Card><ErrorState onRetry={() => refetch()} /></Card>;

  const finalized = data.status === "FINALIZED";

  async function save() {
    const records = Object.entries(local)
      .filter(([, st]) => st)
      .map(([sid, st]) => ({ student_id: Number(sid), status: st as AttendanceStatus }));
    if (records.length) await mark.mutateAsync(records);
  }

  return (
    <Card>
      <CardHeader
        title={fmtDate(data.date)}
        description="Mark everyone, then finalize"
        actions={
          <div className="flex items-center gap-2">
            {finalized ? <Pill tone="neutral"><Lock className="h-3 w-3" /> Finalized</Pill> : <Pill tone="warning">Draft</Pill>}
          </div>
        }
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate()}>Mark all present</Button>
        <Button size="sm" loading={mark.isPending} disabled={!dirty} onClick={save} icon={CheckCircle2}>Save</Button>
        {!finalized && <Button size="sm" variant="ghost" loading={finalize.isPending} onClick={() => finalize.mutate()} icon={Lock}>Finalize</Button>}
      </div>

      <div className="mt-4 divide-y divide-border">
        {data.roster.map((r: RosterRow) => (
          <div key={r.student_id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 truncate text-sm text-foreground">{r.name}</span>
            <div className="flex shrink-0 gap-1">
              {STATUSES.map((st) => {
                const selected = local[r.student_id] === st;
                return (
                  <button key={st} title={META[st].label}
                    onClick={() => setLocal((p) => ({ ...p, [r.student_id]: st }))}
                    className={cn("h-8 w-8 rounded-lg border text-xs font-bold transition-colors",
                      selected ? META[st].active : "border-border text-muted-foreground hover:bg-surface-2")}>
                    {META[st].letter}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {data.roster.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No students enrolled yet.</p>}
      </div>
    </Card>
  );
}

function AttendanceSummaryPanel({ classId }: { classId: number }) {
  const { data, isLoading, isError, refetch } = useAttendanceSummary(classId);
  if (isLoading) return <LoadingState label="Loading summary…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const maxRate = 100;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Class attendance" value={data.overall_rate != null ? `${data.overall_rate}%` : "—"} icon={CheckCircle2} accent="text-emerald-600 bg-emerald-500/10" />
        <StatCard label="Students" value={data.students.length} icon={Users} />
        <StatCard label="Sessions" value={data.sessions.length} icon={CalendarPlus} />
      </div>

      <Card>
        <CardHeader title="Attendance trend" description="Class present-rate per finalized session" />
        {data.sessions.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No finalized sessions yet" />
        ) : (
          <div className="mt-5 flex items-end gap-1.5" style={{ height: 120 }}>
            {data.sessions.map((s) => (
              <div key={s.id} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${fmtDate(s.date)} · ${s.present_rate ?? "—"}%`}>
                <div className="w-full rounded-t bg-emerald-500/70" style={{ height: `${((s.present_rate ?? 0) / maxRate) * 100}%`, minHeight: 2 }} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="By student" />
        <div className="mt-4 space-y-2">
          {data.students.map((st) => (
            <div key={st.student_id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2.5">
              <span className="min-w-0 truncate text-sm text-foreground">{st.name}</span>
              <Pill tone={st.attendance_score == null ? "neutral" : st.attendance_score >= 90 ? "success" : st.attendance_score >= 75 ? "warning" : "danger"}>
                {st.attendance_score != null ? `${st.attendance_score}%` : "—"}
              </Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
