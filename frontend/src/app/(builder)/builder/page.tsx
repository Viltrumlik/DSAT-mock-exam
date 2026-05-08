"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { Library, LayoutGrid, Tag, SendHorizonal, ArrowRight, AlertTriangle } from "lucide-react";
import { StateTag } from "@/components/governance";

type SummaryStats = {
  totalSets: number;
  activeSets: number;
  totalQuestions: number;
  activeQuestions: number;
};

const QUICK_LINKS = [
  {
    href: "/builder/bank",
    icon: Library,
    title: "Question Bank",
    description: "Browse, search, and filter all questions across every assessment set.",
    cta: "Open Question Bank",
  },
  {
    href: "/builder/sets",
    icon: LayoutGrid,
    title: "Assessments",
    description: "Create and manage assessment sets. Publish snapshots for assignment.",
    cta: "View Assessments",
  },
  {
    href: "/builder/categories",
    icon: Tag,
    title: "Categories",
    description: "Manage the taxonomy that organises questions and assessments.",
    cta: "Manage Categories",
  },
  {
    href: "/builder/publish-queue",
    icon: SendHorizonal,
    title: "Publish Queue",
    description: "Review draft questions pending QA approval before going live.",
    cta: "View Queue",
  },
];

export default function BuilderDashboardPage() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await assessmentsAdminApi.listSets({ limit: 200 });
        if (cancelled) return;
        let totalQ = 0;
        let activeQ = 0;
        for (const s of data.results) {
          for (const q of s.questions ?? []) {
            totalQ++;
            if (q.is_active) activeQ++;
          }
        }
        setStats({
          totalSets: data.count,
          activeSets: data.results.filter((s) => s.is_active).length,
          totalQuestions: totalQ,
          activeQuestions: activeQ,
        });
      } catch {
        if (!cancelled) setError("Could not load content statistics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2">
          Questions console
        </p>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1.5">
          Content health at a glance. Questions and assessments are the building blocks —
          assignments happen in the{" "}
          <a
            href={
              process.env.NEXT_PUBLIC_ADMIN_CONSOLE_URL ??
              "https://admin.mastersat.uz/ops/assignments"
            }
            className="font-semibold text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Admin console
          </a>
          .
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 animate-pulse">
              <div className="h-7 w-12 rounded bg-surface-2 mb-2" />
              <div className="h-3 w-20 rounded bg-surface-2" />
            </div>
          ))
        ) : error ? (
          <div className="col-span-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : stats ? (
          <>
            <StatCard value={stats.totalSets} label="Total sets" />
            <StatCard value={stats.activeSets} label="Active sets" highlight />
            <StatCard value={stats.totalQuestions} label="Total questions" />
            <StatCard value={stats.activeQuestions} label="Active questions" highlight />
          </>
        ) : null}
      </div>

      {/* Quick link cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-2xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-primary/30 hover:bg-primary/5 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-surface-2 p-2.5 group-hover:bg-primary/10 transition-colors">
                  <link.icon className="h-5 w-5 text-foreground group-hover:text-primary transition-colors" />
                </div>
                <p className="font-extrabold text-foreground">{link.title}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{link.description}</p>
            <span className="text-xs font-bold text-primary">{link.cta} →</span>
          </Link>
        ))}
      </div>

      {/* Governance reminder + state vocabulary */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
            Content governance
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions in active assignments are{" "}
            <strong className="text-foreground">protected by immutable snapshots</strong>. Editing an
            active question creates a new revision — students who already submitted are not affected.
            Use the{" "}
            <Link href="/builder/archived" className="font-semibold text-primary hover:underline">
              Archived
            </Link>{" "}
            section to retire deprecated content.
          </p>
        </div>

        {/* State vocabulary reference */}
        <div className="border-t border-border pt-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
            State reference
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {(
              [
                ["DRAFT", "Work in progress. Safe to edit."],
                ["PUBLISHED", "Live. Content is immutable."],
                ["ARCHIVED", "Retired. Preserved for records."],
                ["FREE", "Question not in any published set."],
                ["IN_USE", "Edits create a new revision."],
                ["HISTORICAL", "Frozen for exam review."],
              ] as const
            ).map(([state, note]) => (
              <div key={state} className="flex items-start gap-2">
                <StateTag state={state} size="xs" showIcon={false} className="shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground leading-snug">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  highlight = false,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p
        className={`text-2xl font-extrabold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">{label}</p>
    </div>
  );
}
