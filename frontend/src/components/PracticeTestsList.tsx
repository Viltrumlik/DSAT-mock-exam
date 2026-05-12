"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { examsStudentApi } from "@/features/examsStudent/api";
import {
  buildHomeworkPastpaperCards,
  formatLineDate,
  isTimedMockSectionRow,
  practiceTestSearchBlob,
  sharedPastpaperPackTitle,
  singleDisplayTitle,
  sortPastpaperSections,
  subjectLabel,
} from "@/lib/practiceTestCards";
import { ArrowRight, FileText, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import { platformSubjectIsMath } from "@/lib/permissions";

type PracticeTestsListProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

const examsPublicApi = examsStudentApi;

function progressPack(tests: any[], attempts: any[]) {
  if (!tests.length) return 0;
  const done = tests.filter((t) =>
    attempts.some((a) => a.practice_test === t.id && a.is_completed)
  ).length;
  return Math.round((done / tests.length) * 100);
}

function progressSingle(test: any, attempts: any[]) {
  const att = attempts
    .filter((a) => a.practice_test === test.id)
    .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  if (!att) return 0;
  if (att.is_completed) return 100;
  const modules = test.modules || [];
  const total = modules.length;
  if (!total) return 0;
  const done = Array.isArray(att.completed_modules) ? att.completed_modules.length : 0;
  return Math.min(100, Math.round((done / total) * 100));
}

function PackSectionFooter({
  tests,
  isLoggedIn,
  router,
  attempts,
}: {
  tests: any[];
  isLoggedIn: boolean;
  attempts: any[];
  router: ReturnType<typeof useRouter>;
}) {
  const sorted = sortPastpaperSections(tests);
  return (
    <div className="p-6 pt-2 mt-auto space-y-2">
      {sorted.map((t) => {
        const pct = progressSingle(t, attempts);
        const att = attempts
          .filter((a) => a.practice_test === t.id)
          .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
        const completed = !!att?.is_completed;
        const isMath = platformSubjectIsMath(t.subject);
        return (
          <div
            key={t.id}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2/80 p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-foreground">{subjectLabel(t.subject)}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-label-foreground">
                {(t.modules?.length ?? 0)} modules · {pct}%{completed ? " · Done" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!isLoggedIn) {
                  router.push("/login");
                  return;
                }
                router.push(`/practice-test/${t.id}`);
              }}
              className={cn(
                "ms-btn-primary shrink-0 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[10px] font-black uppercase tracking-widest",
                isMath ? "ms-cta-math" : "ms-cta-fill",
              )}
            >
              Open
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function PracticeTestsList({
  eyebrow = "Student portal",
  title,
  description,
}: PracticeTestsListProps) {
  const [tests, setTests] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useMe();
  const isLoggedIn = isAuthenticated;

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      const isLogged = isLoggedIn;
      try {
        setFetchError(null);
        const bundle = await examsPublicApi.getPracticeTests();
        if (cancelled) return;
        setTests(bundle.items.filter((t) => !isTimedMockSectionRow(t)));
        if (isLogged) {
          const attemptsData = await examsPublicApi.getAttempts();
          if (!cancelled) setAttempts(attemptsData.items);
        } else {
          setAttempts([]);
        }
      } catch (err) {
        console.error("[practice-tests] failed to load catalog or attempts", err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Could not load practice tests.";
          setFetchError(message);
          setTests([]);
          setAttempts([]);
        }
      }
    };

    void fetchData();

    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchData();
    };
    window.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname, listRefreshKey, isLoggedIn]);

  const cards = useMemo(() => buildHomeworkPastpaperCards(tests), [tests]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return cards;
    return cards.filter((c) => {
      if (c.kind === "pastpaper_pack") {
        const blob = `${sharedPastpaperPackTitle(c.tests)} ${formatLineDate(c.tests[0]?.practice_date)} ${c.tests.map((t) => subjectLabel(t.subject)).join(" ")}`.toLowerCase();
        return blob.includes(q);
      }
      const t = c.test;
      return practiceTestSearchBlob(t).includes(q);
    });
  }, [cards, searchQuery]);

  const cardShell =
    "ui-card group flex flex-col overflow-hidden rounded-[32px] hover:-translate-y-1";

  return (
    <div className="mx-auto max-w-7xl px-8 py-12">
      <div className="mb-12">
        {fetchError ? (
          <div
            className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
            role="alert"
          >
            <p className="font-bold">We couldn&apos;t load the practice list.</p>
            <p className="mt-1 opacity-90">{fetchError}</p>
            <button
              type="button"
              className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-background"
              onClick={() => setListRefreshKey((k) => k + 1)}
            >
              Try again
            </button>
          </div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-1 w-12 rounded-full bg-primary" />
            <span className="block text-[10px] font-bold uppercase tracking-widest text-primary">{eyebrow}</span>
          </div>
          <button
            type="button"
            onClick={() => setListRefreshKey((k) => k + 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh list
          </button>
        </div>
        <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-lg font-medium leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="group relative mb-10 w-full max-w-md">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-label-foreground transition-colors group-focus-within:text-primary" />
        <input
          type="text"
          placeholder="Search practice packs and tests..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ui-input w-full rounded-[18px] py-3 pl-11 pr-10 text-sm font-medium shadow-sm transition-all"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-label-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => {
          if (c.kind === "pastpaper_pack") {
            const pct = progressPack(c.tests, attempts);
            const lineDate = c.pack?.practice_date || c.tests[0]?.practice_date || c.tests[0]?.created_at;
            const heading = (c.pack?.title && String(c.pack.title).trim()) || sharedPastpaperPackTitle(c.tests);
            return (
              <div key={`pastpaper-pack-${c.packKey}`} className={cardShell}>
                <div className="relative p-8 pb-4">
                  <div className="mb-6 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Practice test</span>
                      <span className="text-xs font-bold text-label-foreground">{formatLineDate(lineDate)}</span>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                      <FileText className="h-6 w-6" />
                    </div>
                  </div>
                  <h3 className="mb-6 font-serif text-2xl font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                    {heading}
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="min-w-[2.25rem] text-right text-[10px] font-black uppercase tracking-wider text-label-foreground tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>
                <PackSectionFooter tests={c.tests} isLoggedIn={isLoggedIn} router={router} attempts={attempts} />
              </div>
            );
          }

          const t = c.test;
          const pct = progressSingle(t, attempts);
          const att = attempts
            .filter((a) => a.practice_test === t.id)
            .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
          const completed = !!att?.is_completed;

          return (
            <div key={`single-${t.id}`} className={cardShell}>
              <div className="relative p-8 pb-4">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Practice test</span>
                    <span className="text-xs font-bold text-label-foreground">
                      {formatLineDate(t.practice_date || t.created_at)}
                    </span>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                    <FileText className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="mb-6 font-serif text-2xl font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {singleDisplayTitle(t)}
                </h3>
                <div className="flex items-center gap-2">
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="min-w-[2.25rem] text-right text-[10px] font-black uppercase tracking-wider text-label-foreground tabular-nums">
                    {pct}%
                  </span>
                </div>
                {completed ? (
                  <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-primary">Completed</p>
                ) : null}
              </div>
              <div className="mt-auto p-6 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isLoggedIn) {
                      router.push("/login");
                      return;
                    }
                    router.push(`/practice-test/${t.id}`);
                  }}
                  className="ms-btn-primary ms-cta-fill group/btn flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-sm font-black uppercase tracking-widest active:scale-[0.98]"
                >
                  Enter practice test
                  <ArrowRight className="h-5 w-5 transition-transform group-hover/btn:translate-x-1" />
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <div className="col-span-full rounded-[40px] border-2 border-dashed border-border bg-card py-32 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-label-foreground/40" />
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">No practice tests assigned yet</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
