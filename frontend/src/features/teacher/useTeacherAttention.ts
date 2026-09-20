"use client";

/**
 * Students needing support, across the classes the caller teaches.
 *
 * This is the one dashboard block still assembled client-side, one request per class. The
 * signals live 150 lines deep inside the `interventions` ViewSet action, and lifting them into
 * a service belongs to the sub-project that rebuilds the students screens — see the foundation
 * spec, 4.4. Until then this hook exists so the block costs ONE request per class instead of
 * the two the old dashboard spent: the second was the leaderboard, read only for a trend chart
 * that the rebuilt dashboard no longer draws.
 */

import { useCallback, useEffect, useState } from "react";
import { classesApi } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { classesWithCapability } from "./classesWithCapability";

export type AttentionRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  reason: string;
  tone: "warning" | "danger";
};

type Student = { student_id: number; first_name?: string; last_name?: string; email?: string; profile_image_url?: string | null };
type Interventions = {
  overdue_students?: (Student & { overdue_count: number })[];
  low_score_students?: (Student & { avg_score_pct: number })[];
};

function fullName(s: Student): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email || "Student";
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type AttentionState = {
  status: "loading" | "error" | "ready";
  rows: AttentionRow[];
  /** The server's reason when it gave one. A crash or a dropped connection gives none. */
  detail: string | null;
  /**
   * How many classes the caller teaches. Null until the list has actually come back — the
   * dashboard tells a teacher they have no classes only from a zero it has SEEN, never from a
   * list that failed or has not arrived.
   */
  classCount: number | null;
  retry: () => void;
};

export function useTeacherAttention(preview?: AttentionRow[]): AttentionState {
  const { bootState } = useMe();
  const [rows, setRows] = useState<AttentionRow[]>([]);
  const [status, setStatus] = useState<AttentionState["status"]>("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const [classCount, setClassCount] = useState<number | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (preview) { setRows(preview); setStatus("ready"); return; }
    if (bootState !== "AUTHENTICATED") return;
    let cancelled = false;
    setStatus("loading");
    setDetail(null);
    (async () => {
      const classes = await classesApi.list();
      const managed = classesWithCapability(
        classes.items as Array<{ id: number; name?: string; my_role?: string }>,
        "canViewClassAnalytics",
      );
      if (cancelled) return;
      setClassCount(managed.length);
      const per = await mapWithConcurrency(managed, 4, async (c) => ({
        c,
        iv: (await classesApi.getInterventions(c.id)) as Interventions,
      }));
      if (cancelled) return;

      const out: AttentionRow[] = [];
      const seen = new Set<string>();
      for (const { c, iv } of per) {
        const cname = c.name || "Class";
        for (const s of iv?.low_score_students ?? []) {
          const key = `${c.id}-${s.student_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ id: key, name: fullName(s), avatarUrl: s.profile_image_url ?? null, reason: `Average ${s.avg_score_pct}% · ${cname}`, tone: "danger" });
        }
        for (const s of iv?.overdue_students ?? []) {
          const key = `${c.id}-${s.student_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // "Not turned in", never "failed to submit": the copy a teacher reads about a
          // student is growth-oriented everywhere in this product.
          out.push({ id: key, name: fullName(s), avatarUrl: s.profile_image_url ?? null, reason: `${s.overdue_count} not turned in · ${cname}`, tone: "warning" });
        }
      }
      if (!cancelled) { setRows(out); setStatus("ready"); }
    })().catch((e: unknown) => {
      if (cancelled) return;
      const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
      setDetail(typeof d === "string" ? d : null);
      // A count read before one class's interventions failed would let the page draw a
      // conclusion from half the classes. Forget it: the block says it failed instead.
      setClassCount(null);
      setStatus("error");
    });
    return () => { cancelled = true; };
  }, [bootState, preview, tries]);

  const retry = useCallback(() => setTries((t) => t + 1), []);
  return { status, rows, detail, classCount, retry };
}
