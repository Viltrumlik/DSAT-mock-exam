"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { StateTag } from "@/components/governance";
import { SendHorizonal, CheckCircle2, AlertTriangle, ArrowRight, Rocket } from "lucide-react";

/** Days after which a draft is considered stale — needs review or archival. */
const STALE_DRAFT_DAYS = 30;

type PublishCandidate = {
  set: AssessmentSet;
  activeQuestions: number;
  inactiveQuestions: number;
  totalQuestions: number;
  readyToPublish: boolean;
  issues: string[];
  /** Draft has not been updated in >STALE_DRAFT_DAYS days. */
  isStale: boolean;
  /** Days since last update (null if no updated_at). */
  daysSinceUpdate: number | null;
};

function analyzeSet(set: AssessmentSet): PublishCandidate {
  const qs = set.questions ?? [];
  const active = qs.filter((q) => q.is_active).length;
  const inactive = qs.length - active;

  const issues: string[] = [];
  if (qs.length === 0) issues.push("No questions");
  if (active === 0 && qs.length > 0) issues.push("No active questions");
  if (!set.title?.trim()) issues.push("Missing title");
  if (!set.category?.trim()) issues.push("No category assigned");

  const updatedAt = set.updated_at ? new Date(set.updated_at) : null;
  const daysSinceUpdate = updatedAt
    ? Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = daysSinceUpdate != null && daysSinceUpdate >= STALE_DRAFT_DAYS;

  return {
    set,
    activeQuestions: active,
    inactiveQuestions: inactive,
    totalQuestions: qs.length,
    readyToPublish: issues.length === 0,
    issues,
    isStale,
    daysSinceUpdate,
  };
}

const SUBJECT_COLORS: Record<string, string> = {
  math: "bg-purple-100 text-purple-800",
  english: "bg-teal-100 text-teal-800",
};

export default function PublishQueuePage() {
  const [sets, setSets] = useState<AssessmentSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await assessmentsAdminApi.listSets({ limit: 200 });
        if (!cancelled) setSets(data.results);
      } catch {
        if (!cancelled) setError("Could not load assessment sets.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const candidates = useMemo<PublishCandidate[]>(
    () =>
      sets
        .filter((s) => !s.is_active) // DRAFT sets only
        .map(analyzeSet)
        .sort((a, b) => {
          if (a.readyToPublish !== b.readyToPublish) return a.readyToPublish ? -1 : 1;
          return a.set.title.localeCompare(b.set.title);
        }),
    [sets],
  );

  const readyCount = candidates.filter((c) => c.readyToPublish).length;
  const blockedCount = candidates.filter((c) => !c.readyToPublish && !c.isStale).length;
  const staleCount = candidates.filter((c) => c.isStale).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Publish Queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft assessment sets awaiting review and publication. Publishing creates an immutable
          snapshot that can be assigned to classrooms.
        </p>
      </div>

      {/* Stats row */}
      {!loading && candidates.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-foreground">{candidates.length}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">In queue</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-emerald-700">{readyCount}</p>
            <p className="text-[10px] font-bold text-emerald-700/70 uppercase tracking-widest mt-0.5">Ready</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-amber-700">{blockedCount}</p>
            <p className="text-[10px] font-bold text-amber-700/70 uppercase tracking-widest mt-0.5">Blocked</p>
          </div>
          <div className={staleCount > 0 ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3" : "rounded-xl border border-border bg-card px-4 py-3"}>
            <p className={`text-xl font-extrabold tabular-nums ${staleCount > 0 ? "text-red-700" : "text-muted-foreground"}`}>{staleCount}</p>
            <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${staleCount > 0 ? "text-red-700/70" : "text-muted-foreground"}`}>Stale (&gt;{STALE_DRAFT_DAYS}d)</p>
          </div>
        </div>
      )}

      {/* Snapshot architecture note */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 shrink-0">
            <SendHorizonal className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Immutable publish pipeline</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Once published, the question snapshot is locked. Students who attempt the assessment
              always see the exact questions from the published version — even if questions are
              later revised. This guarantees academic integrity.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Full snapshot versioning (AssessmentSetVersion records, checksum verification,
              superseding) is being deployed. Currently, publishing sets{" "}
              <code className="font-mono bg-surface-2 px-1 rounded">is_active = true</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Candidates list */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-2">
          <p className="font-bold text-foreground">
            {loading
              ? "Loading…"
              : `${candidates.length} draft set${candidates.length === 1 ? "" : "s"}`}
          </p>
          {!loading && readyCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {readyCount} ready to publish
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500" />
            <p className="font-semibold text-foreground">Queue is empty</p>
            <p className="text-sm mt-1">All assessment sets are published.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {candidates.map((c) => (
              <div key={c.set.id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* Title row */}
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-extrabold text-foreground truncate">
                      #{c.set.id} · {c.set.title || <span className="italic text-muted-foreground">Untitled</span>}
                    </p>
                    {c.set.subject && (
                      <span
                        className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${SUBJECT_COLORS[c.set.subject] ?? "bg-slate-100 text-slate-700"}`}
                      >
                        {c.set.subject}
                      </span>
                    )}
                    <StateTag state="DRAFT" size="xs" showIcon={false} />
                    {c.isStale && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800 uppercase tracking-wide">
                        <AlertTriangle className="h-3 w-3" />
                        Stale · {c.daysSinceUpdate}d
                      </span>
                    )}
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {c.set.category && <span>{c.set.category}</span>}
                    <span>
                      {c.totalQuestions} question{c.totalQuestions === 1 ? "" : "s"}
                    </span>
                    {c.activeQuestions > 0 && (
                      <span className="text-emerald-700 font-semibold">
                        {c.activeQuestions} active
                      </span>
                    )}
                    {c.inactiveQuestions > 0 && (
                      <span className="text-amber-700 font-semibold">
                        {c.inactiveQuestions} inactive
                      </span>
                    )}
                  </div>

                  {/* Blocking issues */}
                  {c.issues.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.issues.map((issue) => (
                        <span
                          key={issue}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {issue}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <Link
                    href={`/builder/sets/${c.set.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Edit
                    <ArrowRight className="h-3 w-3" />
                  </Link>

                  {c.readyToPublish && (
                    <Link
                      href={`/builder/sets/${c.set.id}/publish`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                      <Rocket className="h-3 w-3" />
                      Publish
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
