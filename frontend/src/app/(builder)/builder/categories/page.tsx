"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { Tag, LayoutGrid, AlertTriangle } from "lucide-react";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_LINK,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
} from "@/components/studio/primitives";

type CategoryRow = {
  name: string;
  setCount: number;
  questionCount: number;
  mathCount: number;
  englishCount: number;
};

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

  const categories = useMemo<CategoryRow[]>(() => {
    const map = new Map<string, CategoryRow>();

    // Uncategorised bucket
    map.set("(Uncategorised)", {
      name: "(Uncategorised)",
      setCount: 0,
      questionCount: 0,
      mathCount: 0,
      englishCount: 0,
    });

    for (const s of sets) {
      const key = s.category?.trim() || "(Uncategorised)";
      if (!map.has(key)) {
        map.set(key, { name: key, setCount: 0, questionCount: 0, mathCount: 0, englishCount: 0 });
      }
      const row = map.get(key)!;
      row.setCount++;
      for (const q of s.questions ?? []) {
        row.questionCount++;
        if (s.subject === "math") row.mathCount++;
        else row.englishCount++;
      }
    }

    return Array.from(map.values())
      .filter((r) => r.setCount > 0)
      .sort((a, b) => {
        if (a.name === "(Uncategorised)") return 1;
        if (b.name === "(Uncategorised)") return -1;
        return a.name.localeCompare(b.name);
      });
  }, [sets]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={STUDIO_PAGE_TITLE}>Categories</h1>
          <p className={STUDIO_PAGE_DESC}>
            Taxonomy organising questions and assessment sets. Categories are set on each
            assessment; questions inherit their set&apos;s category.
          </p>
        </div>
      </div>

      {/* Architecture note — category management is set-level */}
      <div className="border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">Category management is set-level</p>
            <p className="mt-0.5 text-[13px] text-amber-800 dark:text-amber-300">
              Categories are assigned when creating or editing an assessment set. To change a
              category, edit the set in{" "}
              <Link
                href="/builder/sets"
                className="rounded-sm font-semibold underline hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-100"
              >
                Assessments
              </Link>
              . A dedicated category management surface (with rename, merge, and SAT skill
              taxonomy mapping) is planned for a future release.
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

      {/* Categories table */}
      <div className={STUDIO_CARD}>
        <div className={STUDIO_BOX_CAPTION}>
          {loading ? "Loading…" : `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : categories.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            <Tag className="mx-auto mb-2 h-6 w-6 opacity-30" />
            <p className="font-medium">No categories found.</p>
            <p className="mt-1 text-[13px]">
              Add categories when creating assessment sets in{" "}
              <Link href="/builder/sets" className={STUDIO_LINK}>
                Assessments
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {categories.map((cat) => (
              <div
                key={cat.name}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px] hover:bg-surface-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`font-semibold ${cat.name === "(Uncategorised)" ? "text-muted-foreground italic" : "text-foreground"}`}
                    >
                      {cat.name}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {cat.setCount} set{cat.setCount === 1 ? "" : "s"} ·{" "}
                      {cat.questionCount} question{cat.questionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
                  {cat.mathCount > 0 && (
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      Math · {cat.mathCount}
                    </span>
                  )}
                  {cat.englishCount > 0 && (
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      English · {cat.englishCount}
                    </span>
                  )}
                  <Link
                    href={`/builder/bank?category=${encodeURIComponent(cat.name)}`}
                    className={STUDIO_BTN_SECONDARY}
                  >
                    <LayoutGrid className="h-3 w-3 text-muted-foreground" />
                    View questions
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
