"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { Archive, LayoutGrid, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
} from "@/components/studio/primitives";

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
        <h1 className={STUDIO_PAGE_TITLE}>Archived Content</h1>
        <p className={STUDIO_PAGE_DESC}>
          Inactive assessment sets and deprecated questions. Archived content is preserved for
          academic record purposes — it cannot be deleted if any student has interacted with it.
        </p>
      </div>

      {/* Governance note */}
      <div className="border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">Academic record preservation</p>
            <p className="mt-0.5 text-[13px] text-amber-800 dark:text-amber-300">
              Content referenced by student attempts is permanently preserved, regardless of
              archive status. The governance invariant INV-003 prohibits deleting any attempt
              record, which transitively prevents deletion of the questions and sets they reference.
            </p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className={STUDIO_ERROR_BANNER}>
          {error}
        </div>
      )}

      {/* Architecture note about full lifecycle */}
      <div className={STUDIO_CARD}>
        <p className={STUDIO_BOX_CAPTION}>
          What counts as archived
        </p>
        <p className="px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          An assessment set is archived when its <strong className="font-semibold text-foreground">is_active</strong>{" "}
          flag is set to inactive. Archived sets are excluded from the question bank and cannot be
          assigned to new classrooms, but remain fully accessible for review and are preserved
          permanently if any student attempt references them.
        </p>
      </div>

      {/* Inactive sets list */}
      <div className={STUDIO_CARD}>
        <div className={cn(STUDIO_BOX_CAPTION, "flex items-center justify-between gap-2")}>
          <p className="tabular-nums">
            {loading ? "Loading…" : `${inactiveSets.length} inactive set${inactiveSets.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : inactiveSets.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            <Archive className="mx-auto mb-2 h-6 w-6 opacity-30" />
            <p className="font-medium">No archived content.</p>
            <p className="mt-1 text-[13px]">All assessment sets are currently active.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {inactiveSets.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px] hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <p className="truncate font-semibold text-foreground">{s.title}</p>
                    <span className="text-[12px] text-muted-foreground">
                      Inactive
                    </span>
                    {s.subject && (
                      <span
                        className="text-[12px] capitalize text-muted-foreground"
                      >
                        {s.subject}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {s.questions?.length ?? 0} question{(s.questions?.length ?? 0) === 1 ? "" : "s"}
                    {s.category ? ` · ${s.category}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/builder/bank?setId=${s.id}`}
                    className={STUDIO_BTN_SECONDARY}
                  >
                    <LayoutGrid className="h-3 w-3 text-muted-foreground" />
                    Questions
                  </Link>
                  <Link
                    href={`/builder/sets/${s.id}`}
                    className={STUDIO_BTN_SECONDARY}
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
