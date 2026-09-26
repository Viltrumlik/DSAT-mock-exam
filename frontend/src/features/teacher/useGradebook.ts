"use client";

/**
 * Gradebook — student × assignment matrix for one class, from real data
 * (people + listAssignments + listSubmissions). Cells carry status + grade.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { classesWithCapability } from "./classesWithCapability";
// A pure, React-free reading of the server's `composed_grade`, declared beside the read that
// carries it. The dependency runs one way only: nothing in `features/classroom` reaches back
// into the teacher kit, which the student host also mounts.
import { describeManualShare, type ComposedGrade } from "@/features/classroom/submissionsApi";

/**
 * Where a cell's number came from, on homework whose teacher's mark carries a share of the grade.
 * Undefined on every other homework, which is nearly all of it.
 */
export type CellComposition = "final" | "awaiting" | "unavailable";
export type Cell = { assignmentId: number; status: "graded" | "submitted" | "missing"; grade: number | null; composed?: CellComposition };
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
/** The server's `detail` from a rejected request. Anything else (an HTML error page, no answer at all) gives no reason. */
function loadErrorOf(e: unknown): LoadError { const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail; return { detail: typeof d === "string" ? d : null }; }

const ASSIGNMENT_CAP = 12;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
/**
 * A grade as the API sends it — a two-decimal string — or nothing.
 *
 * `null` and `""` are guarded before `Number` sees them: both convert to 0, and a review saved
 * with feedback but no mark carries exactly `grade: null`. That review put a **zero** in the
 * gradebook for a teacher who wrote a comment and had not marked yet — banded 0–49, counted into
 * the student's average, the class average and the spread.
 */
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The number one cell stands for, and where it came from.
 *
 * `review.grade` is the teacher's own mark. On homework that gives that mark a share of the
 * grade it is not the grade: with a 20% share, a teacher's 50 sits inside a grade the server
 * composed as 70, and reading the mark as the whole both printed the wrong number and banded a
 * passing grade amber. The same wrong number then ran on into the student's average, their
 * trend, the class average and the distribution, because all four are taken over these cells.
 *
 * Neither number is re-derived here — the composition is the server's, read through the same
 * `describeManualShare` the classroom screens use, so the two readings cannot drift apart.
 *
 * A mark that is still owed, and a composition that could not be worked out, both give no number
 * at all: a part-composed percent shown as the grade would read as a low grade rather than an
 * unfinished one. `composed` is what lets the cell say which of the two it is.
 */
export function cellGrade(row: {
  review?: { grade?: unknown } | null;
  composed_grade?: ComposedGrade | null;
}): { grade: number | null; composed?: CellComposition } {
  const share = describeManualShare(row.composed_grade);
  if (!share) return { grade: toNum(row.review?.grade) };
  if (share.unavailable) return { grade: null, composed: "unavailable" };
  if (share.awaiting) return { grade: null, composed: "awaiting" };
  return { grade: share.percent, composed: "final" };
}
/** How far a student's grade moved: the newest minus the oldest, from grades in the order the homework was given. */
export function gradeTrend(gradesOldestFirst: number[]): number | null {
  return gradesOldestFirst.length >= 2 ? gradesOldestFirst[gradesOldestFirst.length - 1] - gradesOldestFirst[0] : null;
}

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
      const managed = classesWithCapability(res.items as Array<{ id: number; name?: string; my_role?: string }>, "canGrade");
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
      // Drafts stay out, before the cap: no student has been given one, so its column would be all "missing"
      // and would take a slot from homework they were given. A row that names no status is kept.
      const assignments = aRes.items.filter((a) => a.status !== "DRAFT").slice(0, ASSIGNMENT_CAP);

      // submissions per assignment → studentId -> {status, grade}
      type CellValue = { status: Cell["status"]; grade: number | null; composed?: CellComposition };
      const subByAssignment = new Map<number, Map<number, CellValue>>();
      await mapWithConcurrency(assignments, 4, async (a) => {
        const subs = (await classesApi.listSubmissions(selectedClassId, a.id)) as Array<{ student?: { id: number }; workflow_status?: string; review?: { grade?: unknown } | null; composed_grade?: ComposedGrade | null }>;
        const map = new Map<number, CellValue>();
        (Array.isArray(subs) ? subs : []).forEach((s) => {
          if (!s.student) return;
          const ws = s.workflow_status;
          const { grade, composed } = cellGrade(s);
          const stat: Cell["status"] = ws === "GRADED" ? "graded" : ws === "SUBMITTED" || ws === "RETURNED" ? "submitted" : "missing";
          map.set(s.student.id, { status: stat, grade, composed });
        });
        subByAssignment.set(a.id, map);
      });
      if (cancelled) return;

      const assignmentCols: AssignmentCol[] = assignments.map((a) => ({ id: a.id, title: a.title || "Assignment" }));
      const studentRows: StudentRow[] = students.map((u) => {
        const cells: Cell[] = assignmentCols.map((col) => {
          const v = subByAssignment.get(col.id)?.get(u.id);
          return { assignmentId: col.id, status: v?.status ?? "missing", grade: v?.grade ?? null, composed: v?.composed };
        });
        const graded = cells.filter((c) => c.grade != null).map((c) => c.grade as number);
        const average = graded.length ? Math.round(graded.reduce((a, b) => a + b, 0) / graded.length) : null;
        // The columns keep the order `listAssignments` sends, newest-given first, so the grades run backwards in time.
        const trendDelta = gradeTrend([...graded].reverse());
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
