"use client";

/**
 * /builder/archived — the inactive assessment sets, kept for the academic record.
 *
 * In the console's look (design handoff v0.3, PR 20). The words and the call are the page's own.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { PageNotice, SetSubjectPill } from "@/features/builderLibrary/assessmentParts";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { Badge, EmptyState, buttonClass } from "@/features/console/ui";

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
        const data = await assessmentsAdminApi.listAllSets();
        if (!cancelled) setSets(data.results);
      } catch {
        if (!cancelled) setError("Could not load assessment sets.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inactiveSets = useMemo(() => sets.filter((s) => !s.is_active), [sets]);

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Archive"
        title="Archived Content"
        description="Inactive assessment sets and deprecated questions. Archived content is preserved for academic record purposes — it cannot be deleted if any student has interacted with it."
        actions={null}
      />

      <PageNotice title="Academic record preservation">
        Content referenced by student attempts is permanently preserved, regardless of archive status. The governance
        invariant INV-003 prohibits deleting any attempt record, which transitively prevents deletion of the questions
        and sets they reference.
      </PageNotice>

      {error ? <LibraryError>{error}</LibraryError> : null}

      {/* What counts as archived */}
      <div className="animate-ms-fade-in rounded-ms-card bg-ms-card p-4 shadow-ms-1 sm:p-5">
        <p className="text-ms-over uppercase text-ms-fg-3">What counts as archived</p>
        <p className="mt-1.5 text-[14px] leading-[22px] text-ms-fg-2">
          An assessment set is archived when its{" "}
          <code className="rounded-[6px] bg-ms-surface-2 px-1.5 py-0.5 font-ms-mono text-[13px] text-ms-fg">is_active</code> flag is
          set to inactive. Archived sets are excluded from the question bank and cannot be assigned to new classrooms, but
          remain fully accessible for review and are preserved permanently if any student attempt references them.
        </p>
      </div>

      <section aria-label="Inactive sets" className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
        <div className="border-b border-ms-line px-5 py-3.5 text-[15px] font-semibold text-ms-fg">
          {loading ? "Loading…" : `${inactiveSets.length} inactive set${inactiveSets.length === 1 ? "" : "s"}`}
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
            ))}
          </div>
        ) : inactiveSets.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="archive" title="No archived content." detail="All assessment sets are currently active." />
          </div>
        ) : (
          <ul className="divide-y divide-ms-line">
            {inactiveSets.map((s) => {
              const n = s.questions?.length ?? 0;
              return (
                <li
                  key={s.id}
                  data-set={s.id}
                  className="ms-transition flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 hover:bg-ms-surface"
                >
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-[16px] font-semibold leading-[22px] text-ms-fg">{s.title}</p>
                      <Badge tone="neutral">Inactive</Badge>
                      {s.subject ? (
                        <SetSubjectPill subject={s.subject}>{s.subject === "math" ? "Math" : "English"}</SetSubjectPill>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-ms-fg-2">
                      {n} question{n === 1 ? "" : "s"}
                      {s.category ? ` · ${s.category}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/builder/bank?setId=${s.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      <Icon name="grid" size="sm" />
                      Questions
                    </Link>
                    <Link href={`/builder/sets/${s.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                      Open editor
                      <Icon name="right" size="sm" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
