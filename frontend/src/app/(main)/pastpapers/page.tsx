"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { examsPublicApi, type PastpaperPackPublic } from "@/lib/api";
import { BookOpen, Calculator, Calendar, ChevronRight, FileText } from "lucide-react";

function formatDate(s: string | null): string {
  if (!s) return "Undated";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function subjectLabel(subject: string): string {
  if (subject === "READING_WRITING" || subject?.toLowerCase().includes("reading")) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
}

function SubjectIcon({ subject, className }: { subject: string; className?: string }) {
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) {
    return <Calculator className={className} />;
  }
  return <BookOpen className={className} />;
}

function PackCard({ pack }: { pack: PastpaperPackPublic }) {
  const rwSection = pack.sections.find(
    (s) => s.subject === "READING_WRITING" || s.subject?.toLowerCase().includes("reading"),
  );
  const mathSection = pack.sections.find(
    (s) => s.subject === "MATH" || s.subject?.toLowerCase().includes("math"),
  );
  const sectionCount = pack.sections.length;

  return (
    <Link
      href={`/pastpapers/${pack.id}`}
      className="group block rounded-2xl border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">
              {pack.form_type === "US" ? "US Form" : "International Form"}
            </p>
            <h2 className="font-extrabold text-foreground text-base leading-snug truncate">
              {pack.title || `SAT Past Paper — ${formatDate(pack.practice_date)}`}
            </h2>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              {formatDate(pack.practice_date)}
              {pack.label ? <span className="ml-2 font-semibold text-foreground/70">Form {pack.label}</span> : null}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
        </div>

        {/* Section chips */}
        {sectionCount > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {rwSection && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                Reading & Writing
              </span>
            )}
            {mathSection && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                <Calculator className="h-3.5 w-3.5" />
                Mathematics
              </span>
            )}
            {pack.sections
              .filter((s) => s !== rwSection && s !== mathSection)
              .map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-semibold text-foreground/70"
                >
                  <SubjectIcon subject={s.subject} className="h-3.5 w-3.5" />
                  {subjectLabel(s.subject)}
                </span>
              ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function PastpapersPage() {
  const [packs, setPacks] = useState<PastpaperPackPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-8">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-primary">SAT Simulation</p>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Past papers</h1>
        <p className="mt-2 text-muted-foreground">
          Released SAT past papers — start a Reading &amp; Writing or Mathematics section, work at your own pace, and review every question with explanations after finishing.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : packs.length === 0 && !error ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
            <FileText className="h-7 w-7 text-muted-foreground/50" />
          </div>
          <p className="font-extrabold text-foreground">No past papers available yet</p>
          <p className="mt-1 mx-auto max-w-xs text-sm text-muted-foreground leading-relaxed">
            Past papers will appear here once your teacher adds them.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} />
          ))}
        </div>
      )}
    </div>
  );
}
