"use client";

/**
 * Gradebook — student × assignment matrix for one class, from real data
 * (people + listAssignments + listSubmissions). Cells carry status + grade.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";

export type Cell = { assignmentId: number; status: "graded" | "submitted" | "missing"; grade: number | null };
export type StudentRow = { id: number; name: string; avatarUrl?: string | null; cells: Cell[]; average: number | null; trendDelta: number | null; missing: number };
export type AssignmentCol = { id: number; title: string };
export type GradebookModel = {
  assignments: AssignmentCol[];
  students: StudentRow[];
  classAverage: number | null;
  distribution: { band: string; count: number }[];
  missingCount: number;
};
export type ClassOption = { id: number; name: string };
/** A load that did not come back, with the server's reason if it gave one (a 403 or 404 does; a crash or a dropped connection does not). */
export type LoadError = { detail: string | null };

const ASSIGNMENT_CAP = 12;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
function toNum(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** The server's `detail` from a rejected request. Anything else (an HTML error page, no answer at all) gives no reason. */
function loadErrorOf(e: unknown): LoadError { const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail; return { detail: typeof d === "string" ? d : null }; }

export type GradebookData = {
  status: "booting" | "unauthenticated" | "error" | "empty" | "ready";
  classes: ClassOption[];
  selectedClassId: number | null;
  setSelectedClassId: (id: number) => void;
  loading: boolean;
  model: GradebookModel | null;
  /** The class list did not load (status "error"). */
  classListError: LoadError | null;
  retryClassList: () => void;
  /** The selected class's matrix did not load, or not all of it. None of it is drawn: every number on it is taken over all of its homework. */
  matrixError: LoadError | null;
  retryMatrix: () => void;
};

export function useGradebook(preview?: { classes: ClassOption[]; model: GradebookModel }): GradebookData {
  const { bootState } = useMe();
  const [classes, setClasses] = useState<ClassOption[]>(preview?.classes ?? []);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(preview?.classes[0]?.id ?? null);
  const [model, setModel] = useState<GradebookModel | null>(preview?.model ?? null);
  const [loading, setLoading] = useState(!preview);
  const [empty, setEmpty] = useState(false);
  const [classListError, setClassListError] = useState<LoadError | null>(null);
  const [matrixError, setMatrixError] = useState<LoadError | null>(null);
  // "Try again" bumps a counter to run its load's effect again.
  const [classListTries, setClassListTries] = useState(0);
  const [matrixTries, setMatrixTries] = useState(0);

  // Load class list once, and again on "Try again".
  useEffect(() => {
    if (preview) return;
    if (bootState !== "AUTHENTICATED") { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const res = await classesApi.list();
      const managed = (res.items as Array<{ id: number; name?: string; my_role?: string }>).filter((c) => c.my_role && c.my_role !== "student");
      if (cancelled) return;
      if (managed.length === 0) { setEmpty(true); setLoading(false); return; }
      setClasses(managed.map((c) => ({ id: c.id, name: c.name || "Class" })));
      setSelectedClassId((cur) => cur ?? managed[0].id);
    })().catch((e: unknown) => { if (!cancelled) { setClassListError(loadErrorOf(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bootState, preview, classListTries]);

  // Load matrix for the selected class, and again on "Try again".
  useEffect(() => {
    if (preview || selectedClassId == null) return;
    let cancelled = false;
    setLoading(true);
    setMatrixError(null);
    (async () => {
      const [peopleRes, aRes] = await Promise.all([
        classesApi.people(selectedClassId),
        classesApi.listAssignments(selectedClassId),
      ]);
      if (cancelled) return;
      const members = (Array.isArray(peopleRes) ? peopleRes : (peopleRes as { members?: unknown[] }).members ?? (peopleRes as { items?: unknown[] }).items ?? []) as Array<{ role?: string; user?: { id: number; first_name?: string; last_name?: string; email?: string; profile_image_url?: string | null } }>;
      const students = members.filter((m) => (m.role ?? "student").toLowerCase() === "student" && m.user).map((m) => m.user!);
      const assignments = (aRes.items as Array<{ id: number; title?: string; created_at?: string }>).slice(0, ASSIGNMENT_CAP);

      // submissions per assignment → studentId -> {status, grade}
      const subByAssignment = new Map<number, Map<number, { status: Cell["status"]; grade: number | null }>>();
      await mapWithConcurrency(assignments, 4, async (a) => {
        const subs = (await classesApi.listSubmissions(selectedClassId, a.id)) as Array<{ student?: { id: number }; workflow_status?: string; review?: { grade?: unknown } | null }>;
        const map = new Map<number, { status: Cell["status"]; grade: number | null }>();
        (Array.isArray(subs) ? subs : []).forEach((s) => {
          if (!s.student) return;
          const ws = s.workflow_status;
          const grade = toNum(s.review?.grade);
          const stat: Cell["status"] = ws === "GRADED" ? "graded" : ws === "SUBMITTED" || ws === "RETURNED" ? "submitted" : "missing";
          map.set(s.student.id, { status: stat, grade });
        });
        subByAssignment.set(a.id, map);
      });
      if (cancelled) return;

      const assignmentCols: AssignmentCol[] = assignments.map((a) => ({ id: a.id, title: a.title || "Assignment" }));
      const studentRows: StudentRow[] = students.map((u) => {
        const cells: Cell[] = assignmentCols.map((col) => {
          const v = subByAssignment.get(col.id)?.get(u.id);
          return { assignmentId: col.id, status: v?.status ?? "missing", grade: v?.grade ?? null };
        });
        const graded = cells.filter((c) => c.grade != null).map((c) => c.grade as number);
        const average = graded.length ? Math.round(graded.reduce((a, b) => a + b, 0) / graded.length) : null;
        const trendDelta = graded.length >= 2 ? graded[graded.length - 1] - graded[0] : null;
        const missing = cells.filter((c) => c.status === "missing").length;
        return { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "Student", avatarUrl: u.profile_image_url ?? null, cells, average, trendDelta, missing };
      });

      const allAverages = studentRows.map((s) => s.average).filter((x): x is number => x != null);
      const classAverage = allAverages.length ? Math.round(allAverages.reduce((a, b) => a + b, 0) / allAverages.length) : null;
      const bands = [
        { band: "0–49", count: 0 }, { band: "50–69", count: 0 }, { band: "70–84", count: 0 }, { band: "85–100", count: 0 },
      ];
      allAverages.forEach((a) => { bands[a < 50 ? 0 : a < 70 ? 1 : a < 85 ? 2 : 3].count += 1; });
      const missingCount = studentRows.reduce((sum, s) => sum + s.missing, 0);

      setModel({ assignments: assignmentCols, students: studentRows, classAverage, distribution: bands, missingCount });
      setLoading(false);
    })().catch((e: unknown) => { if (!cancelled) { setModel(null); setMatrixError(loadErrorOf(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [selectedClassId, preview, matrixTries]);

  const retryClassList = useCallback(() => {
    // Its effect does not mark the page loading (on arrival it already is), so the retry does. Left
    // out, the page would read "No students yet" while the class list loads.
    setClassListError(null);
    setLoading(true);
    setClassListTries((n) => n + 1);
  }, []);
  const retryMatrix = useCallback(() => setMatrixTries((n) => n + 1), []);

  const status = useMemo<GradebookData["status"]>(() => {
    if (preview) return "ready";
    if (bootState === "BOOTING") return "booting";
    if (bootState !== "AUTHENTICATED") return "unauthenticated";
    if (classListError) return "error";
    if (empty) return "empty";
    return "ready";
  }, [bootState, classListError, empty, preview]);

  return { status, classes, selectedClassId, setSelectedClassId, loading, model, classListError, retryClassList, matrixError, retryMatrix };
}
