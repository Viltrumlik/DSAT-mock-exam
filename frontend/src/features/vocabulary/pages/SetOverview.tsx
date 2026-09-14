"use client";

/**
 * /vocabulary/sets/[setId] — one set's launcher. Identical for a bank set and a
 * student's own custom set; only the breadcrumb and the "edit words" affordance
 * differ.
 *
 * The hero meter is the SET's four-game mastery, straight off the payload: a quarter of
 * the bar per game played clean. The word tiles beside it are derived from the word list
 * instead — one fewer field for the API to keep in sync with the filter right below it.
 *
 * Dressed like the rest of vocabulary (the owner, 2026-09-13: "u eski dizaynda qolib
 * ketibdi"). The section's own colour and glyph come in from its hub card and section page,
 * so the three pages read as one place. White quartz replaces the solid blue banner, the word
 * filter uses the house pill tabs, and every block has continuous `.squircle` corners where it
 * had sharp ones. The page's order — hero, games, words — is unchanged.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Gamepad2, Pencil, Sparkles, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Alert, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { MasteryBar, masteryPercent } from "../components/MasteryBar";
import { StudyModeCard } from "../components/StudyModeCard";
import { VocabErrorState, VocabRowsSkeleton } from "../components/VocabStates";
import { WordList } from "../components/WordList";
import { useVocabSet } from "../hooks";
import { useLaunchAssignmentId } from "../launchContext";
import { sectionLook, toneClasses } from "../sectionTone";
import { STUDY_MODES, type ProgressCounts } from "../types";

const JAKARTA = "var(--font-plus-jakarta), system-ui, sans-serif";

/** A student's own set has no section to borrow a colour from, so "mine" wears violet. */
const CUSTOM_LOOK = { ...toneClasses("violet"), Icon: Sparkles };

export function SetOverview({ setId }: { setId: number }) {
  const q = useVocabSet(setId);
  const set = q.data;
  /**
   * This page is a crossroads: the same set is reached from the question bank,
   * from "My sets" and from one or more homework cards. It cannot work out
   * which on its own — a set assigned to two classrooms has two right answers
   * and the page sees neither — so the launcher that sent the student here says
   * so in the URL, and every mode link below passes it on.
   */
  const assignmentId = useLaunchAssignmentId();

  const progress = useMemo<ProgressCounts>(() => {
    const counts: ProgressCounts = { new: 0, mastered: 0, total: 0 };
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
      <div className="mx-auto flex max-w-6xl flex-col gap-7 pb-14" style={{ fontFamily: JAKARTA }}>
        <BackLink href="/vocabulary" label="Back to vocabulary" />
        <Skeleton className="squircle h-72 [--sq:15px]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="squircle h-48 [--sq:13px]" />
          ))}
        </div>
        <VocabRowsSkeleton count={5} />
      </div>
    );
  }

  const empty = set.words.length === 0;
  const mastery = set.mastery;
  const pct = masteryPercent(mastery);
  const look = set.section ? sectionLook(set.section.id) : CUSTOM_LOOK;

  // Same label/icon vocabulary as the hub hero, so the two heroes read as one
  // component with different numbers in it. "Games" leads: it is what the bar below
  // measures and what the homework is paid on.
  const tiles: { label: string; icon: LucideIcon; value: string }[] = [
    { label: "Games mastered", icon: Gamepad2, value: `${mastery.mastered_modes}/${mastery.total_modes}` },
    { label: "Words", icon: Type, value: String(set.word_count) },
    { label: "Mastered", icon: CheckCircle2, value: String(progress.mastered) },
    { label: "New", icon: Circle, value: String(progress.new) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-7 pb-14" style={{ fontFamily: JAKARTA }}>
      <BackLink href={backHref} label={backLabel} />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not a float: a hero is not clickable, so it must not lift. */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        {/* The section's colour as a thin edge — the same mark its hub card and section
            page carry — rather than a whole banner of it. */}
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", look.edge)} />

        <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
          <div className="flex items-start gap-4">
            <span className={cn("squircle flex h-14 w-14 shrink-0 items-center justify-center [--sq:8.5px]", look.icon)}>
              <look.Icon className="h-7 w-7" aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold", look.chip)}>
                  {set.section ? set.section.title : "My set"}
                </span>
                {mastery.is_mastered ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-extrabold text-success-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Mastered
                  </span>
                ) : null}
              </div>
              <h1 className="mt-2.5 text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
                {set.title}
              </h1>
            </div>

            {set.is_custom ? (
              <Link
                href={`/vocabulary/new-set?set=${set.id}`}
                className="ds-ring cr-press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-xs font-extrabold text-foreground transition-colors hover:bg-surface-3"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit words
              </Link>
            ) : null}
          </div>

          {/* Four blocks of quartz on the hero's own white, told apart by a hairline and
              their weight — the section page's facts, at this page's scale. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((t, i) => (
              <div
                key={t.label}
                className="quartz squircle cr-cardrise relative overflow-hidden px-4 py-3.5 [--sq:10px]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <t.icon
                  aria-hidden
                  strokeWidth={1.25}
                  className="pointer-events-none absolute -bottom-3 -right-2 h-16 w-16 text-foreground/[0.05]"
                />
                <p className="relative text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{t.label}</p>
                <p
                  className={cn(
                    "ds-num relative mt-1.5 text-[24px] font-extrabold leading-none tracking-tight",
                    i === 0 ? look.text : "text-foreground",
                  )}
                >
                  {t.value}
                </p>
              </div>
            ))}
          </div>

          {/* One segment per game in that game's own colour — the bar the set cards on the
              section page already use, so a colour means the same game on both. */}
          <div className="max-w-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Mastery</span>
              <span className={cn("ds-num text-[13px] font-extrabold", look.text)}>{pct}%</span>
            </div>
            <MasteryBar mastery={mastery} legend />
          </div>
        </div>
      </section>

      {/* ── MODE LAUNCHER — the centrepiece ──────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-[20px] font-extrabold tracking-[-0.015em] text-foreground">Study this set</h2>
          <p className="ds-small mt-1">
            Play a game with every word right and it is mastered — a quarter of the bar
            each. All four, and the set is done.
          </p>
        </div>
        {empty ? (
          <Alert tone="warning" title="Nothing to study yet" className="squircle [--sq:10px]">
            This set has no words, so the study modes stay locked.
            {set.is_custom ? " Add a few words and they will unlock straight away." : ""}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STUDY_MODES.map((mode, i) => (
            <div key={mode} className="cr-pop h-full" style={{ animationDelay: `${i * 70}ms` }}>
              <StudyModeCard
                mode={mode}
                setId={set.id}
                disabled={empty}
                mastered={mastery.modes[mode]}
                assignmentId={assignmentId}
              />
            </div>
          ))}
        </div>
      </section>

      <WordList words={set.words} setId={set.id} iconClassName={look.icon} />
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
