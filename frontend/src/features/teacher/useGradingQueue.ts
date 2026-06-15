"use client";

/**
 * Grading queue — collects submissions awaiting a grade across the teacher's
 * classes (workflow_status === "SUBMITTED"). Real data via classesApi.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";

export type GradeFile = { url: string; file_name?: string; file_type?: string };
export type Submission = {
  id: number;
  status: string;
  revision: number;
  submitted_at?: string | null;
  workflow_status: string;
  files?: GradeFile[];
  attempt?: { id?: number; score?: number | null; practice_test_title?: string | null } | null;
  student?: { id: number; first_name?: string; last_name?: string; email?: string };
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

export function studentName(s?: Submission["student"]) {
  if (!s) return "Student";
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email || "Student";
}

export type GradingData = {
  status: "booting" | "unauthenticated" | "ready";
  items: QueueItem[];
  loading: boolean;
  grade: (item: QueueItem, payload: { grade: number; feedback: string }) => Promise<boolean>;
};

export function useGradingQueue(previewItems?: QueueItem[]): GradingData {
  const { bootState } = useMe();
  const [items, setItems] = useState<QueueItem[]>(previewItems ?? []);
  const [loading, setLoading] = useState(!previewItems);

  useEffect(() => {
    if (previewItems) return;
    if (bootState !== "AUTHENTICATED") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const classesRes = await classesApi.list().catch(() => ({ items: [] as Array<{ id: number; name?: string; my_role?: string }> }));
      const managed = (classesRes.items as Array<{ id: number; name?: string; my_role?: string }>).filter((c) => c.my_role && c.my_role !== "student");
      if (cancelled) return;

      // (class, assignment) pairs to inspect.
      const pairs: { classId: number; className: string; assignmentId: number; assignmentTitle: string }[] = [];
      await mapWithConcurrency(managed, 4, async (c) => {
        const aRes = await classesApi.listAssignments(c.id).catch(() => ({ items: [] }));
        (aRes.items as Array<{ id: number; title?: string }>).slice(0, ASSIGNMENTS_PER_CLASS_CAP).forEach((a) => {
          pairs.push({ classId: c.id, className: c.name || "Class", assignmentId: a.id, assignmentTitle: a.title || "Assignment" });
        });
      });
      if (cancelled) return;

      const collected: QueueItem[] = [];
      await mapWithConcurrency(pairs, 4, async (p) => {
        const subs = (await classesApi.listSubmissions(p.classId, p.assignmentId).catch(() => [])) as Submission[];
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
    })();
    return () => { cancelled = true; };
  }, [bootState, previewItems]);

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
    return "ready";
  }, [bootState, previewItems]);

  return { status, items, loading, grade };
}
