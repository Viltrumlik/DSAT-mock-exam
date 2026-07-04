"use client";

import { useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import {
  buildHomeworkPastpaperCards,
  filterPastpaperCards,
  formatLineDate,
  pastpaperCardYears,
  sharedPastpaperPackTitle,
  singleDisplayTitle,
  subjectLabel,
  type CardPastpaperPack,
  type CardSingle,
} from "@/lib/practiceTestCards";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import {
  ClassroomAlert,
  ClassroomButton,
  ClassroomField,
  crInputClass,
} from "@/components/classroom";
import { SegmentedControl } from "@/components/SegmentedControl";
import { materialMeta } from "@/features/classroom/pages/materialMeta";
import { spawnRipple } from "@/features/classroom/ui/ripple";
import { formatApiErrorForToast } from "@/lib/apiError";
import { ArrowLeft, BookOpen, ClipboardList, FileText, FlaskConical, Loader2, Paperclip, Search, X } from "lucide-react";

type PastpaperRow = Record<string, unknown> & {
  id: number;
  collection_name?: string;
};

type AssessmentSetOption = {
  id: number;
  title: string;
  subject: string;
  source?: string;
  category: string;
  description: string;
  question_count: number;
};

type PastSelection =
  | { mode: "none" }
  | { mode: "single"; testId: number }
  | { mode: "pack_legacy"; testIds: number[] };

type PracticeScope = "BOTH" | "ENGLISH" | "MATH";

type PracticeTestPackOption = {
  id: number;
  title: string;
  description: string;
  section_count: number;
};

type AssignmentType = "pastpaper" | "practice_test" | "assessment" | "file_only";

type Props = {
  classId: number;
  editingAssignment?: Record<string, unknown> | null;
  onCancel: () => void;
  onSaved: (assignmentId?: number) => void | Promise<void>;
};

const pad = (n: number) => String(n).padStart(2, "0");

// ─── Deadline dropdown helpers ────────────────────────────────────────────────

/** Next 7 days as { value: "YYYY-MM-DD", label: "Fri, Jul 4" }. */
function next7Days(): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const weekday = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    out.push({ value, label: i === 0 ? `Today · ${weekday}` : weekday });
  }
  return out;
}

