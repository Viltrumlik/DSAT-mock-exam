"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search, ShieldCheck } from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { listCatalog } from "@/features/reviewCenter/api";
import type { ReviewContentType } from "@/features/reviewCenter/types";
import {
  REVIEW_TABS,
  isReviewerRole,
  publishBadge,
  reviewStatusBadge,
  subjectLabel,
} from "@/features/reviewCenter/ui";

export default function ReviewCenterPage() {
  const { me } = useMe();
  const role = (me as { role?: string } | undefined)?.role;
  const [tab, setTab] = useState<ReviewContentType>("assessment");
  const [search, setSearch] = useState("");

  const allowed = isReviewerRole(role);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["review-catalog", tab],
    queryFn: () => listCatalog(tab),
    enabled: allowed,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const items = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.meta ?? "").toLowerCase().includes(q) ||
        String(it.id) === q,
    );
  }, [data, search]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
        <h1 className="text-lg font-bold text-foreground">Review Center</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is for content reviewers. Your account does not have review access.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">Review Center</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Review any test read-only — questions and answer key — with no timer, no fullscreen, and no attempt.
        </p>
      </header>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {REVIEW_TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setTab(t.type)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-semibold transition " +
              (tab === t.type
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2/60 text-muted-foreground hover:bg-surface-2")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <ListSkeleton />
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">
          Could not load this list. {(error as { message?: string })?.message ?? ""}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-2/30 py-16 text-center text-sm text-muted-foreground">
          Nothing to review here yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((it) => {
            const subj = subjectLabel(it.subject);
            const status = reviewStatusBadge(it.reviewStatus);
            const pub = tab === "assessment" ? null : publishBadge(it.isPublished);
            return (
              <li key={it.id}>
                <Link
                  href={`/review-center/${tab}/${it.id}?title=${encodeURIComponent(it.title)}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{it.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {subj && <span>{subj}</span>}
                      {it.level && <span>· {it.level}</span>}
                      {it.meta && <span>· {it.meta}</span>}
                      {typeof it.questionCount === "number" && <span>· {it.questionCount} Q</span>}
                    </div>
                  </div>
                  {status && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                  )}
                  {pub && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pub.className}`}>
                      {pub.label}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-surface-2/40" />
      ))}
    </div>
  );
}
