"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  Layers,
  ListChecks,
  Loader2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { bulkAssignApi } from "@/features/bulkAssign/api";
import type { Assignment } from "@/lib/api";
import { getSubject } from "@/lib/permissions";
import {
  formatMockExamAdminLabel,
  formatPastpaperPackAdminLabel,
  pastpaperSectionSummary,
} from "@/lib/adminAssignFormat";
import { AssignmentHistoryPanel } from "./AssignmentHistoryPanel";
import { SearchableSelect, type SearchableOption } from "./SearchableSelect";
import type {
  AssignmentDispatchRow,
  BulkAssignKind,
  BulkAssignUserRow,
  LastAssignResult,
  PastpaperScope,
} from "./types";
import {
  accountStatusLabel,
  isStudentRole,
  matchesClassroomFilter,
  matchesSubjectTrackFilter,
  mockRowEligibility,
  pastpaperRowEligibility,
  type EligibilityRow,
  platformSubjectsForMockAssignment,
  platformSubjectsInResolvedPastpaper,
  resolvePastpaperSectionIdsForPack,
  studentDisplayName,
} from "./subjectEligibility";

type TrackFilter = "ALL" | "MATH" | "ENGLISH";

function mapAssignApiToLastResult(res: Record<string, unknown>, ok: boolean, message?: string): LastAssignResult {
  const skipped = Array.isArray(res?.skipped_users) ? (res.skipped_users as LastAssignResult["skipped_users"]) : [];
  return {
    ok,
    message,
    dispatch_id: typeof res?.dispatch_id === "number" ? res.dispatch_id : Number(res?.dispatch_id) || undefined,
    dispatch_status: typeof res?.dispatch_status === "string" ? res.dispatch_status : undefined,
    students_granted_count:
      typeof res?.students_granted_count === "number" ? res.students_granted_count : undefined,
    students_requested_count:
      typeof res?.students_requested_count === "number" ? res.students_requested_count : undefined,
    students_skipped_count:
      typeof res?.students_skipped_count === "number" ? res.students_skipped_count : undefined,
    tests_added: typeof res?.tests_added === "number" ? res.tests_added : undefined,
    skipped_users: skipped,
  };
}

function studentInClassroom(u: BulkAssignUserRow, classroomId: number): boolean {
  return (u.bulk_assign_profile?.classrooms || []).some((c) => c.id === classroomId);
}

function normalizeClassroomSubject(raw: unknown): "math" | "english" | null {
  const u = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (u === "MATH") return "math";
  if (u === "ENGLISH") return "english";
  return null;
}

const examsAdminApi = bulkAssignApi.exams;
const assessmentsAdminApi = bulkAssignApi.assessments;
const classesApi = bulkAssignApi.classes;

const STEP_META = [
  { id: 1, title: "Assignment type", hint: "Pastpaper, timed mock, or assessments" },
  { id: 2, title: "Content", hint: "Exam shell, card, or assessment set" },
  { id: 3, title: "Recipients", hint: "Students (library) or classroom (homework)" },
  { id: 4, title: "Configuration", hint: "Sections / filters, or due date & notes" },
  { id: 5, title: "Review", hint: "Confirm and run" },
] as const;

export type BulkAssignWizardProps = {
  canAssign: boolean;
  users: BulkAssignUserRow[];
  mockExams: Array<Record<string, unknown>>;
  pastpaperPacks: Array<Record<string, unknown>>;
  loadingUsers?: boolean;
  showToast: (msg: string) => void;
  onAfterSuccess: () => void | Promise<void>;
  intent: "pastpapers" | "mocks" | null;
  onConsumeIntent: () => void;
  defaultPastpaperScope: PastpaperScope;
};

function inferPastpaperFromSectionIds(
  sectionIds: number[],
  packs: Array<{ id: number; sections?: Array<{ id: number; subject: string }> }>,
): { packId: number; scope: PastpaperScope } | null {
  if (!sectionIds.length) return null;
  const want = new Set(sectionIds);
  for (const p of packs) {
    const sections = p.sections || [];
    const byId = new Map(sections.map((s) => [s.id, s]));
    if (![...want].every((id) => byId.has(id))) continue;
    const subs = new Set(sectionIds.map((id) => byId.get(id)?.subject).filter(Boolean) as string[]);
    let scope: PastpaperScope = "BOTH";
    if (subs.size === 1) {
      scope = subs.has("MATH") ? "MATH" : "READING_WRITING";
    }
    return { packId: Number(p.id), scope };
  }
  return null;
}

