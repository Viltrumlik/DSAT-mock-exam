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
  crTextareaClass,
} from "@/components/classroom";
import { SegmentedControl } from "@/components/SegmentedControl";
import { materialMeta } from "@/features/classroom/pages/materialMeta";
import { spawnRipple } from "@/features/classroom/ui/ripple";
import { formatApiErrorForToast } from "@/lib/apiError";
import {
  ArrowLeft, BookOpen, Check, ClipboardList, Clock, FlaskConical, Inbox, Layers,
  Link2, Loader2, Paperclip, Search, SlidersHorizontal, Upload, X,
} from "lucide-react";

type PastpaperRow = Record<string, unknown> & {
  id: number;
  collection_name?: string;
  already_assigned?: boolean;
};

type AssessmentSetOption = {
  id: number;
  title: string;
  subject: string;
  source?: string;
  category: string;
  description: string;
  question_count: number;
  already_assigned?: boolean;
  /** Review lifecycle from the backend picker; only approved sets are safe to assign. */
  review_status?: "draft" | "needs_review" | "approved";
  is_approved?: boolean;
};

type PracticeScope = "BOTH" | "ENGLISH" | "MATH";

type PracticeTestPackOption = {
  id: number;
  title: string;
  description: string;
  section_count: number;
  already_assigned?: boolean;
};

type TabKey = "pastpapers" | "packs" | "assessments" | "submission";

type Props = {
  classId: number;
  editingAssignment?: Record<string, unknown> | null;
  onCancel: () => void;
  onSaved: (assignmentId?: number) => void | Promise<void>;
};

// Deadlines are no longer picked by hand. Homework runs from the lesson it is set until
// the START of the class's next lesson; the server derives that date
// (classes.lesson_schedule.homework_due_at) and leaves it open when the class has no
// parseable schedule.

function cardReactKey(c: CardPastpaperPack | CardSingle): string {
  if (c.kind === "single") return `single-${c.test.id}`;
  return `pack-${c.packKey}`;
}

/** All pastpaper SECTION ids a card assigns. */
function cardSectionIds(c: CardPastpaperPack | CardSingle): number[] {
  return c.kind === "single" ? [c.test.id] : c.tests.map((t) => t.id);
}

