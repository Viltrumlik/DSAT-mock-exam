"use client";

import { useCallback, useEffect, useState } from "react";
import { authApi, classesApi, type Classroom, usersApi } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { formatLessonDaysMeta } from "@/lib/classroomSchedule";
import TelegramLoginButton, { type TelegramOIDCResult } from "@/components/TelegramLoginButton";
import {
  BookOpen, CalendarClock, Copy, FileText, MessageCircle, Phone, Pencil, School, Shield, Target, Trophy, Users,
} from "lucide-react";
import {
  Card, CardContent, Badge, Button, Avatar, Stat, ProgressRing, Progress, Field, Input, Select, Modal, Alert, Skeleton, EmptyState, Checkbox, Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";

type MeForm = {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  telegram_linked: boolean;
  sat_exam_date: string;
  target_score: string;
  profile_image_url: string | null;
  last_mock_result?: { score: number | null; mock_exam_title: string | null; practice_test_subject: string | null; completed_at: string | null } | null;
};

const examsPublicApi = examsStudentApi;

function formatTeacherLine(c: Classroom): string {
  const t = c.teacher_details;
  if (!t) return "--";
  const parts = [t.first_name?.trim(), t.last_name?.trim()].filter(Boolean) as string[];
  if (parts.length) return parts.join(" ");
  return (t.username && String(t.username).trim()) || "--";
}

type ClassPerson = { id: number; role: string; user: { id: number; username?: string; first_name?: string; last_name?: string; profile_image_url?: string | null } };
type Attempt = { id: number; submitted_at?: string | null; is_completed?: boolean; score?: number | null; practice_test_details?: { subject?: string; title?: string } };
type ExamDateOptionRow = { id: number; exam_date: string; label: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMeToForm(me: any): MeForm {
  return {
    username: me.username || "", first_name: me.first_name || "", last_name: me.last_name || "",
    email: me.email || "", phone_number: me.phone_number || "", telegram_linked: !!me.telegram_linked,
    sat_exam_date: me.sat_exam_date || "", target_score: me.target_score != null ? String(me.target_score) : "",
    profile_image_url: me.profile_image_url || null, last_mock_result: me.last_mock_result || null,
  };
}

export default function ProfilePage() {
  const [me, setMe] = useState<MeForm | null>(null);
  const [draft, setDraft] = useState<MeForm | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedClassPeople, setSelectedClassPeople] = useState<ClassPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [lastPracticeResult, setLastPracticeResult] = useState<Attempt | null>(null);
  const [lastMockResult, setLastMockResult] = useState<MeForm["last_mock_result"]>(null);
  const [homeworkProgress, setHomeworkProgress] = useState({ total: 0, submitted: 0, pending: 0, overdue: 0 });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [telegramCfg, setTelegramCfg] = useState<{ enabled: boolean; bot_username: string | null; client_id: string | null; start_url: string | null } | null>(null);
  const [telegramLinkBusy, setTelegramLinkBusy] = useState(false);
  const [examDateOptions, setExamDateOptions] = useState<ExamDateOptionRow[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsBusyId, setSessionsBusyId] = useState<number | null>(null);

  const handleTelegramLink = useCallback(async (result: TelegramOIDCResult) => {
    setTelegramLinkBusy(true);
    setMessage(null);
    try {
      const updated = await usersApi.linkTelegram(result.id_token);
      setMe(mapMeToForm(updated));
      setMessage("Telegram connected to your account.");
      window.setTimeout(() => setMessage(null), 4000);
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMessage(typeof d === "string" ? d : "Could not link Telegram.");
      window.setTimeout(() => setMessage(null), 5000);
    } finally {
      setTelegramLinkBusy(false);
    }
  }, []);
  void handleTelegramLink;

  useEffect(() => {
    if (!file) { setObjectUrl(null); return; }
    const u = URL.createObjectURL(file);
    setObjectUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meData, classData, tgWidget, examDatesRaw] = await Promise.all([
          usersApi.getMe(),
          classesApi.list(),
          usersApi.getTelegramWidgetConfig().catch(() => ({ enabled: false, bot_username: null as string | null, client_id: null as string | null, start_url: null as string | null })),
          usersApi.listExamDates().catch(() => []),
        ]);
        if (!cancelled) {
          setTelegramCfg(tgWidget);
          setExamDateOptions(Array.isArray(examDatesRaw) ? (examDatesRaw as ExamDateOptionRow[]) : []);
          const meMapped = mapMeToForm(meData);
          setMe(meMapped);
          setLastMockResult(meMapped.last_mock_result || null);
          const c = classData.items;
          setClasses(c);
          if (c.length > 0) setSelectedClassId(c[0].id);
        }
      } catch {
        if (!cancelled) setMessage("Could not load your profile.");
      } finally {
        if (!cancelled) { setLoading(false); setClassesLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionsLoading(true);
      try {
        const r = await authApi.getSessions();
        if (!cancelled) setSessions(Array.isArray(r?.sessions) ? r.sessions : []);
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAnalyticsLoading(true);
      try {
        const attemptsBundle = await examsPublicApi.getAttempts();
        const attempts = attemptsBundle.items as Attempt[];
        const completed = attempts.filter((a) => a.is_completed).sort((a, b) => {
          const da = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
          const db = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
          return db - da;
        });
        if (!cancelled) setLastPracticeResult(completed[0] || null);

        const myClassesRaw = await classesApi.list();
        const myClasses = myClassesRaw.items;
        let total = 0, submitted = 0, pending = 0, overdue = 0;
        const now = Date.now();
        for (const c of myClasses) {
          const assignments = await classesApi.listAssignments(c.id);
          for (const asg of assignments.items) {
            total += 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let sub: any = null;
            try { sub = await classesApi.getMySubmission(c.id, asg.id); } catch { sub = null; }
            if (!!sub && sub.status === "SUBMITTED") { submitted += 1; continue; }
            const dueAt = (asg as { due_at?: string | null })?.due_at ? new Date((asg as { due_at?: string }).due_at as string).getTime() : null;
            if (dueAt && dueAt < now) overdue += 1;
            else pending += 1;
          }
        }
        if (!cancelled) setHomeworkProgress({ total, submitted, pending, overdue });
      } catch {
        if (!cancelled) { setLastPracticeResult(null); setHomeworkProgress({ total: 0, submitted: 0, pending: 0, overdue: 0 }); }
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedClassId) { setSelectedClassPeople([]); return; }
    let cancelled = false;
    (async () => {
      setPeopleLoading(true);
      try {
        const people = await classesApi.people(selectedClassId);
        if (!cancelled) setSelectedClassPeople(Array.isArray(people) ? people : []);
      } catch {
        if (!cancelled) setSelectedClassPeople([]);
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedClassId]);

  const previewUrl = objectUrl || (!clearPhoto ? draft?.profile_image_url : null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const allowedExamDates = new Set(examDateOptions.map((o) => o.exam_date));
    const sat = draft.sat_exam_date?.trim() || "";
    if (sat && !allowedExamDates.has(sat)) {
      setMessage("This exam date is no longer available. Choose from the list or clear the field.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        username: draft.username.trim(), first_name: draft.first_name.trim(), last_name: draft.last_name.trim(),
        email: draft.email.trim(), phone_number: draft.phone_number.trim() || null,
        sat_exam_date: draft.sat_exam_date || null,
        target_score: draft.target_score.trim() ? parseInt(draft.target_score, 10) : null,
      };
      if (clearPhoto && !file) payload.clear_profile_image = true;
      let latest = await usersApi.patchMe(payload);
      if (file) {
        const fd = new FormData();
        fd.append("profile_image", file);
        latest = await usersApi.patchMe(fd);
      }
      const updated = mapMeToForm(latest);
      setMe(updated);
      setFile(null);
      setClearPhoto(false);
      setDraft(null);
      setMessage("Saved.");
      setEditOpen(false);
    } catch (err: unknown) {
      const d = (err as { response?: { data?: unknown } })?.response?.data;
      const text = typeof d === "object" && d
        ? Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" ")
        : "Could not save changes.";
      setMessage(text);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string) => {
    if (!d) return "";
    try { return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); }
    catch { return d; }
  };

  const daysUntil = (d: string) => {
    if (!d) return null;
    const target = new Date(d);
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const profileCompletion = (m: MeForm) => {
    const fields = [!!m.username?.trim(), !!m.first_name?.trim(), !!m.last_name?.trim(), !!m.email?.trim(), m.target_score != null && m.target_score !== "", !!m.sat_exam_date, !!m.profile_image_url];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  };

  const completion = me ? profileCompletion(me) : 0;
  const targetScore = me?.target_score ? Math.max(0, Math.min(1600, parseInt(me.target_score, 10))) : null;
  const nextDays = me?.sat_exam_date ? daysUntil(me.sat_exam_date) : null;
  const enrolledClasses = classes.filter((c) => { const r = String(c.my_role || "").toLowerCase(); return r === "student" || r === "admin"; });
  const totalPeers = enrolledClasses.reduce((acc, c) => acc + Math.max(0, (c.members_count || 0) - 1), 0);
  const selectedClass = enrolledClasses.find((c) => c.id === selectedClassId) || null;
  const selectedStudents = selectedClassPeople.filter((p) => String(p.role || "").toLowerCase() === "student");
  const formatSubject = (s?: string) => { if (!s) return "General"; if (s === "READING_WRITING") return "Reading & Writing"; return s.charAt(0) + s.slice(1).toLowerCase(); };
  const homeworkCompletion = homeworkProgress.total > 0 ? Math.round((homeworkProgress.submitted / homeworkProgress.total) * 100) : 0;

  const handleOpenEdit = () => { setDraft(me); setFile(null); setObjectUrl(null); setClearPhoto(false); setSaving(false); setMessage(null); setEditOpen(true); };
  const handleCloseEdit = () => { setEditOpen(false); setDraft(null); setFile(null); setObjectUrl(null); setClearPhoto(false); setSaving(false); setMessage(null); };

  if (loading || !me) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      </div>
    );
  }

  const fullName = `${me.first_name} ${me.last_name}`.trim();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      {message ? <Alert tone="info" onClose={() => setMessage(null)}>{message}</Alert> : null}

      {/* Header */}
      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row">
          <Avatar src={me.profile_image_url} name={fullName} size={96} className="shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="ds-h1">{fullName || me.username}</h1>
                  <Badge variant="primary">Student</Badge>
                </div>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">@{me.username}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {me.phone_number?.trim() ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Phone className="h-3.5 w-3.5 text-primary" /> {me.phone_number}</span> : null}
                  {me.telegram_linked ? <span className="inline-flex items-center gap-1.5 text-xs font-bold text-success-foreground"><MessageCircle className="h-3.5 w-3.5" /> Telegram linked</span> : null}
                  {me.email ? <span className="inline-flex max-w-[220px] items-center gap-1.5 truncate text-xs font-semibold text-muted-foreground">{me.email}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" leftIcon={<Pencil />} onClick={handleOpenEdit}>Edit profile</Button>
                <Button size="sm" variant="secondary" leftIcon={<Copy />} onClick={async () => {
                  try { await navigator.clipboard.writeText(me.username); setMessage("Username copied."); window.setTimeout(() => setMessage(null), 1500); }
                  catch { setMessage("Could not copy."); window.setTimeout(() => setMessage(null), 1500); }
                }}>Copy</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Telegram banner */}
      {!loading && telegramCfg?.enabled && !me.telegram_linked && telegramCfg.start_url ? (
        <Card className="border-info/20 bg-info-soft">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ds-overline text-info-foreground">Telegram</p>
              <p className="mt-0.5 text-sm font-extrabold text-foreground">Connect your Telegram account</p>
              <p className="text-xs text-muted-foreground">Sign in with one tap next time.</p>
            </div>
            <div className="shrink-0">{telegramLinkBusy ? <Spinner className="h-6 w-6 text-info" /> : <TelegramLoginButton startUrl={telegramCfg.start_url} next="/profile" />}</div>
          </CardContent>
        </Card>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-4">
          <ProgressRing value={completion} size={56} strokeWidth={5} color={completion >= 100 ? "text-success" : "text-primary"} />
          <div><p className="ds-overline">Profile</p><p className="ds-num text-2xl font-extrabold text-foreground">{completion}%</p><p className="text-[11px] text-muted-foreground">Completion</p></div>
        </CardContent></Card>
        <Stat label="Target score" value={targetScore != null ? targetScore : "—"} icon={Trophy} hint={targetScore != null ? `${Math.round((targetScore / 1600) * 100)}% of 1600` : "Set your goal"} />
        <Stat label="SAT exam" value={nextDays == null ? "—" : nextDays < 0 ? "0" : nextDays} icon={CalendarClock} hint={me.sat_exam_date ? `Until ${formatDate(me.sat_exam_date)}` : "Set exam date"} />
      </div>

      {/* Results + homework */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Last practice" value={lastPracticeResult?.score != null ? lastPracticeResult.score : "—"} icon={BookOpen}
          hint={lastPracticeResult ? `${formatSubject(lastPracticeResult.practice_test_details?.subject)} · ${lastPracticeResult.submitted_at ? formatDate(lastPracticeResult.submitted_at) : "Completed"}` : analyticsLoading ? "Loading…" : "No practice yet"} />
        <Stat label="Last mock" value={lastMockResult?.score != null ? lastMockResult.score : "—"} icon={Target}
          hint={lastMockResult ? `${lastMockResult.mock_exam_title || "Mock"} · ${lastMockResult.completed_at ? formatDate(lastMockResult.completed_at) : "Done"}` : analyticsLoading ? "Loading…" : "No mock yet"} />
        <Card><CardContent className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div><p className="ds-overline">Homework</p><p className="ds-num mt-1 text-2xl font-extrabold text-foreground">{analyticsLoading ? "…" : `${homeworkCompletion}%`}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">{analyticsLoading ? "Calculating…" : `${homeworkProgress.submitted}/${homeworkProgress.total} done · ${homeworkProgress.overdue} past due`}</p></div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success-foreground"><FileText className="h-5 w-5" /></span>
          </div>
          <Progress value={homeworkCompletion} tone="success" size="sm" />
        </CardContent></Card>
      </div>

      {/* Classes + classmates */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><School className="h-4 w-4 text-primary" /><h3 className="ds-h4">My classes</h3></div>
            <Badge variant="primary">{enrolledClasses.length} enrolled</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[{ v: enrolledClasses.length, l: "Classes" }, { v: totalPeers, l: "Peers" }, { v: selectedClass?.name || "—", l: "Active" }].map((s, i) => (
              <div key={i} className="rounded-xl bg-surface-2 p-3 text-center">
                <p className={cn("ds-num font-extrabold text-foreground", typeof s.v === "number" ? "text-xl" : "mt-1 line-clamp-2 text-xs")}>{s.v}</p>
                <p className="ds-overline">{s.l}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {classesLoading ? (
              <div className="col-span-full flex justify-center py-8"><Spinner className="h-5 w-5 text-primary" /></div>
            ) : enrolledClasses.length === 0 ? (
              <div className="col-span-full"><EmptyState compact title="No classes yet" description="Join a class to see details here." /></div>
            ) : (
              enrolledClasses.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelectedClassId(c.id)}
                  className={cn("ds-ring rounded-xl border bg-surface-1 p-4 text-left transition-colors hover:border-border-strong", selectedClassId === c.id ? "border-primary/30 ring-2 ring-primary/15" : "border-border")}>
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-bold text-foreground">{c.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatSubject(c.subject)} · {formatLessonDaysMeta(c.lesson_days) || "--"} {c.lesson_time || ""}</p></div>
                    <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                  </div>
                  <div className="mt-3 border-t border-border pt-3 text-xs font-semibold text-muted-foreground"><p>Teacher: {formatTeacherLine(c)} · {c.members_count || 0} students</p></div>
                </button>
              ))
            )}
          </div>
        </CardContent></Card>

        <Card><CardContent>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="ds-overline">Class roster</p><h3 className="ds-h4 mt-0.5">Classmates</h3></div>
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="mb-4 rounded-xl bg-surface-2 p-3">
            <p className="line-clamp-2 text-sm font-bold text-foreground">{selectedClass?.name || "No class selected"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{selectedClass?.start_date ? `Started ${formatDate(selectedClass.start_date)}` : "No start date"}</p>
          </div>
          <div className="max-h-[320px] space-y-2 overflow-auto">
            {peopleLoading ? (
              <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-primary" /></div>
            ) : selectedStudents.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No students found.</p>
            ) : (
              selectedStudents.slice(0, 12).map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 rounded-lg bg-surface-2 p-2.5">
                  <Avatar name={`${p.user.first_name || ""} ${p.user.last_name || ""}`.trim() || p.user.username} src={p.user.profile_image_url} size={32} />
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{p.user.first_name || ""} {p.user.last_name || ""}</p><p className="truncate text-xs text-muted-foreground">@{p.user.username || "user"}</p></div>
                </div>
              ))
            )}
          </div>
          {selectedStudents.length > 12 ? <p className="mt-3 text-xs text-muted-foreground">+{selectedStudents.length - 12} more</p> : null}
        </CardContent></Card>
      </div>

      {/* Sessions */}
      <Card><CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /><h3 className="ds-h4">Active sessions</h3></div>
          <Button size="sm" variant="secondary" loading={sessionsLoading} onClick={async () => {
            setSessionsLoading(true);
            try { const r = await authApi.getSessions(); setSessions(Array.isArray(r?.sessions) ? r.sessions : []); } finally { setSessionsLoading(false); }
          }}>Refresh</Button>
        </div>
        <div className="space-y-2">
          {sessionsLoading ? (
            <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-primary" /></div>
          ) : sessions.length === 0 ? (
            <EmptyState compact title="No session data" description="Sign in again to create a session record." />
          ) : (
            sessions.map((s) => {
              const revoked = !!s.revoked_at;
              return (
                <div key={s.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{revoked ? "Revoked session" : "Active session"}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">IP: {s.ip || "--"} · Last active: {s.last_seen_at ? formatDate(s.last_seen_at) : "--"}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{s.user_agent || ""}</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={revoked} loading={sessionsBusyId === s.id} className="shrink-0" onClick={async () => {
                    setSessionsBusyId(s.id);
                    try { await authApi.revokeSession(Number(s.id)); const r = await authApi.getSessions(); setSessions(Array.isArray(r?.sessions) ? r.sessions : []); } finally { setSessionsBusyId(null); }
                  }}>Revoke</Button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-xs text-muted-foreground">Tip: revoke unknown sessions for security.</p>
          <Button size="sm" variant="danger" onClick={async () => {
            setSessionsLoading(true);
            try { await authApi.revokeAllSessions(); setSessions([]); } finally { setSessionsLoading(false); }
          }}>Revoke all</Button>
        </div>
      </CardContent></Card>

      {/* Edit modal */}
      <Modal open={editOpen && !!draft} onClose={handleCloseEdit} title="Edit profile" description="Photo updates instantly. Other fields save on confirm." size="lg">
        {draft ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3">
              <Avatar src={previewUrl} name={`${draft.first_name} ${draft.last_name}`.trim() || draft.username} size={96} />
              <label className="ds-ring cursor-pointer rounded-lg text-sm font-semibold text-primary hover:underline">
                Choose photo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); setClearPhoto(false); }} />
              </label>
              {draft.profile_image_url ? (
                <Checkbox label="Remove photo" checked={clearPhoto} onChange={(e) => { setClearPhoto(e.target.checked); if (e.target.checked) setFile(null); }} />
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Username" htmlFor="p-username"><Input id="p-username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} required minLength={3} /></Field>
              <Field label="Email" htmlFor="p-email"><Input id="p-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required /></Field>
              <div className="md:col-span-2">
                <Field label="Phone (optional)" htmlFor="p-phone"><Input id="p-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+998901234567" value={draft.phone_number} onChange={(e) => setDraft({ ...draft, phone_number: e.target.value })} /></Field>
              </div>
              <Field label="First name" htmlFor="p-first"><Input id="p-first" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /></Field>
              <Field label="Last name" htmlFor="p-last"><Input id="p-last" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /></Field>
              <Field label="SAT exam date" htmlFor="p-exam" hint="Choose from available dates.">
                {(() => {
                  const allowed = new Set(examDateOptions.map((o) => o.exam_date));
                  const sat = draft.sat_exam_date?.trim() || "";
                  const orphan = !!sat && !allowed.has(sat);
                  return (
                    <>
                      <Select id="p-exam" value={sat} onChange={(e) => setDraft({ ...draft, sat_exam_date: e.target.value })}>
                        <option value="">Not set</option>
                        {orphan ? <option value={sat}>{formatDate(sat)} (old)</option> : null}
                        {examDateOptions.map((o) => <option key={o.id} value={o.exam_date}>{o.label ? `${o.label} · ${formatDate(o.exam_date)}` : formatDate(o.exam_date)}</option>)}
                      </Select>
                      {orphan ? <p className="mt-1 text-[11px] text-warning-foreground">Saved date no longer available. Select a new one.</p> : null}
                    </>
                  );
                })()}
              </Field>
              <Field label="Target score (400–1600)" htmlFor="p-target"><Input id="p-target" type="number" min={400} max={1600} value={draft.target_score} onChange={(e) => setDraft({ ...draft, target_score: e.target.value })} placeholder="e.g. 1400" /></Field>
            </div>

            {message ? <p className="text-sm font-semibold text-foreground">{message}</p> : null}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={handleCloseEdit} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving}>Save changes</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