function time12(h: number, m: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${pad(m)} ${ampm}`;
}

/** 30-minute increments plus an explicit end-of-day option. */
function timeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) out.push({ value: `${pad(h)}:${pad(m)}`, label: time12(h, m) });
  }
  out.push({ value: "23:59", label: "11:59 PM (end of day)" });
  return out;
}

const DEFAULT_DUE_TIME = "23:59";

function cardReactKey(c: CardPastpaperPack | CardSingle): string {
  if (c.kind === "single") return `single-${c.test.id}`;
  return `pack-${c.packKey}`;
}

function selectionMatchesCard(sel: PastSelection, c: CardPastpaperPack | CardSingle): boolean {
  if (c.kind === "single") return sel.mode === "single" && sel.testId === c.test.id;
  const ids = c.tests.map((t) => t.id).sort((a, b) => a - b);
  if (sel.mode !== "pack_legacy" || ids.length === 0) return false;
  const a = [...sel.testIds].sort((x, y) => x - y);
  return a.length === ids.length && a.every((v, i) => v === ids[i]);
}

function selectFromCard(c: CardPastpaperPack | CardSingle): PastSelection {
  if (c.kind === "single") return { mode: "single", testId: c.test.id };
  return { mode: "pack_legacy", testIds: c.tests.map((t) => t.id) };
}

/** Attachment objects on an assignment (backend returns {url,file_name,...}). */
type AttachmentObj = { url: string; file_name?: string; content_type?: string; size?: number | null };
function readAttachments(a: Record<string, unknown> | null | undefined): AttachmentObj[] {
  const raw = a?.attachment_urls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): AttachmentObj | null => {
      if (x && typeof x === "object" && "url" in x) return x as AttachmentObj;
      if (typeof x === "string") return { url: x, file_name: decodeURIComponent(x.split("/").pop() || "") };
      return null;
    })
    .filter((x): x is AttachmentObj => x != null);
}

export default function AssignmentForm({ classId, editingAssignment = null, onCancel, onSaved }: Props) {
  const isEditing = editingAssignment != null;

  const [assignmentType, setAssignmentType] = useState<AssignmentType>("pastpaper");
  const [includePastpaper, setIncludePastpaper] = useState(false);
  const [includePracticeTest, setIncludePracticeTest] = useState(false);
  const [includeAssessment, setIncludeAssessment] = useState(false);
  const [newAsg, setNewAsg] = useState({ title: "", instructions: "", external_url: "" });
  const [pastSel, setPastSel] = useState<PastSelection>({ mode: "none" });
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | null>(null);
  const [selectedPracticeTestPackId, setSelectedPracticeTestPackId] = useState<number | null>(null);
  // Deadline is composed from two dropdowns (no calendar): a date (next 7 days) + a time.
  const [dueDate, setDueDate] = useState(""); // "" = no deadline
  const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME);
  const [asgFiles, setAsgFiles] = useState<File[]>([]);
  const [replaceAttachments, setReplaceAttachments] = useState(false);
  const [editAsgFiles, setEditAsgFiles] = useState<File[]>([]);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>("BOTH");
  const [classroomSubject, setClassroomSubject] = useState<string>("");

  // Picker filters (Reqs 5, 8): search + region/year for pastpapers, search for
  // practice packs, search + source for assessments.
  const [pastpaperSearch, setPastpaperSearch] = useState("");
  const [pastpaperRegion, setPastpaperRegion] = useState<"ALL" | "US" | "INTL">("ALL");
  const [pastpaperYear, setPastpaperYear] = useState("ALL");
  const [packSearch, setPackSearch] = useState("");
  const [assessmentSearch, setAssessmentSearch] = useState("");
  const [assessmentSource, setAssessmentSource] = useState("ALL");

  const [assignmentOptions, setAssignmentOptions] = useState<{
    practice_tests: PastpaperRow[];
    assessment_sets: AssessmentSetOption[];
    practice_test_packs: PracticeTestPackOption[];
  }>({ practice_tests: [], assessment_sets: [], practice_test_packs: [] });
  const [asgOptionsLoading, setAsgOptionsLoading] = useState(false);
  const [asgOptionsError, setAsgOptionsError] = useState<string | null>(null);
  const [creatingAsg, setCreatingAsg] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const domainSubject = classroomSubject === "MATH" ? "math" : classroomSubject === "ENGLISH" ? "english" : "";
  const allowedSources = useMemo(() => allowedSourcesForSubject(domainSubject), [domainSubject]);
  // The class is a single subject → the scope is implied; hide the Both/Eng/Math selector.
  const subjectLocked = classroomSubject === "MATH" || classroomSubject === "ENGLISH";

  const pastpaperCards = useMemo(
    () => buildHomeworkPastpaperCards(assignmentOptions.practice_tests as any[]),
    [assignmentOptions.practice_tests]
  );
  const pastpaperYears = useMemo(() => pastpaperCardYears(pastpaperCards), [pastpaperCards]);
  const filteredPastpaperCards = useMemo(
    () => filterPastpaperCards(pastpaperCards, { region: pastpaperRegion, year: pastpaperYear, search: pastpaperSearch }),
    [pastpaperCards, pastpaperRegion, pastpaperYear, pastpaperSearch]
  );

  const filteredPacks = useMemo(() => {
    const q = packSearch.trim().toLowerCase();
    if (!q) return assignmentOptions.practice_test_packs;
    return assignmentOptions.practice_test_packs.filter(
      (p) => `${p.title} ${p.description}`.toLowerCase().includes(q)
    );
  }, [assignmentOptions.practice_test_packs, packSearch]);

  const filteredAssessmentSets = useMemo(() => {
    const q = assessmentSearch.trim().toLowerCase();
    return assignmentOptions.assessment_sets.filter((a) => {
      if (assessmentSource !== "ALL" && (a.source || "") !== assessmentSource) return false;
      if (q && !`${a.title} ${a.category} ${a.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assignmentOptions.assessment_sets, assessmentSearch, assessmentSource]);

  const dateOptions = useMemo(() => {
    const opts = next7Days();
    // Editing an assignment whose due date is outside the next-7-day window: keep it
    // selectable so the existing deadline isn't silently dropped.
    if (dueDate && !opts.some((o) => o.value === dueDate)) {
      const d = new Date(`${dueDate}T00:00`);
      const label = Number.isNaN(d.getTime())
        ? dueDate
        : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      opts.unshift({ value: dueDate, label: `${label} (set)` });
    }
    return opts;
  }, [dueDate]);
  const timeOpts = useMemo(() => {
    const opts = timeOptions();
    if (dueTime && !opts.some((o) => o.value === dueTime)) opts.push({ value: dueTime, label: time12(...dueTime.split(":").map(Number) as [number, number]) });
    return opts;
  }, [dueTime]);

  const resetForm = () => {
    setAssignmentType("pastpaper");
    setIncludePastpaper(false);
    setIncludePracticeTest(false);
    setIncludeAssessment(false);
    setNewAsg({ title: "", instructions: "", external_url: "" });
    setPastSel({ mode: "none" });
    setSelectedAssessmentId(null);
    setSelectedPracticeTestPackId(null);
    setDueDate("");
    setDueTime(DEFAULT_DUE_TIME);
    setAsgFiles([]);
    setReplaceAttachments(false);
    setEditAsgFiles([]);
    setFormError(null);
  };

  // Load resource options (already class-subject filtered by the backend).
  useEffect(() => {
    if (!Number.isFinite(classId)) return;
    let cancelled = false;
    (async () => {
      setAsgOptionsLoading(true);
      setAsgOptionsError(null);
      try {
        const d = await classesApi.getAssignmentOptions(classId);
        if (!cancelled) {
          setAssignmentOptions({
            practice_tests: Array.isArray(d.practice_tests) ? d.practice_tests : [],
            assessment_sets: Array.isArray(d.assessment_sets) ? d.assessment_sets : [],
            practice_test_packs: Array.isArray(d.practice_test_packs) ? d.practice_test_packs : [],
          });
          const subj = typeof d.classroom_subject === "string" ? d.classroom_subject : "";
          setClassroomSubject(subj);
        }
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (!cancelled) {
          setAssignmentOptions({ practice_tests: [], assessment_sets: [], practice_test_packs: [] });
          setAsgOptionsError(typeof msg === "string" ? msg : "Could not load test lists.");
        }
      } finally {
        if (!cancelled) setAsgOptionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  // Auto-set the section scope from the class subject (Req 6); selector stays hidden.
  useEffect(() => {
    if (classroomSubject === "MATH") setPracticeScope("MATH");
    else if (classroomSubject === "ENGLISH") setPracticeScope("ENGLISH");
  }, [classroomSubject]);

  // Prefill from the assignment being edited.
  useEffect(() => {
    if (!editingAssignment) { resetForm(); return; }
    const instrValue = String(editingAssignment.instructions ?? "");
    setNewAsg({
      title: String(editingAssignment.title ?? ""),
      instructions: instrValue,
      external_url: String(editingAssignment.external_url ?? ""),
    });
    const due = editingAssignment.due_at;
    if (due && typeof due === "string") {
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) {
        setDueDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
        setDueTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      } else { setDueDate(""); setDueTime(DEFAULT_DUE_TIME); }
    } else { setDueDate(""); setDueTime(DEFAULT_DUE_TIME); }

    const ah = editingAssignment.assessment_homework;
    if (ah && typeof ah === "object" && "set" in (ah as Record<string, unknown>)) {
      setAssignmentType("assessment");
      const set = (ah as { set?: { id?: number } }).set;
      setSelectedAssessmentId(set?.id ?? null);
    } else {
      const ptp = editingAssignment.practice_test_pack;
      if (ptp != null) {
        setAssignmentType("practice_test");
        const ptpId = typeof ptp === "object" && ptp != null && "id" in ptp ? Number((ptp as { id: number }).id) : Number(ptp);
        if (Number.isFinite(ptpId)) setSelectedPracticeTestPackId(ptpId);
      } else if (Array.isArray(editingAssignment.practice_test_ids) && editingAssignment.practice_test_ids.length > 0) {
        setAssignmentType("pastpaper");
        setPastSel({ mode: "pack_legacy", testIds: (editingAssignment.practice_test_ids as unknown[]).map((x) => Number(x)) });
      } else if (editingAssignment.practice_test != null) {
        setAssignmentType("pastpaper");
        const pt = editingAssignment.practice_test;
        const tid = typeof pt === "object" && pt != null && "id" in pt ? Number((pt as { id: number }).id) : Number(pt);
        if (Number.isFinite(tid)) setPastSel({ mode: "single", testId: tid });
        else setPastSel({ mode: "none" });
      } else {
        setAssignmentType("file_only");
        setPastSel({ mode: "none" });
      }
    }
    const ps = editingAssignment.practice_scope;
    if (ps === "ENGLISH" || ps === "MATH" || ps === "BOTH") setPracticeScope(ps);
    setAsgFiles([]);
    setReplaceAttachments(false);
    setEditAsgFiles([]);
    setFormError(null);
  }, [editingAssignment]);

  const buildDueIso = (): string | null => {
    if (!dueDate) return null;
    const t = new Date(`${dueDate}T${dueTime || DEFAULT_DUE_TIME}`);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  };

  const handleSubmit = async (publishStatus: "DRAFT" | "PUBLISHED" = "PUBLISHED") => {
    setFormError(null);
    setCreatingAsg(true);
    try {
      const dueIso = buildDueIso();
      const editId = editingAssignment != null ? Number(editingAssignment.id) : NaN;
      if (Number.isFinite(editId)) {
        const body: Record<string, unknown> = {
          title: newAsg.title.trim(),
          instructions: newAsg.instructions,
          external_url: newAsg.external_url.trim() || "",
          due_at: dueIso,
          practice_test_pack: null,
          practice_test: null,
          practice_test_ids: null,
        };
        if (assignmentType === "pastpaper") {
          if (pastSel.mode === "pack_legacy") body.practice_test_ids = pastSel.testIds;
          else if (pastSel.mode === "single") body.practice_test = pastSel.testId;
        } else if (assignmentType === "practice_test" && selectedPracticeTestPackId) {
          body.practice_test_pack = selectedPracticeTestPackId;
        }
        body.practice_scope = practiceScope;

        await classesApi.updateAssignment(classId, editId, body);
        if (replaceAttachments || editAsgFiles.length > 0) {
          const fd = new FormData();
          for (const f of editAsgFiles) fd.append("attachment_file", f);
          await classesApi.updateAssignment(classId, editId, fd, true, { replaceAttachments });
        }
        await onSaved(editId);
        return;
      }

      const fd = new FormData();
      fd.append("title", newAsg.title.trim());
      fd.append("instructions", newAsg.instructions);
      if (dueIso) fd.append("due_at", dueIso);
      if (newAsg.external_url.trim()) fd.append("external_url", newAsg.external_url.trim());

      if (includePastpaper && pastSel.mode !== "none") {
        if (pastSel.mode === "pack_legacy") fd.append("practice_test_ids", JSON.stringify(pastSel.testIds));
        else if (pastSel.mode === "single") fd.append("practice_test", String(pastSel.testId));
        fd.append("practice_scope", practiceScope);
      }
      if (includePracticeTest && selectedPracticeTestPackId) {
        fd.append("practice_test_pack", String(selectedPracticeTestPackId));
        fd.append("practice_scope", practiceScope);
      }
      if (includeAssessment && selectedAssessmentId) {
        fd.append("assessment_set_id", String(selectedAssessmentId));
      }
      for (const f of asgFiles) fd.append("attachment_file", f);

      fd.append("status", publishStatus);
      const created = await classesApi.createAssignment(classId, fd, true);
      const createdId = created && typeof created === "object" && "id" in created ? Number((created as { id: number }).id) : undefined;
      await onSaved(Number.isFinite(createdId) ? createdId : undefined);
    } catch (e: unknown) {
      // Surface the backend message (e.g. "File type not allowed (.jar). Allowed: …")
      // or any DRF field error, instead of a blank generic failure.
      setFormError(formatApiErrorForToast(e));
    } finally {
      setCreatingAsg(false);
    }
  };

  const cardBase = "cr-press text-left rounded-xl border px-4 py-3 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/90 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const cardUnsel = "border-border bg-card hover:border-primary/35 hover:bg-surface-2";
  const cardSel = "border-primary bg-primary/10 ring-2 ring-primary/25 shadow-sm";

  const handleCardSelect = (c: CardPastpaperPack | CardSingle) => {
    setPastSel(selectFromCard(c));
    if (!newAsg.title.trim()) {
      const heading = c.kind === "pastpaper_pack"
        ? (c.pack?.title && String(c.pack.title).trim()) || sharedPastpaperPackTitle(c.tests)
        : singleDisplayTitle(c.test);
      if (heading) setNewAsg((prev) => ({ ...prev, title: heading }));
    }
  };

  const handleAssessmentSelect = (aset: AssessmentSetOption) => {
    setSelectedAssessmentId(aset.id);
    if (!newAsg.title.trim()) setNewAsg((prev) => ({ ...prev, title: aset.title }));
  };

  const removeFile = (idx: number) => setAsgFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeEditFile = (idx: number) => setEditAsgFiles((prev) => prev.filter((_, i) => i !== idx));

  const submitDisabled = !newAsg.title.trim() || !newAsg.instructions.trim() || creatingAsg || (includeAssessment && !selectedAssessmentId);
  const existingAttachments = readAttachments(editingAssignment);
  const searchInputCls = `${crInputClass} pl-9`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <button type="button" onClick={onCancel} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="ds-section-title text-muted-foreground">{isEditing ? "Edit assignment" : "New assignment"}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">{isEditing ? "Update homework" : "Create assignment"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose content, add instructions, set a due date, and attach files.</p>
      </div>

      <div className="cr-section space-y-6">
        {formError ? <ClassroomAlert tone="error">{formError}</ClassroomAlert> : null}
        {asgOptionsLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading options…
          </div>
        ) : null}
        {asgOptionsError ? <ClassroomAlert tone="warning">{asgOptionsError}</ClassroomAlert> : null}

        {/* Content types (multi-select) */}
        {!isEditing && (
          <section className="cr-pop rounded-2xl border border-border bg-surface-2/40 p-4">
            <p className="ds-section-title mb-1 text-muted-foreground">Content</p>
            <p className="ds-caption mb-3 text-muted-foreground">Bundle one or more — students get a launcher for each.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { key: "pastpaper" as const, icon: BookOpen, label: "Pastpaper", desc: "Official SAT test" },
                { key: "practice_test" as const, icon: FlaskConical, label: "Practice Test", desc: "Custom practice" },
                { key: "assessment" as const, icon: ClipboardList, label: "Assessment", desc: "Classroom quiz/test" },
                { key: "file_only" as const, icon: FileText, label: "File / Link", desc: "Custom homework" },
              ]).map(({ key, icon: Icon, label, desc }) => {
                const active = key === "pastpaper" ? includePastpaper
                  : key === "practice_test" ? includePracticeTest
                  : key === "assessment" ? includeAssessment
                  : (!includePastpaper && !includePracticeTest && !includeAssessment);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      if (key === "pastpaper") setIncludePastpaper((v) => !v);
                      else if (key === "practice_test") setIncludePracticeTest((v) => !v);
                      else if (key === "assessment") setIncludeAssessment((v) => !v);
                      else {
                        setIncludePastpaper(false); setIncludePracticeTest(false); setIncludeAssessment(false);
                        setPastSel({ mode: "none" }); setSelectedAssessmentId(null); setSelectedPracticeTestPackId(null);
                      }
                    }}
                    className={`${cardBase} ${active ? cardSel : cardUnsel}`}
                  >
                    <Icon className={`mb-1 h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <p className="text-sm font-bold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Details: title / instructions / due date */}
        <section className="cr-pop space-y-5 rounded-2xl border border-border bg-card p-4">
          <p className="ds-section-title text-muted-foreground">Details</p>

          <ClassroomField label="Title *" htmlFor="asg-title">
            <input
              id="asg-title"
              value={newAsg.title}
              onChange={(e) => setNewAsg((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. May SAT Reading practice"
              className={`${crInputClass} font-semibold`}
            />
          </ClassroomField>

          {/* Instructions — always shown, required (Req 2) */}
          <ClassroomField label="Instructions *" htmlFor="asg-inst" hint="Tell students exactly what to do.">
            <textarea
              id="asg-inst"
              value={newAsg.instructions}
              onChange={(e) => setNewAsg((p) => ({ ...p, instructions: e.target.value }))}
              placeholder="Short directions for students"
              rows={3}
              className={crInputClass}
            />
          </ClassroomField>

          {/* Due date — dropdowns, no calendar (Reqs 3, 4) */}
          <ClassroomField label="Due date & time" hint="Pick a day within the next week, or leave as no deadline.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                aria-label="Due date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={crInputClass}
              >
                <option value="">No deadline</option>
                {dateOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                aria-label="Due time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueDate}
                className={`${crInputClass} disabled:opacity-50`}
              >
                {timeOpts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </ClassroomField>
        </section>

        {/* Pastpaper picker — search + region/year filters */}
        {(isEditing ? assignmentType === "pastpaper" : includePastpaper) && (
          <section className="cr-pop space-y-4 rounded-2xl border border-border bg-card p-4">
            <p className="ds-section-title text-muted-foreground">Pastpaper</p>
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={pastpaperSearch}
                  onChange={(e) => setPastpaperSearch(e.target.value)}
                  placeholder="Search pastpapers…"
                  className={searchInputCls}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <SegmentedControl
                  label="Region"
                  value={pastpaperRegion}
                  onChange={(v) => setPastpaperRegion(v as "ALL" | "US" | "INTL")}
                  options={[{ value: "ALL", label: "All" }, { value: "US", label: "US" }, { value: "INTL", label: "International" }]}
                />
                {pastpaperYears.length > 0 && (
                  <SegmentedControl
                    label="Year"
                    value={pastpaperYear}
                    onChange={setPastpaperYear}
                    options={[{ value: "ALL", label: "All" }, ...pastpaperYears.map((y) => ({ value: y, label: y }))]}
                  />
                )}
              </div>
            </div>

            <ClassroomField label="Pastpaper (full exam card)" hint="Only sections for this class's subject are shown.">
              <div className="grid max-h-[320px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPastSel({ mode: "none" })}
                  className={`${cardBase} ${pastSel.mode === "none" ? cardSel : cardUnsel}`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Pastpaper</p>
                  <p className="mt-1 text-sm font-bold text-foreground">No practice test</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">File/link only homework</p>
                </button>
                {filteredPastpaperCards.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-border bg-surface-2 px-4 py-6 text-center text-sm text-muted-foreground">
                    No pastpapers match these filters.
                  </div>
                ) : filteredPastpaperCards.map((c) => {
                  const selected = selectionMatchesCard(pastSel, c);
                  const lineDate = c.kind === "pastpaper_pack"
                    ? c.pack?.practice_date || c.tests[0]?.practice_date || c.tests[0]?.created_at
                    : c.test.practice_date || c.test.created_at;
                  const heading = c.kind === "pastpaper_pack"
                    ? (c.pack?.title && String(c.pack.title).trim()) || sharedPastpaperPackTitle(c.tests)
                    : singleDisplayTitle(c.test);
                  const sectionRows = c.kind === "pastpaper_pack" ? c.tests : [{ id: c.test.id, subject: c.test.subject }];
                  return (
                    <button
                      key={cardReactKey(c)}
                      type="button"
                      onClick={() => handleCardSelect(c)}
                      className={`${cardBase} ${selected ? cardSel : cardUnsel}`}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Practice test</p>
                      <p className="mt-1 text-xs font-bold text-muted-foreground">{formatLineDate(lineDate)}</p>
                      <p className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-foreground">{heading}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sectionRows.map((t) => (
                          <span key={t.id} className="rounded-md bg-primary/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                            {subjectLabel(t.subject)}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ClassroomField>

            {/* Section scope — only shown when the class isn't subject-locked (Req 6). */}
            {pastSel.mode !== "none" && !subjectLocked && (
              <ClassroomField label="Sections to assign" hint="Students only see the sections you choose.">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {([
                    { value: "BOTH" as const, title: "Both", sub: "R&W and Math" },
                    { value: "ENGLISH" as const, title: "English only", sub: "Reading & Writing" },
                    { value: "MATH" as const, title: "Math only", sub: "Math section" },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPracticeScope(opt.value)}
                      className={`${cardBase} text-left ${practiceScope === opt.value ? cardSel : cardUnsel}`}
                    >
                      <p className="text-sm font-bold text-foreground">{opt.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </ClassroomField>
            )}
          </section>
        )}

        {/* Practice test pack picker — search */}
        {(isEditing ? assignmentType === "practice_test" : includePracticeTest) && (
          <section className="cr-pop space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={packSearch} onChange={(e) => setPackSearch(e.target.value)} placeholder="Search practice test packs…" className={searchInputCls} />
            </div>
            <ClassroomField label="Practice test pack" hint="Select a custom practice test to assign.">
              {filteredPacks.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface-2 px-4 py-6 text-center">
                  <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">No practice test packs found</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">Create and publish one in the Builder console first.</p>
                </div>
              ) : (
                <div className="grid max-h-[280px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredPacks.map((ptp) => {
                    const selected = selectedPracticeTestPackId === ptp.id;
                    return (
                      <button
                        key={ptp.id}
                        type="button"
                        onClick={() => {
                          setSelectedPracticeTestPackId(ptp.id);
                          if (!newAsg.title.trim()) setNewAsg((prev) => ({ ...prev, title: ptp.title }));
                        }}
                        className={`${cardBase} ${selected ? cardSel : cardUnsel}`}
                      >
                        <p className="line-clamp-2 text-sm font-bold text-foreground">{ptp.title || `Pack #${ptp.id}`}</p>
                        {ptp.description && <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{ptp.description}</p>}
                        <p className="mt-1 text-[10px] font-semibold text-muted-foreground">{ptp.section_count} section{ptp.section_count !== 1 ? "s" : ""}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </ClassroomField>
          </section>
        )}

        {/* Assessment picker — search + source filter */}
        {(isEditing ? assignmentType === "assessment" : includeAssessment) && (
          <section className="cr-pop space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={assessmentSearch} onChange={(e) => setAssessmentSearch(e.target.value)} placeholder="Search assessments…" className={searchInputCls} />
              </div>
              {allowedSources.length > 0 && (
                <select aria-label="Source" value={assessmentSource} onChange={(e) => setAssessmentSource(e.target.value)} className={`${crInputClass} sm:w-56`}>
                  <option value="ALL">All sources</option>
                  {allowedSources.map((s) => (
                    <option key={s} value={s}>{sourceLabel(s)}</option>
                  ))}
                </select>
              )}
            </div>
            <ClassroomField label="Assessment set" hint="Select a quiz/test to assign to students.">
              {filteredAssessmentSets.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface-2 px-4 py-6 text-center">
                  <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">No assessment sets found</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">Try clearing filters, or create one in the Builder console.</p>
                </div>
              ) : (
                <div className="grid max-h-[280px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredAssessmentSets.map((aset) => {
                    const selected = selectedAssessmentId === aset.id;
                    return (
                      <button
                        key={aset.id}
                        type="button"
                        onClick={() => handleAssessmentSelect(aset)}
                        className={`${cardBase} ${selected ? cardSel : cardUnsel}`}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                            aset.subject === "math" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          }`}>{aset.subject}</span>
                          {aset.source && (
                            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{sourceLabel(aset.source)}</span>
                          )}
                          {aset.category && (
                            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{aset.category}</span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm font-bold text-foreground">{aset.title}</p>
                        <p className="mt-1 text-[10px] font-semibold text-muted-foreground">{aset.question_count} questions</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </ClassroomField>
          </section>
        )}

        {/* Resources: external link + attachments */}
        <section className="cr-pop space-y-5 rounded-2xl border border-border bg-card p-4">
          <p className="ds-section-title text-muted-foreground">Resources</p>

          {(isEditing ? (assignmentType === "file_only" || assignmentType === "pastpaper") : true) && (
            <ClassroomField label="External link (optional)" htmlFor="asg-url">
              <input
                id="asg-url"
                value={newAsg.external_url}
                onChange={(e) => setNewAsg((p) => ({ ...p, external_url: e.target.value }))}
                placeholder="https://…"
                className={crInputClass}
              />
            </ClassroomField>
          )}

          <ClassroomField label={isEditing ? "Teacher attachments" : "Files (optional)"} hint="PDF, Word, Excel, PowerPoint, text, or images. Students can download them.">
            {isEditing ? (
              <div className="space-y-3">
                {existingAttachments.length > 0 ? (
                  <div className="space-y-1">
                    {existingAttachments.map((f, i) => {
                      const meta = materialMeta(f.file_name || f.url);
                      const Icon = meta.Icon;
                      return (
                        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                          className="cr-press flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-2">
                          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${meta.iconWrap}`}><Icon className="h-3.5 w-3.5" /></span>
                          <span className="truncate">{f.file_name || "Attachment"}</span>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">No files on this assignment yet.</p>
                )}
                <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                  <input type="checkbox" className="mt-0.5 rounded border-border text-primary focus:ring-primary" checked={replaceAttachments} onChange={(e) => setReplaceAttachments(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Replace all existing attachments</span>
                    <span className="block text-xs font-normal text-muted-foreground">Check this before uploading to replace current files.</span>
                  </span>
                </label>
                <input id="asg-files-edit" name="attachment_file" type="file" multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => setEditAsgFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                  className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/15"
                />
                {editAsgFiles.length > 0 && (
                  <div className="space-y-1">
                    {editAsgFiles.map((f, i) => (
                      <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                        <button type="button" onClick={() => removeEditFile(i)} className="text-muted-foreground hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <input id="asg-files" name="attachment_file" type="file" multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files || []);
                    setAsgFiles((prev) => {
                      const combined = [...prev, ...incoming];
                      if (combined.length > 10) { setFormError("Maximum 10 files allowed."); return prev; }
                      setFormError(null);
                      return combined;
                    });
                    e.target.value = "";
                  }}
                  className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/15"
                />
                {asgFiles.length > 0 && <p className="mt-1 text-[10px] font-semibold text-muted-foreground">{asgFiles.length}/10 files</p>}
                {asgFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {asgFiles.map((f, i) => (
                      <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </ClassroomField>
        </section>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row">
          <ClassroomButton type="button" variant="secondary" className="flex-1" onClick={onCancel}>Cancel</ClassroomButton>
          {!isEditing && (
            <ClassroomButton type="button" variant="secondary" className="cr-press cr-ripple flex-1" onPointerDown={spawnRipple} onClick={() => handleSubmit("DRAFT")} disabled={submitDisabled}>
              Save as draft
            </ClassroomButton>
          )}
          <ClassroomButton type="button" variant="primary" className="cr-press cr-ripple flex-1" onPointerDown={spawnRipple} onClick={() => handleSubmit("PUBLISHED")} disabled={submitDisabled}>
            {creatingAsg ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEditing ? "Save changes" : "Publish"}
          </ClassroomButton>
        </div>
      </div>
    </div>
  );
}