function cardHeading(c: CardPastpaperPack | CardSingle): string {
  return c.kind === "pastpaper_pack"
    ? (c.pack?.title && String(c.pack.title).trim()) || sharedPastpaperPackTitle(c.tests)
    : singleDisplayTitle(c.test);
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

// A live-cart entry (aggregates selections across every tab in the left column).
type CartItem = { key: string; type: "pastpaper" | "practice" | "assessment"; title: string; meta: string; assigned: boolean; onRemove: () => void };

export default function AssignmentForm({ classId, editingAssignment = null, onCancel, onSaved }: Props) {
  const isEditing = editingAssignment != null;

  const [newAsg, setNewAsg] = useState({ title: "", instructions: "", external_url: "" });
  // Whether students may upload a file as their submission (independent of any
  // attached pastpaper/assessment — both can coexist, so manual + auto grading).
  const [allowFileUpload, setAllowFileUpload] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<number>>(new Set());
  const [selectedAssessmentIds, setSelectedAssessmentIds] = useState<Set<number>>(new Set());
  const [selectedPackIds, setSelectedPackIds] = useState<Set<number>>(new Set());
  // Deadline is composed from two dropdowns (no calendar): a date (next 7 days) + a time.
  const [asgFiles, setAsgFiles] = useState<File[]>([]);
  const [replaceAttachments, setReplaceAttachments] = useState(false);
  const [editAsgFiles, setEditAsgFiles] = useState<File[]>([]);
  const [practiceScope, setPracticeScope] = useState<PracticeScope>("BOTH");
  const [classroomSubject, setClassroomSubject] = useState<string>("");
  // Classroom level (foundation/junior/middle/senior, "" = untagged). Past papers
  // are only offered to Middle/Senior groups.
  const [classroomLevel, setClassroomLevel] = useState<string>("");
  // The content library shows one tab at a time (Pastpapers/Packs/Assessments/Submission).
  const [activeTab, setActiveTab] = useState<TabKey>("pastpapers");

  // Picker filters: search + region/year for pastpapers, search for packs,
  // search + source for assessments.
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
  const classSubjectLabel = classroomSubject === "MATH" ? "Math" : classroomSubject === "ENGLISH" ? "English" : "";

  const pastpaperCards = useMemo(
    () => buildHomeworkPastpaperCards(assignmentOptions.practice_tests as any[]),
    [assignmentOptions.practice_tests]
  );
  const pastpaperYears = useMemo(() => pastpaperCardYears(pastpaperCards), [pastpaperCards]);
  const filteredPastpaperCards = useMemo(
    () => filterPastpaperCards(pastpaperCards, { region: pastpaperRegion, year: pastpaperYear, search: pastpaperSearch }),
    [pastpaperCards, pastpaperRegion, pastpaperYear, pastpaperSearch]
  );
  // Section id → already_assigned (from the option rows) for grouping/badging cards.
  const sectionAssigned = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const row of assignmentOptions.practice_tests) m.set(row.id, !!row.already_assigned);
    return m;
  }, [assignmentOptions.practice_tests]);
  // A card counts as "already given" only when every section it assigns is already assigned.
  const cardAlreadyGiven = (c: CardPastpaperPack | CardSingle): boolean => {
    const ids = cardSectionIds(c);
    return ids.length > 0 && ids.every((id) => sectionAssigned.get(id));
  };
  const availablePastpaperCards = useMemo(
    () => filteredPastpaperCards.filter((c) => !cardAlreadyGiven(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredPastpaperCards, sectionAssigned]
  );
  const givenPastpaperCards = useMemo(
    () => filteredPastpaperCards.filter((c) => cardAlreadyGiven(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredPastpaperCards, sectionAssigned]
  );

  const filteredPacks = useMemo(() => {
    const q = packSearch.trim().toLowerCase();
    if (!q) return assignmentOptions.practice_test_packs;
    return assignmentOptions.practice_test_packs.filter(
      (p) => `${p.title} ${p.description}`.toLowerCase().includes(q)
    );
  }, [assignmentOptions.practice_test_packs, packSearch]);
  const availablePacks = useMemo(() => filteredPacks.filter((p) => !p.already_assigned), [filteredPacks]);
  const givenPacks = useMemo(() => filteredPacks.filter((p) => p.already_assigned), [filteredPacks]);

  const filteredAssessmentSets = useMemo(() => {
    const q = assessmentSearch.trim().toLowerCase();
    return assignmentOptions.assessment_sets.filter((a) => {
      if (assessmentSource !== "ALL" && (a.source || "") !== assessmentSource) return false;
      if (q && !`${a.title} ${a.category} ${a.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assignmentOptions.assessment_sets, assessmentSearch, assessmentSource]);
  const availableAssessmentSets = useMemo(() => filteredAssessmentSets.filter((a) => !a.already_assigned), [filteredAssessmentSets]);
  const givenAssessmentSets = useMemo(() => filteredAssessmentSets.filter((a) => a.already_assigned), [filteredAssessmentSets]);

  const resetForm = () => {
    setNewAsg({ title: "", instructions: "", external_url: "" });
    setAllowFileUpload(false);
    setSelectedTestIds(new Set());
    setSelectedAssessmentIds(new Set());
    setSelectedPackIds(new Set());
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
          setClassroomLevel(typeof d.classroom_level === "string" ? d.classroom_level : "");
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

  // Auto-set the section scope from the class subject; selector stays hidden.
  useEffect(() => {
    if (classroomSubject === "MATH") setPracticeScope("MATH");
    else if (classroomSubject === "ENGLISH") setPracticeScope("ENGLISH");
  }, [classroomSubject]);

  // Past papers are only offered to Middle/Senior groups — Junior English/Math and
  // Foundation Math (and untagged classes) don't get the Pastpapers tab.
  const showPastpapers = classroomLevel === "middle" || classroomLevel === "senior";
  // If the Pastpapers tab is hidden but currently selected, fall back to Assessments.
  useEffect(() => {
    if (!showPastpapers && activeTab === "pastpapers") setActiveTab("assessments");
  }, [showPastpapers, activeTab]);

  // Prefill from the assignment being edited.
  useEffect(() => {
    if (!editingAssignment) { resetForm(); return; }
    const instrValue = String(editingAssignment.instructions ?? "");
    setNewAsg({
      title: String(editingAssignment.title ?? ""),
      instructions: instrValue,
      external_url: String(editingAssignment.external_url ?? ""),
    });
    // ── Assessments ── prefer the multi `assessment_homeworks` array; fall back to
    // the legacy single `assessment_homework`.
    const nextAssessmentIds = new Set<number>();
    const ahs = editingAssignment.assessment_homeworks;
    if (Array.isArray(ahs)) {
      for (const item of ahs) {
        const sid = item && typeof item === "object" && "set" in item
          ? Number((item as { set?: { id?: number } }).set?.id)
          : NaN;
        if (Number.isFinite(sid)) nextAssessmentIds.add(sid);
      }
    }
    const ah = editingAssignment.assessment_homework;
    if (nextAssessmentIds.size === 0 && ah && typeof ah === "object" && "set" in (ah as Record<string, unknown>)) {
      const sid = Number((ah as { set?: { id?: number } }).set?.id);
      if (Number.isFinite(sid)) nextAssessmentIds.add(sid);
    }
    setSelectedAssessmentIds(nextAssessmentIds);

    // ── Practice packs ── multi `practice_test_pack_ids` and/or legacy single `practice_test_pack`.
    const nextPackIds = new Set<number>();
    if (Array.isArray(editingAssignment.practice_test_pack_ids)) {
      for (const x of editingAssignment.practice_test_pack_ids as unknown[]) {
        const n = Number(x);
        if (Number.isFinite(n)) nextPackIds.add(n);
      }
    }
    const ptp = editingAssignment.practice_test_pack;
    if (ptp != null) {
      const ptpId = typeof ptp === "object" && ptp != null && "id" in ptp ? Number((ptp as { id: number }).id) : Number(ptp);
      if (Number.isFinite(ptpId)) nextPackIds.add(ptpId);
    }
    setSelectedPackIds(nextPackIds);

    // ── Pastpaper sections ── multi `practice_test_ids` and/or legacy single `practice_test`.
    const nextTestIds = new Set<number>();
    if (Array.isArray(editingAssignment.practice_test_ids)) {
      for (const x of editingAssignment.practice_test_ids as unknown[]) {
        const n = Number(x);
        if (Number.isFinite(n)) nextTestIds.add(n);
      }
    }
    if (editingAssignment.practice_test != null) {
      const pt = editingAssignment.practice_test;
      const tid = typeof pt === "object" && pt != null && "id" in pt ? Number((pt as { id: number }).id) : Number(pt);
      if (Number.isFinite(tid)) nextTestIds.add(tid);
    }
    setSelectedTestIds(nextTestIds);
    setAllowFileUpload(Boolean(editingAssignment.allow_file_upload));

    const ps = editingAssignment.practice_scope;
    if (ps === "ENGLISH" || ps === "MATH" || ps === "BOTH") setPracticeScope(ps);
    setAsgFiles([]);
    setReplaceAttachments(false);
    setEditAsgFiles([]);
    setFormError(null);
  }, [editingAssignment]);

  const handleSubmit = async (
    publishStatus: "DRAFT" | "PUBLISHED" = "PUBLISHED",
    allowUnapproved = false,
  ) => {
    setFormError(null);
    // Guard: warn before assigning an assessment that isn't approved yet so a
    // teacher doesn't hand out an incomplete/unchecked set by mistake. The backend
    // enforces the same gate — allow_unapproved is only sent after the teacher agrees.
    const selectedSets = assignmentOptions.assessment_sets.filter((a) => selectedAssessmentIds.has(a.id));
    const unapproved = selectedSets.filter(
      (a) => a.is_approved === false || (a.review_status != null && a.review_status !== "approved"),
    );
    if (unapproved.length > 0 && !allowUnapproved) {
      const names = unapproved.map((a) => `“${a.title}”`).join(", ");
      const ok =
        typeof window === "undefined" ||
        window.confirm(
          `${unapproved.length === 1 ? "This assessment is" : "These assessments are"} not approved yet: ${names}.\n\nAssign anyway?`,
        );
      if (!ok) return;
      allowUnapproved = true;
    }
    setCreatingAsg(true);
    try {
      const editId = editingAssignment != null ? Number(editingAssignment.id) : NaN;
      if (Number.isFinite(editId)) {
        const testIds = [...selectedTestIds];
        const packIds = [...selectedPackIds];
        const body: Record<string, unknown> = {
          title: newAsg.title.trim(),
          instructions: newAsg.instructions,
          external_url: newAsg.external_url.trim() || "",
          practice_test: null,
          practice_test_ids: testIds.length > 0 ? testIds : null,
          practice_test_pack_ids: packIds.length > 0 ? packIds : null,
          // Reconcile attached assessments on edit — always send the full selection
          // (including empty) so the backend can attach AND detach.
          assessment_set_ids: [...selectedAssessmentIds],
          practice_scope: practiceScope,
          allow_file_upload: allowFileUpload,
          allow_unapproved: allowUnapproved,
        };

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
      if (newAsg.external_url.trim()) fd.append("external_url", newAsg.external_url.trim());

      // A resource counts only if the teacher actually selected it.
      if (selectedTestIds.size > 0) {
        fd.append("practice_test_ids", JSON.stringify([...selectedTestIds]));
        fd.append("practice_scope", practiceScope);
      }
      if (selectedPackIds.size > 0) {
        fd.append("practice_test_pack_ids", JSON.stringify([...selectedPackIds]));
        fd.append("practice_scope", practiceScope);
      }
      if (selectedAssessmentIds.size > 0) {
        fd.append("assessment_set_ids", JSON.stringify([...selectedAssessmentIds]));
        if (allowUnapproved) fd.append("allow_unapproved", "true");
      }
      fd.append("allow_file_upload", String(allowFileUpload));
      for (const f of asgFiles) fd.append("attachment_file", f);

      fd.append("status", publishStatus);
      const created = await classesApi.createAssignment(classId, fd, true);
      const createdId = created && typeof created === "object" && "id" in created ? Number((created as { id: number }).id) : undefined;
      await onSaved(Number.isFinite(createdId) ? createdId : undefined);
    } catch (e: unknown) {
      setFormError(formatApiErrorForToast(e));
    } finally {
      setCreatingAsg(false);
    }
  };

  // ── Selection handlers (toggle a resource in/out of its Set) ────────────────
  const cardSelected = (c: CardPastpaperPack | CardSingle): boolean => {
    const ids = cardSectionIds(c);
    return ids.length > 0 && ids.every((id) => selectedTestIds.has(id));
  };
  const handleCardSelect = (c: CardPastpaperPack | CardSingle) => {
    const ids = cardSectionIds(c);
    const isSel = cardSelected(c);
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (isSel) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
    if (!isSel && !newAsg.title.trim()) {
      const heading = cardHeading(c);
      if (heading) setNewAsg((prev) => ({ ...prev, title: heading }));
    }
  };
  const handleAssessmentSelect = (aset: AssessmentSetOption) => {
    const wasSel = selectedAssessmentIds.has(aset.id);
    setSelectedAssessmentIds((prev) => {
      const next = new Set(prev);
      if (wasSel) next.delete(aset.id);
      else next.add(aset.id);
      return next;
    });
    if (!wasSel && !newAsg.title.trim()) setNewAsg((prev) => ({ ...prev, title: aset.title }));
  };
  const handlePackSelect = (ptp: PracticeTestPackOption) => {
    const wasSel = selectedPackIds.has(ptp.id);
    setSelectedPackIds((prev) => {
      const next = new Set(prev);
      if (wasSel) next.delete(ptp.id);
      else next.add(ptp.id);
      return next;
    });
    if (!wasSel && !newAsg.title.trim()) setNewAsg((prev) => ({ ...prev, title: ptp.title }));
  };

  const removeFile = (idx: number) => setAsgFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeEditFile = (idx: number) => setEditAsgFiles((prev) => prev.filter((_, i) => i !== idx));

  // ── Live cart — every selection across the tabs, shown in the left column ────
  const cartItems = useMemo<CartItem[]>(() => {
    const out: CartItem[] = [];
    for (const c of pastpaperCards) {
      if (!cardSelected(c)) continue;
      const secs = cardSectionIds(c);
      out.push({
        key: `pp-${cardReactKey(c)}`,
        type: "pastpaper",
        title: cardHeading(c),
        meta: `Past paper · ${secs.length} section${secs.length !== 1 ? "s" : ""}`,
        assigned: cardAlreadyGiven(c),
        onRemove: () => handleCardSelect(c),
      });
    }
    for (const p of assignmentOptions.practice_test_packs) {
      if (!selectedPackIds.has(p.id)) continue;
      out.push({
        key: `pack-${p.id}`,
        type: "practice",
        title: p.title || `Pack #${p.id}`,
        meta: `Practice test · ${p.section_count} section${p.section_count !== 1 ? "s" : ""}`,
        assigned: !!p.already_assigned,
        onRemove: () => handlePackSelect(p),
      });
    }
    for (const a of assignmentOptions.assessment_sets) {
      if (!selectedAssessmentIds.has(a.id)) continue;
      out.push({
        key: `as-${a.id}`,
        type: "assessment",
        title: a.title,
        meta: `${a.category ? a.category + " · " : ""}${a.question_count} questions`,
        assigned: !!a.already_assigned,
        onRemove: () => handleAssessmentSelect(a),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastpaperCards, assignmentOptions, selectedTestIds, selectedPackIds, selectedAssessmentIds, sectionAssigned]);

  const hasTitle = newAsg.title.trim().length > 0;
  const hasInstructions = newAsg.instructions.trim().length > 0;
  const ready = hasTitle && hasInstructions;
  const submitDisabled = !ready || creatingAsg;
  const existingAttachments = readAttachments(editingAssignment);

  const footerHint = !hasTitle
    ? "Add a title to get started."
    : !hasInstructions
      ? "Add instructions for students."
      : cartItems.length === 0 && !allowFileUpload && !newAsg.external_url.trim() && asgFiles.length === 0
        ? "Add content, a file upload, or a link — then publish."
        : "Ready to publish.";

  // ── Small style helpers ─────────────────────────────────────────────────────
  const cartDot: Record<CartItem["type"], string> = {
    pastpaper: "bg-primary",
    practice: "bg-emerald-500",
    assessment: "bg-[#6d4ec7]",
  };
  const searchInputCls = `${crInputClass} pl-10`;

  // Reusable pick-card shell (check-circle top-right, hover lift, selected accent).
  function PickCard({ selected, given, onClick, children }: {
    selected: boolean; given?: boolean; onClick: () => void; children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`cr-press relative flex w-full flex-col gap-1.5 rounded-[14px] border-[1.5px] p-4 pr-9 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-md ${
          selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary)]" : "border-border bg-card"
        }`}
      >
        <span className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] transition-all ${
          selected ? "border-primary bg-primary text-white" : "border-border bg-background text-transparent"
        }`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        {children}
        {given ? (
          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            title="Already assigned to this class in an earlier assignment">
            <Clock className="h-2.5 w-2.5" /> Already assigned
          </span>
        ) : null}
      </button>
    );
  }

  const groupTitle = (label: string) => (
    <h3 className="text-[15px] font-extrabold text-foreground">{label}</h3>
  );
  const cardGrid = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(228px,1fr))]";

  const renderPastpaperCard = (c: CardPastpaperPack | CardSingle, given: boolean) => {
    const lineDate = c.kind === "pastpaper_pack"
      ? c.pack?.practice_date || c.tests[0]?.practice_date || c.tests[0]?.created_at
      : c.test.practice_date || c.test.created_at;
    const sectionRows = c.kind === "pastpaper_pack" ? c.tests : [{ id: c.test.id, subject: c.test.subject }];
    return (
      <PickCard key={cardReactKey(c)} selected={cardSelected(c)} given={given} onClick={() => handleCardSelect(c)}>
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary">{c.kind === "pastpaper_pack" ? "Full exam" : "Practice test"}</span>
        <span className="text-[12.5px] font-semibold text-muted-foreground">{formatLineDate(lineDate)}</span>
        <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{cardHeading(c)}</span>
        <span className="mt-0.5 flex flex-wrap gap-1.5">
          {sectionRows.map((t) => (
            <span key={t.id} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">{subjectLabel(t.subject)}</span>
          ))}
        </span>
      </PickCard>
    );
  };

  const renderAssessmentCard = (aset: AssessmentSetOption, given: boolean) => (
    <PickCard key={aset.id} selected={selectedAssessmentIds.has(aset.id)} given={given} onClick={() => handleAssessmentSelect(aset)}>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
          aset.subject === "math" ? "bg-[#6d4ec7]/12 text-[#6d4ec7] dark:bg-purple-900/40 dark:text-purple-300" : "bg-primary/10 text-primary"
        }`}>{aset.subject}</span>
        {aset.source && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{sourceLabel(aset.source)}</span>}
        {aset.category && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{aset.category}</span>}
        {aset.is_approved === false && (
          <span
            className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            title="Not approved for assignment yet"
          >
            ⚠ {aset.review_status === "needs_review" ? "Needs review" : "Incomplete"}
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{aset.title}</span>
      <span className="text-[12px] font-semibold text-muted-foreground">{aset.question_count} questions</span>
    </PickCard>
  );

  const renderPackCard = (ptp: PracticeTestPackOption, given: boolean) => (
    <PickCard key={ptp.id} selected={selectedPackIds.has(ptp.id)} given={given} onClick={() => handlePackSelect(ptp)}>
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary">Practice test pack</span>
      <span className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground">{ptp.title || `Pack #${ptp.id}`}</span>
      {ptp.description ? <span className="line-clamp-2 text-[12px] text-muted-foreground">{ptp.description}</span> : null}
      <span className="text-[12px] font-semibold text-muted-foreground">{ptp.section_count} section{ptp.section_count !== 1 ? "s" : ""}</span>
    </PickCard>
  );

  // Practice test packs are no longer offered when creating an assignment.
  // Pastpapers only appear for Middle/Senior classes.
  const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
    ...(showPastpapers ? [{ key: "pastpapers" as const, label: "Pastpapers", icon: BookOpen }] : []),
    { key: "assessments", label: "Assessments", icon: ClipboardList },
    { key: "submission", label: "Submission", icon: SlidersHorizontal },
  ];
  const panelCls = "flex flex-col gap-4 rounded-[20px] border border-border bg-background p-6 shadow-sm";
  const captionCls = "text-[12.5px] font-medium text-muted-foreground/80";

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      {/* ── Page head ── */}
      <div className="mb-5">
        <button type="button" onClick={onCancel} className="mb-4 inline-flex items-center gap-2 text-[13.5px] font-bold text-muted-foreground transition-colors hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to classroom
        </button>
        <div className="flex items-center gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-primary/10 text-primary"><ClipboardList className="h-6 w-6" /></div>
          <div className="min-w-0">
            <h1 className="text-[25px] font-extrabold tracking-tight text-foreground">{isEditing ? "Edit assignment" : "New assignment"}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[13.5px] font-semibold text-muted-foreground">
              {classSubjectLabel && <span>{classSubjectLabel} class</span>}
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{isEditing ? "Edit" : "Draft"}</span>
            </div>
          </div>
        </div>
      </div>

      {formError ? <div className="mb-4"><ClassroomAlert tone="error">{formError}</ClassroomAlert></div> : null}
      {asgOptionsError ? <div className="mb-4"><ClassroomAlert tone="warning">{asgOptionsError}</ClassroomAlert></div> : null}

      {/* ── Builder split pane ── */}
      <div className="grid items-start gap-6 lg:grid-cols-2">

        {/* LEFT — details · live cart · sticky footer */}
        <section className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-panel shadow-md lg:sticky lg:top-4 lg:max-h-[calc(100vh-120px)]">
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-5">

            {/* Assignment details */}
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><ClipboardList className="h-[17px] w-[17px]" /></span>
                <h2 className="flex-1 text-[15.5px] font-extrabold text-foreground">Assignment details</h2>
              </div>

              <ClassroomField label="Title *" htmlFor="asg-title">
                <input id="asg-title" value={newAsg.title} onChange={(e) => setNewAsg((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. May SAT Reading practice" className={`${crInputClass} font-semibold`} />
              </ClassroomField>

              <ClassroomField label="Instructions *" htmlFor="asg-inst" hint="Tell students exactly what to do — this is the main brief, so use as much space as you need.">
                <textarea id="asg-inst" value={newAsg.instructions} onChange={(e) => setNewAsg((p) => ({ ...p, instructions: e.target.value }))} placeholder="Write clear, detailed directions for students" rows={10} className={crTextareaClass} />
              </ClassroomField>

              {/* Deadlines are automatic — no picker. Homework runs until the next lesson. */}
              <div className="flex items-start gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <div className="text-[13.5px] font-bold text-foreground">Due at the next lesson</div>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    This homework stays open from today until your class&apos;s next lesson
                    begins. If the class has no set schedule it stays open with no deadline.
                  </p>
                </div>
              </div>
            </div>

            {/* Selected content (live cart) */}
            <div className="flex flex-col gap-3.5 border-t border-border pt-[18px]">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-primary/10 text-primary"><Layers className="h-[17px] w-[17px]" /></span>
                <h2 className="flex-1 text-[15.5px] font-extrabold text-foreground">Selected content</h2>
                <span className="whitespace-nowrap rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-muted-foreground">{cartItems.length} selected</span>
              </div>

              {cartItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-5 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">Nothing selected yet. Add a pastpaper, practice test, or assessment from the library on the right.</p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {cartItems.map((it) => (
                    <li key={it.key} className="flex items-center gap-2.5 border-t border-dashed border-border py-2.5 first:border-t-0">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cartDot[it.type]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold text-foreground">{it.title}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground/80">{it.meta}</div>
                      </div>
                      {it.assigned ? (
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Already assigned to this class before"><Clock className="h-3 w-3" /></span>
                      ) : null}
                      <button type="button" onClick={it.onRemove} aria-label={`Remove ${it.title}`} className="flex shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-rose-500/10 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Sticky footer — readiness + actions */}
          <div className="border-t border-border bg-panel px-5 pb-[18px] pt-3.5">
            <p className="mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full transition-colors ${ready ? "bg-emerald-500" : "bg-amber-500"}`} /> {footerHint}
            </p>
            <div className="flex gap-2">
              <ClassroomButton type="button" variant="secondary" onClick={onCancel}>Cancel</ClassroomButton>
              {!isEditing && (
                <ClassroomButton type="button" variant="secondary" className="cr-press cr-ripple" onPointerDown={spawnRipple} onClick={() => handleSubmit("DRAFT")} disabled={submitDisabled}>Save as draft</ClassroomButton>
              )}
              <ClassroomButton type="button" variant="primary" className="cr-press cr-ripple flex-1" onPointerDown={spawnRipple} onClick={() => handleSubmit("PUBLISHED")} disabled={submitDisabled}>
                {creatingAsg ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isEditing ? "Save changes" : "Publish assignment"}
                {cartItems.length > 0 ? <span className="ml-1 rounded-md bg-white/25 px-1.5 py-0.5 text-xs">{cartItems.length}</span> : null}
              </ClassroomButton>
            </div>
          </div>
        </section>

        {/* RIGHT — tabbed content library */}
        <section className="flex min-w-0 flex-col gap-[18px]">
          {asgOptionsLoading ? (
            <div className="flex items-center gap-2 rounded-[20px] border border-border bg-card px-6 py-4 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading library…</div>
          ) : null}

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-0.5" role="tablist">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              const Icon = tab.icon;
              return (
                <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl border-[1.5px] px-4 py-2.5 text-sm font-bold transition-all ${
                    active ? "border-primary bg-primary/10 text-primary" : "border-border bg-panel text-muted-foreground hover:-translate-y-px hover:border-primary hover:text-primary"
                  }`}>
                  <Icon className="h-4 w-4" /> {tab.label}
                </button>
              );
            })}
          </div>

          {/* Pastpapers */}
          {activeTab === "pastpapers" && (
            <div className={panelCls} role="tabpanel">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={pastpaperSearch} onChange={(e) => setPastpaperSearch(e.target.value)} placeholder="Search pastpapers…" className={searchInputCls} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl label="Region" value={pastpaperRegion} onChange={(v) => setPastpaperRegion(v as "ALL" | "US" | "INTL")} options={[{ value: "ALL", label: "All" }, { value: "US", label: "US" }, { value: "INTL", label: "International" }]} />
                {pastpaperYears.length > 0 && (
                  <SegmentedControl label="Year" value={pastpaperYear} onChange={setPastpaperYear} options={[{ value: "ALL", label: "All" }, ...pastpaperYears.map((y) => ({ value: y, label: y }))]} />
                )}
              </div>

              {filteredPastpaperCards.length === 0 ? (
                <EmptyPanel icon={BookOpen} title="No pastpapers match" text="Try clearing the search or filters." />
              ) : (
                <>
                  {availablePastpaperCards.length > 0 && (
                    <>
                      {groupTitle("Available")}
                      <div className={cardGrid}>{availablePastpaperCards.map((c) => renderPastpaperCard(c, false))}</div>
                    </>
                  )}
                  {givenPastpaperCards.length > 0 && (
                    <>
                      {groupTitle("Already assigned")}
                      <div className={cardGrid}>{givenPastpaperCards.map((c) => renderPastpaperCard(c, true))}</div>
                    </>
                  )}
                </>
              )}
              <p className={captionCls}>Select one or more. Only sections for this class&apos;s subject are shown. Items marked &quot;Already assigned&quot; were used in an earlier assignment for this class.</p>
            </div>
          )}

          {/* Practice test packs */}
          {activeTab === "packs" && (
            <div className={panelCls} role="tabpanel">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={packSearch} onChange={(e) => setPackSearch(e.target.value)} placeholder="Search practice test packs…" className={searchInputCls} />
              </div>
              {filteredPacks.length === 0 ? (
                <EmptyPanel icon={FlaskConical} title="No practice test packs found" text="Create and publish one in the Builder console first." />
              ) : (
                <>
                  {availablePacks.length > 0 && (<>{groupTitle("Available")}<div className={cardGrid}>{availablePacks.map((p) => renderPackCard(p, false))}</div></>)}
                  {givenPacks.length > 0 && (<>{groupTitle("Already assigned")}<div className={cardGrid}>{givenPacks.map((p) => renderPackCard(p, true))}</div></>)}
                </>
              )}
              <p className={captionCls}>Select one or more custom practice tests to assign.</p>
            </div>
          )}

          {/* Assessments */}
          {activeTab === "assessments" && (
            <div className={panelCls} role="tabpanel">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={assessmentSearch} onChange={(e) => setAssessmentSearch(e.target.value)} placeholder="Search assessments…" className={searchInputCls} />
                </div>
                {allowedSources.length > 0 && (
                  <select aria-label="Source" value={assessmentSource} onChange={(e) => setAssessmentSource(e.target.value)} className={`${crInputClass} sm:w-[180px]`}>
                    <option value="ALL">All sources</option>
                    {allowedSources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                  </select>
                )}
              </div>
              {filteredAssessmentSets.length === 0 ? (
                <EmptyPanel icon={ClipboardList} title="No assessment sets found" text="Try clearing filters, or create one in the Builder console." />
              ) : (
                <>
                  {availableAssessmentSets.length > 0 && (<>{groupTitle("Available")}<div className={cardGrid}>{availableAssessmentSets.map((a) => renderAssessmentCard(a, false))}</div></>)}
                  {givenAssessmentSets.length > 0 && (<>{groupTitle("Already assigned")}<div className={cardGrid}>{givenAssessmentSets.map((a) => renderAssessmentCard(a, true))}</div></>)}
                </>
              )}
              <p className={captionCls}>Select one or more quizzes and tests to assign. Items marked &quot;Already assigned&quot; were used in an earlier assignment for this class.</p>
            </div>
          )}

          {/* Submission & resources */}
          {activeTab === "submission" && (
            <div className={panelCls} role="tabpanel">
              {groupTitle("Submission & resources")}

              {/* Allow file submissions toggle */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-foreground">Allow file submissions</div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">Students can turn in a file for manual grading — even alongside a pastpaper or assessment they solve.</p>
                </div>
                <button type="button" role="switch" aria-checked={allowFileUpload} aria-label="Allow file submissions" onClick={() => setAllowFileUpload((v) => !v)}
                  className={`inline-flex h-[25px] w-[44px] shrink-0 items-center rounded-full transition-colors ${allowFileUpload ? "bg-primary" : "bg-border"}`}>
                  <span className={`inline-block h-[19px] w-[19px] transform rounded-full bg-white shadow-sm transition-transform duration-200 ${allowFileUpload ? "translate-x-[22px]" : "translate-x-[3px]"}`} />
                </button>
              </div>

              {/* External link */}
              <ClassroomField label="External link" hint="Add a link to outside material, like a video or article." htmlFor="asg-url">
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
                  <input id="asg-url" type="url" value={newAsg.external_url} onChange={(e) => setNewAsg((p) => ({ ...p, external_url: e.target.value }))} placeholder="https://example.com/resource" className={`${crInputClass} pl-10`} />
                </div>
              </ClassroomField>

              {/* Files */}
              <ClassroomField label={isEditing ? "Teacher attachments" : "Files"} hint="PDF, Word, Excel, PowerPoint, text, or images — students can download these.">
                {isEditing ? (
                  <div className="space-y-3">
                    {existingAttachments.length > 0 ? (
                      <div className="space-y-1">
                        {existingAttachments.map((f, i) => {
                          const meta = materialMeta(f.file_name || f.url);
                          const Icon = meta.Icon;
                          return (
                            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="cr-press flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-2">
                              <span className={`flex h-6 w-6 items-center justify-center rounded-md ${meta.iconWrap}`}><Icon className="h-3.5 w-3.5" /></span>
                              <span className="truncate">{f.file_name || "Attachment"}</span>
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">No files on this assignment yet.</p>
                    )}
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                      <input type="checkbox" className="mt-0.5 rounded border-border text-primary focus:ring-primary" checked={replaceAttachments} onChange={(e) => setReplaceAttachments(e.target.checked)} />
                      <span><span className="font-semibold">Replace all existing attachments</span><span className="block text-xs font-normal text-muted-foreground">Check this before uploading to replace current files.</span></span>
                    </label>
                    <input id="asg-files-edit" name="attachment_file" type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={(e) => setEditAsgFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
                      className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/15" />
                    {editAsgFiles.length > 0 && (
                      <div className="space-y-1">
                        {editAsgFiles.map((f, i) => (
                          <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                            <button type="button" onClick={() => removeEditFile(i)} className="text-muted-foreground hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <label htmlFor="asg-files" className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary/5">
                      <Upload className="h-[22px] w-[22px] text-primary" />
                      <p className="text-[13.5px] text-muted-foreground"><strong className="text-foreground">Click to browse</strong> or drop files</p>
                    </label>
                    <input id="asg-files" name="attachment_file" type="file" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={(e) => {
                        const incoming = Array.from(e.target.files || []);
                        setAsgFiles((prev) => {
                          const combined = [...prev, ...incoming];
                          if (combined.length > 10) { setFormError("Maximum 10 files allowed."); return prev; }
                          setFormError(null);
                          return combined;
                        });
                        e.target.value = "";
                      }} />
                    {asgFiles.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {asgFiles.map((f, i) => (
                          <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
                            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate text-xs font-medium text-foreground">{f.name}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                            <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </ClassroomField>

              <p className={captionCls}>These settings apply to the whole assignment, alongside anything selected in the other tabs.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Small empty-state used inside the right-column panels.
function EmptyPanel({ icon: Icon, title, text }: { icon: typeof BookOpen; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-border bg-card px-5 py-10 text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-panel text-muted-foreground shadow-sm"><Icon className="h-6 w-6" /></span>
      <h4 className="text-base font-extrabold text-foreground">{title}</h4>
      <p className="max-w-[320px] text-[13.5px] text-muted-foreground">{text}</p>
    </div>
  );
}
