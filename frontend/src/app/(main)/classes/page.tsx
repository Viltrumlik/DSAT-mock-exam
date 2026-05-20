"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { classesApi } from "@/lib/api";
import { lessonDaysMetaSuffix } from "@/lib/classroomSchedule";
import { can } from "@/lib/permissions";
import {
  ClassroomAlert,
  ClassroomButton,
  ClassroomCard,
  ClassroomClassListSkeleton,
  ClassroomField,
  ClassroomModal,
  crInputClass,
  crSelectClass,
} from "@/components/classroom";
import {
  ArrowRight,
  BookOpen,
  Clock,
  GraduationCap,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { IconButton } from "@/components/ui/IconButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

/* ── Helpers ──────────────────────────────────────────────────────────── */
function isoDateToInput(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function teacherIdFromClass(c: {
  teacher?: unknown;
  teacher_details?: { id?: number } | null;
}): string {
  const raw = c?.teacher ?? c?.teacher_details?.id;
  if (raw == null || raw === "") return "";
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    return String((raw as { id: number }).id);
  }
  return String(raw);
}

function parseApiError(e: unknown, fallback: string): string {
  const raw = (e as { response?: { data?: unknown } })?.response?.data;
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "string") return raw.trim() || fallback;
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  if (typeof raw !== "object") return String(raw);
  const d = raw as Record<string, unknown>;
  if (typeof d.detail === "string") return d.detail;
  if (Array.isArray(d.detail)) return d.detail.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  if (d.detail != null && typeof d.detail === "object") return JSON.stringify(d.detail);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === "detail") continue;
    if (Array.isArray(v)) parts.push(`${k}: ${v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`);
    else if (typeof v === "string") parts.push(`${k}: ${v}`);
    else if (v !== null && typeof v === "object") parts.push(`${k}: ${JSON.stringify(v)}`);
  }
  return parts.length ? parts.join(" ") : fallback;
}

