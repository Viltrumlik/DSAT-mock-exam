"use client";

/**
 * /ops/journals — pick a subject, then a level: each level's journal with its progress, or Create journal.
 *
 * In the console's look (design handoff v0.3). The words and the calls are the page's own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, type BadgeTone } from "@/features/console/ui";
import { journalsApi } from "@/features/journals/api";
import { LoadingLine, PANEL } from "@/features/journals/journalParts";
import { courseMeta } from "@/features/journals/structure";
import type { JournalListItem, JournalStatus } from "@/features/journals/types";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { cn } from "@/lib/cn";
import { levelsForSubject, levelLabel, type LevelKey } from "@/lib/levels";

type SubjectCode = "MATH" | "ENGLISH";

const SUBJECTS: { code: SubjectCode; lower: "math" | "english"; label: string; icon: IconName; tint: string }[] = [
  { code: "MATH", lower: "math", label: "Math", icon: "sigma", tint: "bg-ms-math-soft text-ms-math-fg" },
  { code: "ENGLISH", lower: "english", label: "English", icon: "book", tint: "bg-ms-rw-soft text-ms-rw-fg" },
];

const STATUS_TONE: Record<JournalStatus | "NONE", BadgeTone> = {
  PUBLISHED: "positive",
  DRAFT: "attention",
  ARCHIVED: "neutral",
  NONE: "neutral",
};

function ProgressRing({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" className="h-11 w-11 shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-ms-surface-3" />
      <circle
        cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        className={pct >= 100 ? "stroke-ms-positive" : "stroke-ms-primary"}
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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <Header />
        <div className="grid gap-4 sm:grid-cols-2">
          {SUBJECTS.map((s, i) => {
            const levels = levelsForSubject(s.lower);
            const created = countFor(s.code);
            return (
              <button
                key={s.code}
                type="button"
                data-subject={s.code}
                onClick={() => setSubject(s.code)}
                style={{ animationDelay: `${i * 40}ms` }}
                className={cn(PANEL, "animate-ms-card-in ms-hover-lift group flex flex-col gap-4 p-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring")}
              >
                <div className="flex items-center gap-3">
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-[14px]", s.tint)}>
                    <Icon name={s.icon} size="xl" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">{s.label}</h2>
                    <p className="text-[14px] text-ms-fg-2">
                      {levels.length} levels · {created} journal{created !== 1 ? "s" : ""} started
                    </p>
                  </div>
                  <Icon name="right" className="ms-transition ml-auto text-ms-fg-3 group-hover:translate-x-0.5 group-hover:text-ms-fg" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {levels.map((lv) => (
                    <span key={lv} className="inline-flex h-6 items-center rounded-full bg-ms-surface-2 px-[9px] text-[13px] font-medium leading-none text-ms-fg-2">
                      {levelLabel(lv)}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {loading && <LoadingLine card>Loading journals…</LoadingLine>}
        {error && <LibraryError>{error}</LibraryError>}
      </div>
    );
  }

  // ── Level grid for the chosen subject ──
  const active = SUBJECTS.find((s) => s.code === subject)!;
  const levels = levelsForSubject(active.lower);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Header />
      <nav aria-label="Breadcrumb" className="-mt-1 flex items-center gap-1.5 text-[14px]">
        <button
          type="button"
          onClick={() => setSubject(null)}
          className="ms-transition rounded-[6px] font-medium text-ms-fg-3 hover:text-ms-primary-text"
        >
          Subjects
        </button>
        <Icon name="right" size="sm" className="text-ms-fg-3" />
        <span className="font-semibold text-ms-fg">{active.label}</span>
      </nav>

      {error && <LibraryError>{error}</LibraryError>}
      {loading ? (
        <LoadingLine card>Loading journals…</LoadingLine>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map((lv, i) => {
            const journal = byKey.get(`${subject}:${lv}`);
            const meta = courseMeta(lv);
            const key = `${subject}:${lv}`;
            const isCreating = creating === key;
            return (
              <div
                key={lv}
                data-level={lv}
                style={{ animationDelay: `${i * 40}ms` }}
                className={cn(
                  PANEL,
                  "animate-ms-card-in flex flex-col gap-3 p-5",
                  journal && "ms-hover-lift cursor-pointer",
                )}
                onClick={journal ? () => router.push(`/ops/journals/${journal.id}`) : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[18px] font-bold leading-6 text-ms-fg">{levelLabel(lv)}</h3>
                    <p className="mt-0.5 text-[13px] text-ms-fg-2">
                      {meta.months} month{meta.months !== 1 ? "s" : ""} · {meta.lessons} lessons
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[journal?.status ?? "NONE"]} dot>
                    {journal ? journal.status : "Not started"}
                  </Badge>
                </div>

                {journal ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center">
                        <ProgressRing pct={journal.progress.completion_pct} />
                        <span className="absolute text-[11px] font-bold tabular-nums text-ms-fg">
                          {journal.progress.completion_pct}%
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 text-[13px] text-ms-fg-2">
                        <span className="flex items-center gap-1.5">
                          <Icon name="ok" size="sm" className="size-3.5 text-ms-positive-fg" />
                          {journal.progress.homework_ready}/{journal.progress.homework_total} homework ready
                        </span>
                        <span>{journal.progress.midterm_total} midterm{journal.progress.midterm_total !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-ms-line pt-2.5 text-[13px] text-ms-fg-3">
                      <span>Updated {new Date(journal.last_updated).toLocaleDateString()}</span>
                      <Icon name="right" size="sm" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex gap-4 text-[13px] text-ms-fg-2">
                      <span>{meta.homework} homework</span>
                      <span>{meta.midterms} midterm{meta.midterms !== 1 ? "s" : ""}</span>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="plus"
                      state={isCreating ? "busy" : "idle"}
                      onClick={() => createAndOpen(subject, lv)}
                      className="mt-auto w-full"
                    >
                      Create journal
                    </Button>
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
  // The console's shared header — see OpsPageHeader. The icon medallion that used to sit
  // beside this title is dropped rather than kept: no other page in the console has one, and
  // the sidebar already shows this section's icon a couple of inches to the left.
  return (
    <OpsPageHeader
      section="Journals"
      title="Journals"
      description="Pre-author every homework of a course, per level."
    />
  );
}
