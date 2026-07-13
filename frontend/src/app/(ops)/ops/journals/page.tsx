"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { levelsForSubject, levelLabel, type LevelKey } from "@/lib/levels";
import { journalsApi } from "@/features/journals/api";
import { courseMeta } from "@/features/journals/structure";
import type { JournalListItem, JournalStatus } from "@/features/journals/types";
import {
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Loader2,
  NotebookText,
  Plus,
} from "lucide-react";

type SubjectCode = "MATH" | "ENGLISH";

const SUBJECTS: { code: SubjectCode; lower: "math" | "english"; label: string; icon: typeof BookOpen }[] = [
  { code: "MATH", lower: "math", label: "Math", icon: Calculator },
  { code: "ENGLISH", lower: "english", label: "English", icon: BookOpen },
];

const STATUS_STYLE: Record<JournalStatus | "NONE", string> = {
  PUBLISHED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ARCHIVED: "bg-surface-2 text-muted-foreground",
  NONE: "bg-surface-2 text-muted-foreground",
};

function ProgressRing({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-border" />
      <circle
        cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        className={pct >= 100 ? "stroke-emerald-500" : "stroke-primary"}
      />
    </svg>
  );
}

export default function JournalsDashboardPage() {
  const router = useRouter();
  const [subject, setSubject] = useState<SubjectCode | null>(null);
  const [journals, setJournals] = useState<JournalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await journalsApi.list();
      setJournals(Array.isArray(d.results) ? d.results : []);
    } catch {
      setError("Could not load journals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(() => {
    const m = new Map<string, JournalListItem>();
    for (const j of journals) m.set(`${j.subject}:${j.level}`, j);
    return m;
  }, [journals]);

  const createAndOpen = async (code: SubjectCode, level: LevelKey) => {
    const key = `${code}:${level}`;
    setCreating(key);
    try {
      const created = await journalsApi.create(code, level);
      router.push(`/ops/journals/${created.id}`);
    } catch {
      setError("Could not create the journal.");
      setCreating(null);
    }
  };

  const countFor = (code: SubjectCode) =>
    journals.filter((j) => j.subject === code).length;

  // ── Subject picker ──
  if (!subject) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Header />
        <div className="grid gap-4 sm:grid-cols-2">
          {SUBJECTS.map((s) => {
            const levels = levelsForSubject(s.lower);
            const created = countFor(s.code);
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => setSubject(s.code)}
                className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <s.icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold text-foreground">{s.label}</h2>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {levels.length} levels · {created} journal{created !== 1 ? "s" : ""} started
                    </p>
                  </div>
                  <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {levels.map((lv) => (
                    <span key={lv} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      {levelLabel(lv)}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {loading && <LoadingRow />}
        {error && <ErrorRow msg={error} />}
      </div>
    );
  }

  // ── Level grid for the chosen subject ──
  const active = SUBJECTS.find((s) => s.code === subject)!;
  const levels = levelsForSubject(active.lower);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Header />
      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
        <button type="button" onClick={() => setSubject(null)} className="text-muted-foreground hover:text-primary">
          Subjects
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-foreground">{active.label}</span>
      </div>

      {error && <ErrorRow msg={error} />}
      {loading ? (
        <LoadingRow />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map((lv) => {
            const journal = byKey.get(`${subject}:${lv}`);
            const meta = courseMeta(lv);
            const key = `${subject}:${lv}`;
            const isCreating = creating === key;
            return (
              <div
                key={lv}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm",
                  journal && "cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md",
                )}
                onClick={journal ? () => router.push(`/ops/journals/${journal.id}`) : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-extrabold text-foreground">{levelLabel(lv)}</h3>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {meta.months} month{meta.months !== 1 ? "s" : ""} · {meta.lessons} lessons
                    </p>
                  </div>
                  <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", STATUS_STYLE[journal?.status ?? "NONE"])}>
                    {journal ? journal.status : "Not started"}
                  </span>
                </div>

                {journal ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center">
                        <ProgressRing pct={journal.progress.completion_pct} />
                        <span className="absolute text-[11px] font-extrabold text-foreground">
                          {journal.progress.completion_pct}%
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 text-xs font-semibold text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          {journal.progress.homework_ready}/{journal.progress.homework_total} homework ready
                        </span>
                        <span>{journal.progress.midterm_total} midterm{journal.progress.midterm_total !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-border pt-2 text-[11px] font-medium text-muted-foreground">
                      <span>Updated {new Date(journal.last_updated).toLocaleDateString()}</span>
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex gap-4 text-xs font-semibold text-muted-foreground">
                      <span>{meta.homework} homework</span>
                      <span>{meta.midterms} midterm{meta.midterms !== 1 ? "s" : ""}</span>
                    </div>
                    <button
                      type="button"
                      disabled={isCreating}
                      onClick={() => createAndOpen(subject, lv)}
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                    >
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create journal
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <NotebookText className="h-6 w-6" />
      </span>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Journals</h1>
        <p className="text-sm font-semibold text-muted-foreground">
          Pre-author every homework of a course, per level.
        </p>
      </div>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading journals…
    </div>
  );
}

function ErrorRow({ msg }: { msg: string }) {
  return (
    <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      {msg}
    </div>
  );
}
