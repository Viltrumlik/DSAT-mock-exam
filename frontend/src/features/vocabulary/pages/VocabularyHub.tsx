"use client";

/**
 * /vocabulary — the student hub and the landing page for the whole feature.
 *
 * Three tabs, three data sources: the published question bank (sections the
 * builder authors), the student's own custom sets, and sets a teacher assigned
 * as homework. All three counts live on the tab bar so a student can see there
 * is homework waiting without opening the tab.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookMarked,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  Library,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

import { Badge, Button, Card, CardContent, EmptyState, IconButton, Modal, Tabs, type TabItem } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";

import { SectionCard } from "../components/SectionCard";
import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState, vocabErrorMessage } from "../components/VocabStates";
import { useDeleteMySet, useMySets, useVocabHomework, useVocabSections } from "../hooks";
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

  const tabs: TabItem[] = [
    {
      value: "bank",
      label: "Question Bank",
      icon: Library,
      badge: sections.data ? <TabCount value={sections.data.length} /> : undefined,
    },
    {
      value: "mine",
      label: "My Sets",
      icon: BookMarked,
      badge: mySets.data ? <TabCount value={mySets.data.length} /> : undefined,
    },
    {
      value: "homework",
      label: "Homework",
      icon: GraduationCap,
      badge: homeworkOutstanding > 0 ? <TabCount value={homeworkOutstanding} tone="primary" /> : undefined,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Vocabulary</p>
          <h1 className="ds-h1 mt-1">Build your word bank</h1>
          <p className="ds-small mt-1">
            Four ways to study every set — flashcards, matching, speed and a full test. Any one of them counts as done.
          </p>
        </div>
        <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
          <Button leftIcon={<Plus />} tabIndex={-1}>
            New set
          </Button>
        </Link>
      </div>

      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as TabKey)} aria-label="Vocabulary sections" />

      {tab === "bank" ? <BankTab query={sections} /> : null}
      {tab === "mine" ? <MySetsTab query={mySets} /> : null}
      {tab === "homework" ? <HomeworkTab query={homework} /> : null}
    </div>
  );
}

function TabCount({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "primary" }) {
  return (
    <Badge variant={tone} className="ds-num ml-0.5">
      {value}
    </Badge>
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
        icon={Library}
        title="No word lists published yet"
        description="Your teachers publish vocabulary sections here. In the meantime you can build a set of your own."
        action={
          <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
            <Button variant="secondary" leftIcon={<Plus />} tabIndex={-1}>
              Build my own set
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sections.map((s) => (
        <SectionCard key={s.id} section={s} />
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
          icon={Sparkles}
          title="Make a set of the words you keep missing"
          description="Pull any words from the question bank into a set of your own, then study it with all four modes."
          action={
            <Link href="/vocabulary/new-set" className="ds-ring rounded-xl">
              <Button leftIcon={<Plus />} tabIndex={-1}>
                New set
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sets.map((s) => (
            <SetCard
              key={s.id}
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
        icon={GraduationCap}
        title="No vocabulary homework right now"
        description="When a teacher assigns a word list it lands here with its due date. Until then, pick any set from the question bank."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <HomeworkGroupCard key={`${g.assignment_id}`} group={g} />
      ))}
    </div>
  );
}

function HomeworkGroupCard({ group }: { group: VocabHomeworkGroup }) {
  const done = group.sets.filter((s) => s.completed).length;
  const allDone = done === group.sets.length && group.sets.length > 0;
  const due = dueChip(group.due_at);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="ds-h3 truncate">{group.assignment_title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-muted-foreground">
              <Link
                href={`/classes/${group.classroom_id}`}
                className="ds-ring inline-flex items-center gap-1.5 rounded-md hover:text-foreground"
              >
                <Users className="h-3.5 w-3.5" />
                {group.classroom_name}
              </Link>
              {due ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {due.text}
                </span>
              ) : (
                <span>No deadline</span>
              )}
            </div>
          </div>
          <Badge variant={allDone ? "success" : due?.late ? "warning" : "neutral"}>
            {allDone ? <CheckCircle2 className="h-3 w-3" /> : null}
            <span className="ds-num">
              {done} / {group.sets.length}
            </span>
            {allDone ? "complete" : "done"}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {group.sets.map((s) => (
            <SetCard
              key={s.id}
              title={s.title}
              href={`/vocabulary/sets/${s.id}`}
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
