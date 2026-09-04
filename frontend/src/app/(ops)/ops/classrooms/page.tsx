"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classesApi, examsAdminApi, type ClassroomMember } from "@/lib/api";
import { Search, School, RefreshCw, Users, UserCog, ArrowLeftRight, Trash2, Plus, UserPlus, UserMinus, ChevronRight, LifeBuoy, Calculator, Languages, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { levelsForSubject, levelLabel } from "@/lib/levels";
import { useBranches, useRegions } from "@/features/org/orgHooks";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Spinner,
} from "@/components/ui";

// ADMIN GOVERNANCE. Admins create classrooms and assign a teacher here, and may view all
// classrooms, transfer ownership, and delete. Teachers do NOT create their own classrooms —
// the create control lives only in this admin console. Operational, day-to-day management
// (edit/assign content/materials) still lives in the Teacher Portal.

type TeacherDetails = { id: number; email: string; first_name?: string; last_name?: string; profile_image_url?: string | null } | null;
type Row = {
  id: number; name: string; subject?: string; level?: string; members_count?: number; student_count?: number;
  teacher_details?: TeacherDetails;
  // Everything the edit form can change. The list endpoint has always sent these — the row
  // type simply never declared them, so nothing could read them.
  description?: string;
  lesson_days?: "ODD" | "EVEN";
  lesson_time?: string;
  lesson_hours?: number;
  start_date?: string | null;
  room_number?: string;
  branch?: number | null;
  branch_name?: string | null;
  region_name?: string | null;
  telegram_group_url?: string;
  telegram_chat_id?: string;
  max_students?: number | null;
  schedule_summary?: string;
  is_active?: boolean;
};
/** One assigned support teacher, exactly as `classesApi.supportTeachers` returns them.
 *  Derived, never restated — see the note where this is used. */
type SupportTeacherRow = Awaited<ReturnType<typeof classesApi.supportTeachers>>[number];
type TeacherOpt = { id: number; email: string; name: string; avatar?: string | null; subject?: string | null };
type StudentOpt = { id: number; email: string; name: string; avatar?: string | null };

/**
 * Does this member of staff cover the classroom's subject?
 *
 * The frontend twin of `access.services.covers_domain_subject`, and it exists because the
 * straight `staff.subject === classDomain` comparison it replaces was WRONG for the one value
 * every support teacher on this platform actually has: **"both"**.
 *
 * `"both" === "math"` is false and `"both" === "english"` is false, so a both-subject support
 * teacher was filtered out of the assign picker for every classroom in the school — all three
 * of them, all 34 classes. The server has accepted them the whole time (its own comment warns
 * that "a direct comparison would refuse them for every class in the school"); it was only
 * ever this picker that hid them, so the symptom was an empty dropdown and a hint claiming no
 * support teacher existed.
 *
 * A blank subject covers nothing. That is deliberate and matches the server: an account whose
 * subject was never set is a misconfiguration, and offering it here would let an admin assign
 * a teacher the API is about to refuse.
 */
function coversSubject(staffSubject: string | null | undefined, classDomain: string): boolean {
  const s = (staffSubject ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "both" || s === classDomain;
}

/** "math" | "english" for a classroom, mirroring `Classroom.domain_subject` on the server. */
function classDomainOf(subject: string | null | undefined): string {
  return (subject ?? "").trim().toLowerCase() === "math" ? "math" : "english";
}

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
  /** Support staff to attach immediately. Several may serve one classroom, so this is a
   *  list — unlike `teacherId`, which is a single FK on the classroom itself. */
  supportIds: number[];
  /** Invite link for the class Telegram group. Normalised and checked server-side. */
  telegramUrl: string;
  telegramChatId: string;
  /** Only a filter for the branch picker — a classroom stores its BRANCH, and the region is
   *  reached through it. Kept in the form so choosing a region narrows the second select. */
  regionId: string;
  branchId: string;
};
const BLANK_CREATE: CreateForm = { name: "", subject: "ENGLISH", level: "", lesson_days: "ODD", lesson_time: "", room_number: "", teacherId: "", supportIds: [], telegramUrl: "", telegramChatId: "", regionId: "", branchId: "" };

/** What an administrator may change after the fact.
 *
 *  Everything except `subject`, which the governance endpoint refuses: a classroom's subject
 *  decides which journal binds to it and which assessments its level admits, so flipping it
 *  on a running class strands the homework already released to those students. */
type EditForm = {
  name: string;
  level: string;
  description: string;
  lesson_days: "ODD" | "EVEN";
  lesson_time: string;
  room_number: string;
  telegramUrl: string;
  telegramChatId: string;
  regionId: string;
  branchId: string;
  is_active: boolean;
};
const BLANK_EDIT: EditForm = {
  name: "", level: "", description: "", lesson_days: "ODD", lesson_time: "",
  room_number: "", telegramUrl: "", telegramChatId: "", regionId: "", branchId: "", is_active: true,
};

