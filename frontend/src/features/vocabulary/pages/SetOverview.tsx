"use client";

/**
 * /vocabulary/sets/[setId] — one set's launcher. Identical for a bank set and a
 * student's own custom set; only the breadcrumb and the "edit words" affordance
 * differ.
 *
 * The set payload carries per-word status but no aggregate, so the hero tiles
 * and the meter are derived here from the word list — one fewer field for the
 * API to keep in sync with the filter that sits right below it.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, Circle, Pencil, Sparkles, TrendingUp, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Alert, Card, Skeleton } from "@/components/ui";

import { masteredPercent } from "../components/MasteryBar";
import { StudyModeCard } from "../components/StudyModeCard";
import { VocabErrorState, VocabRowsSkeleton } from "../components/VocabStates";
import { WordList } from "../components/WordList";
import { useVocabSet } from "../hooks";
import { STUDY_MODES, type ProgressCounts } from "../types";

const JAKARTA = "var(--font-plus-jakarta), system-ui, sans-serif";

export function SetOverview({ setId }: { setId: number }) {
  const q = useVocabSet(setId);
  const set = q.data;

  const progress = useMemo<ProgressCounts>(() => {
    const counts: ProgressCounts = { new: 0, learning: 0, mastered: 0, total: 0 };
    for (const w of set?.words ?? []) {
      counts[w.status] += 1;
      counts.total += 1;
    }
    return counts;
  }, [set]);

  const valid = Number.isFinite(setId) && setId > 0;
  const backHref = set?.section ? `/vocabulary/sections/${set.section.id}` : "/vocabulary";
  const backLabel = set?.section ? `Back to ${set.section.title}` : "Back to vocabulary";

  if (!valid || q.isError) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
        <BackLink href="/vocabulary" label="Back to vocabulary" />
        <VocabErrorState
          title="This set isn't available"
          description="It may have been removed, or it belongs to another student. Pick another set from the hub."
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  if (q.isLoading || !set) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
        <BackLink href="/vocabulary" label="Back to vocabulary" />
        <Skeleton className="h-64 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
        <VocabRowsSkeleton count={5} />
      </div>
    );
  }

  const empty = set.words.length === 0;
  const pct = masteredPercent(progress);
  const share = (n: number) => (progress.total > 0 ? (n / progress.total) * 100 : 0);

  // Same label/icon vocabulary as the hub hero, so the two heroes read as one
  // component with different numbers in it.
  const tiles: { label: string; icon: LucideIcon; value: number }[] = [
    { label: "Words", icon: Type, value: set.word_count },
    { label: "Mastered", icon: CheckCircle2, value: progress.mastered },
    { label: "Learning", icon: TrendingUp, value: progress.learning },
    { label: "New", icon: Circle, value: progress.new },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12" style={{ fontFamily: JAKARTA }}>
      <BackLink href={backHref} label={backLabel} />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not cr-card: a hero is not clickable, so it must not lift. */}
      <Card className="cr-cardrise overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-6 py-7 text-primary-foreground sm:px-[34px] sm:py-[30px]">
          <div aria-hidden className="pointer-events-none absolute -bottom-14 -right-10 h-56 w-56 rounded-full bg-white/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute -top-24 right-28 h-44 w-44 rounded-full bg-white/[0.05]" />

          <div className="relative flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">
              {set.section ? <BookOpen className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {set.section ? set.section.title : "My set"}
            </span>
            {set.completed ? (
              <span className="inline-flex items-center gap-1.5 rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Completed
              </span>
            ) : null}
            {set.is_custom ? (
              <Link
                href={`/vocabulary/new-set?set=${set.id}`}
                className="ds-ring cr-press ml-auto inline-flex items-center gap-1.5 rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold hover:bg-white/30"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit words
              </Link>
            ) : null}
          </div>

          <h1 className="relative mt-[14px] text-[30px] font-extrabold leading-none tracking-[-0.025em] sm:text-[34px]">
            {set.title}
          </h1>

          <div className="relative mt-[26px] flex flex-wrap gap-x-[34px] gap-y-4">
            {tiles.map((t, i) => (
              <div key={t.label} className="cr-pillin" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] opacity-[0.72]">{t.label}</div>
                <div className="mt-[5px] inline-flex items-center gap-1.5 rounded-lg bg-white/[0.16] px-[11px] py-[3px] text-[17px] font-extrabold">
                  <t.icon className="h-4 w-4 opacity-80" aria-hidden />
                  <span className="ds-num">{t.value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Mastery meter — mastered then learning; the track is "new", so an
              untouched set reads as an empty bar. Numbers live in the tiles
              above, so the bar itself is decorative to a screen reader. */}
          <div className="relative mt-6 max-w-md">
            <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-[0.06em] opacity-[0.72]">
              <span>Mastery</span>
              <span className="ds-num">{pct}%</span>
            </div>
            <div aria-hidden className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="cr-bar h-full bg-white" style={{ width: `${share(progress.mastered)}%` }} />
              <div className="cr-bar h-full bg-white/55" style={{ width: `${share(progress.learning)}%` }} />
            </div>
          </div>
        </div>
      </Card>

      {/* ── MODE LAUNCHER — the centrepiece ──────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="ds-h3">Study this set</h2>
          <p className="ds-small mt-0.5">Finishing any one mode marks the set complete.</p>
        </div>
        {empty ? (
          <Alert tone="warning" title="Nothing to study yet">
            This set has no words, so the study modes stay locked.
            {set.is_custom ? " Add a few words and they will unlock straight away." : ""}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STUDY_MODES.map((mode, i) => (
            <div key={mode} className="cr-pop h-full" style={{ animationDelay: `${i * 70}ms` }}>
              <StudyModeCard mode={mode} setId={set.id} disabled={empty} />
            </div>
          ))}
        </div>
      </section>

      <WordList words={set.words} />
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}
