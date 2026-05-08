"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { Tag, LayoutGrid, AlertTriangle } from "lucide-react";

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Questions console
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Taxonomy organising questions and assessment sets. Categories are set on each
            assessment; questions inherit their set&apos;s category.
          </p>
        </div>
      </div>

      {/* Architecture note — category management is set-level */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">Category management is set-level</p>
            <p className="text-sm text-amber-800 mt-0.5">
              Categories are assigned when creating or editing an assessment set. To change a
              category, edit the set in{" "}
              <Link href="/builder/sets" className="font-bold underline hover:text-amber-900">
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
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Categories table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 font-bold text-foreground">
          {loading ? "Loading…" : `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : categories.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Tag className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No categories found.</p>
            <p className="text-sm mt-1">
              Add categories when creating assessment sets in{" "}
              <Link href="/builder/sets" className="font-bold text-primary hover:underline">
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
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-xl bg-surface-2 p-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`font-extrabold ${cat.name === "(Uncategorised)" ? "text-muted-foreground italic" : "text-foreground"}`}
                    >
                      {cat.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cat.setCount} set{cat.setCount === 1 ? "" : "s"} ·{" "}
                      {cat.questionCount} question{cat.questionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {cat.mathCount > 0 && (
                    <span className="inline-flex items-center rounded-lg bg-purple-100 px-2 py-0.5 text-[10px] font-black text-purple-800 uppercase tracking-wide">
                      Math · {cat.mathCount}
                    </span>
                  )}
                  {cat.englishCount > 0 && (
                    <span className="inline-flex items-center rounded-lg bg-teal-100 px-2 py-0.5 text-[10px] font-black text-teal-800 uppercase tracking-wide">
                      English · {cat.englishCount}
                    </span>
                  )}
                  <Link
                    href={`/builder/bank?category=${encodeURIComponent(cat.name)}`}
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <LayoutGrid className="h-3 w-3" />
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