export function BulkAssignWizard({
  canAssign,
  users,
  mockExams,
  pastpaperPacks,
  loadingUsers,
  showToast,
  onAfterSuccess,
  intent,
  onConsumeIntent,
  defaultPastpaperScope,
}: BulkAssignWizardProps) {
  const [history, setHistory] = useState<AssignmentDispatchRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rerunBusyId, setRerunBusyId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<LastAssignResult | null>(null);

  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<BulkAssignKind | null>(null);

  const [mockExamId, setMockExamId] = useState<number | null>(null);
  const [pastpaperPackId, setPastpaperPackId] = useState<number | null>(null);
  const [pastpaperScope, setPastpaperScope] = useState<PastpaperScope>("BOTH");

  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [assignmentType, setAssignmentType] = useState("FULL");
  const [formType, setFormType] = useState("");

  const [studentQuery, setStudentQuery] = useState("");
  const [classroomFilter, setClassroomFilter] = useState<number | "all">("all");
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("ALL");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assessmentSets, setAssessmentSets] = useState<Array<Record<string, unknown>>>([]);
  const [assessmentSetsLoading, setAssessmentSetsLoading] = useState(false);
  const [assessmentSetId, setAssessmentSetId] = useState<number | null>(null);
  const [assessmentClassrooms, setAssessmentClassrooms] = useState<Array<Record<string, unknown>> | null>(null);
  const [assessmentClassroomsLoading, setAssessmentClassroomsLoading] = useState(false);
  const [assessmentClassroomId, setAssessmentClassroomId] = useState<number | null>(null);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentInstructions, setAssessmentInstructions] = useState("");
  const [assessmentDue, setAssessmentDue] = useState("");
  const [assessmentDupAssignmentId, setAssessmentDupAssignmentId] = useState<number | null>(null);
  const assessmentIdempotencyRef = useRef<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!canAssign) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await examsAdminApi.listBulkAssignmentHistory();
      setHistory(data.items);
    } catch (e: any) {
      const msg = e?.response?.data?.detail;
      setHistoryError(typeof msg === "string" ? msg : "Could not load assignment history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [canAssign]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!intent) return;
    if (intent === "mocks") {
      setKind("timed_mock");
      setStep(1);
    } else if (intent === "pastpapers") {
      setKind("pastpaper");
      setPastpaperScope(defaultPastpaperScope);
      setStep(1);
    }
    onConsumeIntent();
  }, [intent, onConsumeIntent, defaultPastpaperScope]);

  const fetchAssessmentSets = useCallback(async () => {
    setAssessmentSetsLoading(true);
    try {
      const dom = getSubject();
      const data = await assessmentsAdminApi.adminListSets(dom ? { subject: dom } : undefined);
      setAssessmentSets(Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []);
    } catch {
      setAssessmentSets([]);
      showToast("Could not load assessment sets.");
    } finally {
      setAssessmentSetsLoading(false);
    }
  }, [showToast]);

  const fetchAssessmentClassrooms = useCallback(async () => {
    setAssessmentClassroomsLoading(true);
    try {
      const all = await classesApi.list();
      setAssessmentClassrooms(all.items as Array<Record<string, unknown>>);
    } catch (e: unknown) {
      setAssessmentClassrooms([]);
      const ax = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax?.response?.data?.detail;
      const st = ax?.response?.status;
      const suffix =
        typeof detail === "string" && detail.trim()
          ? ` ${detail.trim()}`
          : st != null
            ? ` (HTTP ${st})`
            : "";
      showToast(`Could not load classrooms.${suffix}`);
    } finally {
      setAssessmentClassroomsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!canAssign || kind !== "assessment_homework") return;
    void fetchAssessmentSets();
    void fetchAssessmentClassrooms();
  }, [canAssign, kind, fetchAssessmentSets, fetchAssessmentClassrooms]);

  useEffect(() => {
    if (kind === "assessment_homework") {
      setMockExamId(null);
      setPastpaperPackId(null);
      setSelectedUserIds([]);
      setStudentQuery("");
      setClassroomFilter("all");
      setTrackFilter("ALL");
      return;
    }
    setAssessmentSetId(null);
    setAssessmentClassroomId(null);
    setAssessmentTitle("");
    setAssessmentInstructions("");
    setAssessmentDue("");
    setAssessmentDupAssignmentId(null);
    assessmentIdempotencyRef.current = null;
  }, [kind]);

  useEffect(() => {
    assessmentIdempotencyRef.current = null;
  }, [assessmentClassroomId, assessmentSetId]);

  useEffect(() => {
    if (kind !== "assessment_homework" || !assessmentClassroomId || !assessmentSetId) {
      setAssessmentDupAssignmentId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await classesApi.listAssignments(assessmentClassroomId);
        const list = rows.items;
        const hit = list.find((a: Assignment) => a.assessment_homework?.set?.id === Number(assessmentSetId));
        if (!cancelled) setAssessmentDupAssignmentId(hit?.id != null ? Number(hit.id) : null);
      } catch {
        if (!cancelled) setAssessmentDupAssignmentId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, assessmentClassroomId, assessmentSetId]);

  const resetFlow = useCallback(
    (opts?: { keepResult?: boolean }) => {
      setStep(1);
      setKind(null);
      setMockExamId(null);
      setPastpaperPackId(null);
      setPastpaperScope(defaultPastpaperScope);
      setSelectedUserIds([]);
      setAssignmentType("FULL");
      setFormType("");
      setStudentQuery("");
      setClassroomFilter("all");
      setTrackFilter("ALL");
      setError(null);
      setAssessmentSetId(null);
      setAssessmentClassroomId(null);
      setAssessmentTitle("");
      setAssessmentInstructions("");
      setAssessmentDue("");
      setAssessmentDupAssignmentId(null);
      assessmentIdempotencyRef.current = null;
      if (!opts?.keepResult) setLastResult(null);
    },
    [defaultPastpaperScope],
  );

  const selectedMock = useMemo(
    () => mockExams.find((m) => Number(m.id) === Number(mockExamId)) || null,
    [mockExams, mockExamId],
  );

  const resolvedPastpaperSectionIds = useMemo(() => {
    if (!pastpaperPackId) return [];
    return resolvePastpaperSectionIdsForPack(pastpaperPackId, pastpaperPacks as any, pastpaperScope);
  }, [pastpaperPackId, pastpaperPacks, pastpaperScope]);

  const subjectsForPastpaper = useMemo(() => {
    if (!pastpaperPackId) return new Set() as ReturnType<typeof platformSubjectsInResolvedPastpaper>;
    return platformSubjectsInResolvedPastpaper(pastpaperPackId, resolvedPastpaperSectionIds, pastpaperPacks as any);
  }, [pastpaperPackId, resolvedPastpaperSectionIds, pastpaperPacks]);

  const subjectsForMock = useMemo(() => {
    if (!selectedMock) return new Set() as ReturnType<typeof platformSubjectsForMockAssignment>;
    return platformSubjectsForMockAssignment(selectedMock as any, assignmentType, formType);
  }, [selectedMock, assignmentType, formType]);

  const students = useMemo(() => users.filter((u) => isStudentRole(u.role)), [users]);

  const classroomOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of students) {
      for (const c of u.bulk_assign_profile?.classrooms || []) {
        if (!map.has(c.id)) map.set(c.id, c.name);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return students.filter((u) => {
      if (!matchesClassroomFilter(u, classroomFilter)) return false;
      if (!matchesSubjectTrackFilter(u, trackFilter)) return false;
      if (!q) return true;
      const blob = `${studentDisplayName(u)} ${u.username || ""} ${u.email || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [students, studentQuery, classroomFilter, trackFilter]);

  const rowMeta = useCallback(
    (u: BulkAssignUserRow): EligibilityRow => {
      if (kind === "pastpaper") {
        return pastpaperRowEligibility(u.bulk_assign_profile, subjectsForPastpaper);
      }
      if (kind === "timed_mock") {
        return mockRowEligibility(u.bulk_assign_profile, subjectsForMock);
      }
      return { selectable: true };
    },
    [kind, subjectsForPastpaper, subjectsForMock],
  );

  const mockOptions: SearchableOption<number>[] = useMemo(
    () =>
      mockExams.map((m) => {
        const tests = (m.tests as any[]) || [];
        const subs = [...new Set(tests.map((t) => t.subject).filter(Boolean))].join(", ");
        return {
          value: Number(m.id),
          primary: formatMockExamAdminLabel(m),
          secondary: subs ? `Subjects in shell: ${subs}` : undefined,
          keywords: `${m.id} ${m.title} ${m.kind}`,
        };
      }),
    [mockExams],
  );

  const packOptions: SearchableOption<number>[] = useMemo(
    () =>
      pastpaperPacks.map((p) => {
        const sec = pastpaperSectionSummary((p.sections as any[]) || []);
        const mix =
          sec.n === 0 ? "No sections" : sec.hasRw && sec.hasMath ? "R&W + Math" : sec.hasRw ? "English only" : "Math only";
        return {
          value: Number(p.id),
          primary: formatPastpaperPackAdminLabel(p),
          secondary: `${mix} · ${sec.n} section(s)`,
          keywords: `${p.id} ${p.title}`,
        };
      }),
    [pastpaperPacks],
  );

  const assessmentSetOptions: SearchableOption<number>[] = useMemo(
    () =>
      assessmentSets.map((s) => ({
        value: Number(s.id),
        primary: `#${s.id} · ${String(s.title || "")}`,
        secondary: String(s.subject || ""),
        keywords: `${s.id} ${s.title} ${s.subject}`,
      })),
    [assessmentSets],
  );

  const assessmentClassroomOptions: SearchableOption<number>[] = useMemo(
    () =>
      (assessmentClassrooms || []).map((c) => ({
        value: Number(c.id),
        primary: String(c.name || "Class"),
        secondary: `#${c.id} · ${String(c.subject || "").toLowerCase()}`,
        keywords: `${c.id} ${c.name} ${c.subject}`,
      })),
    [assessmentClassrooms],
  );

  const selectedAssessmentSet = useMemo(
    () => assessmentSets.find((s) => Number(s.id) === Number(assessmentSetId)) ?? null,
    [assessmentSets, assessmentSetId],
  );

  const selectedAssessmentClassroom = useMemo(
    () => (assessmentClassrooms || []).find((c) => Number(c.id) === Number(assessmentClassroomId)) ?? null,
    [assessmentClassrooms, assessmentClassroomId],
  );

  const assessmentSubjectMismatch = useMemo(() => {
    if (!selectedAssessmentSet || !selectedAssessmentClassroom) return false;
    const cSub = normalizeClassroomSubject(selectedAssessmentClassroom.subject);
    const sSub = String(selectedAssessmentSet.subject || "").toLowerCase();
    if (!cSub || !sSub) return false;
    return cSub !== sSub;
  }, [selectedAssessmentSet, selectedAssessmentClassroom]);

  const canGoNext = useMemo(() => {
    if (step === 1) return !!kind;
    if (step === 2) {
      if (kind === "assessment_homework") return assessmentSetId != null;
      if (kind === "timed_mock") return mockExamId != null;
      if (kind === "pastpaper") return pastpaperPackId != null && resolvedPastpaperSectionIds.length > 0;
    }
    if (step === 3) {
      if (kind === "assessment_homework") {
        return assessmentClassroomId != null && !assessmentSubjectMismatch;
      }
      return selectedUserIds.length > 0;
    }
    if (step === 4) return true;
    if (step === 5 && kind === "assessment_homework") {
      return (
        assessmentSetId != null &&
        assessmentClassroomId != null &&
        !assessmentSubjectMismatch &&
        !assessmentDupAssignmentId
      );
    }
    return true;
  }, [
    step,
    kind,
    mockExamId,
    pastpaperPackId,
    resolvedPastpaperSectionIds.length,
    selectedUserIds.length,
    assessmentSetId,
    assessmentClassroomId,
    assessmentSubjectMismatch,
    assessmentDupAssignmentId,
  ]);

  const goNext = () => setStep((s) => Math.min(5, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const selectEligibleInView = () => {
    const ids: number[] = [];
    for (const u of filteredStudents) {
      const m = rowMeta(u);
      if (m.selectable) ids.push(u.id);
    }
    setSelectedUserIds(ids);
  };

  const selectAllEligibleGlobally = () => {
    if (!kind) return;
    const ids: number[] = [];
    for (const u of students) {
      if (rowMeta(u).selectable) ids.push(u.id);
    }
    setSelectedUserIds(ids);
  };

  const selectEligibleInClassroom = () => {
    if (!kind || classroomFilter === "all") return;
    const cid = classroomFilter;
    const ids: number[] = [];
    for (const u of students) {
      if (!studentInClassroom(u, cid)) continue;
      if (rowMeta(u).selectable) ids.push(u.id);
    }
    setSelectedUserIds(ids);
  };

  const selectAllInView = () => {
    setSelectedUserIds(filteredStudents.map((u) => u.id));
  };

  const clearSelection = () => setSelectedUserIds([]);

  const applyDispatchRow = (row: AssignmentDispatchRow, targetStep: 3 | 5 = 3) => {
    const payload = row.payload || {};
    const ctx = (payload as Record<string, unknown>).client_context as Record<string, unknown> | undefined;
    const cc = ctx && typeof ctx === "object" ? ctx : {};
    const examIdsFromPayload = Array.isArray((payload as Record<string, unknown>).exam_ids)
      ? ((payload as Record<string, unknown>).exam_ids as unknown[]).map((x) => Number(x)).filter((n) => !Number.isNaN(n))
      : [];
    const practiceIds = Array.isArray((payload as Record<string, unknown>).practice_test_ids)
      ? ((payload as Record<string, unknown>).practice_test_ids as unknown[]).map((x) => Number(x)).filter(Boolean)
      : [];
    let resolvedKind: BulkAssignKind =
      cc.wizard_kind === "pastpaper" || cc.wizard_kind === "timed_mock" ? (cc.wizard_kind as BulkAssignKind) : "pastpaper";
    if (!(cc.wizard_kind === "pastpaper" || cc.wizard_kind === "timed_mock")) {
      if (examIdsFromPayload.length && !practiceIds.length) resolvedKind = "timed_mock";
      else if (!examIdsFromPayload.length && practiceIds.length) resolvedKind = "pastpaper";
      else if (String(row.kind) === "timed_mock") resolvedKind = "timed_mock";
      else if (String(row.kind) === "pastpaper") resolvedKind = "pastpaper";
    }
    const inferred =
      resolvedKind === "pastpaper" && cc.pastpaper_pack_id == null && practiceIds.length
        ? inferPastpaperFromSectionIds(practiceIds, pastpaperPacks as Array<{ id: number; sections?: Array<{ id: number; subject: string }> }>)
        : null;
    setKind(resolvedKind);
    setPastpaperPackId(cc.pastpaper_pack_id != null ? Number(cc.pastpaper_pack_id) : inferred?.packId ?? null);
    setPastpaperScope((cc.pastpaper_scope as PastpaperScope) || inferred?.scope || defaultPastpaperScope);
    setMockExamId(cc.mock_exam_id != null ? Number(cc.mock_exam_id) : null);
    setAssignmentType(String((payload as Record<string, unknown>).assignment_type || "FULL"));
    const ft = (payload as Record<string, unknown>).form_type;
    setFormType(typeof ft === "string" ? ft : "");
    const tf = cc.track_filter;
    if (tf === "ALL" || tf === "MATH" || tf === "ENGLISH") setTrackFilter(tf);
    const ids = Array.isArray((payload as Record<string, unknown>).user_ids)
      ? ((payload as Record<string, unknown>).user_ids as unknown[]).map((x) => Number(x)).filter((n) => !Number.isNaN(n))
      : [];
    setSelectedUserIds(ids);
    setStep(targetStep);
    setError(null);
    setLastResult(null);
  };

  const handleLoadDispatchInWizard = (row: AssignmentDispatchRow) => {
    applyDispatchRow(row, 3);
    showToast("Loaded dispatch into the wizard — review students and run again if needed.");
  };

  const handleRerunDispatch = async (id: number) => {
    setRerunBusyId(id);
    setError(null);
    try {
      const res = (await examsAdminApi.rerunBulkAssignmentDispatch(id)) as Record<string, unknown>;
      const skipped = Number(res.students_skipped_count || 0);
      const granted = Number(res.students_granted_count ?? 0);
      setLastResult(mapAssignApiToLastResult(res, true));
      showToast(
        skipped > 0
          ? `Re-run finished: ${granted} student(s) granted access, ${skipped} skipped (see details below).`
          : `Re-run finished: ${granted} student(s) granted access.`,
      );
      await fetchHistory();
    } catch (e: any) {
      const msg = e?.response?.data?.detail;
      const text = typeof msg === "string" ? msg : "Could not re-run that assignment.";
      setError(text);
      showToast(text);
    } finally {
      setRerunBusyId(null);
    }
  };

  const submit = async () => {
    if (!canAssign || !kind) return;

    if (kind === "assessment_homework") {
      if (!assessmentSetId || !assessmentClassroomId || assessmentSubjectMismatch) {
        showToast("Pick an assessment set and a classroom with a matching subject.");
        return;
      }
      if (assessmentDupAssignmentId) {
        showToast("This classroom already has homework for that set. Change selection or remove the duplicate assignment first.");
        return;
      }
      setSubmitting(true);
      setError(null);
      const idempotencyKey =
        assessmentIdempotencyRef.current ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      assessmentIdempotencyRef.current = idempotencyKey;
      try {
        await assessmentsAdminApi.assignHomework(
          {
            classroom_id: assessmentClassroomId,
            set_id: assessmentSetId,
            title: assessmentTitle.trim() || undefined,
            instructions: assessmentInstructions.trim() || undefined,
            due_at: assessmentDue ? new Date(assessmentDue).toISOString() : null,
          },
          idempotencyKey,
        );
        assessmentIdempotencyRef.current = null;
        showToast("Assessment homework assigned.");
        setLastResult({
          ok: true,
          message: "Homework row created on the class stream.",
        });
        await onAfterSuccess();
        resetFlow({ keepResult: true });
      } catch (err: unknown) {
        assessmentIdempotencyRef.current = null;
        const ax = err as { response?: { status?: number; data?: { detail?: string } } };
        const detail = ax?.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : "Failed to assign assessment homework.";
        setError(msg);
        showToast(msg);
        const st = ax?.response?.status;
        if (st === 409 || st === 400) {
          if (assessmentClassroomId && assessmentSetId) {
            try {
              const rows = await classesApi.listAssignments(assessmentClassroomId);
              const list = rows.items;
              const hit = list.find(
                (a: Assignment) => a.assessment_homework?.set?.id === Number(assessmentSetId),
              );
              setAssessmentDupAssignmentId(hit?.id != null ? Number(hit.id) : null);
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (selectedUserIds.length === 0) {
      showToast("Select at least one student");
      return;
    }
    if (kind === "timed_mock" && !mockExamId) {
      showToast("Select a timed mock");
      return;
    }
    if (kind === "pastpaper" && (!pastpaperPackId || resolvedPastpaperSectionIds.length === 0)) {
      showToast("Select a pastpaper card with sections in the current scope");
      return;
    }

    setSubmitting(true);
    setError(null);
    const isMocks = kind === "timed_mock";
    const contentLabel =
      isMocks && selectedMock
        ? formatMockExamAdminLabel(selectedMock)
        : pastpaperPackId
          ? formatPastpaperPackAdminLabel(pastpaperPacks.find((p) => Number(p.id) === pastpaperPackId))
          : "Assignment";

    const clientContext: Record<string, unknown> = {
      wizard_kind: kind,
      pastpaper_pack_id: pastpaperPackId ?? undefined,
      pastpaper_scope: pastpaperScope,
      mock_exam_id: mockExamId ?? undefined,
      content_label: contentLabel,
      track_filter: trackFilter,
    };

    try {
      const res = (await examsAdminApi.bulkAssignStudents(
        isMocks && mockExamId ? [mockExamId] : [],
        selectedUserIds,
        isMocks ? assignmentType : "FULL",
        isMocks ? formType || undefined : undefined,
        !isMocks && resolvedPastpaperSectionIds.length ? resolvedPastpaperSectionIds : undefined,
        clientContext,
      )) as Record<string, unknown>;

      const added = typeof res?.tests_added === "number" ? res.tests_added : null;
      const matched = typeof res?.practice_tests_matched === "number" ? res.practice_tests_matched : null;
      const requested = typeof res?.practice_tests_requested === "number" ? res.practice_tests_requested : null;
      const skippedN = Number(res.students_skipped_count || 0);
      const grantsCreated =
        typeof res?.subject_grants_created === "number" ? res.subject_grants_created : 0;
      const grantNote =
        grantsCreated > 0
          ? ` ${grantsCreated} subject access grant(s) added for students who had none.`
          : "";

      if (!isMocks && requested != null && matched != null && matched < requested) {
        showToast(
          `Assigned library sections: ${matched} of ${requested} IDs matched. ${selectedUserIds.length} user(s).${grantNote}`,
        );
      } else if (!isMocks && added === 0 && resolvedPastpaperSectionIds.length > 0) {
        showToast("No assignments were saved. Check section IDs.");
      } else {
        showToast(
          skippedN > 0
            ? `Granted where eligible: ${res.students_granted_count ?? "?"} of ${selectedUserIds.length} student(s); ${skippedN} skipped.${grantNote}`
            : added != null
              ? `Granted access (${added} test link(s)) to ${selectedUserIds.length} user(s).${grantNote}`
              : `Assigned access to ${selectedUserIds.length} user(s).${grantNote}`,
        );
      }

      setLastResult(mapAssignApiToLastResult(res, true));
      await fetchHistory();
      await onAfterSuccess();
      resetFlow({ keepResult: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : "Failed to perform bulk assignment";
      setError(msg);
      showToast(msg);
      const body = err?.response?.data;
      if (body && typeof body === "object") {
        setLastResult(mapAssignApiToLastResult(body as Record<string, unknown>, false, msg));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!canAssign) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-900">
        You do not have permission to bulk-assign. Ask an admin to grant <strong>assign_access</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">Bulk assignment</p>
          <h2 className="text-xl font-bold text-foreground">Assign content</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Guided five-step flow for library access (pastpaper / timed mock) or classroom homework (assessments). For
            library runs, access is enforced server-side; students without subject grants still skip sections they
            cannot receive.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          onClick={() => resetFlow()}
        >
          Reset wizard
        </button>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900 flex flex-wrap items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Last result banner */}
      {lastResult ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm flex flex-col gap-2",
            lastResult.ok
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-950"
              : "border-red-200 bg-red-50/90 text-red-950",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              {lastResult.ok ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="font-bold">{lastResult.ok ? "Assignment finished" : "Assignment failed"}</p>
                {lastResult.dispatch_id != null ? (
                  <p className="text-xs opacity-90 mt-0.5">
                    Dispatch #{lastResult.dispatch_id}
                    {lastResult.dispatch_status ? ` · status ${lastResult.dispatch_status}` : ""}
                  </p>
                ) : null}
                <p className="text-xs mt-1">
                  {lastResult.students_granted_count != null && lastResult.students_requested_count != null
                    ? `${lastResult.students_granted_count} of ${lastResult.students_requested_count} students received access in this run.`
                    : null}
                  {lastResult.students_skipped_count != null && lastResult.students_skipped_count > 0 ? (
                    <span className="block text-amber-900 font-medium mt-1">
                      {lastResult.students_skipped_count} student(s) skipped (non-students or no matching subject access).
                    </span>
                  ) : null}
                  {lastResult.tests_added != null ? (
                    <span className="block mt-1">Test links added this run: {lastResult.tests_added}</span>
                  ) : null}
                  {!lastResult.ok && lastResult.message ? (
                    <span className="block mt-1 font-medium">{lastResult.message}</span>
                  ) : null}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors shrink-0"
              onClick={() => setLastResult(null)}
              aria-label="Dismiss result"
            >
              <X className="w-3.5 h-3.5" /> Dismiss
            </button>
          </div>
          {lastResult.skipped_users && lastResult.skipped_users.length > 0 ? (
            <div className="border-t border-black/10 pt-2 mt-1">
              <p className="text-[11px] font-bold uppercase tracking-wide opacity-80 mb-1">Skipped users</p>
              <ul className="max-h-40 overflow-y-auto text-xs space-y-1 list-disc pl-4">
                {lastResult.skipped_users.slice(0, 50).map((s) => (
                  <li key={s.user_id}>
                    <span className="font-semibold">{s.display_name || s.username || `#${s.user_id}`}</span>
                    {s.reason ? <span className="text-muted-foreground"> — {s.reason}</span> : null}
                  </li>
                ))}
              </ul>
              {lastResult.skipped_users.length > 50 ? (
                <p className="text-[11px] mt-1 opacity-80">Showing first 50; full list is in server history.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Horizontal step indicator */}
      <div className="flex items-center gap-0">
        {STEP_META.map((s, idx) => {
          const isCompleted = s.id < step;
          const isActive = s.id === step;
          return (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                    isCompleted
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : s.id}
                </div>
                <div className="text-center hidden sm:block">
                  <p className={cn("text-[10px] font-bold", isActive ? "text-foreground" : "text-muted-foreground")}>
                    {s.title}
                  </p>
                </div>
              </div>
              {idx < STEP_META.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 rounded transition-colors",
                    isCompleted ? "bg-emerald-400" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {loadingUsers ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          Loading directory…
        </div>
      ) : null}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setKind("pastpaper");
              setPastpaperScope(defaultPastpaperScope);
            }}
            className={cn(
              "rounded-2xl border p-6 text-left transition",
              kind === "pastpaper"
                ? "border-primary bg-card ring-2 ring-primary"
                : "border-border bg-card hover:bg-surface-2",
            )}
          >
            <ClipboardList className="w-8 h-8 text-primary mb-3" />
            <h3 className="text-lg font-bold text-foreground">Pastpaper</h3>
            <p className="text-sm text-muted-foreground mt-1">Standalone library sections (English / Math) from a card.</p>
          </button>
          <button
            type="button"
            onClick={() => setKind("timed_mock")}
            className={cn(
              "rounded-2xl border p-6 text-left transition",
              kind === "timed_mock"
                ? "border-primary bg-card ring-2 ring-primary"
                : "border-border bg-card hover:bg-surface-2",
            )}
          >
            <Layers className="w-8 h-8 text-primary mb-3" />
            <h3 className="text-lg font-bold text-foreground">Timed mock</h3>
            <p className="text-sm text-muted-foreground mt-1">Published or draft mock shell — pick sections (full / math / English).</p>
          </button>
          <button
            type="button"
            onClick={() => setKind("assessment_homework")}
            className={cn(
              "rounded-2xl border p-6 text-left transition sm:col-span-2 xl:col-span-1",
              kind === "assessment_homework"
                ? "border-primary bg-card ring-2 ring-primary"
                : "border-border bg-card hover:bg-surface-2",
            )}
          >
            <ListChecks className="w-8 h-8 text-primary mb-3" />
            <h3 className="text-lg font-bold text-foreground">Assessments</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Published LMS assessment set → homework on a classroom (not the same as bulk student grants).
            </p>
          </button>
        </div>
      )}

      {step === 2 && kind === "assessment_homework" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <label className="text-[10px] font-bold text-primary uppercase tracking-widest">Assessment set</label>
          {assessmentSetsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              Loading sets…
            </div>
          ) : (
            <SearchableSelect
              options={assessmentSetOptions}
              value={assessmentSetId}
              onChange={(id) => setAssessmentSetId(id)}
              placeholder="Search published sets…"
              emptyHint="No assessment sets (author on the questions console first)"
            />
          )}
        </div>
      )}

      {step === 2 && kind === "timed_mock" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <label className="text-[10px] font-bold text-primary uppercase tracking-widest">Timed mock</label>
          <SearchableSelect
            options={mockOptions}
            value={mockExamId}
            onChange={(id) => setMockExamId(id)}
            placeholder="Search mocks…"
            emptyHint="No mock exams loaded"
          />
          {!mockExams.length ? (
            <p className="text-xs text-amber-700">Create a mock on the Mock exams tab first.</p>
          ) : null}
        </div>
      )}

      {step === 2 && kind === "pastpaper" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <label className="text-[10px] font-bold text-primary uppercase tracking-widest">Pastpaper card</label>
          <SearchableSelect
            options={packOptions}
            value={pastpaperPackId}
            onChange={(id) => setPastpaperPackId(id)}
            placeholder="Search cards…"
            emptyHint="No pastpaper cards"
          />
          <div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Subject scope</span>
            <div className="flex bg-surface-2 p-1 rounded-xl mt-2 max-w-md">
              {(
                [
                  { id: "BOTH" as const, label: "Both" },
                  { id: "READING_WRITING" as const, label: "English" },
                  { id: "MATH" as const, label: "Math" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPastpaperScope(opt.id)}
                  className={cn(
                    "flex-1 py-2 px-2 rounded-lg text-[11px] font-bold transition",
                    pastpaperScope === opt.id
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Resolves to <strong>{resolvedPastpaperSectionIds.length}</strong> practice section(s) for this assignment
              run.
            </p>
            {pastpaperPackId && resolvedPastpaperSectionIds.length === 0 ? (
              <p className="text-xs text-red-600 mt-1">No sections for this scope — change scope or pick another card.</p>
            ) : null}
          </div>
        </div>
      )}

      {step === 3 && kind === "assessment_homework" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-primary uppercase tracking-widest">Classroom</label>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Homework is created for the whole class. Pick the group that should see this assignment on the class
              stream.
            </p>
          </div>
          {assessmentClassroomsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              Loading classrooms…
            </div>
          ) : (
            <SearchableSelect
              options={assessmentClassroomOptions}
              value={assessmentClassroomId}
              onChange={(id) => setAssessmentClassroomId(id)}
              placeholder="Search classrooms…"
              emptyHint="No classrooms returned for your account"
            />
          )}
          {assessmentSubjectMismatch ? (
            <p className="text-xs font-semibold text-red-600">
              Classroom subject does not match this set — pick a matching pair to continue.
            </p>
          ) : null}
          {assessmentDupAssignmentId ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This classroom already has an assignment linked to this assessment set (assignment #
              {assessmentDupAssignmentId}). The server may reject creating another duplicate.
            </div>
          ) : null}
        </div>
      )}

      {step === 3 && kind !== "assessment_homework" && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Filters toolbar */}
          <div className="p-4 border-b border-border flex flex-wrap gap-3 items-end bg-surface-2">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Search</span>
              <input
                className="input-modern text-sm"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Name, username, email…"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[140px]">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Classroom</span>
              <select
                className="input-modern text-sm"
                value={classroomFilter === "all" ? "all" : String(classroomFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setClassroomFilter(v === "all" ? "all" : Number(v));
                }}
              >
                <option value="all">All classrooms</option>
                {classroomOptions.map(([id, name]) => (
                  <option key={id} value={String(id)}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[130px]">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Subject track</span>
              <select
                className="input-modern text-sm"
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.target.value as TrackFilter)}
              >
                <option value="ALL">All tracks</option>
                <option value="MATH">Math track</option>
                <option value="ENGLISH">English track</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
              {[
                { label: "Clear selection", action: clearSelection, disabled: false },
                { label: "Select all in view", action: selectAllInView, disabled: false },
                { label: "Eligible in view", action: selectEligibleInView, disabled: false },
                {
                  label: "Eligible in classroom",
                  action: selectEligibleInClassroom,
                  disabled: classroomFilter === "all",
                  title: classroomFilter === "all" ? "Pick a classroom first" : undefined,
                },
                { label: "All eligible students", action: selectAllEligibleGlobally, disabled: !kind },
              ].map(({ label, action, disabled, title }) => (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  title={title}
                  onClick={action}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Student table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 w-10">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-4 py-2.5">Subject access</th>
                  <th className="px-4 py-2.5">Classrooms</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Assignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No students match these filters.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((u) => {
                    const meta = rowMeta(u);
                    const g = u.bulk_assign_profile?.subject_grants;
                    const checked = selectedUserIds.includes(u.id);
                    return (
                      <tr key={u.id} className={meta.selectable ? "hover:bg-surface-2/50" : "bg-surface-2/30"}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            className="rounded border-border"
                            checked={checked}
                            title={
                              meta.selectable
                                ? undefined
                                : `${meta.reason ?? "May be skipped"} — server only grants when subject access exists`
                            }
                            onChange={(e) => {
                              if (e.target.checked) setSelectedUserIds((prev) => [...new Set([...prev, u.id])]);
                              else setSelectedUserIds((prev) => prev.filter((id) => id !== u.id));
                            }}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">{studentDisplayName(u)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={g?.math ? "text-emerald-700 font-medium" : "text-muted-foreground"}>Math</span>
                          <span className="mx-1 text-muted-foreground/40">·</span>
                          <span className={g?.english ? "text-emerald-700 font-medium" : "text-muted-foreground"}>R&amp;W</span>
                          {!u.bulk_assign_profile ? (
                            <span className="block text-amber-600 mt-0.5">Refresh user list for access data</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px]">
                          {(u.bulk_assign_profile?.classrooms || []).length
                            ? u.bulk_assign_profile!.classrooms.map((c) => c.name).join(", ")
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs">{accountStatusLabel(u)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {!meta.selectable ? (
                            <span className="text-red-600 font-medium">{meta.reason}</span>
                          ) : meta.partialHint ? (
                            <span className="text-amber-700 font-medium">{meta.partialHint}</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">Eligible</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 4 && kind === "timed_mock" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Sections to assign</span>
            <div className="flex flex-wrap gap-2 mt-2 bg-surface-2 p-1 rounded-2xl max-w-xl">
              {[
                { id: "FULL", label: "Full exam" },
                { id: "MATH", label: "Math only" },
                { id: "ENGLISH", label: "English only" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAssignmentType(t.id)}
                  className={cn(
                    "flex-1 min-w-[100px] py-2.5 px-3 rounded-xl text-xs font-bold transition",
                    assignmentType === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Form filter</span>
            <div className="flex flex-wrap gap-2 mt-2 bg-surface-2 p-1 rounded-2xl max-w-xl">
              {[
                { id: "", label: "All forms" },
                { id: "INTERNATIONAL", label: "International" },
                { id: "US", label: "US" },
              ].map((t) => (
                <button
                  key={t.id || "all"}
                  type="button"
                  onClick={() => setFormType(t.id)}
                  className={cn(
                    "flex-1 min-w-[90px] py-2.5 px-3 rounded-xl text-xs font-bold transition",
                    formType === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground border border-border rounded-xl p-3 bg-surface-2">
            Section mode, form filter, and selected students are stored with each dispatch on the server (see history).
          </p>
        </div>
      )}

      {step === 4 && kind === "pastpaper" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-foreground">
            Subject scope is set in step 2. Adjust there if you need only English or Math sections from this card.
          </p>
          <p className="text-xs text-muted-foreground border border-border rounded-xl p-3 bg-surface-2">
            Section list, form filter, and student list are stored on the server with each dispatch (see history). The
            API does not support per-student deadlines here — use class assignments for due dates if you need them.
          </p>
        </div>
      )}

      {step === 4 && kind === "assessment_homework" && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-foreground">Optional fields shown to students on the class homework card.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Due at (optional)</span>
              <input className="input-modern" type="datetime-local" value={assessmentDue} onChange={(e) => setAssessmentDue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Title override (optional)</span>
              <input className="input-modern" value={assessmentTitle} onChange={(e) => setAssessmentTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Instructions (optional)</span>
              <textarea className="input-modern min-h-[90px]" value={assessmentInstructions} onChange={(e) => setAssessmentInstructions(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {step === 5 && kind === "assessment_homework" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-primary" /> Assessment set
            </h3>
            <p className="text-sm text-foreground">
              {selectedAssessmentSet
                ? `#${selectedAssessmentSet.id} · ${String(selectedAssessmentSet.title || "")}`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Subject: {String(selectedAssessmentSet?.subject || "—")}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" /> Classroom
            </h3>
            <p className="text-sm text-foreground">
              {selectedAssessmentClassroom
                ? `${String(selectedAssessmentClassroom.name || "Class")} (#${selectedAssessmentClassroom.id})`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Subject: {String(selectedAssessmentClassroom?.subject || "—")}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2 space-y-2">
            <h3 className="text-sm font-bold text-foreground">Homework details</h3>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Due:</span>{" "}
              {assessmentDue ? new Date(assessmentDue).toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Title override:</span> {assessmentTitle.trim() || "—"}
            </p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              <span className="font-semibold text-foreground">Instructions:</span> {assessmentInstructions.trim() || "—"}
            </p>
          </div>
          {assessmentDupAssignmentId ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">
              Duplicate warning: assignment #{assessmentDupAssignmentId} already uses this set on this class. Confirm
              may still fail server-side.
            </div>
          ) : null}
          <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2 space-y-2">
            <h3 className="text-sm font-bold text-foreground">What happens next</h3>
            <p className="text-xs text-muted-foreground">
              Confirm creates a homework row on the class stream (not a bulk library dispatch). Assignment history below
              stays for pastpaper / timed mock runs only.
            </p>
          </div>
        </div>
      )}

      {step === 5 && kind && kind !== "assessment_homework" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Content
            </h3>
            <p className="text-sm text-foreground">
              {kind === "timed_mock" && selectedMock
                ? formatMockExamAdminLabel(selectedMock)
                : pastpaperPackId
                  ? formatPastpaperPackAdminLabel(pastpaperPacks.find((p) => Number(p.id) === pastpaperPackId))
                  : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {kind === "pastpaper"
                ? `Scope: ${pastpaperScope} · ${resolvedPastpaperSectionIds.length} section(s)`
                : `Sections: ${assignmentType}${formType ? ` · ${formType}` : ""}`}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Students ({selectedUserIds.length})
            </h3>
            <p className="text-xs text-muted-foreground max-h-28 overflow-y-auto">
              {selectedUserIds
                .map((id) => {
                  const u = users.find((x) => x.id === id);
                  return u ? studentDisplayName(u) : `#${id}`;
                })
                .join(", ")}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2 space-y-2">
            <h3 className="text-sm font-bold text-foreground">What gets saved</h3>
            <p className="text-xs text-muted-foreground">
              After you confirm, the server records this run (content, students, outcome, status). Use{" "}
              <strong>Use in wizard</strong> in history to reload a dispatch, or <strong>Re-run</strong> to replay the
              stored payload immediately.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
        <button
          type="button"
          disabled={step <= 1}
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {step < 5 ? (
          <button
            type="button"
            disabled={!canGoNext}
            onClick={goNext}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Next <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting || !canGoNext}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {submitting ? (kind === "assessment_homework" ? "Assigning…" : "Granting…") : "Confirm & assign"}
          </button>
        )}
      </div>

      <AssignmentHistoryPanel
        entries={history}
        loading={historyLoading}
        error={historyError}
        onRefresh={() => void fetchHistory()}
        onLoadInWizard={handleLoadDispatchInWizard}
        onRerun={(id) => void handleRerunDispatch(id)}
        rerunBusyId={rerunBusyId}
      />
    </div>
  );
}
