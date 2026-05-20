"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examsPublicApi, type PastpaperPackPublic } from "@/lib/api";
import { BookOpen, Calculator, Calendar, ChevronRight, FileText, Globe, Search, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

function formatDate(s: string | null): string {
  if (!s) return "Undated";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function PackCard({ pack }: { pack: PastpaperPackPublic }) {
  const rwSection = pack.sections.find(
    (s) => s.subject === "READING_WRITING" || s.subject?.toLowerCase().includes("reading"),
  );
  const mathSection = pack.sections.find(
    (s) => s.subject === "MATH" || s.subject?.toLowerCase().includes("math"),
  );

  return (
    <Link
      href={`/pastpapers/${pack.id}`}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:border-primary/25 transition-all"
    >
      <div className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
        pack.form_type === "US"
          ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          : "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
      )}>
        <FileText className="h-6 w-6" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            pack.form_type === "US"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
              : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
          )}>
            <Globe className="h-2.5 w-2.5" />
            {pack.form_type === "US" ? "US" : "International"}
          </span>
          {pack.label && (
            <span className="text-[10px] font-bold text-muted-foreground">Form {pack.label}</span>
          )}
        </div>
        <h2 className="font-extrabold text-foreground text-sm leading-snug truncate group-hover:text-primary transition-colors">
          {pack.title || `SAT Past Paper — ${formatDate(pack.practice_date)}`}
        </h2>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(pack.practice_date)}
          </span>
          <div className="flex items-center gap-1.5">
            {rwSection && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                <BookOpen className="h-2.5 w-2.5" />
                R&W
              </span>
            )}
            {mathSection && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                <Calculator className="h-2.5 w-2.5" />
                Math
              </span>
            )}
          </div>
        </div>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
    </Link>
  );
}

export default function PastpapersPage() {
  const [packs, setPacks] = useState<PastpaperPackPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await examsPublicApi.getPastpaperPacks();
        if (!cancelled) setPacks(data);
      } catch (e: unknown) {
        if (!cancelled) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(typeof d === "string" ? d : "Could not load past papers.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return packs;
    return packs.filter((p) => {
      const blob = `${p.title || ""} ${p.label || ""} ${p.form_type || ""} ${formatDate(p.practice_date)}`.toLowerCase();
      return blob.includes(q);
    });
  }, [packs, search]);

  const usForms = packs.filter((p) => p.form_type === "US").length;
  const intlForms = packs.filter((p) => p.form_type !== "US").length;
  const totalSections = packs.reduce((s, p) => s + p.sections.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-6">

      <PageHeader
        eyebrow="SAT Simulation"
        title="Past Papers"
        description="Released SAT past papers — start a section, work at your own pace, and review every question with explanations."
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard
          label="Total Papers"
          value={packs.length}
          icon={FileText}
          accent="text-primary bg-primary/10"
        />
        <StatCard
          label="US Forms"
          value={usForms}
          icon={Globe}
          accent="text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40"
        />
        <StatCard
          label="Sections"
          value={totalSections}
          icon={BookOpen}
          accent="text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/40"
        />
      </div>

      {/* Search */}
      <div className="group relative mb-6 w-full max-w-md">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <input
          type="text"
          placeholder="Search past papers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-11 pr-10 text-sm font-medium shadow-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl ds-skeleton" />
          ))}
        </div>
      ) : filtered.length === 0 && !error ? (
        <EmptyState
          icon={FileText}
          title={search ? "No matching papers" : "No past papers yet"}
          description={search ? "Try a different search." : "Past papers will appear here once added."}
          action={search ? (
            <button type="button" onClick={() => setSearch("")} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">
              Clear search
            </button>
          ) : undefined}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((pack) => (
            <PackCard key={pack.id} pack={pack} />
          ))}
        </div>
      )}
    </div>
  );
}