type SubjectKey = "ENGLISH" | "MATH";
type Group = { subject: string; level: string; count: number };
/** Where the drill-down currently is. Nothing chosen → subject picker; subject only → level
 *  picker; both → the classroom list, fetched server-side for that pair. */
type Crumb = { subject?: SubjectKey; level?: string };

/** Subject is a *categorical* accent, so it is expressed as design-system tones rather than
 *  a raw palette colour — that is what keeps the tiles and the row chips readable in dark
 *  mode without a hand-maintained `dark:` pair. `badge` and `accent` are the same tone. */
const SUBJECT_META: Record<SubjectKey, { label: string; icon: typeof School; accent: string; badge: "accent" | "primary" }> = {
  ENGLISH: { label: "English", icon: Languages, accent: "bg-accent-soft text-accent", badge: "accent" },
  MATH: { label: "Math", icon: Calculator, accent: "bg-primary-soft text-primary", badge: "primary" },
};

/** A row's subject is free text from the API, so it is matched the same loose way the
 *  support-teacher picker matches it. */
function subjectTone(subject?: string): "accent" | "primary" {
  return (subject ?? "").toLowerCase().includes("math") ? SUBJECT_META.MATH.badge : SUBJECT_META.ENGLISH.badge;
}

/** Course length in months per (subject, level) — mirrors journals/structure.COURSE_STRUCTURE,
 *  the only place the school's seven real courses are already enumerated. Shown on the level
 *  picker so an admin can see what they are creating into. */
const COURSE_MONTHS: Record<string, number> = {
  "MATH:foundation": 1,
  "ENGLISH:junior": 3, "MATH:junior": 3,
  "ENGLISH:middle": 2, "MATH:middle": 2,
  "ENGLISH:senior": 2, "MATH:senior": 2,
};

/** Shared chrome for the two drill-down pickers: a whole tile is the target, so the tile
 *  itself is the button rather than a card wrapping one. */
