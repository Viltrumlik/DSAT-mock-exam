"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authApi, classesApi, type Classroom, usersApi } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { formatLessonDaysMeta } from "@/lib/classroomSchedule";
import TelegramLoginButton, { type TelegramOIDCResult } from "@/components/TelegramLoginButton";
import {
  BookOpen,
  CalendarClock,
  Copy,
  FileText,
  Loader2,
  MessageCircle,
  Phone,
  Pencil,
  School,
  Shield,
  Sparkles,
  Target,
  Trophy,
  Users,
  X,
  UserCircle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
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
  last_mock_result?: {
    score: number | null;
    mock_exam_title: string | null;
    practice_test_subject: string | null;
    completed_at: string | null;
  } | null;
};

const examsPublicApi = examsStudentApi;

function formatTeacherLine(c: Classroom): string {
  const t = c.teacher_details;
  if (!t) return "--";
  const parts = [t.first_name?.trim(), t.last_name?.trim()].filter(Boolean) as string[];
  if (parts.length) return parts.join(" ");
  return (t.username && String(t.username).trim()) || "--";
}

type ClassPerson = {
  id: number;
  role: string;
  user: { id: number; username?: string; first_name?: string; last_name?: string; profile_image_url?: string | null };
};

type Attempt = {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: { subject?: string; title?: string };
};

