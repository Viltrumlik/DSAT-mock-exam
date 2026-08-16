"use client";

/**
 * /vocabulary — the student hub and the landing page for the whole feature.
 *
 * Three tabs, three data sources: the published question bank (sections the
 * builder authors), the student's own custom sets, and sets a teacher assigned
 * as homework. All three counts live on the tab bar so a student can see there
 * is homework waiting without opening the tab.
 *
 * Visually this is the AssignmentDetail idiom: gradient hero → meta tiles built
 * from real aggregates → pill tab bar → staggered cards.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookMarked,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  Layers,
  Library,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Type,
  Users,
} from "lucide-react";

import { Button, Card, CardContent, IconButton, Modal } from "@/components/ui";
// The house devices — the borderless status pill, the pill tab bar, and the untinted
// empty state that the classroom uses.
import { EmptyState, Pill, Tabs, type TabItem } from "@/features/classroom/ui";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";

import { SectionCard } from "../components/SectionCard";
import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState, vocabErrorMessage } from "../components/VocabStates";
import { useDeleteMySet, useMySets, useVocabHomework, useVocabSections } from "../hooks";
import { withLaunchAssignment } from "../launchContext";
import type { CustomSetSummary, VocabHomeworkGroup } from "../types";

type TabKey = "bank" | "mine" | "homework";

/** Short, growth-oriented deadline chip — a passed deadline reads "Catch up", never "Overdue". */
function dueChip(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const late = d.getTime() < Date.now();
  const days = Math.abs(Math.round((d.getTime() - Date.now()) / 86_400_000));
  const label =
    days <= 6
      ? d.toLocaleDateString("en-US", { weekday: "short" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { text: late ? `Catch up · ${label}` : `Due ${label}`, late };
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function VocabularyHub() {
  const [tab, setTab] = useState<TabKey>("bank");

  const sections = useVocabSections();
  const mySets = useMySets();
  const homework = useVocabHomework();

  const homeworkOutstanding = useMemo(() => {
    const groups = homework.data ?? [];
    return groups.reduce((n, g) => n + g.sets.filter((s) => !s.completed).length, 0);
  }, [homework.data]);

  /** Hero meta tiles — real aggregates summed across every published section. */
  const totals = useMemo(() => {
    const list = sections.data ?? [];
    return list.reduce(
      (acc, s) => ({
        words: acc.words + s.word_count,
        sets: acc.sets + s.set_count,
        mastered: acc.mastered + s.progress.mastered,
        learning: acc.learning + s.progress.learning,
      }),
      { words: 0, sets: 0, mastered: 0, learning: 0 },
    );
  }, [sections.data]);

  const heroReady = Boolean(sections.data);
  const tiles = [
    { label: "Words", icon: Type, value: totals.words },
    { label: "Mastered", icon: CheckCircle2, value: totals.mastered },
    { label: "Learning", icon: TrendingUp, value: totals.learning },
    { label: "Sets", icon: Layers, value: totals.sets },
  ];

  // The house tab bar takes a plain count and renders the chip itself, so the local
  // TabCount is no longer needed here.
  const tabs: TabItem[] = [
    { id: "bank", label: "Question Bank", icon: Library, count: sections.data?.length },
    { id: "mine", label: "My Sets", icon: BookMarked, count: mySets.data?.length },
    {
      id: "homework",
      label: "Homework",
      icon: GraduationCap,
      count: homeworkOutstanding > 0 ? homeworkOutstanding : undefined,
    },
  ];

  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-6 pb-12"
      style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}
    >
      {/* HERO — eyebrow, title, aggregate meta tiles, primary action. */}
      <Card className="cr-cardrise overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-6 py-7 text-primary-foreground sm:px-[34px] sm:py-[30px]">
          <div aria-hidden className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-white/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute -top-20 right-24 h-40 w-40 rounded-full bg-white/[0.04]" />

          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Vocabulary
              </span>
              <h1 className="mt-[14px] text-[30px] font-extrabold leading-none tracking-[-0.025em] sm:text-[34px]">
                Build your word bank
              </h1>
              <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed opacity-[0.78]">
                Four ways to study every set — flashcards, matching, speed and a full test. Any one of them counts as done.
              </p>
            </div>
            <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
              <Button variant="secondary" className="cr-press" leftIcon={<Plus />} tabIndex={-1}>
                New set
              </Button>
            </Link>
          </div>

          <div className="relative mt-[26px] flex flex-wrap gap-x-[34px] gap-y-4">
            {tiles.map((t, i) => (
              <div key={t.label} className="cr-pillin" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] opacity-[0.72]">{t.label}</div>
                <div className="mt-[5px] inline-flex items-center gap-1.5 rounded-lg bg-white/[0.16] px-[11px] py-[3px] text-[17px] font-extrabold">
                  <t.icon className="h-4 w-4 opacity-80" aria-hidden />
                  <span className="ds-num">{heroReady ? t.value : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* -my-1/py-1 keeps the active pill's shadow from being clipped by the
          horizontal scroller that saves the three tabs on a phone. */}
      <div className="-my-1 max-w-full overflow-x-auto py-1">
        <Tabs
          items={tabs}
          active={tab}
          onChange={(id) => setTab(id as TabKey)}
          className="whitespace-nowrap"
        />
      </div>

      <div key={tab} className="cr-section">
        {tab === "bank" ? <BankTab query={sections} /> : null}
        {tab === "mine" ? <MySetsTab query={mySets} /> : null}
        {tab === "homework" ? <HomeworkTab query={homework} /> : null}
      </div>
    </div>
  );
}

/* ── Question Bank ─────────────────────────────────────────────────────── */

function BankTab({ query }: { query: ReturnType<typeof useVocabSections> }) {
  if (query.isLoading) return <VocabCardsSkeleton count={4} />;
  if (query.isError) return <VocabErrorState onRetry={() => void query.refetch()} />;

  const sections = query.data ?? [];
  if (sections.length === 0) {
    return (
      <EmptyState
        className="cr-cardrise"
        icon={Library}
        title="No word lists published yet"
        description="Your teachers publish vocabulary sections here. In the meantime you can build a set of your own."
        action={
          <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
            <Button variant="secondary" className="cr-press" leftIcon={<Plus />} tabIndex={-1}>
              Build my own set
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sections.map((s, i) => (
        <SectionCard key={s.id} section={s} index={i} />
      ))}
    </div>
  );
}

/* ── My Sets ───────────────────────────────────────────────────────────── */

function MySetsTab({ query }: { query: ReturnType<typeof useMySets> }) {
  const toast = useToast();
  const del = useDeleteMySet();
  const [pending, setPending] = useState<CustomSetSummary | null>(null);

  async function confirmDelete() {
    if (!pending) return;
    try {
      await del.mutateAsync(pending.id);
      toast.push({ tone: "success", message: `Deleted “${pending.title}”.` });
      setPending(null);
    } catch (e) {
      toast.push({ tone: "error", message: vocabErrorMessage(e) });
    }
  }

  if (query.isLoading) return <VocabCardsSkeleton count={2} />;
  if (query.isError) return <VocabErrorState title="Couldn't load your sets" onRetry={() => void query.refetch()} />;

  const sets = query.data ?? [];

  return (
    <>
      {sets.length === 0 ? (
        <EmptyState
          className="cr-cardrise"
          icon={Sparkles}
          title="Make a set of the words you keep missing"
          description="Pull any words from the question bank into a set of your own, then study it with all four modes."
          action={
            <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
              <Button className="cr-press" leftIcon={<Plus />} tabIndex={-1}>
                New set
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sets.map((s, i) => (
            <SetCard
              key={s.id}
              index={i}
              title={s.title}
              href={`/vocabulary/sets/${s.id}`}
              wordCount={s.word_count}
              completed={s.completed}
              subtitle={`Created ${shortDate(s.created_at)}`}
              trailing={
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => setPending(s)}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              }
            />
          ))}
        </div>
      )}

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this set?"
        description={pending ? `“${pending.title}” and its word list will be removed. Your progress on the words themselves is kept.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => void confirmDelete()}>
              Delete set
            </Button>
          </>
        }
      />
    </>
  );
}

/* ── Homework ──────────────────────────────────────────────────────────── */

function HomeworkTab({ query }: { query: ReturnType<typeof useVocabHomework> }) {
  if (query.isLoading) return <VocabCardsSkeleton count={2} />;
  if (query.isError) return <VocabErrorState title="Couldn't load your homework" onRetry={() => void query.refetch()} />;

  const groups = query.data ?? [];
  if (groups.length === 0) {
    return (
      <EmptyState
        className="cr-cardrise"
        icon={GraduationCap}
        title="No vocabulary homework right now"
        description="When a teacher assigns a word list it lands here with its due date. Until then, pick any set from the question bank."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <HomeworkGroupCard key={`${g.assignment_id}`} group={g} index={i} />
      ))}
    </div>
  );
}

function HomeworkGroupCard({ group, index }: { group: VocabHomeworkGroup; index: number }) {
  const done = group.sets.filter((s) => s.completed).length;
  const allDone = done === group.sets.length && group.sets.length > 0;
  const due = dueChip(group.due_at);

  return (
    // cr-cardrise, not cr-card: this is a container — it should enter, but it
    // must not lift (or pop the nested set-card icons) on hover.
    <Card
      className={cn("cr-cardrise", allDone && "ring-1 ring-inset ring-success/40")}
      style={{ animationDelay: `${Math.min(index, 12) * 60}ms` }}
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {/* No `cr-iconpop` here: it only fires under `.cr-card:hover`, and
                this container deliberately isn't a `cr-card`. */}
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                allDone ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
              )}
            >
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="ds-h3 line-clamp-2">{group.assignment_title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/classes/${group.classroom_id}`}
                  className="ds-ring cr-pill inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {group.classroom_name}
                </Link>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
                    due?.late ? "bg-warning-soft text-warning-foreground" : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {due ? due.text : "No deadline"}
                </span>
              </div>
            </div>
          </div>
          <Pill tone={allDone ? "success" : due?.late ? "warning" : "neutral"}>
            {allDone ? <CheckCircle2 className="h-3 w-3" /> : null}
            <span className="ds-num">
              {done} / {group.sets.length}
            </span>
            {allDone ? "complete" : "done"}
          </Pill>
        </div>

        {/* The link carries the assignment this card belongs to. The SAME set can
            appear under two groups here — assigned to two classrooms, or
            re-assigned for revision — and the two cards then differ ONLY by this
            id. Drop it and the server binds both runs to whichever assignment is
            newest, which is how one homework scored 100% while its twin scored 0. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {group.sets.map((s, i) => (
            <SetCard
              key={s.id}
              index={i}
              title={s.title}
              href={withLaunchAssignment(`/vocabulary/sets/${s.id}`, group.assignment_id)}
              wordCount={s.word_count}
              completed={s.completed}
              subtitle={s.section_title}
              actionLabel="Start"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