const TILE = "ds-ring rounded-2xl border border-border bg-card text-left shadow-card transition-colors hover:border-border-strong hover:bg-surface-2";

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
  /** The classroom being edited, and the form holding its edits. */
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(BLANK_EDIT);
  // Roster (student add/remove) modal
  const [roster, setRoster] = useState<{ row: Row } | null>(null);
  const [rosterMembers, setRosterMembers] = useState<ClassroomMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  /** The roster/support lists come back empty on failure too, so "nobody is enrolled" and
   *  "the request failed" are indistinguishable without these. Loading → error → empty. */
  const [rosterFailed, setRosterFailed] = useState(false);
  const [supportFailed, setSupportFailed] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  // Drill-down: subject → level → classrooms.
  const [crumb, setCrumb] = useState<Crumb>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [supportOpts, setSupportOpts] = useState<TeacherOpt[]>([]);
  // Where the class meets, offered at creation time. 23 of this school's 34 classrooms were
  // created with no branch and therefore sit on no branch leaderboard — asking here is what
  // stops that list growing, and it is cheaper than finding them again later on /ops/branches.
  const regions = useRegions();
  const branches = useBranches();
  const [supportModal, setSupportModal] = useState<{ row: Row } | null>(null);
  // Derived from the API function rather than restated by hand. A hand-written copy of a
  // response shape silently drops every field the server adds later — which is how the
  // dashboard crashed once already — and it dropped `is_bookable` here the moment it existed.
  const [supportAssigned, setSupportAssigned] = useState<SupportTeacherRow[]>([]);
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

  // Monotonic token: two loads can be in flight when an admin clicks through levels quickly,
  // and without this the SLOWER (earlier) response wins and the list shows the wrong level's
  // classrooms under the right breadcrumb.
  const loadSeq = useRef(0);

  const load = async () => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    setLoading(true); setError(null);
    try {
      const groupRows = await classesApi.directoryGroups();
      if (stale()) return;
      setGroups(groupRows);
      // Rows are only fetched at the leaf — the pickers above run off the tallies, so the
      // console never pulls every classroom in the school just to draw seven buttons.
      if (crumb.subject && crumb.level) {
        const data = await classesApi.directory({ subject: crumb.subject, level: crumb.level });
        if (stale()) return;
        setRows(normList(data));
      } else {
        setRows([]);
      }
    } catch (e: unknown) {
      if (stale()) return;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load the classroom directory (admin only).");
    } finally { if (!stale()) setLoading(false); }
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

  /** Assign/transfer share one modal. The error is cleared on open so a stale banner from an
   *  earlier action is not mistaken for a failure of this one — every other opener here does
   *  the same. */
  function openTeacherModal(kind: "assign" | "transfer", row: Row) {
    setError(null);
    setModal({ kind, row });
    setPickTeacher("");
  }

  async function openSupport(row: Row) {
    setSupportModal({ row }); setSupportAssigned([]); setPickSupport(""); setSupportLoading(true); setError(null);
    setSupportFailed(false);
    try { setSupportAssigned(await classesApi.supportTeachers(row.id)); }
    catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load support teachers.");
      setSupportFailed(true);
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

  /** Branches inside the region currently chosen in the create form. */
  const branchOptions = useMemo(
    () =>
      (branches.data ?? []).filter(
        (b) => String(b.region) === createForm.regionId && b.is_active,
      ),
    [branches.data, createForm.regionId],
  );
  /** Does the school have anywhere to put a classroom at all? */
  const hasAnyBranch = (branches.data ?? []).some((b) => b.is_active);

  async function submitCreate() {
    if (!createForm.name.trim()) { setError("Give the classroom a name."); return; }
    if (!createForm.level) { setError("Choose a level for the classroom."); return; }
    // Required only when the school actually has a branch. Blocking creation on a school
    // that has not set up regions yet would be a dead end; requiring it once there IS a
    // choice is what stops the \"no branch\" list growing again — it stood at 23 of 34.
    if (hasAnyBranch && !createForm.branchId) {
      setError("Choose the region and branch this class meets at.");
      return;
    }
    setBusy(true); setError(null);
    try {
      // The teacher is assigned server-side in the same request (teacher_id): the backend
      // sets the classroom teacher AND auto-enrolls them as an active member atomically.
      const made = await classesApi.create({
        name: createForm.name.trim(),
        subject: createForm.subject,
        level: createForm.level,
        lesson_days: createForm.lesson_days,
        lesson_time: createForm.lesson_time.trim() || undefined,
        room_number: createForm.room_number.trim() || undefined,
        teacher_id: createForm.teacherId ? Number(createForm.teacherId) : undefined,
        telegram_group_url: createForm.telegramUrl.trim() || undefined,
        telegram_chat_id: createForm.telegramChatId.trim() || undefined,
        support_teacher_ids: createForm.supportIds.length ? createForm.supportIds : undefined,
        // `branch` only — the region is derived from it server-side, and sending a region
        // the branch does not belong to would be two sources of truth for one fact.
        branch: createForm.branchId ? Number(createForm.branchId) : undefined,
      });
      const assigned = createForm.teacherId ? " Teacher assigned and added to the classroom." : "";
      // What the SERVER accepted, not what was asked for. An id whose account role or
      // subject does not hold is skipped rather than failing the creation, so counting the
      // form's own list here would report an assignment that never happened.
      const supportCount = (made?.support_teacher_ids ?? []).length;
      const wanted = createForm.supportIds.length;
      const support =
        wanted === 0
          ? ""
          : supportCount === wanted
            ? ` ${supportCount} support teacher${supportCount === 1 ? "" : "s"} assigned.`
            : ` ${supportCount} of ${wanted} support teachers assigned — the rest don’t cover this subject.`;
      setNotice(`Classroom “${createForm.name.trim()}” created.${assigned}${support}`);
      setCreateOpen(false); setCreateForm(BLANK_CREATE); await load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not create the classroom.");
    } finally { setBusy(false); }
  }

  /** Fill the edit form from the row, resolving its branch back to a region for the picker. */
  function openEdit(row: Row) {
    setError(null);
    const branch = (branches.data ?? []).find((b) => b.id === row.branch);
    setEditForm({
      name: row.name ?? "",
      level: row.level ?? "",
      description: row.description ?? "",
      lesson_days: row.lesson_days === "EVEN" ? "EVEN" : "ODD",
      lesson_time: row.lesson_time ?? "",
      room_number: row.room_number ?? "",
      telegramUrl: row.telegram_group_url ?? "",
      telegramChatId: row.telegram_chat_id ?? "",
      // The classroom stores only its branch; the region select is derived from it so the
      // branch list opens already narrowed to where this class actually is.
      regionId: branch ? String(branch.region) : "",
      branchId: row.branch != null ? String(row.branch) : "",
      is_active: row.is_active !== false,
    });
    setEditRow(row);
  }

  async function submitEdit() {
    if (!editRow) return;
    if (!editForm.name.trim()) { setError("Give the classroom a name."); return; }
    setBusy(true); setError(null);
    try {
      await classesApi.governanceUpdate(editRow.id, {
        name: editForm.name.trim(),
        level: editForm.level,
        description: editForm.description.trim(),
        lesson_days: editForm.lesson_days,
        lesson_time: editForm.lesson_time.trim(),
        room_number: editForm.room_number.trim(),
        telegram_group_url: editForm.telegramUrl.trim(),
        telegram_chat_id: editForm.telegramChatId.trim(),
        // `null` clears the branch; `undefined` would leave the field out of the PATCH and
        // silently keep the old one, which is not what an emptied select means.
        branch: editForm.branchId ? Number(editForm.branchId) : null,
        is_active: editForm.is_active,
      });
      setNotice(`Saved “${editForm.name.trim()}”.`);
      setEditRow(null);
      await load();
    } catch (e: unknown) {
      const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
      // Field errors as well as `detail`: the serializer refuses a non-Telegram link and a
      // level that does not fit the subject, and both come back keyed by field name.
      const detail =
        typeof data?.detail === "string"
          ? data.detail
          : Object.entries(data ?? {})
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`)
              .find(Boolean);
      setError(detail || "Could not save the classroom.");
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
    setRosterFailed(false);
    try { setRosterMembers(await classesApi.roster(row.id)); }
    catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load the roster.");
      setRosterFailed(true);
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
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Admin console · Governance</p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Classroom governance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View all classrooms, assign teachers, transfer ownership, and delete. Operational
            management lives in the Teacher Portal.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" onClick={load} leftIcon={<RefreshCw />}>Refresh</Button>
          <Button size="sm" onClick={openCreate} leftIcon={<Plus />}>Create classroom</Button>
        </div>
      </div>

      {notice && <Alert tone="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}

      {/* Breadcrumb — the only way back up the drill-down. */}
      <nav aria-label="Classroom directory" className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
        <button type="button" onClick={() => { setCrumb({}); setSearch(""); }}
          className={cn("ds-ring rounded-lg px-2 py-1", crumb.subject ? "text-primary hover:bg-surface-2" : "text-foreground")}>
          All subjects
        </button>
        {crumb.subject && (
          <>
            <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            <button type="button" onClick={() => { setCrumb({ subject: crumb.subject }); setSearch(""); }}
              className={cn("ds-ring rounded-lg px-2 py-1", crumb.level ? "text-primary hover:bg-surface-2" : "text-foreground")}>
              {SUBJECT_META[crumb.subject].label}
            </button>
          </>
        )}
        {crumb.subject && crumb.level && (
          <>
            <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            <span aria-current="page" className="rounded-lg px-2 py-1 text-foreground">
              {crumb.level === "untagged" ? "No level set" : levelLabel(crumb.level)}
            </span>
          </>
        )}
      </nav>

      {/* Step 1 — subject */}
      {!crumb.subject && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(SUBJECT_META) as SubjectKey[]).map((key) => {
            const meta = SUBJECT_META[key];
            const Icon = meta.icon;
            const n = countFor(key);
            return (
              <button key={key} type="button" onClick={() => setCrumb({ subject: key })}
                className={cn(TILE, "flex items-center justify-between gap-4 p-5")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", meta.accent)}>
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="ds-h4 truncate">{meta.label}</p>
                    {loading ? (
                      <Skeleton variant="text" className="mt-1.5 w-24" />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        <span className="ds-num">{n}</span> classroom{n === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </div>
                <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* Step 2 — level */}
      {crumb.subject && !crumb.level && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {levelBucketsFor(crumb.subject).map((bucket) => {
            const n = countFor(crumb.subject as SubjectKey, bucket.key);
            const months = COURSE_MONTHS[`${crumb.subject}:${bucket.key}`];
            return (
              <button key={bucket.key} type="button" onClick={() => setCrumb({ subject: crumb.subject, level: bucket.key })}
                className={cn(TILE, "p-4")}>
                <p className="text-sm font-bold text-foreground">{bucket.label}</p>
                {loading ? (
                  <Skeleton variant="text" className="mt-1.5 w-20" />
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="ds-num">{n}</span> classroom{n === 1 ? "" : "s"}
                  </p>
                )}
                {months ? (
                  <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                    <span className="ds-num">{months}</span>-month course
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {crumb.subject && crumb.level && (
      <>
      <div className="max-w-md">
        <Input
          id="classroom-search"
          type="search"
          aria-label="Search classrooms"
          leftIcon={<Search />}
          inputSize="sm"
          placeholder="Search classrooms…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>
            {loading ? "Loading classrooms…" : <><span className="ds-num">{filtered.length}</span> classroom{filtered.length === 1 ? "" : "s"}</>}
          </CardTitle>
        </CardHeader>
        {loading ? (
          <div className="divide-y divide-border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton variant="text" className="w-40" />
                  <Skeleton variant="text" className="w-64" />
                </div>
                <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
              </div>
            ))}
          </div>
        ) : error && rows.length === 0 ? (
          // Loading → error → empty → content. Without this branch a failed request rendered
          // as "no classrooms", which is a lie: the level may be full. Gated on `rows`, not
          // `filtered`: a mutation error while a search matches nothing must not relabel the
          // list as a failed load.
          <CardContent className="space-y-3">
            <Alert tone="danger" title="Couldn’t load the classrooms">{error}</Alert>
            <Button variant="secondary" onClick={load} leftIcon={<RefreshCw />}>Retry</Button>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                compact
                icon={School}
                title="No classrooms yet"
                description="Create the first classroom for this level and it will appear here."
                action={<Button onClick={openCreate} leftIcon={<Plus />}>Create classroom</Button>}
              />
            ) : (
              <EmptyState
                compact
                icon={Search}
                title="No classrooms match that search"
                description="Try a different name or subject."
              />
            )}
          </CardContent>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((c) => (
              <div key={c.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="rounded-xl bg-surface-2 p-2.5 shrink-0"><School aria-hidden className="h-4 w-4 text-muted-foreground" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-bold text-foreground truncate">{c.name}</p>
                      {c.subject && <Badge variant={subjectTone(c.subject)} className="uppercase">{c.subject}</Badge>}
                      {c.level && <Badge variant="neutral" className="uppercase">{levelLabel(c.level)}</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="ds-num">ID #{c.id}</span>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        {c.teacher_details?.profile_image_url
                          ? <Avatar src={c.teacher_details.profile_image_url} name={teacherName(c.teacher_details)} size={18} />
                          : <UserCog aria-hidden className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{teacherName(c.teacher_details ?? null)}</span>
                      </span>
                      {/* Enrolled students — the same set the Students button opens. It used
                          to show members_count, which counts the teacher, the support
                          teachers, and every student ever removed (removal is a soft
                          delete), so a class of eight could read as fifteen. */}
                      {typeof (c.student_count ?? c.members_count) === "number" && (
                        <span className="inline-flex items-center gap-1">
                          <Users aria-hidden className="h-3 w-3" />
                          <span className="ds-num">{c.student_count ?? c.members_count}</span>
                          <span>{(c.student_count ?? c.members_count) === 1 ? "student" : "students"}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => openEdit(c)} leftIcon={<Pencil />}>Edit</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => openRoster(c)} leftIcon={<Users />}>Students</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => openTeacherModal("assign", c)} leftIcon={<UserCog />}>Assign teacher</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => openSupport(c)} leftIcon={<LifeBuoy />}>Support</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => openTeacherModal("transfer", c)} leftIcon={<ArrowLeftRight />}>Transfer</Button>
                  <IconButton size="sm" variant="ghost" disabled={busy} onClick={() => del(c)} aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      </>
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`${modal.kind === "assign" ? "Assign teacher" : "Transfer ownership"} — ${modal.row.name}`}
          description="Select a teacher."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={busy} disabled={!pickTeacher} onClick={submitModal}>Confirm</Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Teacher" htmlFor="teacher-pick">
              <Select id="teacher-pick" value={pickTeacher} onChange={(e) => setPickTeacher(e.target.value)}>
                <option value="">— Choose teacher —</option>
                {teachers.map((t) => <option key={t.id} value={String(t.id)}>{t.name} ({t.email})</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {createOpen && (
        <Modal
          open
          onClose={() => setCreateOpen(false)}
          title="Create classroom"
          description="Set up a classroom and assign its teacher. Teachers can’t create their own."
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button loading={busy} disabled={!createForm.name.trim() || !createForm.level || (hasAnyBranch && !createForm.branchId)} onClick={submitCreate}>Create classroom</Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Class name" htmlFor="create-name" required>
              <Input id="create-name" required autoFocus value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="SAT Math — Evening Group" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Subject" htmlFor="create-subject">
                <Select id="create-subject" value={createForm.subject} onChange={(e) => {
                  const subject = e.target.value as CreateForm["subject"];
                  // Reset level if it isn't valid for the new subject (English has no Foundation).
                  const levelOk = levelsForSubject(subject).includes(createForm.level as never);
                  setCreateForm({ ...createForm, subject, level: levelOk ? createForm.level : "" });
                }}>
                  <option value="ENGLISH">English</option>
                  <option value="MATH">Math</option>
                </Select>
              </Field>
              <Field label="Level" htmlFor="create-level" required>
                <Select id="create-level" required value={createForm.level} onChange={(e) => setCreateForm({ ...createForm, level: e.target.value })}>
                  <option value="">— Choose level —</option>
                  {levelsForSubject(createForm.subject).map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lesson days" htmlFor="create-days">
                <Select id="create-days" value={createForm.lesson_days} onChange={(e) => setCreateForm({ ...createForm, lesson_days: e.target.value as CreateForm["lesson_days"] })}>
                  <option value="ODD">Odd days</option>
                  <option value="EVEN">Even days</option>
                </Select>
              </Field>
              <Field label="Lesson time" htmlFor="create-time">
                <Input id="create-time" value={createForm.lesson_time} onChange={(e) => setCreateForm({ ...createForm, lesson_time: e.target.value })} placeholder="18:00" />
              </Field>
              <Field label="Room" htmlFor="create-room">
                <Input id="create-room" value={createForm.room_number} onChange={(e) => setCreateForm({ ...createForm, room_number: e.target.value })} placeholder="Optional" />
              </Field>
            </div>
            {/* Where it meets. Two selects, but only ONE fact is stored: the branch. The
                region select exists to narrow the branch list — a school with four regions
                and a dozen branches makes a single flat picker a scrolling exercise.

                Gated on `hasAnyBranch`, NOT on `branchOptions` — `branchOptions` is filtered
                BY the chosen region, so gating on it meant the region select could never
                appear to be chosen from. Shown only when the school has a branch at all:
                rendering an empty pair of dropdowns on a school that has not set up regions
                yet would make creating a classroom look blocked on something it is not. */}
            {hasAnyBranch ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Region" htmlFor="create-region" required>
                  <Select
                    id="create-region"
                    value={createForm.regionId}
                    onChange={(e) =>
                      // Clear the branch with the region: keeping it would leave a branch
                      // selected that is no longer in the list the admin can see.
                      setCreateForm({ ...createForm, regionId: e.target.value, branchId: "" })
                    }
                  >
                    <option value="">— Choose region —</option>
                    {(regions.data ?? []).map((r) => (
                      <option key={r.id} value={String(r.id)}>{r.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Branch"
                  htmlFor="create-branch"
                  required
                  hint={
                    createForm.regionId && branchOptions.length === 0
                      ? "This region has no branches yet — add one on the Branches page."
                      : undefined
                  }
                >
                  <Select
                    id="create-branch"
                    disabled={!createForm.regionId}
                    value={createForm.branchId}
                    onChange={(e) => setCreateForm({ ...createForm, branchId: e.target.value })}
                  >
                    <option value="">
                      {createForm.regionId ? "— Choose branch —" : "— Pick a region first —"}
                    </option>
                    {branchOptions.map((b) => (
                      <option key={b.id} value={String(b.id)}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}

            <Field label="Teacher" htmlFor="create-teacher">
              <Select id="create-teacher" value={createForm.teacherId} onChange={(e) => setCreateForm({ ...createForm, teacherId: e.target.value })}>
                <option value="">— Assign a teacher later —</option>
                {teachers.map((t) => <option key={t.id} value={String(t.id)}>{t.name} ({t.email})</option>)}
              </Select>
            </Field>

            {/* Support staff, assignable here rather than only from the row menu afterwards.
                Checkboxes rather than a select, because several may serve one class.

                The candidate list is filtered by `coversSubject` against the subject chosen
                IN THIS FORM, so it re-narrows when the subject changes — and never with a
                `===`, which would hide every support teacher this school has (all three are
                `subject="both"`). */}
            {(() => {
              const classDomain = classDomainOf(createForm.subject);
              const candidates = supportOpts.filter((o) => coversSubject(o.subject, classDomain));
              return (
                <Field
                  label="Support teachers"
                  hint={
                    candidates.length === 0
                      ? "No support teacher covers this subject yet."
                      : "Optional. They can grade, take attendance and be booked by these students."
                  }
                >
                  {candidates.length === 0 ? null : (
                    <div className="space-y-1.5 rounded-xl border border-border bg-surface-2 p-3">
                      {candidates.map((o) => (
                        <Checkbox
                          key={o.id}
                          label={`${o.name} (${o.email})`}
                          checked={createForm.supportIds.includes(o.id)}
                          onChange={(e) =>
                            setCreateForm({
                              ...createForm,
                              supportIds: e.target.checked
                                ? [...createForm.supportIds, o.id]
                                : createForm.supportIds.filter((x) => x !== o.id),
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </Field>
              );
            })()}

            <Field
              label="Telegram group"
              htmlFor="create-telegram"
              hint="Optional. Students see a “Join Telegram group” button on the class page."
            >
              <Input
                id="create-telegram"
                value={createForm.telegramUrl}
                onChange={(e) => setCreateForm({ ...createForm, telegramUrl: e.target.value })}
                placeholder="https://t.me/joinchat/…"
              />
            </Field>

            <Field
              label="Telegram chat id"
              htmlFor="create-telegram-chat"
              hint="Fill this in and the bot takes over the group: each student gets a single-use invite, and a frozen account is taken out automatically. Add the bot to the group as an administrator (invite + ban rights), then send /chatid there to read the id."
            >
              <Input
                id="create-telegram-chat"
                value={createForm.telegramChatId}
                onChange={(e) => setCreateForm({ ...createForm, telegramChatId: e.target.value })}
                placeholder="-1001234567890"
              />
            </Field>
          </div>
        </Modal>
      )}

      {editRow && (() => {
        // The branch picker narrows by the region chosen in THIS form, exactly as the create
        // modal does. Its own memo would be a second source of truth for one list, so it is
        // derived inline from the same `branches.data`.
        const editBranchOptions = (branches.data ?? []).filter(
          (b) =>
            String(b.region) === editForm.regionId &&
            // The branch this class is ALREADY at stays in the list even once it has been
            // closed. Dropping it would render the select blank while the form still held
            // the old id, so an administrator renaming the class would watch the branch
            // apparently empty itself. The server allows keeping it, and refuses a move TO
            // a closed one — so the option is labelled rather than hidden.
            (b.is_active || b.id === editRow.branch),
        );
        // Levels depend on the classroom's subject, which is NOT editable here — so it comes
        // off the row rather than the form.
        const subject = (editRow.subject === "MATH" ? "MATH" : "ENGLISH") as SubjectKey;
        return (
          <Modal
            open
            onClose={() => setEditRow(null)}
            title={`Edit — ${editRow.name}`}
            description="Everything except the subject. Changing a class's subject would strand the homework already released to its students; make a new classroom for that."
            footer={
              <>
                <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
                <Button loading={busy} disabled={!editForm.name.trim()} onClick={submitEdit}>Save changes</Button>
              </>
            }
          >
            <div className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Class name" htmlFor="edit-name" required>
                <Input id="edit-name" required autoFocus value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </Field>
              <Field label="Description" htmlFor="edit-description" hint="Shown to teachers and students on the class page.">
                <Input id="edit-description" value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Optional" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Subject" hint="Not editable — see above.">
                  <Input value={subject === "MATH" ? "Math" : "English"} disabled readOnly />
                </Field>
                <Field label="Level" htmlFor="edit-level">
                  <Select id="edit-level" value={editForm.level}
                    onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}>
                    <option value="">— Untagged —</option>
                    {levelsForSubject(subject).map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Lesson days" htmlFor="edit-days">
                  <Select id="edit-days" value={editForm.lesson_days}
                    onChange={(e) => setEditForm({ ...editForm, lesson_days: e.target.value as EditForm["lesson_days"] })}>
                    <option value="ODD">Odd days</option>
                    <option value="EVEN">Even days</option>
                  </Select>
                </Field>
                <Field label="Lesson time" htmlFor="edit-time">
                  <Input id="edit-time" value={editForm.lesson_time}
                    onChange={(e) => setEditForm({ ...editForm, lesson_time: e.target.value })}
                    placeholder="18:00" />
                </Field>
                <Field label="Room" htmlFor="edit-room">
                  <Input id="edit-room" value={editForm.room_number}
                    onChange={(e) => setEditForm({ ...editForm, room_number: e.target.value })}
                    placeholder="Optional" />
                </Field>
              </div>
              {hasAnyBranch ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Region" htmlFor="edit-region">
                    <Select id="edit-region" value={editForm.regionId}
                      onChange={(e) => setEditForm({ ...editForm, regionId: e.target.value, branchId: "" })}>
                      <option value="">— Not set —</option>
                      {(regions.data ?? []).map((r) => (
                        <option key={r.id} value={String(r.id)}>{r.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Branch"
                    htmlFor="edit-branch"
                    hint={
                      editForm.regionId && editBranchOptions.length === 0
                        ? "This region has no branches yet — add one on the Branches page."
                        : undefined
                    }
                  >
                    <Select id="edit-branch" disabled={!editForm.regionId} value={editForm.branchId}
                      onChange={(e) => setEditForm({ ...editForm, branchId: e.target.value })}>
                      <option value="">
                        {editForm.regionId ? "— Choose branch —" : "— Pick a region first —"}
                      </option>
                      {editBranchOptions.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.is_active ? b.name : `${b.name} (closed)`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : null}
              <Field
                label="Telegram group"
                htmlFor="edit-telegram"
                hint="Students see a “Join Telegram group” button on the class page. Clear it to remove the button."
              >
                <Input id="edit-telegram" value={editForm.telegramUrl}
                  onChange={(e) => setEditForm({ ...editForm, telegramUrl: e.target.value })}
                  placeholder="https://t.me/joinchat/…" />
              </Field>
              <Field
                label="Telegram chat id"
                htmlFor="edit-telegram-chat"
                hint="Set this and the bot manages the group: single-use invites per student, and a frozen account taken out automatically. Add the bot as an administrator (invite + ban rights), then send /chatid in the group to read the id. Clear it to go back to a plain link."
              >
                <Input id="edit-telegram-chat" value={editForm.telegramChatId}
                  onChange={(e) => setEditForm({ ...editForm, telegramChatId: e.target.value })}
                  placeholder="-1001234567890" />
              </Field>
              <Checkbox
                id="edit-active"
                label="Active"
                checked={editForm.is_active}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
              />
              <p className="text-[12px] text-muted-foreground">
                An inactive class is archived: it stops appearing to its students, and nothing
                about it is deleted.
              </p>
            </div>
          </Modal>
        );
      })()}

      {supportModal && (() => {
        // Only offer support teachers who cover the class's subject. The server refuses a
        // mismatch anyway, but a picker that lists impossible choices invites the mistake.
        // `coversSubject`, never a `===` on the raw field — see its comment: "both" is what
        // every support teacher here is set to, and `===` hid all of them.
        const classDomain = classDomainOf(supportModal.row.subject);
        const assignedIds = new Set(supportAssigned.map((s) => s.user_id));
        const candidates = supportOpts.filter(
          (o) => !assignedIds.has(o.id) && coversSubject(o.subject, classDomain),
        );
        return (
          <Modal
            open
            onClose={() => setSupportModal(null)}
            title={`Support teachers — ${supportModal.row.name}`}
            description="Students book these staff for help outside the lesson. They join as teaching assistants — the classroom keeps its own teacher."
            footer={<Button variant="secondary" onClick={() => setSupportModal(null)}>Done</Button>}
          >
            {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

            <Field
              label="Assign a support teacher"
              htmlFor="support-pick"
              // "None left to add" and "none exist" are different problems with different
              // fixes, and the old copy gave the second answer to both — telling an admin to
              // create an account when every support teacher was already assigned.
              hint={candidates.length > 0
                ? undefined
                : supportOpts.some((o) => coversSubject(o.subject, classDomain))
                  ? `Every ${classDomain} support teacher is already assigned to this class.`
                  : `No support teacher covers ${classDomain}. Create one in Users, or set an existing account's subject to ${classDomain} or “both”.`}
            >
              <div className="flex gap-2">
                {/* min-w-0: without it a long option label ("Name (email@…)") sets the
                    select wrapper's min-content width, the flex row overflows the modal, and
                    the Assign button is pushed off the right edge. */}
                <div className="min-w-0 flex-1">
                  <Select id="support-pick" value={pickSupport} onChange={(e) => setPickSupport(e.target.value)}>
                    <option value="">— Choose —</option>
                    {candidates.map((o) => <option key={o.id} value={String(o.id)}>{o.name} ({o.email})</option>)}
                  </Select>
                </div>
                <Button className="shrink-0" loading={busy} disabled={!pickSupport} onClick={addSupport} leftIcon={<UserPlus />}>Assign</Button>
              </div>
            </Field>

            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <p className="ds-overline">Assigned</p>
                {supportLoading ? (
                  <Skeleton variant="text" className="w-5" />
                ) : supportFailed ? null : (
                  <span className="ds-num text-xs font-semibold text-muted-foreground">{supportAssigned.length}</span>
                )}
              </div>
              {supportLoading ? (
                <div className="flex justify-center p-6"><Spinner className="h-6 w-6 text-primary" label="Loading support teachers" /></div>
              ) : supportFailed ? (
                // The failure is already named by the Alert at the top of this modal. What must
                // NOT happen here is "No support teachers yet" — the class may be fully staffed.
                <Button size="sm" variant="secondary" onClick={() => openSupport(supportModal.row)} leftIcon={<RefreshCw aria-hidden />}>
                  Try again
                </Button>
              ) : supportAssigned.length === 0 ? (
                <EmptyState compact icon={LifeBuoy} title="No support teachers yet" description="Assign one above and they’ll appear here." />
              ) : (
                <div className="rounded-xl border border-border divide-y divide-border">
                  {supportAssigned.map((s) => (
                    <div key={s.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={s.name} size={32} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                          {/* An assignment that exists here and does nothing for students is
                              the worst of both worlds — it looks done. `is_bookable === false`
                              means the membership is right but the ACCOUNT is not a support
                              teacher, which the roster's "Make TA" button allows. */}
                          {s.is_bookable === false ? (
                            <p className="mt-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                              Students can&apos;t book them — this account isn&apos;t a support
                              teacher. Change their role in Users.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0" disabled={busy}
                        onClick={() => dropSupport(s.user_id, s.name)}
                        leftIcon={<UserMinus className="text-danger" />}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Modal>
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
          <Modal
            open
            onClose={() => setRoster(null)}
            title={`Students — ${roster.row.name}`}
            description="Add a student without a class code, or remove one. Removal is reversible."
            footer={<Button variant="secondary" onClick={() => setRoster(null)}>Done</Button>}
          >
            {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

            {/* Add student */}
            <Field label="Add a student" htmlFor="roster-search">
              <Input id="roster-search" type="search" leftIcon={<Search />} value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search students by name or email…" />
            </Field>
            {studentSearch.trim().length > 0 && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {candidates.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">No students match that search. Try another name or email.</p>
                ) : candidates.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar src={s.avatar} name={s.name} size={32} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0" disabled={busy} onClick={() => addStudent(s.id)} leftIcon={<UserPlus />}>Add</Button>
                  </div>
                ))}
              </div>
            )}

            {/* Current roster */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <p className="ds-overline">Enrolled students</p>
                {rosterLoading ? (
                  <Skeleton variant="text" className="w-5" />
                ) : rosterFailed ? null : (
                  <span className="ds-num text-xs font-semibold text-muted-foreground">{activeStudents.length}</span>
                )}
              </div>
              {rosterLoading ? (
                <div className="flex justify-center p-6"><Spinner className="h-6 w-6 text-primary" label="Loading the roster" /></div>
              ) : rosterFailed ? (
                // Same rule as the support list: a failed roster must not read as "No students yet",
                // which would invite an admin to re-add students who are already enrolled.
                <Button size="sm" variant="secondary" onClick={() => openRoster(roster.row)} leftIcon={<RefreshCw aria-hidden />}>
                  Try again
                </Button>
              ) : activeStudents.length === 0 ? (
                <EmptyState compact icon={Users} title="No students yet" description="Add one above, or share the class code and they’ll appear here." />
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
                      <Button size="sm" variant="ghost" className="shrink-0" disabled={busy}
                        onClick={() => removeStudent(m.user.id, memberName(m))}
                        leftIcon={<UserMinus className="text-danger" />}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