type ExamDateOptionRow = { id: number; exam_date: string; label: string };

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
        const completed = attempts
          .filter((a) => a.is_completed)
          .sort((a, b) => {
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
            let sub: any = null;
            try { sub = await classesApi.getMySubmission(c.id, asg.id); } catch { sub = null; }
            if (!!sub && sub.status === "SUBMITTED") { submitted += 1; continue; }
            const dueAt = asg?.due_at ? new Date(asg.due_at).getTime() : null;
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
    } catch (err: any) {
      const d = err?.response?.data;
      const text = typeof d === "object" && d
        ? Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" ")
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

  useEffect(() => {
    if (!editOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === "Escape") handleCloseEdit(); };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = prevOverflow; };
  }, [editOpen]);

  if (loading || !me) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6">
        <div className="mb-8 h-32 rounded-2xl ds-skeleton" />
        <div className="grid grid-cols-3 gap-3 mb-6">{[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl ds-skeleton" />)}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6 space-y-6">

      {/* ═══ Profile Header Card ═════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="shrink-0">
            <div className="relative">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-2 border-border bg-surface-2 shadow-sm">
                {me.profile_image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={me.profile_image_url} alt={`${me.first_name} ${me.last_name}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-surface-2">
                    <UserCircle className="w-14 h-14 text-muted-foreground/40" />
                  </div>
                )}
              </div>
              <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-primary flex items-center justify-center border-2 border-card">
                <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-black text-foreground tracking-tight">{me.first_name} {me.last_name}</h1>
                  <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary uppercase tracking-wide">Student</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 font-semibold">@{me.username}</p>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  {me.phone_number?.trim() && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <Phone className="w-3.5 h-3.5 text-primary" /> {me.phone_number}
                    </span>
                  )}
                  {me.telegram_linked && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <MessageCircle className="w-3.5 h-3.5" /> Telegram linked
                    </span>
                  )}
                  {me.email && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground truncate max-w-[200px]">{me.email}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={handleOpenEdit} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit profile
                </button>
                <button type="button" onClick={async () => {
                  try { await navigator.clipboard.writeText(me.username); setMessage("Username copied."); window.setTimeout(() => setMessage(null), 1500); }
                  catch { setMessage("Could not copy."); window.setTimeout(() => setMessage(null), 1500); }
                }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Telegram link banner */}
      {!loading && telegramCfg?.enabled && !me.telegram_linked && telegramCfg.start_url && (
        <div className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-1">Telegram</p>
            <p className="text-sm font-extrabold text-foreground">Connect your Telegram account</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sign in with one tap next time.</p>
          </div>
          <div className="shrink-0">
            {telegramLinkBusy ? <Loader2 className="w-6 h-6 animate-spin text-sky-500" /> : <TelegramLoginButton startUrl={telegramCfg.start_url} next="/profile" />}
          </div>
        </div>
      )}

      {/* ═══ Stats Grid (top row) ════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Profile completion with ring */}
        <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
          <ProgressRing value={completion} size={56} strokeWidth={5} color={completion >= 100 ? "text-emerald-500" : "text-primary"} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Profile</p>
            <p className="text-2xl font-black tabular-nums text-foreground">{completion}%</p>
            <p className="text-[10px] font-semibold text-muted-foreground">Completion</p>
          </div>
        </div>

        <StatCard
          label="Target Score"
          value={targetScore != null ? targetScore : "--"}
          sub={targetScore != null ? `${Math.round((targetScore / 1600) * 100)}% of 1600` : "Set your goal"}
          icon={Trophy}
          accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40"
        />

        <StatCard
          label="SAT Exam"
          value={nextDays == null ? "--" : nextDays < 0 ? "0" : nextDays}
          sub={me.sat_exam_date ? `Until ${formatDate(me.sat_exam_date)}` : "Set exam date"}
          icon={CalendarClock}
          accent="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40"
        />
      </div>

      {/* ═══ Results + Homework Row ══════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Last Practice"
          value={lastPracticeResult?.score != null ? lastPracticeResult.score : "--"}
          sub={lastPracticeResult
            ? `${formatSubject(lastPracticeResult.practice_test_details?.subject)} · ${lastPracticeResult.submitted_at ? formatDate(lastPracticeResult.submitted_at) : "Completed"}`
            : analyticsLoading ? "Loading..." : "No practice yet"
          }
          icon={BookOpen}
          accent="text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/40"
        />
        <StatCard
          label="Last Mock"
          value={lastMockResult?.score != null ? lastMockResult.score : "--"}
          sub={lastMockResult
            ? `${lastMockResult.mock_exam_title || "Mock"} · ${lastMockResult.completed_at ? formatDate(lastMockResult.completed_at) : "Done"}`
            : analyticsLoading ? "Loading..." : "No mock yet"
          }
          icon={Target}
          accent="text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/40"
        />
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Homework</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{analyticsLoading ? "..." : `${homeworkCompletion}%`}</p>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                {analyticsLoading ? "Calculating..." : `${homeworkProgress.submitted}/${homeworkProgress.total} done · ${homeworkProgress.overdue} overdue`}
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <FileText className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${homeworkCompletion}%` }} />
          </div>
        </div>
      </div>

      {/* ═══ Classes + Classmates ═════════════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5 xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <School className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-foreground">My Classes</h3>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary tabular-nums">
              {enrolledClasses.length} enrolled
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { v: enrolledClasses.length, l: "Classes" },
              { v: totalPeers, l: "Peers" },
              { v: selectedClass?.name || "--", l: "Active" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl bg-surface-2 p-3 text-center">
                <p className={cn("font-black tabular-nums text-foreground", typeof s.v === "number" ? "text-xl" : "text-xs mt-1 line-clamp-2")}>{s.v}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {classesLoading ? (
              <div className="col-span-full flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : enrolledClasses.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-surface-2/50 p-6 text-center">
                <p className="font-bold text-foreground">No classes yet</p>
                <p className="text-sm text-muted-foreground mt-1">Join a class to see details here.</p>
              </div>
            ) : (
              enrolledClasses.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelectedClassId(c.id)}
                  className={cn(
                    "text-left rounded-xl border bg-surface-2/50 p-4 transition-all hover:border-primary/25",
                    selectedClassId === c.id ? "border-primary/40 ring-2 ring-primary/20" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-extrabold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatSubject(c.subject)} · {formatLessonDaysMeta(c.lesson_days) || "--"} {c.lesson_time || ""}
                      </p>
                    </div>
                    <BookOpen className="w-4 h-4 text-primary shrink-0" />
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/70 text-xs text-muted-foreground font-semibold">
                    <p>Teacher: {formatTeacherLine(c)} · {c.members_count || 0} students</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Class roster</p>
              <h3 className="text-base font-extrabold text-foreground mt-0.5">Classmates</h3>
            </div>
            <Users className="w-4 h-4 text-primary" />
          </div>

          <div className="rounded-xl bg-surface-2/60 p-3 mb-4">
            <p className="text-sm font-bold text-foreground line-clamp-2">{selectedClass?.name || "No class selected"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{selectedClass?.start_date ? `Started ${formatDate(selectedClass.start_date)}` : "No start date"}</p>
          </div>

          <div className="space-y-2 max-h-[320px] overflow-auto">
            {peopleLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : selectedStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No students found.</p>
            ) : (
              selectedStudents.slice(0, 12).map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 rounded-lg bg-surface-2/50 p-2.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                    {(p.user.first_name?.[0] || p.user.username?.[0] || "?").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{p.user.first_name || ""} {p.user.last_name || ""}</p>
                    <p className="text-xs text-muted-foreground truncate">@{p.user.username || "user"}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          {selectedStudents.length > 12 && <p className="text-xs text-muted-foreground mt-3">+{selectedStudents.length - 12} more</p>}
        </div>
      </div>

      {/* ═══ Sessions ════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Active Sessions</h3>
          </div>
          <button type="button" disabled={sessionsLoading} onClick={async () => {
            setSessionsLoading(true);
            try { const r = await authApi.getSessions(); setSessions(Array.isArray(r?.sessions) ? r.sessions : []); }
            finally { setSessionsLoading(false); }
          }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
            {sessionsLoading && <Loader2 className="w-3 h-3 animate-spin" />} Refresh
          </button>
        </div>

        <div className="space-y-2">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/50 p-6 text-center">
              <p className="font-bold text-foreground">No session data</p>
              <p className="text-sm text-muted-foreground mt-1">Sign in again to create a session record.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const revoked = !!s.revoked_at;
              return (
                <div key={s.id} className="rounded-xl border border-border bg-surface-2/50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-foreground truncate">{revoked ? "Revoked session" : "Active session"}</p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">IP: {s.ip || "--"} · Last active: {s.last_seen_at ? formatDate(s.last_seen_at) : "--"}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{s.user_agent || ""}</p>
                  </div>
                  <button type="button" disabled={revoked || sessionsBusyId === s.id} onClick={async () => {
                    setSessionsBusyId(s.id);
                    try { await authApi.revokeSession(Number(s.id)); const r = await authApi.getSessions(); setSessions(Array.isArray(r?.sessions) ? r.sessions : []); }
                    finally { setSessionsBusyId(null); }
                  }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors shrink-0 disabled:opacity-50">
                    {sessionsBusyId === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Revoke
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
          <p className="text-xs text-muted-foreground">Tip: revoke unknown sessions for security.</p>
          <button type="button" onClick={async () => {
            setSessionsLoading(true);
            try { await authApi.revokeAllSessions(); setSessions([]); }
            finally { setSessionsLoading(false); }
          }} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors">
            Revoke all
          </button>
        </div>
      </div>

      {/* ═══ Toast ═══════════════════════════════════════════════════════ */}
      {message && (
        <div className="p-4 rounded-2xl border border-primary/20 bg-primary/10 text-foreground text-sm font-semibold">{message}</div>
      )}

      {/* ═══ Edit Modal ══════════════════════════════════════════════════ */}
      {editOpen && draft && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={handleCloseEdit} aria-hidden="true" />
          <div className="relative w-full max-w-2xl" role="dialog" aria-modal="true" aria-label="Edit profile">
            <div className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-foreground">Edit Profile</h2>
                  <p className="text-xs text-muted-foreground mt-1">Photo updates instantly. Other fields save on confirm.</p>
                </div>
                <button type="button" onClick={handleCloseEdit} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-border bg-surface-2 shadow-sm">
                    {previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><UserCircle className="w-14 h-14 text-muted-foreground/40" /></div>
                    )}
                  </div>
                  <label className="text-sm font-semibold text-primary cursor-pointer hover:underline">
                    Choose photo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); setClearPhoto(false); }} />
                  </label>
                  {draft.profile_image_url && (
                    <label className="flex items-center gap-2 text-xs text-foreground bg-surface-2 px-3 py-1.5 rounded-full border border-border">
                      <input type="checkbox" checked={clearPhoto} onChange={(e) => { setClearPhoto(e.target.checked); if (e.target.checked) setFile(null); }} /> Remove photo
                    </label>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Username</label>
                    <input className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} required minLength={3} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Email</label>
                    <input type="email" className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Phone <span className="font-normal normal-case text-muted-foreground/70">(optional)</span></label>
                    <input type="tel" className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" inputMode="tel" autoComplete="tel" placeholder="+998901234567" value={draft.phone_number} onChange={(e) => setDraft({ ...draft, phone_number: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">First name</label>
                    <input className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Last name</label>
                    <input className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">SAT exam date</label>
                    <p className="mb-2 text-[11px] text-muted-foreground">Choose from available dates.</p>
                    {(() => {
                      const allowed = new Set(examDateOptions.map((o) => o.exam_date));
                      const sat = draft.sat_exam_date?.trim() || "";
                      const orphan = !!sat && !allowed.has(sat);
                      return (
                        <>
                          <select className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={sat} onChange={(e) => setDraft({ ...draft, sat_exam_date: e.target.value })}>
                            <option value="">Not set</option>
                            {orphan && <option value={sat}>{formatDate(sat)} (old)</option>}
                            {examDateOptions.map((o) => <option key={o.id} value={o.exam_date}>{o.label ? `${o.label} · ${formatDate(o.exam_date)}` : formatDate(o.exam_date)}</option>)}
                          </select>
                          {examDateOptions.length === 0 && <p className="text-[11px] text-muted-foreground mt-1">No dates available yet.</p>}
                          {orphan && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">Saved date no longer available. Select a new one.</p>}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Target score (400-1600)</label>
                    <input type="number" min={400} max={1600} className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" value={draft.target_score} onChange={(e) => setDraft({ ...draft, target_score: e.target.value })} placeholder="e.g. 1400" />
                  </div>
                </div>

                {message && <p className="text-sm text-foreground font-semibold">{message}</p>}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button type="button" onClick={handleCloseEdit} disabled={saving} className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
