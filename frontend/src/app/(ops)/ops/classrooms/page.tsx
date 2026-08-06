"use client";

import { useEffect, useMemo, useState } from "react";
import { classesApi, examsAdminApi, type ClassroomMember } from "@/lib/api";
import { Search, School, RefreshCw, Users, UserCog, ArrowLeftRight, Trash2, Plus, UserPlus, UserMinus, X, ChevronRight, LifeBuoy, Calculator, Languages } from "lucide-react";
import { cn } from "@/lib/cn";
import { levelsForSubject, levelLabel } from "@/lib/levels";
import { Avatar } from "@/components/ui/Avatar";

// ADMIN GOVERNANCE. Admins create classrooms and assign a teacher here, and may view all
// classrooms, transfer ownership, and delete. Teachers do NOT create their own classrooms —
// the create control lives only in this admin console. Operational, day-to-day management
// (edit/assign content/materials) still lives in the Teacher Portal.

type TeacherDetails = { id: number; email: string; first_name?: string; last_name?: string; profile_image_url?: string | null } | null;
type Row = {
  id: number; name: string; subject?: string; level?: string; members_count?: number; student_count?: number;
  teacher_details?: TeacherDetails;
};
type TeacherOpt = { id: number; email: string; name: string; avatar?: string | null; subject?: string | null };
type StudentOpt = { id: number; email: string; name: string; avatar?: string | null };

function memberName(m: ClassroomMember): string {
  const u = m.user;
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username || u.email || `Student #${u.id}`;
}

type CreateForm = {
  name: string;
  subject: "ENGLISH" | "MATH";
  level: string;
  lesson_days: "ODD" | "EVEN";
  lesson_time: string;
  room_number: string;
  teacherId: string; // "" = assign a teacher later
};
const BLANK_CREATE: CreateForm = { name: "", subject: "ENGLISH", level: "", lesson_days: "ODD", lesson_time: "", room_number: "", teacherId: "" };

type SubjectKey = "ENGLISH" | "MATH";
type Group = { subject: string; level: string; count: number };
/** Where the drill-down currently is. Nothing chosen → subject picker; subject only → level
 *  picker; both → the classroom list, fetched server-side for that pair. */
type Crumb = { subject?: SubjectKey; level?: string };

const SUBJECT_META: Record<SubjectKey, { label: string; icon: typeof School; accent: string }> = {
  ENGLISH: { label: "English", icon: Languages, accent: "bg-teal-100 text-teal-800" },
  MATH: { label: "Math", icon: Calculator, accent: "bg-purple-100 text-purple-800" },
};

/** Course length in months per (subject, level) — mirrors journals/structure.COURSE_STRUCTURE,
 *  the only place the school's seven real courses are already enumerated. Shown on the level
 *  picker so an admin can see what they are creating into. */
const COURSE_MONTHS: Record<string, number> = {
  "MATH:foundation": 1,
  "ENGLISH:junior": 3, "MATH:junior": 3,
  "ENGLISH:middle": 2, "MATH:middle": 2,
  "ENGLISH:senior": 2, "MATH:senior": 2,
};

function normList(d: unknown): Row[] {
  if (Array.isArray(d)) return d as Row[];
  const r = (d as { results?: Row[] })?.results;
  return Array.isArray(r) ? r : [];
}

