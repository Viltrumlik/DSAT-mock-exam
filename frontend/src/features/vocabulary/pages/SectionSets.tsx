"use client";

/**
 * /vocabulary/sections/[sectionId] — every set in one published bank section.
 *
 * Header card follows the classroom-detail idiom: icon square + title + pills,
 * with the section's real aggregates as stat tiles underneath.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Layers, Library, Type } from "lucide-react";

import { Badge, Card, CardContent, EmptyState, ProgressRing, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { SetCard } from "../components/SetCard";
import { VocabCardsSkeleton, VocabErrorState } from "../components/VocabStates";
import { useVocabSection } from "../hooks";

export function SectionSets({ sectionId }: { sectionId: number }) {
  const q = useVocabSection(sectionId);

  /** Sets / Words / Mastered, summed over the section's sets. */
  const totals = useMemo(() => {
    const sets = q.data?.sets ?? [];
    return sets.reduce(
      (acc, s) => ({
        sets: acc.sets + 1,
        words: acc.words + s.word_count,
        mastered: acc.mastered + s.progress.mastered,
        completed: acc.completed + (s.completed ? 1 : 0),
      }),
      { sets: 0, words: 0, mastered: 0, completed: 0 },
    );
  }, [q.data]);

  const valid = Number.isFinite(sectionId) && sectionId > 0;
  const masteredPct = totals.words > 0 ? Math.round((totals.mastered / totals.words) * 100) : 0;
  const allDone = totals.sets > 0 && totals.completed === totals.sets;

  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-6 pb-12"
      style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}
    >
      <Link
        href="/vocabulary"
        className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to vocabulary
      </Link>

      {!valid || q.isError ? (
        <VocabErrorState
          title="This section isn't available"
          description="It may have been unpublished. Head back to the vocabulary hub and pick another one."
          onRetry={() => void q.refetch()}
        />
      ) : q.isLoading || !q.data ? (
        <>
          <HeaderSkeleton />
          <VocabCardsSkeleton count={4} className="lg:grid-cols-3" />
        </>
      ) : (
        <>
          <Card className="cr-cardrise">
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Library className="h-6 w-6" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="primary">Question bank</Badge>
                    {allDone ? (
                      <Badge variant="success">
                        <CheckCircle2 className="h-3 w-3" /> All sets done
                      </Badge>
                    ) : null}
                  </div>
                  <h1 className="ds-h1 mt-2">{q.data.title}</h1>
                  {q.data.description ? <p className="ds-small mt-1.5 max-w-2xl">{q.data.description}</p> : null}
                </div>

                <ProgressRing
                  value={masteredPct}
                  size={64}
                  strokeWidth={6}
                  color={masteredPct >= 100 ? "text-success" : "text-primary"}
                  className="shrink-0"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile icon={Layers} label="Sets" value={totals.sets} index={0} />
                <StatTile icon={Type} label="Words" value={totals.words} index={1} />
                <StatTile icon={CheckCircle2} label="Mastered" value={totals.mastered} index={2} tone="success" />
              </div>
            </CardContent>
          </Card>

          {q.data.sets.length === 0 ? (
            <EmptyState
              className="cr-cardrise"
              icon={Library}
              title="This section has no sets yet"
              description="Sets show up as soon as the words are published. Try another section in the meantime."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.sets.map((s, i) => (
                <SetCard
                  key={s.id}
                  index={i}
                  title={s.title}
                  href={`/vocabulary/sets/${s.id}`}
                  wordCount={s.word_count}
                  completed={s.completed}
                  progress={s.progress}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  index,
  tone = "primary",
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  index: number;
  tone?: "primary" | "success";
}) {
  return (
    <div
      className="cr-pillin flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tone === "success" ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="ds-overline">{label}</p>
        <p className="ds-num text-[22px] font-extrabold leading-none tracking-tight text-foreground">{value}</p>
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <Card className="cr-cardrise" aria-hidden>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12" />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton variant="circle" className="h-5 w-32" />
            <Skeleton variant="text" className="w-1/2" />
            <Skeleton variant="text" className="w-3/4" />
          </div>
          <Skeleton variant="circle" className="h-16 w-16 shrink-0" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px]" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
