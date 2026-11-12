"use client";

/**
 * /builder/categories — the categories the assessment sets carry, with how many sets and questions each holds.
 *
 * In the console's look (design handoff v0.3, PR 20). The words and the call are the page's own.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { UNCATEGORISED_CATEGORY } from "@/domains/questions/types";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { PageNotice, SetSubjectPill } from "@/features/builderLibrary/assessmentParts";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { EmptyState, buttonClass } from "@/features/console/ui";
import { cn } from "@/lib/cn";

type CategoryRow = {
  name: string;
  setCount: number;
  questionCount: number;
  mathCount: number;
  englishCount: number;
};

// The bank's category filter matches this same name (a link from here lands filtered).
const UNCATEGORISED = UNCATEGORISED_CATEGORY;

export default function CategoriesPage() {
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

  const categories = useMemo<CategoryRow[]>(() => {
    const map = new Map<string, CategoryRow>();
    for (const s of sets) {
      const key = s.category?.trim() || UNCATEGORISED;
      if (!map.has(key)) {
        map.set(key, { name: key, setCount: 0, questionCount: 0, mathCount: 0, englishCount: 0 });
      }
      const row = map.get(key)!;
      const n = s.questions?.length ?? 0;
      row.setCount++;
      row.questionCount += n;
      if (s.subject === "math") row.mathCount += n;
      else row.englishCount += n;
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.name === UNCATEGORISED) return 1;
      if (b.name === UNCATEGORISED) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [sets]);

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Learning"
        title="Categories"
        description="Taxonomy organising questions and assessment sets. Categories are set on each assessment; questions inherit their set’s category."
        actions={null}
      />

      {/* Category management is set-level */}
      <PageNotice title="Category management is set-level">
        Categories are assigned when creating or editing an assessment set. To change a category, edit the set in{" "}
        <Link href="/builder/sets" className="font-semibold underline underline-offset-2">
          Assessments
        </Link>
        . A dedicated category management surface (with rename, merge, and SAT skill taxonomy mapping) is planned for a
        future release.
      </PageNotice>

      {error ? <LibraryError>{error}</LibraryError> : null}

      <section aria-label="Categories" className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
        <div className="border-b border-ms-line px-5 py-3.5 text-[15px] font-semibold text-ms-fg">
          {loading ? "Loading…" : `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="tag"
              title="No categories found."
              detail="Add categories when creating assessment sets in Assessments."
              action={
                <Link href="/builder/sets" className={buttonClass({ variant: "secondary" })}>
                  Assessments
                  <Icon name="right" size="sm" />
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-ms-line">
            {categories.map((cat) => {
              const none = cat.name === UNCATEGORISED;
              return (
                <li
                  key={cat.name}
                  data-category={cat.name}
                  className="ms-transition flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 hover:bg-ms-surface"
                >
                  <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ms-surface-2 text-ms-fg-3">
                      <Icon name="tag" size="sm" />
                    </span>
                    <div className="min-w-0">
                      <p className={cn("break-words text-[16px] font-semibold leading-[22px]", none ? "italic text-ms-fg-3" : "text-ms-fg")}>
                        {cat.name}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ms-fg-2">
                        {cat.setCount} set{cat.setCount === 1 ? "" : "s"} · {cat.questionCount} question
                        {cat.questionCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cat.mathCount > 0 ? <SetSubjectPill subject="math">Math · {cat.mathCount}</SetSubjectPill> : null}
                    {cat.englishCount > 0 ? <SetSubjectPill subject="english">English · {cat.englishCount}</SetSubjectPill> : null}
                    <Link
                      href={`/builder/bank?category=${encodeURIComponent(cat.name)}`}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      <Icon name="grid" size="sm" />
                      View questions
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