export default function OpsClassroomGovernancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ kind: "assign" | "transfer"; row: Row } | null>(null);
  const [pickTeacher, setPickTeacher] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(BLANK_CREATE);
  // Roster (student add/remove) modal
  const [roster, setRoster] = useState<{ row: Row } | null>(null);
  const [rosterMembers, setRosterMembers] = useState<ClassroomMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  // Drill-down: subject → level → classrooms.
  const [crumb, setCrumb] = useState<Crumb>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [supportOpts, setSupportOpts] = useState<TeacherOpt[]>([]);
  const [supportModal, setSupportModal] = useState<{ row: Row } | null>(null);
  const [supportAssigned, setSupportAssigned] = useState<{ user_id: number; name: string; email: string; subject: string | null }[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [pickSupport, setPickSupport] = useState<string>("");

  // People pickers are directory-wide and independent of the drill-down, so they load once
  // rather than on every level change.
  useEffect(() => {
    (async () => {
      try {
        const u = await examsAdminApi.getUsers();
        const list = (Array.isArray(u) ? u : (u as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[];
        const toOpt = (x: Record<string, unknown>) => ({
          id: Number(x.id), email: String(x.email ?? ""),
          name: [x.first_name, x.last_name].filter(Boolean).join(" ").trim() || String(x.email ?? `#${x.id}`),
          avatar: (x.profile_image_url as string | null) ?? null,
          subject: (x.subject as string | null) ?? null,
        });
        const role = (x: Record<string, unknown>) => String(x.role).toLowerCase();
        setTeachers(list.filter((x) => role(x) === "teacher").map(toOpt));
        setSupportOpts(list.filter((x) => role(x) === "support_teacher").map(toOpt));
        setStudents(list.filter((x) => role(x) === "student").map(toOpt));
      } catch { /* people pickers optional */ }
    })();
  }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setGroups(await classesApi.directoryGroups());
      // Rows are only fetched at the leaf — the pickers above run off the tallies, so the
      // console never pulls every classroom in the school just to draw seven buttons.
      if (crumb.subject && crumb.level) {
        setRows(normList(await classesApi.directory({ subject: crumb.subject, level: crumb.level })));
      } else {
        setRows([]);
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load the classroom directory (admin only).");
    } finally { setLoading(false); }
  };
  // Refetch whenever the drill-down moves. `load` is intentionally not a dependency: it is
  // recreated every render, and depending on it would loop.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crumb.subject, crumb.level]);

  const filtered = useMemo(() => {
    if (search.trim().length < 2) return rows;
    const t = search.toLowerCase();
    return rows.filter((c) => (c.name ?? "").toLowerCase().includes(t) || (c.subject ?? "").toLowerCase().includes(t));
  }, [rows, search]);

  const countFor = (subject: string, level?: string) =>
    groups
      .filter((g) => g.subject === subject && (level === undefined || g.level === level))
      .reduce((n, g) => n + g.count, 0);

  /** Levels valid for a subject, plus "untagged" when classrooms predate the level field —
   *  without that bucket those rows are unreachable through the drill-down. */
  const levelBucketsFor = (subject: SubjectKey): { key: string; label: string }[] => {
    const real = levelsForSubject(subject).map((l) => ({ key: l as string, label: levelLabel(l) }));
    return countFor(subject, "untagged") > 0
      ? [...real, { key: "untagged", label: "No level set" }]
      : real;
  };

  /** Open the create form pre-filled from wherever the admin is standing. */
  function openCreate() {
    setError(null);
    const level = crumb.level && crumb.level !== "untagged" ? crumb.level : "";
    setCreateForm({ ...BLANK_CREATE, subject: crumb.subject ?? "ENGLISH", level });
    setCreateOpen(true);
  }

  async function openSupport(row: Row) {
    setSupportModal({ row }); setSupportAssigned([]); setPickSupport(""); setSupportLoading(true); setError(null);
    try { setSupportAssigned(await classesApi.supportTeachers(row.id)); }
    catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load support teachers.");
    } finally { setSupportLoading(false); }
  }

  async function addSupport() {
    if (!supportModal || !pickSupport) return;
    setBusy(true); setError(null);
    try {
      await classesApi.assignSupportTeacher(supportModal.row.id, Number(pickSupport));
      setSupportAssigned(await classesApi.supportTeachers(supportModal.row.id));
      setPickSupport("");
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not assign the support teacher.");
    } finally { setBusy(false); }
  }

  async function dropSupport(userId: number, name: string) {
    if (!supportModal) return;
    if (!window.confirm(`Remove ${name} from “${supportModal.row.name}”? They can be assigned again later.`)) return;
    setBusy(true); setError(null);
    try {
      await classesApi.removeSupportTeacher(supportModal.row.id, userId);
      setSupportAssigned(await classesApi.supportTeachers(supportModal.row.id));
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not remove the support teacher.");
    } finally { setBusy(false); }
  }

  function teacherName(td: TeacherDetails) {
    if (!td) return "— Unassigned —";
    return [td.first_name, td.last_name].filter(Boolean).join(" ").trim() || td.email;
  }

  async function submitModal() {
    if (!modal || !pickTeacher) return;
    setBusy(true); setError(null);
    try {
      const uid = Number(pickTeacher);
      if (modal.kind === "assign") await classesApi.assignTeacher(modal.row.id, uid);
      else await classesApi.transferOwnership(modal.row.id, uid);
      setNotice(`${modal.kind === "assign" ? "Teacher assigned" : "Ownership transferred"} for “${modal.row.name}”.`);
      setModal(null); setPickTeacher(""); await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Action failed.");
    } finally { setBusy(false); }
  }

  async function submitCreate() {
    if (!createForm.name.trim()) { setError("Give the classroom a name."); return; }
    if (!createForm.level) { setError("Choose a level for the classroom."); return; }
    setBusy(true); setError(null);
    try {
      // The teacher is assigned server-side in the same request (teacher_id): the backend
      // sets the classroom teacher AND auto-enrolls them as an active member atomically.
      await classesApi.create({
        name: createForm.name.trim(),
        subject: createForm.subject,
        level: createForm.level,
        lesson_days: createForm.lesson_days,
        lesson_time: createForm.lesson_time.trim() || undefined,
        room_number: createForm.room_number.trim() || undefined,
        teacher_id: createForm.teacherId ? Number(createForm.teacherId) : undefined,
      });
      const assigned = createForm.teacherId ? " Teacher assigned and added to the classroom." : "";
      setNotice(`Classroom “${createForm.name.trim()}” created.${assigned}`);
      setCreateOpen(false); setCreateForm(BLANK_CREATE); await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not create the classroom.");
    } finally { setBusy(false); }
  }

  async function del(row: Row) {
    if (!window.confirm(`Delete classroom “${row.name}”? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try { await classesApi.governanceDelete(row.id); setNotice(`Deleted “${row.name}”.`); await load(); }
    catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Delete failed.");
    } finally { setBusy(false); }
  }

  async function openRoster(row: Row) {
    setRoster({ row }); setRosterMembers([]); setStudentSearch(""); setRosterLoading(true); setError(null);
    try { setRosterMembers(await classesApi.roster(row.id)); }
    catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load the roster.");
    } finally { setRosterLoading(false); }
  }

  async function addStudent(userId: number) {
    if (!roster) return;
    setBusy(true); setError(null);
    try {
      await classesApi.addMember(roster.row.id, userId);
      setRosterMembers(await classesApi.roster(roster.row.id));
      await load(); // refresh the directory's member counts
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not add the student.");
    } finally { setBusy(false); }
  }

  async function removeStudent(userId: number, name: string) {
    if (!roster) return;
    if (!window.confirm(`Remove ${name} from “${roster.row.name}”? They can rejoin with the class code, or you can re-add them here.`)) return;
    setBusy(true); setError(null);
    try {
      await classesApi.removeMember(roster.row.id, userId);
      setRosterMembers(await classesApi.roster(roster.row.id));
      await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not remove the student.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Admin console · Governance</p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Classroom governance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View all classrooms, assign teachers, transfer ownership, and delete. Operational
            management lives in the Teacher Portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Create classroom
          </button>
        </div>
      </div>

      {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

      {/* Breadcrumb — the only way back up the drill-down. */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
        <button type="button" onClick={() => { setCrumb({}); setSearch(""); }}
          className={cn("rounded-lg px-2 py-1", crumb.subject ? "text-primary hover:bg-surface-2" : "text-foreground")}>
          All subjects
        </button>
        {crumb.subject && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button type="button" onClick={() => { setCrumb({ subject: crumb.subject }); setSearch(""); }}
              className={cn("rounded-lg px-2 py-1", crumb.level ? "text-primary hover:bg-surface-2" : "text-foreground")}>
              {SUBJECT_META[crumb.subject].label}
            </button>
          </>
        )}
        {crumb.subject && crumb.level && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="rounded-lg px-2 py-1 text-foreground">
              {crumb.level === "untagged" ? "No level set" : levelLabel(crumb.level)}
            </span>
          </>
        )}
      </nav>

      {/* Step 1 — subject */}
      {!crumb.subject && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SUBJECT_META) as SubjectKey[]).map((key) => {
            const meta = SUBJECT_META[key];
            const Icon = meta.icon;
            const n = countFor(key);
            return (
              <button key={key} type="button" onClick={() => setCrumb({ subject: key })}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm hover:border-primary hover:bg-surface-2">
                <div className="flex items-center gap-3">
                  <span className={cn("grid h-11 w-11 place-items-center rounded-xl", meta.accent)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-base font-extrabold text-foreground">{meta.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {loading ? "…" : `${n} classroom${n === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* Step 2 — level */}
      {crumb.subject && !crumb.level && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {levelBucketsFor(crumb.subject).map((bucket) => {
            const n = countFor(crumb.subject as SubjectKey, bucket.key);
            const months = COURSE_MONTHS[`${crumb.subject}:${bucket.key}`];
            return (
              <button key={bucket.key} type="button" onClick={() => setCrumb({ subject: crumb.subject, level: bucket.key })}
                className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm hover:border-primary hover:bg-surface-2">
                <p className="text-sm font-extrabold text-foreground">{bucket.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {loading ? "…" : `${n} classroom${n === 1 ? "" : "s"}`}
                </p>
                {months ? (
                  <p className="mt-2 text-[11px] font-semibold text-muted-foreground">{months}-month course</p>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {crumb.subject && crumb.level && (
      <>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input type="search" placeholder="Search classrooms…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 font-bold text-foreground">
          {loading ? "Loading…" : `${filtered.length} classroom${filtered.length === 1 ? "" : "s"}`}
        </div>
        {loading ? (
          <div className="flex justify-center p-10"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground"><School className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="font-semibold">No classrooms.</p></div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((c) => (
              <div key={c.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="rounded-xl bg-surface-2 p-2.5 shrink-0"><School className="h-4 w-4 text-muted-foreground" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-extrabold text-foreground truncate">{c.name}</p>
                      {c.subject && <span className={cn("inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase", c.subject.toLowerCase().includes("math") ? "bg-purple-100 text-purple-800" : "bg-teal-100 text-teal-800")}>{c.subject}</span>}
                      {c.level && <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700">{levelLabel(c.level)}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>ID #{c.id}</span>
                      <span className="inline-flex items-center gap-1.5">{c.teacher_details?.profile_image_url ? <Avatar src={c.teacher_details.profile_image_url} name={teacherName(c.teacher_details)} size={18} /> : <UserCog className="h-3 w-3" />} {teacherName(c.teacher_details ?? null)}</span>
                      {typeof (c.members_count ?? c.student_count) === "number" && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{c.members_count ?? c.student_count}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button disabled={busy} onClick={() => openRoster(c)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-surface-2 disabled:opacity-50"><Users className="h-3.5 w-3.5" /> Students</button>
                  <button disabled={busy} onClick={() => { setModal({ kind: "assign", row: c }); setPickTeacher(""); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-surface-2 disabled:opacity-50"><UserCog className="h-3.5 w-3.5" /> Assign teacher</button>
                  <button disabled={busy} onClick={() => openSupport(c)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-surface-2 disabled:opacity-50"><LifeBuoy className="h-3.5 w-3.5" /> Support</button>
                  <button disabled={busy} onClick={() => { setModal({ kind: "transfer", row: c }); setPickTeacher(""); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-surface-2 disabled:opacity-50"><ArrowLeftRight className="h-3.5 w-3.5" /> Transfer</button>
                  <button disabled={busy} onClick={() => del(c)} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50" aria-label={`Delete ${c.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-foreground">{modal.kind === "assign" ? "Assign teacher" : "Transfer ownership"} — {modal.row.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Select a teacher.</p>
            <select value={pickTeacher} onChange={(e) => setPickTeacher(e.target.value)} className="mt-4 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
              <option value="">— Choose teacher —</option>
              {teachers.map((t) => <option key={t.id} value={String(t.id)}>{t.name} ({t.email})</option>)}
            </select>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2">Cancel</button>
              <button disabled={busy || !pickTeacher} onClick={submitModal} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? "Working…" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-foreground">Create classroom</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set up a classroom and assign its teacher. Teachers can’t create their own.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Class name</label>
                <input autoFocus value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="SAT Math — Evening Group" className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">Subject</label>
                  <select value={createForm.subject} onChange={(e) => {
                    const subject = e.target.value as CreateForm["subject"];
                    // Reset level if it isn't valid for the new subject (English has no Foundation).
                    const levelOk = levelsForSubject(subject).includes(createForm.level as never);
                    setCreateForm({ ...createForm, subject, level: levelOk ? createForm.level : "" });
                  }} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                    <option value="ENGLISH">English</option>
                    <option value="MATH">Math</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">Level</label>
                  <select value={createForm.level} onChange={(e) => setCreateForm({ ...createForm, level: e.target.value })} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                    <option value="">— Choose level —</option>
                    {levelsForSubject(createForm.subject).map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">Lesson days</label>
                  <select value={createForm.lesson_days} onChange={(e) => setCreateForm({ ...createForm, lesson_days: e.target.value as CreateForm["lesson_days"] })} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                    <option value="ODD">Odd days</option>
                    <option value="EVEN">Even days</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">Lesson time</label>
                  <input value={createForm.lesson_time} onChange={(e) => setCreateForm({ ...createForm, lesson_time: e.target.value })} placeholder="18:00" className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">Room</label>
                  <input value={createForm.room_number} onChange={(e) => setCreateForm({ ...createForm, room_number: e.target.value })} placeholder="Optional" className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Teacher</label>
                <select value={createForm.teacherId} onChange={(e) => setCreateForm({ ...createForm, teacherId: e.target.value })} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                  <option value="">— Assign a teacher later —</option>
                  {teachers.map((t) => <option key={t.id} value={String(t.id)}>{t.name} ({t.email})</option>)}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2">Cancel</button>
              <button disabled={busy || !createForm.name.trim() || !createForm.level} onClick={submitCreate} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? "Creating…" : "Create classroom"}</button>
            </div>
          </div>
        </div>
      )}

      {supportModal && (() => {
        // Only offer support teachers whose subject matches the class. The server refuses a
        // mismatch anyway, but a picker that lists impossible choices invites the mistake.
        const classDomain = (supportModal.row.subject ?? "").toLowerCase() === "math" ? "math" : "english";
        const assignedIds = new Set(supportAssigned.map((s) => s.user_id));
        const candidates = supportOpts.filter(
          (o) => !assignedIds.has(o.id) && (o.subject ?? "").toLowerCase() === classDomain,
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSupportModal(null)}>
            <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground">Support teachers — {supportModal.row.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Students book these staff for help outside the lesson. They join as teaching
                    assistants — the classroom keeps its own teacher.
                  </p>
                </div>
                <button onClick={() => setSupportModal(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Assign a support teacher</label>
                <div className="flex gap-2">
                  {/* min-w-0: without it a long option label ("Name (email@…)") sets the
                      select's min-content width, the flex row overflows the modal, and the
                      Assign button is pushed off the right edge. */}
                  <select value={pickSupport} onChange={(e) => setPickSupport(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                    <option value="">— Choose —</option>
                    {candidates.map((o) => <option key={o.id} value={String(o.id)}>{o.name} ({o.email})</option>)}
                  </select>
                  <button disabled={busy || !pickSupport} onClick={addSupport} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><UserPlus className="h-4 w-4" /> Assign</button>
                </div>
                {candidates.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No unassigned {classDomain} support teachers. Create one in Users first — a support
                    teacher can only cover the subject their account is set to.
                  </p>
                )}
              </div>

              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground">Assigned</label>
                  <span className="text-xs font-semibold text-muted-foreground">{supportLoading ? "…" : supportAssigned.length}</span>
                </div>
                {supportLoading ? (
                  <div className="flex justify-center p-6"><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
                ) : supportAssigned.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No support teachers yet.</div>
                ) : (
                  <div className="rounded-xl border border-border divide-y divide-border">
                    {supportAssigned.map((s) => (
                      <div key={s.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={s.name} size={32} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                          </div>
                        </div>
                        <button disabled={busy} onClick={() => dropSupport(s.user_id, s.name)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"><UserMinus className="h-3.5 w-3.5" /> Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end">
                <button onClick={() => setSupportModal(null)} className="rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2">Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {roster && (() => {
        const activeStudents = rosterMembers.filter((m) => m.role.toUpperCase() === "STUDENT" && m.status.toUpperCase() === "ACTIVE");
        const activeIds = new Set(activeStudents.map((m) => m.user.id));
        const q = studentSearch.trim().toLowerCase();
        const candidates = students
          .filter((s) => !activeIds.has(s.id))
          .filter((s) => q.length === 0 || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
          .slice(0, 25);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRoster(null)}>
            <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground">Students — {roster.row.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Add a student without a class code, or remove one. Removal is reversible.</p>
                </div>
                <button onClick={() => setRoster(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>

              {/* Add student */}
              <div className="mt-4">
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Add a student</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input type="search" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search students by name or email…"
                    className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                {studentSearch.trim().length > 0 && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                    {candidates.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">No matching students.</div>
                    ) : candidates.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar src={s.avatar} name={s.name} size={32} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                          </div>
                        </div>
                        <button disabled={busy} onClick={() => addStudent(s.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"><UserPlus className="h-3.5 w-3.5" /> Add</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Current roster */}
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-bold text-muted-foreground">Enrolled students</label>
                  <span className="text-xs font-semibold text-muted-foreground">{rosterLoading ? "…" : `${activeStudents.length}`}</span>
                </div>
                {rosterLoading ? (
                  <div className="flex justify-center p-6"><div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
                ) : activeStudents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No students yet. Add one above or share the class code.</div>
                ) : (
                  <div className="rounded-xl border border-border divide-y divide-border">
                    {activeStudents.map((m) => (
                      <div key={m.user.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar src={m.user.profile_image_url} name={memberName(m)} size={32} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{memberName(m)}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                          </div>
                        </div>
                        <button disabled={busy} onClick={() => removeStudent(m.user.id, memberName(m))} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"><UserMinus className="h-3.5 w-3.5" /> Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end">
                <button onClick={() => setRoster(null)} className="rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2">Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
