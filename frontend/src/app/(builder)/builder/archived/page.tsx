"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { Archive, LayoutGrid, AlertTriangle, ArrowRight } from "lucide-react";

export default function ArchivedContentPage() {
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

  // Archived sets are inactive sets that have at least one question
  // (empty inactive sets are just drafts in the publish queue)
  const archivedSets = useMemo(
    () => sets.filter((s) => !s.is_active && (s.questions?.length ?? 0) > 0),
    [sets],
  );

  const inactiveSets = useMemo(
    () => sets.filter((s) => !s.is_active),
    [sets],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Archived Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inactive assessment sets and deprecated questions. Archived content is preserved for
          academic record purposes — it cannot be deleted if any student has interacted with it.
        </p>
      </div>

      {/* Governance note */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">Academic record preservation</p>
            <p className="text-sm text-amber-800 mt-0.5">
              Content referenced by student attempts is permanently preserved, regardless of
              archive status. The governance invariant INV-003 prohibits deleting any attempt
              record, which transitively prevents deletion of the questions and sets they reference.
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

      {/* Architecture note about full lifecycle */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
          What counts as archived
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          An assessment set is archived when its <strong className="text-foreground">is_active</strong>{" "}
          flag is set to inactive. Archived sets are excluded from the question bank and cannot be
          assigned to new classrooms, but remain fully accessible for review and are preserved
          permanently if any student attempt references them.
        </p>
      </div>

      {/* Inactive sets list */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-2">
          <p className="font-bold text-foreground">
            {loading ? "Loading…" : `${inactiveSets.length} inactive set${inactiveSets.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : inactiveSets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Archive className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No archived content.</p>
            <p className="text-sm mt-1">All assessment sets are currently active.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {inactiveSets.map((s) => (
              <div key={s.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <p className="font-extrabold text-foreground truncate">{s.title}</p>
                    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600 uppercase tracking-wide">
                      Inactive
                    </span>
                    {s.subject && (
                      <span
                        className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${s.subject === "math" ? "bg-purple-100 text-purple-800" : "bg-teal-100 text-teal-800"}`}
                      >
                        {s.subject}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.questions?.length ?? 0} question{(s.questions?.length ?? 0) === 1 ? "" : "s"}
                    {s.category ? ` · ${s.category}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/builder/bank?setId=${s.id}`}
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <LayoutGrid className="h-3 w-3" />
                    Questions
                  </Link>
                  <Link
                    href={`/builder/sets/${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Open editor
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
