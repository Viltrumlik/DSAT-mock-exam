"use client";

/**
 * Grading queue — collects submissions awaiting a grade across the teacher's
 * classes (workflow_status === "SUBMITTED"). Real data via classesApi.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { classesWithCapability } from "./classesWithCapability";

export type GradeFile = { url: string; file_name?: string; file_type?: string };
export type Submission = {
  id: number;
  status: string;
  revision: number;
  submitted_at?: string | null;
  workflow_status: string;
  files?: GradeFile[];
  attempt?: { id?: number; score?: number | null; practice_test_title?: string | null } | null;
  student?: { id: number; first_name?: string; last_name?: string; email?: string; profile_image_url?: string | null };
  review?: { grade?: number | string | null; feedback?: string | null } | null;
};
export type QueueItem = {
  key: string;
  submission: Submission;
  classId: number;
  className: string;
  assignmentId: number;
  assignmentTitle: string;
};

const ASSIGNMENTS_PER_CLASS_CAP = 12;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A load that did not come back, with the server's reason if it gave one (a 403 or 404 does; a crash or a dropped connection does not). */
export type LoadError = { detail: string | null };
/** The server's `detail` from a rejected request. Anything else (an HTML error page, no answer at all) gives no reason. */
function loadErrorOf(e: unknown): LoadError { const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail; return { detail: typeof d === "string" ? d : null }; }

export function studentName(s?: Submission["student"]) {
  if (!s) return "Student";
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email || "Student";
}

export type GradingData = {
  status: "booting" | "unauthenticated" | "error" | "ready";
  items: QueueItem[];
  loading: boolean;
  /** The queue did not load, or not all of it (status "error"), so none of it is listed. */
  error: LoadError | null;
  retry: () => void;
  grade: (item: QueueItem, payload: { grade: number; feedback: string }) => Promise<boolean>;
};

export function useGradingQueue(previewItems?: QueueItem[]): GradingData {
  const { bootState } = useMe();
  const [items, setItems] = useState<QueueItem[]>(previewItems ?? []);
  const [loading, setLoading] = useState(!previewItems);
  const [error, setError] = useState<LoadError | null>(null);
  // "Try again" bumps this to run the load again.
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (previewItems) return;
    if (bootState !== "AUTHENTICATED") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const classesRes = await classesApi.list();
      const managed = classesWithCapability(classesRes.items as Array<{ id: number; name?: string; my_role?: string }>, "canGrade");
      if (cancelled) return;

      // (class, assignment) pairs to inspect.
      const pairs: { classId: number; className: string; assignmentId: number; assignmentTitle: string }[] = [];
      await mapWithConcurrency(managed, 4, async (c) => {
        const aRes = await classesApi.listAssignments(c.id);
        // Drafts stay out, before the cap: no student has been given one, and drafts listed first would take
        // the slots of homework with work waiting. A row that names no status is kept.
        aRes.items.filter((a) => a.status !== "DRAFT").slice(0, ASSIGNMENTS_PER_CLASS_CAP).forEach((a) => {
          pairs.push({ classId: c.id, className: c.name || "Class", assignmentId: a.id, assignmentTitle: a.title || "Assignment" });
        });
      });
      if (cancelled) return;

      const collected: QueueItem[] = [];
      await mapWithConcurrency(pairs, 4, async (p) => {
        const subs = (await classesApi.listSubmissions(p.classId, p.assignmentId)) as Submission[];
        (Array.isArray(subs) ? subs : []).forEach((s) => {
          if (s.workflow_status === "SUBMITTED") {
            collected.push({ key: `${p.assignmentId}-${s.id}`, submission: s, classId: p.classId, className: p.className, assignmentId: p.assignmentId, assignmentTitle: p.assignmentTitle });
          }
        });
      });
      if (cancelled) return;
      collected.sort((a, b) => new Date(a.submission.submitted_at || 0).getTime() - new Date(b.submission.submitted_at || 0).getTime());
      setItems(collected);
      setLoading(false);
    })().catch((e: unknown) => { if (!cancelled) { setError(loadErrorOf(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bootState, previewItems, tries]);

  const retry = useCallback(() => setTries((n) => n + 1), []);

  const grade = useCallback(async (item: QueueItem, payload: { grade: number; feedback: string }) => {
    if (previewItems) { setItems((cur) => cur.filter((x) => x.key !== item.key)); return true; }
    try {
      await classesApi.gradeSubmission(item.submission.id, {
        grade: payload.grade,
        feedback: payload.feedback,
        expected_revision: item.submission.revision,
      });
      setItems((cur) => cur.filter((x) => x.key !== item.key));
      return true;
    } catch {
      return false;
    }
  }, [previewItems]);

  const status = useMemo<GradingData["status"]>(() => {
    if (previewItems) return "ready";
    if (bootState === "BOOTING") return "booting";
    if (bootState !== "AUTHENTICATED") return "unauthenticated";
    if (error) return "error";
    return "ready";
  }, [bootState, error, previewItems]);

  return { status, items, loading, error, retry, grade };
}
