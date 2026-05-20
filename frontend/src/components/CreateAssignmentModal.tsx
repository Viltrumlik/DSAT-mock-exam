"use client";

import { useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import {
  buildHomeworkPastpaperCards,
  formatLineDate,
  sharedPastpaperPackTitle,
  singleDisplayTitle,
  subjectLabel,
  type CardPastpaperPack,
  type CardSingle,
} from "@/lib/practiceTestCards";
import {
  ClassroomAlert,
  ClassroomButton,
  ClassroomField,
  ClassroomModal,
  crInputClass,
} from "@/components/classroom";
import { BookOpen, ClipboardList, FileText, Loader2, Paperclip, Trash2, X } from "lucide-react";

type PastpaperRow = Record<string, unknown> & {
  id: number;
  pastpaper_pack?: { id: number; title?: string; practice_date?: string | null; label?: string; form_type?: string } | null;
  pastpaper_pack_id?: number | null;
};

type AssessmentSetOption = {
  id: number;
  title: string;
  subject: string;
  category: string;
  description: string;
  question_count: number;
};

type PastSelection =
  | { mode: "none" }
  | { mode: "single"; testId: number }
  | { mode: "pack_db"; packId: number }
  | { mode: "pack_legacy"; testIds: number[] };

type PracticeScope = "BOTH" | "ENGLISH" | "MATH";

type AssignmentType = "pastpaper" | "assessment" | "file_only";

type Props = {
  open: boolean;
  classId: number;
  editingAssignment?: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
};

// ─── Due-date preset helpers ──────────────────────────────────────────────────

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextWeekdayDate(targetDay: number, hour = 23, minute = 59): string {
  const now = new Date();
  const d = new Date(now);
  const today = now.getDay();
  let daysAhead = targetDay - today;
  if (daysAhead <= 0) daysAhead += 7;
  d.setDate(now.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return toLocalDatetimeValue(d);
}

function dueDatePresets(): { label: string; value: string }[] {
  const now = new Date();
  const tonight = new Date(now); tonight.setHours(23, 59, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(23, 59, 0, 0);
  const nextSundayVal = nextWeekdayDate(0, 23, 59);
  const nextSaturdayVal = nextWeekdayDate(6, 23, 59);
  const inSevenDays = new Date(now); inSevenDays.setDate(now.getDate() + 7); inSevenDays.setHours(23, 59, 0, 0);

  const presets = [
    { label: "Tonight", value: toLocalDatetimeValue(tonight) },
    { label: "Tomorrow", value: toLocalDatetimeValue(tomorrow) },
    { label: "This Sun", value: nextSundayVal },
    { label: "This Sat", value: nextSaturdayVal },
    { label: "+7 days", value: toLocalDatetimeValue(inSevenDays) },
  ];
  const seen = new Set<string>();
  return presets.filter((p) => { if (seen.has(p.value)) return false; seen.add(p.value); return true; });
}

function cardReactKey(c: CardPastpaperPack | CardSingle): string {
  if (c.kind === "single") return `single-${c.test.id}`;
  return `pack-${c.packKey}`;
}

function selectionMatchesCard(sel: PastSelection, c: CardPastpaperPack | CardSingle): boolean {
  if (c.kind === "single") return sel.mode === "single" && sel.testId === c.test.id;
  if (c.pack?.id != null) return sel.mode === "pack_db" && sel.packId === c.pack.id;
  const ids = c.tests.map((t) => t.id).sort((a, b) => a - b);
  if (sel.mode !== "pack_legacy" || ids.length === 0) return false;
  const a = [...sel.testIds].sort((x, y) => x - y);
  return a.length === ids.length && a.every((v, i) => v === ids[i]);
}

function selectFromCard(c: CardPastpaperPack | CardSingle): PastSelection {
  if (c.kind === "single") return { mode: "single", testId: c.test.id };
  if (c.pack?.id != null) return { mode: "pack_db", packId: c.pack.id };
  return { mode: "pack_legacy", testIds: c.tests.map((t) => t.id) };
}

export default function CreateAssignmentModal({
  open,
  classId,
  editingAssignment = null,
  onClose,
  onSuccess,
}: Props) {
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("pastpaper");
  const [newAsg, setNewAsg] = useState({ title: "", instructions: "", external_url: "" });
  const [pastSel, setPastSel] = useState<PastSelection>({ mode: "none" });
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | null>(null);
  const [dueLocal, setDueLocal] = useState("");
  const [asgFiles, setAsgFiles] = useState<File[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);
  const [replaceAttachments, setReplaceAttachments] = useState(false);
  const [editAsgFiles, setEditAsgFiles] = useState<File[]>([]);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>("BOTH");
  const [assignmentOptions, setAssignmentOptions] = useState<{
    practice_tests: PastpaperRow[];
    assessment_sets: AssessmentSetOption[];
  }>({ practice_tests: [], assessment_sets: [] });
  const [asgOptionsLoading, setAsgOptionsLoading] = useState(false);
  const [asgOptionsError, setAsgOptionsError] = useState<string | null>(null);
  const [creatingAsg, setCreatingAsg] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const pastpaperCards = useMemo(
    () => buildHomeworkPastpaperCards(assignmentOptions.practice_tests as any[]),
    [assignmentOptions.practice_tests]
  );

  const resetForm = () => {
    setAssignmentType("pastpaper");
    setNewAsg({ title: "", instructions: "", external_url: "" });
    setPastSel({ mode: "none" });
    setSelectedAssessmentId(null);
    setDueLocal("");
    setAsgFiles([]);
    setShowInstructions(false);
    setReplaceAttachments(false);
    setEditAsgFiles([]);
    setPracticeScope("BOTH");
    setFormError(null);
  };

  useEffect(() => {
    if (!open || !Number.isFinite(classId)) return;
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
          });
        }
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (!cancelled) {
          setAssignmentOptions({ practice_tests: [], assessment_sets: [] });
          setAsgOptionsError(typeof msg === "string" ? msg : "Could not load test lists.");
        }
      } finally {
        if (!cancelled) setAsgOptionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, classId]);

  useEffect(() => {
    if (!open) return;
    if (!editingAssignment) { resetForm(); return; }
    const instrValue = String(editingAssignment.instructions ?? "");
    setNewAsg({
      title: String(editingAssignment.title ?? ""),
      instructions: instrValue,
      external_url: String(editingAssignment.external_url ?? ""),
    });
    if (instrValue.trim()) setShowInstructions(true);
    const due = editingAssignment.due_at;
    if (due && typeof due === "string") {
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        setDueLocal(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
      } else setDueLocal("");
    } else setDueLocal("");

    // Detect assessment homework
    const ah = editingAssignment.assessment_homework;
    if (ah && typeof ah === "object" && "set" in (ah as Record<string, unknown>)) {
      setAssignmentType("assessment");
      const set = (ah as { set?: { id?: number } }).set;
      setSelectedAssessmentId(set?.id ?? null);
    } else {
      const pp = editingAssignment.pastpaper_pack;
      if (pp != null) {
        setAssignmentType("pastpaper");
        const packId = typeof pp === "object" && pp != null && "id" in pp ? Number((pp as { id: number }).id) : Number(pp);
        if (Number.isFinite(packId)) setPastSel({ mode: "pack_db", packId });
        else setPastSel({ mode: "none" });
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
    else setPracticeScope("BOTH");
    setAsgFiles([]);
    setReplaceAttachments(false);
    setEditAsgFiles([]);
    setFormError(null);
  }, [open, editingAssignment]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [open, onClose]);

  const handleSubmit = async () => {
    setFormError(null);
    setCreatingAsg(true);
    try {
      const editId = editingAssignment != null ? Number(editingAssignment.id) : NaN;
      if (Number.isFinite(editId)) {
        const body: Record<string, unknown> = {
          title: newAsg.title.trim(),
          instructions: newAsg.instructions,
          external_url: newAsg.external_url.trim() || "",
          due_at: null as string | null,
          pastpaper_pack: null,
          practice_test: null,
          practice_test_ids: null,
        };
        if (dueLocal.trim()) {
          const t = new Date(dueLocal);
          if (!Number.isNaN(t.getTime())) body.due_at = t.toISOString();
        }
        if (assignmentType === "pastpaper") {
          if (pastSel.mode === "pack_db") body.pastpaper_pack = pastSel.packId;
          else if (pastSel.mode === "pack_legacy") body.practice_test_ids = pastSel.testIds;
          else if (pastSel.mode === "single") body.practice_test = pastSel.testId;
        }
        body.practice_scope = practiceScope;

        await classesApi.updateAssignment(classId, editId, body);
        if (replaceAttachments || editAsgFiles.length > 0) {
          const fd = new FormData();
          for (const f of editAsgFiles) fd.append("attachment_file", f);
          await classesApi.updateAssignment(classId, editId, fd, true, { replaceAttachments });
        }
        resetForm();
        await onSuccess();
        onClose();
        return;
      }

      const fd = new FormData();
      fd.append("title", newAsg.title.trim());
      fd.append("instructions", newAsg.instructions);
      if (dueLocal.trim()) {
        const t = new Date(dueLocal);
        if (!Number.isNaN(t.getTime())) fd.append("due_at", t.toISOString());
      }
      if (newAsg.external_url.trim()) fd.append("external_url", newAsg.external_url.trim());

      if (assignmentType === "pastpaper") {
        if (pastSel.mode === "pack_db") fd.append("pastpaper_pack", String(pastSel.packId));
        else if (pastSel.mode === "pack_legacy") fd.append("practice_test_ids", JSON.stringify(pastSel.testIds));
        else if (pastSel.mode === "single") fd.append("practice_test", String(pastSel.testId));
        fd.append("practice_scope", practiceScope);
      }

      if (assignmentType === "assessment" && selectedAssessmentId) {
        fd.append("assessment_set_id", String(selectedAssessmentId));
      }

      for (const f of asgFiles) {
        fd.append("attachment_file", f);
      }

      await classesApi.createAssignment(classId, fd, true);
      resetForm();
      await onSuccess();
      onClose();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(typeof d === "string" ? d : editingAssignment ? "Could not save assignment." : "Could not create assignment.");
    } finally {
      setCreatingAsg(false);
    }
  };

  const dueDatePresetsData = dueDatePresets();
  const isEditing = editingAssignment != null;

  const cardBase = "text-left rounded-xl border px-4 py-3 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
  const cardUnsel = "border-slate-200/90 bg-white/80 hover:border-indigo-200/60 hover:bg-slate-50/90 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:border-indigo-500/30";
  const cardSel = "border-indigo-400 bg-indigo-50/90 ring-2 ring-indigo-500/25 shadow-sm dark:border-indigo-500 dark:bg-indigo-950/40 dark:ring-indigo-400/20";

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
    if (!newAsg.title.trim()) {
      setNewAsg((prev) => ({ ...prev, title: aset.title }));
    }
  };

  const removeFile = (idx: number) => {
    setAsgFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeEditFile = (idx: number) => {
    setEditAsgFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <ClassroomModal
      open={open}
      onClose={onClose}
      titleId="create-asg-title"
      eyebrow={isEditing ? "Edit assignment" : "New assignment"}
      title={isEditing ? "Update homework" : "Create assignment"}
      description="Choose assignment type, add content, set due date, and attach files."
      size="lg"
    >
      <div className="space-y-5">
        {formError ? <ClassroomAlert tone="error">{formError}</ClassroomAlert> : null}

        {asgOptionsLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            Loading options…
          </div>
        ) : null}
        {asgOptionsError ? <ClassroomAlert tone="warning">{asgOptionsError}</ClassroomAlert> : null}

        {/* ─── Step 1: Assignment Type ─── */}
        {!isEditing && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Assignment type</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { type: "pastpaper" as const, icon: BookOpen, label: "Pastpaper", desc: "Link a practice test" },
                { type: "assessment" as const, icon: ClipboardList, label: "Assessment", desc: "Classroom quiz/test" },
                { type: "file_only" as const, icon: FileText, label: "File / Link", desc: "Custom homework" },
              ]).map(({ type, icon: Icon, label, desc }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setAssignmentType(type);
                    if (type !== "pastpaper") setPastSel({ mode: "none" });
                    if (type !== "assessment") setSelectedAssessmentId(null);
                  }}
                  className={`${cardBase} ${assignmentType === type ? cardSel : cardUnsel}`}
                >
                  <Icon className={`h-4 w-4 mb-1 ${assignmentType === type ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"}`} />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Title ─── */}
        <ClassroomField label="Title *" htmlFor="asg-title">
          <input
            id="asg-title"
            value={newAsg.title}
            onChange={(e) => setNewAsg((p) => ({ ...p, title: e.target.value }))}
            placeholder="e.g. May SAT Reading practice"
            className={`${crInputClass} font-semibold`}
          />
        </ClassroomField>

        {/* ─── Instructions ─── */}
        {showInstructions ? (
          <ClassroomField label="Instructions" htmlFor="asg-inst">
            <textarea
              id="asg-inst"
              autoFocus
              value={newAsg.instructions}
              onChange={(e) => setNewAsg((p) => ({ ...p, instructions: e.target.value }))}
              placeholder="Short directions for students (optional)"
              rows={3}
              className={crInputClass}
            />
          </ClassroomField>
        ) : (
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
          >
            + Add instructions
          </button>
        )}

        {/* ─── Due date ─── */}
        <ClassroomField label="Due date & time" htmlFor="asg-due" hint="Leave empty for no deadline.">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {dueDatePresetsData.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setDueLocal(p.value)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                  dueLocal === p.value
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {p.label}
              </button>
            ))}
            {dueLocal && (
              <button
                type="button"
                onClick={() => setDueLocal("")}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-400 hover:text-red-600 transition-colors dark:border-slate-600 dark:bg-slate-800"
              >
                Clear
              </button>
            )}
          </div>
          <input id="asg-due" type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} className={crInputClass} />
        </ClassroomField>

        {/* ─── Step 2: Content Selection ─── */}
        {assignmentType === "pastpaper" && (
          <>
            <ClassroomField label="Pastpaper (full exam card)" hint="One card can combine R&W and Math.">
              <div className="grid max-h-[320px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPastSel({ mode: "none" })}
                  className={`${cardBase} ${pastSel.mode === "none" ? cardSel : cardUnsel}`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Pastpaper</p>
                  <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">No practice test</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">File/link only homework</p>
                </button>
                {pastpaperCards.map((c) => {
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
                      <p className="mt-1 text-xs font-bold text-slate-400">{formatLineDate(lineDate)}</p>
                      <p className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-slate-900 dark:text-slate-50">{heading}</p>
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

            {pastSel.mode !== "none" && (
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
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{opt.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </ClassroomField>
            )}
          </>
        )}

        {assignmentType === "assessment" && (
          <ClassroomField label="Assessment set" hint="Select a quiz/test to assign to students.">
            {assignmentOptions.assessment_sets.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-800/50">
                <ClipboardList className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">No assessment sets available</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Create one in the Builder console first.</p>
              </div>
            ) : (
              <div className="grid max-h-[280px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {assignmentOptions.assessment_sets.map((aset) => {
                  const selected = selectedAssessmentId === aset.id;
                  return (
                    <button
                      key={aset.id}
                      type="button"
                      onClick={() => handleAssessmentSelect(aset)}
                      className={`${cardBase} ${selected ? cardSel : cardUnsel}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                          aset.subject === "math" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        }`}>
                          {aset.subject}
                        </span>
                        {aset.category && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                            {aset.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2">{aset.title}</p>
                      <p className="mt-1 text-[10px] font-semibold text-slate-400">{aset.question_count} questions</p>
                    </button>
                  );
                })}
              </div>
            )}
          </ClassroomField>
        )}

        {/* ─── External link ─── */}
        {(assignmentType === "file_only" || assignmentType === "pastpaper") && (
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

        {/* ─── Files ─── */}
        <ClassroomField
          label={isEditing ? "Teacher attachments" : "Files (optional)"}
          hint="Select multiple files at once. Files will be available for students to download."
        >
          {isEditing ? (
            <div className="space-y-3">
              <p className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                {Array.isArray(editingAssignment?.attachment_urls) && (editingAssignment?.attachment_urls as string[]).length > 0
                  ? `${(editingAssignment?.attachment_urls as string[]).length} file(s) attached.`
                  : "No files on this assignment yet."}
              </p>
              {/* Show existing file links */}
              {Array.isArray(editingAssignment?.attachment_urls) && (editingAssignment?.attachment_urls as string[]).length > 0 && (
                <div className="space-y-1">
                  {(editingAssignment?.attachment_urls as string[]).map((url, i) => {
                    const name = url.split("/").pop() || `File ${i + 1}`;
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-indigo-400 dark:hover:bg-slate-700"
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate">{decodeURIComponent(name)}</span>
                      </a>
                    );
                  })}
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={replaceAttachments} onChange={(e) => setReplaceAttachments(e.target.checked)} />
                <span>
                  <span className="font-semibold">Replace all existing attachments</span>
                  <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                    Check this before uploading to replace current files.
                  </span>
                </span>
              </label>
              <input id="asg-files-edit" name="attachment_file" type="file" multiple
                onChange={(e) => setEditAsgFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-500/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-500/15 dark:text-slate-400 dark:file:bg-indigo-500/20 dark:file:text-indigo-200"
              />
              {editAsgFiles.length > 0 && (
                <div className="space-y-1">
                  {editAsgFiles.map((f, i) => (
                    <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                      <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-300">{f.name}</span>
                      <button type="button" onClick={() => removeEditFile(i)} className="text-slate-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <input id="asg-files" name="attachment_file" type="file" multiple
                onChange={(e) => setAsgFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-500/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-500/15 dark:text-slate-400 dark:file:bg-indigo-500/20 dark:file:text-indigo-200"
              />
              {asgFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {asgFiles.map((f, i) => (
                    <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                      <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-300">{f.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ClassroomField>

        {/* ─── Actions ─── */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200/70 pt-4 dark:border-slate-700/70 sm:flex-row">
          <ClassroomButton type="button" variant="secondary" className="flex-1" onClick={() => { resetForm(); onClose(); }}>
            Cancel
          </ClassroomButton>
          <ClassroomButton
            type="button"
            variant="primary"
            className="flex-1"
            onClick={handleSubmit}
            disabled={!newAsg.title.trim() || creatingAsg || (assignmentType === "assessment" && !selectedAssessmentId)}
          >
            {creatingAsg ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEditing ? "Save changes" : "Create"}
          </ClassroomButton>
        </div>
      </div>
    </ClassroomModal>
  );
}