/* ═══════════════════════════════ MAIN ═══════════════════════════════════ */
export default function ClassesPage() {
  const router = useRouter();
  const canCreateClassroom = typeof window !== "undefined" && can("create_classroom");

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [newClass, setNewClass] = useState({
    name: "", subject: "ENGLISH", lesson_days: "ODD", lesson_time: "",
    lesson_hours: "2", start_date: "", room_number: "", telegram_chat_url: "",
    teacher: "", max_students: "",
  });
  const [classFilter, setClassFilter] = useState("");
  const [editClass, setEditClass] = useState({
    name: "", subject: "ENGLISH", lesson_days: "ODD", lesson_time: "",
    lesson_hours: "2", start_date: "", room_number: "", telegram_chat_id: "",
    teacher: "", max_students: "",
  });

  const fetchClasses = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await classesApi.list();
      setClasses(data.items);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not load groups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoin = async () => {
    setError(null);
    setJoining(true);
    try {
      const res = await classesApi.join(joinCode.trim());
      const c = res?.classroom;
      if (c?.id) router.push(`/classes/${c.id}`);
      else await fetchClasses();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not join group.");
    } finally {
      setJoining(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const c = await classesApi.create({
        name: newClass.name.trim(),
        subject: newClass.subject as "ENGLISH" | "MATH",
        lesson_days: newClass.lesson_days as "ODD" | "EVEN",
        lesson_time: newClass.lesson_time.trim(),
        lesson_hours: newClass.lesson_hours ? Number(newClass.lesson_hours) : 2,
        start_date: newClass.start_date || undefined,
        room_number: newClass.room_number.trim(),
        telegram_chat_id: newClass.telegram_chat_url.trim(),
        teacher: newClass.teacher ? Number(newClass.teacher) : undefined,
        max_students: newClass.max_students ? Number(newClass.max_students) : undefined,
      });
      setNewClass({
        name: "", subject: "ENGLISH", lesson_days: "ODD", lesson_time: "",
        lesson_hours: "2", start_date: "", room_number: "", telegram_chat_url: "",
        teacher: "", max_students: "",
      });
      setCreateOpen(false);
      await fetchClasses();
      if (c?.id) router.push(`/classes/${c.id}`);
    } catch (e: unknown) {
      setError(parseApiError(e, "Could not create group."));
    } finally {
      setCreating(false);
    }
  };

  const beginEdit = (c: any) => {
    setEditingId(c.id);
    setEditClass({
      name: c.name || "", subject: c.subject || "ENGLISH", lesson_days: c.lesson_days || "ODD",
      lesson_time: c.lesson_time || "", lesson_hours: c.lesson_hours != null ? String(c.lesson_hours) : "2",
      start_date: isoDateToInput(c.start_date), room_number: c.room_number || "",
      telegram_chat_id: c.telegram_chat_id || "", teacher: teacherIdFromClass(c),
      max_students: c.max_students != null ? String(c.max_students) : "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setError(null);
    setSavingEdit(true);
    try {
      await classesApi.update(editingId, {
        name: editClass.name.trim(), subject: editClass.subject,
        lesson_days: editClass.lesson_days, lesson_time: editClass.lesson_time.trim(),
        lesson_hours: editClass.lesson_hours ? Number(editClass.lesson_hours) : 2,
        start_date: editClass.start_date || null, room_number: editClass.room_number.trim(),
        telegram_chat_id: editClass.telegram_chat_id.trim(),
        teacher: editClass.teacher ? Number(editClass.teacher) : null,
        max_students: editClass.max_students ? Number(editClass.max_students) : null,
      });
      await fetchClasses();
      setEditingId(null);
    } catch (e: unknown) {
      setError(parseApiError(e, "Could not update group."));
    } finally {
      setSavingEdit(false);
    }
  };

  const editingClass = editingId ? classes.find((c) => c.id === editingId) : null;
  const filteredClasses = useMemo(() => {
    const q = classFilter.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => {
      const name = String(c.name ?? "").toLowerCase();
      const sub = String(c.subject ?? "").toLowerCase();
      return name.includes(q) || sub.includes(q);
    });
  }, [classes, classFilter]);

  const editTeacherOptions = useMemo(() => {
    if (!editingClass) return teachers;
    const tid = teacherIdFromClass(editingClass);
    const td = editingClass.teacher_details;
    if (!tid || !td || teachers.some((t) => String(t.id) === String(tid))) return teachers;
    return [...teachers, { id: td.id, email: td.email, first_name: td.first_name, last_name: td.last_name }];
  }, [editingClass, teachers]);

  useEffect(() => {
    if (!createOpen && !editingId) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { setCreateOpen(false); setEditingId(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [createOpen, editingId]);

  /* ── Derived stats ──────────────────────────────────────────────────── */
  const totalMembers = classes.reduce((s, c) => s + (c.members_count ?? 0), 0);
  const mathClasses = classes.filter((c) => c.subject === "MATH").length;
  const engClasses = classes.filter((c) => c.subject === "ENGLISH").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6">

      {/* ═══ Header ══════════════════════════════════════════════════════ */}
      <PageHeader
        eyebrow="Classes"
        title="Your Learning Spaces"
        description="Join with a code, open a space for homework, submissions, and grades."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchClasses()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-surface-2 disabled:opacity-50"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </button>
            {canCreateClassroom && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New group
              </button>
            )}
          </div>
        }
      />

      {/* ═══ Error ═══════════════════════════════════════════════════════ */}
      {error && (
        <div className="mb-6">
          <ClassroomAlert tone="error">{error}</ClassroomAlert>
        </div>
      )}

      {/* ═══ Stats Row ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <StatCard
          label="Total Classes"
          value={classes.length}
          icon={GraduationCap}
          accent="text-primary bg-primary/10"
        />
        <StatCard
          label="Total Members"
          value={totalMembers}
          icon={Users}
          accent="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40"
        />
        <StatCard
          label="Math Classes"
          value={mathClasses}
          icon={BookOpen}
          accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
        />
        <StatCard
          label="English Classes"
          value={engClasses}
          icon={BookOpen}
          accent="text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/40"
        />
      </div>

      {/* ═══ Main Layout ═════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ── Classes Grid ────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Search bar */}
          <div className="group relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              placeholder="Search classes..."
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-11 pr-10 text-sm font-medium shadow-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              aria-label="Filter groups by name or subject"
            />
            {classFilter && (
              <button
                type="button"
                onClick={() => setClassFilter("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <ClassroomClassListSkeleton />
          ) : classes.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No classes yet"
              description="Enter a group code from your teacher, or wait until an admin creates one."
            />
          ) : filteredClasses.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matches"
              description="Try a different search term."
              action={
                <button
                  type="button"
                  onClick={() => setClassFilter("")}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                >
                  Clear search
                </button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredClasses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/classes/${c.id}`)}
                  className="group relative flex flex-col rounded-2xl border border-border bg-card p-5 text-left transition-all hover:border-primary/25 hover:shadow-md"
                >
                  {canCreateClassroom && (
                    <div
                      className="absolute right-3 top-3 z-10"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu
                        align="end"
                        trigger={
                          <IconButton variant="ghost" size="sm" aria-label={`Actions for ${c.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </IconButton>
                        }
                      >
                        <DropdownMenuItem onClick={() => router.push(`/classes/${c.id}`)}>
                          <ArrowRight className="h-4 w-4 opacity-70" />
                          Open class
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => beginEdit(c)}>Edit details</DropdownMenuItem>
                      </DropdownMenu>
                    </div>
                  )}

                  <div className="flex items-start gap-4 pr-10">
                    <div className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      c.subject === "MATH"
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                        : "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
                    )}>
                      <GraduationCap className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-extrabold text-foreground group-hover:text-primary transition-colors">
                        {c.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {c.subject || "--"}
                        {lessonDaysMetaSuffix(c.lesson_days)}
                        {c.lesson_time ? ` · ${c.lesson_time}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-bold">
                        <Users className="h-3.5 w-3.5" />
                        {c.members_count ?? 0}
                        {c.max_students ? ` / ${c.max_students}` : ""}
                      </span>
                      {c.room_number && (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Clock className="h-3 w-3" />
                          Room {c.room_number}
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      Open <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">

          {/* Join a group */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Join a group</p>
                <p className="text-[11px] text-muted-foreground">Paste the code your teacher shared</p>
              </div>
            </div>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="e.g. ABC12XY"
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-semibold tracking-wide outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={!joinCode.trim() || joining}
              className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {joining ? "Joining..." : "Join group"}
            </button>
          </div>

          {/* Create group (admin) */}
          {canCreateClassroom && (
            <div className="rounded-2xl border border-primary/20 bg-card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Teacher</p>
                  <p className="text-sm font-bold text-foreground">Create a group</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                New group
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Create Modal ════════════════════════════════════════════════ */}
      {canCreateClassroom && (
        <ClassroomModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          titleId="create-group-title"
          eyebrow="Create group"
          title="New group"
          description="Add a group for your students. You can finish optional fields later."
        >
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
            <ClassroomField label="Group name" htmlFor="cg-name">
              <input id="cg-name" value={newClass.name} onChange={(e) => setNewClass((p) => ({ ...p, name: e.target.value }))} className={crInputClass} required />
            </ClassroomField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ClassroomField label="Subject" htmlFor="cg-subject">
                <select id="cg-subject" value={newClass.subject} onChange={(e) => setNewClass((p) => ({ ...p, subject: e.target.value }))} className={crSelectClass}>
                  <option value="ENGLISH">English</option>
                  <option value="MATH">Math</option>
                </select>
              </ClassroomField>
              <ClassroomField label="Lesson days" htmlFor="cg-days">
                <select id="cg-days" value={newClass.lesson_days} onChange={(e) => setNewClass((p) => ({ ...p, lesson_days: e.target.value }))} className={crSelectClass}>
                  <option value="ODD">Odd days</option>
                  <option value="EVEN">Even days</option>
                </select>
              </ClassroomField>
              <ClassroomField label="Lesson time" htmlFor="cg-time" hint="e.g. 18:00">
                <input id="cg-time" value={newClass.lesson_time} onChange={(e) => setNewClass((p) => ({ ...p, lesson_time: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Lesson hours" htmlFor="cg-hours">
                <input id="cg-hours" value={newClass.lesson_hours} onChange={(e) => setNewClass((p) => ({ ...p, lesson_hours: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Start date" htmlFor="cg-start">
                <input id="cg-start" type="date" value={newClass.start_date} onChange={(e) => setNewClass((p) => ({ ...p, start_date: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Room number" htmlFor="cg-room">
                <input id="cg-room" value={newClass.room_number} onChange={(e) => setNewClass((p) => ({ ...p, room_number: e.target.value }))} placeholder="Optional" className={crInputClass} />
              </ClassroomField>
            </div>
            <ClassroomField label="Telegram chat ID" htmlFor="cg-tg">
              <input id="cg-tg" value={newClass.telegram_chat_url} onChange={(e) => setNewClass((p) => ({ ...p, telegram_chat_url: e.target.value }))} placeholder="Optional" className={crInputClass} />
            </ClassroomField>
            <ClassroomField label="Teacher" htmlFor="cg-teacher">
              <select id="cg-teacher" value={newClass.teacher} onChange={(e) => setNewClass((p) => ({ ...p, teacher: e.target.value }))} className={crSelectClass}>
                <option value="">Default (you)</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.first_name || t.email} {t.last_name || ""}</option>
                ))}
              </select>
            </ClassroomField>
            <ClassroomField label="Max students" htmlFor="cg-max">
              <input id="cg-max" value={newClass.max_students} onChange={(e) => setNewClass((p) => ({ ...p, max_students: e.target.value }))} placeholder="Optional" className={crInputClass} inputMode="numeric" />
            </ClassroomField>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
              <ClassroomButton type="button" variant="secondary" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</ClassroomButton>
              <ClassroomButton type="submit" variant="primary" className="flex-1" disabled={!newClass.name.trim() || creating}>
                {creating ? "Creating..." : "Create group"}
              </ClassroomButton>
            </div>
          </form>
        </ClassroomModal>
      )}

      {/* ═══ Edit Modal ══════════════════════════════════════════════════ */}
      {canCreateClassroom && editingId && (
        <ClassroomModal
          open={!!editingId}
          onClose={() => setEditingId(null)}
          titleId="edit-group-title"
          eyebrow="Edit group"
          title="Update group"
          description="Changes apply as soon as you save."
        >
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
            <ClassroomField label="Group name" htmlFor="eg-name">
              <input id="eg-name" value={editClass.name} onChange={(e) => setEditClass((p) => ({ ...p, name: e.target.value }))} className={crInputClass} required />
            </ClassroomField>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ClassroomField label="Subject" htmlFor="eg-subject">
                <select id="eg-subject" value={editClass.subject} onChange={(e) => setEditClass((p) => ({ ...p, subject: e.target.value }))} className={crSelectClass}>
                  <option value="ENGLISH">English</option>
                  <option value="MATH">Math</option>
                </select>
              </ClassroomField>
              <ClassroomField label="Room number" htmlFor="eg-room">
                <input id="eg-room" value={editClass.room_number} onChange={(e) => setEditClass((p) => ({ ...p, room_number: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Start date" htmlFor="eg-start">
                <input id="eg-start" type="date" value={editClass.start_date} onChange={(e) => setEditClass((p) => ({ ...p, start_date: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Teacher" htmlFor="eg-teacher">
                <select id="eg-teacher" value={editClass.teacher} onChange={(e) => setEditClass((p) => ({ ...p, teacher: e.target.value }))} className={crSelectClass}>
                  <option value="">Not assigned</option>
                  {editTeacherOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.first_name || t.email} {t.last_name || ""}</option>
                  ))}
                </select>
              </ClassroomField>
            </div>
            <ClassroomField label="Telegram chat ID" htmlFor="eg-tg">
              <input id="eg-tg" value={editClass.telegram_chat_id} onChange={(e) => setEditClass((p) => ({ ...p, telegram_chat_id: e.target.value }))} className={crInputClass} />
            </ClassroomField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ClassroomField label="Lesson days" htmlFor="eg-days">
                <select id="eg-days" value={editClass.lesson_days} onChange={(e) => setEditClass((p) => ({ ...p, lesson_days: e.target.value }))} className={crSelectClass}>
                  <option value="ODD">Odd days</option>
                  <option value="EVEN">Even days</option>
                </select>
              </ClassroomField>
              <ClassroomField label="Lesson time" htmlFor="eg-time">
                <input id="eg-time" value={editClass.lesson_time} onChange={(e) => setEditClass((p) => ({ ...p, lesson_time: e.target.value }))} className={crInputClass} />
              </ClassroomField>
              <ClassroomField label="Lesson hours" htmlFor="eg-hours">
                <input id="eg-hours" value={editClass.lesson_hours} onChange={(e) => setEditClass((p) => ({ ...p, lesson_hours: e.target.value }))} className={crInputClass} />
              </ClassroomField>
            </div>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
              <ClassroomButton type="button" variant="secondary" className="flex-1" onClick={() => setEditingId(null)}>Cancel</ClassroomButton>
              <ClassroomButton type="submit" variant="primary" className="flex-1" disabled={savingEdit}>
                {savingEdit ? "Saving..." : "Save changes"}
              </ClassroomButton>
            </div>
          </form>
        </ClassroomModal>
      )}
    </div>
  );
}
